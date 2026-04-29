import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

const { mockQuery, mockConnect, mockClient } = vi.hoisted(() => {
  const client = {
    query: vi.fn(),
    release: vi.fn(),
  };
  return {
    mockClient: client,
    mockQuery: client.query,
    mockConnect: vi.fn(async () => client),
  };
});

vi.mock("@/lib/db", () => ({
  pool: { connect: mockConnect },
}));

const SECRET = "test-secret-pad-12345";

function sign(rawBody: string): string {
  return "sha256=" + createHmac("sha256", SECRET).update(rawBody).digest("hex");
}

describe("verifyAndParse", () => {
  let verifyAndParse: typeof import("../webhooks/github").verifyAndParse;

  beforeEach(async () => {
    vi.resetModules();
    ({ verifyAndParse } = await import("../webhooks/github"));
  });

  it("accepts a correctly signed body", () => {
    const body = JSON.stringify({ action: "closed" });
    const result = verifyAndParse(body, sign(body), "issues", "abc-123", SECRET);
    expect(result).not.toBeNull();
    expect(result?.event).toBe("issues");
    expect(result?.deliveryId).toBe("abc-123");
  });

  it("rejects a missing signature", () => {
    expect(verifyAndParse("{}", null, "issues", "abc", SECRET)).toBeNull();
  });

  it("rejects a tampered body", () => {
    const body = JSON.stringify({ action: "closed" });
    const sig = sign(body);
    const tampered = body.replace("closed", "opened");
    expect(verifyAndParse(tampered, sig, "issues", "abc", SECRET)).toBeNull();
  });

  it("rejects when secret is empty", () => {
    const body = "{}";
    expect(verifyAndParse(body, sign(body), "issues", "abc", "")).toBeNull();
  });

  it("rejects malformed JSON even if signature matches", () => {
    const body = "not json {{{";
    expect(verifyAndParse(body, sign(body), "issues", "abc", SECRET)).toBeNull();
  });
});

