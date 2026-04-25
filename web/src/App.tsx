import {
  Alert,
  Avatar,
  Box,
  Button,
  CircularProgress,
  Container,
  CssBaseline,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Popover,
  Slider,
  Stack,
  Tab,
  Tabs,
  TextField,
  ThemeProvider,
  Tooltip,
  Typography,
  createTheme,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import AddReactionIcon from "@mui/icons-material/AddReaction";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import CloseIcon from "@mui/icons-material/Close";
import ImageIcon from "@mui/icons-material/Image";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import SendIcon from "@mui/icons-material/Send";
import { HubConnection, HubConnectionBuilder, HubConnectionState, LogLevel } from "@microsoft/signalr";
import { ChangeEvent, ClipboardEvent as ReactClipboardEvent, FormEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  EmbeddedVoiceControls,
  EmbeddedVoiceStage,
  ParticipantMenuRequest,
} from "./room/components/EmbeddedVoiceStage";
import { ChannelSidebar } from "./room/components/ChannelSidebar";
import {
  ApprovalsResponse,
  ChannelDto,
  ChannelMessageDto,
  ChannelMessagesResponse,
  ChannelType,
  JoinRoomResponse,
  LoginResponse,
  MentionCandidateDto,
  MentionCandidatesResponse,
  MeResponse,
  MessageAttachmentDto,
  PendingApprovalDto,
  PlatformRole,
  ProfileResponse,
  RegisterResponse,
  UploadImageResponse,
  UserDto,
  VoiceConnectResponse,
  WorkspaceMemberDto,
  WorkspaceBootstrapResponse,
} from "./types";
import {
  applyOptimisticModerationVoiceState,
  buildVoicePresenceEventSignature,
  createOptimisticSelfVoiceStateUpdate,
  isVoiceEarconCooldownPassed,
  shouldApplyVoicePresenceEventForSource,
  normalizeVoicePresenceChangedEvent,
  patchWorkspaceMembersVoiceState,
  resolveLocalConnectEarconType,
  resolveVoiceEarconType,
  shouldApplyVoicePresenceByTimestamp,
  shouldForceLocalVoiceDisconnectFromPresence,
  shouldPlayLocalDisconnectEarcon,
  shouldStartConnectingEarconLoop,
  VoiceEarconType,
} from "./voicePresence";
import { getSafeImageUrl, markImageUrlBroken } from "./imageUrlFallback";
import { applyMentionSelection, findTrailingMentionQuery, MentionQuery } from "./chat/mentions";
import { renderMessageContent } from "./chat/renderMessageContent";
import { useChatState } from "./chat/useChatState";
import { buildMessageTimeline } from "./chat/messageTimeline";
import { formatFullMessageTime, formatRelativeMessageTime } from "./chat/timestamps";
import { appendAttachmentUrl, extractImageFilesFromClipboardItems, removeAttachmentUrl } from "./chat/composerAttachments";
import {
  ChatViewStateMap,
  getChannelChatViewState,
  getWorkspaceUnreadCount,
  incrementChannelUnread,
  markChannelRead,
  parseChatViewState,
  setChannelIsAtBottom,
  syncChatViewStateFromServer,
  stringifyChatViewState,
} from "./chat/viewState";

const API_BASE = import.meta.env.VITE_API_URL ?? "/api";
const TOKEN_KEY = "cascad_app_token";
const VOICE_TAB_INSTANCE_KEY = "cascad_voice_tab_instance_id";
const AVATAR_CANVAS_SIZE = 256;

const EMOJI_SET = ["😀", "😂", "😎", "🥳", "❤️", "🔥", "👍", "👏", "👀", "✅", "🎯", "🚀"];
const EARCON_ATTACK_MS = 10;
const EARCON_RELEASE_MS = 28;
const CONNECTING_EARCON_INTERVAL_MS = 1800;
const WORKSPACE_FALLBACK_SYNC_POLL_MS = 20000;
const SIGNALR_CLIENT_KEEPALIVE_MS = 5000;
const SIGNALR_SERVER_TIMEOUT_MS = 30000;
const SIGNALR_LOG_LEVEL = LogLevel.None;
const EARCON_VOLUME_MULTIPLIER = 8.4;
const CHAT_EARCON_VOLUME_MULTIPLIER = 10.6;
const CHAT_MESSAGE_EARCON_COOLDOWN_MS = 750;
const CHAT_MENTION_EARCON_COOLDOWN_MS = 1000;
const EARCON_GAIN_BOOST: Record<VoiceEarconType, number> = {
  join: 1.65,
  leave: 1.65,
  connect: 1.75,
  connecting: 1.35,
  disconnect: 1.65,
};

type VoiceTabMode = "idle" | "active" | "secondary";

type EarconProfile = {
  frequencies: number[];
  noteMs: number;
  gapMs: number;
  gain: number;
  tailMs: number;
};

type ChatEarconType = "message" | "mention";

type ChatEarconProfile = {
  frequencies: number[];
  noteMs: number;
  gapMs: number;
  gain: number;
};

const EARCON_PROFILES: Record<VoiceEarconType, EarconProfile> = {
  join: {
    frequencies: [740, 932],
    noteMs: 85,
    gapMs: 25,
    gain: 0.022,
    tailMs: 60,
  },
  leave: {
    frequencies: [932, 740],
    noteMs: 85,
    gapMs: 25,
    gain: 0.022,
    tailMs: 60,
  },
  connect: {
    frequencies: [660, 740],
    noteMs: 70,
    gapMs: 20,
    gain: 0.016,
    tailMs: 50,
  },
  connecting: {
    frequencies: [700],
    noteMs: 66,
    gapMs: 0,
    gain: 0.014,
    tailMs: 40,
  },
  disconnect: {
    frequencies: [660, 554],
    noteMs: 76,
    gapMs: 20,
    gain: 0.018,
    tailMs: 55,
  },
};

const CHAT_EARCON_PROFILES: Record<ChatEarconType, ChatEarconProfile> = {
  message: {
    frequencies: [360],
    noteMs: 66,
    gapMs: 0,
    gain: 0.021,
  },
  mention: {
    frequencies: [430, 520],
    noteMs: 62,
    gapMs: 28,
    gain: 0.023,
  },
};

const theme = createTheme({
  palette: {
    mode: "dark",
    primary: {
      main: "#6ea4ff",
      light: "#97bdff",
    },
    secondary: {
      main: "#4ed59c",
    },
    background: {
      default: "#0f1116",
      paper: "#1a1f29",
    },
    error: {
      main: "#f16d7f",
    },
  },
  shape: {
    borderRadius: 12,
  },
  typography: {
    fontFamily: '"IBM Plex Sans", "Segoe UI", sans-serif',
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
          border: "1px solid rgba(86, 95, 110, 0.45)",
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: "none",
          fontWeight: 600,
          borderRadius: 10,
        },
      },
    },
  },
});

class ApiProblemError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiProblemError";
    this.status = status;
    this.code = code;
  }
}

function isVoiceSessionReplacedError(reason: unknown) {
  return reason instanceof ApiProblemError && reason.status === 409 && reason.code === "VOICE_SESSION_REPLACED";
}

function isVoiceSessionActiveInAnotherTabError(reason: unknown) {
  return (
    reason instanceof ApiProblemError &&
    reason.status === 409 &&
    reason.code === "VOICE_SESSION_ACTIVE_IN_ANOTHER_TAB"
  );
}

function isVoiceServerModeratedError(reason: unknown) {
  return reason instanceof ApiProblemError && reason.status === 403 && reason.code === "VOICE_SERVER_MODERATED";
}

function isVoiceSessionUnavailableError(reason: unknown) {
  return reason instanceof ApiProblemError && (reason.status === 404 || isVoiceSessionReplacedError(reason));
}

async function apiCall<TResponse>(
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  body?: unknown,
  token?: string,
): Promise<TResponse> {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body:
      body instanceof FormData
        ? body
        : body !== undefined
          ? JSON.stringify(body)
          : undefined,
  });

  if (!response.ok) {
    const raw = await response.text();
    let message = raw || `HTTP ${response.status}`;
    let code: string | undefined;

    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { title?: string; detail?: string; code?: string };
        message = parsed.detail || parsed.title || message;
        code = parsed.code;
      } catch {
        // plain text fallback
      }
    }

    throw new ApiProblemError(message, response.status, code);
  }

  if (response.status === 204) {
    return undefined as TResponse;
  }

  return (await response.json()) as TResponse;
}

function mapVoiceToRoomSession(
  voice: VoiceConnectResponse,
  user: UserDto,
  appToken: string,
): JoinRoomResponse {
  return {
    room: {
      id: voice.channelId,
      name: voice.channelName,
      liveKitRoomName: voice.liveKitRoomName,
      ownerUserId: user.id,
      createdAtUtc: new Date().toISOString(),
    },
    user,
    appToken,
    rtcToken: voice.rtcToken,
    rtcUrl: voice.rtcUrl,
    sessionInstanceId: voice.sessionInstanceId,
  };
}

function resolveVoiceTabMode(
  connectedVoiceChannelId: string | null,
  connectedVoiceTabInstanceId: string | null,
  currentTabInstanceId: string,
): VoiceTabMode {
  if (!connectedVoiceChannelId) {
    return "idle";
  }

  if (!connectedVoiceTabInstanceId || connectedVoiceTabInstanceId === currentTabInstanceId) {
    return "active";
  }

  return "secondary";
}

function getAudioContextConstructor(): typeof AudioContext | null {
  const maybeContext = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return maybeContext ?? null;
}

function scheduleEarconNote(
  context: AudioContext,
  destination: AudioNode,
  startAt: number,
  frequency: number,
  durationSec: number,
) {
  const oscillator = context.createOscillator();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, startAt);

  const noteGain = context.createGain();
  noteGain.gain.setValueAtTime(0.0001, startAt);
  noteGain.gain.exponentialRampToValueAtTime(1, startAt + EARCON_ATTACK_MS / 1000);
  noteGain.gain.exponentialRampToValueAtTime(
    0.0001,
    startAt + Math.max(durationSec - EARCON_RELEASE_MS / 1000, EARCON_ATTACK_MS / 1000),
  );

  oscillator.connect(noteGain);
  noteGain.connect(destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + durationSec);
}

async function playVoiceEarcon(context: AudioContext, type: VoiceEarconType) {
  try {
    if (context.state === "suspended") {
      await context.resume();
    }
  } catch {
    return;
  }

  if (context.state !== "running") {
    return;
  }

  const profile = EARCON_PROFILES[type];
  const baseTime = context.currentTime + 0.002;
  const noteDurationSec = profile.noteMs / 1000;
  const gapSec = profile.gapMs / 1000;

  const masterGain = context.createGain();
  masterGain.gain.setValueAtTime(
    profile.gain * EARCON_GAIN_BOOST[type] * EARCON_VOLUME_MULTIPLIER,
    baseTime,
  );
  masterGain.connect(context.destination);

  profile.frequencies.forEach((frequency, index) => {
    const offset = index * (noteDurationSec + gapSec);
    scheduleEarconNote(context, masterGain, baseTime + offset, frequency, noteDurationSec);
  });

  const notesCount = profile.frequencies.length;
  const totalNotesDuration = notesCount * noteDurationSec;
  const totalGapDuration = Math.max(0, notesCount - 1) * gapSec;
  const endTime = baseTime + totalNotesDuration + totalGapDuration + profile.tailMs / 1000;
  masterGain.gain.exponentialRampToValueAtTime(0.0001, endTime);
}

function scheduleChatEarconNote(
  context: AudioContext,
  destination: AudioNode,
  startAt: number,
  frequency: number,
  durationSec: number,
) {
  const oscillator = context.createOscillator();
  oscillator.type = "triangle";
  oscillator.frequency.setValueAtTime(frequency, startAt);

  const noteGain = context.createGain();
  noteGain.gain.setValueAtTime(0.0001, startAt);
  noteGain.gain.exponentialRampToValueAtTime(1, startAt + 0.008);
  noteGain.gain.exponentialRampToValueAtTime(0.0001, startAt + Math.max(durationSec - 0.02, 0.014));

  oscillator.connect(noteGain);
  noteGain.connect(destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + durationSec);
}

async function playChatEarcon(context: AudioContext, type: ChatEarconType) {
  try {
    if (context.state === "suspended") {
      await context.resume();
    }
  } catch {
    return;
  }

  if (context.state !== "running") {
    return;
  }

  const profile = CHAT_EARCON_PROFILES[type];
  const baseTime = context.currentTime + 0.002;
  const noteDurationSec = profile.noteMs / 1000;
  const gapSec = profile.gapMs / 1000;

  const masterGain = context.createGain();
  masterGain.gain.setValueAtTime(profile.gain * CHAT_EARCON_VOLUME_MULTIPLIER, baseTime);
  masterGain.connect(context.destination);

  profile.frequencies.forEach((frequency, index) => {
    const offset = index * (noteDurationSec + gapSec);
    scheduleChatEarconNote(context, masterGain, baseTime + offset, frequency, noteDurationSec);
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load image"));
    image.src = source;
  });
}

async function buildAvatarBlob(source: string, zoom: number, offsetX: number, offsetY: number) {
  const image = await loadImage(source);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_CANVAS_SIZE;
  canvas.height = AVATAR_CANVAS_SIZE;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas is not available");
  }

  const minEdge = Math.min(image.width, image.height);
  const cropSize = minEdge / Math.max(1, zoom);
  const maxShiftX = (image.width - cropSize) / 2;
  const maxShiftY = (image.height - cropSize) / 2;

  const shiftX = (offsetX / 100) * maxShiftX;
  const shiftY = (offsetY / 100) * maxShiftY;

  const sx = Math.max(0, Math.min(image.width - cropSize, (image.width - cropSize) / 2 + shiftX));
  const sy = Math.max(0, Math.min(image.height - cropSize, (image.height - cropSize) / 2 + shiftY));

  context.clearRect(0, 0, AVATAR_CANVAS_SIZE, AVATAR_CANVAS_SIZE);
  context.save();
  context.beginPath();
  context.arc(
    AVATAR_CANVAS_SIZE / 2,
    AVATAR_CANVAS_SIZE / 2,
    AVATAR_CANVAS_SIZE / 2,
    0,
    Math.PI * 2,
  );
  context.closePath();
  context.clip();
  context.drawImage(
    image,
    sx,
    sy,
    cropSize,
    cropSize,
    0,
    0,
    AVATAR_CANVAS_SIZE,
    AVATAR_CANVAS_SIZE,
  );
  context.restore();

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((value) => resolve(value), "image/png", 0.98);
  });

  if (!blob) {
    throw new Error("Failed to prepare avatar image");
  }

  return blob;
}

