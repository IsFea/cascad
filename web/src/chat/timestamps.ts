export function isSameLocalDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

export function formatRelativeMessageTime(
  createdAtUtc: string,
  nowMs = Date.now(),
  locale?: string,
): string {
  const createdMs = Date.parse(createdAtUtc);
  if (!Number.isFinite(createdMs)) {
    return "--";
  }

  const diffMs = Math.max(0, nowMs - createdMs);
  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;

  if (diffMs < minuteMs) {
    return "now";
  }

  if (diffMs < hourMs) {
    return `${Math.floor(diffMs / minuteMs)}m`;
  }

  if (diffMs < dayMs) {
    return `${Math.floor(diffMs / hourMs)}h`;
  }

  if (diffMs < 7 * dayMs) {
    return `${Math.floor(diffMs / dayMs)}d`;
  }

  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  }).format(new Date(createdMs));
}

export function formatFullMessageTime(createdAtUtc: string, locale?: string): string {
  const created = new Date(createdAtUtc);
  if (Number.isNaN(created.getTime())) {
    return createdAtUtc;
  }

  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(created);
}

export function formatDateSeparatorLabel(date: Date, nowMs = Date.now(), locale?: string): string {
  const now = new Date(nowMs);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  if (isSameLocalDay(date, now)) {
    return "Today";
  }

  if (isSameLocalDay(date, yesterday)) {
    return "Yesterday";
  }

  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}
