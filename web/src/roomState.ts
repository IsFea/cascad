import {
  ScreenShareCaptureOptions,
  ScreenSharePresets,
  Track,
  TrackPublishOptions,
} from "livekit-client";

export type AudioChannel = "voice" | "stream";

export type StreamLayoutMode = "grid" | "focus" | "theater";

export type NonTheaterLayoutMode = Exclude<StreamLayoutMode, "theater">;

export type StreamLayoutState = {
  mode: StreamLayoutMode;
  lastNonTheaterMode: NonTheaterLayoutMode;
  focusedStreamSid: string | null;
};

export type StreamLayoutAction =
  | {
      type: "set-mode";
      mode: StreamLayoutMode;
    }
  | {
      type: "set-focus";
      sid: string | null;
    }
  | {
      type: "remove-stream";
      sid: string;
    }
  | {
      type: "ensure-visible";
      visibleSids: string[];
    };

export type DspSettings = {
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  voiceIsolation: boolean;
};

export type MicTrackOptions = {
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  deviceId?: ConstrainDOMString;
  voiceIsolation?: boolean;
};

export type StreamPresetId =
  | "balanced_720p30"
  | "game_1080p30"
  | "game_plus_1080p60"
  | "text_1080p15";

export type StreamPreset = {
  id: StreamPresetId;
  label: string;
  description: string;
  captureOptions: ScreenShareCaptureOptions;
  publishOptions: TrackPublishOptions;
  fallbackPresetId?: StreamPresetId;
};

export const DEFAULT_DSP_SETTINGS: DspSettings = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  voiceIsolation: false,
};

export const STREAM_PRESETS: Record<StreamPresetId, StreamPreset> = {
  balanced_720p30: {
    id: "balanced_720p30",
    label: "720p30 (Balanced)",
    description: "Balanced quality for most sessions.",
    captureOptions: {
      resolution: {
        ...ScreenSharePresets.h720fps30.resolution,
        frameRate: 30,
      },
      contentHint: "detail",
      systemAudio: "include",
      selfBrowserSurface: "include",
      surfaceSwitching: "include",
    },
    publishOptions: {
      source: Track.Source.ScreenShare,
      screenShareEncoding: {
        ...ScreenSharePresets.h720fps30.encoding,
        maxFramerate: 30,
      },
      videoEncoding: {
        ...ScreenSharePresets.h720fps30.encoding,
        maxFramerate: 30,
      },
      simulcast: true,
    },
  },
  game_1080p30: {
    id: "game_1080p30",
    label: "1080p30 (Game)",
    description: "Higher detail and smooth gameplay motion.",
    captureOptions: {
      resolution: {
        ...ScreenSharePresets.h1080fps30.resolution,
        frameRate: 30,
      },
      contentHint: "motion",
      systemAudio: "include",
      selfBrowserSurface: "include",
      surfaceSwitching: "include",
    },
    publishOptions: {
      source: Track.Source.ScreenShare,
      screenShareEncoding: {
        ...ScreenSharePresets.h1080fps30.encoding,
        maxFramerate: 30,
      },
      videoEncoding: {
        ...ScreenSharePresets.h1080fps30.encoding,
        maxFramerate: 30,
      },
      simulcast: true,
    },
  },
  game_plus_1080p60: {
    id: "game_plus_1080p60",
    label: "1080p60 (Game+)",
    description: "Fastest preset for motion-heavy games (falls back to 1080p30).",
    captureOptions: {
      resolution: {
        width: 1920,
        height: 1080,
        frameRate: 60,
      },
      contentHint: "motion",
      systemAudio: "include",
      selfBrowserSurface: "include",
      surfaceSwitching: "include",
    },
    publishOptions: {
      source: Track.Source.ScreenShare,
      screenShareEncoding: {
        maxBitrate: 8_000_000,
        maxFramerate: 60,
      },
      videoEncoding: {
        maxBitrate: 8_000_000,
        maxFramerate: 60,
      },
      simulcast: true,
    },
    fallbackPresetId: "game_1080p30",
  },
  text_1080p15: {
    id: "text_1080p15",
    label: "1080p15 (Text)",
    description: "Best readability for text and documents.",
    captureOptions: {
      resolution: {
        ...ScreenSharePresets.h1080fps15.resolution,
        frameRate: 15,
      },
      contentHint: "text",
      systemAudio: "exclude",
      selfBrowserSurface: "include",
      surfaceSwitching: "include",
    },
    publishOptions: {
      source: Track.Source.ScreenShare,
      screenShareEncoding: {
        ...ScreenSharePresets.h1080fps15.encoding,
        maxFramerate: 15,
      },
      videoEncoding: {
        ...ScreenSharePresets.h1080fps15.encoding,
        maxFramerate: 15,
      },
      simulcast: true,
    },
  },
};

