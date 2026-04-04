import { RefObject, useEffect, useRef, useState } from "react";
import { ElementSize } from "./types";

export function volumePercent(value: number): number {
  return Math.round(Math.max(0, Math.min(2, value)) * 100);
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function initials(value: string): string {
  const chunks = value
    .split(" ")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 2)
    .map((item) => item[0]?.toUpperCase() ?? "");

  return chunks.join("") || "?";
}

export function resolveDisplayName(
  participant: { identity: string; name?: string | undefined },
  fallback?: string,
): string {
  const candidate = participant.name?.trim() || fallback?.trim();
  if (candidate) {
    return candidate;
  }

  return participant.identity || "Unknown";
}

export function useElementSize<T extends HTMLElement>(): [RefObject<T>, ElementSize] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }

      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  return [ref, size];
}
