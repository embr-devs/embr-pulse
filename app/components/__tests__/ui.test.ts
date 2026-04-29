import { describe, it, expect } from "vitest";
import { formatRelativeTime } from "@/lib/time";

const BASE = 1_000_000_000_000; // fixed epoch ms used throughout

describe("formatRelativeTime", () => {
  it("shows seconds when under a minute", () => {
    expect(formatRelativeTime(new Date(BASE), BASE + 30_000)).toBe("30s ago");
  });

  it("shows at least 1s ago for very recent or future dates", () => {
    expect(formatRelativeTime(new Date(BASE), BASE)).toBe("1s ago");
    // A date slightly in the future also clamps to 1s
    expect(formatRelativeTime(new Date(BASE), BASE - 5_000)).toBe("1s ago");
  });

  it("shows minutes when between 1 and 59 minutes ago", () => {
    expect(formatRelativeTime(new Date(BASE), BASE + 2 * 60_000)).toBe("2m ago");
  });

  it("shows hours when between 1 and 23 hours ago", () => {
    expect(formatRelativeTime(new Date(BASE), BASE + 5 * 3_600_000)).toBe("5h ago");
  });

  it("shows days when 24 or more hours ago", () => {
    expect(formatRelativeTime(new Date(BASE), BASE + 3 * 86_400_000)).toBe("3d ago");
  });

  it("uses Date.now() by default so real timestamps work", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000);
    expect(formatRelativeTime(twoHoursAgo)).toBe("2h ago");
  });
});
