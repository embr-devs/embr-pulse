// Foundry-backed monitor agent for Loop 3 (self-heal).
//
// Input: signal pack assembled from in-app state (lib/signals.ts).
// Output: structured incident report with hypothesis + suggested action,
// or { incidentDetected: false } when nothing is wrong.
//
// Mirrors lib/triage.ts: same OpenAI-compatible endpoint pattern, same
// timeout discipline, same structured logging.
//
// Foundry agent: embr-pulse-monitor (https://ai.azure.com/)
// We mirror the agent's system prompt here as a string constant so the file
// remains the runtime source of truth even if the deployment changes.

import { log } from "@/lib/log";
import type { SignalPack } from "@/lib/signals";

const SYSTEM_PROMPT = `You are the embr-pulse incident triage agent. You receive a "signal pack" — a JSON object containing recent App Insights metrics, the most recent deployments, sample exception traces, and the list of currently open incident issues.

Your job: decide whether a real incident is happening, and if so, produce a structured incident report.

Return JSON only, matching this schema:

{
  "incidentDetected": boolean,
  "severity": "info" | "warning" | "critical",
  "hypothesis": string,
  "suggestedAction": "investigate" | "revert" | "flag_flip" | "none",
  "suggestedActionDetail": string,
  "title": string,
  "summary": string,
  "correlatedDeploymentId": string | null,
  "dedupeOfIssueNumber": number | null,
  "confidence": number
}

Rules:
- If no metric breaches a meaningful threshold and no novel exception pattern is present, return incidentDetected=false with confidence ≥ 0.8 and severity="info". All other fields can be empty strings or null.
- Only suggest "revert" if a recent deployment (< 60 minutes old) clearly correlates with the metric change.
- Only suggest "flag_flip" if the signal pack mentions a feature flag and the timing aligns.
- Otherwise default to "investigate".
- Be conservative. False positives are expensive — humans will be paged.
- Never invent metric values. Only reason about what is in the signal pack.
- Never recommend touching infrastructure outside the embr-pulse application.`;

export type Severity = "info" | "warning" | "critical";
export type SuggestedAction = "investigate" | "revert" | "flag_flip" | "none";

export interface MonitorResult {
  incidentDetected: boolean;
  severity: Severity;
  hypothesis: string;
  suggestedAction: SuggestedAction;
  suggestedActionDetail: string;
  title: string;
  summary: string;
  correlatedDeploymentId: string | null;
  dedupeOfIssueNumber: number | null;
  confidence: number;
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
  // Independent deployment from the triage agent — set MONITOR_FOUNDRY_DEPLOYMENT
  // to the published name of the embr-pulse-monitor agent.
  const deployment = process.env.MONITOR_FOUNDRY_DEPLOYMENT;
  if (!endpoint || !apiKey || !deployment) return null;
  return {
    endpoint,
    apiKey,
    deployment,
    apiVersion: process.env.FOUNDRY_API_VERSION ?? "2024-10-21",
  };
}

function resourceRoot(projectEndpoint: string): string {
  const m = projectEndpoint.match(/^(https:\/\/[^/]+)/);
  if (!m) throw new Error(`FOUNDRY_PROJECT_ENDPOINT does not look like a URL: ${projectEndpoint}`);
  return m[1];
}

function isMonitorResult(x: unknown): x is MonitorResult {
  if (typeof x !== "object" || x === null) return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.incidentDetected === "boolean" &&
    (r.severity === "info" || r.severity === "warning" || r.severity === "critical") &&
    typeof r.hypothesis === "string" &&
    (r.suggestedAction === "investigate" ||
      r.suggestedAction === "revert" ||
      r.suggestedAction === "flag_flip" ||
      r.suggestedAction === "none") &&
    typeof r.suggestedActionDetail === "string" &&
    typeof r.title === "string" &&
    typeof r.summary === "string" &&
    (r.correlatedDeploymentId === null || typeof r.correlatedDeploymentId === "string") &&
    (r.dedupeOfIssueNumber === null || typeof r.dedupeOfIssueNumber === "number") &&
    typeof r.confidence === "number"
  );
}

