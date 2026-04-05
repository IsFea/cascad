import { describe, expect, it } from "vitest";
import {
  BOOST_RESUME_RETRY_MS,
  isBoostSourceStale,
  shouldRetryBoostResume,
  shouldUseBoostOutput,
} from "./audioBoost";

describe("room:audioBoost:isBoostSourceStale", () => {
  it("marks missing and ended tracks as stale", () => {
    expect(isBoostSourceStale("t-1", undefined)).toBe(true);
    expect(isBoostSourceStale("t-1", null)).toBe(true);
    expect(
      isBoostSourceStale("t-1", { id: "t-1", readyState: "ended" } as MediaStreamTrack),
    ).toBe(true);
  });

  it("marks mismatched ids as stale and same ids as healthy", () => {
    expect(
      isBoostSourceStale("t-1", { id: "t-2", readyState: "live" } as MediaStreamTrack),
    ).toBe(true);
    expect(
      isBoostSourceStale("t-1", { id: "t-1", readyState: "live" } as MediaStreamTrack),
    ).toBe(false);
  });
});

describe("room:audioBoost:shouldRetryBoostResume", () => {
  it("allows first retry and throttles repeated attempts", () => {
    const now = 5_000;
    expect(shouldRetryBoostResume("suspended", now, undefined)).toBe(true);
    expect(shouldRetryBoostResume("interrupted", now, now - BOOST_RESUME_RETRY_MS + 100)).toBe(
      false,
    );
    expect(shouldRetryBoostResume("interrupted", now, now - BOOST_RESUME_RETRY_MS - 1)).toBe(
      true,
    );
  });

  it("never retries while context is running", () => {
    expect(shouldRetryBoostResume("running", 5_000, undefined)).toBe(false);
  });
});

describe("room:audioBoost:shouldUseBoostOutput", () => {
  it("only enables boost output for running graph with fresh source", () => {
    expect(
      shouldUseBoostOutput({
        contextState: "running",
        hasGainNode: true,
        sourceStale: false,
      }),
    ).toBe(true);

    expect(
      shouldUseBoostOutput({
        contextState: "interrupted",
        hasGainNode: true,
        sourceStale: false,
      }),
    ).toBe(false);

    expect(
      shouldUseBoostOutput({
        contextState: "running",
        hasGainNode: false,
        sourceStale: false,
      }),
    ).toBe(false);
  });
});
