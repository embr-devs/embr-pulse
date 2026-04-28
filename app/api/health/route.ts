import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Embr pings this endpoint as a liveness probe per embr.yaml healthCheck config.
// Keep it dependency-free: no DB call, no Foundry call — just process liveness.
// Readiness (DB, Foundry, GitHub) lives at /api/ready (added later if needed).
export async function GET() {
  return NextResponse.json(
    {
      status: "ok",
      uptimeSeconds: Math.round(process.uptime()),
      commitSha: process.env.COMMIT_SHA ?? "unknown",
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