function AuthScreen(props: { onLoggedIn: (response: LoginResponse) => void }) {
  const [tab, setTab] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registerInfo, setRegisterInfo] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setRegisterInfo(null);

    try {
      if (tab === "login") {
        const response = await apiCall<LoginResponse>("/auth/login", "POST", {
          username,
          password,
        });
        props.onLoggedIn(response);
      } else {
        const response = await apiCall<RegisterResponse>("/auth/register", "POST", {
          username,
          password,
          confirmPassword,
        });
        setRegisterInfo(
          `Пользователь ${response.user.username} зарегистрирован. Ожидайте аппрув администратора.`,
        );
        setTab("login");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Request failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container maxWidth="sm" sx={{ py: 6 }}>
      <Paper sx={{ p: 3 }}>
        <Typography variant="h4" sx={{ mb: 1, fontWeight: 700 }}>
          Cascad
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Login / registration with admin approval.
        </Typography>
        <Tabs
          value={tab}
          onChange={(_, value: "login" | "register") => setTab(value)}
          sx={{ mb: 2 }}
        >
          <Tab value="login" label="Login" />
          <Tab value="register" label="Register" />
        </Tabs>

        <Box component="form" onSubmit={onSubmit}>
          <Stack spacing={1.2}>
            <TextField
              label="Username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
            <TextField
              label="Password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            {tab === "register" && (
              <TextField
                label="Confirm password"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
              />
            )}
            <Button type="submit" disabled={loading} variant="contained">
              {loading ? "Please wait..." : tab === "login" ? "Login" : "Register"}
            </Button>
          </Stack>
        </Box>

        {registerInfo && (
          <Alert severity="info" sx={{ mt: 2 }}>
            {registerInfo}
          </Alert>
        )}
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </Paper>
    </Container>
  );
}

function PendingApprovalScreen(props: { onRefresh: () => Promise<void>; onLogout: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      await props.onRefresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Refresh failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container maxWidth="sm" sx={{ py: 8 }}>
      <Paper sx={{ p: 3 }}>
        <Typography variant="h5" sx={{ mb: 1 }}>
          Ожидает аппрува
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Ваша заявка создана. Админ должен подтвердить доступ.
        </Typography>
        <Stack direction="row" spacing={1}>
          <Button onClick={refresh} disabled={loading} variant="contained">
            {loading ? "Checking..." : "Проверить снова"}
          </Button>
          <Button onClick={props.onLogout} variant="outlined">
            Выйти
          </Button>
        </Stack>
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </Paper>
    </Container>
  );
}

