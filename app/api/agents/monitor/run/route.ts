// Loop 3 monitor cycle endpoint.
//
// Triggered by GitHub Actions cron (.github/workflows/monitor.yml) every 5
// minutes. Bearer-protected by MONITOR_TRIGGER_SECRET. The endpoint:
//   1. Assembles a signal pack from local Postgres state.
//   2. Calls the Foundry monitor agent.
//   3. If an incident is detected, creates (or dedupes onto) a GitHub
//      incident issue and persists an `incidents` row.
//   4. Records a `monitor_run` system event for audit / future querying.
//
// Always returns 200 even on partial failure so the cron doesn't retry-spam.
// Failures show up in structured logs / system_events instead.

import { NextResponse } from "next/server";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { assembleSignalPack, recordSystemEvent } from "@/lib/signals";
import { analyzeSignals, getLastAnalyzeFailureReason } from "@/lib/monitor";
import { createIncidentIssue } from "@/lib/incidents";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

function authorize(req: Request): boolean {
  const expected = process.env.MONITOR_TRIGGER_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  const provided = m[1].trim();
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const runId = randomUUID();
  log.info("monitor.run_started", { runId });

  let pack;
  try {
    pack = await assembleSignalPack();
  } catch (err) {
    log.error("monitor.signal_pack_failed", {
      runId,
      message: (err as Error).message,
    });
    return NextResponse.json({ runId, ok: false, reason: "signal_pack_failed" }, { status: 200 });
  }

  const result = await analyzeSignals(pack, 20_000, runId);

  let incidentSummary: { issueNumber: number; severity: string; action: string } | null = null;
  let dedupedOnto: number | null = null;

  if (result && result.incidentDetected) {
    if (result.dedupeOfIssueNumber !== null) {
      dedupedOnto = result.dedupeOfIssueNumber;
      await createIncidentIssue(result, pack, runId);
    } else {
      const created = await createIncidentIssue(result, pack, runId);
      if (created) {
        incidentSummary = {
          issueNumber: created.issueNumber,
          severity: result.severity,
          action: result.suggestedAction,
        };
      }
    }
  }

  await recordSystemEvent("monitor_run", {
    runId,
    incidentDetected: result?.incidentDetected ?? false,
    severity: result?.severity ?? null,
    confidence: result?.confidence ?? null,
    metrics: pack.metrics,
    syntheticFailureFlagOn: pack.syntheticFailureFlagOn,
  }).catch((err: unknown) => {
    log.error("monitor.run_event_persist_failed", {
      runId,
      message: (err as Error).message,
    });
  });

  log.info("monitor.run_completed", {
    runId,
    incidentDetected: result?.incidentDetected ?? false,
    incidentCreated: incidentSummary !== null,
    dedupedOnto,
  });

  return NextResponse.json(
    {
      runId,
      ok: true,
      analyzed: result !== null,
      analyzeFailureReason: result === null ? getLastAnalyzeFailureReason() : null,
      incidentDetected: result?.incidentDetected ?? false,
      severity: result?.severity ?? null,
      confidence: result?.confidence ?? null,
      incident: incidentSummary,
      dedupedOnto,
      pack: {
        windowMinutes: pack.windowMinutes,
        metrics: pack.metrics,
        openIncidentCount: pack.openIncidents.length,
        recentEventCount: pack.recentEvents.length,
        syntheticFailureFlagOn: pack.syntheticFailureFlagOn,
      },
    },
    { status: 200 },
  );
}

export async function GET() {
  return NextResponse.json({
    status: "monitor endpoint healthy",
    method: "POST with Authorization: Bearer <MONITOR_TRIGGER_SECRET>",
  });
}
