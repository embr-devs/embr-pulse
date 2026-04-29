// GitHub issue creation for the feedback loop. Gated by GITHUB_TOKEN env var
// — if unset (e.g. local dev, or before the user provisions a PAT/App), this
// is a no-op and we just return null. The DB row was already inserted by
// insertFeedback() so feedback is never lost just because the GitHub side
// fails.
//
// Target repo: this targets the app's own repo (seligj95/embr-pulse), NOT the
// Embr platform repo (coreai-microsoft/embr). embr-pulse is internal-team-only
// and intentionally self-referential: feedback IS about embr-pulse, issues
// land in embr-pulse, the Copilot coding agent fixes them in embr-pulse. See
// docs/design.md "Scope & Audience" for the rationale. Platform gaps go to
// docs/platform-gaps.md and are ported manually in Phase 5.
//
// Trust boundary rule (per docs/design.md): we MUST NOT include the raw
// `feedback.body` in the issue when this is being driven by a triage agent.
// Issues opened directly from a feedback submission are a controlled,
// human-authored payload, so the body IS allowed to contain the user's text
// here — but we still strip control characters and cap length.

import { Octokit } from "@octokit/rest";
import { pool } from "@/lib/db";

const REPO_OWNER = process.env.GITHUB_REPO_OWNER ?? "seligj95";
const REPO_NAME = process.env.GITHUB_REPO_NAME ?? "embr-pulse";

let cachedClient: Octokit | null = null;

function getClient(): Octokit | null {
  if (cachedClient) return cachedClient;
  const token = process.env.GITHUB_TOKEN;
  if (!token) return null;
  cachedClient = new Octokit({ auth: token });
  return cachedClient;
}

export interface FeedbackIssuePayload {
  feedbackId: string;
  title: string;
  body: string;
  category: string | null;
  submitterName: string;
  /** Optional triage enrichment. When present, used to override title/labels and prepend a summary. */
  triage?: {
    suggestedTitle: string;
    suggestedLabels: string[];
    summary: string;
    confidence: number;
  } | null;
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
  const summaryBlock = p.triage?.summary
    ? [
        `> **Triage summary** (confidence ${p.triage.confidence.toFixed(2)})`,
        `> ${safeLine(p.triage.summary, 240)}`,
        "",
      ]
    : [];
  return [
    `**Submitted via embr-pulse**`,
    `- Feedback ID: \`${p.feedbackId}\``,
    `- Submitter: ${safeLine(p.submitterName, 100)}`,
    p.category ? `- Category: \`${safeLine(p.category, 30)}\`` : null,
    "",
    "---",
    "",
    ...summaryBlock,
    body,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

export async function createFeedbackIssue(
  payload: FeedbackIssuePayload,
): Promise<{ number: number; url: string } | null> {
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

  return { number: res.data.number, url: res.data.html_url };
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
