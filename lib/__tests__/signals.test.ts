import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPoolQuery } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ pool: { query: mockPoolQuery } }));

describe("signals.assembleSignalPack", () => {
  beforeEach(() => {
    mockPoolQuery.mockReset();
    vi.resetModules();
    delete process.env.EMBR_PULSE_SIMULATE_FAILURE;
  });

  function queueQueryResults(rowsList: unknown[][]) {
    for (const rows of rowsList) {
      mockPoolQuery.mockResolvedValueOnce({ rows });
    }
  }

  it("aggregates metrics, dedupes recent events, and reports flag state", async () => {
    process.env.EMBR_PULSE_SIMULATE_FAILURE = "true";

    queueQueryResults([
      // feedback aggregate
      [{ feedback_count: 5, triage_failure_count: 1, issue_creation_failure_count: 0 }],
      // system error counters
      [{ synthetic_failure_count: 2, total_system_errors: 3 }],
      // recent system events
      [
        { type: "synthetic_failure_injected", payload_json: { titleLen: 10 }, created_at: new Date("2026-04-30T00:00:00Z") },
      ],
      // recent feedback events (errors)
      [
        { type: "issue_creation_failed", source: "feedback", payload_json: { message: "boom" }, created_at: new Date("2026-04-30T00:01:00Z") },
      ],
      // recent deployments
      [{ commit_sha: "abc1234567", deployed_at: new Date("2026-04-29T23:00:00Z"), created_at: new Date("2026-04-29T23:00:00Z") }],
      // open incidents
      [{ github_issue_number: 7, signal_summary: "Past incident", detected_at: new Date("2026-04-29T22:00:00Z") }],
    ]);

    const { assembleSignalPack } = await import("../signals");
    const pack = await assembleSignalPack({ windowMinutes: 10 });

    expect(pack.windowMinutes).toBe(10);
    expect(pack.syntheticFailureFlagOn).toBe(true);
    expect(pack.metrics).toEqual({
      feedbackCount: 5,
      triageFailureCount: 1,
      issueCreationFailureCount: 0,
      syntheticFailureCount: 2,
      totalSystemErrors: 3,
    });
    expect(pack.recentEvents).toHaveLength(2);
    expect(pack.recentEvents[0]).toMatchObject({
      type: expect.any(String),
      source: expect.any(String),
    });
    expect(pack.recentDeployments[0].sha).toBe("abc1234");
    expect(pack.openIncidents).toEqual([
      { number: 7, title: "Past incident", createdAt: "2026-04-29T22:00:00.000Z" },
    ]);
  });

  it("treats syntheticFailureFlagOn as false when env is unset", async () => {
    queueQueryResults([
      [{ feedback_count: 0, triage_failure_count: 0, issue_creation_failure_count: 0 }],
      [{ synthetic_failure_count: 0, total_system_errors: 0 }],
      [],
      [],
      [],
      [],
    ]);

    const { assembleSignalPack } = await import("../signals");
    const pack = await assembleSignalPack();
    expect(pack.syntheticFailureFlagOn).toBe(false);
    expect(pack.metrics.feedbackCount).toBe(0);
    expect(pack.recentEvents).toEqual([]);
  });

  it("filters out open incidents with null github_issue_number", async () => {
    queueQueryResults([
      [{ feedback_count: 0, triage_failure_count: 0, issue_creation_failure_count: 0 }],
      [{ synthetic_failure_count: 0, total_system_errors: 0 }],
      [],
      [],
      [],
      [
        { github_issue_number: null, signal_summary: "orphan", detected_at: new Date() },
        { github_issue_number: 12, signal_summary: "real", detected_at: new Date("2026-04-30T00:00:00Z") },
      ],
    ]);

    const { assembleSignalPack } = await import("../signals");
    const pack = await assembleSignalPack();
    expect(pack.openIncidents).toHaveLength(1);
    expect(pack.openIncidents[0].number).toBe(12);
  });
});

describe("signals.recordSystemEvent", () => {
  beforeEach(() => {
    mockPoolQuery.mockReset();
    vi.resetModules();
  });

  it("inserts into system_events with JSON payload", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });
    const { recordSystemEvent } = await import("../signals");
    await recordSystemEvent("monitor_run", { runId: "abc", n: 1 });
    expect(mockPoolQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockPoolQuery.mock.calls[0];
    expect(sql).toContain("INSERT INTO system_events");
    expect(params[0]).toBe("monitor_run");
    expect(JSON.parse(params[1])).toEqual({ runId: "abc", n: 1 });
  });
});
