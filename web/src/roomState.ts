import {
  ScreenShareCaptureOptions,
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

export type StreamResolutionPreset = "720p" | "1080p";

export type StreamFpsPreset = 15 | 30 | 60;

export type StreamContentMode = "game" | "text";

export type StreamStartOptions = {
  resolution: StreamResolutionPreset;
  fps: StreamFpsPreset;
  mode: StreamContentMode;
  includeSystemAudio: boolean;
};

export type StreamShareConfig = {
  captureOptions: ScreenShareCaptureOptions;
  publishOptions: TrackPublishOptions;
  fallback?: {
    captureOptions: ScreenShareCaptureOptions;
    publishOptions: TrackPublishOptions;
    notice: string;
  };
};

export const DEFAULT_DSP_SETTINGS: DspSettings = {
  echoCancellation: false,
  noiseSuppression: true,
  autoGainControl: false,
  voiceIsolation: false,
};

export const DEFAULT_STREAM_START_OPTIONS: StreamStartOptions = {
  resolution: "1080p",
  fps: 30,
  mode: "game",
  includeSystemAudio: true,
};

export const STREAM_VIDEO_OBJECT_FIT = "contain" as const;

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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function computeGridPageSize(width: number, height: number): number {
  if (width <= 0 || height <= 0) {
    return 1;
  }

  const minTileWidth = 280;
  const minTileHeight = 180;

  const columns = Math.max(1, Math.floor(width / minTileWidth));
  const rows = Math.max(1, Math.floor(height / minTileHeight));

  return columns * rows;
}

export function computeGridGeometry(
  width: number,
  height: number,
  itemCount: number,
): {
  columns: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
} {
  if (width <= 0 || height <= 0 || itemCount <= 0) {
    return {
      columns: 1,
      rows: 1,
      tileWidth: 320,
      tileHeight: 180,
    };
  }

  const gap = 10;
  const minWidth = 220;
  const minHeight = 124;
  const maxTileWidth = 980;
  const safeWidth = Math.max(320, width);
  const safeHeight = Math.max(220, height);
  const maxColumns = Math.max(1, Math.min(itemCount, 6));

  let best = {
    columns: 1,
    rows: itemCount,
    tileWidth: Math.min(maxTileWidth, safeWidth),
    tileHeight: Math.min(safeHeight, Math.min(maxTileWidth, safeWidth) * (9 / 16)),
    score: Number.NEGATIVE_INFINITY,
  };

  for (let columns = 1; columns <= maxColumns; columns += 1) {
    const rows = Math.max(1, Math.ceil(itemCount / columns));
    const widthByColumns = (safeWidth - (columns - 1) * gap) / columns;
    const heightByRows = (safeHeight - (rows - 1) * gap) / rows;
    const tileWidth = Math.min(widthByColumns, heightByRows * (16 / 9), maxTileWidth);
    const tileHeight = tileWidth * (9 / 16);

    if (tileWidth < minWidth || tileHeight < minHeight) {
      continue;
    }

    const usedArea = tileWidth * tileHeight * itemCount;
    const emptySlots = rows * columns - itemCount;
    const score = usedArea - emptySlots * 50_000;

    if (score > best.score) {
      best = {
        columns,
        rows,
        tileWidth,
        tileHeight,
        score,
      };
    }
  }

  return {
    columns: best.columns,
    rows: best.rows,
    tileWidth: Math.floor(best.tileWidth),
    tileHeight: Math.floor(best.tileHeight),
  };
}

export function computeFilmstripPageSize(width: number): number {
  if (width <= 0) {
    return 1;
  }

  const minTileWidth = 170;
  return Math.max(1, Math.floor(width / minTileWidth));
}

export function shouldCenterFilmstrip(
  visibleItemsOnPage: number,
  pageSize: number,
): boolean {
  return visibleItemsOnPage > 0 && visibleItemsOnPage < Math.max(1, pageSize);
}

export function paginateItems<T>(
  items: T[],
  page: number,
  pageSize: number,
): {
  items: T[];
  currentPage: number;
  totalPages: number;
} {
  if (items.length === 0) {
    return {
      items: [],
      currentPage: 1,
      totalPages: 1,
    };
  }

  const safePageSize = Math.max(1, pageSize);
  const totalPages = Math.max(1, Math.ceil(items.length / safePageSize));
  const currentPage = clamp(page, 1, totalPages);
  const start = (currentPage - 1) * safePageSize;

  return {
    items: items.slice(start, start + safePageSize),
    currentPage,
    totalPages,
  };
}

function bitrateByPreset(
  resolution: StreamResolutionPreset,
  fps: StreamFpsPreset,
): number {
  if (resolution === "720p") {
    if (fps === 60) {
      return 5_500_000;
    }

    if (fps === 30) {
      return 4_000_000;
    }

    return 2_500_000;
  }

  if (fps === 60) {
    return 8_000_000;
  }

  if (fps === 30) {
    return 6_000_000;
  }

  return 4_000_000;
}

function resolutionByPreset(
  resolution: StreamResolutionPreset,
): { width: number; height: number } {
  return resolution === "1080p"
    ? { width: 1920, height: 1080 }
    : { width: 1280, height: 720 };
}

export function buildScreenShareConfig(
  options: StreamStartOptions,
): StreamShareConfig {
  const fps = options.fps;
  const resolution = resolutionByPreset(options.resolution);
  const maxBitrate = bitrateByPreset(options.resolution, fps);
  const contentHint = options.mode === "text" ? "text" : "motion";
  const systemAudio = options.includeSystemAudio ? "include" : "exclude";

  const baseCaptureOptions: ScreenShareCaptureOptions = {
    resolution: {
      width: resolution.width,
      height: resolution.height,
      frameRate: fps,
    },
    contentHint,
    systemAudio,
    selfBrowserSurface: "include",
    surfaceSwitching: "include",
    audio: options.includeSystemAudio,
  };

  const basePublishOptions: TrackPublishOptions = {
    source: Track.Source.ScreenShare,
    screenShareEncoding: {
      maxBitrate,
      maxFramerate: fps,
    },
    videoEncoding: {
      maxBitrate,
      maxFramerate: fps,
    },
    simulcast: true,
  };

  if (fps < 60) {
    return {
      captureOptions: baseCaptureOptions,
      publishOptions: basePublishOptions,
    };
  }

  const fallbackFps: StreamFpsPreset = 30;
  const fallbackBitrate = bitrateByPreset(options.resolution, fallbackFps);

  return {
    captureOptions: baseCaptureOptions,
    publishOptions: basePublishOptions,
    fallback: {
      captureOptions: {
        ...baseCaptureOptions,
        resolution: {
          width: resolution.width,
          height: resolution.height,
          frameRate: fallbackFps,
        },
      },
      publishOptions: {
        ...basePublishOptions,
        screenShareEncoding: {
          maxBitrate: fallbackBitrate,
          maxFramerate: fallbackFps,
        },
        videoEncoding: {
          maxBitrate: fallbackBitrate,
          maxFramerate: fallbackFps,
        },
      },
      notice: "60 FPS is not supported in this browser. Fallback to 30 FPS.",
    },
  };
}

export function resolvePlaybackLevels(
  requestedVolume: number,
  hasBoostPath: boolean,
): {
  elementVolume: number;
  gainValue: number;
  boosted: boolean;
} {
  const requested = clamp(requestedVolume, 0, 2);

  if (hasBoostPath) {
    return {
      elementVolume: 1,
      gainValue: requested,
      boosted: requested > 1,
    };
  }

  return {
    elementVolume: clamp(requested, 0, 1),
    gainValue: 1,
    boosted: false,
  };
}

export function resolveActivityWithHold(
  level: number,
  threshold: number,
  nowMs: number,
  prevActiveUntilMs: number | undefined,
  holdMs: number,
): {
  isActive: boolean;
  activeUntilMs: number | undefined;
} {
  if (level >= threshold) {
    return {
      isActive: true,
      activeUntilMs: nowMs + holdMs,
    };
  }

  const activeUntilMs = prevActiveUntilMs;
  return {
    isActive: (activeUntilMs ?? 0) > nowMs,
    activeUntilMs,
  };
}
