import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockIssuesCreate, MockOctokit } = vi.hoisted(() => {
  const mockIssuesCreate = vi.fn();
  // Octokit is invoked with `new`, so use a real class — vi.fn().mockImpl
  // returns an arrow function which is not a constructor.
  class MockOctokit {
    issues = { create: mockIssuesCreate };
    constructor(_opts: unknown) {}
  }
  return { mockIssuesCreate, MockOctokit };
});

vi.mock("@octokit/rest", () => ({ Octokit: MockOctokit }));

vi.mock("@/lib/db", () => ({
  pool: { query: vi.fn() },
}));

describe("createFeedbackIssue", () => {
  const origToken = process.env.GITHUB_TOKEN;

  beforeEach(() => {
    mockIssuesCreate.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    if (origToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = origToken;
  });

  it("returns null and skips Octokit when GITHUB_TOKEN is unset", async () => {
    delete process.env.GITHUB_TOKEN;
    const { createFeedbackIssue } = await import("../github");
    const result = await createFeedbackIssue({
      feedbackId: "fbk_1",
      title: "T",
      body: "B",
      category: "bug",
      submitterName: "Alice",
    });
    expect(result).toBeNull();
    expect(mockIssuesCreate).not.toHaveBeenCalled();
  });

  it("creates an issue with sanitized title + pulse-feedback label when token present", async () => {
    process.env.GITHUB_TOKEN = "ghp_test";
    mockIssuesCreate.mockResolvedValueOnce({
      data: { number: 42, html_url: "https://github.com/seligj95/embr-pulse/issues/42" },
    });

    const { createFeedbackIssue } = await import("../github");
    const result = await createFeedbackIssue({
      feedbackId: "fbk_1",
      title: "Bug:\u0001 something\u0007",
      body: "Body content",
      category: "bug",
      submitterName: "Alice\u0000",
    });

    expect(result).toEqual({
      number: 42,
      url: "https://github.com/seligj95/embr-pulse/issues/42",
    });
    expect(mockIssuesCreate).toHaveBeenCalledOnce();
    const args = mockIssuesCreate.mock.calls[0][0];
    expect(args.title).toBe("Bug:  something");
    expect(args.labels).toEqual(["pulse-feedback", "pulse-bug"]);
    // User-provided submitter name had a null byte — must be stripped from the body header.
    expect(args.body).toContain("- Submitter: Alice\n");
    expect(args.body).not.toContain("\u0000");
    expect(args.body).toContain("`fbk_1`");
  });

  it("truncates very long bodies and adds an ellipsis marker", async () => {
    process.env.GITHUB_TOKEN = "ghp_test";
    mockIssuesCreate.mockResolvedValueOnce({
      data: { number: 1, html_url: "x" },
    });
    const { createFeedbackIssue } = await import("../github");
    const longBody = "x".repeat(9000);
    await createFeedbackIssue({
      feedbackId: "fbk_2",
      title: "T",
      body: longBody,
      category: null,
      submitterName: "A",
    });
    const args = mockIssuesCreate.mock.calls[0][0];
    expect(args.body).toContain("(truncated)");
    expect(args.body.length).toBeLessThan(longBody.length);
  });
});
