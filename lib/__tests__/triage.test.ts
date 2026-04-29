import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ORIG_FETCH = global.fetch;

function setEnv() {
  process.env.FOUNDRY_PROJECT_ENDPOINT = "https://example.services.ai.azure.com/api/projects/proj";
  process.env.FOUNDRY_API_KEY = "test-key";
  process.env.FOUNDRY_MODEL_DEPLOYMENT = "gpt-test";
  process.env.FOUNDRY_API_VERSION = "2024-10-21";
}

function clearEnv() {
  delete process.env.FOUNDRY_PROJECT_ENDPOINT;
  delete process.env.FOUNDRY_API_KEY;
  delete process.env.FOUNDRY_MODEL_DEPLOYMENT;
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

describe("triageFeedback", () => {
  beforeEach(() => {
    clearEnv();
    vi.resetModules();
  });
  afterEach(() => {
    global.fetch = ORIG_FETCH;
  });

  const sampleInput = {
    title: "Loading spinner missing",
    body: "Feed area is blank on slow connections; should show a spinner.",
    category: "bug" as const,
    submitterName: "Test User",
    recentIssues: [],
  };

  it("returns null when env vars are unset", async () => {
    const { triageFeedback } = await import("../triage");
    const result = await triageFeedback(sampleInput);
    expect(result).toBeNull();
  });

  it("returns null when only some env vars are set", async () => {
    process.env.FOUNDRY_PROJECT_ENDPOINT = "https://e.test/api/projects/p";
    process.env.FOUNDRY_API_KEY = "k";
    // FOUNDRY_MODEL_DEPLOYMENT intentionally missing
    const { triageFeedback } = await import("../triage");
    const result = await triageFeedback(sampleInput);
    expect(result).toBeNull();
  });

  it("returns normalized result on a happy-path response", async () => {
    setEnv();
    mockFetchOnce({
      suggestedTitle: "Show loading spinner while feed loads",
      suggestedLabels: ["bug", "ui", "PULSE-feedback"], // case + dup test
      summary: "Feed is blank during slow loads; add a spinner.",
      confidence: 0.92,
      dedupeOfIssueNumber: null,
    });
    const { triageFeedback } = await import("../triage");
    const result = await triageFeedback(sampleInput);
    expect(result).not.toBeNull();
    expect(result!.suggestedTitle).toBe("Show loading spinner while feed loads");
    // pulse-feedback present, lowercase, dedupe applied
    expect(result!.suggestedLabels).toContain("pulse-feedback");
    expect(result!.suggestedLabels.filter((l) => l === "pulse-feedback")).toHaveLength(1);
    expect(result!.confidence).toBeCloseTo(0.92);
    expect(result!.dedupeOfIssueNumber).toBeNull();
  });

  it("calls the OpenAI surface, not the agents surface, with api-key header", async () => {
    setEnv();
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    global.fetch = vi.fn().mockImplementationOnce(async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedHeaders = init.headers as Record<string, string>;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({
            suggestedTitle: "x",
            suggestedLabels: ["pulse-feedback"],
            summary: "y",
            confidence: 0.8,
            dedupeOfIssueNumber: null,
          }) } }],
        }),
        text: async () => "",
      } as unknown as Response;
    });
    const { triageFeedback } = await import("../triage");
    await triageFeedback(sampleInput);
    expect(capturedUrl).toBe(
      "https://example.services.ai.azure.com/openai/deployments/gpt-test/chat/completions?api-version=2024-10-21",
    );
    expect(capturedHeaders["api-key"]).toBe("test-key");
  });

  it("inserts pulse-feedback if the model omits it", async () => {
    setEnv();
    mockFetchOnce({
      suggestedTitle: "x",
      suggestedLabels: ["bug"],
      summary: "y",
      confidence: 0.8,
      dedupeOfIssueNumber: null,
    });
    const { triageFeedback } = await import("../triage");
    const result = await triageFeedback(sampleInput);
    expect(result!.suggestedLabels[0]).toBe("pulse-feedback");
  });

  it("clamps confidence and trims oversized fields", async () => {
    setEnv();
    mockFetchOnce({
      suggestedTitle: "x".repeat(300),
      suggestedLabels: ["pulse-feedback"],
      summary: "y".repeat(500),
      confidence: 1.7,
      dedupeOfIssueNumber: null,
    });
    const { triageFeedback } = await import("../triage");
    const result = await triageFeedback(sampleInput);
    expect(result!.suggestedTitle.length).toBeLessThanOrEqual(140);
    expect(result!.summary.length).toBeLessThanOrEqual(240);
    expect(result!.confidence).toBe(1);
  });

  it("returns null when the model returns malformed JSON", async () => {
    setEnv();
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "not json {{" } }] }),
      text: async () => "",
    } as unknown as Response);
    const { triageFeedback } = await import("../triage");
    const result = await triageFeedback(sampleInput);
    expect(result).toBeNull();
  });

  it("returns null when shape doesn't match", async () => {
    setEnv();
    mockFetchOnce({ wrong: "shape" });
    const { triageFeedback } = await import("../triage");
    const result = await triageFeedback(sampleInput);
    expect(result).toBeNull();
  });

  it("returns null on HTTP error", async () => {
    setEnv();
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
      text: async () => "boom",
    } as unknown as Response);
    const { triageFeedback } = await import("../triage");
    const result = await triageFeedback(sampleInput);
    expect(result).toBeNull();
  });

  it("returns null on timeout", async () => {
    setEnv();
    global.fetch = vi.fn().mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          (init.signal as AbortSignal).addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );
    const { triageFeedback } = await import("../triage");
    const result = await triageFeedback(sampleInput, 50);
    expect(result).toBeNull();
  });
});
