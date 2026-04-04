import {
  FormEvent,
  MouseEvent,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  createAudioAnalyser,
  createLocalAudioTrack,
  LocalAudioTrack,
  RemoteAudioTrack,
  RemoteParticipant,
  Room,
  RoomEvent,
  supportsAudioOutputSelection,
  Track,
  VideoTrack,
} from "livekit-client";
import {
  Alert,
  AppBar,
  Avatar,
  Badge,
  Box,
  Button,
  Chip,
  Container,
  CssBaseline,
  Divider,
  FormControl,
  FormControlLabel,
  FormGroup,
  GlobalStyles,
  IconButton,
  InputLabel,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Popover,
  Select,
  Slider,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  ThemeProvider,
  ToggleButton,
  ToggleButtonGroup,
  Toolbar,
  Tooltip,
  Typography,
  createTheme,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import type { SelectChangeEvent } from "@mui/material/Select";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import CampaignIcon from "@mui/icons-material/Campaign";
import ForumIcon from "@mui/icons-material/Forum";
import FullscreenIcon from "@mui/icons-material/Fullscreen";
import GraphicEqIcon from "@mui/icons-material/GraphicEq";
import GridViewIcon from "@mui/icons-material/GridView";
import HearingIcon from "@mui/icons-material/Hearing";
import LogoutIcon from "@mui/icons-material/Logout";
import MicIcon from "@mui/icons-material/Mic";
import MicOffIcon from "@mui/icons-material/MicOff";
import MonitorIcon from "@mui/icons-material/Monitor";
import PeopleIcon from "@mui/icons-material/People";
import ScreenShareIcon from "@mui/icons-material/ScreenShare";
import SettingsIcon from "@mui/icons-material/Settings";
import StopScreenShareIcon from "@mui/icons-material/StopScreenShare";
import ViewCarouselIcon from "@mui/icons-material/ViewCarousel";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import {
  CreateInviteResponse,
  GuestAuthResponse,
  JoinRoomResponse,
  RoomDto,
  UserDto,
} from "./types";
import {
  AudioChannel,
  buildMicTrackOptions,
  createInitialLayoutState,
  DEFAULT_DSP_SETTINGS,
  DspSettings,
  getAudioChannelForSource,
  getEffectiveStreamMode,
  hideStreamIdentity,
  resolveFocusedStreamSid,
  restoreStreamIdentity,
  STREAM_PRESETS,
  StreamLayoutMode,
  StreamLayoutState,
  StreamPresetId,
  streamLayoutReducer,
  withoutVoiceIsolation,
} from "./roomState";

const API_BASE = import.meta.env.VITE_API_URL ?? "/api";
const MIN_CHANNEL_VOLUME = 0;
const MAX_CHANNEL_VOLUME = 1;
const DEFAULT_CHANNEL_VOLUME = 1;

type AuthState = {
  user: UserDto;
  appToken: string;
};

type ScreenTrackState = {
  sid: string;
  participantIdentity: string;
  track: VideoTrack;
};

type ParticipantState = {
  identity: string;
  displayName: string;
  isLocal: boolean;
  isScreenSharing: boolean;
  voiceVolume: number;
  streamVolume: number;
  voiceMutedLocal: boolean;
  streamMutedLocal: boolean;
  isVoiceActive: boolean;
  isScreenAudioActive: boolean;
};

type StreamContextMenuState = {
  sid: string;
  identity: string;
  mouseX: number;
  mouseY: number;
};

type AudioAnalyserHandle = {
  calculateVolume: () => number;
  cleanup: () => Promise<void>;
};

type AudioBinding = {
  sid: string;
  identity: string;
  source: AudioChannel;
  track: RemoteAudioTrack;
  element: HTMLAudioElement;
  isActive: boolean;
  analyser?: AudioAnalyserHandle;
  activityIntervalId?: number;
};

const theme = createTheme({
  palette: {
    mode: "dark",
    primary: {
      main: "#4fb7ff",
      light: "#9ce1ff",
    },
    secondary: {
      main: "#45d69f",
    },
    background: {
      default: "#060b12",
      paper: "#101a25",
    },
    error: {
      main: "#ff7575",
    },
  },
  shape: {
    borderRadius: 14,
  },
  typography: {
    fontFamily: '"IBM Plex Sans", "Segoe UI", sans-serif',
    h4: {
      fontWeight: 700,
    },
    h6: {
      fontWeight: 700,
    },
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
          border: "1px solid rgba(128, 182, 219, 0.24)",
          backdropFilter: "blur(10px)",
          transition: "border-color 180ms ease, box-shadow 180ms ease, transform 180ms ease",
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: "none",
          fontWeight: 600,
          transition: "transform 140ms ease, box-shadow 180ms ease",
        },
        contained: {
          boxShadow: "0 8px 24px rgba(7, 16, 25, 0.35)",
          "&:hover": {
            boxShadow: "0 10px 28px rgba(7, 16, 25, 0.45)",
            transform: "translateY(-1px)",
          },
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          transition: "transform 140ms ease, background-color 180ms ease",
          "&:hover": {
            transform: "translateY(-1px)",
          },
        },
      },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          transition: "transform 140ms ease, background-color 180ms ease",
          "&:hover": {
            transform: "translateY(-1px)",
          },
        },
      },
    },
  },
});

function clampVolume(value: number): number {
  return Math.min(MAX_CHANNEL_VOLUME, Math.max(MIN_CHANNEL_VOLUME, value));
}

function volumePercent(value: number): number {
  return Math.round(clampVolume(value) * 100);
}

function initials(value: string): string {
  const parts = value
    .split(" ")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 2)
    .map((item) => item[0]?.toUpperCase() ?? "");

  return parts.join("") || "?";
}

function resolveDisplayName(
  participant: { identity: string; name?: string | undefined },
  fallback?: string,
): string {
  const candidate = participant.name?.trim() || fallback?.trim();
  if (candidate) {
    return candidate;
  }

  return participant.identity || "Unknown";
}

async function apiCall<TResponse>(
  path: string,
  method: "GET" | "POST",
  body?: unknown,
  token?: string,
): Promise<TResponse> {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `HTTP ${response.status}`);
  }

  return (await response.json()) as TResponse;
}

function ScreenTile(props: {
  track: VideoTrack;
  label: string;
  isFocused: boolean;
  isScreenAudioActive: boolean;
  onClick: () => void;
  onHide: () => void;
  onContextMenu: (event: MouseEvent<HTMLElement>) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) {
      return;
    }

    props.track.attach(element);
    return () => {
      props.track.detach(element);
    };
  }, [props.track]);

  const suppressNativeMenu = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <Paper
      onClick={props.onClick}
      onContextMenu={(event) => {
        suppressNativeMenu(event);
        props.onContextMenu(event);
      }}
      onContextMenuCapture={suppressNativeMenu}
      sx={{
        position: "relative",
        overflow: "hidden",
        cursor: "pointer",
        border: props.isScreenAudioActive
          ? "1px solid rgba(69, 214, 159, 0.95)"
          : props.isFocused
            ? "1px solid rgba(79, 183, 255, 0.95)"
            : "1px solid rgba(112, 150, 180, 0.5)",
        boxShadow: props.isScreenAudioActive
          ? "0 0 0 2px rgba(69, 214, 159, 0.24)"
          : props.isFocused
            ? "0 0 0 2px rgba(79, 183, 255, 0.2)"
            : "none",
        transition:
          "transform 160ms ease, border-color 180ms ease, box-shadow 180ms ease",
        "&:hover": {
          transform: "translateY(-2px)",
        },
      }}
    >
      <Box
        component="video"
        ref={videoRef}
        autoPlay
        playsInline
        onContextMenuCapture={suppressNativeMenu}
        sx={{
          width: "100%",
          aspectRatio: "16 / 9",
          display: "block",
          backgroundColor: "#000",
        }}
      />

      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        sx={{
          position: "absolute",
          left: 10,
          bottom: 10,
          bgcolor: "rgba(5, 10, 16, 0.8)",
          borderRadius: 2,
          px: 1,
          py: 0.5,
        }}
      >
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          {props.label}
        </Typography>
        {props.isScreenAudioActive && (
          <Chip
            size="small"
            color="secondary"
            icon={<GraphicEqIcon fontSize="small" />}
            label="Audio"
            sx={{ height: 22 }}
          />
        )}
      </Stack>

      <Tooltip title="Hide this stream locally">
        <IconButton
          size="small"
          onClick={(event) => {
            event.stopPropagation();
            props.onHide();
          }}
          sx={{
            position: "absolute",
            top: 8,
            right: 8,
            bgcolor: "rgba(6, 11, 18, 0.82)",
            border: "1px solid rgba(128, 182, 219, 0.35)",
          }}
        >
          <VisibilityOffIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Paper>
  );
}

