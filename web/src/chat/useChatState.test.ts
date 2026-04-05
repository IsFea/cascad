import { describe, expect, it } from "vitest";
import { upsertMessages } from "./useChatState";
import { ChannelMessageDto } from "../types";

function makeMessage(id: string, createdAtUtc: string): ChannelMessageDto {
  return {
    id,
    channelId: "channel-1",
    userId: "user-1",
    username: "alice",
    avatarUrl: null,
    content: `message-${id}`,
    createdAtUtc,
    attachments: [],
    mentions: [],
  };
}

describe("upsertMessages", () => {
  it("deduplicates messages by id", () => {
    const first = makeMessage("m1", "2026-04-05T12:00:00.000Z");
    const replacement = { ...first, content: "updated" };

    const result = upsertMessages([first], [replacement]);
    expect(result).toHaveLength(1);
    expect(result[0]?.content).toBe("updated");
  });

  it("keeps ascending chronological order after merge", () => {
    const older = makeMessage("m1", "2026-04-05T12:00:00.000Z");
    const newer = makeMessage("m2", "2026-04-05T12:00:01.000Z");

    const result = upsertMessages([newer], [older]);
    expect(result.map((x) => x.id)).toEqual(["m1", "m2"]);
  });
});
