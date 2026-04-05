import { ChannelMessageDto } from "../types";
import { formatDateSeparatorLabel, isSameLocalDay } from "./timestamps";

const GROUP_WINDOW_MS = 5 * 60 * 1000;

export type MessageTimelineItem =
  | {
      kind: "separator";
      key: string;
      label: string;
      dateIso: string;
    }
  | {
      kind: "message";
      key: string;
      message: ChannelMessageDto;
      showHeader: boolean;
      groupedWithPrev: boolean;
      groupedWithNext: boolean;
    };

function parseCreatedDate(message: ChannelMessageDto): Date {
  return new Date(message.createdAtUtc);
}

function canGroupMessages(prev: ChannelMessageDto, next: ChannelMessageDto): boolean {
  if (prev.userId !== next.userId) {
    return false;
  }

  const prevDate = parseCreatedDate(prev);
  const nextDate = parseCreatedDate(next);
  if (!Number.isFinite(prevDate.getTime()) || !Number.isFinite(nextDate.getTime())) {
    return false;
  }

  if (!isSameLocalDay(prevDate, nextDate)) {
    return false;
  }

  return nextDate.getTime() - prevDate.getTime() <= GROUP_WINDOW_MS;
}

export function buildMessageTimeline(
  messages: readonly ChannelMessageDto[],
  nowMs = Date.now(),
  locale?: string,
): MessageTimelineItem[] {
  if (messages.length === 0) {
    return [];
  }

  const timeline: MessageTimelineItem[] = [];

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!;
    const parsedCurrentDate = parseCreatedDate(message);
    const currentDate = Number.isFinite(parsedCurrentDate.getTime())
      ? parsedCurrentDate
      : new Date(nowMs);
    const prevMessage = index > 0 ? messages[index - 1] : null;
    const nextMessage = index + 1 < messages.length ? messages[index + 1] : null;

    const needsDateSeparator =
      !prevMessage || !isSameLocalDay(parseCreatedDate(prevMessage), currentDate);

    if (needsDateSeparator) {
      const dateIso = currentDate.toISOString().slice(0, 10);
      timeline.push({
        kind: "separator",
        key: `separator-${dateIso}-${index}`,
        label: formatDateSeparatorLabel(currentDate, nowMs, locale),
        dateIso,
      });
    }

    const groupedWithPrev = prevMessage ? canGroupMessages(prevMessage, message) : false;
    const groupedWithNext = nextMessage ? canGroupMessages(message, nextMessage) : false;

    timeline.push({
      kind: "message",
      key: `message-${message.id}`,
      message,
      showHeader: !groupedWithPrev,
      groupedWithPrev,
      groupedWithNext,
    });
  }

  return timeline;
}
