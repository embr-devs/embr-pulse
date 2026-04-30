// Incident issue creation + dedup for Loop 3 (self-heal).
//
// Different from lib/github.ts (which handles feedback issues) in three ways:
//   1. Creates issues with `incident` + severity labels, not feedback labels.
//   2. Body is fully agent-authored (the hypothesis + signal summary). There
//      is no "user-authored vs agent-authored" trust boundary here — the
//      signal pack is system-generated.
//   3. Links to the `incidents` row and to the original monitor run for
//      audit. No Copilot auto-routing in v1: incidents always get a human
//      first-look. (Hookable in the future for narrow auto-fix lanes.)

import { Octokit } from "@octokit/rest";
import { pool } from "@/lib/db";
import { log } from "@/lib/log";
import type { MonitorResult } from "@/lib/monitor";
import type { SignalPack } from "@/lib/signals";

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

export interface CreatedIncident {
  id: string;
  issueNumber: number;
  issueUrl: string;
}

function severityLabel(sev: MonitorResult["severity"]): string {
  return `severity-${sev}`;
}

function buildIncidentBody(result: MonitorResult, pack: SignalPack): string {
  const lines: string[] = [];
  lines.push(`🚨 **Incident detected by embr-pulse monitor**`);
  lines.push("");
  lines.push(`- Severity: \`${result.severity}\``);
  lines.push(`- Suggested action: \`${result.suggestedAction}\``);
  if (result.correlatedDeploymentId) {
    lines.push(`- Correlated deployment: \`${result.correlatedDeploymentId}\``);
  }
  lines.push(`- Confidence: \`${result.confidence.toFixed(2)}\``);
  lines.push(`- Detection window: last \`${pack.windowMinutes}\` minutes`);
  lines.push("");
  lines.push("## Hypothesis");
  lines.push("");
  lines.push(result.hypothesis || "_(no hypothesis)_");
  if (result.suggestedActionDetail) {
    lines.push("");
    lines.push("## Suggested next step");
    lines.push("");
    lines.push(result.suggestedActionDetail);
  }
  lines.push("");
  lines.push("## Signal summary");
  lines.push("");
  lines.push("```json");
  lines.push(
    JSON.stringify(
      {
        generatedAt: pack.generatedAt,
        windowMinutes: pack.windowMinutes,
        syntheticFailureFlagOn: pack.syntheticFailureFlagOn,
        metrics: pack.metrics,
        recentDeployments: pack.recentDeployments,
        recentEventCount: pack.recentEvents.length,
      },
      null,
      2,
    ),
  );
  lines.push("```");
  if (pack.recentEvents.length > 0) {
    lines.push("");
    lines.push("## Recent error events");
    lines.push("");
    for (const e of pack.recentEvents.slice(0, 8)) {
      lines.push(`- \`${e.at}\` · \`${e.type}\` · ${e.summary || "(no summary)"}`);
    }
  }
  lines.push("");
  lines.push("---");
  lines.push("_Posted by the embr-pulse monitor agent (Foundry · gpt-5.4-mini). Humans please confirm before any remediation._");
  return lines.join("\n");
}

/**
 * Create a GitHub issue for a detected incident and record it in the
 * `incidents` table. Idempotency: if `dedupeOfIssueNumber` is set on the
 * monitor result, we comment on the existing issue instead of opening a new
 * one. Returns the CreatedIncident on issue creation; null when deduped or
 * when the GH client is unavailable.
 */
export async function createIncidentIssue(
  result: MonitorResult,
  pack: SignalPack,
  runId?: string,
): Promise<CreatedIncident | null> {
  const client = getClient();
  if (!client) {
    log.info("incident.skipped", { runId, reason: "no_github_token" });
    return null;
  }

  // Dedupe path: comment on the existing issue and bail.
  if (result.dedupeOfIssueNumber !== null) {
    try {
      await client.issues.createComment({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        issue_number: result.dedupeOfIssueNumber,
        body: [
          `🔁 **Monitor still seeing the same signal** at \`${pack.generatedAt}\`.`,
          "",
          `- Confidence: \`${result.confidence.toFixed(2)}\``,
          `- Severity: \`${result.severity}\``,
          "",
          result.hypothesis,
        ].join("\n"),
      });
      log.info("incident.deduped", {
        runId,
        existingIssueNumber: result.dedupeOfIssueNumber,
      });
    } catch (err) {
      log.error("incident.dedupe_comment_failed", {
        runId,
        existingIssueNumber: result.dedupeOfIssueNumber,
        message: (err as Error).message,
      });
    }
    return null;
  }

  // Fresh incident path.
  const labels = ["incident", severityLabel(result.severity)];
  if (result.suggestedAction === "revert") labels.push("auto-fix-candidate");

  const title = `[INCIDENT] ${result.title || "Monitor detected anomaly"}`;
  const body = buildIncidentBody(result, pack);

  let issueNumber = 0;
  let issueUrl = "";
  try {
    const res = await client.issues.create({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      title: title.slice(0, 200),
      body,
      labels,
    });
    issueNumber = res.data.number;
    issueUrl = res.data.html_url;
  } catch (err) {
    log.error("incident.issue_create_failed", {
      runId,
      message: (err as Error).message,
    });
    return null;
  }

  // Persist the incident row + audit event.
  let incidentId = "";
  try {
    const insRes = await pool.query<{ id: string }>(
      `INSERT INTO incidents (github_issue_number, slo, hypothesis, signal_summary, status)
       VALUES ($1, $2, $3, $4, 'open')
       RETURNING id`,
      [
        issueNumber,
        result.suggestedAction,
        result.hypothesis,
        result.title || "incident",
      ],
    );
    incidentId = insRes.rows[0]?.id ?? "";

    await pool.query(
      `INSERT INTO system_events (type, payload_json) VALUES ($1, $2::jsonb)`,
      [
        "incident_created",
        JSON.stringify({
          runId,
          incidentId,
          issueNumber,
          severity: result.severity,
          suggestedAction: result.suggestedAction,
          confidence: result.confidence,
          correlatedDeploymentId: result.correlatedDeploymentId,
        }),
      ],
    );
  } catch (err) {
    log.error("incident.persist_failed", {
      runId,
      issueNumber,
      message: (err as Error).message,
    });
  }

  log.info("incident.created", {
    runId,
    incidentId,
    issueNumber,
    severity: result.severity,
    suggestedAction: result.suggestedAction,
    confidence: result.confidence,
  });

  return { id: incidentId, issueNumber, issueUrl };
}

// Test-only export — reset module-level caches between tests.
export function __resetForTests(): void {
  cachedClient = null;
}