function RoomView(props: {
  session: JoinRoomResponse;
  onLeave: () => void;
}) {
  const [connected, setConnected] = useState(false);
  const [muted, setMuted] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [participants, setParticipants] = useState<ParticipantState[]>([]);
  const [screenTracks, setScreenTracks] = useState<ScreenTrackState[]>([]);
  const [hiddenStreamsByIdentity, setHiddenStreamsByIdentity] =
    useState<Record<string, true>>({});

  const [layoutState, dispatchLayout] = useReducer(
    streamLayoutReducer,
    undefined,
    createInitialLayoutState,
  );

  const [streamContextMenu, setStreamContextMenu] =
    useState<StreamContextMenuState | null>(null);

  const [settingsAnchorEl, setSettingsAnchorEl] = useState<HTMLElement | null>(null);
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedInputId, setSelectedInputId] = useState("");
  const [selectedOutputId, setSelectedOutputId] = useState("");
  const [devicesLoading, setDevicesLoading] = useState(false);

  const [dspSettings, setDspSettings] = useState<DspSettings>(DEFAULT_DSP_SETTINGS);
  const [dspApplying, setDspApplying] = useState(false);
  const [selectedStreamPresetId, setSelectedStreamPresetId] =
    useState<StreamPresetId>("game_1080p30");

  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  const [rightPanelTab, setRightPanelTab] = useState<"participants" | "chat">(
    "participants",
  );

  const roomRef = useRef<Room | null>(null);
  const localAudioRef = useRef<LocalAudioTrack | null>(null);
  const audioBindingsRef = useRef<Map<string, AudioBinding>>(new Map());

  const selectedInputRef = useRef("");
  const selectedOutputRef = useRef("");
  const mutedRef = useRef(false);
  const dspSettingsRef = useRef<DspSettings>(DEFAULT_DSP_SETTINGS);

  const voiceVolumeMapRef = useRef<Record<string, number>>({});
  const streamVolumeMapRef = useRef<Record<string, number>>({});
  const voiceMuteMapRef = useRef<Record<string, boolean>>({});
  const streamMuteMapRef = useRef<Record<string, boolean>>({});

  const activeSpeakersRef = useRef<Set<string>>(new Set());
  const voiceActivityRef = useRef<Set<string>>(new Set());
  const screenAudioActivityRef = useRef<Set<string>>(new Set());
  const syncQueuedRef = useRef(false);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    dspSettingsRef.current = dspSettings;
  }, [dspSettings]);

  const participantMap = useMemo(() => {
    return new Map(participants.map((participant) => [participant.identity, participant]));
  }, [participants]);

  const visibleScreenTracks = useMemo(() => {
    return screenTracks.filter((track) => !hiddenStreamsByIdentity[track.participantIdentity]);
  }, [hiddenStreamsByIdentity, screenTracks]);

  const visibleScreenTrackSids = useMemo(
    () => visibleScreenTracks.map((item) => item.sid),
    [visibleScreenTracks],
  );

  useEffect(() => {
    dispatchLayout({ type: "ensure-visible", visibleSids: visibleScreenTrackSids });
  }, [visibleScreenTrackSids]);

  const effectiveStreamMode = getEffectiveStreamMode(layoutState);
  const isTheaterMode = layoutState.mode === "theater";

  const focusedStreamSid = resolveFocusedStreamSid(layoutState, visibleScreenTrackSids);

  const focusedScreenTrack =
    focusedStreamSid !== null
      ? visibleScreenTracks.find((item) => item.sid === focusedStreamSid) ?? null
      : null;

  const secondaryFocusTracks = useMemo(() => {
    if (!focusedStreamSid) {
      return visibleScreenTracks;
    }

    return visibleScreenTracks.filter((item) => item.sid !== focusedStreamSid);
  }, [focusedStreamSid, visibleScreenTracks]);

  const hiddenStreamIdentities = useMemo(() => {
    const activeStreamIdentities = new Set(
      screenTracks.map((item) => item.participantIdentity),
    );

    return Object.keys(hiddenStreamsByIdentity).filter((identity) =>
      activeStreamIdentities.has(identity),
    );
  }, [hiddenStreamsByIdentity, screenTracks]);

  const selectedContextParticipant = useMemo(() => {
    if (!streamContextMenu) {
      return null;
    }

    return participantMap.get(streamContextMenu.identity) ?? null;
  }, [participantMap, streamContextMenu]);

  const queueSyncParticipants = () => {
    if (syncQueuedRef.current) {
      return;
    }

    syncQueuedRef.current = true;
    window.requestAnimationFrame(() => {
      syncQueuedRef.current = false;
      if (roomRef.current) {
        syncParticipants(roomRef.current);
      }
    });
  };

  const applyOutputDevice = async (element: HTMLAudioElement) => {
    const sinkId = selectedOutputRef.current;
    if (!sinkId) {
      return;
    }

    const sinkable = element as HTMLAudioElement & {
      setSinkId?: (nextSinkId: string) => Promise<void>;
      sinkId?: string;
    };

    if (typeof sinkable.setSinkId !== "function") {
      return;
    }

    if (sinkable.sinkId === sinkId) {
      return;
    }

    try {
      await sinkable.setSinkId(sinkId);
    } catch {
      // not all browsers support output switching
    }
  };

  const getChannelVolume = (identity: string, source: AudioChannel): number => {
    const map = source === "voice" ? voiceVolumeMapRef.current : streamVolumeMapRef.current;
    return clampVolume(map[identity] ?? DEFAULT_CHANNEL_VOLUME);
  };

  const getChannelMute = (identity: string, source: AudioChannel): boolean => {
    const map = source === "voice" ? voiceMuteMapRef.current : streamMuteMapRef.current;
    return Boolean(map[identity]);
  };

  const applyBindingAudioSettings = (binding: AudioBinding) => {
    const volume = getChannelVolume(binding.identity, binding.source);
    const mutedLocal = getChannelMute(binding.identity, binding.source);

    binding.element.volume = mutedLocal ? 0 : volume;
    binding.element.muted = false;
    void applyOutputDevice(binding.element);
  };

  const applyAudioSettings = (identity: string, source?: AudioChannel) => {
    for (const binding of audioBindingsRef.current.values()) {
      if (binding.identity !== identity) {
        continue;
      }

      if (source && binding.source !== source) {
        continue;
      }

      applyBindingAudioSettings(binding);
    }
  };

  const setSourceActivity = (
    identity: string,
    source: AudioChannel,
    active: boolean,
  ) => {
    const setRef = source === "voice" ? voiceActivityRef.current : screenAudioActivityRef.current;
    const hadValue = setRef.has(identity);

    if (active && !hadValue) {
      setRef.add(identity);
      queueSyncParticipants();
      return;
    }

    if (!active && hadValue) {
      setRef.delete(identity);
      queueSyncParticipants();
    }
  };

  const recomputeIdentitySourceActivity = (
    identity: string,
    source: AudioChannel,
  ) => {
    const hasActive = Array.from(audioBindingsRef.current.values()).some(
      (binding) =>
        binding.identity === identity &&
        binding.source === source &&
        binding.isActive,
    );

    setSourceActivity(identity, source, hasActive);
  };

  const cleanupBinding = (binding: AudioBinding) => {
    if (binding.activityIntervalId !== undefined) {
      window.clearInterval(binding.activityIntervalId);
    }

    if (binding.analyser) {
      void binding.analyser.cleanup();
    }

    binding.track.detach(binding.element);
    binding.element.pause();
    binding.element.srcObject = null;
    binding.element.remove();

    audioBindingsRef.current.delete(binding.sid);
    binding.isActive = false;
    recomputeIdentitySourceActivity(binding.identity, binding.source);
  };

  const cleanupParticipantAudio = (identity: string) => {
    const toRemove = Array.from(audioBindingsRef.current.values()).filter(
      (binding) => binding.identity === identity,
    );

    for (const binding of toRemove) {
      cleanupBinding(binding);
    }
  };

  const syncParticipants = (room: Room) => {
    const remoteParticipants = Array.from(room.remoteParticipants.values());
    const remoteIdentitySet = new Set(remoteParticipants.map((item) => item.identity));

    const cleanupMap = <T,>(map: Record<string, T>) => {
      for (const identity of Object.keys(map)) {
        if (!remoteIdentitySet.has(identity)) {
          delete map[identity];
        }
      }
    };

    cleanupMap(voiceVolumeMapRef.current);
    cleanupMap(streamVolumeMapRef.current);
    cleanupMap(voiceMuteMapRef.current);
    cleanupMap(streamMuteMapRef.current);

    for (const identity of Array.from(voiceActivityRef.current.values())) {
      if (!remoteIdentitySet.has(identity)) {
        voiceActivityRef.current.delete(identity);
      }
    }

    for (const identity of Array.from(screenAudioActivityRef.current.values())) {
      if (!remoteIdentitySet.has(identity)) {
        screenAudioActivityRef.current.delete(identity);
      }
    }

    const localIdentity = room.localParticipant.identity;
    const localState: ParticipantState = {
      identity: localIdentity,
      displayName: resolveDisplayName(room.localParticipant, props.session.user.nickname),
      isLocal: true,
      isScreenSharing: room.localParticipant.isScreenShareEnabled,
      voiceVolume: DEFAULT_CHANNEL_VOLUME,
      streamVolume: DEFAULT_CHANNEL_VOLUME,
      voiceMutedLocal: mutedRef.current,
      streamMutedLocal: false,
      isVoiceActive:
        activeSpeakersRef.current.has(localIdentity) || voiceActivityRef.current.has(localIdentity),
      isScreenAudioActive: screenAudioActivityRef.current.has(localIdentity),
    };

    const remoteStates = remoteParticipants
      .map((participant): ParticipantState => {
        const identity = participant.identity;

        if (voiceVolumeMapRef.current[identity] === undefined) {
          voiceVolumeMapRef.current[identity] = DEFAULT_CHANNEL_VOLUME;
        }

        if (streamVolumeMapRef.current[identity] === undefined) {
          streamVolumeMapRef.current[identity] = DEFAULT_CHANNEL_VOLUME;
        }

        if (voiceMuteMapRef.current[identity] === undefined) {
          voiceMuteMapRef.current[identity] = false;
        }

        if (streamMuteMapRef.current[identity] === undefined) {
          streamMuteMapRef.current[identity] = false;
        }

        return {
          identity,
          displayName: resolveDisplayName(participant),
          isLocal: false,
          isScreenSharing: participant.isScreenShareEnabled,
          voiceVolume: voiceVolumeMapRef.current[identity],
          streamVolume: streamVolumeMapRef.current[identity],
          voiceMutedLocal: Boolean(voiceMuteMapRef.current[identity]),
          streamMutedLocal: Boolean(streamMuteMapRef.current[identity]),
          isVoiceActive:
            voiceActivityRef.current.has(identity) || activeSpeakersRef.current.has(identity),
          isScreenAudioActive: screenAudioActivityRef.current.has(identity),
        };
      })
      .sort((left, right) => {
        if (left.isVoiceActive !== right.isVoiceActive) {
          return left.isVoiceActive ? -1 : 1;
        }

        return left.displayName.localeCompare(right.displayName);
      });

    setParticipants([localState, ...remoteStates]);
  };

  const refreshDevices = async (requestPermissions: boolean) => {
    setDevicesLoading(true);

    try {
      const inputs = await Room.getLocalDevices("audioinput", requestPermissions);
      setInputDevices(inputs);
      setSelectedInputId((previous) => {
        const fallback = inputs[0]?.deviceId ?? "";
        const next = previous || selectedInputRef.current || fallback;
        selectedInputRef.current = next;
        return next;
      });

      if (supportsAudioOutputSelection()) {
        const outputs = await Room.getLocalDevices("audiooutput", false);
        setOutputDevices(outputs);
        setSelectedOutputId((previous) => {
          const fallback = outputs[0]?.deviceId ?? "";
          const next = previous || selectedOutputRef.current || fallback;
          selectedOutputRef.current = next;
          return next;
        });
      } else {
        setOutputDevices([]);
        setSelectedOutputId("");
        selectedOutputRef.current = "";
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Failed to read media devices.";
      setError(message);
    } finally {
      setDevicesLoading(false);
    }
  };

  const createLocalMicrophoneTrack = async (deviceId?: string) => {
    const micOptions = buildMicTrackOptions(dspSettingsRef.current, deviceId);

    try {
      return await createLocalAudioTrack(micOptions as any);
    } catch (reason) {
      if (micOptions.voiceIsolation) {
        const fallbackOptions = withoutVoiceIsolation(micOptions);
        try {
          setError("Voice isolation unsupported in this browser. Fallback applied.");
          return await createLocalAudioTrack(fallbackOptions as any);
        } catch {
          // continue to throw original failure below
        }
      }

      throw reason;
    }
  };

  const createAndPublishMicrophoneTrack = async (room: Room, deviceId?: string) => {
    if (localAudioRef.current) {
      await room.localParticipant.unpublishTrack(localAudioRef.current);
      localAudioRef.current.stop();
      localAudioRef.current = null;
    }

    const microphone = await createLocalMicrophoneTrack(deviceId);

    await room.localParticipant.publishTrack(microphone, {
      source: Track.Source.Microphone,
    });

    if (mutedRef.current) {
      await microphone.mute();
    }

    localAudioRef.current = microphone;
  };

  useEffect(() => {
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
    });

    roomRef.current = room;

    const onTrackSubscribed = (
      track: Track,
      _publication: unknown,
      participant: RemoteParticipant,
    ) => {
      if (track.kind === Track.Kind.Audio) {
        const source = getAudioChannelForSource(track.source);
        const sid = track.sid ?? `${participant.identity}-${source}-${Date.now()}`;

        if (!audioBindingsRef.current.has(sid)) {
          const element = new Audio();
          element.autoplay = true;

          const remoteAudioTrack = track as RemoteAudioTrack;
          remoteAudioTrack.attach(element);

          const binding: AudioBinding = {
            sid,
            identity: participant.identity,
            source,
            track: remoteAudioTrack,
            element,
            isActive: false,
          };

          try {
            const analyser = createAudioAnalyser(remoteAudioTrack, { cloneTrack: false });
            binding.analyser = analyser as AudioAnalyserHandle;
            binding.activityIntervalId = window.setInterval(() => {
              if (!binding.analyser) {
                return;
              }

              const level = binding.analyser.calculateVolume();
              const threshold = binding.source === "voice" ? 0.035 : 0.02;
              const nextActive = level >= threshold;

              if (binding.isActive !== nextActive) {
                binding.isActive = nextActive;
                recomputeIdentitySourceActivity(binding.identity, binding.source);
              }
            }, 180);
          } catch {
            // analyser is best-effort for source-specific activity indicators
          }

          audioBindingsRef.current.set(binding.sid, binding);
          applyBindingAudioSettings(binding);
        }
      }

      if (track.kind === Track.Kind.Video && track.source === Track.Source.ScreenShare) {
        const sid = track.sid ?? `${participant.identity}-screen`;
        setScreenTracks((previous) => {
          if (previous.some((item) => item.sid === sid)) {
            return previous;
          }

          return [
            ...previous,
            {
              sid,
              participantIdentity: participant.identity,
              track: track as VideoTrack,
            },
          ];
        });
      }

      syncParticipants(room);
    };

    const onTrackUnsubscribed = (
      track: Track,
      _publication: unknown,
      participant: RemoteParticipant,
    ) => {
      if (track.kind === Track.Kind.Audio) {
        const direct = track.sid ? audioBindingsRef.current.get(track.sid) : undefined;
        const fallbackBinding = Array.from(audioBindingsRef.current.values()).find(
          (binding) => binding.track === track,
        );
        const binding = direct ?? fallbackBinding;

        if (binding) {
          cleanupBinding(binding);
        }
      }

      if (track.kind === Track.Kind.Video && track.source === Track.Source.ScreenShare) {
        const sid = track.sid ?? `${participant.identity}-screen`;
        dispatchLayout({ type: "remove-stream", sid });
        setScreenTracks((previous) => previous.filter((item) => item.sid !== sid));
      }

      syncParticipants(room);
    };

    const onParticipantDisconnected = (participant: RemoteParticipant) => {
      cleanupParticipantAudio(participant.identity);
      voiceActivityRef.current.delete(participant.identity);
      screenAudioActivityRef.current.delete(participant.identity);

      setScreenTracks((previous) =>
        previous.filter((item) => item.participantIdentity !== participant.identity),
      );

      setHiddenStreamsByIdentity((previous) => restoreStreamIdentity(previous, participant.identity));

      delete voiceVolumeMapRef.current[participant.identity];
      delete streamVolumeMapRef.current[participant.identity];
      delete voiceMuteMapRef.current[participant.identity];
      delete streamMuteMapRef.current[participant.identity];

      syncParticipants(room);
    };

    const onActiveSpeakersChanged = (
      activeParticipants: Array<{ identity: string }>,
    ) => {
      activeSpeakersRef.current = new Set(
        activeParticipants.map((item) => item.identity),
      );
      queueSyncParticipants();
    };

    room.on(RoomEvent.TrackSubscribed, onTrackSubscribed);
    room.on(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
    room.on(RoomEvent.ParticipantConnected, () => syncParticipants(room));
    room.on(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
    room.on(RoomEvent.ParticipantNameChanged, () => syncParticipants(room));
    room.on(RoomEvent.MediaDevicesChanged, () => {
      void refreshDevices(false);
    });
    room.on(RoomEvent.ActiveSpeakersChanged, onActiveSpeakersChanged);
    room.on(RoomEvent.Disconnected, () => {
      setConnected(false);
      setSharing(false);
    });
    room.on(RoomEvent.LocalTrackPublished, (publication) => {
      if (publication.track?.source === Track.Source.ScreenShare) {
        setSharing(true);
      }
    });
    room.on(RoomEvent.LocalTrackUnpublished, (publication) => {
      if (publication.track?.source === Track.Source.ScreenShare) {
        setSharing(false);
      }
    });

    const connect = async () => {
      try {
        await room.connect(props.session.rtcUrl, props.session.rtcToken, {
          autoSubscribe: true,
        });

        await refreshDevices(true);
        await createAndPublishMicrophoneTrack(room, selectedInputRef.current || undefined);
        await room.startAudio();

        syncParticipants(room);
        setConnected(true);
        setError(null);
      } catch (reason) {
        const message =
          reason instanceof Error ? reason.message : "Failed to connect to the room.";
        setError(message);
      }
    };

    void connect();

    return () => {
      room.off(RoomEvent.TrackSubscribed, onTrackSubscribed);
      room.off(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
      room.off(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
      room.off(RoomEvent.ActiveSpeakersChanged, onActiveSpeakersChanged);

      void room.disconnect();

      localAudioRef.current?.stop();
      localAudioRef.current = null;

      for (const binding of Array.from(audioBindingsRef.current.values())) {
        cleanupBinding(binding);
      }

      audioBindingsRef.current.clear();
      roomRef.current = null;
    };
  }, [props.session.rtcToken, props.session.rtcUrl, props.session.user.nickname]);

  const patchParticipant = (identity: string, patch: Partial<ParticipantState>) => {
    setParticipants((previous) =>
      previous.map((participant) =>
        participant.identity === identity ? { ...participant, ...patch } : participant,
      ),
    );
  };

  const setChannelVolume = (identity: string, source: AudioChannel, value: number) => {
    const next = clampVolume(value);

    if (source === "voice") {
      voiceVolumeMapRef.current[identity] = next;
      patchParticipant(identity, { voiceVolume: next });
    } else {
      streamVolumeMapRef.current[identity] = next;
      patchParticipant(identity, { streamVolume: next });
    }

    applyAudioSettings(identity, source);
  };

  const setChannelMuted = (identity: string, source: AudioChannel, mutedLocal: boolean) => {
    if (source === "voice") {
      voiceMuteMapRef.current[identity] = mutedLocal;
      patchParticipant(identity, { voiceMutedLocal: mutedLocal });
    } else {
      streamMuteMapRef.current[identity] = mutedLocal;
      patchParticipant(identity, { streamMutedLocal: mutedLocal });
    }

    applyAudioSettings(identity, source);
  };

  const handleLocalMuteToggle = async () => {
    const nextMuted = !muted;
    setMuted(nextMuted);

    if (!localAudioRef.current) {
      return;
    }

    if (nextMuted) {
      await localAudioRef.current.mute();
    } else {
      await localAudioRef.current.unmute();
    }

    const localIdentity =
      roomRef.current?.localParticipant.identity ?? props.session.user.id;
    patchParticipant(localIdentity, { voiceMutedLocal: nextMuted });
  };

  const handleHideStream = (identity: string) => {
    setHiddenStreamsByIdentity((previous) => hideStreamIdentity(previous, identity));
  };

  const handleRestoreStream = (identity: string) => {
    setHiddenStreamsByIdentity((previous) => restoreStreamIdentity(previous, identity));
  };

  const handleLayoutModeChange = (
    _event: MouseEvent<HTMLElement>,
    nextMode: StreamLayoutMode | null,
  ) => {
    if (!nextMode) {
      return;
    }

    dispatchLayout({ type: "set-mode", mode: nextMode });
  };

  const handleScreenShareToggle = async () => {
    if (!roomRef.current) {
      return;
    }

    try {
      if (sharing) {
        await roomRef.current.localParticipant.setScreenShareEnabled(false);
        setSharing(false);
        return;
      }

      const preset = STREAM_PRESETS[selectedStreamPresetId];
      try {
        await roomRef.current.localParticipant.setScreenShareEnabled(
          true,
          preset.captureOptions,
          preset.publishOptions,
        );
      } catch (reason) {
        if (!preset.fallbackPresetId) {
          throw reason;
        }

        const fallback = STREAM_PRESETS[preset.fallbackPresetId];
        await roomRef.current.localParticipant.setScreenShareEnabled(
          true,
          fallback.captureOptions,
          fallback.publishOptions,
        );
        setSelectedStreamPresetId(fallback.id);
        setError(`${preset.label} is not supported in this browser. Fallback to ${fallback.label}.`);
      }

      setSharing(true);
      setError(null);
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : "Failed to start screen share.";
      setError(message);
      setSharing(roomRef.current.localParticipant.isScreenShareEnabled);
    }
  };

  const handleMicrophoneDeviceChange = async (event: SelectChangeEvent<string>) => {
    const nextDeviceId = event.target.value;
    if (!nextDeviceId) {
      return;
    }

    setSelectedInputId(nextDeviceId);
    selectedInputRef.current = nextDeviceId;

    const room = roomRef.current;
    if (!room) {
      return;
    }

    setDevicesLoading(true);
    try {
      const switched = await room.switchActiveDevice("audioinput", nextDeviceId, true);
      if (!switched) {
        await createAndPublishMicrophoneTrack(room, nextDeviceId);
      }
      setError(null);
    } catch {
      try {
        await createAndPublishMicrophoneTrack(room, nextDeviceId);
        setError(null);
      } catch (reason) {
        const message =
          reason instanceof Error ? reason.message : "Could not switch microphone.";
        setError(message);
      }
    } finally {
      setDevicesLoading(false);
      syncParticipants(room);
    }
  };

  const handleOutputDeviceChange = async (event: SelectChangeEvent<string>) => {
    const nextDeviceId = event.target.value;
    setSelectedOutputId(nextDeviceId);
    selectedOutputRef.current = nextDeviceId;

    const room = roomRef.current;
    if (room) {
      try {
        await room.switchActiveDevice("audiooutput", nextDeviceId, true);
      } catch {
        // browser support differs; keep best-effort mode
      }
    }

    for (const binding of audioBindingsRef.current.values()) {
      void applyOutputDevice(binding.element);
    }
  };

  const handleApplyDspSettings = async () => {
    const room = roomRef.current;
    if (!room) {
      return;
    }

    setDspApplying(true);
    try {
      await createAndPublishMicrophoneTrack(room, selectedInputRef.current || undefined);
      setError(null);
    } catch (reason) {
      const message =
        reason instanceof Error
          ? reason.message
          : "Could not apply microphone processing options.";
      setError(message);
    } finally {
      setDspApplying(false);
      syncParticipants(room);
    }
  };

  const remoteParticipants = participants.filter((participant) => !participant.isLocal);

  const selectedContextTrack =
    streamContextMenu !== null
      ? visibleScreenTracks.find((track) => track.sid === streamContextMenu.sid) ?? null
      : null;

  const renderStreamTile = (item: ScreenTrackState, isFocused: boolean) => {
    const participant = participantMap.get(item.participantIdentity);
    const label = participant?.displayName ?? item.participantIdentity;
    const isScreenAudioActive = participant?.isScreenAudioActive ?? false;

    return (
      <ScreenTile
        key={item.sid}
        track={item.track}
        label={label}
        isFocused={isFocused}
        isScreenAudioActive={isScreenAudioActive}
        onClick={() => {
          dispatchLayout({ type: "set-mode", mode: "focus" });
          dispatchLayout({ type: "set-focus", sid: item.sid });
        }}
        onHide={() => handleHideStream(item.participantIdentity)}
        onContextMenu={(event) => {
          setStreamContextMenu({
            sid: item.sid,
            identity: item.participantIdentity,
            mouseX: event.clientX + 2,
            mouseY: event.clientY - 6,
          });
        }}
      />
    );
  };

  const suppressStreamNativeMenu = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const settingsOpen = Boolean(settingsAnchorEl);

  return (
    <Box>
      <AppBar
        position="static"
        color="transparent"
        elevation={0}
        sx={{
          borderBottom: "1px solid rgba(115, 158, 191, 0.2)",
          backdropFilter: "blur(10px)",
          background:
            "linear-gradient(110deg, rgba(9, 21, 32, 0.85), rgba(10, 36, 28, 0.62))",
        }}
      >
        <Toolbar sx={{ gap: 1.3, flexWrap: "wrap" }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ flexGrow: 1 }}>
            <MonitorIcon color="primary" />
            <Box>
              <Typography variant="h6">{props.session.room.name}</Typography>
              <Typography variant="caption" color="text.secondary">
                {connected ? "Connected to voice" : "Connecting to room..."}
              </Typography>
            </Box>
          </Stack>

          <Chip
            icon={<GraphicEqIcon />}
            color={connected ? "secondary" : "default"}
            label={connected ? "Voice online" : "Voice offline"}
            variant={connected ? "filled" : "outlined"}
          />

          <ToggleButtonGroup
            size="small"
            value={layoutState.mode}
            exclusive
            onChange={handleLayoutModeChange}
            sx={{
              ".MuiToggleButton-root": {
                px: 1,
              },
            }}
          >
            <ToggleButton value="grid" aria-label="Grid layout">
              <Tooltip title="Grid layout">
                <GridViewIcon fontSize="small" />
              </Tooltip>
            </ToggleButton>
            <ToggleButton value="focus" aria-label="Focus layout">
              <Tooltip title="Focus layout">
                <ViewCarouselIcon fontSize="small" />
              </Tooltip>
            </ToggleButton>
            <ToggleButton value="theater" aria-label="Theater mode">
              <Tooltip title="Theater mode">
                <FullscreenIcon fontSize="small" />
              </Tooltip>
            </ToggleButton>
          </ToggleButtonGroup>

          <Tooltip title="Room settings">
            <IconButton
              aria-label="Room settings"
              color={settingsOpen ? "secondary" : "default"}
              onClick={(event) => {
                setSettingsAnchorEl(event.currentTarget);
              }}
            >
              <SettingsIcon />
            </IconButton>
          </Tooltip>

          <Tooltip title={muted ? "Unmute microphone" : "Mute microphone"}>
            <IconButton
              aria-label={muted ? "Unmute microphone" : "Mute microphone"}
              color={muted ? "error" : "primary"}
              onClick={handleLocalMuteToggle}
            >
              {muted ? <MicOffIcon /> : <MicIcon />}
            </IconButton>
          </Tooltip>

          <Button
            onClick={handleScreenShareToggle}
            startIcon={sharing ? <StopScreenShareIcon /> : <ScreenShareIcon />}
            color={sharing ? "error" : "primary"}
            variant={sharing ? "outlined" : "contained"}
          >
            {sharing ? "Stop Share" : "Share Screen"}
          </Button>

          <Button
            onClick={props.onLeave}
            startIcon={<LogoutIcon />}
            color="inherit"
            variant="outlined"
          >
            Leave
          </Button>
        </Toolbar>
      </AppBar>

      <Popover
        open={settingsOpen}
        anchorEl={settingsAnchorEl}
        onClose={() => setSettingsAnchorEl(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <Box sx={{ p: 2, width: { xs: 310, sm: 390 }, maxWidth: "92vw" }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
            Room Settings
          </Typography>

          <Stack spacing={1.5}>
            <FormControl fullWidth size="small" disabled={devicesLoading || inputDevices.length === 0}>
              <InputLabel id="settings-input-label">Microphone</InputLabel>
              <Select
                labelId="settings-input-label"
                value={selectedInputId}
                label="Microphone"
                onChange={(event) => {
                  void handleMicrophoneDeviceChange(event);
                }}
              >
                {inputDevices.map((device) => (
                  <MenuItem key={device.deviceId} value={device.deviceId}>
                    {device.label || "Microphone"}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl
              fullWidth
              size="small"
              disabled={
                devicesLoading ||
                !supportsAudioOutputSelection() ||
                outputDevices.length === 0
              }
            >
              <InputLabel id="settings-output-label">Output</InputLabel>
              <Select
                labelId="settings-output-label"
                value={selectedOutputId}
                label="Output"
                onChange={(event) => {
                  void handleOutputDeviceChange(event);
                }}
              >
                {outputDevices.map((device) => (
                  <MenuItem key={device.deviceId} value={device.deviceId}>
                    {device.label || "Speakers"}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <Divider />

            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Microphone Processing
            </Typography>
            <FormGroup>
              <FormControlLabel
                control={
                  <Switch
                    checked={dspSettings.echoCancellation}
                    onChange={(event) =>
                      setDspSettings((previous) => ({
                        ...previous,
                        echoCancellation: event.target.checked,
                      }))
                    }
                  />
                }
                label="Echo cancellation"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={dspSettings.noiseSuppression}
                    onChange={(event) =>
                      setDspSettings((previous) => ({
                        ...previous,
                        noiseSuppression: event.target.checked,
                      }))
                    }
                  />
                }
                label="Noise suppression"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={dspSettings.autoGainControl}
                    onChange={(event) =>
                      setDspSettings((previous) => ({
                        ...previous,
                        autoGainControl: event.target.checked,
                      }))
                    }
                  />
                }
                label="Auto gain control"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={dspSettings.voiceIsolation}
                    onChange={(event) =>
                      setDspSettings((previous) => ({
                        ...previous,
                        voiceIsolation: event.target.checked,
                      }))
                    }
                  />
                }
                label="Voice isolation (experimental)"
              />
            </FormGroup>

            <Button
              variant="outlined"
              onClick={() => {
                void handleApplyDspSettings();
              }}
              disabled={dspApplying}
            >
              {dspApplying ? "Applying..." : "Apply Microphone Settings"}
            </Button>

            <Divider />

            <FormControl fullWidth size="small">
              <InputLabel id="settings-stream-preset-label">Stream preset</InputLabel>
              <Select
                labelId="settings-stream-preset-label"
                value={selectedStreamPresetId}
                label="Stream preset"
                onChange={(event) => {
                  setSelectedStreamPresetId(event.target.value as StreamPresetId);
                }}
              >
                {Object.values(STREAM_PRESETS).map((preset) => (
                  <MenuItem key={preset.id} value={preset.id}>
                    {preset.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <Typography variant="caption" color="text.secondary">
              {STREAM_PRESETS[selectedStreamPresetId].description}
            </Typography>

            {sharing && (
              <Alert severity="info" sx={{ py: 0.5 }}>
                Preset change applies after restarting screen share.
              </Alert>
            )}
          </Stack>
        </Box>
      </Popover>

      <Container maxWidth={false} sx={{ py: 2 }}>
        {error && (
          <Alert
            severity="error"
            sx={{ mb: 2 }}
            onClose={() => {
              setError(null);
            }}
          >
            {error}
          </Alert>
        )}

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "1fr",
              lg: isTheaterMode
                ? "1fr"
                : rightPanelCollapsed
                  ? "minmax(0, 1fr) 56px"
                  : "minmax(0, 1fr) 350px",
            },
            gap: 2,
            alignItems: "start",
          }}
        >
          <Paper sx={{ p: 2 }} onContextMenuCapture={suppressStreamNativeMenu}>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1}
              justifyContent="space-between"
              alignItems={{ xs: "flex-start", sm: "center" }}
              sx={{ mb: 2 }}
            >
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                  Streams
                </Typography>
                <Chip
                  label={`${visibleScreenTracks.length} visible`}
                  size="small"
                  color={visibleScreenTracks.length > 0 ? "primary" : "default"}
                  variant={visibleScreenTracks.length > 0 ? "filled" : "outlined"}
                />
              </Stack>

              <Stack direction="row" spacing={1} alignItems="center">
                <Chip
                  size="small"
                  variant="outlined"
                  label={
                    layoutState.mode === "theater"
                      ? `Theater (${getEffectiveStreamMode(layoutState)})`
                      : effectiveStreamMode === "focus"
                        ? "Focus"
                        : "Grid"
                  }
                />
                {!isTheaterMode && (
                  <Tooltip title="Collapse right panel">
                    <IconButton
                      size="small"
                      onClick={() => setRightPanelCollapsed(true)}
                    >
                      <FullscreenIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              </Stack>
            </Stack>

            {hiddenStreamIdentities.length > 0 && (
              <Stack direction="row" spacing={0.8} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
                <Typography variant="caption" color="text.secondary" sx={{ alignSelf: "center" }}>
                  Hidden streams:
                </Typography>
                {hiddenStreamIdentities.map((identity) => {
                  const participant = participantMap.get(identity);
                  const label = participant?.displayName ?? identity;
                  return (
                    <Chip
                      key={identity}
                      icon={<VisibilityIcon fontSize="small" />}
                      label={label}
                      onClick={() => handleRestoreStream(identity)}
                      variant="outlined"
                      size="small"
                    />
                  );
                })}
              </Stack>
            )}

            {visibleScreenTracks.length === 0 && (
              <Paper
                variant="outlined"
                sx={{
                  borderStyle: "dashed",
                  p: 3,
                  textAlign: "center",
                  bgcolor: alpha("#4fb7ff", 0.08),
                }}
              >
                <Typography variant="body1" sx={{ mb: 0.5 }}>
                  No visible streams right now.
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Start sharing or restore hidden streams from chips above.
                </Typography>
              </Paper>
            )}

            {visibleScreenTracks.length > 0 && effectiveStreamMode === "grid" && (
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                  gap: 1.2,
                }}
              >
                {visibleScreenTracks.map((item) =>
                  renderStreamTile(item, item.sid === focusedStreamSid),
                )}
              </Box>
            )}

            {visibleScreenTracks.length > 0 && effectiveStreamMode === "focus" && (
              <Stack spacing={1.2}>
                {focusedScreenTrack && (
                  <Box>{renderStreamTile(focusedScreenTrack, true)}</Box>
                )}

                {secondaryFocusTracks.length > 0 && (
                  <Box
                    sx={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
                      gap: 1,
                    }}
                  >
                    {secondaryFocusTracks.map((item) =>
                      renderStreamTile(item, false),
                    )}
                  </Box>
                )}
              </Stack>
            )}
          </Paper>

          {!isTheaterMode && !rightPanelCollapsed && (
            <Paper sx={{ p: 1.2 }}>
              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 0.5 }}>
                <Tabs
                  value={rightPanelTab}
                  onChange={(_, value: "participants" | "chat") => setRightPanelTab(value)}
                  sx={{ minHeight: 36 }}
                >
                  <Tab
                    icon={<PeopleIcon fontSize="small" />}
                    iconPosition="start"
                    label="Participants"
                    value="participants"
                    sx={{ minHeight: 36, textTransform: "none" }}
                  />
                  <Tab
                    icon={<ForumIcon fontSize="small" />}
                    iconPosition="start"
                    label="Chat"
                    value="chat"
                    sx={{ minHeight: 36, textTransform: "none" }}
                  />
                </Tabs>

                <Tooltip title="Collapse panel">
                  <IconButton size="small" onClick={() => setRightPanelCollapsed(true)}>
                    <VisibilityOffIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>

              <Divider sx={{ my: 1 }} />

              {rightPanelTab === "participants" && (
                <Box>
                  <Typography variant="subtitle2" sx={{ px: 1, mb: 1.2, fontWeight: 700 }}>
                    Participants ({participants.length})
                  </Typography>

                  <List disablePadding>
                    {participants.map((participant) => (
                      <ListItem
                        key={participant.identity}
                        disableGutters
                        sx={{
                          display: "block",
                          p: 1,
                          mb: 0.8,
                          borderRadius: 1.5,
                          border: participant.isVoiceActive
                            ? "1px solid rgba(69, 214, 159, 0.88)"
                            : "1px solid rgba(128, 182, 219, 0.15)",
                          boxShadow: participant.isVoiceActive
                            ? "0 0 0 1px rgba(69, 214, 159, 0.24)"
                            : "none",
                          backgroundColor: alpha("#102030", 0.35),
                        }}
                      >
                        <Stack direction="row" spacing={1.1} alignItems="center">
                          <ListItemAvatar sx={{ minWidth: 0 }}>
                            <Badge
                              overlap="circular"
                              color="secondary"
                              variant="dot"
                              invisible={!participant.isVoiceActive}
                              anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
                            >
                              <Avatar
                                sx={{
                                  width: 34,
                                  height: 34,
                                  bgcolor: alpha("#4fb7ff", 0.28),
                                }}
                              >
                                {initials(participant.displayName)}
                              </Avatar>
                            </Badge>
                          </ListItemAvatar>

                          <ListItemText
                            primary={
                              <Stack direction="row" spacing={0.7} alignItems="center" flexWrap="wrap" useFlexGap>
                                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                                  {participant.displayName}
                                </Typography>
                                {participant.isLocal && (
                                  <Chip size="small" label="You" variant="outlined" sx={{ height: 20 }} />
                                )}
                                {participant.isVoiceActive && (
                                  <Chip
                                    size="small"
                                    color="secondary"
                                    icon={<MicIcon fontSize="small" />}
                                    label="Voice"
                                    sx={{ height: 20 }}
                                  />
                                )}
                                {participant.isScreenAudioActive && (
                                  <Chip
                                    size="small"
                                    color="secondary"
                                    icon={<CampaignIcon fontSize="small" />}
                                    label="Stream audio"
                                    sx={{ height: 20 }}
                                  />
                                )}
                                {participant.isScreenSharing && (
                                  <Chip
                                    size="small"
                                    color="primary"
                                    icon={<ScreenShareIcon fontSize="small" />}
                                    label="Streaming"
                                    sx={{ height: 20 }}
                                  />
                                )}
                              </Stack>
                            }
                          />
                        </Stack>

                        {!participant.isLocal && (
                          <Stack spacing={1} sx={{ mt: 1, pl: 0.2 }}>
                            <Stack direction="row" spacing={1} alignItems="center">
                              <Typography variant="caption" sx={{ width: 46 }}>
                                Voice
                              </Typography>
                              <Slider
                                min={0}
                                max={100}
                                step={5}
                                value={volumePercent(participant.voiceVolume)}
                                onChange={(_, value) => {
                                  const next = Array.isArray(value) ? value[0] : value;
                                  setChannelVolume(participant.identity, "voice", next / 100);
                                }}
                                sx={{ flexGrow: 1 }}
                              />
                              <Typography variant="caption" sx={{ width: 34 }}>
                                {volumePercent(participant.voiceVolume)}%
                              </Typography>
                              <IconButton
                                size="small"
                                color={participant.voiceMutedLocal ? "error" : "default"}
                                onClick={() =>
                                  setChannelMuted(
                                    participant.identity,
                                    "voice",
                                    !participant.voiceMutedLocal,
                                  )
                                }
                              >
                                {participant.voiceMutedLocal ? (
                                  <MicOffIcon fontSize="small" />
                                ) : (
                                  <MicIcon fontSize="small" />
                                )}
                              </IconButton>
                            </Stack>

                            <Stack direction="row" spacing={1} alignItems="center">
                              <Typography variant="caption" sx={{ width: 46 }}>
                                Stream
                              </Typography>
                              <Slider
                                min={0}
                                max={100}
                                step={5}
                                value={volumePercent(participant.streamVolume)}
                                onChange={(_, value) => {
                                  const next = Array.isArray(value) ? value[0] : value;
                                  setChannelVolume(participant.identity, "stream", next / 100);
                                }}
                                sx={{ flexGrow: 1 }}
                              />
                              <Typography variant="caption" sx={{ width: 34 }}>
                                {volumePercent(participant.streamVolume)}%
                              </Typography>
                              <IconButton
                                size="small"
                                color={participant.streamMutedLocal ? "error" : "default"}
                                onClick={() =>
                                  setChannelMuted(
                                    participant.identity,
                                    "stream",
                                    !participant.streamMutedLocal,
                                  )
                                }
                              >
                                {participant.streamMutedLocal ? (
                                  <VisibilityOffIcon fontSize="small" />
                                ) : (
                                  <CampaignIcon fontSize="small" />
                                )}
                              </IconButton>
                            </Stack>
                          </Stack>
                        )}
                      </ListItem>
                    ))}
                  </List>

                  {remoteParticipants.length === 0 && (
                    <Typography variant="body2" color="text.secondary" sx={{ px: 1, py: 0.5 }}>
                      Invite friends to unlock per-user voice and stream controls.
                    </Typography>
                  )}
                </Box>
              )}

              {rightPanelTab === "chat" && (
                <Paper
                  variant="outlined"
                  sx={{
                    p: 2,
                    borderStyle: "dashed",
                    textAlign: "center",
                    bgcolor: alpha("#4fb7ff", 0.08),
                  }}
                >
                  <ChatBubbleOutlineIcon color="primary" sx={{ mb: 1 }} />
                  <Typography variant="body1" sx={{ fontWeight: 700 }}>
                    Chat (soon)
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    This panel is reserved for upcoming room text chat.
                  </Typography>
                </Paper>
              )}
            </Paper>
          )}

          {!isTheaterMode && rightPanelCollapsed && (
            <Paper
              sx={{
                p: 0.5,
                display: "grid",
                gap: 0.6,
                justifyItems: "center",
              }}
            >
              <Tooltip title="Open participants panel">
                <IconButton
                  color={rightPanelTab === "participants" ? "primary" : "default"}
                  onClick={() => {
                    setRightPanelTab("participants");
                    setRightPanelCollapsed(false);
                  }}
                >
                  <PeopleIcon />
                </IconButton>
              </Tooltip>

              <Tooltip title="Open chat placeholder">
                <IconButton
                  color={rightPanelTab === "chat" ? "primary" : "default"}
                  onClick={() => {
                    setRightPanelTab("chat");
                    setRightPanelCollapsed(false);
                  }}
                >
                  <ForumIcon />
                </IconButton>
              </Tooltip>

              <Tooltip title="Expand panel">
                <IconButton onClick={() => setRightPanelCollapsed(false)}>
                  <VisibilityIcon />
                </IconButton>
              </Tooltip>
            </Paper>
          )}
        </Box>
      </Container>

      <Menu
        open={Boolean(streamContextMenu)}
        onClose={() => setStreamContextMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={
          streamContextMenu
            ? { top: streamContextMenu.mouseY, left: streamContextMenu.mouseX }
            : undefined
        }
      >
        {selectedContextParticipant && selectedContextTrack ? (
          <Box sx={{ px: 1.4, py: 1, width: 300 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              {selectedContextParticipant.displayName}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Local stream controls
            </Typography>

            <MenuItem
              onClick={() => {
                dispatchLayout({ type: "set-mode", mode: "focus" });
                dispatchLayout({ type: "set-focus", sid: selectedContextTrack.sid });
                setStreamContextMenu(null);
              }}
            >
              Focus this stream
            </MenuItem>

            <MenuItem
              onClick={() => {
                const next = !selectedContextParticipant.voiceMutedLocal;
                setChannelMuted(selectedContextParticipant.identity, "voice", next);
              }}
            >
              {selectedContextParticipant.voiceMutedLocal ? "Unmute voice" : "Mute voice"}
            </MenuItem>

            <MenuItem
              onClick={() => {
                const next = !selectedContextParticipant.streamMutedLocal;
                setChannelMuted(selectedContextParticipant.identity, "stream", next);
              }}
            >
              {selectedContextParticipant.streamMutedLocal
                ? "Unmute stream audio"
                : "Mute stream audio"}
            </MenuItem>

            <MenuItem
              onClick={() => {
                if (hiddenStreamsByIdentity[selectedContextParticipant.identity]) {
                  handleRestoreStream(selectedContextParticipant.identity);
                } else {
                  handleHideStream(selectedContextParticipant.identity);
                }
                setStreamContextMenu(null);
              }}
            >
              {hiddenStreamsByIdentity[selectedContextParticipant.identity]
                ? "Show stream"
                : "Hide stream"}
            </MenuItem>

            <Divider sx={{ my: 0.7 }} />

            <Stack direction="row" spacing={1} alignItems="center">
              <MicIcon fontSize="small" />
              <Slider
                min={0}
                max={100}
                step={5}
                value={volumePercent(selectedContextParticipant.voiceVolume)}
                onChange={(_, value) => {
                  const next = Array.isArray(value) ? value[0] : value;
                  setChannelVolume(selectedContextParticipant.identity, "voice", next / 100);
                }}
              />
              <Typography variant="caption" sx={{ width: 34 }}>
                {volumePercent(selectedContextParticipant.voiceVolume)}%
              </Typography>
            </Stack>

            <Stack direction="row" spacing={1} alignItems="center">
              <CampaignIcon fontSize="small" />
              <Slider
                min={0}
                max={100}
                step={5}
                value={volumePercent(selectedContextParticipant.streamVolume)}
                onChange={(_, value) => {
                  const next = Array.isArray(value) ? value[0] : value;
                  setChannelVolume(selectedContextParticipant.identity, "stream", next / 100);
                }}
              />
              <Typography variant="caption" sx={{ width: 34 }}>
                {volumePercent(selectedContextParticipant.streamVolume)}%
              </Typography>
            </Stack>
          </Box>
        ) : (
          <MenuItem disabled>No stream controls available</MenuItem>
        )}
      </Menu>
    </Box>
  );
}

function App() {
  const [nickname, setNickname] = useState("");
  const [roomName, setRoomName] = useState("Squad room");
  const [inviteToken, setInviteToken] = useState("");
  const [createdInvite, setCreatedInvite] = useState<CreateInviteResponse | null>(null);
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [joined, setJoined] = useState<JoinRoomResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const token = new URL(window.location.href).searchParams.get("invite");
    if (token) {
      setInviteToken(token);
    }
  }, []);

  const canCreateOrJoin = useMemo(() => Boolean(auth?.appToken), [auth?.appToken]);

  const handleGuestLogin = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await apiCall<GuestAuthResponse>("/auth/guest", "POST", {
        nickname,
      });

      setAuth({ user: response.user, appToken: response.appToken });
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : "Failed to authenticate guest.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateRoom = async () => {
    if (!auth) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const room = await apiCall<RoomDto>(
        "/rooms",
        "POST",
        { name: roomName },
        auth.appToken,
      );

      const invite = await apiCall<CreateInviteResponse>(
        `/rooms/${room.id}/invites`,
        "POST",
        { expiresInHours: 24 },
        auth.appToken,
      );

      setCreatedInvite(invite);
      setInviteToken(invite.inviteToken);
      window.history.replaceState({}, "", `/?invite=${invite.inviteToken}`);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Failed to create room.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async () => {
    if (!auth || !inviteToken.trim()) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const payload = await apiCall<JoinRoomResponse>(
        "/rooms/join",
        "POST",
        { inviteToken: inviteToken.trim() },
        auth.appToken,
      );

      setAuth({ user: payload.user, appToken: payload.appToken });
      setJoined(payload);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Failed to join room.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyInvite = async () => {
    if (!createdInvite?.inviteUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(createdInvite.inviteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <GlobalStyles
        styles={{
          body: {
            minHeight: "100vh",
            background:
              "radial-gradient(circle at 20% 20%, rgba(62, 124, 180, 0.25), transparent 40%), radial-gradient(circle at 80% 0%, rgba(69, 214, 159, 0.18), transparent 35%), #060b12",
          },
          "*": {
            boxSizing: "border-box",
          },
        }}
      />

      {joined ? (
        <RoomView
          session={joined}
          onLeave={() => {
            setJoined(null);
          }}
        />
      ) : (
        <Container maxWidth="md" sx={{ py: { xs: 2, md: 5 } }}>
          <Stack spacing={2}>
            <Paper sx={{ p: { xs: 2, md: 3 } }}>
              <Typography variant="h4" sx={{ mb: 1 }}>
                Cascad Rooms
              </Typography>
              <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
                Self-hosted voice rooms with multi-user screen sharing.
              </Typography>

              <Box component="form" onSubmit={handleGuestLogin} sx={{ display: "grid", gap: 1.2 }}>
                <TextField
                  label="Nickname"
                  value={nickname}
                  onChange={(event) => setNickname(event.target.value)}
                  inputProps={{ minLength: 2, maxLength: 32 }}
                  placeholder="Your nickname"
                  required
                />

                <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                  <Button disabled={loading} type="submit" variant="contained">
                    {auth ? "Refresh Guest Session" : "Login as Guest"}
                  </Button>
                  {auth && (
                    <Chip
                      color="secondary"
                      label={`Logged in as ${auth.user.nickname}`}
                      variant="outlined"
                    />
                  )}
                </Stack>
              </Box>
            </Paper>

            <Paper sx={{ p: { xs: 2, md: 3 } }}>
              <Typography variant="h6" sx={{ mb: 2 }}>
                Room Controls
              </Typography>

              <Stack spacing={1.5}>
                <TextField
                  label="Room name"
                  value={roomName}
                  onChange={(event) => setRoomName(event.target.value)}
                  inputProps={{ minLength: 2, maxLength: 80 }}
                  disabled={!canCreateOrJoin}
                />

                <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                  <Button
                    disabled={!canCreateOrJoin || loading}
                    onClick={handleCreateRoom}
                    variant="contained"
                    startIcon={<ScreenShareIcon />}
                  >
                    Create Room + Invite
                  </Button>

                  {createdInvite && (
                    <Button onClick={handleCopyInvite} variant="outlined">
                      {copied ? "Copied" : "Copy Invite URL"}
                    </Button>
                  )}
                </Stack>

                {createdInvite && (
                  <Paper
                    variant="outlined"
                    sx={{ p: 1.2, backgroundColor: alpha("#4fb7ff", 0.08) }}
                  >
                    <Typography variant="caption" color="text.secondary">
                      Invite URL
                    </Typography>
                    <Typography
                      variant="body2"
                      sx={{
                        wordBreak: "break-all",
                        fontFamily: '"IBM Plex Mono", monospace',
                        mt: 0.4,
                      }}
                    >
                      {createdInvite.inviteUrl}
                    </Typography>
                  </Paper>
                )}

                <TextField
                  label="Invite token"
                  value={inviteToken}
                  onChange={(event) => setInviteToken(event.target.value)}
                  placeholder="Paste invite token"
                  disabled={!canCreateOrJoin}
                />

                <Button
                  disabled={!canCreateOrJoin || !inviteToken || loading}
                  onClick={handleJoin}
                  variant="contained"
                  color="secondary"
                >
                  Join Room
                </Button>
              </Stack>
            </Paper>

            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        </Container>
      )}
    </ThemeProvider>
  );
}

export default App;
