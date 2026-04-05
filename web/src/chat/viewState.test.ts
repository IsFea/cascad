import { describe, expect, it } from "vitest";
import {
  ChatViewStateMap,
  getWorkspaceUnreadCount,
  incrementChannelUnread,
  markChannelRead,
  parseChatViewState,
  syncChatViewStateFromServer,
  setChannelIsAtBottom,
  stringifyChatViewState,
} from "./viewState";

describe("chat view state", () => {
  it("increments unread and keeps first unread id", () => {
    let state: ChatViewStateMap = {};
    state = incrementChannelUnread(state, "ch-1", "m-1");
    state = incrementChannelUnread(state, "ch-1", "m-2");

    expect(state["ch-1"]?.unreadCount).toBe(2);
    expect(state["ch-1"]?.firstUnreadMessageId).toBe("m-1");
    expect(state["ch-1"]?.isAtBottom).toBe(false);
  });

  it("marks channel read and resets unread marker", () => {
    let state: ChatViewStateMap = {};
    state = incrementChannelUnread(state, "ch-1", "m-1");
    state = markChannelRead(state, "ch-1", "2026-04-05T12:00:00.000Z");

    expect(state["ch-1"]?.unreadCount).toBe(0);
    expect(state["ch-1"]?.firstUnreadMessageId).toBeNull();
    expect(state["ch-1"]?.lastReadAtUtc).toBe("2026-04-05T12:00:00.000Z");
    expect(state["ch-1"]?.isAtBottom).toBe(true);
  });

  it("toggles isAtBottom and aggregates workspace unread", () => {
    let state: ChatViewStateMap = {};
    state = incrementChannelUnread(state, "ch-1", "m-1");
    state = incrementChannelUnread(state, "ch-2", "m-2");
    state = setChannelIsAtBottom(state, "ch-2", true);

    expect(state["ch-2"]?.isAtBottom).toBe(true);
    expect(getWorkspaceUnreadCount(state)).toBe(2);
  });

  it("serializes and parses persisted state", () => {
    let state: ChatViewStateMap = {};
    state = incrementChannelUnread(state, "ch-1", "m-1");
    const raw = stringifyChatViewState(state);
    const parsed = parseChatViewState(raw);
    expect(parsed["ch-1"]?.unreadCount).toBe(1);
    expect(parsed["ch-1"]?.firstUnreadMessageId).toBe("m-1");
  });

  it("applies server unread snapshot while preserving scroll state", () => {
    let state: ChatViewStateMap = {};
    state = incrementChannelUnread(state, "ch-1", "m-1");
    state = setChannelIsAtBottom(state, "ch-1", false);

    const next = syncChatViewStateFromServer(state, [
      { channelId: "ch-1", unreadCount: 3, lastReadAtUtc: "2026-04-05T12:00:00.000Z" },
    ]);

    expect(next["ch-1"]?.unreadCount).toBe(3);
    expect(next["ch-1"]?.lastReadAtUtc).toBe("2026-04-05T12:00:00.000Z");
    expect(next["ch-1"]?.isAtBottom).toBe(false);
  });
});
