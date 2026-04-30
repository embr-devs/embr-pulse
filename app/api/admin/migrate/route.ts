// Idempotent schema migration endpoint.
//
// Why this exists: while we're using an external Postgres (G-007 workaround),
// Embr's `database.schema` auto-migrate doesn't run, so newly added tables
// like `system_events` and `incidents` (Loop 3) don't get created on deploy.
// This endpoint applies `db/schema.sql` against the live DATABASE_URL on
// demand, gated by MONITOR_TRIGGER_SECRET (reusing the bearer we already have).
//
// schema.sql uses `CREATE TABLE IF NOT EXISTS` everywhere, so re-running is
// safe. Removable once Embr's managed-DB tunnel works in our region.

import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pool } from "@/lib/db";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorize(req: Request): boolean {
  const expected = process.env.MONITOR_TRIGGER_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  const a = Buffer.from(m[1].trim());
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

  try {
    const sqlPath = join(process.cwd(), "db", "schema.sql");
    const sql = await readFile(sqlPath, "utf8");

    const before = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' ORDER BY table_name`,
    );
    const beforeTables = before.rows.map((r) => r.table_name);

    await pool.query(sql);

    const after = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' ORDER BY table_name`,
    );
    const afterTables = after.rows.map((r) => r.table_name);
    const created = afterTables.filter((t) => !beforeTables.includes(t));

    log.info("admin.migrate_applied", {
      beforeCount: beforeTables.length,
      afterCount: afterTables.length,
      createdTables: created.join(",") || "(none)",
    });

    return NextResponse.json({
      ok: true,
      beforeTables,
      afterTables,
      createdTables: created,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("admin.migrate_failed", { message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
