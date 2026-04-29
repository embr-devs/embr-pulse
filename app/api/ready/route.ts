import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

// Readiness probe — checks dependencies (DB) are reachable. Distinct from
// /api/health (liveness, no deps). Don't point Embr's healthCheck at this:
// a transient DB blip would cause Embr to recycle the pod.
export async function GET() {
  const checks: Record<string, { ok: boolean; ms?: number; error?: string }> = {};

  const start = Date.now();
  try {
    await pool.query("SELECT 1");
    checks.database = { ok: true, ms: Date.now() - start };
  } catch (err) {
    checks.database = {
      ok: false,
      ms: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const allOk = Object.values(checks).every((c) => c.ok);
  return NextResponse.json(
    { status: allOk ? "ready" : "not_ready", checks, timestamp: new Date().toISOString() },
    { status: allOk ? 200 : 503 },
  );
}
