import { describe, expect, it } from "vitest";
import { Track } from "livekit-client";
import {
  buildMicTrackOptions,
  computeGridGeometry,
  buildScreenShareConfig,
  computeFilmstripPageSize,
  computeGridPageSize,
  createInitialLayoutState,
  DEFAULT_DSP_SETTINGS,
  getAudioChannelForSource,
  getEffectiveStreamMode,
  hideStreamIdentity,
  paginateItems,
  resolveActivityWithHold,
  resolveFocusedStreamSid,
  resolvePlaybackLevels,
  restoreStreamIdentity,
  shouldCenterFilmstrip,
  STREAM_VIDEO_OBJECT_FIT,
  streamLayoutReducer,
  withoutVoiceIsolation,
} from "./roomState";

describe("roomState:getAudioChannelForSource", () => {
  it("maps screen share audio to stream channel", () => {
    expect(getAudioChannelForSource(Track.Source.ScreenShareAudio)).toBe("stream");
    expect(getAudioChannelForSource("screen_share_audio")).toBe("stream");
  });

  it("maps microphone and unknown sources to voice channel", () => {
    expect(getAudioChannelForSource(Track.Source.Microphone)).toBe("voice");
    expect(getAudioChannelForSource(undefined)).toBe("voice");
  });
});

describe("roomState:streamLayoutReducer", () => {
  it("tracks last non-theater mode and keeps it while in theater", () => {
    let state = createInitialLayoutState();
    state = streamLayoutReducer(state, { type: "set-mode", mode: "focus" });
    expect(state.lastNonTheaterMode).toBe("focus");

    state = streamLayoutReducer(state, { type: "set-mode", mode: "theater" });
    expect(state.mode).toBe("theater");
    expect(getEffectiveStreamMode(state)).toBe("focus");
  });

  it("re-focuses to first visible stream when focused stream disappears", () => {
    let state = createInitialLayoutState();
    state = streamLayoutReducer(state, { type: "set-mode", mode: "focus" });
    state = streamLayoutReducer(state, { type: "set-focus", sid: "stream-a" });
    state = streamLayoutReducer(state, {
      type: "ensure-visible",
      visibleSids: ["stream-b", "stream-c"],
    });

    expect(resolveFocusedStreamSid(state, ["stream-b", "stream-c"])).toBe("stream-b");
  });
});

describe("roomState:hiddenStreams", () => {
  it("supports hide and restore lifecycle", () => {
    let hidden: Record<string, true> = {};
    hidden = hideStreamIdentity(hidden, "alice");
    hidden = hideStreamIdentity(hidden, "bob");

    expect(hidden.alice).toBe(true);
    expect(hidden.bob).toBe(true);

    hidden = restoreStreamIdentity(hidden, "alice");
    expect(hidden.alice).toBeUndefined();
    expect(hidden.bob).toBe(true);
  });
});

describe("roomState:buildMicTrackOptions", () => {
  it("builds options and can drop unsupported voiceIsolation", () => {
    const options = buildMicTrackOptions(
      {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false,
        voiceIsolation: true,
      },
      "device-123",
    );

    expect(options.echoCancellation).toBe(true);
    expect(options.voiceIsolation).toBe(true);

    const fallback = withoutVoiceIsolation(options);
    expect(fallback.voiceIsolation).toBeUndefined();
    expect(fallback.deviceId).toEqual({ exact: "device-123" });
  });

  it("uses updated defaults (only noise suppression enabled)", () => {
    expect(DEFAULT_DSP_SETTINGS.echoCancellation).toBe(false);
    expect(DEFAULT_DSP_SETTINGS.noiseSuppression).toBe(true);
    expect(DEFAULT_DSP_SETTINGS.autoGainControl).toBe(false);
    expect(DEFAULT_DSP_SETTINGS.voiceIsolation).toBe(false);
  });
});

describe("roomState:pagination", () => {
  it("computes adaptive page sizes", () => {
    expect(computeGridPageSize(1200, 600)).toBeGreaterThan(1);
    expect(computeFilmstripPageSize(980)).toBeGreaterThan(1);
  });

  it("computes larger grid tiles for low stream counts on wide viewport", () => {
    const one = computeGridGeometry(1900, 900, 1);
    const two = computeGridGeometry(1900, 900, 2);
    const three = computeGridGeometry(1900, 900, 3);

    expect(one.tileWidth).toBeGreaterThanOrEqual(900);
    expect(two.tileWidth).toBeGreaterThanOrEqual(760);
    expect(three.tileWidth).toBeGreaterThanOrEqual(560);
    expect(three.columns).toBeGreaterThanOrEqual(2);
  });

  it("paginates and clamps page", () => {
    const result = paginateItems([1, 2, 3, 4, 5], 3, 2);
    expect(result.totalPages).toBe(3);
    expect(result.currentPage).toBe(3);
    expect(result.items).toEqual([5]);
  });

  it("centers focus filmstrip only when page has fewer items than capacity", () => {
    expect(shouldCenterFilmstrip(2, 4)).toBe(true);
    expect(shouldCenterFilmstrip(4, 4)).toBe(false);
    expect(shouldCenterFilmstrip(0, 4)).toBe(false);
  });
});

describe("roomState:screenShareConfig", () => {
  it("maps dialog options to capture/publish config", () => {
    const config = buildScreenShareConfig({
      resolution: "1080p",
      fps: 30,
      mode: "game",
      includeSystemAudio: true,
    });

    expect(config.captureOptions.resolution?.width).toBe(1920);
    expect(config.captureOptions.contentHint).toBe("motion");
    expect(config.captureOptions.audio).toBe(true);
    expect(config.publishOptions.videoEncoding?.maxFramerate).toBe(30);
    expect(config.fallback).toBeUndefined();
  });

  it("creates fallback for 60fps", () => {
    const config = buildScreenShareConfig({
      resolution: "1080p",
      fps: 60,
      mode: "game",
      includeSystemAudio: true,
    });

    expect(config.publishOptions.videoEncoding?.maxFramerate).toBe(60);
    expect(config.fallback?.publishOptions.videoEncoding?.maxFramerate).toBe(30);
  });
});

describe("roomState:resolvePlaybackLevels", () => {
  it("uses gain path for >100% when supported", () => {
    const boosted = resolvePlaybackLevels(1.75, true);
    expect(boosted.elementVolume).toBe(1);
    expect(boosted.gainValue).toBe(1.75);
    expect(boosted.boosted).toBe(true);
  });

  it("caps to 100% when gain path is unsupported", () => {
    const capped = resolvePlaybackLevels(1.75, false);
    expect(capped.elementVolume).toBe(1);
    expect(capped.gainValue).toBe(1);
    expect(capped.boosted).toBe(false);
  });
});

describe("roomState:activity hold", () => {
  it("keeps stream activity true while hold window is active", () => {
    const now = 1000;
    const active = resolveActivityWithHold(0.05, 0.02, now, undefined, 700);
    expect(active.isActive).toBe(true);
    expect(active.activeUntilMs).toBe(1700);

    const held = resolveActivityWithHold(0, 0.02, 1500, active.activeUntilMs, 700);
    expect(held.isActive).toBe(true);
  });

  it("drops activity after hold window expiration", () => {
    const dropped = resolveActivityWithHold(0, 0.02, 1801, 1700, 700);
    expect(dropped.isActive).toBe(false);
  });
});

describe("roomState:video fit", () => {
  it("uses contain policy to avoid crop in stream tiles", () => {
    expect(STREAM_VIDEO_OBJECT_FIT).toBe("contain");
  });
});
