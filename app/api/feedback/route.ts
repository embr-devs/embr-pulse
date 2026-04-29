import { NextResponse } from "next/server";
import { z } from "zod";
import { insertFeedback, listRecentFeedback } from "@/lib/feedback";
import {
  createFeedbackIssue,
  attachIssueToFeedback,
  postTriageComment,
  maybeAssignCopilot,
} from "@/lib/github";
import { triageFeedback } from "@/lib/triage";
import { pool } from "@/lib/db";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

const FeedbackSchema = z.object({
  submitterName: z.string().trim().min(1).max(100),
  submitterEmail: z.string().trim().email().max(200),
  title: z.string().trim().min(3).max(140),
  body: z.string().trim().min(10).max(4000),
  category: z.enum(["bug", "feature", "question", "other"]).nullable().optional(),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
  const items = await listRecentFeedback(limit);
  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = FeedbackSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const row = await insertFeedback({
    submitterName: parsed.data.submitterName,
    submitterEmail: parsed.data.submitterEmail,
    title: parsed.data.title,
    body: parsed.data.body,
    category: parsed.data.category ?? null,
  });
  log.info("feedback.created", {
    feedbackId: row.id,
    category: row.category,
    titleLen: row.title.length,
    bodyLen: row.body.length,
  });

  // Best-effort triage. If Foundry isn't configured or the call fails,
  // triage is null and we open an unenriched issue. Pull the last 10
  // open/closed issues that already have a github_issue_number to give the
  // model a small dedupe window.
  let triage = null;
  try {
    const recentRes = await pool.query<{ github_issue_number: number; title: string; status: string }>(
      `SELECT github_issue_number, title, status FROM feedback
        WHERE github_issue_number IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 10`,
    );
    triage = await triageFeedback(
      {
        title: row.title,
        body: row.body,
        category: row.category,
        submitterName: row.submitterName,
        recentIssues: recentRes.rows.map((r) => ({
          number: r.github_issue_number,
          title: r.title,
          state: r.status === "shipped" || r.status === "declined" ? "closed" : "open",
        })),
      },
      15_000,
      row.id,
    );
    if (triage) {
      await pool.query(
        `UPDATE feedback
           SET triage_summary = $2, triage_confidence = $3, updated_at = now()
         WHERE id = $1`,
        [row.id, triage.summary, triage.confidence],
      );
      await pool.query(
        `INSERT INTO feedback_events (feedback_id, type, source, payload_json)
         VALUES ($1, 'triaged', 'foundry', $2::jsonb)`,
        [row.id, JSON.stringify({
          confidence: triage.confidence,
          labels: triage.suggestedLabels,
          dedupeOf: triage.dedupeOfIssueNumber,
        })],
      );
    }
  } catch (err) {
    log.error("feedback.triage_orchestration_failed", {
      feedbackId: row.id,
      message: (err as Error).message,
    });
  }

  // Best-effort GitHub issue creation. Never let a GH failure cause the API
  // call to fail — the feedback is already stored and we'll surface the gap
  // via telemetry / status flag instead.
  let issue: { number: number; url: string } | null = null;
  try {
    const created = await createFeedbackIssue({
      feedbackId: row.id,
      title: row.title,
      body: row.body,
      category: row.category,
      submitterName: row.submitterName,
      triage,
    });
    if (created) {
      issue = { number: created.number, url: created.url };
      await attachIssueToFeedback(row.id, created.number);
      log.info("feedback.issue_created", {
        feedbackId: row.id,
        issueNumber: created.number,
        triageEnriched: triage !== null,
      });

      // Post triage analysis as a separate comment so the issue body stays
      // user-authored. Best-effort — failure is logged inside.
      if (triage) {
        await postTriageComment(row.id, created.number, triage);
      }

      // Auto-route confident, non-duplicate issues to GitHub Copilot.
      const routing = await maybeAssignCopilot(row.id, created, triage);
      log.info("feedback.copilot_routing", {
        feedbackId: row.id,
        issueNumber: created.number,
        assigned: routing.assigned,
        reason: routing.reason,
      });
    }
  } catch (err) {
    log.error("feedback.issue_creation_failed", {
      feedbackId: row.id,
      message: (err as Error).message,
    });
  }

  return NextResponse.json(
    {
      id: row.id,
      status: row.status,
      githubIssue: issue,
      triage: triage
        ? {
            confidence: triage.confidence,
            labels: triage.suggestedLabels,
            dedupeOfIssueNumber: triage.dedupeOfIssueNumber,
          }
        : null,
    },
    { status: 201 },
  );
}
