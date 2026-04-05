import { useCallback, useState } from "react";
import { ChannelMessageDto } from "../types";

export type ChannelMessagesStore = Record<string, ChannelMessageDto[]>;

function compareMessages(left: ChannelMessageDto, right: ChannelMessageDto) {
  const leftTime = Date.parse(left.createdAtUtc);
  const rightTime = Date.parse(right.createdAtUtc);
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  return left.id.localeCompare(right.id);
}

export function upsertMessages(
  current: ChannelMessageDto[],
  incoming: readonly ChannelMessageDto[],
): ChannelMessageDto[] {
  if (incoming.length === 0) {
    return current;
  }

  const byId = new Map<string, ChannelMessageDto>();
  for (const message of current) {
    byId.set(message.id, message);
  }
  for (const message of incoming) {
    byId.set(message.id, message);
  }

  return Array.from(byId.values()).sort(compareMessages);
}

export function useChatState() {
  const [messagesByChannel, setMessagesByChannel] = useState<ChannelMessagesStore>({});

  const replaceChannelMessages = useCallback((channelId: string, messages: readonly ChannelMessageDto[]) => {
    setMessagesByChannel((current) => {
      const nextMessages = upsertMessages([], messages);
      if (nextMessages.length === 0) {
        if (!current[channelId]) {
          return current;
        }

        return {
          ...current,
          [channelId]: [],
        };
      }

      return {
        ...current,
        [channelId]: nextMessages,
      };
    });
  }, []);

  const upsertChannelMessages = useCallback((channelId: string, messages: readonly ChannelMessageDto[]) => {
    if (messages.length === 0) {
      return;
    }

    setMessagesByChannel((current) => {
      const existing = current[channelId] ?? [];
      const merged = upsertMessages(existing, messages);
      if (merged === existing) {
        return current;
      }

      return {
        ...current,
        [channelId]: merged,
      };
    });
  }, []);

  const upsertChannelMessage = useCallback((channelId: string, message: ChannelMessageDto) => {
    upsertChannelMessages(channelId, [message]);
  }, [upsertChannelMessages]);

  return {
    messagesByChannel,
    replaceChannelMessages,
    upsertChannelMessages,
    upsertChannelMessage,
  };
}
