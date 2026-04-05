import { AudioBinding } from "./types";

export type BoostContextState = AudioContextState | "interrupted";

export const BOOST_RESUME_RETRY_MS = 1200;

export function isBoostSourceStale(
  boostSourceTrackId: string | undefined,
  mediaTrack: Pick<MediaStreamTrack, "id" | "readyState"> | null | undefined,
): boolean {
  if (!mediaTrack) {
    return true;
  }

  if (mediaTrack.readyState === "ended") {
    return true;
  }

  return Boolean(boostSourceTrackId && boostSourceTrackId !== mediaTrack.id);
}

export function shouldRetryBoostResume(
  contextState: BoostContextState,
  nowMs: number,
  lastBoostFailureAtMs: number | undefined,
  retryMs = BOOST_RESUME_RETRY_MS,
): boolean {
  if (contextState !== "suspended" && contextState !== "interrupted") {
    return false;
  }

  if (lastBoostFailureAtMs === undefined) {
    return true;
  }

  return nowMs - lastBoostFailureAtMs >= retryMs;
}

export function shouldUseBoostOutput(params: {
  contextState: BoostContextState;
  hasGainNode: boolean;
  sourceStale: boolean;
}): boolean {
  return params.contextState === "running" && params.hasGainNode && !params.sourceStale;
}

export function shouldKeepElementMuted(
  binding: AudioBinding,
  contextState: BoostContextState,
  sourceStale: boolean,
): boolean {
  return (
    binding.boostLifecycle === "active" &&
    shouldUseBoostOutput({
      contextState,
      hasGainNode: Boolean(binding.boostGainNode),
      sourceStale,
    })
  );
}
