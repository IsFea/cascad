import { describe, expect, it } from "vitest";
import { tokenizeMessageContent, renderMessageContent } from "./renderMessageContent";

describe("tokenizeMessageContent", () => {
  it("marks only server-validated mention tokens as mentions", () => {
    const parts = tokenizeMessageContent("hello @alice and @ghost", ["@alice"]);

    expect(parts).toEqual([
      { kind: "text", value: "hello " },
      { kind: "mention", value: "@alice" },
      { kind: "text", value: " and " },
      { kind: "text", value: "@ghost" },
    ]);
  });

  it("creates safe link tokens and ignores non-http schemes", () => {
    const parts = tokenizeMessageContent(
      "ok https://example.com and javascript://alert(1)",
      [],
    );

    expect(parts).toEqual([
      { kind: "text", value: "ok " },
      { kind: "link", value: "https://example.com", href: "https://example.com/" },
      { kind: "text", value: " and javascript://alert(1)" },
    ]);
  });

  it("marks current-user mention with alert styling", () => {
    const nodes = renderMessageContent(
      "hi @alice",
      [{ userId: "u-1", username: "alice", token: "@alice" }],
      "u-1",
    );

    expect(nodes).toHaveLength(2);
  });
});
