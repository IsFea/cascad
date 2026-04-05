import { describe, expect, it } from "vitest";
import { tokenizeMessageContent } from "./renderMessageContent";

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
});
