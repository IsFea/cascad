import { describe, expect, it } from "vitest";
import { ChannelMessageDto } from "../types";
import { buildMessageTimeline } from "./messageTimeline";

function makeMessage(id: string, userId: string, createdAtUtc: string): ChannelMessageDto {
  return {
    id,
    channelId: "ch",
    userId,
    username: userId,
    avatarUrl: null,
    content: id,
    createdAtUtc,
    attachments: [],
    mentions: [],
  };
}

describe("buildMessageTimeline", () => {
  it("groups consecutive messages from same user within 5 minutes", () => {
    const messages = [
      makeMessage("m1", "u1", "2026-04-05T10:00:00.000Z"),
      makeMessage("m2", "u1", "2026-04-05T10:03:00.000Z"),
      makeMessage("m3", "u2", "2026-04-05T10:04:00.000Z"),
    ];

    const timeline = buildMessageTimeline(messages, Date.parse("2026-04-05T12:00:00.000Z"));
    const items = timeline.filter((item) => item.kind === "message");
    expect(items).toHaveLength(3);
    expect(items[0]?.showHeader).toBe(true);
    expect(items[1]?.showHeader).toBe(false);
    expect(items[2]?.showHeader).toBe(true);
  });

  it("inserts date separators on day boundaries", () => {
    const now = Date.parse("2026-04-05T12:00:00.000Z");
    const messages = [
      makeMessage("m1", "u1", new Date(now - 30 * 60 * 60 * 1000).toISOString()),
      makeMessage("m2", "u1", new Date(now - 2 * 60 * 60 * 1000).toISOString()),
    ];

    const timeline = buildMessageTimeline(messages, now);
    const separators = timeline.filter((item) => item.kind === "separator");
    expect(separators).toHaveLength(2);
  });
});