describe("handleVerifiedEvent", () => {
  let handleVerifiedEvent: typeof import("../webhooks/github").handleVerifiedEvent;

  beforeEach(async () => {
    vi.resetModules();
    mockQuery.mockReset();
    mockClient.release.mockReset();
    mockConnect.mockClear();
    ({ handleVerifiedEvent } = await import("../webhooks/github"));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("ignores non-issue events", async () => {
    const result = await handleVerifiedEvent({
      event: "push",
      deliveryId: "d1",
      payload: {},
    });
    expect(result).toEqual({ kind: "ignored", reason: "event=push" });
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("ignores issue events with unsupported actions", async () => {
    const result = await handleVerifiedEvent({
      event: "issues",
      deliveryId: "d1",
      payload: { action: "labeled", issue: { number: 1 } },
    });
    expect(result).toEqual({ kind: "ignored", reason: "action=labeled" });
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("flips matching feedback to shipped on issues.closed", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (/^BEGIN/.test(sql)) return { rowCount: 0, rows: [] };
      if (/UPDATE feedback/.test(sql)) {
        return { rowCount: 1, rows: [{ id: "fb-1" }] };
      }
      if (/INSERT INTO feedback_events/.test(sql)) return { rowCount: 1, rows: [] };
      if (/^COMMIT/.test(sql)) return { rowCount: 0, rows: [] };
      return { rowCount: 0, rows: [] };
    });

    const result = await handleVerifiedEvent({
      event: "issues",
      deliveryId: "d-shipped",
      payload: { action: "closed", issue: { number: 7 } },
    });

    expect(result).toEqual({ kind: "applied", feedbackId: "fb-1", newStatus: "shipped" });

    // Verify status param was 'shipped' on the UPDATE
    const updateCall = mockQuery.mock.calls.find((c) =>
      typeof c[0] === "string" && /UPDATE feedback/.test(c[0]),
    );
    expect(updateCall?.[1]).toEqual([7, "shipped"]);

    // Verify audit event captured the right type
    const insertCall = mockQuery.mock.calls.find((c) =>
      typeof c[0] === "string" && /INSERT INTO feedback_events/.test(c[0]),
    );
    expect(insertCall?.[1]?.[1]).toBe("issue_closed");

    expect(mockClient.release).toHaveBeenCalledOnce();
  });

  it("returns no_match when issue number isn't in our DB", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (/^BEGIN/.test(sql)) return { rowCount: 0, rows: [] };
      if (/UPDATE feedback/.test(sql)) return { rowCount: 0, rows: [] };
      if (/^COMMIT/.test(sql)) return { rowCount: 0, rows: [] };
      if (/SELECT id FROM feedback/.test(sql)) return { rowCount: 0, rows: [] };
      return { rowCount: 0, rows: [] };
    });

    const result = await handleVerifiedEvent({
      event: "issues",
      deliveryId: "d-nomatch",
      payload: { action: "closed", issue: { number: 999 } },
    });
    expect(result).toEqual({ kind: "no_match", issueNumber: 999 });
  });

  it("is idempotent on redelivery (already shipped)", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (/^BEGIN/.test(sql)) return { rowCount: 0, rows: [] };
      if (/UPDATE feedback/.test(sql)) return { rowCount: 0, rows: [] };
      if (/^COMMIT/.test(sql)) return { rowCount: 0, rows: [] };
      if (/SELECT id FROM feedback/.test(sql)) {
        return { rowCount: 1, rows: [{ id: "fb-1" }] };
      }
      return { rowCount: 0, rows: [] };
    });

    const result = await handleVerifiedEvent({
      event: "issues",
      deliveryId: "d-redeliver",
      payload: { action: "closed", issue: { number: 7 } },
    });
    expect(result).toEqual({ kind: "ignored", reason: "already shipped" });

    // No INSERT into feedback_events on redelivery
    const insertCall = mockQuery.mock.calls.find((c) =>
      typeof c[0] === "string" && /INSERT INTO feedback_events/.test(c[0]),
    );
    expect(insertCall).toBeUndefined();
  });

  it("flips back to in-triage on issues.reopened", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (/^BEGIN/.test(sql)) return { rowCount: 0, rows: [] };
      if (/UPDATE feedback/.test(sql)) {
        return { rowCount: 1, rows: [{ id: "fb-1" }] };
      }
      if (/INSERT INTO feedback_events/.test(sql)) return { rowCount: 1, rows: [] };
      if (/^COMMIT/.test(sql)) return { rowCount: 0, rows: [] };
      return { rowCount: 0, rows: [] };
    });

    const result = await handleVerifiedEvent({
      event: "issues",
      deliveryId: "d-reopen",
      payload: { action: "reopened", issue: { number: 7 } },
    });
    expect(result).toEqual({ kind: "applied", feedbackId: "fb-1", newStatus: "in-triage" });

    const insertCall = mockQuery.mock.calls.find((c) =>
      typeof c[0] === "string" && /INSERT INTO feedback_events/.test(c[0]),
    );
    expect(insertCall?.[1]?.[1]).toBe("issue_reopened");
  });

  it("rolls back transaction on DB failure", async () => {
    let stage = 0;
    mockQuery.mockImplementation(async (sql: string) => {
      if (/^BEGIN/.test(sql)) {
        stage = 1;
        return { rowCount: 0, rows: [] };
      }
      if (/UPDATE feedback/.test(sql)) {
        throw new Error("simulated DB failure");
      }
      if (/^ROLLBACK/.test(sql)) {
        stage = 99;
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    });

    await expect(
      handleVerifiedEvent({
        event: "issues",
        deliveryId: "d-fail",
        payload: { action: "closed", issue: { number: 7 } },
      }),
    ).rejects.toThrow("simulated DB failure");

    expect(stage).toBe(99);
    expect(mockClient.release).toHaveBeenCalledOnce();
  });
});
