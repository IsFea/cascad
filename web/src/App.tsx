import {
  Alert,
  Avatar,
  Badge,
  Box,
  Button,
  Chip,
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
  Typography,
  createTheme,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import AddReactionIcon from "@mui/icons-material/AddReaction";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import LogoutIcon from "@mui/icons-material/Logout";
import SendIcon from "@mui/icons-material/Send";
import { HubConnection, HubConnectionBuilder, HubConnectionState, LogLevel } from "@microsoft/signalr";
import { FormEvent, MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  MeResponse,
  MessageReactionDto,
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
  isVoiceEarconCooldownPassed,
  normalizeVoicePresenceChangedEvent,
  patchWorkspaceMembersVoiceState,
  resolveLocalConnectEarconType,
  resolveVoiceEarconType,
  shouldPlayLocalDisconnectEarcon,
  shouldStartConnectingEarconLoop,
  VoiceEarconType,
} from "./voicePresence";
import { getSafeImageUrl, markImageUrlBroken } from "./imageUrlFallback";

const API_BASE = import.meta.env.VITE_API_URL ?? "/api";
const TOKEN_KEY = "cascad_app_token";
const VOICE_TAB_INSTANCE_KEY = "cascad_voice_tab_instance_id";
const AVATAR_CANVAS_SIZE = 256;

const EMOJI_SET = ["😀", "😂", "😎", "🥳", "❤️", "🔥", "👍", "👏", "👀", "✅", "🎯", "🚀"];
const EARCON_ATTACK_MS = 10;
const EARCON_RELEASE_MS = 28;
const CONNECTING_EARCON_INTERVAL_MS = 1800;
const EARCON_GAIN_BOOST: Record<VoiceEarconType, number> = {
  join: 1.65,
  leave: 1.65,
  connect: 1.75,
  connecting: 1.35,
  disconnect: 1.65,
};

type EarconProfile = {
  frequencies: number[];
  noteMs: number;
  gapMs: number;
  gain: number;
  tailMs: number;
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

function isVoiceServerModeratedError(reason: unknown) {
  return reason instanceof ApiProblemError && reason.status === 403 && reason.code === "VOICE_SERVER_MODERATED";
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
  masterGain.gain.setValueAtTime(profile.gain * EARCON_GAIN_BOOST[type], baseTime);
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

const messageContentStyles = `
  .mention {
    color: #97bdff;
    font-weight: 700;
  }
`;

function MessageContent({ content }: { content: string }) {
  return (
    <>
      <style>{messageContentStyles}</style>
      <Typography
        variant="body2"
        component="div"
        dangerouslySetInnerHTML={{ __html: content }}
      />
    </>
  );
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
  const [messages, setMessages] = useState<ChannelMessageDto[]>([]);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [liveVoiceMessages, setLiveVoiceMessages] = useState<
    Array<{ userId: string; username: string; content: string; createdAtUtc: string }>
  >([]);

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
  const [participantMenuRequest, setParticipantMenuRequest] = useState<ParticipantMenuRequest | null>(null);

  // Message context menu (right-click)
  const [messageContextMenu, setMessageContextMenu] = useState<{
    messageId: string;
    channelId: string;
    messageUserId: string;
    mouseX: number;
    mouseY: number;
  } | null>(null);

  // Paste attachments from clipboard
  const [pasteAttachments, setPasteAttachments] = useState<Array<{ url: string; name: string }>>([]);

  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const hubRef = useRef<HubConnection | null>(null);
  const participantMenuSeqRef = useRef(1);
  const voiceEarconContextRef = useRef<AudioContext | null>(null);
  const lastVoiceEarconAtRef = useRef(0);
  const lastLocalDisconnectEarconAtRef = useRef(-Infinity);
  const previousConnectedVoiceChannelIdRef = useRef<string | null>(null);
  const previousVoiceEngineConnectedRef = useRef(false);
  const selectedTextChannelIdRef = useRef<string | null>(null);
  const connectedVoiceChannelIdRef = useRef<string | null>(null);
  const workspaceIdRef = useRef<string | null>(null);
  const currentUserIdRef = useRef(props.currentUser.id);
  const joinedWorkspaceIdRef = useRef<string | null>(null);
  const joinedTextChannelIdRef = useRef<string | null>(null);
  const joinedVoiceChannelIdRef = useRef<string | null>(null);
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

  useEffect(() => {
    setCurrentAvatarUrl(props.currentUser.avatarUrl);
  }, [props.currentUser.avatarUrl]);

  useEffect(() => {
    selectedTextChannelIdRef.current = selectedTextChannelId;
    connectedVoiceChannelIdRef.current = connectedVoiceChannelId;
    workspaceIdRef.current = workspaceId;
    currentUserIdRef.current = props.currentUser.id;
  }, [selectedTextChannelId, connectedVoiceChannelId, workspaceId, props.currentUser.id]);

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

  const memberStateByUserId = useMemo(() => {
    const map = new Map<string, WorkspaceMemberDto>();
    for (const member of workspaceData?.members ?? []) {
      map.set(member.userId, member);
    }
    return map;
  }, [workspaceData?.members]);

  const loadWorkspace = async () => {
    const data = await apiCall<WorkspaceBootstrapResponse>("/workspace", "GET", undefined, props.token);
    setWorkspaceData(data);

    const firstText = data.channels.find((x) => x.type === "Text")?.id ?? null;
    const firstVoice = data.channels.find((x) => x.type === "Voice")?.id ?? null;

    setSelectedTextChannelId((current) =>
      current && data.channels.some((x) => x.id === current) ? current : firstText,
    );
    setSelectedVoiceChannelId((current) =>
      current && data.channels.some((x) => x.id === current) ? current : firstVoice,
    );

    setConnectedVoiceChannelId(data.connectedVoiceChannelId);

    const me = data.members.find((x) => x.userId === props.currentUser.id);
    setSelfMuted(me?.isMuted ?? false);
    setSelfDeafened(me?.isDeafened ?? false);
    setSelfServerMuted(me?.isServerMuted ?? false);
    setSelfServerDeafened(me?.isServerDeafened ?? false);
  };

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

  const loadMessages = async (channelId: string) => {
    const response = await apiCall<ChannelMessagesResponse>(
      `/channels/${channelId}/messages?limit=50`,
      "GET",
      undefined,
      props.token,
    );
    setMessages(response.messages);
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

  const ensureVoiceSession = async (channelId: string) => {
    const connected = await apiCall<VoiceConnectResponse>(
      "/voice/connect",
      "POST",
      { channelId, tabInstanceId },
      props.token,
    );
    setConnectedVoiceChannelId(connected.channelId);
    setVoiceSession(mapVoiceToRoomSession(connected, props.currentUser, props.token));
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
      setMessages([]);
      return;
    }

    void loadMessages(selectedTextChannelId).catch((reason) => {
      setError(reason instanceof Error ? reason.message : "Failed to load messages");
    });
  }, [props.token, selectedTextChannelId]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void loadWorkspace().catch(() => undefined);
      if (props.currentUser.role === "Admin") {
        void loadApprovals().catch(() => undefined);
      }
    }, 7000);

    return () => {
      window.clearInterval(interval);
    };
  }, [props.currentUser.role, props.token]);

  useEffect(() => {
    if (!connectedVoiceChannelId) {
      setVoiceSession(null);
      return;
    }

    if (voiceSession?.room.id === connectedVoiceChannelId) {
      return;
    }

    void ensureVoiceSession(connectedVoiceChannelId).catch(() => undefined);
  }, [connectedVoiceChannelId]);

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
      .configureLogging(LogLevel.Error)
      .build();

    hubRef.current = hub;
    joinedWorkspaceIdRef.current = null;
    joinedTextChannelIdRef.current = null;
    joinedVoiceChannelIdRef.current = null;

    hub.on("textMessage", (message: ChannelMessageDto) => {
      if (message.channelId === selectedTextChannelIdRef.current) {
        setMessages((current) => [...current, message]);
      }
    });

    hub.on("messageDeleted", (data: { messageId: string; channelId: string; isDeleted: boolean }) => {
      if (data.channelId === selectedTextChannelIdRef.current) {
        setMessages((current) =>
          current.map((m) =>
            m.id === data.messageId
              ? { ...m, isDeleted: true, content: "Сообщение удалено", attachments: [] }
              : m,
          ),
        );
      }
    });

    hub.on("messageEdited", (message: ChannelMessageDto) => {
      if (message.channelId === selectedTextChannelIdRef.current) {
        setMessages((current) =>
          current.map((m) => (m.id === message.id ? message : m)),
        );
      }
    });

    hub.on(
      "reactionChanged",
      (data: { messageId: string; emoji: string; userId: string; action: "added" | "removed" }) => {
        if (data.messageId && selectedTextChannelIdRef.current) {
          setMessages((current) =>
            current.map((m) => {
              if (m.id !== data.messageId) return m;
              if (data.action === "added") {
                // Reaction will be added when the full message is re-fetched
                // For optimistic update, we add a placeholder
                const exists = m.reactions.some(
                  (r) => r.userId === data.userId && r.emoji === data.emoji,
                );
                if (exists) return m;
                return {
                  ...m,
                  reactions: [
                    ...m.reactions,
                    { userId: data.userId, username: "", emoji: data.emoji },
                  ],
                };
              } else {
                return {
                  ...m,
                  reactions: m.reactions.filter(
                    (r) => !(r.userId === data.userId && r.emoji === data.emoji),
                  ),
                };
              }
            }),
          );
        }
      },
    );

    hub.on(
      "voiceMessage",
      (message: { channelId: string; userId: string; username: string; content: string; createdAtUtc: string }) => {
        if (message.channelId === connectedVoiceChannelIdRef.current) {
          setLiveVoiceMessages((current) => [...current.slice(-80), message]);
        }
      },
    );

    hub.on("voicePresenceChanged", (rawEvent: unknown) => {
      const event = normalizeVoicePresenceChangedEvent(rawEvent);
      if (!event) {
        return;
      }

      const currentWorkspaceId = workspaceIdRef.current;
      if (!currentWorkspaceId || event.workspaceId !== currentWorkspaceId) {
        return;
      }

      setWorkspaceData((current) => {
        if (!current || current.workspace.id !== event.workspaceId) {
          return current;
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
        event.userId === currentUserIdRef.current &&
        connectedVoiceChannelIdRef.current &&
        event.previousVoiceChannelId === connectedVoiceChannelIdRef.current &&
        event.currentVoiceChannelId === null
      ) {
        clearVoiceClientState();
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
    });

    void hub
      .start()
      .then(async () => {
        await syncHubGroups(hub);
      })
      .catch(() => undefined);

    hub.onreconnected(() => {
      void syncHubGroups(hub);
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
  }, [props.token, syncHubGroups]);

  useEffect(() => {
    const hub = hubRef.current;
    if (!hub || hub.state !== HubConnectionState.Connected) {
      return;
    }

    void syncHubGroups(hub);
  }, [connectedVoiceChannelId, selectedTextChannelId, syncHubGroups, workspaceId]);

  useEffect(() => {
    if (!connectedVoiceChannelId || !voiceSession?.sessionInstanceId) {
      return;
    }

    let disposed = false;

    const sendHeartbeat = async () => {
      try {
        await apiCall<void>(
          "/voice/heartbeat",
          "POST",
          {
            channelId: connectedVoiceChannelId,
            sessionInstanceId: voiceSession.sessionInstanceId,
          },
          props.token,
        );
      } catch (reason) {
        if (disposed) {
          return;
        }

        if (isVoiceSessionReplacedError(reason)) {
          handleVoiceSessionReplaced();
          return;
        }

        if (reason instanceof ApiProblemError && reason.status === 404) {
          clearVoiceClientState();
        }
      }
    };

    void sendHeartbeat();
    const interval = window.setInterval(() => {
      void sendHeartbeat();
    }, 10000);

    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [connectedVoiceChannelId, props.token, voiceSession?.sessionInstanceId]);

  useEffect(() => {
    if (!connectedVoiceChannelId || !voiceSession?.sessionInstanceId) {
      return;
    }

    const releaseOnPageHide = () => {
      void fetch(`${API_BASE}/voice/disconnect`, {
        method: "POST",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${props.token}`,
        },
        body: JSON.stringify({
          channelId: connectedVoiceChannelId,
          sessionInstanceId: voiceSession.sessionInstanceId,
        }),
      }).catch(() => undefined);
    };

    window.addEventListener("pagehide", releaseOnPageHide);
    window.addEventListener("beforeunload", releaseOnPageHide);
    return () => {
      window.removeEventListener("pagehide", releaseOnPageHide);
      window.removeEventListener("beforeunload", releaseOnPageHide);
    };
  }, [connectedVoiceChannelId, props.token, voiceSession?.sessionInstanceId]);

  const sendTextMessage = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedTextChannelId || (!messageDraft.trim() && attachments.length === 0 && pasteAttachments.length === 0)) {
      return;
    }

    // Upload pasted images first
    const uploadedUrls: string[] = [];
    for (const pa of pasteAttachments) {
      try {
        const response = await fetch(pa.url);
        const blob = await response.blob();
        const file = new File([blob], pa.name, { type: blob.type });
        const formData = new FormData();
        formData.append("file", file);
        const uploaded = await apiCall<UploadImageResponse>(
          "/uploads/chat-image",
          "POST",
          formData,
          props.token,
        );
        uploadedUrls.push(uploaded.url);
      } catch {
        // Skip failed uploads
      }
    }

    const allAttachments = [...attachments, ...uploadedUrls].slice(-4);

    await apiCall<ChannelMessageDto>(
      `/channels/${selectedTextChannelId}/messages`,
      "POST",
      {
        content: messageDraft,
        attachmentUrls: allAttachments,
      },
      props.token,
    );

    // Message will be added via SignalR "textMessage" broadcast
    setMessageDraft("");
    setAttachments([]);
    setPasteAttachments([]);
  };

  const deleteMessage = async (channelId: string, messageId: string) => {
    try {
      await apiCall<void>(
        `/channels/${channelId}/messages/${messageId}`,
        "DELETE",
        undefined,
        props.token,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Failed to delete message");
    }
  };

  const toggleReaction = async (channelId: string, messageId: string, emoji: string) => {
    const currentMessage = messages.find((m) => m.id === messageId);
    if (!currentMessage) return;

    const hasReaction = currentMessage.reactions.some(
      (r) => r.userId === props.currentUser.id && r.emoji === emoji,
    );

    try {
      if (hasReaction) {
        await apiCall<void>(
          `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`,
          "DELETE",
          undefined,
          props.token,
        );
      } else {
        await apiCall<ChannelMessageDto>(
          `/channels/${channelId}/messages/${messageId}/reactions`,
          "POST",
          { emoji },
          props.token,
        );
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Failed to toggle reaction");
    }
  };

  const handlePasteFromClipboard = (event: React.ClipboardEvent) => {
    const items = event.clipboardData?.items;
    if (!items) return;

    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        const file = items[i].getAsFile();
        if (file) {
          imageFiles.push(file);
        }
      }
    }

    if (imageFiles.length === 0) return;

    event.preventDefault();

    const newAttachments: Array<{ url: string; name: string }> = [];
    for (const file of imageFiles) {
      const url = URL.createObjectURL(file);
      newAttachments.push({ url, name: file.name || "pasted-image.png" });
    }

    setPasteAttachments((current) => [...current, ...newAttachments].slice(-4));
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
    setAttachments((current) => [...current, uploaded.url].slice(-4));
  };

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

  const clearVoiceClientState = (notice?: string) => {
    setConnectedVoiceChannelId(null);
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
    clearVoiceClientState("Voice session moved to another tab.");
    void loadWorkspace().catch(() => undefined);
  };

  const connectVoice = async (channelId: string) => {
    const connected = await apiCall<VoiceConnectResponse>(
      "/voice/connect",
      "POST",
      { channelId, tabInstanceId },
      props.token,
    );

    setConnectedVoiceChannelId(connected.channelId);
    setSelectedVoiceChannelId(connected.channelId);
    setCenterMode("voice");
    setVoiceSession(mapVoiceToRoomSession(connected, props.currentUser, props.token));
    await loadWorkspace();
  };

  const disconnectVoice = async () => {
    if (!connectedVoiceChannelId) {
      return;
    }

    const sessionInstanceId = voiceSession?.sessionInstanceId ?? "";
    await apiCall<void>(
      "/voice/disconnect",
      "POST",
      { channelId: connectedVoiceChannelId, sessionInstanceId },
      props.token,
    );

    clearVoiceClientState();
    await loadWorkspace();
  };

  const applySelfState = async (nextMuted: boolean, nextDeafened: boolean) => {
    if (!connectedVoiceChannelId) {
      return;
    }

    try {
      await apiCall<void>(
        "/voice/self-state",
        "POST",
        {
          channelId: connectedVoiceChannelId,
          sessionInstanceId: voiceSession?.sessionInstanceId ?? "",
          isMuted: nextMuted,
          isDeafened: nextDeafened,
        },
        props.token,
      );
    } catch (reason) {
      if (isVoiceSessionReplacedError(reason)) {
        handleVoiceSessionReplaced();
        return;
      }
      if (isVoiceServerModeratedError(reason)) {
        setInfoMessage("Voice state is controlled by server moderation.");
        await loadWorkspace();
        return;
      }
      throw reason;
    }

    setSelfMuted(nextMuted);
    setSelfDeafened(nextDeafened);
    await loadWorkspace();
  };

  const toggleSelfMute = async () => {
    const nextMuted = !selfMuted;
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
    await loadWorkspace();
  };

  const setServerDeafened = async (channelId: string, targetUserId: string, deafened: boolean) => {
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

    void voiceControlActionsRef.current.setMuted(selfMuted).catch(() => undefined);
  }, [selfMuted, voiceSession?.sessionInstanceId]);

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
    <Box
      sx={{ height: "100vh", overflow: "hidden", p: 1.2, position: "relative" }}
      onClick={() => setMessageContextMenu(null)}
    >
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
          currentUser={props.currentUser}
          currentAvatarUrl={currentAvatarUrl}
          textChannels={textChannels}
          voiceChannels={voiceChannels}
          members={workspaceData.members}
          speakingUserIds={speakingUserIds}
          selectedTextChannelId={selectedTextChannelId}
          selectedVoiceChannelId={selectedVoiceChannelId}
          connectedVoiceChannelId={connectedVoiceChannelId}
          selfMuted={selfMuted}
          selfDeafened={selfDeafened}
          canManageChannels={props.currentUser.role === "Admin"}
          pendingApprovalsCount={pendingApprovals.length}
          onSelectVoiceChannel={(channelId) => {
            setSelectedVoiceChannelId(channelId);
          }}
          onConnectVoiceChannel={(channelId) => {
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
          onPickAvatar={openAvatarPicker}
          onLogout={props.onLogout}
          onParticipantContextMenu={openParticipantContextMenu}
          sharing={voiceControlState.sharing}
          shareEnabled={voiceControlState.connected}
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
                session={voiceSession}
                appToken={props.token}
                selfDeafened={selfDeafened}
                voiceMessages={liveVoiceMessages}
                onSendVoiceMessage={sendLiveVoiceMessage}
                onSpeakingUsersChange={setSpeakingUserIds}
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

            <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", pr: 0.4 }}>
              <Stack spacing={1}>
                {messages.map((message) => (
                  <Paper
                    key={message.id}
                    variant="outlined"
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setMessageContextMenu({
                        messageId: message.id,
                        channelId: message.channelId,
                        messageUserId: message.userId,
                        mouseX: event.clientX + 2,
                        mouseY: event.clientY - 6,
                      });
                    }}
                    sx={{
                      p: 1,
                      bgcolor:
                        message.userId === props.currentUser.id
                          ? alpha("#6ea4ff", 0.11)
                          : "transparent",
                      opacity: message.isDeleted ? 0.6 : 1,
                    }}
                  >
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                      <Avatar
                        src={getSafeImageUrl(message.avatarUrl)}
                        imgProps={{
                          onError: () => {
                            markImageUrlBroken(message.avatarUrl);
                          },
                        }}
                        sx={{ width: 24, height: 24, fontSize: "0.75rem" }}
                      >
                        {message.username[0]?.toUpperCase() ?? "?"}
                      </Avatar>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        {message.username}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {new Date(message.createdAtUtc).toLocaleTimeString()}
                      </Typography>
                      {message.isEdited && !message.isDeleted && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ fontStyle: "italic" }}
                        >
                          (изменено)
                        </Typography>
                      )}
                    </Stack>
                    {message.isDeleted ? (
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ fontStyle: "italic" }}
                      >
                        {message.content}
                      </Typography>
                    ) : (
                      <MessageContent content={message.content} />
                    )}
                    {!message.isDeleted && message.attachments.length > 0 && (
                      <Stack direction="row" spacing={0.8} sx={{ mt: 0.8 }} flexWrap="wrap" useFlexGap>
                        {message.attachments
                          .filter((a) => a.urlPath)
                          .map((attachment) => (
                            <Box
                              key={attachment.id}
                              component="img"
                              src={getSafeImageUrl(attachment.urlPath)}
                              alt={attachment.originalFileName}
                              onError={(event) => {
                                markImageUrlBroken(attachment.urlPath);
                                event.currentTarget.style.display = "none";
                              }}
                              sx={{
                                width: 160,
                                height: 100,
                                objectFit: "cover",
                                borderRadius: 1,
                                border: "1px solid rgba(117, 142, 171, 0.35)",
                              }}
                            />
                          ))}
                      </Stack>
                    )}
                    {!message.isDeleted && message.reactions.length > 0 && (
                      <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }} flexWrap="wrap" useFlexGap>
                        {message.reactions.map((reaction, idx) => {
                          const isOwn = reaction.userId === props.currentUser.id;
                          return (
                            <Chip
                              key={`${reaction.emoji}-${reaction.userId}-${idx}`}
                              label={`${reaction.emoji}${reaction.username ? ` ${reaction.username}` : ""}`}
                              size="small"
                              onClick={() =>
                                toggleReaction(message.channelId, message.id, reaction.emoji)
                              }
                              sx={{
                                cursor: "pointer",
                                bgcolor: isOwn ? alpha("#6ea4ff", 0.25) : undefined,
                                border: isOwn ? "1px solid #6ea4ff" : undefined,
                              }}
                            />
                          );
                        })}
                      </Stack>
                    )}
                  </Paper>
                ))}
              </Stack>
            </Box>

            <Divider sx={{ my: 1 }} />

            <Box
              component="form"
              onSubmit={sendTextMessage}
              onPaste={handlePasteFromClipboard}
            >
              <Stack spacing={0.8}>
                {attachments.length > 0 && (
                  <Stack direction="row" spacing={0.6} flexWrap="wrap" useFlexGap>
                    {attachments.map((url) => (
                      <Chip key={url} size="small" label={url.split("/").pop() ?? "image"} />
                    ))}
                  </Stack>
                )}
                {pasteAttachments.length > 0 && (
                  <Stack direction="row" spacing={0.6} flexWrap="wrap" useFlexGap>
                    {pasteAttachments.map((pa, idx) => (
                      <Box
                        key={`${pa.url}-${idx}`}
                        component="img"
                        src={pa.url}
                        alt={pa.name}
                        sx={{
                          width: 60,
                          height: 60,
                          objectFit: "cover",
                          borderRadius: 1,
                          border: "1px solid rgba(117, 142, 171, 0.35)",
                        }}
                      />
                    ))}
                  </Stack>
                )}

                <Stack direction="row" spacing={0.8}>
                  <TextField
                    fullWidth
                    size="small"
                    placeholder="Message with @mentions and emoji (Ctrl+V to paste images)"
                    value={messageDraft}
                    onChange={(event) => setMessageDraft(event.target.value)}
                    onPaste={handlePasteFromClipboard}
                  />
                  <IconButton
                    size="small"
                    onClick={(event) => setEmojiAnchorEl(event.currentTarget)}
                  >
                    <AddReactionIcon fontSize="small" />
                  </IconButton>
                  <Button component="label" size="small" variant="outlined">
                    Img
                    <input
                      hidden
                      type="file"
                      accept="image/*"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (!file) {
                          return;
                        }
                        void uploadChatImage(file).catch((reason) => {
                          setError(reason instanceof Error ? reason.message : "Upload failed");
                        });
                        event.target.value = "";
                      }}
                    />
                  </Button>
                  <Button type="submit" size="small" variant="contained" endIcon={<SendIcon />}>
                    Send
                  </Button>
                </Stack>
              </Stack>
            </Box>
          </Box>
        </Paper>
      </Box>

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

      <Menu
        open={Boolean(messageContextMenu)}
        anchorReference="anchorPosition"
        anchorPosition={
          messageContextMenu
            ? { left: messageContextMenu.mouseX, top: messageContextMenu.mouseY }
            : undefined
        }
        onClose={() => setMessageContextMenu(null)}
      >
        {(messageContextMenu &&
          (messageContextMenu.messageUserId === props.currentUser.id || isCurrentUserAdmin)) && (
          <MenuItem
            onClick={() => {
              if (messageContextMenu) {
                void deleteMessage(messageContextMenu.channelId, messageContextMenu.messageId);
              }
              setMessageContextMenu(null);
            }}
          >
            <DeleteIcon sx={{ mr: 1 }} fontSize="small" />
            Удалить
          </MenuItem>
        )}
      </Menu>

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
