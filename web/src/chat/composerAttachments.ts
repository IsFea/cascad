export type ClipboardImageLike = {
  kind: string;
  type?: string;
  getAsFile: () => File | null;
};

export function extractImageFilesFromClipboardItems(
  items: Iterable<ClipboardImageLike> | null | undefined,
): File[] {
  if (!items) {
    return [];
  }

  const files: File[] = [];
  for (const item of items) {
    if (item.kind !== "file" || !item.type?.startsWith("image/")) {
      continue;
    }

    const file = item.getAsFile();
    if (file) {
      files.push(file);
    }
  }

  return files;
}

export function appendAttachmentUrl(
  current: readonly string[],
  nextUrl: string,
  maxCount = 4,
): string[] {
  const trimmed = nextUrl.trim();
  if (!trimmed) {
    return [...current];
  }

  const deduped = [...current.filter((value) => value !== trimmed), trimmed];
  return deduped.slice(-maxCount);
}

export function removeAttachmentUrl(current: readonly string[], targetUrl: string): string[] {
  return current.filter((value) => value !== targetUrl);
}
