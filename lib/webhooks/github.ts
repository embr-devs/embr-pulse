// GitHub webhook handler for embr-pulse.
//
// Subscribes to the `issues` event from seligj95/embr-pulse and reflects
// state changes back into our DB:
//   - issue closed   → flip feedback.status to "shipped" + set shipped_at + audit event
//   - issue reopened → flip back to "in-triage" + audit event
//
// Security: verifies the GitHub HMAC signature (X-Hub-Signature-256) using
// timing-safe comparison against GITHUB_WEBHOOK_SECRET. If the secret is
// unset (e.g. local dev before provisioning), every request is rejected
// with 503 — we never silently accept unsigned webhooks.
//
// Idempotency: GitHub may redeliver. The status flip is conditional
// (`WHERE status IS DISTINCT FROM $newStatus`) so a redelivery is a no-op.
// Audit rows are still inserted on every accepted delivery to keep an
// honest paper trail.

import { createHmac, timingSafeEqual } from "node:crypto";
import { pool } from "@/lib/db";

export type GithubWebhookOutcome =
  | { kind: "ignored"; reason: string }
  | { kind: "applied"; feedbackId: string; newStatus: string }
  | { kind: "no_match"; issueNumber: number };

export interface VerifiedGithubEvent {
  event: string;
  deliveryId: string;
  payload: Record<string, unknown>;
}

/**
 * Verifies the X-Hub-Signature-256 header. Returns parsed payload or null.
 * Caller must pass the RAW request body bytes (not parsed JSON).
 */
export function verifyAndParse(
  rawBody: string,
  signatureHeader: string | null,
  eventHeader: string | null,
  deliveryHeader: string | null,
  secret: string,
): VerifiedGithubEvent | null {
  if (!secret) return null;
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return null;
  if (!eventHeader) return null;

  const expected = "sha256=" +
    createHmac("sha256", secret).update(rawBody).digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return null;
  }

  return {
    event: eventHeader,
    deliveryId: deliveryHeader ?? "unknown",
    payload,
  };
}

interface IssueEventShape {
  action?: string;
  issue?: { number?: number; html_url?: string; state?: string };
}

/**
 * Dispatches a verified GitHub webhook event to the appropriate DB action.
 * Only handles `issues` events with action=closed|reopened today.
 */
export async function handleVerifiedEvent(
  ev: VerifiedGithubEvent,
): Promise<GithubWebhookOutcome> {
  if (ev.event !== "issues") {
    return { kind: "ignored", reason: `event=${ev.event}` };
  }
  const body = ev.payload as IssueEventShape;
  const action = body.action;
  const issueNumber = body.issue?.number;

  if (typeof issueNumber !== "number") {
    return { kind: "ignored", reason: "missing issue.number" };
  }
  if (action !== "closed" && action !== "reopened") {
    return { kind: "ignored", reason: `action=${action}` };
  }

  const newStatus = action === "closed" ? "shipped" : "in-triage";

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const update = await client.query<{ id: string }>(
      `UPDATE feedback
         SET status = $2,
             shipped_at = CASE WHEN $2 = 'shipped' THEN NOW() ELSE shipped_at END,
             updated_at = NOW()
       WHERE github_issue_number = $1
         AND status IS DISTINCT FROM $2
       RETURNING id`,
      [issueNumber, newStatus],
    );

    if (update.rowCount === 0) {
      await client.query("COMMIT");
      // Either no feedback row matches this issue (e.g. issue created
      // outside the app), or it's already in the target status.
      // Look up to disambiguate for the response.
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM feedback WHERE github_issue_number = $1 LIMIT 1`,
        [issueNumber],
      );
      if (existing.rowCount === 0) {
        return { kind: "no_match", issueNumber };
      }
      return { kind: "ignored", reason: `already ${newStatus}` };
    }

    const feedbackId = update.rows[0].id;
    await client.query(
      `INSERT INTO feedback_events (feedback_id, type, source, payload_json)
       VALUES ($1, $2, 'github-webhook', $3::jsonb)`,
      [
        feedbackId,
        action === "closed" ? "issue_closed" : "issue_reopened",
        JSON.stringify({
          githubIssueNumber: issueNumber,
          deliveryId: ev.deliveryId,
          newStatus,
        }),
      ],
    );

    await client.query("COMMIT");
    return { kind: "applied", feedbackId, newStatus };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
