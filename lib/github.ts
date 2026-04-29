// GitHub issue creation + comment + Copilot routing for the feedback loop.
// Gated by GITHUB_TOKEN. If unset, every function here is a no-op and the
// caller falls back gracefully.
//
// Target repo: this targets the app's own repo (seligj95/embr-pulse), NOT
// the Embr platform repo.
//
// Trust boundary rule (per docs/design.md): the issue body contains only
// user-authored content + system metadata. Agent-authored content (triage
// summary, suggested actions) lives in a separate comment so the user's
// words stay clean for downstream agents (Copilot coding agent, etc.).

import { Octokit } from "@octokit/rest";
import { pool } from "@/lib/db";
import { log } from "@/lib/log";

const REPO_OWNER = process.env.GITHUB_REPO_OWNER ?? "seligj95";
const REPO_NAME = process.env.GITHUB_REPO_NAME ?? "embr-pulse";

// Confidence ≥ this threshold + dedupeOf null + not low-confidence → auto-route to Copilot.
const COPILOT_CONFIDENCE_THRESHOLD = 0.7;

let cachedClient: Octokit | null = null;

function getClient(): Octokit | null {
  if (cachedClient) return cachedClient;
  const token = process.env.GITHUB_TOKEN;
  if (!token) return null;
  cachedClient = new Octokit({ auth: token });
  return cachedClient;
}

export interface TriageEnrichment {
  suggestedTitle: string;
  suggestedLabels: string[];
  summary: string;
  confidence: number;
  dedupeOfIssueNumber: number | null;
}

export interface FeedbackIssuePayload {
  feedbackId: string;
  title: string;
  body: string;
  category: string | null;
  submitterName: string;
  triage?: TriageEnrichment | null;
}

export interface CreatedIssue {
  number: number;
  url: string;
  nodeId: string;
}

/** Sanitize a single line to safe markdown — strip control chars + truncate. */
function safeLine(s: string, max = 200): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, max);
}

function buildIssueBody(p: FeedbackIssuePayload): string {
  // Cap body at 8000 chars — well under GitHub's 65536 limit, leaves room for
  // metadata header.
  const body = p.body.length > 8000 ? `${p.body.slice(0, 8000)}…\n\n_(truncated)_` : p.body;
  return [
    `**Submitted via embr-pulse**`,
    `- Feedback ID: \`${p.feedbackId}\``,
    `- Submitter: ${safeLine(p.submitterName, 100)}`,
    p.category ? `- Category: \`${safeLine(p.category, 30)}\`` : null,
    "",
    "---",
    "",
    body,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

export async function createFeedbackIssue(
  payload: FeedbackIssuePayload,
): Promise<CreatedIssue | null> {
  const client = getClient();
  if (!client) return null;

  // Triage labels override the simple category-based labels when present.
  const labels = payload.triage?.suggestedLabels?.length
    ? payload.triage.suggestedLabels.slice(0, 4)
    : (() => {
        const base = ["pulse-feedback"];
        if (payload.category) base.push(`pulse-${safeLine(payload.category, 20)}`);
        return base;
      })();

  // Low-confidence triage → tag for human review before Copilot picks it up.
  if (payload.triage && payload.triage.confidence < 0.5 && !labels.includes("needs-human-review")) {
    labels.push("needs-human-review");
  }

  const title = payload.triage?.suggestedTitle?.trim()
    ? safeLine(payload.triage.suggestedTitle, 140)
    : safeLine(payload.title, 140);

  const res = await client.issues.create({
    owner: REPO_OWNER,
    repo: REPO_NAME,
    title,
    body: buildIssueBody(payload),
    labels,
  });

  return {
    number: res.data.number,
    url: res.data.html_url,
    nodeId: res.data.node_id,
  };
}

/**
 * Post the triage agent's analysis as a separate issue comment. Best-effort:
 * logs and swallows on failure (the issue itself was already created).
 */
export async function postTriageComment(
  feedbackId: string,
  issueNumber: number,
  triage: TriageEnrichment,
): Promise<boolean> {
  const client = getClient();
  if (!client) return false;

  const lines: string[] = [
    `🤖 **Triage analysis** — confidence \`${triage.confidence.toFixed(2)}\``,
    "",
    safeLine(triage.summary, 240),
    "",
    `**Suggested labels:** ${triage.suggestedLabels.map((l) => `\`${l}\``).join(", ")}`,
  ];
  if (triage.dedupeOfIssueNumber !== null) {
    lines.push(
      "",
      `⚠️ Possible duplicate of #${triage.dedupeOfIssueNumber}. Closing this issue if confirmed.`,
    );
  }
  if (triage.confidence < 0.5) {
    lines.push(
      "",
      "ℹ️ Low confidence — flagged \`needs-human-review\` instead of auto-routing to Copilot.",
    );
  }
  lines.push(
    "",
    "_Posted by the embr-pulse triage agent (Foundry · gpt-5.4-mini)._",
  );

  try {
    await client.issues.createComment({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      issue_number: issueNumber,
      body: lines.join("\n"),
    });
    await pool.query(
      `INSERT INTO feedback_events (feedback_id, type, source, payload_json)
       VALUES ($1, 'commented', 'foundry', $2::jsonb)`,
      [feedbackId, JSON.stringify({ issueNumber })],
    );
    log.info("github.triage_comment_posted", { feedbackId, issueNumber });
    return true;
  } catch (err) {
    log.error("github.triage_comment_failed", {
      feedbackId,
      issueNumber,
      message: (err as Error).message,
    });
    return false;
  }
}

