export type MentionQuery = {
  query: string;
  startIndex: number;
  endIndex: number;
};

const TRAILING_MENTION_REGEX = /(^|[\s(])@([\p{L}\p{N}._-]{0,32})$/u;

export function findTrailingMentionQuery(content: string): MentionQuery | null {
  const match = content.match(TRAILING_MENTION_REGEX);
  if (!match || match.index === undefined) {
    return null;
  }

  const boundary = match[1] ?? "";
  const query = match[2] ?? "";
  const startIndex = match.index + boundary.length;

  return {
    query,
    startIndex,
    endIndex: content.length,
  };
}

export function applyMentionSelection(
  content: string,
  mentionQuery: MentionQuery,
  username: string,
): string {
  const replacement = `@${username} `;
  return `${content.slice(0, mentionQuery.startIndex)}${replacement}${content.slice(mentionQuery.endIndex)}`;
}
