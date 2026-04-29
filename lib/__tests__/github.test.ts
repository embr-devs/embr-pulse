import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockIssuesCreate, mockCreateComment, mockGraphql, mockPoolQuery, MockOctokit } =
  vi.hoisted(() => {
    const mockIssuesCreate = vi.fn();
    const mockCreateComment = vi.fn();
    const mockGraphql = vi.fn();
    const mockPoolQuery = vi.fn().mockResolvedValue({ rows: [] });
    class MockOctokit {
      issues = { create: mockIssuesCreate, createComment: mockCreateComment };
      graphql = mockGraphql;
      constructor(_opts: unknown) {}
    }
    return { mockIssuesCreate, mockCreateComment, mockGraphql, mockPoolQuery, MockOctokit };
  });

vi.mock("@octokit/rest", () => ({ Octokit: MockOctokit }));
vi.mock("@/lib/db", () => ({ pool: { query: mockPoolQuery } }));

describe("github.ts", () => {
  const origToken = process.env.GITHUB_TOKEN;

  beforeEach(() => {
    mockIssuesCreate.mockReset();
    mockCreateComment.mockReset();
    mockGraphql.mockReset();
    mockPoolQuery.mockClear();
    vi.resetModules();
  });

  afterEach(() => {
    if (origToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = origToken;
  });

  describe("createFeedbackIssue", () => {
    it("returns null and skips Octokit when GITHUB_TOKEN is unset", async () => {
      delete process.env.GITHUB_TOKEN;
      const { createFeedbackIssue, __resetForTests } = await import("../github");
      __resetForTests();
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

    it("creates an issue with sanitized title + pulse-feedback label", async () => {
      process.env.GITHUB_TOKEN = "ghp_test";
      mockIssuesCreate.mockResolvedValueOnce({
        data: { number: 42, html_url: "https://github.com/seligj95/embr-pulse/issues/42", node_id: "I_node1" },
      });

      const { createFeedbackIssue, __resetForTests } = await import("../github");
      __resetForTests();
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
        nodeId: "I_node1",
      });
      const args = mockIssuesCreate.mock.calls[0][0];
      expect(args.title).toBe("Bug:  something");
      expect(args.labels).toEqual(["pulse-feedback", "pulse-bug"]);
      expect(args.body).toContain("- Submitter: Alice\n");
      expect(args.body).not.toContain("\u0000");
      expect(args.body).toContain("`fbk_1`");
    });

    it("body does NOT contain the triage block (it goes in a comment)", async () => {
      process.env.GITHUB_TOKEN = "ghp_test";
      mockIssuesCreate.mockResolvedValueOnce({
        data: { number: 1, html_url: "x", node_id: "I_n" },
      });
      const { createFeedbackIssue, __resetForTests } = await import("../github");
      __resetForTests();
      await createFeedbackIssue({
        feedbackId: "fbk_2",
        title: "T",
        body: "User-only body content",
        category: "bug",
        submitterName: "A",
        triage: {
          suggestedTitle: "Sharper title",
          suggestedLabels: ["bug", "pulse-feedback", "x"],
          summary: "This is the triage summary",
          confidence: 0.9,
          dedupeOfIssueNumber: null,
        },
      });
      const args = mockIssuesCreate.mock.calls[0][0];
      expect(args.body).toContain("User-only body content");
      expect(args.body).not.toContain("Triage summary");
      expect(args.body).not.toContain("This is the triage summary");
      // But triage labels and title still applied at issue creation time:
      expect(args.title).toBe("Sharper title");
      expect(args.labels).toEqual(["bug", "pulse-feedback", "x"]);
    });

    it("truncates very long bodies and adds an ellipsis marker", async () => {
      process.env.GITHUB_TOKEN = "ghp_test";
      mockIssuesCreate.mockResolvedValueOnce({
        data: { number: 1, html_url: "x", node_id: "I_n" },
      });
      const { createFeedbackIssue, __resetForTests } = await import("../github");
      __resetForTests();
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

  describe("postTriageComment", () => {
    it("posts an analysis comment with confidence + summary + labels", async () => {
      process.env.GITHUB_TOKEN = "ghp_test";
      mockCreateComment.mockResolvedValueOnce({ data: { id: 1 } });
      const { postTriageComment, __resetForTests } = await import("../github");
      __resetForTests();
      const ok = await postTriageComment("fbk_x", 99, {
        suggestedTitle: "T",
        suggestedLabels: ["bug", "pulse-feedback"],
        summary: "Concise problem statement",
        confidence: 0.92,
        dedupeOfIssueNumber: null,
      });
      expect(ok).toBe(true);
      expect(mockCreateComment).toHaveBeenCalledOnce();
      const args = mockCreateComment.mock.calls[0][0];
      expect(args.issue_number).toBe(99);
      expect(args.body).toContain("Triage analysis");
      expect(args.body).toContain("0.92");
      expect(args.body).toContain("Concise problem statement");
      expect(args.body).toContain("`bug`");
      // Inserts feedback_event row.
      expect(mockPoolQuery).toHaveBeenCalled();
      const sql = mockPoolQuery.mock.calls[0][0] as string;
      expect(sql).toContain("'commented'");
      expect(sql).toContain("'foundry'");
    });

    it("flags possible duplicates in the comment", async () => {
      process.env.GITHUB_TOKEN = "ghp_test";
      mockCreateComment.mockResolvedValueOnce({ data: { id: 1 } });
      const { postTriageComment, __resetForTests } = await import("../github");
      __resetForTests();
      await postTriageComment("fbk_x", 99, {
        suggestedTitle: "T",
        suggestedLabels: ["bug"],
        summary: "A summary",
        confidence: 0.85,
        dedupeOfIssueNumber: 7,
      });
      const args = mockCreateComment.mock.calls[0][0];
      expect(args.body).toContain("duplicate of #7");
    });

    it("flags low-confidence triage in the comment", async () => {
      process.env.GITHUB_TOKEN = "ghp_test";
      mockCreateComment.mockResolvedValueOnce({ data: { id: 1 } });
      const { postTriageComment, __resetForTests } = await import("../github");
      __resetForTests();
      await postTriageComment("fbk_x", 99, {
        suggestedTitle: "T",
        suggestedLabels: ["bug"],
        summary: "A summary",
        confidence: 0.3,
        dedupeOfIssueNumber: null,
      });
      const args = mockCreateComment.mock.calls[0][0];
      expect(args.body).toContain("Low confidence");
    });

    it("returns false and does not throw on API error", async () => {
      process.env.GITHUB_TOKEN = "ghp_test";
      mockCreateComment.mockRejectedValueOnce(new Error("rate limit"));
      const { postTriageComment, __resetForTests } = await import("../github");
      __resetForTests();
      const ok = await postTriageComment("fbk_x", 99, {
        suggestedTitle: "T",
        suggestedLabels: ["bug"],
        summary: "A summary",
        confidence: 0.8,
        dedupeOfIssueNumber: null,
      });
      expect(ok).toBe(false);
    });
  });

  describe("maybeAssignCopilot", () => {
    const baseIssue = { number: 10, url: "x", nodeId: "I_node10" };

    it("skips when triage is null", async () => {
      process.env.GITHUB_TOKEN = "ghp_test";
      const { maybeAssignCopilot, __resetForTests } = await import("../github");
      __resetForTests();
      const r = await maybeAssignCopilot("fbk_x", baseIssue, null);
      expect(r).toEqual({ assigned: false, reason: "no_triage" });
      expect(mockGraphql).not.toHaveBeenCalled();
    });

    it("skips when confidence is below threshold", async () => {
      process.env.GITHUB_TOKEN = "ghp_test";
      const { maybeAssignCopilot, __resetForTests } = await import("../github");
      __resetForTests();
      const r = await maybeAssignCopilot("fbk_x", baseIssue, {
        suggestedTitle: "T",
        suggestedLabels: ["bug"],
        summary: "S",
        confidence: 0.5,
        dedupeOfIssueNumber: null,
      });
      expect(r).toEqual({ assigned: false, reason: "low_confidence" });
      expect(mockGraphql).not.toHaveBeenCalled();
    });

    it("skips when triage thinks it's a duplicate", async () => {
      process.env.GITHUB_TOKEN = "ghp_test";
      const { maybeAssignCopilot, __resetForTests } = await import("../github");
      __resetForTests();
      const r = await maybeAssignCopilot("fbk_x", baseIssue, {
        suggestedTitle: "T",
        suggestedLabels: ["bug"],
        summary: "S",
        confidence: 0.95,
        dedupeOfIssueNumber: 5,
      });
      expect(r).toEqual({ assigned: false, reason: "duplicate_candidate" });
      expect(mockGraphql).not.toHaveBeenCalled();
    });

    it("skips when Copilot is not enabled on the repo", async () => {
      process.env.GITHUB_TOKEN = "ghp_test";
      mockGraphql.mockResolvedValueOnce({
        repository: { suggestedActors: { nodes: [] } },
      });
      const { maybeAssignCopilot, __resetForTests } = await import("../github");
      __resetForTests();
      const r = await maybeAssignCopilot("fbk_x", baseIssue, {
        suggestedTitle: "T",
        suggestedLabels: ["bug"],
        summary: "S",
        confidence: 0.9,
        dedupeOfIssueNumber: null,
      });
      expect(r).toEqual({ assigned: false, reason: "copilot_not_enabled" });
      // Only the lookup happened — no mutation.
      expect(mockGraphql).toHaveBeenCalledOnce();
    });

    it("assigns Copilot when high-confidence + non-duplicate + Copilot available", async () => {
      process.env.GITHUB_TOKEN = "ghp_test";
      mockGraphql
        .mockResolvedValueOnce({
          repository: {
            suggestedActors: {
              nodes: [{ __typename: "Bot", login: "Copilot", id: "BOT_copilot1" }],
            },
          },
        })
        .mockResolvedValueOnce({ replaceActorsForAssignable: { assignable: { number: 10 } } });

      const { maybeAssignCopilot, __resetForTests } = await import("../github");
      __resetForTests();
      const r = await maybeAssignCopilot("fbk_x", baseIssue, {
        suggestedTitle: "T",
        suggestedLabels: ["bug"],
        summary: "S",
        confidence: 0.95,
        dedupeOfIssueNumber: null,
      });
      expect(r).toEqual({ assigned: true, reason: "ok" });
      expect(mockGraphql).toHaveBeenCalledTimes(2);
      const mutationCall = mockGraphql.mock.calls[1];
      expect(mutationCall[0]).toContain("replaceActorsForAssignable");
      expect(mutationCall[1]).toEqual({
        assignableId: "I_node10",
        actorIds: ["BOT_copilot1"],
      });
      // Audit event written.
      const sqlCalls = mockPoolQuery.mock.calls.map((c) => c[0] as string);
      expect(sqlCalls.some((s) => s.includes("'assigned-copilot'"))).toBe(true);
    });

    it("returns failure on GraphQL error during assignment", async () => {
      process.env.GITHUB_TOKEN = "ghp_test";
      mockGraphql
        .mockResolvedValueOnce({
          repository: {
            suggestedActors: {
              nodes: [{ __typename: "Bot", login: "Copilot", id: "BOT_copilot1" }],
            },
          },
        })
        .mockRejectedValueOnce(new Error("forbidden"));

      const { maybeAssignCopilot, __resetForTests } = await import("../github");
      __resetForTests();
      const r = await maybeAssignCopilot("fbk_x", baseIssue, {
        suggestedTitle: "T",
        suggestedLabels: ["bug"],
        summary: "S",
        confidence: 0.95,
        dedupeOfIssueNumber: null,
      });
      expect(r).toEqual({ assigned: false, reason: "graphql_error" });
    });
  });
});
