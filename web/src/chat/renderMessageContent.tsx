import { Box } from "@mui/material";
import { MessageMentionDto } from "../types";

const TOKEN_REGEX = /(https?:\/\/[^\s]+|@[\p{L}\p{N}._-]{2,32})/gu;

export type ChatContentPart =
  | { kind: "text"; value: string }
  | { kind: "mention"; value: string }
  | { kind: "link"; value: string; href: string };

function getSafeHttpUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

export function tokenizeMessageContent(
  content: string,
  mentionTokens: readonly string[],
): ChatContentPart[] {
  const mentionTokenSet = new Set(mentionTokens);
  const parts: ChatContentPart[] = [];
  let lastIndex = 0;

  for (const match of content.matchAll(TOKEN_REGEX)) {
    const token = match[0];
    const start = match.index ?? 0;
    if (start > lastIndex) {
      parts.push({ kind: "text", value: content.slice(lastIndex, start) });
    }

    if (token.startsWith("@")) {
      if (mentionTokenSet.has(token)) {
        parts.push({ kind: "mention", value: token });
      } else {
        parts.push({ kind: "text", value: token });
      }
      lastIndex = start + token.length;
      continue;
    }

    const trailingMatch = token.match(/[),.!?]+$/u);
    const trailing = trailingMatch?.[0] ?? "";
    const candidate = trailing ? token.slice(0, -trailing.length) : token;
    const safeHref = getSafeHttpUrl(candidate);

    if (safeHref) {
      parts.push({ kind: "link", value: candidate, href: safeHref });
      if (trailing) {
        parts.push({ kind: "text", value: trailing });
      }
    } else {
      parts.push({ kind: "text", value: token });
    }

    lastIndex = start + token.length;
  }

  if (lastIndex < content.length) {
    parts.push({ kind: "text", value: content.slice(lastIndex) });
  }

  if (parts.length === 0) {
    parts.push({ kind: "text", value: content });
  }

  return parts;
}

export function renderMessageContent(content: string, mentions: readonly MessageMentionDto[]) {
  const mentionTokens = mentions.map((mention) => mention.token);
  const tokens = tokenizeMessageContent(content, mentionTokens);

  return tokens.map((token, index) => {
    if (token.kind === "mention") {
      return (
        <Box
          key={`${token.value}-${index}`}
          component="span"
          sx={{
            color: "primary.light",
            fontWeight: 600,
            px: 0.55,
            py: 0.12,
            borderRadius: 0.6,
            bgcolor: "rgba(110, 164, 255, 0.14)",
            border: "1px solid rgba(110, 164, 255, 0.28)",
          }}
        >
          {token.value}
        </Box>
      );
    }

    if (token.kind === "link") {
      return (
        <Box
          key={`${token.value}-${index}`}
          component="a"
          href={token.href}
          target="_blank"
          rel="noopener noreferrer nofollow ugc"
          sx={{
            color: "rgba(110, 164, 255, 0.95)",
            textDecoration: "underline",
            textDecorationColor: "rgba(110, 164, 255, 0.55)",
            textUnderlineOffset: "3px",
            wordBreak: "break-word",
            "&:hover": {
              color: "primary.light",
              textDecorationColor: "rgba(151, 189, 255, 0.8)",
            },
          }}
        >
          {token.value}
        </Box>
      );
    }

    return <span key={`${token.value}-${index}`}>{token.value}</span>;
  });
}
