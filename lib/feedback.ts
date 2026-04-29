// Server-side data access for the `feedback` table.
// Per .github/copilot-instructions.md: all DB access goes through lib/db.ts (`pool`),
// and all mutations must write a feedback_events audit row.
import { pool } from "@/lib/db";

export type FeedbackStatus =
  | "open"
  | "in-triage"
  | "needs-human-review"
  | "in-progress"
  | "shipped"
  | "declined"
  | "spam";

export type FeedbackCategory = "bug" | "feature" | "question" | "other";

export interface FeedbackRow {
  id: string;
  submitterEmail: string;
  submitterName: string;
  title: string;
  body: string;
  category: FeedbackCategory | null;
  status: FeedbackStatus;
  githubIssueNumber: number | null;
  triageSummary: string | null;
  triageConfidence: number | null;
  shippedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface FeedbackDbRow {
  id: string;
  submitter_email: string;
  submitter_name: string;
  title: string;
  body: string;
  category: FeedbackCategory | null;
  status: FeedbackStatus;
  github_issue_number: number | null;
  triage_summary: string | null;
  triage_confidence: number | null;
  shipped_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function mapRow(row: FeedbackDbRow): FeedbackRow {
  return {
    id: row.id,
    submitterEmail: row.submitter_email,
    submitterName: row.submitter_name,
    title: row.title,
    body: row.body,
    category: row.category,
    status: row.status,
    githubIssueNumber: row.github_issue_number,
    triageSummary: row.triage_summary,
    triageConfidence: row.triage_confidence,
    shippedAt: row.shipped_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listRecentFeedback(limit = 50): Promise<FeedbackRow[]> {
  const result = await pool.query<FeedbackDbRow>(
    `SELECT * FROM feedback ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  return result.rows.map(mapRow);
}

export interface NewFeedbackInput {
  submitterEmail: string;
  submitterName: string;
  title: string;
  body: string;
  category: FeedbackCategory | null;
}

export async function insertFeedback(input: NewFeedbackInput): Promise<FeedbackRow> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const inserted = await client.query<FeedbackDbRow>(
      `INSERT INTO feedback (submitter_email, submitter_name, title, body, category, status)
       VALUES ($1, $2, $3, $4, $5, 'open')
       RETURNING *`,
      [
        input.submitterEmail,
        input.submitterName,
        input.title,
        input.body,
        input.category,
      ],
    );
    const row = inserted.rows[0];

    await client.query(
      `INSERT INTO feedback_events (feedback_id, type, source, payload_json)
       VALUES ($1, 'submitted', 'web', $2::jsonb)`,
      [
        row.id,
        JSON.stringify({
          category: input.category,
          // Note: we intentionally do NOT log the body here. Raw user text stays in
          // feedback.body only — never copied around.
          titleLength: input.title.length,
          bodyLength: input.body.length,
        }),
      ],
    );

    await client.query("COMMIT");
    return mapRow(row);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