function normalize(r: MonitorResult): MonitorResult {
  return {
    incidentDetected: r.incidentDetected,
    severity: r.severity,
    hypothesis: clamp(r.hypothesis, 600),
    suggestedAction: r.suggestedAction,
    suggestedActionDetail: clamp(r.suggestedActionDetail, 400),
    title: clamp(r.title, 80),
    summary: clamp(r.summary, 600),
    correlatedDeploymentId: r.correlatedDeploymentId
      ? clamp(r.correlatedDeploymentId, 64)
      : null,
    dedupeOfIssueNumber:
      r.dedupeOfIssueNumber === null || !Number.isFinite(r.dedupeOfIssueNumber)
        ? null
        : Math.trunc(r.dedupeOfIssueNumber),
    confidence: Math.max(0, Math.min(1, r.confidence)),
  };
}

function clamp(s: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, max);
}

/**
 * Call the Foundry monitor agent. Returns null on any failure — never throws.
 *
 * @param signalPack The signal pack assembled by lib/signals.ts.
 * @param timeoutMs Hard deadline for the upstream call. Default 20s.
 * @param runId Correlation id (the system_events row id for this monitor run).
 */
export async function analyzeSignals(
  signalPack: SignalPack,
  timeoutMs = 20_000,
  runId?: string,
): Promise<MonitorResult | null> {
  const cfg = getConfig();
  if (!cfg) {
    log.info("monitor.skipped", { runId, reason: "foundry_not_configured" });
    return null;
  }

  const url = `${resourceRoot(cfg.endpoint)}/openai/deployments/${encodeURIComponent(cfg.deployment)}/chat/completions?api-version=${cfg.apiVersion}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const startedAt = Date.now();
  log.info("monitor.start", {
    runId,
    deployment: cfg.deployment,
    windowMinutes: signalPack.windowMinutes,
    feedbackCount: signalPack.metrics.feedbackCount,
    syntheticFailureCount: signalPack.metrics.syntheticFailureCount,
    totalSystemErrors: signalPack.metrics.totalSystemErrors,
    openIncidentCount: signalPack.openIncidents.length,
  });

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
          { role: "user", content: JSON.stringify(signalPack) },
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: 800,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      log.error("monitor.http_error", {
        runId,
        status: res.status,
        elapsedMs: Date.now() - startedAt,
        body: text.slice(0, 300),
      });
      return null;
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) {
      log.error("monitor.no_content", { runId, elapsedMs: Date.now() - startedAt });
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      log.error("monitor.parse_failed", {
        runId,
        elapsedMs: Date.now() - startedAt,
        message: (err as Error).message,
      });
      return null;
    }

    if (!isMonitorResult(parsed)) {
      log.error("monitor.shape_mismatch", {
        runId,
        elapsedMs: Date.now() - startedAt,
        sample: content.slice(0, 200),
      });
      return null;
    }

    const result = normalize(parsed);
    log.info("monitor.success", {
      runId,
      elapsedMs: Date.now() - startedAt,
      incidentDetected: result.incidentDetected,
      severity: result.severity,
      suggestedAction: result.suggestedAction,
      confidence: result.confidence,
      dedupeOf: result.dedupeOfIssueNumber,
      promptTokens: json.usage?.prompt_tokens,
      completionTokens: json.usage?.completion_tokens,
    });
    return result;
  } catch (err) {
    if ((err as { name?: string }).name === "AbortError") {
      log.error("monitor.timeout", { runId, elapsedMs: Date.now() - startedAt, timeoutMs });
    } else {
      log.error("monitor.threw", {
        runId,
        elapsedMs: Date.now() - startedAt,
        message: (err as Error).message,
      });
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