let cachedCopilotBotId: string | null | undefined; // undefined = not looked up; null = not available

/**
 * Find the Copilot SWE agent bot's GraphQL node ID for this repo. The agent
 * appears in `suggestedActors(capabilities: [CAN_BE_ASSIGNED])` once Copilot
 * is enabled on the repo. Returns null if not enabled / not found. Cached
 * for the lifetime of the process.
 */
async function getCopilotBotId(client: Octokit): Promise<string | null> {
  if (cachedCopilotBotId !== undefined) return cachedCopilotBotId;
  try {
    const data = await client.graphql<{
      repository: {
        suggestedActors: {
          nodes: Array<{ __typename: string; login: string; id: string }>;
        };
      };
    }>(
      `query($owner: String!, $name: String!) {
        repository(owner: $owner, name: $name) {
          suggestedActors(capabilities: [CAN_BE_ASSIGNED], first: 100) {
            nodes {
              __typename
              login
              ... on Bot { id }
              ... on User { id }
            }
          }
        }
      }`,
      { owner: REPO_OWNER, name: REPO_NAME },
    );
    const copilot = data.repository.suggestedActors.nodes.find(
      (n) => n.__typename === "Bot" && /copilot/i.test(n.login),
    );
    cachedCopilotBotId = copilot?.id ?? null;
  } catch (err) {
    log.error("github.copilot_lookup_failed", { message: (err as Error).message });
    cachedCopilotBotId = null;
  }
  return cachedCopilotBotId;
}

/**
 * Decide whether to route an issue to the Copilot coding agent and do so.
 * Returns a record of the decision so the caller can log/observe it. Never
 * throws — failures are logged and the issue stays unassigned.
 */
export async function maybeAssignCopilot(
  feedbackId: string,
  issue: CreatedIssue,
  triage: TriageEnrichment | null,
): Promise<{ assigned: boolean; reason: string }> {
  if (!triage) return { assigned: false, reason: "no_triage" };
  if (triage.confidence < COPILOT_CONFIDENCE_THRESHOLD) {
    return { assigned: false, reason: "low_confidence" };
  }
  if (triage.dedupeOfIssueNumber !== null) {
    return { assigned: false, reason: "duplicate_candidate" };
  }

  const client = getClient();
  if (!client) return { assigned: false, reason: "no_github_token" };

  const botId = await getCopilotBotId(client);
  if (!botId) return { assigned: false, reason: "copilot_not_enabled" };

  try {
    await client.graphql(
      `mutation($assignableId: ID!, $actorIds: [ID!]!) {
        replaceActorsForAssignable(input: {assignableId: $assignableId, actorIds: $actorIds}) {
          assignable { ... on Issue { number } }
        }
      }`,
      { assignableId: issue.nodeId, actorIds: [botId] },
    );
    await pool.query(
      `INSERT INTO feedback_events (feedback_id, type, source, payload_json)
       VALUES ($1, 'assigned-copilot', 'system', $2::jsonb)`,
      [feedbackId, JSON.stringify({ issueNumber: issue.number, confidence: triage.confidence })],
    );
    log.info("github.copilot_assigned", {
      feedbackId,
      issueNumber: issue.number,
      confidence: triage.confidence,
    });
    return { assigned: true, reason: "ok" };
  } catch (err) {
    log.error("github.copilot_assign_failed", {
      feedbackId,
      issueNumber: issue.number,
      message: (err as Error).message,
    });
    return { assigned: false, reason: "graphql_error" };
  }
}

/** Update the feedback row with the GitHub issue number after creation. */
export async function attachIssueToFeedback(
  feedbackId: string,
  issueNumber: number,
): Promise<void> {
  await pool.query(
    `UPDATE feedback
       SET github_issue_number = $2,
           status = CASE WHEN status = 'open' THEN 'in-triage' ELSE status END,
           updated_at = now()
     WHERE id = $1`,
    [feedbackId, issueNumber],
  );
  await pool.query(
    `INSERT INTO feedback_events (feedback_id, type, source, payload_json)
     VALUES ($1, 'issue_created', 'system', $2::jsonb)`,
    [feedbackId, JSON.stringify({ issueNumber })],
  );
}

// Test-only export — reset module-level caches between tests.
export function __resetForTests(): void {
  cachedClient = null;
  cachedCopilotBotId = undefined;
}
