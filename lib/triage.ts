// Foundry-backed triage agent for incoming feedback.
//
// Input: raw user-submitted feedback + a small slice of recent issues for dedupe.
// Output: structured triage hints (sharper title, labels, summary, confidence,
// possible duplicate). The caller (app/api/feedback/route.ts) uses these to
// enrich the GitHub issue we open for Copilot to act on.
//
// Why direct Chat Completions instead of the Foundry Agents API:
//   The Foundry Agents service requires AAD/Managed Identity auth — it does
//   not accept the project's API key. Until we wire MI on the Embr workload,
//   we mirror the agent's system prompt here and call the underlying model
//   deployment directly through the project's OpenAI-compatible endpoint
//   (which DOES accept api-key). The Foundry agent in the portal stays the
//   canonical source of truth for the prompt — we keep this string in sync.
//   Foundry agent: embr-pulse-triage (https://ai.azure.com/)
//
// Gating: if any of FOUNDRY_PROJECT_ENDPOINT / FOUNDRY_API_KEY /
// FOUNDRY_MODEL_DEPLOYMENT is unset, this is a no-op and we return null. The
// feedback row + GitHub issue still flow through unenriched.

const SYSTEM_PROMPT = `You are the triage agent for embr-pulse, an internal-team feedback aggregator.

Each input is one feedback submission with: title, body, category, submitterName, recentIssues (JSON array of {number, title, state}).

Output ONLY a single JSON object with these fields, no prose:
{
  "suggestedTitle": string,
  "suggestedLabels": string[],
  "summary": string,
  "confidence": number,
  "dedupeOfIssueNumber": number | null
}

Labels: 1-4 short kebab-case strings; always include "pulse-feedback". Title <=140 chars, sharper than the user's title but preserving intent. Summary 1-2 sentences <=240 chars, factual, no opinions. Confidence 0.0-1.0 — your confidence the description is actionable enough for a coding agent. Be conservative: <0.5 if vague, ambiguous, or missing key context.

If recentIssues contains a clear duplicate, return its number in dedupeOfIssueNumber; else null.`;

export interface TriageInput {
  title: string;
  body: string;
  category: string | null;
  submitterName: string;
  recentIssues: Array<{ number: number; title: string; state: string }>;
}

export interface TriageResult {
  suggestedTitle: string;
  suggestedLabels: string[];
  summary: string;
  confidence: number;
  dedupeOfIssueNumber: number | null;
}

interface FoundryConfig {
  endpoint: string;
  apiKey: string;
  deployment: string;
  apiVersion: string;
}

function getConfig(): FoundryConfig | null {
  const endpoint = process.env.FOUNDRY_PROJECT_ENDPOINT;
  const apiKey = process.env.FOUNDRY_API_KEY;
  const deployment = process.env.FOUNDRY_MODEL_DEPLOYMENT;
  if (!endpoint || !apiKey || !deployment) return null;
  return {
    endpoint,
    apiKey,
    deployment,
    apiVersion: process.env.FOUNDRY_API_VERSION ?? "2024-10-21",
  };
}

/**
 * The project endpoint we store is `<host>/api/projects/<projectName>`, but the
 * OpenAI-compatible surface lives at the resource root `<host>/openai/...`.
 * Strip the `/api/projects/...` suffix so we can append `/openai/...` cleanly.
 */
function resourceRoot(projectEndpoint: string): string {
  const m = projectEndpoint.match(/^(https:\/\/[^/]+)/);
  if (!m) throw new Error(`FOUNDRY_PROJECT_ENDPOINT does not look like a URL: ${projectEndpoint}`);
  return m[1];
}

function isTriageResult(x: unknown): x is TriageResult {
  if (typeof x !== "object" || x === null) return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.suggestedTitle === "string" &&
    Array.isArray(r.suggestedLabels) &&
    r.suggestedLabels.every((l) => typeof l === "string") &&
    typeof r.summary === "string" &&
    typeof r.confidence === "number" &&
    (r.dedupeOfIssueNumber === null || typeof r.dedupeOfIssueNumber === "number")
  );
}

/**
 * Sanitize the raw model output: clamp lengths, dedupe labels, ensure
 * "pulse-feedback" is present, clamp confidence to [0,1]. We never trust the
 * model to stay inside our contract — it's still user data once it hits the DB
 * and the GitHub issue.
 */
function normalize(r: TriageResult): TriageResult {
  const labels = Array.from(
    new Set(
      r.suggestedLabels
        .map((l) => l.toLowerCase().trim().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, ""))
        .filter((l) => l.length > 0 && l.length <= 30),
    ),
  );
  if (!labels.includes("pulse-feedback")) labels.unshift("pulse-feedback");
  const trimmedLabels = labels.slice(0, 4);

  const confidence = Math.max(0, Math.min(1, r.confidence));

  return {
    suggestedTitle: r.suggestedTitle.replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, 140),
    suggestedLabels: trimmedLabels,
    summary: r.summary.replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, 240),
    confidence,
    dedupeOfIssueNumber:
      r.dedupeOfIssueNumber === null || !Number.isFinite(r.dedupeOfIssueNumber)
        ? null
        : Math.trunc(r.dedupeOfIssueNumber),
  };
}

/**
 * Call the Foundry agent (well: its underlying deployment). Returns null on
 * any failure — never throws into the caller. Logs failures to stderr; the
 * caller will fall back to creating an unenriched GitHub issue.
 *
 * @param timeoutMs Hard deadline for the upstream call. Default 15s.
 */
export async function triageFeedback(
  input: TriageInput,
  timeoutMs = 15_000,
): Promise<TriageResult | null> {
  const cfg = getConfig();
  if (!cfg) return null;

  const url = `${resourceRoot(cfg.endpoint)}/openai/deployments/${encodeURIComponent(cfg.deployment)}/chat/completions?api-version=${cfg.apiVersion}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "api-key": cfg.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(input) },
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: 500,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[triage] foundry chat completion failed: ${res.status} ${text.slice(0, 300)}`);
      return null;
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) {
      console.error("[triage] foundry response had no message content");
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      console.error("[triage] failed to JSON.parse model output:", err);
      return null;
    }

    if (!isTriageResult(parsed)) {
      console.error("[triage] model output did not match TriageResult shape:", content.slice(0, 200));
      return null;
    }

    return normalize(parsed);
  } catch (err) {
    if ((err as { name?: string }).name === "AbortError") {
      console.error(`[triage] foundry call timed out after ${timeoutMs}ms`);
    } else {
      console.error("[triage] foundry call threw:", err);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