export function createInitialLayoutState(): StreamLayoutState {
  return {
    mode: "grid",
    lastNonTheaterMode: "grid",
    focusedStreamSid: null,
  };
}

export function getEffectiveStreamMode(
  state: StreamLayoutState,
): NonTheaterLayoutMode {
  if (state.mode === "theater") {
    return state.lastNonTheaterMode;
  }

  return state.mode;
}

export function streamLayoutReducer(
  state: StreamLayoutState,
  action: StreamLayoutAction,
): StreamLayoutState {
  switch (action.type) {
    case "set-mode": {
      if (action.mode === "theater") {
        if (state.mode === "theater") {
          return state;
        }

        return {
          ...state,
          mode: "theater",
        };
      }

      if (
        state.mode === action.mode &&
        state.lastNonTheaterMode === action.mode
      ) {
        return state;
      }

      return {
        ...state,
        mode: action.mode,
        lastNonTheaterMode: action.mode,
      };
    }
    case "set-focus": {
      if (state.focusedStreamSid === action.sid) {
        return state;
      }

      return {
        ...state,
        focusedStreamSid: action.sid,
      };
    }
    case "remove-stream": {
      if (state.focusedStreamSid !== action.sid) {
        return state;
      }

      return {
        ...state,
        focusedStreamSid: null,
      };
    }
    case "ensure-visible": {
      const { visibleSids } = action;
      if (visibleSids.length === 0) {
        if (state.focusedStreamSid === null) {
          return state;
        }

        return {
          ...state,
          focusedStreamSid: null,
        };
      }

      if (
        state.focusedStreamSid !== null &&
        visibleSids.includes(state.focusedStreamSid)
      ) {
        return state;
      }

      const effectiveMode = getEffectiveStreamMode(state);
      if (effectiveMode !== "focus") {
        return state;
      }

      return {
        ...state,
        focusedStreamSid: visibleSids[0],
      };
    }
    default:
      return state;
  }
}

export function resolveFocusedStreamSid(
  state: StreamLayoutState,
  visibleSids: string[],
): string | null {
  if (visibleSids.length === 0) {
    return null;
  }

  const effectiveMode = getEffectiveStreamMode(state);
  if (effectiveMode !== "focus") {
    return null;
  }

  if (
    state.focusedStreamSid !== null &&
    visibleSids.includes(state.focusedStreamSid)
  ) {
    return state.focusedStreamSid;
  }

  return visibleSids[0];
}

export function getAudioChannelForSource(
  source: Track.Source | string | undefined,
): AudioChannel {
  if (source === Track.Source.ScreenShareAudio || source === "screen_share_audio") {
    return "stream";
  }

  return "voice";
}

export function buildMicTrackOptions(
  settings: DspSettings,
  deviceId?: string,
): MicTrackOptions {
  const options: MicTrackOptions = {
    echoCancellation: settings.echoCancellation,
    noiseSuppression: settings.noiseSuppression,
    autoGainControl: settings.autoGainControl,
  };

  if (deviceId) {
    options.deviceId = { exact: deviceId };
  }

  if (settings.voiceIsolation) {
    options.voiceIsolation = true;
  }

  return options;
}

export function withoutVoiceIsolation(
  options: MicTrackOptions,
): MicTrackOptions {
  const { voiceIsolation: _ignored, ...rest } = options;
  return rest;
}

export function hideStreamIdentity(
  hidden: Record<string, true>,
  identity: string,
): Record<string, true> {
  if (hidden[identity]) {
    return hidden;
  }

  return {
    ...hidden,
    [identity]: true,
  };
}

export function restoreStreamIdentity(
  hidden: Record<string, true>,
  identity: string,
): Record<string, true> {
  if (!hidden[identity]) {
    return hidden;
  }

  const next = { ...hidden };
  delete next[identity];
  return next;
}
