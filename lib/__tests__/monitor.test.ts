import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SignalPack } from "../signals";

const ORIG_FETCH = global.fetch;

const sampleSignalPack: SignalPack = {
  windowMinutes: 30,
  generatedAt: "2026-04-30T00:00:00Z",
  syntheticFailureFlagOn: true,
  metrics: {
    feedbackCount: 5,
    triageFailureCount: 1,
    issueCreationFailureCount: 0,
    syntheticFailureCount: 3,
    totalSystemErrors: 4,
  },
  recentEvents: [
    { at: "2026-04-30T00:00:00Z", type: "synthetic_failure_injected", source: "system", summary: "" },
  ],
  recentDeployments: [{ sha: "abc1234", message: "", at: "2026-04-29T23:00:00Z" }],
  openIncidents: [],
};

function setEnv() {
  process.env.FOUNDRY_PROJECT_ENDPOINT = "https://example.services.ai.azure.com/api/projects/proj";
  process.env.FOUNDRY_API_KEY = "test-key";
  process.env.MONITOR_FOUNDRY_DEPLOYMENT = "embr-pulse-monitor";
  process.env.FOUNDRY_API_VERSION = "2024-10-21";
}

function clearEnv() {
  delete process.env.FOUNDRY_PROJECT_ENDPOINT;
  delete process.env.FOUNDRY_API_KEY;
  delete process.env.MONITOR_FOUNDRY_DEPLOYMENT;
  delete process.env.FOUNDRY_API_VERSION;
}

function mockFetchOnce(content: unknown, ok = true, status = 200) {
  const body = ok && typeof content === "object"
    ? { choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] }
    : content;
  global.fetch = vi.fn().mockResolvedValueOnce({
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as unknown as Response);
}

describe("analyzeSignals", () => {
  beforeEach(() => {
    clearEnv();
    vi.resetModules();
  });
  afterEach(() => {
    global.fetch = ORIG_FETCH;
  });

  it("returns null when env vars are unset", async () => {
    const { analyzeSignals } = await import("../monitor");
    const result = await analyzeSignals(sampleSignalPack);
    expect(result).toBeNull();
  });

  it("returns null when MONITOR_FOUNDRY_DEPLOYMENT is missing but other vars set", async () => {
    process.env.FOUNDRY_PROJECT_ENDPOINT = "https://e.test/api/projects/p";
    process.env.FOUNDRY_API_KEY = "k";
    const { analyzeSignals } = await import("../monitor");
    const result = await analyzeSignals(sampleSignalPack);
    expect(result).toBeNull();
  });

  it("normalizes and clamps confidence + severity", async () => {
    setEnv();
    mockFetchOnce({
      incidentDetected: true,
      severity: "critical",
      hypothesis: "Spike in synthetic_failure_injected events suggests a bad deploy.",
      suggestedAction: "investigate",
      suggestedActionDetail: "Check recent deploy abc1234.",
      title: "Synthetic failure spike",
      summary: "3 synthetic failures in last 30 minutes",
      correlatedDeploymentId: "abc1234",
      dedupeOfIssueNumber: null,
      confidence: 1.4,
    });

    const { analyzeSignals } = await import("../monitor");
    const result = await analyzeSignals(sampleSignalPack);
    expect(result).not.toBeNull();
    expect(result!.incidentDetected).toBe(true);
    expect(result!.severity).toBe("critical");
    expect(result!.suggestedAction).toBe("investigate");
    expect(result!.confidence).toBeLessThanOrEqual(1);
    expect(result!.confidence).toBeGreaterThanOrEqual(0);
    expect(result!.title).toBeTruthy();
  });

  it("returns null on malformed agent output", async () => {
    setEnv();
    mockFetchOnce({ totally: "wrong shape" });
    const { analyzeSignals } = await import("../monitor");
    const result = await analyzeSignals(sampleSignalPack);
    expect(result).toBeNull();
  });

  it("returns null when fetch fails (non-2xx)", async () => {
    setEnv();
    mockFetchOnce("server error", false, 500);
    const { analyzeSignals } = await import("../monitor");
    const result = await analyzeSignals(sampleSignalPack);
    expect(result).toBeNull();
  });

  it("accepts a no-incident response", async () => {
    setEnv();
    mockFetchOnce({
      incidentDetected: false,
      severity: "info",
      hypothesis: "Baseline traffic — nothing anomalous.",
      suggestedAction: "none",
      suggestedActionDetail: "",
      title: "",
      summary: "",
      correlatedDeploymentId: null,
      dedupeOfIssueNumber: null,
      confidence: 0.9,
    });
    const { analyzeSignals } = await import("../monitor");
    const result = await analyzeSignals(sampleSignalPack);
    expect(result).not.toBeNull();
    expect(result!.incidentDetected).toBe(false);
  });
});
