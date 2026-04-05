import { describe, expect, it } from "vitest";
import { applyMentionSelection, findTrailingMentionQuery } from "./mentions";

describe("mention utils", () => {
  it("finds trailing mention query", () => {
    const query = findTrailingMentionQuery("hi @al");
    expect(query).not.toBeNull();
    expect(query?.query).toBe("al");
  });

  it("applies mention selection using query range", () => {
    const query = findTrailingMentionQuery("hi @al");
    expect(query).not.toBeNull();
    const next = applyMentionSelection("hi @al", query!, "alice");
    expect(next).toBe("hi @alice ");
  });
});
