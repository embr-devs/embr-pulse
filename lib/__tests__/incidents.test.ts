import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { MonitorResult } from "../monitor";
import type { SignalPack } from "../signals";

const { mockIssuesCreate, mockCreateComment, mockPoolQuery, MockOctokit } = vi.hoisted(() => {
  const mockIssuesCreate = vi.fn();
  const mockCreateComment = vi.fn();
  const mockPoolQuery = vi.fn().mockResolvedValue({ rows: [] });
  class MockOctokit {
    issues = { create: mockIssuesCreate, createComment: mockCreateComment };
    constructor(_opts: unknown) {}
  }
  return { mockIssuesCreate, mockCreateComment, mockPoolQuery, MockOctokit };
});

vi.mock("@octokit/rest", () => ({ Octokit: MockOctokit }));
vi.mock("@/lib/db", () => ({ pool: { query: mockPoolQuery } }));

const samplePack: SignalPack = {
  windowMinutes: 30,
  generatedAt: "2026-04-30T00:00:00Z",
  syntheticFailureFlagOn: true,
  metrics: {
    feedbackCount: 5,
    triageFailureCount: 0,
    issueCreationFailureCount: 0,
    syntheticFailureCount: 4,
    totalSystemErrors: 4,
  },
  recentEvents: [
    { at: "2026-04-30T00:00:00Z", type: "synthetic_failure_injected", source: "system", summary: "" },
  ],
  recentDeployments: [],
  openIncidents: [],
};

const sampleResult: MonitorResult = {
  incidentDetected: true,
  severity: "warning",
  hypothesis: "Synthetic failures spiking.",
  suggestedAction: "investigate",
  suggestedActionDetail: "Check feedback endpoint.",
  title: "Synthetic failure spike",
  summary: "4 in last 30 min",
  correlatedDeploymentId: null,
  dedupeOfIssueNumber: null,
  confidence: 0.85,
};

describe("createIncidentIssue", () => {
  const origToken = process.env.GITHUB_TOKEN;

  beforeEach(() => {
    mockIssuesCreate.mockReset();
    mockCreateComment.mockReset();
    mockPoolQuery.mockReset();
    mockPoolQuery.mockResolvedValue({ rows: [{ id: "inc_1" }] });
    vi.resetModules();
  });

  afterEach(() => {
    if (origToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = origToken;
  });

  it("returns null when GITHUB_TOKEN is unset", async () => {
    delete process.env.GITHUB_TOKEN;
    const { createIncidentIssue, __resetForTests } = await import("../incidents");
    __resetForTests();
    const result = await createIncidentIssue(sampleResult, samplePack);
    expect(result).toBeNull();
    expect(mockIssuesCreate).not.toHaveBeenCalled();
  });

  it("creates an issue with incident + severity labels and persists row", async () => {
    process.env.GITHUB_TOKEN = "ghp_test";
    mockIssuesCreate.mockResolvedValueOnce({
      data: { number: 99, html_url: "https://github.com/seligj95/embr-pulse/issues/99" },
    });

    const { createIncidentIssue, __resetForTests } = await import("../incidents");
    __resetForTests();
    const result = await createIncidentIssue(sampleResult, samplePack, "run-xyz");

    expect(result).not.toBeNull();
    expect(result!.issueNumber).toBe(99);
    expect(result!.id).toBe("inc_1");

    const args = mockIssuesCreate.mock.calls[0][0];
    expect(args.title).toMatch(/^\[INCIDENT\]/);
    expect(args.labels).toEqual(["incident", "severity-warning"]);
    expect(args.body).toContain("Hypothesis");
    expect(args.body).toContain("Signal summary");
    expect(args.body).toContain("synthetic_failure_injected");

    // INSERT into incidents + INSERT into system_events => 2 calls
    expect(mockPoolQuery).toHaveBeenCalledTimes(2);
    const incInsertSql = mockPoolQuery.mock.calls[0][0];
    expect(incInsertSql).toContain("INSERT INTO incidents");
    const eventInsertSql = mockPoolQuery.mock.calls[1][0];
    expect(eventInsertSql).toContain("INSERT INTO system_events");
  });

  it("adds auto-fix-candidate label when suggestedAction is revert", async () => {
    process.env.GITHUB_TOKEN = "ghp_test";
    mockIssuesCreate.mockResolvedValueOnce({
      data: { number: 100, html_url: "https://github.com/x/y/issues/100" },
    });

    const { createIncidentIssue, __resetForTests } = await import("../incidents");
    __resetForTests();
    await createIncidentIssue(
      { ...sampleResult, suggestedAction: "revert", severity: "critical" },
      samplePack,
    );

    const args = mockIssuesCreate.mock.calls[0][0];
    expect(args.labels).toContain("auto-fix-candidate");
    expect(args.labels).toContain("severity-critical");
  });

  it("comments on existing issue when dedupeOfIssueNumber is set", async () => {
    process.env.GITHUB_TOKEN = "ghp_test";
    mockCreateComment.mockResolvedValueOnce({ data: {} });

    const { createIncidentIssue, __resetForTests } = await import("../incidents");
    __resetForTests();
    const result = await createIncidentIssue(
      { ...sampleResult, dedupeOfIssueNumber: 42 },
      samplePack,
    );

    expect(result).toBeNull();
    expect(mockIssuesCreate).not.toHaveBeenCalled();
    expect(mockCreateComment).toHaveBeenCalledTimes(1);
    const args = mockCreateComment.mock.calls[0][0];
    expect(args.issue_number).toBe(42);
    expect(args.body).toContain("Monitor still seeing the same signal");
  });
});
