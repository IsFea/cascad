import { describe, expect, it } from "vitest";
import { Track } from "livekit-client";
import {
  buildMicTrackOptions,
  createInitialLayoutState,
  getAudioChannelForSource,
  getEffectiveStreamMode,
  hideStreamIdentity,
  resolveFocusedStreamSid,
  restoreStreamIdentity,
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
});
