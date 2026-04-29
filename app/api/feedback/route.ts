import { NextResponse } from "next/server";
import { z } from "zod";
import { insertFeedback, listRecentFeedback } from "@/lib/feedback";
import { createFeedbackIssue, attachIssueToFeedback } from "@/lib/github";

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

  // Best-effort GitHub issue creation. Never let a GH failure cause the API
  // call to fail — the feedback is already stored and we'll surface the gap
  // via telemetry / status flag instead.
  let issue: { number: number; url: string } | null = null;
  try {
    issue = await createFeedbackIssue({
      feedbackId: row.id,
      title: row.title,
      body: row.body,
      category: row.category,
      submitterName: row.submitterName,
    });
    if (issue) {
      await attachIssueToFeedback(row.id, issue.number);
    }
  } catch (err) {
    console.error("[feedback] github issue creation failed:", err);
  }

  return NextResponse.json(
    {
      id: row.id,
      status: row.status,
      githubIssue: issue,
    },
    { status: 201 },
  );
}
