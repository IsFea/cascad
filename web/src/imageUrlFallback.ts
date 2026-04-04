const brokenImageUrls = new Set<string>();

export function getSafeImageUrl(url: string | null | undefined): string | undefined {
  if (!url || brokenImageUrls.has(url)) {
    return undefined;
  }

  return url;
}

export function markImageUrlBroken(url: string | null | undefined): void {
  if (!url) {
    return;
  }

  brokenImageUrls.add(url);
}
