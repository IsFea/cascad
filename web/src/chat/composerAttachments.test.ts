import { describe, expect, it } from "vitest";
import {
  appendAttachmentUrl,
  extractImageFilesFromClipboardItems,
  removeAttachmentUrl,
} from "./composerAttachments";

describe("composer attachments", () => {
  it("extracts only image files from clipboard-like items", () => {
    const image = new File(["a"], "shot.png", { type: "image/png" });
    const text = new File(["b"], "note.txt", { type: "text/plain" });
    const files = extractImageFilesFromClipboardItems([
      { kind: "file", type: "image/png", getAsFile: () => image },
      { kind: "file", type: "text/plain", getAsFile: () => text },
      { kind: "string", type: "text/plain", getAsFile: () => null },
    ]);

    expect(files).toEqual([image]);
  });

  it("removes attachment preview by url", () => {
    const initial = ["/a.png", "/b.png"];
    expect(removeAttachmentUrl(initial, "/a.png")).toEqual(["/b.png"]);
  });

  it("appends with dedupe and max cap", () => {
    let current = ["/1.png", "/2.png", "/3.png", "/4.png"];
    current = appendAttachmentUrl(current, "/2.png");
    expect(current).toEqual(["/1.png", "/3.png", "/4.png", "/2.png"]);
    current = appendAttachmentUrl(current, "/5.png");
    expect(current).toEqual(["/3.png", "/4.png", "/2.png", "/5.png"]);
  });
});
