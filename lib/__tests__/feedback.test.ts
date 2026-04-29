import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock is hoisted; the factory runs before module-scoped consts. Use
// vi.hoisted to make our mock fns available inside the factory.
const { mockQuery, mockClientQuery, mockRelease, mockConnect } = vi.hoisted(() => {
  const mockClientQuery = vi.fn();
  const mockRelease = vi.fn();
  const mockConnect = vi.fn(async () => ({
    query: mockClientQuery,
    release: mockRelease,
  }));
  return {
    mockQuery: vi.fn(),
    mockClientQuery,
    mockRelease,
    mockConnect,
  };
});

vi.mock("@/lib/db", () => ({
  pool: {
    query: mockQuery,
    connect: mockConnect,
  },
}));

import { listRecentFeedback, insertFeedback } from "../feedback";

const sampleDbRow = {
  id: "fbk_1",
  submitter_email: "alice@example.com",
  submitter_name: "Alice",
  title: "Title",
  body: "Body text",
  category: "bug" as const,
  status: "open" as const,
  github_issue_number: null,
  triage_summary: null,
  triage_confidence: null,
  shipped_at: null,
  created_at: new Date("2026-04-29T10:00:00Z"),
  updated_at: new Date("2026-04-29T10:00:00Z"),
};

describe("listRecentFeedback", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("maps snake_case DB rows to camelCase view objects", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [sampleDbRow] });
    const items = await listRecentFeedback(10);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "fbk_1",
      submitterEmail: "alice@example.com",
      submitterName: "Alice",
      githubIssueNumber: null,
      triageSummary: null,
    });
  });

  it("passes limit through to SQL", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await listRecentFeedback(7);
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("LIMIT $1"), [7]);
  });
});

describe("insertFeedback", () => {
  beforeEach(() => {
    mockClientQuery.mockReset();
    mockRelease.mockReset();
    mockConnect.mockClear();
  });

  it("inserts feedback + audit event in a transaction and never logs raw body", async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [sampleDbRow] }) // INSERT feedback
      .mockResolvedValueOnce({ rows: [] }) // INSERT feedback_events
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const row = await insertFeedback({
      submitterName: "Alice",
      submitterEmail: "alice@example.com",
      title: "Title",
      body: "This is the raw user body that must NOT appear in events",
      category: "bug",
    });

    expect(row.id).toBe("fbk_1");
    expect(mockClientQuery).toHaveBeenNthCalledWith(1, "BEGIN");
    expect(mockClientQuery.mock.calls[3][0]).toBe("COMMIT");
    expect(mockRelease).toHaveBeenCalledOnce();

    // Trust-boundary check: the audit event payload must not embed the raw body.
    const eventCall = mockClientQuery.mock.calls[2];
    const payloadJson = eventCall[1][1] as string;
    expect(payloadJson).not.toContain("raw user body");
    const payload = JSON.parse(payloadJson);
    expect(payload).toMatchObject({ category: "bug" });
    expect(payload.bodyLength).toBeGreaterThan(0);
  });

  it("rolls back the transaction on insert failure and releases the client", async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockRejectedValueOnce(new Error("constraint violation")) // INSERT fails
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    await expect(
      insertFeedback({
        submitterName: "A",
        submitterEmail: "a@b.com",
        title: "T",
        body: "Body content here",
        category: null,
      }),
    ).rejects.toThrow("constraint violation");

    expect(mockClientQuery).toHaveBeenNthCalledWith(3, "ROLLBACK");
    expect(mockRelease).toHaveBeenCalledOnce();
  });
});
