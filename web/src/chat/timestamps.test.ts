import { describe, expect, it } from "vitest";
import { formatDateSeparatorLabel, formatFullMessageTime, formatRelativeMessageTime } from "./timestamps";

describe("timestamps", () => {
  it("formats relative labels for fresh timestamps", () => {
    const now = Date.parse("2026-04-05T12:00:00.000Z");
    expect(formatRelativeMessageTime("2026-04-05T11:59:40.000Z", now)).toBe("now");
    expect(formatRelativeMessageTime("2026-04-05T11:45:00.000Z", now)).toBe("15m");
    expect(formatRelativeMessageTime("2026-04-05T09:00:00.000Z", now)).toBe("3h");
  });

  it("formats date separators as today and yesterday", () => {
    const now = Date.parse("2026-04-05T12:00:00.000Z");
    const todaySample = new Date(now - 2 * 60 * 60 * 1000);
    const yesterdaySample = new Date(now - 26 * 60 * 60 * 1000);
    expect(formatDateSeparatorLabel(todaySample, now)).toBe("Today");
    expect(formatDateSeparatorLabel(yesterdaySample, now)).toBe("Yesterday");
  });

  it("returns a full timestamp string", () => {
    const full = formatFullMessageTime("2026-04-05T10:30:00.000Z");
    expect(full.length).toBeGreaterThan(0);
    expect(full).not.toContain("Invalid");
  });
});