function WorkspaceShell(props: {
  token: string;
  currentUser: UserDto;
  onLogout: () => void;
  onUserUpdated: (user: UserDto) => void;
}) {
  const [workspaceData, setWorkspaceData] = useState<WorkspaceBootstrapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedTextChannelId, setSelectedTextChannelId] = useState<string | null>(null);
  const [selectedVoiceChannelId, setSelectedVoiceChannelId] = useState<string | null>(null);
  const [centerMode, setCenterMode] = useState<"text" | "voice">("text");

  const [connectedVoiceChannelId, setConnectedVoiceChannelId] = useState<string | null>(null);
  const [voiceTabMode, setVoiceTabMode] = useState<VoiceTabMode>("idle");
  const [voiceSession, setVoiceSession] = useState<JoinRoomResponse | null>(null);
  const [voiceControlState, setVoiceControlState] = useState<{
    muted: boolean;
    sharing: boolean;
    connected: boolean;
    connectionError: boolean;
  }>({ muted: false, sharing: false, connected: false, connectionError: false });
  const voiceControlActionsRef = useRef<{
    setMuted: (muted: boolean) => Promise<void>;
    toggleMute: () => Promise<void>;
    toggleShare: () => Promise<void>;
    openSettings: () => void;
  } | null>(null);
  const autoMutedByDeafenRef = useRef(false);
  const [speakingUserIds, setSpeakingUserIds] = useState<Set<string>>(new Set());

  const [messageDraft, setMessageDraft] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [mentionQuery, setMentionQuery] = useState<MentionQuery | null>(null);
  const [mentionCandidates, setMentionCandidates] = useState<MentionCandidateDto[]>([]);
  const [attachmentMenuAnchorEl, setAttachmentMenuAnchorEl] = useState<HTMLElement | null>(null);
  const [imageLightbox, setImageLightbox] = useState<{
    attachments: MessageAttachmentDto[];
    index: number;
    zoom: number;
  } | null>(null);
  const [liveVoiceMessages, setLiveVoiceMessages] = useState<
    Array<{ userId: string; username: string; content: string; createdAtUtc: string }>
  >([]);
  const { messagesByChannel, replaceChannelMessages, upsertChannelMessage, upsertChannelMessages } =
    useChatState();
  const [chatViewState, setChatViewState] = useState<ChatViewStateMap>({});

  const [selfMuted, setSelfMuted] = useState(false);
  const [selfDeafened, setSelfDeafened] = useState(false);
  const [selfServerMuted, setSelfServerMuted] = useState(false);
  const [selfServerDeafened, setSelfServerDeafened] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApprovalDto[]>([]);

  const [currentAvatarUrl, setCurrentAvatarUrl] = useState<string | null>(props.currentUser.avatarUrl);
  const [avatarCropSource, setAvatarCropSource] = useState<string | null>(null);
  const [avatarCropZoom, setAvatarCropZoom] = useState(1.2);
  const [avatarCropX, setAvatarCropX] = useState(0);
  const [avatarCropY, setAvatarCropY] = useState(0);

  const [serverSettingsOpen, setServerSettingsOpen] = useState(false);
  const [emojiAnchorEl, setEmojiAnchorEl] = useState<HTMLElement | null>(null);
  const [createChannelType, setCreateChannelType] = useState<ChannelType | null>(null);
  const [createChannelName, setCreateChannelName] = useState("");
  const [createVoiceMaxParticipants, setCreateVoiceMaxParticipants] = useState("12");
  const [createVoiceMaxStreams, setCreateVoiceMaxStreams] = useState("4");
  const [createChannelSubmitting, setCreateChannelSubmitting] = useState(false);
  const [createChannelError, setCreateChannelError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [takeoverDialogOpen, setTakeoverDialogOpen] = useState(false);
  const [participantMenuRequest, setParticipantMenuRequest] = useState<ParticipantMenuRequest | null>(null);

  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const attachPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const messageInputRef = useRef<HTMLInputElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const hubRef = useRef<HubConnection | null>(null);
  const participantMenuSeqRef = useRef(1);
  const voiceEarconContextRef = useRef<AudioContext | null>(null);
  const lastVoiceEarconAtRef = useRef(0);
  const lastLocalDisconnectEarconAtRef = useRef(-Infinity);
  const previousConnectedVoiceChannelIdRef = useRef<string | null>(null);
  const previousVoiceEngineConnectedRef = useRef(false);
  const selectedTextChannelIdRef = useRef<string | null>(null);
  const centerModeRef = useRef<"text" | "voice">("text");
  const connectedVoiceChannelIdRef = useRef<string | null>(null);
  const voiceSessionRef = useRef<JoinRoomResponse | null>(null);
  const suppressWorkspaceVoiceSyncRef = useRef(false);
  const voiceConnectionIntentSeqRef = useRef(0);
  const voiceConnectRequestInFlightRef = useRef(false);
  const lastVoicePresenceEventAtByUserRef = useRef<Record<string, number>>({});
  const lastVoicePresenceSignatureByUserRef = useRef<Record<string, string>>({});
  const lastActiveVoiceRosterSignatureRef = useRef("");
  const workspaceIdRef = useRef<string | null>(null);
  const currentUserIdRef = useRef(props.currentUser.id);
  const joinedWorkspaceIdRef = useRef<string | null>(null);
  const joinedTextChannelIdRef = useRef<string | null>(null);
  const joinedVoiceChannelIdRef = useRef<string | null>(null);
  const mentionFetchSeqRef = useRef(0);
  const chatMessagesByChannelRef = useRef<Record<string, ChannelMessageDto[]>>({});
  const chatViewStateRef = useRef<ChatViewStateMap>({});
  const pendingScrollToBottomChannelRef = useRef<string | null>(null);
  const lastRenderedMessageIdByChannelRef = useRef<Record<string, string>>({});
  const pendingReadSyncByChannelRef = useRef<Record<string, string>>({});
  const pendingReadSyncTimerByChannelRef = useRef<Record<string, number>>({});
  const lastChatMessageEarconAtRef = useRef(-Infinity);
  const lastChatMentionEarconAtRef = useRef(-Infinity);
  const tabInstanceId = useMemo(() => {
    const existing = sessionStorage.getItem(VOICE_TAB_INSTANCE_KEY);
    if (existing) {
      return existing;
    }

    const created = crypto.randomUUID();
    sessionStorage.setItem(VOICE_TAB_INSTANCE_KEY, created);
    return created;
  }, []);
  const workspaceId = workspaceData?.workspace.id ?? null;
  const isCurrentUserAdmin = props.currentUser.role === "Admin";
  const chatStorageKey = useMemo(
    () => (workspaceId ? `chat:${props.currentUser.id}:${workspaceId}` : null),
    [props.currentUser.id, workspaceId],
  );

  useEffect(() => {
    setCurrentAvatarUrl(props.currentUser.avatarUrl);
  }, [props.currentUser.avatarUrl]);

  useEffect(() => {
    selectedTextChannelIdRef.current = selectedTextChannelId;
    centerModeRef.current = centerMode;
    connectedVoiceChannelIdRef.current = connectedVoiceChannelId;
    workspaceIdRef.current = workspaceId;
    currentUserIdRef.current = props.currentUser.id;
  }, [centerMode, selectedTextChannelId, connectedVoiceChannelId, workspaceId, props.currentUser.id]);

  useEffect(() => {
    voiceSessionRef.current = voiceSession;
  }, [voiceSession]);

  useEffect(() => {
    lastVoicePresenceEventAtByUserRef.current = {};
    lastVoicePresenceSignatureByUserRef.current = {};
  }, [workspaceId]);

  useEffect(() => {
    lastActiveVoiceRosterSignatureRef.current = "";
  }, [workspaceId, connectedVoiceChannelId]);

  useEffect(() => {
    return () => {
      const context = voiceEarconContextRef.current;
      if (!context) {
        return;
      }
      void context.close().catch(() => undefined);
      voiceEarconContextRef.current = null;
    };
  }, []);

  useEffect(() => {
    return () => {
      for (const timeoutId of Object.values(pendingReadSyncTimerByChannelRef.current)) {
        window.clearTimeout(timeoutId);
      }
      pendingReadSyncTimerByChannelRef.current = {};
      pendingReadSyncByChannelRef.current = {};
    };
  }, []);

  useEffect(() => {
    const onGesture = () => {
      let context = voiceEarconContextRef.current;
      if (!context) {
        const Ctor = getAudioContextConstructor();
        if (!Ctor) {
          return;
        }

        try {
          context = new Ctor();
        } catch {
          return;
        }

        voiceEarconContextRef.current = context;
      }

      if (context.state === "suspended") {
        void context.resume().catch(() => undefined);
      }
    };

    window.addEventListener("pointerdown", onGesture);
    window.addEventListener("keydown", onGesture);

    return () => {
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
  }, []);

  useEffect(() => {
    if (!voiceSession) {
      setParticipantMenuRequest(null);
    }
  }, [voiceSession]);

  const textChannels = useMemo(
    () => workspaceData?.channels.filter((x) => x.type === "Text") ?? [],
    [workspaceData?.channels],
  );
  const voiceChannels = useMemo(
    () => workspaceData?.channels.filter((x) => x.type === "Voice") ?? [],
    [workspaceData?.channels],
  );

  const selectedTextChannel: ChannelDto | null = useMemo(() => {
    if (!selectedTextChannelId) {
      return null;
    }
    return textChannels.find((x) => x.id === selectedTextChannelId) ?? null;
  }, [selectedTextChannelId, textChannels]);

  const selectedVoiceChannel: ChannelDto | null = useMemo(() => {
    if (!selectedVoiceChannelId) {
      return null;
    }
    return voiceChannels.find((x) => x.id === selectedVoiceChannelId) ?? null;
  }, [selectedVoiceChannelId, voiceChannels]);

  const selectedChannelMessages = useMemo(() => {
    if (!selectedTextChannelId) {
      return [];
    }

    return messagesByChannel[selectedTextChannelId] ?? [];
  }, [messagesByChannel, selectedTextChannelId]);
  const selectedChannelView = useMemo(
    () => getChannelChatViewState(chatViewState, selectedTextChannelId),
    [chatViewState, selectedTextChannelId],
  );
  const textChannelUnreadCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const channel of textChannels) {
      map[channel.id] = getChannelChatViewState(chatViewState, channel.id).unreadCount;
    }
    return map;
  }, [chatViewState, textChannels]);
  const workspaceUnreadCount = useMemo(
    () => getWorkspaceUnreadCount(chatViewState),
    [chatViewState],
  );
  const firstUnreadMessageIdInSelectedChannel = useMemo(() => {
    if (!selectedTextChannelId || selectedChannelView.unreadCount <= 0) {
      return null;
    }

    const lastReadAtMs = selectedChannelView.lastReadAtUtc
      ? Date.parse(selectedChannelView.lastReadAtUtc)
      : Number.NEGATIVE_INFINITY;

    for (const message of selectedChannelMessages) {
      if (message.userId === props.currentUser.id) {
        continue;
      }

      if (Date.parse(message.createdAtUtc) > lastReadAtMs) {
        return message.id;
      }
    }

    return selectedChannelView.firstUnreadMessageId;
  }, [props.currentUser.id, selectedChannelMessages, selectedChannelView.firstUnreadMessageId, selectedChannelView.lastReadAtUtc, selectedChannelView.unreadCount, selectedTextChannelId]);
  const [timelineNowMs, setTimelineNowMs] = useState(() => Date.now());

  const messageTimeline = useMemo(
    () => buildMessageTimeline(selectedChannelMessages, timelineNowMs),
    [selectedChannelMessages, timelineNowMs],
  );
  const composerAutocompleteToken = useMemo(
    () => `new-password-${tabInstanceId}`,
    [tabInstanceId],
  );

  const memberStateByUserId = useMemo(() => {
    const map = new Map<string, WorkspaceMemberDto>();
    for (const member of workspaceData?.members ?? []) {
      map.set(member.userId, member);
    }
    return map;
  }, [workspaceData?.members]);

  useEffect(() => {
    chatMessagesByChannelRef.current = messagesByChannel;
  }, [messagesByChannel]);

  useEffect(() => {
    chatViewStateRef.current = chatViewState;
  }, [chatViewState]);

  useEffect(() => {
    if (!chatStorageKey) {
      setChatViewState({});
      return;
    }

    setChatViewState(parseChatViewState(localStorage.getItem(chatStorageKey)));
  }, [chatStorageKey]);

  useEffect(() => {
    if (!chatStorageKey) {
      return;
    }

    localStorage.setItem(chatStorageKey, stringifyChatViewState(chatViewState));
  }, [chatStorageKey, chatViewState]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTimelineNowMs(Date.now());
    }, 30_000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const patchSelfWorkspaceVoiceState = useCallback(
    (next: {
      connectedVoiceChannelId?: string | null;
      isScreenSharing?: boolean;
      isMuted?: boolean;
      isDeafened?: boolean;
      isServerMuted?: boolean;
      isServerDeafened?: boolean;
    }) => {
      setWorkspaceData((current) => {
        if (!current) {
          return current;
        }

        const index = current.members.findIndex((member) => member.userId === props.currentUser.id);
        if (index < 0) {
          return current;
        }

        const member = current.members[index];
        const updated: WorkspaceMemberDto = {
          ...member,
          connectedVoiceChannelId:
            next.connectedVoiceChannelId !== undefined
              ? next.connectedVoiceChannelId
              : member.connectedVoiceChannelId,
          isScreenSharing: next.isScreenSharing ?? member.isScreenSharing,
          isMuted: next.isMuted ?? member.isMuted,
          isDeafened: next.isDeafened ?? member.isDeafened,
          isServerMuted: next.isServerMuted ?? member.isServerMuted,
          isServerDeafened: next.isServerDeafened ?? member.isServerDeafened,
        };

        if (
          updated.connectedVoiceChannelId === member.connectedVoiceChannelId &&
          updated.isScreenSharing === member.isScreenSharing &&
          updated.isMuted === member.isMuted &&
          updated.isDeafened === member.isDeafened &&
          updated.isServerMuted === member.isServerMuted &&
          updated.isServerDeafened === member.isServerDeafened
        ) {
          return current;
        }

        const members = current.members.slice();
        members[index] = updated;
        return {
          ...current,
          members,
        };
      });
    },
    [props.currentUser.id],
  );

  const patchWorkspaceMemberVoiceFlags = useCallback(
    (
      userId: string,
      next: {
        isMuted?: boolean;
        isDeafened?: boolean;
        isServerMuted?: boolean;
        isServerDeafened?: boolean;
      },
    ) => {
      setWorkspaceData((current) => {
        if (!current) {
          return current;
        }

        const index = current.members.findIndex((member) => member.userId === userId);
        if (index < 0) {
          return current;
        }

        const member = current.members[index];
        const updated: WorkspaceMemberDto = {
          ...member,
          isMuted: next.isMuted ?? member.isMuted,
          isDeafened: next.isDeafened ?? member.isDeafened,
          isServerMuted: next.isServerMuted ?? member.isServerMuted,
          isServerDeafened: next.isServerDeafened ?? member.isServerDeafened,
        };

        if (
          updated.isMuted === member.isMuted &&
          updated.isDeafened === member.isDeafened &&
          updated.isServerMuted === member.isServerMuted &&
          updated.isServerDeafened === member.isServerDeafened
        ) {
          return current;
        }

        const members = current.members.slice();
        members[index] = updated;
        return {
          ...current,
          members,
        };
      });
    },
    [],
  );

  const loadWorkspace = useCallback(async () => {
    const data = await apiCall<WorkspaceBootstrapResponse>("/workspace", "GET", undefined, props.token);
    setWorkspaceData(data);
    setChatViewState((current) => syncChatViewStateFromServer(current, data.chatUnread.channels));

    const firstText = data.channels.find((x) => x.type === "Text")?.id ?? null;
    const firstVoice = data.channels.find((x) => x.type === "Voice")?.id ?? null;

    setSelectedTextChannelId((current) =>
      current && data.channels.some((x) => x.id === current) ? current : firstText,
    );
    setSelectedVoiceChannelId((current) =>
      current && data.channels.some((x) => x.id === current) ? current : firstVoice,
    );

    setConnectedVoiceChannelId((current) => {
      if (voiceConnectRequestInFlightRef.current) {
        return current;
      }

      if (suppressWorkspaceVoiceSyncRef.current && !voiceSessionRef.current) {
        return current;
      }

      if (
        current &&
        voiceSessionRef.current?.room.id === current &&
        data.connectedVoiceChannelId === current
      ) {
        return current;
      }

      return data.connectedVoiceChannelId;
    });
    const nextVoiceTabMode = resolveVoiceTabMode(
      data.connectedVoiceChannelId,
      data.connectedVoiceTabInstanceId,
      tabInstanceId,
    );
    setVoiceTabMode((current) => {
      if (voiceConnectRequestInFlightRef.current) {
        return current;
      }

      if (suppressWorkspaceVoiceSyncRef.current && !voiceSessionRef.current) {
        return current;
      }

      return nextVoiceTabMode;
    });

    const me = data.members.find((x) => x.userId === props.currentUser.id);
    setSelfMuted(me?.isMuted ?? false);
    setSelfDeafened(me?.isDeafened ?? false);
    setSelfServerMuted(me?.isServerMuted ?? false);
    setSelfServerDeafened(me?.isServerDeafened ?? false);
  }, [props.currentUser.id, props.token, tabInstanceId]);

  const loadApprovals = async () => {
    if (props.currentUser.role !== "Admin") {
      setPendingApprovals([]);
      return;
    }

    const response = await apiCall<ApprovalsResponse>(
      "/admin/approvals",
      "GET",
      undefined,
      props.token,
    );
    setPendingApprovals(response.users);
  };

  const loadRecentMessages = useCallback(async (channelId: string) => {
    const response = await apiCall<ChannelMessagesResponse>(
      `/channels/${channelId}/messages?limit=50`,
      "GET",
      undefined,
      props.token,
    );
    replaceChannelMessages(channelId, response.messages);
  }, [props.token, replaceChannelMessages]);

  const loadMessageUpdates = useCallback(async (channelId: string, afterCursor: string) => {
    const response = await apiCall<ChannelMessagesResponse>(
      `/channels/${channelId}/messages?limit=100&after=${encodeURIComponent(afterCursor)}`,
      "GET",
      undefined,
      props.token,
    );
    upsertChannelMessages(channelId, response.messages);
  }, [props.token, upsertChannelMessages]);

  const syncMessagesForChannel = useCallback(async (channelId: string) => {
    const current = chatMessagesByChannelRef.current[channelId] ?? [];
    if (current.length === 0) {
      await loadRecentMessages(channelId);
      return;
    }

    const latestCursor = current[current.length - 1]?.createdAtUtc;
    if (!latestCursor) {
      await loadRecentMessages(channelId);
      return;
    }

    await loadMessageUpdates(channelId, latestCursor);
  }, [loadMessageUpdates, loadRecentMessages]);

  const isNearBottom = (element: HTMLDivElement, thresholdPx = 40) => {
    return element.scrollHeight - element.scrollTop - element.clientHeight <= thresholdPx;
  };

  const scrollActiveChatToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const element = messageListRef.current;
    if (!element) {
      return;
    }

    element.scrollTo({
      top: element.scrollHeight,
      behavior,
    });
  }, []);

  const isPageFocused = () => document.visibilityState === "visible" && document.hasFocus();

  const isReadEligible = useCallback((channelId: string, isAtBottom: boolean) => {
    if (!isAtBottom) {
      return false;
    }

    if (centerModeRef.current !== "text") {
      return false;
    }

    if (selectedTextChannelIdRef.current !== channelId) {
      return false;
    }

    return isPageFocused();
  }, []);

  const markChannelAsRead = useCallback((channelId: string, lastReadAtUtc: string) => {
    setChatViewState((current) => markChannelRead(current, channelId, lastReadAtUtc));

    const currentPendingRead = pendingReadSyncByChannelRef.current[channelId];
    if (
      currentPendingRead &&
      Number.isFinite(Date.parse(currentPendingRead)) &&
      Date.parse(currentPendingRead) >= Date.parse(lastReadAtUtc)
    ) {
      return;
    }
    pendingReadSyncByChannelRef.current[channelId] = lastReadAtUtc;

    const existingTimeout = pendingReadSyncTimerByChannelRef.current[channelId];
    if (existingTimeout) {
      window.clearTimeout(existingTimeout);
    }

    pendingReadSyncTimerByChannelRef.current[channelId] = window.setTimeout(() => {
      delete pendingReadSyncTimerByChannelRef.current[channelId];
      const queuedReadAtUtc = pendingReadSyncByChannelRef.current[channelId];
      if (!queuedReadAtUtc) {
        return;
      }

      void apiCall<void>(
        `/channels/${channelId}/read`,
        "POST",
        { lastReadAtUtc: queuedReadAtUtc },
        props.token,
      )
        .then(() => {
          if (pendingReadSyncByChannelRef.current[channelId] === queuedReadAtUtc) {
            delete pendingReadSyncByChannelRef.current[channelId];
          }
        })
        .catch(() => undefined);
    }, 420);
  }, [props.token]);

  const tryPlayChatEarcon = (type: ChatEarconType) => {
    const nowMs = performance.now();
    if (type === "mention") {
      if (nowMs - lastChatMentionEarconAtRef.current < CHAT_MENTION_EARCON_COOLDOWN_MS) {
        return;
      }
      lastChatMentionEarconAtRef.current = nowMs;
    } else {
      if (nowMs - lastChatMessageEarconAtRef.current < CHAT_MESSAGE_EARCON_COOLDOWN_MS) {
        return;
      }
      lastChatMessageEarconAtRef.current = nowMs;
    }

    let context = voiceEarconContextRef.current;
    if (!context) {
      const Ctor = getAudioContextConstructor();
      if (!Ctor) {
        return;
      }

      try {
        context = new Ctor();
      } catch {
        return;
      }

      voiceEarconContextRef.current = context;
    }

    void playChatEarcon(context, type).catch(() => undefined);
  };

  const tryPlayVoiceEarcon = (type: VoiceEarconType) => {
    const nowMs = performance.now();
    if (!isVoiceEarconCooldownPassed(nowMs, lastVoiceEarconAtRef.current)) {
      return;
    }

    let context = voiceEarconContextRef.current;
    if (!context) {
      const Ctor = getAudioContextConstructor();
      if (!Ctor) {
        return;
      }

      try {
        context = new Ctor();
      } catch {
        return;
      }

      voiceEarconContextRef.current = context;
    }

    lastVoiceEarconAtRef.current = nowMs;
    void playVoiceEarcon(context, type).catch(() => undefined);
  };

  const applyActiveVoiceRoster = useCallback(
    (participants: Array<{ userId: string; username: string; isScreenSharing: boolean }>) => {
      const activeVoiceChannelId = voiceSessionRef.current?.room.id ?? null;
      const activeWorkspaceId = workspaceIdRef.current;
      if (!activeVoiceChannelId || !activeWorkspaceId) {
        return;
      }
      const hasPendingVoiceSwitch = connectedVoiceChannelIdRef.current !== activeVoiceChannelId;

      const participantById = new Map<string, string>();
      for (const participant of participants) {
        if (!participant.userId) {
          continue;
        }

        participantById.set(participant.userId, participant.username?.trim() || participant.userId);
      }

      const signature = [
        activeVoiceChannelId,
        ...Array.from(participantById.entries())
          .sort((left, right) => left[0].localeCompare(right[0]))
          .map(([userId, username]) => `${userId}:${username}`),
      ].join("|");

      if (lastActiveVoiceRosterSignatureRef.current === signature) {
        return;
      }
      lastActiveVoiceRosterSignatureRef.current = signature;

      setWorkspaceData((current) => {
        if (!current || current.workspace.id !== activeWorkspaceId) {
          return current;
        }

        const existingMemberIds = new Set(current.members.map((member) => member.userId));
        let changed = false;

        const nextMembers = current.members.map((member) => {
          if (member.userId === props.currentUser.id && hasPendingVoiceSwitch) {
            return member;
          }

          const nextUsername = participantById.get(member.userId);
          if (nextUsername) {
            if (
              member.connectedVoiceChannelId === activeVoiceChannelId &&
              member.username === nextUsername
            ) {
              return member;
            }

            changed = true;
            return {
              ...member,
              username: nextUsername,
              connectedVoiceChannelId: activeVoiceChannelId,
            };
          }

          if (
            member.userId !== props.currentUser.id &&
            member.connectedVoiceChannelId === activeVoiceChannelId
          ) {
            changed = true;
            return {
              ...member,
              connectedVoiceChannelId: null,
              isScreenSharing: false,
              isMuted: false,
              isDeafened: false,
              isServerMuted: false,
              isServerDeafened: false,
            };
          }

          return member;
        });

        for (const [userId, username] of participantById) {
          if (existingMemberIds.has(userId)) {
            continue;
          }

          changed = true;
          nextMembers.push({
            userId,
            username,
            role: "User",
            avatarUrl: null,
            connectedVoiceChannelId: activeVoiceChannelId,
            isScreenSharing: false,
            isMuted: false,
            isDeafened: false,
            isServerMuted: false,
            isServerDeafened: false,
          });
        }

        if (!changed) {
          return current;
        }

        return {
          ...current,
          members: nextMembers,
        };
      });
    },
    [props.currentUser.id],
  );

  const ensureVoiceSession = async (channelId: string, allowTakeover = false) => {
    const connected = await apiCall<VoiceConnectResponse>(
      "/voice/connect",
      "POST",
      { channelId, tabInstanceId, allowTakeover },
      props.token,
    );

    if (connectedVoiceChannelIdRef.current !== channelId) {
      return;
    }

    suppressWorkspaceVoiceSyncRef.current = false;
    setConnectedVoiceChannelId(connected.channelId);
    setVoiceTabMode("active");
    setVoiceSession(mapVoiceToRoomSession(connected, props.currentUser, props.token));
    patchSelfWorkspaceVoiceState({
      connectedVoiceChannelId: connected.channelId,
    });
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        await loadWorkspace();
        await loadApprovals();
      } catch (reason) {
        if (!active) {
          return;
        }
        setError(reason instanceof Error ? reason.message : "Failed to load workspace");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [props.token]);

  useEffect(() => {
    if (!selectedTextChannelId) {
      setMentionCandidates([]);
      setMentionQuery(null);
      return;
    }

    pendingScrollToBottomChannelRef.current = selectedTextChannelId;
    setChatViewState((current) => setChannelIsAtBottom(current, selectedTextChannelId, true));

    void syncMessagesForChannel(selectedTextChannelId).catch((reason) => {
      setError(reason instanceof Error ? reason.message : "Failed to load messages");
    });
  }, [selectedTextChannelId, syncMessagesForChannel]);

  useEffect(() => {
    if (!selectedTextChannelId || selectedChannelMessages.length === 0) {
      return;
    }

    const lastMessage = selectedChannelMessages[selectedChannelMessages.length - 1];
    if (!lastMessage) {
      return;
    }

    const lastRenderedMessageId = lastRenderedMessageIdByChannelRef.current[selectedTextChannelId];
    const shouldForceScroll = pendingScrollToBottomChannelRef.current === selectedTextChannelId;
    const channelState = getChannelChatViewState(chatViewStateRef.current, selectedTextChannelId);
    const shouldStickToBottom = shouldForceScroll || channelState.isAtBottom;
    const hasNewMessage = lastRenderedMessageId !== lastMessage.id;

    if (hasNewMessage && shouldStickToBottom) {
      requestAnimationFrame(() => {
        scrollActiveChatToBottom("auto");
      });
      if (isReadEligible(selectedTextChannelId, true)) {
        markChannelAsRead(selectedTextChannelId, lastMessage.createdAtUtc);
      }
      pendingScrollToBottomChannelRef.current = null;
    }

    lastRenderedMessageIdByChannelRef.current[selectedTextChannelId] = lastMessage.id;
  }, [isReadEligible, markChannelAsRead, scrollActiveChatToBottom, selectedChannelMessages, selectedTextChannelId]);

  useEffect(() => {
    if (!selectedTextChannelId || selectedChannelMessages.length === 0) {
      return;
    }

    if (!isReadEligible(selectedTextChannelId, selectedChannelView.isAtBottom)) {
      return;
    }

    const lastMessage = selectedChannelMessages[selectedChannelMessages.length - 1];
    if (!lastMessage) {
      return;
    }

    markChannelAsRead(selectedTextChannelId, lastMessage.createdAtUtc);
  }, [isReadEligible, markChannelAsRead, selectedChannelMessages, selectedChannelView.isAtBottom, selectedTextChannelId]);

  useEffect(() => {
    const flushReadIfEligible = () => {
      const activeChannelId = selectedTextChannelIdRef.current;
      if (!activeChannelId) {
        return;
      }

      const channelState = getChannelChatViewState(chatViewStateRef.current, activeChannelId);
      if (!isReadEligible(activeChannelId, channelState.isAtBottom)) {
        return;
      }

      const messages = chatMessagesByChannelRef.current[activeChannelId] ?? [];
      const lastMessage = messages[messages.length - 1];
      if (!lastMessage) {
        return;
      }

      markChannelAsRead(activeChannelId, lastMessage.createdAtUtc);
    };

    flushReadIfEligible();
    window.addEventListener("focus", flushReadIfEligible);
    document.addEventListener("visibilitychange", flushReadIfEligible);

    return () => {
      window.removeEventListener("focus", flushReadIfEligible);
      document.removeEventListener("visibilitychange", flushReadIfEligible);
    };
  }, [centerMode, isReadEligible, markChannelAsRead, selectedTextChannelId]);

  useEffect(() => {
    setMentionQuery(findTrailingMentionQuery(messageDraft));
  }, [messageDraft]);

  useEffect(() => {
    if (!selectedTextChannelId || !mentionQuery) {
      setMentionCandidates([]);
      return;
    }

    const seq = ++mentionFetchSeqRef.current;
    const timeoutId = window.setTimeout(() => {
      const search = mentionQuery.query.trim();
      const query = encodeURIComponent(search);
      void apiCall<MentionCandidatesResponse>(
        `/channels/${selectedTextChannelId}/mention-candidates?q=${query}&limit=8`,
        "GET",
        undefined,
        props.token,
      )
        .then((response) => {
          if (mentionFetchSeqRef.current !== seq) {
            return;
          }
          setMentionCandidates(response.users);
        })
        .catch(() => {
          if (mentionFetchSeqRef.current !== seq) {
            return;
          }
          setMentionCandidates([]);
        });
    }, 180);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [mentionQuery, props.token, selectedTextChannelId]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void loadWorkspace().catch(() => undefined);
      if (props.currentUser.role === "Admin") {
        void loadApprovals().catch(() => undefined);
      }
    }, WORKSPACE_FALLBACK_SYNC_POLL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [props.currentUser.role, props.token]);

  useEffect(() => {
    if (!connectedVoiceChannelId) {
      setVoiceTabMode("idle");
      setVoiceSession(null);
      return;
    }

    if (voiceTabMode !== "active") {
      setVoiceSession(null);
      return;
    }

    if (voiceConnectRequestInFlightRef.current) {
      return;
    }

    if (suppressWorkspaceVoiceSyncRef.current && !voiceSession) {
      return;
    }

    if (voiceSession?.room.id === connectedVoiceChannelId) {
      return;
    }

    void ensureVoiceSession(connectedVoiceChannelId).catch((reason) => {
      if (connectedVoiceChannelIdRef.current !== connectedVoiceChannelId) {
        return;
      }

      if (isVoiceSessionReplacedError(reason)) {
        handleVoiceSessionReplaced();
        return;
      }

      if (isVoiceSessionUnavailableError(reason)) {
        clearVoiceClientState(undefined, { suppressWorkspaceVoiceSync: true });
        void loadWorkspace().catch(() => undefined);
        return;
      }

      if (isVoiceSessionActiveInAnotherTabError(reason)) {
        setVoiceTabMode("secondary");
        setVoiceSession(null);
        setInfoMessage("Voice session is active in another tab. Use takeover to move it here.");
        void loadWorkspace().catch(() => undefined);
        return;
      }

      setError(reason instanceof Error ? reason.message : "Voice connect failed");
    });
  }, [connectedVoiceChannelId, loadWorkspace, voiceSession, voiceTabMode]);

  useEffect(() => {
    setLiveVoiceMessages([]);
  }, [connectedVoiceChannelId]);

  useEffect(() => {
    const localConnectEarconType = resolveLocalConnectEarconType(
      previousVoiceEngineConnectedRef.current,
      voiceControlState.connected,
    );

    if (localConnectEarconType && voiceSession) {
      tryPlayVoiceEarcon(localConnectEarconType);
    }

    previousVoiceEngineConnectedRef.current = voiceControlState.connected;
  }, [voiceControlState.connected, voiceSession?.sessionInstanceId]);

  useEffect(() => {
    if (
      !shouldStartConnectingEarconLoop(
        Boolean(voiceSession),
        voiceControlState.connected,
        voiceControlState.connectionError,
      )
    ) {
      return;
    }

    tryPlayVoiceEarcon("connecting");
    const intervalId = window.setInterval(() => {
      tryPlayVoiceEarcon("connecting");
    }, CONNECTING_EARCON_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [voiceControlState.connected, voiceControlState.connectionError, voiceSession?.sessionInstanceId]);

  useEffect(() => {
    const previousConnectedVoiceChannelId = previousConnectedVoiceChannelIdRef.current;
    const nowMs = performance.now();
    if (
      shouldPlayLocalDisconnectEarcon(
        previousConnectedVoiceChannelId,
        connectedVoiceChannelId,
        nowMs,
        lastLocalDisconnectEarconAtRef.current,
      )
    ) {
      lastLocalDisconnectEarconAtRef.current = nowMs;
      tryPlayVoiceEarcon("disconnect");
    }

    previousConnectedVoiceChannelIdRef.current = connectedVoiceChannelId;
  }, [connectedVoiceChannelId]);

  const syncHubGroups = useCallback(async (hub: HubConnection) => {
    if (hub.state !== HubConnectionState.Connected) {
      return;
    }

    const nextWorkspaceId = workspaceIdRef.current;
    const nextTextChannelId = selectedTextChannelIdRef.current;
    const nextVoiceChannelId = connectedVoiceChannelIdRef.current;

    if (joinedWorkspaceIdRef.current && joinedWorkspaceIdRef.current !== nextWorkspaceId) {
      await hub.invoke("LeaveWorkspace", joinedWorkspaceIdRef.current).catch(() => undefined);
      joinedWorkspaceIdRef.current = null;
    }
    if (nextWorkspaceId && joinedWorkspaceIdRef.current !== nextWorkspaceId) {
      await hub.invoke("JoinWorkspace", nextWorkspaceId).catch(() => undefined);
      joinedWorkspaceIdRef.current = nextWorkspaceId;
    }

    if (joinedTextChannelIdRef.current && joinedTextChannelIdRef.current !== nextTextChannelId) {
      await hub.invoke("LeaveTextChannel", joinedTextChannelIdRef.current).catch(() => undefined);
      joinedTextChannelIdRef.current = null;
    }
    if (nextTextChannelId && joinedTextChannelIdRef.current !== nextTextChannelId) {
      await hub.invoke("JoinTextChannel", nextTextChannelId).catch(() => undefined);
      joinedTextChannelIdRef.current = nextTextChannelId;
    }

    if (joinedVoiceChannelIdRef.current && joinedVoiceChannelIdRef.current !== nextVoiceChannelId) {
      await hub.invoke("LeaveVoiceChannel", joinedVoiceChannelIdRef.current).catch(() => undefined);
      joinedVoiceChannelIdRef.current = null;
    }
    if (nextVoiceChannelId && joinedVoiceChannelIdRef.current !== nextVoiceChannelId) {
      await hub.invoke("JoinVoiceChannel", nextVoiceChannelId).catch(() => undefined);
      joinedVoiceChannelIdRef.current = nextVoiceChannelId;
    }
  }, []);

  useEffect(() => {
    const hub = new HubConnectionBuilder()
      .withUrl(`${API_BASE.replace(/\/api$/, "")}/hubs/chat`, {
        accessTokenFactory: () => props.token,
      })
      .withAutomaticReconnect()
      .configureLogging(SIGNALR_LOG_LEVEL)
      .build();
    hub.keepAliveIntervalInMilliseconds = SIGNALR_CLIENT_KEEPALIVE_MS;
    hub.serverTimeoutInMilliseconds = SIGNALR_SERVER_TIMEOUT_MS;

    hubRef.current = hub;
    joinedWorkspaceIdRef.current = null;
    joinedTextChannelIdRef.current = null;
    joinedVoiceChannelIdRef.current = null;

    hub.on("textMessage", (message: ChannelMessageDto) => {
      const existingMessages = chatMessagesByChannelRef.current[message.channelId] ?? [];
      const wasKnownMessage = existingMessages.some((item) => item.id === message.id);
      upsertChannelMessage(message.channelId, message);
      if (wasKnownMessage) {
        return;
      }

      const isOwnMessage = message.userId === currentUserIdRef.current;
      const isMentioningCurrentUser = message.mentions.some(
        (mention) => mention.userId === currentUserIdRef.current,
      );
      const channelView = getChannelChatViewState(chatViewStateRef.current, message.channelId);
      const isCurrentlyReadable = isReadEligible(message.channelId, channelView.isAtBottom);
      const shouldMarkUnread = !isOwnMessage && !isCurrentlyReadable;

      if (shouldMarkUnread) {
        setChatViewState((current) => incrementChannelUnread(current, message.channelId, message.id));
      } else if (!isOwnMessage && isCurrentlyReadable) {
        markChannelAsRead(message.channelId, message.createdAtUtc);
      }

      if (isOwnMessage) {
        return;
      }

      if (isMentioningCurrentUser) {
        tryPlayChatEarcon("mention");
        return;
      }

      const shouldPlayMessageSound = !isCurrentlyReadable;
      if (shouldPlayMessageSound) {
        tryPlayChatEarcon("message");
      }
    });

    hub.on(
      "voiceMessage",
      (message: { channelId: string; userId: string; username: string; content: string; createdAtUtc: string }) => {
        if (message.channelId === connectedVoiceChannelIdRef.current) {
          setLiveVoiceMessages((current) => [...current.slice(-80), message]);
        }
      },
    );

    const applyVoicePresenceEvent = (rawEvent: unknown, source: "workspace" | "voiceChannel") => {
      const event = normalizeVoicePresenceChangedEvent(rawEvent);
      if (!event) {
        return;
      }

      const currentWorkspaceId = workspaceIdRef.current;
      if (!currentWorkspaceId || event.workspaceId !== currentWorkspaceId) {
        return;
      }

      if (
        !shouldApplyVoicePresenceEventForSource(
          event,
          source,
          connectedVoiceChannelIdRef.current,
        )
      ) {
        return;
      }

      const signature = buildVoicePresenceEventSignature(event);
      const lastSignature = lastVoicePresenceSignatureByUserRef.current[event.userId];
      if (lastSignature === signature) {
        return;
      }

      const lastOccurredAtMs = lastVoicePresenceEventAtByUserRef.current[event.userId] ?? -Infinity;
      const presenceOrdering = shouldApplyVoicePresenceByTimestamp(event.occurredAtUtc, lastOccurredAtMs);
      if (!presenceOrdering.shouldApply) {
        return;
      }
      lastVoicePresenceEventAtByUserRef.current[event.userId] = presenceOrdering.occurredAtMs;
      lastVoicePresenceSignatureByUserRef.current[event.userId] = signature;

      setWorkspaceData((current) => {
        if (!current || current.workspace.id !== event.workspaceId) {
          return current;
        }

        const memberIndex = current.members.findIndex((member) => member.userId === event.userId);
        if (memberIndex < 0) {
          if (!event.currentVoiceChannelId) {
            return current;
          }

          const nextMembers = current.members.concat({
            userId: event.userId,
            username: event.username,
            role: "User",
            avatarUrl: event.avatarUrl,
            connectedVoiceChannelId: event.currentVoiceChannelId,
            isScreenSharing: event.isScreenSharing,
            isMuted: event.isMuted,
            isDeafened: event.isDeafened,
            isServerMuted: event.isServerMuted,
            isServerDeafened: event.isServerDeafened,
          });

          return {
            ...current,
            members: nextMembers,
          };
        }

        const nextMembers = patchWorkspaceMembersVoiceState(current.members, event);
        if (nextMembers === current.members) {
          return current;
        }

        return {
          ...current,
          members: nextMembers,
        };
      });

      if (event.userId === currentUserIdRef.current) {
        setSelfMuted(event.isMuted);
        setSelfDeafened(event.isDeafened);
        setSelfServerMuted(event.isServerMuted);
        setSelfServerDeafened(event.isServerDeafened);
      }

      if (
        shouldForceLocalVoiceDisconnectFromPresence(
          event,
          currentUserIdRef.current,
          connectedVoiceChannelIdRef.current,
          voiceConnectRequestInFlightRef.current,
        )
      ) {
        voiceConnectionIntentSeqRef.current += 1;
        voiceConnectRequestInFlightRef.current = false;
        clearVoiceClientState("You were disconnected from this voice channel.", {
          suppressWorkspaceVoiceSync: true,
        });
        patchSelfWorkspaceVoiceState({
          connectedVoiceChannelId: null,
          isScreenSharing: false,
          isMuted: false,
          isDeafened: false,
          isServerMuted: false,
          isServerDeafened: false,
        });
        void loadWorkspace().catch(() => undefined);
        return;
      }

      const earconType = resolveVoiceEarconType(
        event,
        connectedVoiceChannelIdRef.current,
        currentUserIdRef.current,
      );
      if (!earconType) {
        return;
      }

      tryPlayVoiceEarcon(earconType);
    };

    hub.on("voicePresenceChanged", (rawEvent: unknown) => {
      applyVoicePresenceEvent(rawEvent, "workspace");
    });
    hub.on("voiceChannelPresenceChanged", (rawEvent: unknown) => {
      applyVoicePresenceEvent(rawEvent, "voiceChannel");
    });

    void hub
      .start()
      .then(async () => {
        await syncHubGroups(hub);
      })
      .catch(() => undefined);

    hub.onreconnected(() => {
      void syncHubGroups(hub);
      void loadWorkspace().catch(() => undefined);
      const activeTextChannelId = selectedTextChannelIdRef.current;
      if (activeTextChannelId) {
        void syncMessagesForChannel(activeTextChannelId).catch(() => undefined);
      }
    });

    return () => {
      if (hubRef.current === hub) {
        hubRef.current = null;
      }
      joinedWorkspaceIdRef.current = null;
      joinedTextChannelIdRef.current = null;
      joinedVoiceChannelIdRef.current = null;
      void hub.stop();
    };
  }, [isReadEligible, loadWorkspace, markChannelAsRead, props.token, syncHubGroups, syncMessagesForChannel, upsertChannelMessage]);

  useEffect(() => {
    const hub = hubRef.current;
    if (!hub || hub.state !== HubConnectionState.Connected) {
      return;
    }

    void syncHubGroups(hub);
  }, [connectedVoiceChannelId, selectedTextChannelId, syncHubGroups, workspaceId]);

  useEffect(() => {
    const heartbeatChannelId = voiceSession?.room.id ?? null;
    if (!heartbeatChannelId || !voiceSession?.sessionInstanceId) {
      return;
    }

    let disposed = false;
    let intervalId = 0;

    const stopHeartbeat = () => {
      if (disposed) {
        return;
      }
      disposed = true;
      if (intervalId) {
        window.clearInterval(intervalId);
      }
    };

    const sendHeartbeat = async () => {
      try {
        await apiCall<void>(
          "/voice/heartbeat",
          "POST",
          {
            channelId: heartbeatChannelId,
            sessionInstanceId: voiceSession.sessionInstanceId,
          },
          props.token,
        );
      } catch (reason) {
        if (disposed) {
          return;
        }

        if (isVoiceSessionReplacedError(reason)) {
          stopHeartbeat();
          handleVoiceSessionReplaced();
          return;
        }

        if (isVoiceSessionUnavailableError(reason)) {
          stopHeartbeat();
          clearVoiceClientState(undefined, { suppressWorkspaceVoiceSync: true });
          void loadWorkspace().catch(() => undefined);
        }
      }
    };

    void sendHeartbeat();
    intervalId = window.setInterval(() => {
      void sendHeartbeat();
    }, 15000);

    return () => {
      disposed = true;
      if (intervalId) {
        window.clearInterval(intervalId);
      }
    };
  }, [loadWorkspace, props.token, voiceSession?.room.id, voiceSession?.sessionInstanceId]);

  useEffect(() => {
    const disconnectChannelId = voiceSession?.room.id ?? null;
    if (!disconnectChannelId || !voiceSession?.sessionInstanceId) {
      return;
    }

    const payload = JSON.stringify({
      channelId: disconnectChannelId,
      sessionInstanceId: voiceSession.sessionInstanceId,
    });

    const releaseOnPageHide = () => {
      let beaconDelivered = false;
      try {
        if (typeof navigator.sendBeacon === "function") {
          const beaconBody = new Blob([payload], { type: "application/json" });
          beaconDelivered = navigator.sendBeacon(
            `${API_BASE}/voice/disconnect?access_token=${encodeURIComponent(props.token)}`,
            beaconBody,
          );
        }
      } catch {
        beaconDelivered = false;
      }

      if (beaconDelivered) {
        return;
      }

      void fetch(`${API_BASE}/voice/disconnect`, {
        method: "POST",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${props.token}`,
        },
        body: payload,
      }).catch(() => undefined);
    };

    window.addEventListener("pagehide", releaseOnPageHide);
    window.addEventListener("beforeunload", releaseOnPageHide);
    return () => {
      window.removeEventListener("pagehide", releaseOnPageHide);
      window.removeEventListener("beforeunload", releaseOnPageHide);
    };
  }, [props.token, voiceSession?.room.id, voiceSession?.sessionInstanceId]);

  const sendTextMessage = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedTextChannelId || (!messageDraft.trim() && attachments.length === 0)) {
      return;
    }

    const clientMessageId = crypto.randomUUID();
    const created = await apiCall<ChannelMessageDto>(
      `/channels/${selectedTextChannelId}/messages`,
      "POST",
      {
        clientMessageId,
        content: messageDraft,
        attachmentUrls: attachments,
      },
      props.token,
    );

    upsertChannelMessage(selectedTextChannelId, created);
    setMessageDraft("");
    setAttachments([]);
    setMentionCandidates([]);
    setMentionQuery(null);
    markChannelAsRead(selectedTextChannelId, created.createdAtUtc);
  };

  const uploadChatImage = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      throw new Error("Only image files are allowed.");
    }

    const formData = new FormData();
    formData.append("file", file);
    const uploaded = await apiCall<UploadImageResponse>(
      "/uploads/chat-image",
      "POST",
      formData,
      props.token,
    );
    setAttachments((current) => appendAttachmentUrl(current, uploaded.url));
  };

  const removeComposerAttachment = (url: string) => {
    setAttachments((current) => removeAttachmentUrl(current, url));
  };

  const handleComposerPaste = (event: ReactClipboardEvent<HTMLInputElement>) => {
    const files = extractImageFilesFromClipboardItems(Array.from(event.clipboardData?.items ?? []));
    if (files.length === 0) {
      return;
    }

    event.preventDefault();
    const availableSlots = Math.max(0, 4 - attachments.length);
    for (const file of files.slice(0, availableSlots)) {
      void uploadChatImage(file).catch((reason) => {
        setError(reason instanceof Error ? reason.message : "Upload failed");
      });
    }
  };

  const handleComposerInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Escape") {
      return;
    }

    setMentionCandidates([]);
    setMentionQuery(null);
    event.currentTarget.blur();
  };

  const handleMessageListScroll = () => {
    const activeChannelId = selectedTextChannelIdRef.current;
    const element = messageListRef.current;
    if (!activeChannelId || !element) {
      return;
    }

    const atBottom = isNearBottom(element);
    setChatViewState((current) => setChannelIsAtBottom(current, activeChannelId, atBottom));
    if (!atBottom) {
      return;
    }

    const messages = chatMessagesByChannelRef.current[activeChannelId] ?? [];
    const last = messages[messages.length - 1];
    if (last && isReadEligible(activeChannelId, true)) {
      markChannelAsRead(activeChannelId, last.createdAtUtc);
    }
  };

  const jumpToPresent = () => {
    const activeChannelId = selectedTextChannelId;
    if (!activeChannelId) {
      return;
    }

    scrollActiveChatToBottom("smooth");
    const messages = chatMessagesByChannelRef.current[activeChannelId] ?? [];
    const last = messages[messages.length - 1];
    if (last && isReadEligible(activeChannelId, true)) {
      markChannelAsRead(activeChannelId, last.createdAtUtc);
    }
  };

  const closeAttachmentMenu = () => {
    setAttachmentMenuAnchorEl(null);
  };

  const openAttachmentMenu = (event: ReactMouseEvent<HTMLElement>) => {
    setAttachmentMenuAnchorEl(event.currentTarget);
  };

  const pickPhotoFromAttachMenu = () => {
    closeAttachmentMenu();
    attachPhotoInputRef.current?.click();
  };

  const handlePhotoPickerChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) {
      return;
    }

    const availableSlots = Math.max(0, 4 - attachments.length);
    for (const file of files.slice(0, availableSlots)) {
      void uploadChatImage(file).catch((reason) => {
        setError(reason instanceof Error ? reason.message : "Upload failed");
      });
    }
    event.target.value = "";
  };

  const selectMentionCandidate = (candidate: MentionCandidateDto) => {
    if (!mentionQuery) {
      return;
    }

    setMessageDraft((current) => applyMentionSelection(current, mentionQuery, candidate.username));
    setMentionCandidates([]);
    setMentionQuery(null);
  };

  const openImageLightbox = (messageAttachments: MessageAttachmentDto[], index: number) => {
    if (messageAttachments.length === 0) {
      return;
    }

    const safeIndex = Math.min(Math.max(index, 0), messageAttachments.length - 1);
    setImageLightbox({
      attachments: messageAttachments,
      index: safeIndex,
      zoom: 1,
    });
  };

  const closeImageLightbox = () => {
    setImageLightbox(null);
  };

  const shiftLightboxIndex = useCallback((delta: number) => {
    setImageLightbox((current) => {
      if (!current || current.attachments.length < 2) {
        return current;
      }

      const nextIndex =
        (current.index + delta + current.attachments.length) % current.attachments.length;
      return { ...current, index: nextIndex };
    });
  }, []);

  const adjustLightboxZoom = useCallback((delta: number) => {
    setImageLightbox((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        zoom: Math.min(4, Math.max(1, Number((current.zoom + delta).toFixed(2)))),
      };
    });
  }, []);

  useEffect(() => {
    if (!imageLightbox) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeImageLightbox();
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        shiftLightboxIndex(-1);
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        shiftLightboxIndex(1);
        return;
      }

      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        adjustLightboxZoom(0.2);
        return;
      }

      if (event.key === "-") {
        event.preventDefault();
        adjustLightboxZoom(-0.2);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [adjustLightboxZoom, imageLightbox, shiftLightboxIndex]);

  const openAvatarPicker = () => {
    avatarInputRef.current?.click();
  };

  const handleAvatarSelected = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Only images can be used for avatar.");
      return;
    }

    const source = await readFileAsDataUrl(file);
    setAvatarCropSource(source);
    setAvatarCropZoom(1.2);
    setAvatarCropX(0);
    setAvatarCropY(0);
  };

  const uploadAvatarFromCrop = async () => {
    if (!avatarCropSource) {
      return;
    }

    const blob = await buildAvatarBlob(avatarCropSource, avatarCropZoom, avatarCropX, avatarCropY);
    const formData = new FormData();
    formData.append("file", blob, "avatar.png");

    const profile = await apiCall<ProfileResponse>("/profile/avatar", "POST", formData, props.token);
    setCurrentAvatarUrl(profile.user.avatarUrl);
    props.onUserUpdated(profile.user);
    setAvatarCropSource(null);
    await loadWorkspace();
  };

  const clearVoiceClientState = (
    notice?: string,
    options?: {
      suppressWorkspaceVoiceSync?: boolean;
    },
  ) => {
    if (options?.suppressWorkspaceVoiceSync) {
      suppressWorkspaceVoiceSyncRef.current = true;
    }

    setConnectedVoiceChannelId(null);
    setVoiceTabMode("idle");
    setVoiceSession(null);
    voiceControlActionsRef.current = null;
    autoMutedByDeafenRef.current = false;
    setVoiceControlState({ muted: false, sharing: false, connected: false, connectionError: false });
    setSelfMuted(false);
    setSelfDeafened(false);
    setSelfServerMuted(false);
    setSelfServerDeafened(false);
    setSpeakingUserIds(new Set());
    setLiveVoiceMessages([]);
    if (notice) {
      setInfoMessage(notice);
    }
  };

  const handleVoiceSessionReplaced = () => {
    voiceConnectionIntentSeqRef.current += 1;
    voiceConnectRequestInFlightRef.current = false;
    clearVoiceClientState("Voice session moved to another tab.", {
      suppressWorkspaceVoiceSync: true,
    });
    patchSelfWorkspaceVoiceState({
      connectedVoiceChannelId: null,
      isScreenSharing: false,
      isMuted: false,
      isDeafened: false,
      isServerMuted: false,
      isServerDeafened: false,
    });
    void loadWorkspace().catch(() => undefined);
  };

  const connectVoice = async (channelId: string, options?: { allowTakeover?: boolean }) => {
    const previousConnectedVoiceChannelId = connectedVoiceChannelIdRef.current;
    const previousSelectedVoiceChannelId = selectedVoiceChannelId;
    const previousVoiceSession = voiceSessionRef.current;
    const previousVoiceTabMode = voiceTabMode;
    const intentSeq = ++voiceConnectionIntentSeqRef.current;
    voiceConnectRequestInFlightRef.current = true;
    suppressWorkspaceVoiceSyncRef.current = false;

    setConnectedVoiceChannelId(channelId);
    setSelectedVoiceChannelId(channelId);
    setCenterMode("voice");
    patchSelfWorkspaceVoiceState({
      connectedVoiceChannelId: channelId,
    });

    try {
      const connected = await apiCall<VoiceConnectResponse>(
        "/voice/connect",
        "POST",
        { channelId, tabInstanceId, allowTakeover: options?.allowTakeover ?? false },
        props.token,
      );

      if (intentSeq !== voiceConnectionIntentSeqRef.current) {
        return;
      }

      setConnectedVoiceChannelId(connected.channelId);
      setSelectedVoiceChannelId(connected.channelId);
      setCenterMode("voice");
      setVoiceTabMode("active");
      setVoiceSession(mapVoiceToRoomSession(connected, props.currentUser, props.token));
      patchSelfWorkspaceVoiceState({
        connectedVoiceChannelId: connected.channelId,
      });
      void loadWorkspace().catch(() => undefined);
    } catch (reason) {
      if (intentSeq !== voiceConnectionIntentSeqRef.current) {
        return;
      }

      if (isVoiceSessionActiveInAnotherTabError(reason)) {
        setConnectedVoiceChannelId(previousConnectedVoiceChannelId);
        setSelectedVoiceChannelId(previousSelectedVoiceChannelId);
        setVoiceSession(null);
        setVoiceTabMode("secondary");
        setInfoMessage("Voice session is active in another tab. Use takeover to move it here.");
        void loadWorkspace().catch(() => undefined);
        return;
      }

      setConnectedVoiceChannelId(previousConnectedVoiceChannelId);
      setSelectedVoiceChannelId(previousSelectedVoiceChannelId);
      setVoiceSession(previousVoiceSession);
      setVoiceTabMode(previousVoiceTabMode);
      patchSelfWorkspaceVoiceState({
        connectedVoiceChannelId: previousConnectedVoiceChannelId,
      });

      throw reason;
    } finally {
      if (intentSeq === voiceConnectionIntentSeqRef.current) {
        voiceConnectRequestInFlightRef.current = false;
      }
    }
  };

  const disconnectVoice = async () => {
    const previousVoiceSession = voiceSessionRef.current;
    const previousConnectedVoiceChannelId =
      previousVoiceSession?.room.id ?? connectedVoiceChannelIdRef.current;
    if (!previousConnectedVoiceChannelId) {
      return;
    }

    const previousSelfState = {
      isMuted: selfMuted,
      isDeafened: selfDeafened,
      isServerMuted: selfServerMuted,
      isServerDeafened: selfServerDeafened,
    };
    const previousVoiceTabMode = voiceTabMode;
    const sessionInstanceId = previousVoiceSession?.sessionInstanceId ?? "";
    const intentSeq = ++voiceConnectionIntentSeqRef.current;
    voiceConnectRequestInFlightRef.current = true;
    suppressWorkspaceVoiceSyncRef.current = true;
    setConnectedVoiceChannelId(null);
    setVoiceTabMode("idle");
    patchSelfWorkspaceVoiceState({
      connectedVoiceChannelId: null,
      isScreenSharing: false,
      isMuted: false,
      isDeafened: false,
      isServerMuted: false,
      isServerDeafened: false,
    });

    try {
      try {
        await apiCall<void>(
          "/voice/disconnect",
          "POST",
          { channelId: previousConnectedVoiceChannelId, sessionInstanceId },
          props.token,
        );
      } catch (reason) {
        if (intentSeq !== voiceConnectionIntentSeqRef.current) {
          return;
        }

        if (!isVoiceSessionUnavailableError(reason)) {
          suppressWorkspaceVoiceSyncRef.current = false;
          setConnectedVoiceChannelId(previousConnectedVoiceChannelId);
          setVoiceTabMode(previousVoiceTabMode);
          setSelectedVoiceChannelId(previousConnectedVoiceChannelId);
          setVoiceSession(previousVoiceSession);
          setSelfMuted(previousSelfState.isMuted);
          setSelfDeafened(previousSelfState.isDeafened);
          setSelfServerMuted(previousSelfState.isServerMuted);
          setSelfServerDeafened(previousSelfState.isServerDeafened);
          patchSelfWorkspaceVoiceState({
            connectedVoiceChannelId: previousConnectedVoiceChannelId,
            isMuted: previousSelfState.isMuted,
            isDeafened: previousSelfState.isDeafened,
            isServerMuted: previousSelfState.isServerMuted,
            isServerDeafened: previousSelfState.isServerDeafened,
          });
          throw reason;
        }
      }

      if (intentSeq === voiceConnectionIntentSeqRef.current) {
        clearVoiceClientState();
        setVoiceTabMode("idle");
        patchSelfWorkspaceVoiceState({
          connectedVoiceChannelId: null,
          isScreenSharing: false,
          isMuted: false,
          isDeafened: false,
          isServerMuted: false,
          isServerDeafened: false,
        });
        void loadWorkspace().catch(() => undefined);
      }
    } finally {
      if (intentSeq === voiceConnectionIntentSeqRef.current) {
        voiceConnectRequestInFlightRef.current = false;
      }
    }
  };

  const takeOverVoiceSession = async () => {
    const channelId = connectedVoiceChannelIdRef.current;
    if (!channelId) {
      return;
    }

    await connectVoice(channelId, { allowTakeover: true });
  };

  const applySelfState = async (nextMuted: boolean, nextDeafened: boolean) => {
    const selfStateChannelId = voiceSession?.room.id ?? connectedVoiceChannelId;
    if (!selfStateChannelId) {
      return;
    }

    const requestedMuted = nextDeafened ? true : nextMuted;

    const optimisticUpdate = createOptimisticSelfVoiceStateUpdate(
      {
        isMuted: selfMuted,
        isDeafened: selfDeafened,
        isServerMuted: selfServerMuted,
        isServerDeafened: selfServerDeafened,
      },
      requestedMuted,
      nextDeafened,
      isCurrentUserAdmin,
    );

    setSelfMuted(optimisticUpdate.optimistic.isMuted);
    setSelfDeafened(optimisticUpdate.optimistic.isDeafened);
    setSelfServerMuted(optimisticUpdate.optimistic.isServerMuted);
    setSelfServerDeafened(optimisticUpdate.optimistic.isServerDeafened);
    patchSelfWorkspaceVoiceState({
      isMuted: optimisticUpdate.optimistic.isMuted,
      isDeafened: optimisticUpdate.optimistic.isDeafened,
      isServerMuted: optimisticUpdate.optimistic.isServerMuted,
      isServerDeafened: optimisticUpdate.optimistic.isServerDeafened,
    });

    try {
      await apiCall<void>(
        "/voice/self-state",
        "POST",
        {
          channelId: selfStateChannelId,
          sessionInstanceId: voiceSession?.sessionInstanceId ?? "",
          isMuted: requestedMuted,
          isDeafened: nextDeafened,
        },
        props.token,
      );
    } catch (reason) {
      if (isVoiceSessionReplacedError(reason)) {
        handleVoiceSessionReplaced();
        return;
      }

      setSelfMuted(optimisticUpdate.rollback.isMuted);
      setSelfDeafened(optimisticUpdate.rollback.isDeafened);
      setSelfServerMuted(optimisticUpdate.rollback.isServerMuted);
      setSelfServerDeafened(optimisticUpdate.rollback.isServerDeafened);
      patchSelfWorkspaceVoiceState({
        isMuted: optimisticUpdate.rollback.isMuted,
        isDeafened: optimisticUpdate.rollback.isDeafened,
        isServerMuted: optimisticUpdate.rollback.isServerMuted,
        isServerDeafened: optimisticUpdate.rollback.isServerDeafened,
      });

      if (isVoiceServerModeratedError(reason)) {
        setInfoMessage("Voice state is controlled by server moderation.");
        await loadWorkspace();
        return;
      }
      throw reason;
    }

    await loadWorkspace();
  };

  const toggleSelfMute = async () => {
    const nextMuted = !selfMuted;
    if (selfDeafened && !nextMuted) {
      setInfoMessage("Undeafen before unmuting your microphone.");
      return;
    }

    const blockedByServerModeration =
      !isCurrentUserAdmin &&
      !nextMuted &&
      (selfServerMuted || selfServerDeafened);
    if (blockedByServerModeration) {
      setInfoMessage("Only an admin can remove server mute/deafen.");
      return;
    }

    await applySelfState(nextMuted, selfDeafened);
  };

  const toggleSelfDeafen = async () => {
    const nextDeafened = !selfDeafened;
    const blockedByServerDeafen = !isCurrentUserAdmin && !nextDeafened && selfServerDeafened;
    if (blockedByServerDeafen) {
      setInfoMessage("Only an admin can remove server deafen.");
      return;
    }

    if (nextDeafened) {
      autoMutedByDeafenRef.current = !selfMuted;
      await applySelfState(true, true);
      return;
    }

    let nextMuted = selfMuted;
    if (autoMutedByDeafenRef.current) {
      nextMuted = false;
    }

    const blockedByServerMute = !isCurrentUserAdmin && !nextMuted && selfServerMuted;
    if (blockedByServerMute) {
      setInfoMessage("Only an admin can remove server mute.");
      return;
    }

    autoMutedByDeafenRef.current = false;
    await applySelfState(nextMuted, false);
  };

  const sendLiveVoiceMessage = async (content: string) => {
    if (!connectedVoiceChannelId || !content.trim()) {
      return;
    }

    const hub = hubRef.current;
    if (!hub) {
      return;
    }

    await hub.invoke("SendVoiceMessage", connectedVoiceChannelId, content.trim());
  };

  const approveUser = async (userId: string) => {
    await apiCall<void>(`/admin/approvals/${userId}/approve`, "POST", undefined, props.token);
    await loadApprovals();
  };

  const rejectUser = async (userId: string) => {
    await apiCall<void>(`/admin/approvals/${userId}/reject`, "POST", undefined, props.token);
    await loadApprovals();
  };

  const openCreateChannelDialog = (type: ChannelType) => {
    setCreateChannelType(type);
    setCreateChannelName("");
    setCreateVoiceMaxParticipants("12");
    setCreateVoiceMaxStreams("4");
    setCreateChannelError(null);
  };

  const closeCreateChannelDialog = () => {
    if (createChannelSubmitting) {
      return;
    }

    setCreateChannelType(null);
    setCreateChannelError(null);
  };

  const submitCreateChannel = async () => {
    if (!createChannelType) {
      return;
    }

    const name = createChannelName.trim();
    if (name.length < 2) {
      setCreateChannelError("Channel name must have at least 2 characters.");
      return;
    }

    let maxParticipants: number | undefined;
    let maxConcurrentStreams: number | undefined;

    if (createChannelType === "Voice") {
      const parsedParticipants = Number.parseInt(createVoiceMaxParticipants, 10);
      const parsedStreams = Number.parseInt(createVoiceMaxStreams, 10);

      if (!Number.isFinite(parsedParticipants) || parsedParticipants < 1 || parsedParticipants > 99) {
        setCreateChannelError("Max participants must be between 1 and 99.");
        return;
      }

      if (!Number.isFinite(parsedStreams) || parsedStreams < 1 || parsedStreams > 16) {
        setCreateChannelError("Max concurrent streams must be between 1 and 16.");
        return;
      }

      maxParticipants = parsedParticipants;
      maxConcurrentStreams = parsedStreams;
    }

    setCreateChannelSubmitting(true);
    setCreateChannelError(null);

    try {
      await apiCall<ChannelDto>(
        "/workspace/channels",
        "POST",
        {
          name,
          type: createChannelType,
          maxParticipants,
          maxConcurrentStreams,
        },
        props.token,
      );

      setCreateChannelType(null);
      await loadWorkspace();
    } catch (reason) {
      setCreateChannelError(reason instanceof Error ? reason.message : "Create channel failed");
    } finally {
      setCreateChannelSubmitting(false);
    }
  };

  const toggleShareFromVoicePanel = async () => {
    if (!voiceControlActionsRef.current || !connectedVoiceChannelId) {
      return;
    }

    if (!voiceControlState.connected) {
      setInfoMessage("Voice is still connecting. Screen share will be available when connection is ready.");
      return;
    }

    try {
      await voiceControlActionsRef.current.toggleShare();
    } catch (reason) {
      if (isVoiceSessionReplacedError(reason)) {
        handleVoiceSessionReplaced();
        return;
      }
      throw reason;
    }
  };

  const kickFromVoice = async (channelId: string, targetUserId: string) => {
    await apiCall<void>(
      "/voice/moderation/kick",
      "POST",
      {
        channelId,
        targetUserId,
      },
      props.token,
    );
    await loadWorkspace();
  };

  const setServerMuted = async (channelId: string, targetUserId: string, muted: boolean) => {
    const targetMember = workspaceData?.members.find((member) => member.userId === targetUserId) ?? null;
    const previousVoiceState = targetMember
      ? {
          isMuted: targetMember.isMuted,
          isDeafened: targetMember.isDeafened,
          isServerMuted: targetMember.isServerMuted,
          isServerDeafened: targetMember.isServerDeafened,
        }
      : null;

    if (previousVoiceState) {
      const optimisticVoiceState = applyOptimisticModerationVoiceState(previousVoiceState, {
        isServerMuted: muted,
      });
      patchWorkspaceMemberVoiceFlags(targetUserId, optimisticVoiceState);
    }

    try {
      await apiCall<void>(
        "/voice/moderation/mute",
        "POST",
        {
          channelId,
          targetUserId,
          isMuted: muted,
        },
        props.token,
      );
    } catch (reason) {
      if (previousVoiceState) {
        patchWorkspaceMemberVoiceFlags(targetUserId, previousVoiceState);
      }
      throw reason;
    }

    await loadWorkspace();
  };

  const setServerDeafened = async (channelId: string, targetUserId: string, deafened: boolean) => {
    const targetMember = workspaceData?.members.find((member) => member.userId === targetUserId) ?? null;
    const previousVoiceState = targetMember
      ? {
          isMuted: targetMember.isMuted,
          isDeafened: targetMember.isDeafened,
          isServerMuted: targetMember.isServerMuted,
          isServerDeafened: targetMember.isServerDeafened,
        }
      : null;

    if (previousVoiceState) {
      const optimisticVoiceState = applyOptimisticModerationVoiceState(previousVoiceState, {
        isServerDeafened: deafened,
      });
      patchWorkspaceMemberVoiceFlags(targetUserId, optimisticVoiceState);
    }

    try {
      await apiCall<void>(
        "/voice/moderation/deafen",
        "POST",
        {
          channelId,
          targetUserId,
          isDeafened: deafened,
        },
        props.token,
      );
    } catch (reason) {
      if (previousVoiceState) {
        patchWorkspaceMemberVoiceFlags(targetUserId, previousVoiceState);
      }
      throw reason;
    }

    await loadWorkspace();
  };

  const setUserRole = async (targetUserId: string, role: PlatformRole) => {
    await apiCall<void>(
      `/admin/users/${targetUserId}/role`,
      "POST",
      { role },
      props.token,
    );
    setInfoMessage("Role updated. Changes will apply for the target user after re-login.");
    await loadWorkspace();
  };

  const openParticipantContextMenu = (
    event: ReactMouseEvent<HTMLElement>,
    payload: { channelId: string; userId: string },
  ) => {
    if (payload.userId === props.currentUser.id) {
      return;
    }

    if (!voiceSession) {
      setInfoMessage("Join this voice channel first to open participant controls.");
      return;
    }

    setParticipantMenuRequest({
      id: participantMenuSeqRef.current++,
      channelId: payload.channelId,
      userId: payload.userId,
      mouseX: event.clientX + 2,
      mouseY: event.clientY - 6,
    });
  };

  const handleVoiceControlsChange = (controls: EmbeddedVoiceControls | null) => {
    if (!controls) {
      voiceControlActionsRef.current = null;
      setVoiceControlState({ muted: false, sharing: false, connected: false, connectionError: false });
      return;
    }

    voiceControlActionsRef.current = {
      setMuted: controls.setMuted,
      toggleMute: controls.toggleMute,
      toggleShare: controls.toggleShare,
      openSettings: controls.openSettings,
    };

    setVoiceControlState((current) => {
      if (
        current.muted === controls.muted &&
        current.sharing === controls.sharing &&
        current.connected === controls.connected &&
        current.connectionError === controls.connectionError
      ) {
        return current;
      }
      return {
        muted: controls.muted,
        sharing: controls.sharing,
        connected: controls.connected,
        connectionError: controls.connectionError,
      };
    });
  };

  useEffect(() => {
    if (!voiceSession || !voiceControlActionsRef.current) {
      return;
    }

    const effectiveLocalMute = selfMuted || selfDeafened || selfServerDeafened;
    void voiceControlActionsRef.current.setMuted(effectiveLocalMute).catch((reason) => {
      const message =
        reason instanceof Error ? reason.message : "Failed to sync microphone state.";
      setError(message);
    });
  }, [selfMuted, selfDeafened, selfServerDeafened, voiceSession?.sessionInstanceId]);

  if (loading) {
    return (
      <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <CircularProgress size={22} />
          <Typography>Loading workspace...</Typography>
        </Stack>
      </Box>
    );
  }

  if (!workspaceData) {
    return (
      <Container maxWidth="sm" sx={{ py: 5 }}>
        <Alert severity="error">{error ?? "Failed to load workspace"}</Alert>
      </Container>
    );
  }

  return (
    <Box sx={{ height: "100vh", overflow: "hidden", p: 1.2, position: "relative" }}>
      <input
        ref={avatarInputRef}
        hidden
        type="file"
        accept="image/*"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) {
            return;
          }

          void handleAvatarSelected(file).catch((reason) => {
            setError(reason instanceof Error ? reason.message : "Avatar upload failed");
          });
          event.target.value = "";
        }}
      />
      <input
        ref={attachPhotoInputRef}
        hidden
        type="file"
        accept="image/*"
        multiple
        onChange={handlePhotoPickerChange}
      />

      {(error || infoMessage) && (
        <Stack
          spacing={1}
          sx={{
            position: "absolute",
            top: 10,
            left: 10,
            right: 10,
            zIndex: 1500,
            pointerEvents: "none",
          }}
        >
          {error && (
            <Alert
              severity="error"
              onClose={() => setError(null)}
              sx={{
                pointerEvents: "auto",
                maxWidth: "100%",
              }}
            >
              {error}
            </Alert>
          )}
          {infoMessage && (
            <Alert
              severity="info"
              onClose={() => setInfoMessage(null)}
              sx={{
                pointerEvents: "auto",
                maxWidth: "100%",
              }}
            >
              {infoMessage}
            </Alert>
          )}
        </Stack>
      )}

      <Box
        sx={{
          height: "100%",
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "300px minmax(0,1fr)" },
          gap: 1.1,
        }}
      >
        <ChannelSidebar
          workspaceName={workspaceData.workspace.name}
          workspaceUnreadCount={workspaceUnreadCount}
          currentUser={props.currentUser}
          currentAvatarUrl={currentAvatarUrl}
          textChannels={textChannels}
          textChannelUnreadCounts={textChannelUnreadCounts}
          voiceChannels={voiceChannels}
          members={workspaceData.members}
          speakingUserIds={speakingUserIds}
          selectedTextChannelId={selectedTextChannelId}
          selectedVoiceChannelId={selectedVoiceChannelId}
          connectedVoiceChannelId={connectedVoiceChannelId}
          voiceTabMode={voiceTabMode}
          selfMuted={selfMuted}
          selfDeafened={selfDeafened}
          canManageChannels={props.currentUser.role === "Admin"}
          pendingApprovalsCount={pendingApprovals.length}
          onSelectVoiceChannel={(channelId) => {
            setSelectedVoiceChannelId(channelId);
          }}
          onConnectVoiceChannel={(channelId) => {
            if (voiceTabMode === "secondary") {
              setInfoMessage("Voice session is active in another tab. Use takeover to move it here.");
              return;
            }

            if (connectedVoiceChannelId === channelId) {
              setCenterMode("voice");
              return;
            }
            void connectVoice(channelId).catch((reason) => {
              setError(reason instanceof Error ? reason.message : "Voice connect failed");
            });
          }}
          onSelectTextChannel={(channelId) => {
            setSelectedTextChannelId(channelId);
            setCenterMode("text");
          }}
          onCreateChannel={openCreateChannelDialog}
          onOpenServerSettings={() => setServerSettingsOpen(true)}
          onToggleSelfMute={() => {
            void toggleSelfMute().catch((reason) => {
              setError(reason instanceof Error ? reason.message : "Mute update failed");
            });
          }}
          onToggleSelfDeafen={() => {
            void toggleSelfDeafen().catch((reason) => {
              setError(reason instanceof Error ? reason.message : "Deafen update failed");
            });
          }}
          onToggleShare={() => {
            void toggleShareFromVoicePanel().catch((reason) => {
              setError(reason instanceof Error ? reason.message : "Share failed");
            });
          }}
          onOpenVoiceSettings={() => {
            if (!voiceControlActionsRef.current) {
              return;
            }
            voiceControlActionsRef.current.openSettings();
          }}
          onDisconnectVoice={() => {
            void disconnectVoice().catch((reason) => {
              setError(reason instanceof Error ? reason.message : "Disconnect failed");
            });
          }}
          onTakeOverVoice={() => {
            setTakeoverDialogOpen(true);
          }}
          onPickAvatar={openAvatarPicker}
          onLogout={props.onLogout}
          onParticipantContextMenu={openParticipantContextMenu}
          sharing={voiceControlState.sharing}
          shareEnabled={voiceControlState.connected && voiceTabMode === "active"}
        />

        <Paper sx={{ p: 1.1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <Box
            sx={{
              flex: 1,
              minHeight: 0,
              display: centerMode === "voice" ? "flex" : "none",
              flexDirection: "column",
            }}
          >
            {voiceSession ? (
              <EmbeddedVoiceStage
                key={voiceSession.sessionInstanceId || voiceSession.room.id}
                session={voiceSession}
                appToken={props.token}
                selfDeafened={selfDeafened}
                voiceMessages={liveVoiceMessages}
                onSendVoiceMessage={sendLiveVoiceMessage}
                onSpeakingUsersChange={setSpeakingUserIds}
                onActiveParticipantsChange={applyActiveVoiceRoster}
                onControlsChange={handleVoiceControlsChange}
                isInActiveVoiceChannel={connectedVoiceChannelId === voiceSession.room.id}
                canModerate={props.currentUser.role === "Admin"}
                memberStateByUserId={memberStateByUserId}
                participantMenuRequest={participantMenuRequest}
                onParticipantMenuHandled={(requestId) => {
                  setParticipantMenuRequest((current) =>
                    current && current.id === requestId ? null : current,
                  );
                }}
                onKick={async (channelId, userId) => {
                  try {
                    await kickFromVoice(channelId, userId);
                  } catch (reason) {
                    setError(reason instanceof Error ? reason.message : "Kick failed");
                  }
                }}
                onSetServerMuted={async (channelId, userId, muted) => {
                  try {
                    await setServerMuted(channelId, userId, muted);
                  } catch (reason) {
                    setError(reason instanceof Error ? reason.message : "Server mute update failed");
                  }
                }}
                onSetServerDeafened={async (channelId, userId, deafened) => {
                  try {
                    await setServerDeafened(channelId, userId, deafened);
                  } catch (reason) {
                    setError(reason instanceof Error ? reason.message : "Server deafen update failed");
                  }
                }}
                onSetRole={async (userId, role) => {
                  try {
                    await setUserRole(userId, role);
                  } catch (reason) {
                    setError(reason instanceof Error ? reason.message : "Role change failed");
                  }
                }}
              />
            ) : (
              <Box sx={{ flex: 1, display: "grid", placeItems: "center" }}>
                <Stack spacing={1} alignItems="center">
                  <Typography variant="h6">Voice channel selected</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Click a voice channel to connect.
                  </Typography>
                </Stack>
              </Box>
            )}
          </Box>

          <Box
            sx={{
              flex: 1,
              minHeight: 0,
              display: centerMode === "text" ? "flex" : "none",
              flexDirection: "column",
            }}
          >
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
              <Typography variant="h6" sx={{ flex: 1 }}>
                {selectedTextChannel ? `# ${selectedTextChannel.name}` : "No text channel"}
              </Typography>
            </Stack>

            <Box sx={{ flex: 1, minHeight: 0, position: "relative" }}>
              <Box
                ref={messageListRef}
                className="app-scrollbar"
                onScroll={handleMessageListScroll}
                sx={{ height: "100%", overflowY: "auto", pr: 0.4, pb: 0.8 }}
              >
                <Stack spacing={0}>
                  {messageTimeline.map((item) => {
                    if (item.kind === "separator") {
                      return (
                        <Stack
                          key={item.key}
                          direction="row"
                          spacing={1}
                          alignItems="center"
                          sx={{ py: 1.1, px: 1 }}
                        >
                          <Divider sx={{ flex: 1, borderColor: "rgba(122, 136, 156, 0.24)" }} />
                          <Typography
                            variant="caption"
                            sx={{
                              color: "text.disabled",
                              letterSpacing: 0.35,
                              textTransform: "uppercase",
                              fontSize: "0.66rem",
                            }}
                          >
                            {item.label}
                          </Typography>
                          <Divider sx={{ flex: 1, borderColor: "rgba(122, 136, 156, 0.24)" }} />
                        </Stack>
                      );
                    }

                    const message = item.message;
                    const shortTime = formatRelativeMessageTime(message.createdAtUtc, timelineNowMs);
                    const fullTime = formatFullMessageTime(message.createdAtUtc);
                    const attachmentCount = message.attachments.length;
                    const isOwnMessage = message.userId === props.currentUser.id;
                    const showUnreadDivider =
                      selectedChannelView.unreadCount > 0 &&
                      firstUnreadMessageIdInSelectedChannel === message.id;

                    return (
                      <Box key={item.key}>
                        {showUnreadDivider && (
                          <Stack
                            direction="row"
                            spacing={1}
                            alignItems="center"
                            sx={{ py: 0.9, px: 1 }}
                          >
                            <Divider sx={{ flex: 1, borderColor: "rgba(121, 164, 234, 0.36)" }} />
                            <Typography
                              variant="caption"
                              sx={{
                                color: "primary.light",
                                letterSpacing: 0.22,
                                textTransform: "uppercase",
                                fontSize: "0.65rem",
                                fontWeight: 700,
                              }}
                            >
                              New
                            </Typography>
                            <Divider sx={{ flex: 1, borderColor: "rgba(121, 164, 234, 0.36)" }} />
                          </Stack>
                        )}

                        <Box
                          className="chat-message-row"
                          sx={{
                            px: 1,
                            py: item.showHeader ? 0.75 : isOwnMessage ? 0.1 : 0.38,
                            borderRadius: 1,
                            bgcolor: "transparent",
                            transition: "background-color 120ms ease",
                            "&:hover": {
                              bgcolor: "rgba(115, 129, 151, 0.09)",
                            },
                            "&:hover .chat-inline-time": {
                              opacity: 1,
                            },
                          }}
                        >
                          <Stack direction="row" spacing={1.1} alignItems="flex-start">
                            <Box
                              sx={{
                                width: 28,
                                flexShrink: 0,
                                minHeight: 16,
                                pt: 0.1,
                                display: "grid",
                                placeItems: "start",
                              }}
                            >
                              {item.showHeader ? (
                                <Avatar
                                  src={getSafeImageUrl(message.avatarUrl)}
                                  imgProps={{
                                    onError: () => {
                                      markImageUrlBroken(message.avatarUrl);
                                    },
                                  }}
                                  sx={{ width: 26, height: 26, fontSize: "0.75rem" }}
                                >
                                  {message.username[0]?.toUpperCase() ?? "?"}
                                </Avatar>
                              ) : (
                                <Tooltip title={fullTime} placement="left">
                                  <Typography
                                    className="chat-inline-time"
                                    variant="caption"
                                    sx={{
                                      color: "text.disabled",
                                      fontSize: "0.62rem",
                                      opacity: 0,
                                      transition: "opacity 120ms ease",
                                      userSelect: "none",
                                    }}
                                  >
                                    {shortTime}
                                  </Typography>
                                </Tooltip>
                              )}
                            </Box>

                            <Box
                              className="chat-message-bubble"
                              sx={{
                                minWidth: 0,
                                flex: 1,
                                px: isOwnMessage ? 1 : 0,
                                py: item.showHeader ? 0.56 : 0.45,
                                bgcolor: isOwnMessage
                                  ? alpha("#6f9ae8", item.showHeader ? 0.11 : 0.085)
                                  : "transparent",
                                border: "none",
                                borderTopLeftRadius: isOwnMessage ? (item.groupedWithPrev ? 0.6 : 1.15) : 0,
                                borderTopRightRadius: isOwnMessage ? (item.groupedWithPrev ? 0.6 : 1.15) : 0,
                                borderBottomLeftRadius: isOwnMessage ? (item.groupedWithNext ? 0.6 : 1.15) : 0,
                                borderBottomRightRadius: isOwnMessage ? (item.groupedWithNext ? 0.6 : 1.15) : 0,
                              }}
                            >
                              {item.showHeader && (
                                <Stack direction="row" spacing={0.8} alignItems="center" sx={{ mb: 0.2 }}>
                                  <Typography
                                    variant="body2"
                                    sx={{ fontWeight: 650, color: isOwnMessage ? "#a9c7ff" : "#dce8ff" }}
                                  >
                                    {message.username}
                                  </Typography>
                                  <Tooltip title={fullTime} placement="top">
                                    <Typography
                                      variant="caption"
                                      sx={{ color: "text.disabled", fontSize: "0.67rem" }}
                                    >
                                      {shortTime}
                                    </Typography>
                                  </Tooltip>
                                </Stack>
                              )}

                              <Typography
                                variant="body2"
                                sx={{
                                  whiteSpace: "pre-wrap",
                                  wordBreak: "break-word",
                                  lineHeight: 1.44,
                                  color: "rgba(229, 236, 247, 0.95)",
                                }}
                              >
                                {renderMessageContent(message.content, message.mentions, props.currentUser.id)}
                              </Typography>

                              {attachmentCount > 0 && (
                                <Box
                                  sx={{
                                    mt: 0.72,
                                    width: "min(100%, 460px)",
                                    display: "grid",
                                    gap: 0.55,
                                    gridTemplateColumns:
                                      attachmentCount === 1
                                        ? "minmax(0, 1fr)"
                                        : "repeat(2, minmax(0, 1fr))",
                                  }}
                                >
                                  {message.attachments.map((attachment, attachmentIndex) => {
                                    const largeTile = attachmentCount === 3 && attachmentIndex === 0;
                                    const tileHeight =
                                      attachmentCount === 1
                                        ? 224
                                        : attachmentCount === 2
                                          ? 140
                                          : largeTile
                                            ? 176
                                            : 108;

                                    return (
                                      <Box
                                        key={attachment.id}
                                        component="img"
                                        src={getSafeImageUrl(attachment.urlPath)}
                                        alt={attachment.originalFileName}
                                        onClick={() => openImageLightbox(message.attachments, attachmentIndex)}
                                        onError={(event) => {
                                          markImageUrlBroken(attachment.urlPath);
                                          event.currentTarget.style.display = "none";
                                        }}
                                        sx={{
                                          width: "100%",
                                          height: tileHeight,
                                          objectFit: "cover",
                                          borderRadius: 1.15,
                                          border: "1px solid rgba(112, 128, 151, 0.34)",
                                          cursor: "zoom-in",
                                          gridColumn: largeTile ? "1 / span 2" : "auto",
                                          transition: "transform 120ms ease, border-color 120ms ease",
                                          "&:hover": {
                                            transform: "translateY(-1px)",
                                            borderColor: "rgba(151, 189, 255, 0.72)",
                                          },
                                        }}
                                      />
                                    );
                                  })}
                                </Box>
                              )}
                            </Box>
                          </Stack>
                        </Box>
                      </Box>
                    );
                  })}
                </Stack>
              </Box>

              {selectedChannelView.unreadCount > 0 && !selectedChannelView.isAtBottom && (
                <Button
                  size="small"
                  variant="contained"
                  onClick={jumpToPresent}
                  sx={{
                    position: "absolute",
                    right: 14,
                    bottom: 12,
                    zIndex: 5,
                    borderRadius: 999,
                    px: 1.3,
                    py: 0.46,
                    minHeight: 0,
                    boxShadow: "0 8px 20px rgba(0, 0, 0, 0.38)",
                  }}
                >
                  Jump to present ({selectedChannelView.unreadCount > 99 ? "99+" : selectedChannelView.unreadCount})
                </Button>
              )}
            </Box>

            <Divider sx={{ my: 1 }} />

            <Box component="form" onSubmit={sendTextMessage} autoComplete="off">
              <Stack spacing={0.8}>
                {attachments.length > 0 && (
                  <Stack
                    direction="row"
                    spacing={0.7}
                    className="app-scrollbar"
                    sx={{ overflowX: "auto", pb: 0.3, pr: 0.2 }}
                  >
                    {attachments.map((url) => (
                      <Box
                        key={url}
                        sx={{
                          position: "relative",
                          width: 86,
                          height: 58,
                          flexShrink: 0,
                          borderRadius: 1,
                          overflow: "hidden",
                          border: "1px solid rgba(116, 132, 155, 0.45)",
                          bgcolor: "rgba(30, 37, 49, 0.95)",
                        }}
                      >
                        <Box
                          component="img"
                          src={getSafeImageUrl(url)}
                          alt={url.split("/").pop() ?? "attachment"}
                          onError={(event) => {
                            markImageUrlBroken(url);
                            event.currentTarget.style.display = "none";
                          }}
                          sx={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                          }}
                        />
                        <IconButton
                          size="small"
                          onClick={() => removeComposerAttachment(url)}
                          sx={{
                            position: "absolute",
                            top: 2,
                            right: 2,
                            width: 18,
                            height: 18,
                            bgcolor: "rgba(12, 15, 21, 0.72)",
                            color: "#e9edf5",
                            "&:hover": {
                              bgcolor: "rgba(25, 31, 43, 0.9)",
                            },
                          }}
                        >
                          <CloseIcon sx={{ fontSize: 14 }} />
                        </IconButton>
                      </Box>
                    ))}
                  </Stack>
                )}

                {mentionQuery && mentionCandidates.length > 0 && (
                  <Paper variant="outlined" className="app-scrollbar" sx={{ maxHeight: 180, overflowY: "auto" }}>
                    <List dense disablePadding>
                      {mentionCandidates.map((candidate) => (
                        <ListItemButton
                          key={candidate.userId}
                          onClick={() => selectMentionCandidate(candidate)}
                        >
                          <Avatar
                            src={getSafeImageUrl(candidate.avatarUrl)}
                            imgProps={{
                              onError: () => {
                                markImageUrlBroken(candidate.avatarUrl);
                              },
                            }}
                            sx={{ width: 22, height: 22, mr: 1, fontSize: "0.75rem" }}
                          >
                            {candidate.username[0]?.toUpperCase() ?? "?"}
                          </Avatar>
                          <ListItemText
                            primary={`@${candidate.username}`}
                            secondary={candidate.userId === props.currentUser.id ? "you" : undefined}
                          />
                        </ListItemButton>
                      ))}
                    </List>
                  </Paper>
                )}

                <Stack direction="row" spacing={0.8}>
                  <TextField
                    inputRef={messageInputRef}
                    fullWidth
                    size="small"
                    placeholder="Message with @mentions and emoji"
                    value={messageDraft}
                    onChange={(event) => setMessageDraft(event.target.value)}
                    onPaste={handleComposerPaste}
                    onKeyDown={handleComposerInputKeyDown}
                    autoComplete="off"
                    name={composerAutocompleteToken}
                    inputProps={{
                      autoComplete: composerAutocompleteToken,
                    }}
                    onBlur={() => {
                      window.setTimeout(() => {
                        setMentionCandidates([]);
                      }, 120);
                    }}
                  />
                  <IconButton
                    size="small"
                    onClick={(event) => setEmojiAnchorEl(event.currentTarget)}
                  >
                    <AddReactionIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    size="small"
                    onClick={openAttachmentMenu}
                    aria-label="Attach file"
                  >
                    <AttachFileIcon fontSize="small" />
                  </IconButton>
                  <Button type="submit" size="small" variant="contained" endIcon={<SendIcon />}>
                    Send
                  </Button>
                </Stack>
              </Stack>
            </Box>
          </Box>
        </Paper>
      </Box>

      <Menu
        anchorEl={attachmentMenuAnchorEl}
        open={Boolean(attachmentMenuAnchorEl)}
        onClose={closeAttachmentMenu}
        anchorOrigin={{ vertical: "top", horizontal: "left" }}
        transformOrigin={{ vertical: "bottom", horizontal: "left" }}
      >
        <MenuItem onClick={pickPhotoFromAttachMenu}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 130 }}>
            <ImageIcon fontSize="small" />
            <Typography variant="body2">Фото</Typography>
          </Stack>
        </MenuItem>
        <MenuItem disabled>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 130 }}>
            <InsertDriveFileIcon fontSize="small" />
            <Stack spacing={0} sx={{ minWidth: 0 }}>
              <Typography variant="body2">Файл</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1 }}>
                Soon
              </Typography>
            </Stack>
          </Stack>
        </MenuItem>
      </Menu>

      <Dialog
        open={Boolean(imageLightbox)}
        onClose={closeImageLightbox}
        fullWidth
        maxWidth="lg"
        PaperProps={{
          sx: {
            bgcolor: "rgba(6, 9, 14, 0.97)",
            border: "1px solid rgba(90, 104, 126, 0.42)",
            boxShadow: "0 28px 80px rgba(0, 0, 0, 0.48)",
            backdropFilter: "blur(2px)",
          },
        }}
      >
        <DialogTitle sx={{ borderBottom: "1px solid rgba(90, 104, 126, 0.3)" }}>Image Viewer</DialogTitle>
        <DialogContent sx={{ bgcolor: "rgba(3, 6, 10, 0.86)" }}>
          {imageLightbox && (
            <Box sx={{ display: "grid", placeItems: "center", minHeight: 420 }}>
              <Box
                component="img"
                src={getSafeImageUrl(imageLightbox.attachments[imageLightbox.index]?.urlPath ?? null)}
                alt={imageLightbox.attachments[imageLightbox.index]?.originalFileName ?? "image"}
                onWheel={(event) => {
                  event.preventDefault();
                  adjustLightboxZoom(event.deltaY < 0 ? 0.16 : -0.16);
                }}
                sx={{
                  maxWidth: "100%",
                  maxHeight: "70vh",
                  objectFit: "contain",
                  transform: `scale(${imageLightbox.zoom})`,
                  transformOrigin: "center center",
                  transition: "transform 120ms ease",
                }}
              />
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ justifyContent: "space-between" }}>
          <Stack direction="row" spacing={1}>
            <Button
              onClick={() => shiftLightboxIndex(-1)}
              disabled={!imageLightbox || imageLightbox.attachments.length < 2}
            >
              Prev
            </Button>
            <Button
              onClick={() => shiftLightboxIndex(1)}
              disabled={!imageLightbox || imageLightbox.attachments.length < 2}
            >
              Next
            </Button>
          </Stack>
          <Stack direction="row" spacing={1}>
            <Button
              onClick={() => adjustLightboxZoom(-0.2)}
              disabled={!imageLightbox}
            >
              Zoom -
            </Button>
            <Button
              onClick={() => adjustLightboxZoom(0.2)}
              disabled={!imageLightbox}
            >
              Zoom +
            </Button>
            <Button onClick={closeImageLightbox}>Close</Button>
          </Stack>
        </DialogActions>
      </Dialog>

      <Popover
        open={Boolean(emojiAnchorEl)}
        anchorEl={emojiAnchorEl}
        onClose={() => setEmojiAnchorEl(null)}
        anchorOrigin={{ vertical: "top", horizontal: "center" }}
        transformOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Box sx={{ p: 1, width: 220 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.6 }}>
            Emoji
          </Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 0.4 }}>
            {EMOJI_SET.map((emoji) => (
              <Button
                key={emoji}
                size="small"
                onClick={() => {
                  setMessageDraft((current) => `${current}${emoji}`);
                }}
                sx={{ minWidth: 0, px: 0, py: 0.3, fontSize: "1rem" }}
              >
                {emoji}
              </Button>
            ))}
          </Box>
        </Box>
      </Popover>

      <Dialog open={takeoverDialogOpen} onClose={() => setTakeoverDialogOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Take over voice session?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            This tab will become the active voice tab. Voice controls in the currently active tab will stop working.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTakeoverDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => {
              setTakeoverDialogOpen(false);
              void takeOverVoiceSession().catch((reason) => {
                setError(reason instanceof Error ? reason.message : "Takeover failed");
              });
            }}
          >
            Take over
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={createChannelType !== null}
        onClose={(_event, reason) => {
          if (reason === "backdropClick") {
            return;
          }
          closeCreateChannelDialog();
        }}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>
          {createChannelType === "Voice" ? "Create Voice Channel" : "Create Text Channel"}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={1.1} sx={{ pt: "8px !important" }}>
            <TextField
              autoFocus
              label="Channel name"
              value={createChannelName}
              onChange={(event) => setCreateChannelName(event.target.value)}
              size="small"
              fullWidth
            />

            {createChannelType === "Voice" && (
              <>
                <TextField
                  label="Max participants"
                  value={createVoiceMaxParticipants}
                  onChange={(event) => setCreateVoiceMaxParticipants(event.target.value)}
                  size="small"
                  type="number"
                  inputProps={{ min: 1, max: 99 }}
                  fullWidth
                />
                <TextField
                  label="Max concurrent streams"
                  value={createVoiceMaxStreams}
                  onChange={(event) => setCreateVoiceMaxStreams(event.target.value)}
                  size="small"
                  type="number"
                  inputProps={{ min: 1, max: 16 }}
                  fullWidth
                />
              </>
            )}
            {createChannelError && <Alert severity="error">{createChannelError}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeCreateChannelDialog} disabled={createChannelSubmitting}>
            Cancel
          </Button>
          <Button variant="contained" onClick={() => void submitCreateChannel()} disabled={createChannelSubmitting}>
            {createChannelSubmitting ? "Creating..." : "Create"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(avatarCropSource)} onClose={() => setAvatarCropSource(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Crop Avatar</DialogTitle>
        <DialogContent>
          {avatarCropSource && (
            <Stack spacing={1.2}>
              <Box
                sx={{
                  width: 220,
                  height: 220,
                  borderRadius: "50%",
                  mx: "auto",
                  overflow: "hidden",
                  border: "2px solid rgba(143, 174, 211, 0.7)",
                  position: "relative",
                  bgcolor: "#0c1017",
                }}
              >
                <Box
                  component="img"
                  src={avatarCropSource}
                  alt="Avatar crop preview"
                  sx={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    transform: `translate(${avatarCropX}px, ${avatarCropY}px) scale(${avatarCropZoom})`,
                    transformOrigin: "center",
                  }}
                />
              </Box>

              <Typography variant="caption" color="text.secondary">
                Zoom
              </Typography>
              <Slider min={1} max={3} step={0.05} value={avatarCropZoom} onChange={(_, value) => setAvatarCropZoom(Array.isArray(value) ? value[0] : value)} />

              <Typography variant="caption" color="text.secondary">
                Horizontal
              </Typography>
              <Slider min={-40} max={40} step={1} value={avatarCropX} onChange={(_, value) => setAvatarCropX(Array.isArray(value) ? value[0] : value)} />

              <Typography variant="caption" color="text.secondary">
                Vertical
              </Typography>
              <Slider min={-40} max={40} step={1} value={avatarCropY} onChange={(_, value) => setAvatarCropY(Array.isArray(value) ? value[0] : value)} />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAvatarCropSource(null)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => {
              void uploadAvatarFromCrop().catch((reason) => {
                setError(reason instanceof Error ? reason.message : "Avatar upload failed");
              });
            }}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={serverSettingsOpen} onClose={() => setServerSettingsOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Server Settings</DialogTitle>
        <DialogContent>
          {props.currentUser.role !== "Admin" ? (
            <Alert severity="info">Only admins can manage server settings.</Alert>
          ) : (
            <Stack spacing={1}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                Pending approvals
              </Typography>
              {pendingApprovals.length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  No pending applications.
                </Typography>
              )}
              <List dense disablePadding>
                {pendingApprovals.map((approval) => (
                  <Paper key={approval.userId} variant="outlined" sx={{ p: 1, mb: 0.8 }}>
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>
                          {approval.username}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {new Date(approval.createdAtUtc).toLocaleString()}
                        </Typography>
                      </Box>
                      <Button
                        size="small"
                        onClick={() => {
                          void approveUser(approval.userId).catch((reason) => {
                            setError(reason instanceof Error ? reason.message : "Approve failed");
                          });
                        }}
                      >
                        Approve
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        onClick={() => {
                          void rejectUser(approval.userId).catch((reason) => {
                            setError(reason instanceof Error ? reason.message : "Reject failed");
                          });
                        }}
                      >
                        Reject
                      </Button>
                    </Stack>
                  </Paper>
                ))}
              </List>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setServerSettingsOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<UserDto | null>(null);
  const [authLoading, setAuthLoading] = useState(Boolean(token));

  const refreshMe = async () => {
    if (!token) {
      setUser(null);
      return;
    }

    const me = await apiCall<MeResponse>("/auth/me", "GET", undefined, token);
    setUser(me.user);
  };

  useEffect(() => {
    if (!token) {
      setUser(null);
      setAuthLoading(false);
      return;
    }

    setAuthLoading(true);
    void refreshMe()
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setUser(null);
      })
      .finally(() => setAuthLoading(false));
  }, [token]);

  const onLoggedIn = (response: LoginResponse) => {
    localStorage.setItem(TOKEN_KEY, response.appToken);
    setToken(response.appToken);
    setUser(response.user);
  };

  const onLogout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {authLoading ? (
        <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
          <CircularProgress />
        </Box>
      ) : !token || !user ? (
        <AuthScreen onLoggedIn={onLoggedIn} />
      ) : user.status !== "Approved" ? (
        <PendingApprovalScreen onRefresh={refreshMe} onLogout={onLogout} />
      ) : (
        <WorkspaceShell
          token={token}
          currentUser={user}
          onLogout={onLogout}
          onUserUpdated={setUser}
        />
      )}
    </ThemeProvider>
  );
}

export default App;
