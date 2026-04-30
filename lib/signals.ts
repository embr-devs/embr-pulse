// Signal-pack assembly for Loop 3 (self-heal).
//
// v1 NOTE: We deliberately compute signals from in-app Postgres state instead
// of Application Insights. App Insights API Keys are deprecated and AAD-based
// access requires a service principal we don't have permission to create in
// the corp tenant. Once Embr ships workload identity (gap G-002), this file
// is the single seam to swap for live App Insights queries — the agent prompt
// and signal-pack shape don't change.
//
// See docs/embed-in-embr.md for the full migration story.

import { pool } from "@/lib/db";

export interface SignalPack {
  windowMinutes: number;
  generatedAt: string;
  syntheticFailureFlagOn: boolean;
  metrics: {
    feedbackCount: number;
    triageFailureCount: number;
    issueCreationFailureCount: number;
    syntheticFailureCount: number;
    totalSystemErrors: number;
  };
  recentEvents: Array<{ at: string; type: string; source: string; summary: string }>;
  recentDeployments: Array<{ sha: string; message: string; at: string }>;
  openIncidents: Array<{ number: number; title: string; createdAt: string }>;
}

export interface AssembleOptions {
  windowMinutes?: number;
  recentEventLimit?: number;
}

interface SystemEventRow {
  type: string;
  payload_json: Record<string, unknown> | null;
  created_at: Date;
}

interface FeedbackEventRow {
  type: string;
  source: string;
  payload_json: Record<string, unknown> | null;
  created_at: Date;
}

interface IncidentRow {
  github_issue_number: number | null;
  signal_summary: string | null;
  detected_at: Date;
}

/**
 * Assemble a signal pack from local Postgres state. Pure read; no mutations.
 *
 * The pack mirrors the schema the Foundry monitor agent expects in
 * `lib/monitor.ts`'s SYSTEM_PROMPT.
 */
export async function assembleSignalPack(
  opts: AssembleOptions = {},
): Promise<SignalPack> {
  const windowMinutes = opts.windowMinutes ?? 30;
  const recentEventLimit = opts.recentEventLimit ?? 25;
  const since = `NOW() - make_interval(mins => ${windowMinutes})`;

  // Aggregate feedback-side metrics.
  const aggRes = await pool.query<{
    feedback_count: number;
    triage_failure_count: number;
    issue_creation_failure_count: number;
  }>(
    `SELECT
        COUNT(*) FILTER (WHERE created_at > ${since})::int AS feedback_count,
        COUNT(*) FILTER (
          WHERE created_at > ${since}
            AND triage_summary IS NULL
            AND created_at < NOW() - INTERVAL '1 minute'
        )::int AS triage_failure_count,
        COUNT(*) FILTER (
          WHERE created_at > ${since}
            AND github_issue_number IS NULL
            AND created_at < NOW() - INTERVAL '1 minute'
        )::int AS issue_creation_failure_count
       FROM feedback`,
  );
  const agg = aggRes.rows[0] ?? {
    feedback_count: 0,
    triage_failure_count: 0,
    issue_creation_failure_count: 0,
  };

  // System-level error counters.
  const sysRes = await pool.query<{
    synthetic_failure_count: number;
    total_system_errors: number;
  }>(
    `SELECT
        COUNT(*) FILTER (WHERE type = 'synthetic_failure_injected' AND created_at > ${since})::int
            AS synthetic_failure_count,
        COUNT(*) FILTER (WHERE type LIKE '%_failed' AND created_at > ${since})::int
            AS total_system_errors
       FROM system_events`,
  );
  const sys = sysRes.rows[0] ?? {
    synthetic_failure_count: 0,
    total_system_errors: 0,
  };

  // Most-recent error-shaped events (system + feedback) for the agent to
  // reason over. Cap the total at recentEventLimit so we don't blow context.
  const sysEventsRes = await pool.query<SystemEventRow>(
    `SELECT type, payload_json, created_at
       FROM system_events
      WHERE created_at > ${since}
        AND (type LIKE '%_failed' OR type = 'synthetic_failure_injected')
      ORDER BY created_at DESC
      LIMIT $1`,
    [recentEventLimit],
  );

  const fbEventsRes = await pool.query<FeedbackEventRow>(
    `SELECT type, source, payload_json, created_at
       FROM feedback_events
      WHERE created_at > ${since}
        AND type LIKE '%_failed'
      ORDER BY created_at DESC
      LIMIT $1`,
    [recentEventLimit],
  );

  const recentEvents = [
    ...sysEventsRes.rows.map((r) => ({
      at: r.created_at.toISOString(),
      type: r.type,
      source: "system" as const,
      summary: summarizePayload(r.payload_json),
    })),
    ...fbEventsRes.rows.map((r) => ({
      at: r.created_at.toISOString(),
      type: r.type,
      source: r.source,
      summary: summarizePayload(r.payload_json),
    })),
  ]
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, recentEventLimit);

  // Recent deployments — derived from the `deployments` table, populated by
  // the GitHub webhook receiver. May be empty in v1 if webhook hasn't fired
  // recently. (TODO: replace with Embr lifecycle webhook once gap G-003
  // ships — see docs/platform-gaps.md.)
  const deployRes = await pool.query<{ commit_sha: string; deployed_at: Date | null; created_at: Date }>(
    `SELECT commit_sha, deployed_at, created_at
       FROM deployments
      WHERE created_at > ${since}
      ORDER BY created_at DESC
      LIMIT 5`,
  );
  const recentDeployments = deployRes.rows.map((r) => ({
    sha: r.commit_sha.slice(0, 7),
    message: "",
    at: (r.deployed_at ?? r.created_at).toISOString(),
  }));

  // Currently-open incidents — the agent uses these for dedupe.
  const incRes = await pool.query<IncidentRow>(
    `SELECT github_issue_number, signal_summary, detected_at
       FROM incidents
      WHERE status = 'open'
      ORDER BY detected_at DESC
      LIMIT 10`,
  );
  const openIncidents = incRes.rows
    .filter((r) => r.github_issue_number !== null)
    .map((r) => ({
      number: r.github_issue_number as number,
      title: (r.signal_summary ?? "incident").slice(0, 120),
      createdAt: r.detected_at.toISOString(),
    }));

  return {
    windowMinutes,
    generatedAt: new Date().toISOString(),
    syntheticFailureFlagOn: process.env.EMBR_PULSE_SIMULATE_FAILURE === "true",
    metrics: {
      feedbackCount: agg.feedback_count ?? 0,
      triageFailureCount: agg.triage_failure_count ?? 0,
      issueCreationFailureCount: agg.issue_creation_failure_count ?? 0,
      syntheticFailureCount: sys.synthetic_failure_count ?? 0,
      totalSystemErrors: sys.total_system_errors ?? 0,
    },
    recentEvents,
    recentDeployments,
    openIncidents,
  };
}

function summarizePayload(payload: Record<string, unknown> | null): string {
  if (!payload) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(payload)) {
    if (v === null || v === undefined) continue;
    const s = typeof v === "string" ? v : JSON.stringify(v);
    parts.push(`${k}=${s.slice(0, 80)}`);
    if (parts.length >= 3) break;
  }
  return parts.join(", ").slice(0, 240);
}

/**
 * Record a system-level event. Used by the synthetic failure injector and
 * the monitor endpoint to leave breadcrumbs that show up in subsequent
 * signal packs.
 */
export async function recordSystemEvent(
  type: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  await pool.query(
    `INSERT INTO system_events (type, payload_json) VALUES ($1, $2::jsonb)`,
    [type, JSON.stringify(payload)],
  );
}
