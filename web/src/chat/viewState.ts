import { ChannelUnreadStateDto } from "../types";

export type ChannelChatViewState = {
  unreadCount: number;
  firstUnreadMessageId: string | null;
  lastReadAtUtc: string | null;
  isAtBottom: boolean;
};

export type ChatViewStateMap = Record<string, ChannelChatViewState>;

export function defaultChannelChatViewState(): ChannelChatViewState {
  return {
    unreadCount: 0,
    firstUnreadMessageId: null,
    lastReadAtUtc: null,
    isAtBottom: true,
  };
}

export function getChannelChatViewState(
  state: ChatViewStateMap,
  channelId: string | null | undefined,
): ChannelChatViewState {
  if (!channelId) {
    return defaultChannelChatViewState();
  }

  return state[channelId] ?? defaultChannelChatViewState();
}

export function setChannelIsAtBottom(
  state: ChatViewStateMap,
  channelId: string,
  isAtBottom: boolean,
): ChatViewStateMap {
  const current = getChannelChatViewState(state, channelId);
  if (current.isAtBottom === isAtBottom) {
    return state;
  }

  return {
    ...state,
    [channelId]: {
      ...current,
      isAtBottom,
    },
  };
}

export function incrementChannelUnread(
  state: ChatViewStateMap,
  channelId: string,
  messageId: string,
): ChatViewStateMap {
  const current = getChannelChatViewState(state, channelId);
  return {
    ...state,
    [channelId]: {
      ...current,
      unreadCount: current.unreadCount + 1,
      firstUnreadMessageId: current.firstUnreadMessageId ?? messageId,
      isAtBottom: false,
    },
  };
}

export function markChannelRead(
  state: ChatViewStateMap,
  channelId: string,
  lastReadAtUtc: string,
): ChatViewStateMap {
  const current = getChannelChatViewState(state, channelId);
  if (
    current.unreadCount === 0 &&
    current.firstUnreadMessageId === null &&
    current.lastReadAtUtc === lastReadAtUtc &&
    current.isAtBottom
  ) {
    return state;
  }

  return {
    ...state,
    [channelId]: {
      ...current,
      unreadCount: 0,
      firstUnreadMessageId: null,
      lastReadAtUtc,
      isAtBottom: true,
    },
  };
}

export function syncChatViewStateFromServer(
  state: ChatViewStateMap,
  serverUnreadChannels: readonly ChannelUnreadStateDto[],
): ChatViewStateMap {
  if (serverUnreadChannels.length === 0) {
    return state;
  }

  const next: ChatViewStateMap = { ...state };
  for (const channelUnread of serverUnreadChannels) {
    const current = getChannelChatViewState(next, channelUnread.channelId);
    const nextUnreadCount = Math.max(0, channelUnread.unreadCount);
    const nextLastReadAtUtc = channelUnread.lastReadAtUtc ?? null;
    const nextFirstUnreadMessageId =
      nextUnreadCount === 0
        ? null
        : current.unreadCount > 0
          ? current.firstUnreadMessageId
          : null;

    next[channelUnread.channelId] = {
      ...current,
      unreadCount: nextUnreadCount,
      lastReadAtUtc: nextLastReadAtUtc,
      firstUnreadMessageId: nextFirstUnreadMessageId,
    };
  }

  return next;
}

export function getWorkspaceUnreadCount(state: ChatViewStateMap): number {
  return Object.values(state).reduce((sum, item) => sum + Math.max(0, item.unreadCount), 0);
}

type PersistedShape = {
  channels?: Record<
    string,
    {
      unreadCount?: number;
      firstUnreadMessageId?: string | null;
      lastReadAtUtc?: string | null;
      lastSeenAt?: string | null;
      isAtBottom?: boolean;
    }
  >;
};

export function parseChatViewState(raw: string | null): ChatViewStateMap {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as PersistedShape;
    const channels = parsed.channels ?? {};
    const next: ChatViewStateMap = {};

    for (const [channelId, value] of Object.entries(channels)) {
      const unreadCount = Math.max(0, Number(value.unreadCount ?? 0) || 0);
      next[channelId] = {
        unreadCount,
        firstUnreadMessageId: unreadCount > 0 ? value.firstUnreadMessageId ?? null : null,
        lastReadAtUtc: value.lastReadAtUtc ?? value.lastSeenAt ?? null,
        isAtBottom: Boolean(value.isAtBottom ?? true),
      };
    }

    return next;
  } catch {
    return {};
  }
}

export function stringifyChatViewState(state: ChatViewStateMap): string {
  return JSON.stringify({ channels: state });
}
