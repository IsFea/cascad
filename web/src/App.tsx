import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  CssBaseline,
  Divider,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  ThemeProvider,
  Typography,
  createTheme,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import AddIcon from "@mui/icons-material/Add";
import ChatIcon from "@mui/icons-material/Chat";
import HeadsetOffIcon from "@mui/icons-material/HeadsetOff";
import LogoutIcon from "@mui/icons-material/Logout";
import MicOffIcon from "@mui/icons-material/MicOff";
import MicIcon from "@mui/icons-material/Mic";
import ScreenShareIcon from "@mui/icons-material/ScreenShare";
import SendIcon from "@mui/icons-material/Send";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import { HubConnectionBuilder, LogLevel } from "@microsoft/signalr";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { RoomShell } from "./room/components/RoomShell";
import {
  ApprovalsResponse,
  ChannelDto,
  ChannelMessageDto,
  ChannelMessagesResponse,
  ChannelType,
  JoinRoomResponse,
  LoginResponse,
  MeResponse,
  PendingApprovalDto,
  ProfileResponse,
  RegisterResponse,
  StreamPermitResponse,
  UploadImageResponse,
  UserDto,
  VoiceConnectResponse,
  WorkspaceBootstrapResponse,
} from "./types";

const API_BASE = import.meta.env.VITE_API_URL ?? "/api";
const TOKEN_KEY = "cascad_app_token";

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
    const message = await response.text();
    throw new Error(message || `HTTP ${response.status}`);
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
  };
}

function renderMentions(content: string) {
  const parts = content.split(/(@[\p{L}\p{N}._-]{2,32})/gu);
  return parts.map((part, index) => {
    if (part.startsWith("@")) {
      return (
        <Box
          key={`${part}-${index}`}
          component="span"
          sx={{
            color: "primary.light",
            fontWeight: 700,
          }}
        >
          {part}
        </Box>
      );
    }

    return <span key={`${part}-${index}`}>{part}</span>;
  });
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
  onOpenVoiceStage: (session: JoinRoomResponse, channelId: string) => void;
}) {
  const [workspaceData, setWorkspaceData] = useState<WorkspaceBootstrapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedTextChannelId, setSelectedTextChannelId] = useState<string | null>(null);
  const [selectedVoiceChannelId, setSelectedVoiceChannelId] = useState<string | null>(null);
  const [connectedVoiceChannelId, setConnectedVoiceChannelId] = useState<string | null>(null);

  const [messageDraft, setMessageDraft] = useState("");
  const [messages, setMessages] = useState<ChannelMessageDto[]>([]);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [liveVoiceDraft, setLiveVoiceDraft] = useState("");
  const [liveVoiceMessages, setLiveVoiceMessages] = useState<
    Array<{ userId: string; username: string; content: string; createdAtUtc: string }>
  >([]);
  const [selfMuted, setSelfMuted] = useState(false);
  const [selfDeafened, setSelfDeafened] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApprovalDto[]>([]);
  const [currentAvatarUrl, setCurrentAvatarUrl] = useState<string | null>(
    props.currentUser.avatarUrl,
  );
  const hubRef = useRef<ReturnType<HubConnectionBuilder["build"]> | null>(null);

  useEffect(() => {
    setCurrentAvatarUrl(props.currentUser.avatarUrl);
  }, [props.currentUser.avatarUrl]);

  const textChannels = useMemo(
    () => workspaceData?.channels.filter((x) => x.type === "Text") ?? [],
    [workspaceData?.channels],
  );
  const voiceChannels = useMemo(
    () => workspaceData?.channels.filter((x) => x.type === "Voice") ?? [],
    [workspaceData?.channels],
  );

  const selectedVoiceChannel: ChannelDto | null = useMemo(() => {
    if (!selectedVoiceChannelId) {
      return null;
    }
    return voiceChannels.find((x) => x.id === selectedVoiceChannelId) ?? null;
  }, [selectedVoiceChannelId, voiceChannels]);

  const selectedTextChannel: ChannelDto | null = useMemo(() => {
    if (!selectedTextChannelId) {
      return null;
    }
    return textChannels.find((x) => x.id === selectedTextChannelId) ?? null;
  }, [selectedTextChannelId, textChannels]);

  const voiceMembers = useMemo(() => {
    if (!selectedVoiceChannelId || !workspaceData) {
      return [];
    }
    return workspaceData.members.filter(
      (member) => member.connectedVoiceChannelId === selectedVoiceChannelId,
    );
  }, [selectedVoiceChannelId, workspaceData]);

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
    const hub = new HubConnectionBuilder()
      .withUrl(`${API_BASE.replace(/\/api$/, "")}/hubs/chat`, {
        accessTokenFactory: () => props.token,
      })
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Warning)
      .build();

    hubRef.current = hub;

    hub.on("textMessage", (message: ChannelMessageDto) => {
      if (message.channelId === selectedTextChannelId) {
        setMessages((current) => [...current, message]);
      }
    });

    hub.on(
      "voiceMessage",
      (message: { channelId: string; userId: string; username: string; content: string; createdAtUtc: string }) => {
        if (message.channelId === selectedVoiceChannelId) {
          setLiveVoiceMessages((current) => [...current.slice(-80), message]);
        }
      },
    );

    void hub
      .start()
      .then(async () => {
        if (selectedTextChannelId) {
          await hub.invoke("JoinTextChannel", selectedTextChannelId);
        }
        if (selectedVoiceChannelId) {
          await hub.invoke("JoinVoiceChannel", selectedVoiceChannelId);
        }
      })
      .catch(() => undefined);

    return () => {
      void hub.stop();
    };
  }, [props.token, selectedTextChannelId, selectedVoiceChannelId]);

  const sendTextMessage = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedTextChannelId || (!messageDraft.trim() && attachments.length === 0)) {
      return;
    }

    const created = await apiCall<ChannelMessageDto>(
      `/channels/${selectedTextChannelId}/messages`,
      "POST",
      {
        content: messageDraft,
        attachmentUrls: attachments,
      },
      props.token,
    );
    setMessages((current) => [...current, created]);
    setMessageDraft("");
    setAttachments([]);
  };

  const uploadChatImage = async (file: File) => {
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

  const uploadAvatar = async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    const profile = await apiCall<ProfileResponse>("/profile/avatar", "POST", formData, props.token);
    setCurrentAvatarUrl(profile.user.avatarUrl);
    await loadWorkspace();
  };

  const connectVoice = async () => {
    if (!selectedVoiceChannelId) {
      return;
    }

    const connected = await apiCall<VoiceConnectResponse>(
      "/voice/connect",
      "POST",
      { channelId: selectedVoiceChannelId },
      props.token,
    );
    setConnectedVoiceChannelId(connected.channelId);
    await loadWorkspace();
    props.onOpenVoiceStage(
      mapVoiceToRoomSession(connected, props.currentUser, props.token),
      connected.channelId,
    );
  };

  const disconnectVoice = async () => {
    if (!connectedVoiceChannelId) {
      return;
    }

    await apiCall<void>(
      "/voice/disconnect",
      "POST",
      { channelId: connectedVoiceChannelId },
      props.token,
    );
    setConnectedVoiceChannelId(null);
    setSelfMuted(false);
    setSelfDeafened(false);
    await loadWorkspace();
  };

  const applySelfState = async (nextMuted: boolean, nextDeafened: boolean) => {
    if (!connectedVoiceChannelId) {
      return;
    }

    await apiCall<void>(
      "/voice/self-state",
      "POST",
      {
        channelId: connectedVoiceChannelId,
        isMuted: nextMuted,
        isDeafened: nextDeafened,
      },
      props.token,
    );
    setSelfMuted(nextMuted);
    setSelfDeafened(nextDeafened);
    await loadWorkspace();
  };

  const sendLiveVoiceMessage = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedVoiceChannelId || !liveVoiceDraft.trim()) {
      return;
    }
    const hub = hubRef.current;
    if (!hub) {
      return;
    }
    await hub.invoke("SendVoiceMessage", selectedVoiceChannelId, liveVoiceDraft.trim());
    setLiveVoiceDraft("");
  };

  const approveUser = async (userId: string) => {
    await apiCall<void>(`/admin/approvals/${userId}/approve`, "POST", undefined, props.token);
    await loadApprovals();
  };

  const rejectUser = async (userId: string) => {
    await apiCall<void>(`/admin/approvals/${userId}/reject`, "POST", undefined, props.token);
    await loadApprovals();
  };

  const createChannel = async (type: ChannelType) => {
    const name = window.prompt(type === "Text" ? "Text channel name" : "Voice channel name");
    if (!name?.trim()) {
      return;
    }

    await apiCall<ChannelDto>(
      "/workspace/channels",
      "POST",
      {
        name: name.trim(),
        type,
        maxParticipants: type === "Voice" ? 12 : undefined,
        maxConcurrentStreams: type === "Voice" ? 4 : undefined,
      },
      props.token,
    );
    await loadWorkspace();
  };

  const checkStreamPermit = async () => {
    if (!connectedVoiceChannelId) {
      return;
    }
    const permit = await apiCall<StreamPermitResponse>(
      "/voice/streams/permit",
      "POST",
      { channelId: connectedVoiceChannelId },
      props.token,
    );
    if (!permit.allowed) {
      setError(permit.reason ?? "Stream limit reached.");
    } else {
      setError(null);
    }
  };

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
    <Box sx={{ height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box
        sx={{
          px: 2,
          py: 1,
          borderBottom: "1px solid rgba(83, 98, 116, 0.4)",
          background: "rgba(20, 24, 31, 0.86)",
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography variant="h6" sx={{ flex: 1 }}>
            {workspaceData.workspace.name}
          </Typography>
          <Chip size="small" label={props.currentUser.role} variant="outlined" />
          <Avatar src={currentAvatarUrl ?? undefined} sx={{ width: 30, height: 30 }}>
            {props.currentUser.username[0]?.toUpperCase() ?? "?"}
          </Avatar>
          <Button component="label" size="small" variant="outlined">
            Avatar
            <input
              hidden
              type="file"
              accept="image/*"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) {
                  return;
                }
                void uploadAvatar(file).catch((reason) => {
                  setError(reason instanceof Error ? reason.message : "Avatar upload failed");
                });
                event.target.value = "";
              }}
            />
          </Button>
          <Button
            size="small"
            startIcon={<LogoutIcon />}
            variant="outlined"
            onClick={props.onLogout}
          >
            Logout
          </Button>
        </Stack>
      </Box>

      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "260px minmax(0,1fr) 300px" },
          gap: 1.2,
          p: 1.2,
        }}
      >
        <Paper sx={{ p: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <Typography variant="subtitle2" sx={{ px: 0.7, mb: 0.6 }}>
            Text channels
          </Typography>
          <List dense sx={{ p: 0, mb: 1 }}>
            {textChannels.map((channel) => (
              <ListItemButton
                key={channel.id}
                selected={selectedTextChannelId === channel.id}
                onClick={() => setSelectedTextChannelId(channel.id)}
                sx={{ borderRadius: 1 }}
              >
                <ListItemText primary={`# ${channel.name}`} />
              </ListItemButton>
            ))}
          </List>

          <Typography variant="subtitle2" sx={{ px: 0.7, mb: 0.6 }}>
            Voice channels
          </Typography>
          <List dense sx={{ p: 0 }}>
            {voiceChannels.map((channel) => (
              <ListItemButton
                key={channel.id}
                selected={selectedVoiceChannelId === channel.id}
                onClick={() => setSelectedVoiceChannelId(channel.id)}
                sx={{ borderRadius: 1 }}
              >
                <ListItemText primary={`🔊 ${channel.name}`} />
              </ListItemButton>
            ))}
          </List>

          {props.currentUser.role === "Admin" && (
            <Stack direction="row" spacing={0.7} sx={{ mt: "auto", pt: 1 }}>
              <Button
                size="small"
                variant="outlined"
                startIcon={<AddIcon />}
                onClick={() => createChannel("Text")}
              >
                Text
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<AddIcon />}
                onClick={() => createChannel("Voice")}
              >
                Voice
              </Button>
            </Stack>
          )}
        </Paper>

        <Paper sx={{ p: 1.2, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
            <ChatIcon fontSize="small" />
            <Typography variant="subtitle1" sx={{ flex: 1 }}>
              {selectedTextChannel ? `# ${selectedTextChannel.name}` : "No text channel"}
            </Typography>
            <Button
              size="small"
              variant="outlined"
              startIcon={<ScreenShareIcon />}
              disabled={!connectedVoiceChannelId}
              onClick={() => {
                if (!connectedVoiceChannelId) {
                  return;
                }
                const connected = voiceChannels.find((x) => x.id === connectedVoiceChannelId);
                if (!connected) {
                  return;
                }

                void apiCall<VoiceConnectResponse>(
                  "/voice/connect",
                  "POST",
                  { channelId: connectedVoiceChannelId },
                  props.token,
                ).then((session) => {
                  props.onOpenVoiceStage(
                    mapVoiceToRoomSession(session, props.currentUser, props.token),
                    connected.id,
                  );
                });
              }}
            >
              Open Stage
            </Button>
          </Stack>

          <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", pr: 0.5 }}>
            <Stack spacing={1}>
              {messages.map((message) => (
                <Paper
                  key={message.id}
                  variant="outlined"
                  sx={{
                    p: 1,
                    bgcolor:
                      message.userId === props.currentUser.id
                        ? alpha("#6ea4ff", 0.11)
                        : "transparent",
                  }}
                >
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                    <Avatar
                      src={message.avatarUrl ?? undefined}
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
                  </Stack>
                  <Typography variant="body2">{renderMentions(message.content)}</Typography>
                  {message.attachments.length > 0 && (
                    <Stack direction="row" spacing={0.8} sx={{ mt: 0.8 }} flexWrap="wrap" useFlexGap>
                      {message.attachments.map((attachment) => (
                        <Box
                          key={attachment.id}
                          component="img"
                          src={attachment.urlPath}
                          alt={attachment.originalFileName}
                          sx={{
                            width: 120,
                            height: 80,
                            objectFit: "cover",
                            borderRadius: 1,
                            border: "1px solid rgba(117, 142, 171, 0.35)",
                          }}
                        />
                      ))}
                    </Stack>
                  )}
                </Paper>
              ))}
            </Stack>
          </Box>

          <Divider sx={{ my: 1 }} />

          <Box component="form" onSubmit={sendTextMessage}>
            <Stack spacing={0.8}>
              {attachments.length > 0 && (
                <Stack direction="row" spacing={0.6} flexWrap="wrap" useFlexGap>
                  {attachments.map((url) => (
                    <Chip key={url} size="small" label={url.split("/").pop() ?? "image"} />
                  ))}
                </Stack>
              )}
              <Stack direction="row" spacing={0.8}>
                <TextField
                  fullWidth
                  size="small"
                  placeholder="Message with @mentions and emoji"
                  value={messageDraft}
                  onChange={(event) => setMessageDraft(event.target.value)}
                />
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
        </Paper>

        <Paper sx={{ p: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <Typography variant="subtitle2" sx={{ mb: 0.8 }}>
            Voice
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {selectedVoiceChannel ? selectedVoiceChannel.name : "Select voice channel"}
          </Typography>

          <Stack direction="row" spacing={0.7} sx={{ mb: 1.2 }}>
            <Button
              size="small"
              variant="contained"
              startIcon={<VolumeUpIcon />}
              disabled={!selectedVoiceChannel || connectedVoiceChannelId === selectedVoiceChannel.id}
              onClick={() => void connectVoice().catch((reason) => setError(String(reason)))}
            >
              Connect
            </Button>
            <Button
              size="small"
              variant="outlined"
              color="error"
              disabled={!connectedVoiceChannelId}
              onClick={() => void disconnectVoice().catch((reason) => setError(String(reason)))}
            >
              Disconnect
            </Button>
          </Stack>

          <Stack direction="row" spacing={0.7} sx={{ mb: 1.2 }}>
            <Button
              size="small"
              variant={selfMuted ? "contained" : "outlined"}
              color={selfMuted ? "error" : "inherit"}
              startIcon={selfMuted ? <MicOffIcon /> : <MicIcon />}
              disabled={!connectedVoiceChannelId}
              onClick={() =>
                void applySelfState(!selfMuted, selfDeafened).catch((reason) =>
                  setError(String(reason)),
                )
              }
            >
              {selfMuted ? "Unmute" : "Mute"}
            </Button>
            <Button
              size="small"
              variant={selfDeafened ? "contained" : "outlined"}
              color={selfDeafened ? "error" : "inherit"}
              startIcon={<HeadsetOffIcon />}
              disabled={!connectedVoiceChannelId}
              onClick={() =>
                void applySelfState(true, !selfDeafened).catch((reason) =>
                  setError(String(reason)),
                )
              }
            >
              {selfDeafened ? "Undeafen" : "Deafen"}
            </Button>
          </Stack>

          <Button
            size="small"
            variant="outlined"
            disabled={!connectedVoiceChannelId}
            onClick={() => void checkStreamPermit().catch((reason) => setError(String(reason)))}
            sx={{ mb: 1.2 }}
          >
            Check stream permit
          </Button>

          <Typography variant="caption" color="text.secondary">
            Participants in selected voice channel
          </Typography>
          <Box sx={{ maxHeight: 150, overflowY: "auto", mt: 0.5, mb: 1 }}>
            <Stack spacing={0.6}>
              {voiceMembers.map((member) => (
                <Stack key={member.userId} direction="row" spacing={0.7} alignItems="center">
                  <Avatar src={member.avatarUrl ?? undefined} sx={{ width: 22, height: 22 }}>
                    {member.username[0]?.toUpperCase()}
                  </Avatar>
                  <Typography variant="body2" sx={{ flex: 1 }}>
                    {member.username}
                  </Typography>
                  {member.isMuted && <MicOffIcon sx={{ fontSize: 14, color: "error.main" }} />}
                  {member.isDeafened && (
                    <HeadsetOffIcon sx={{ fontSize: 14, color: "error.main" }} />
                  )}
                </Stack>
              ))}
            </Stack>
          </Box>

          <Divider sx={{ my: 1 }} />
          <Typography variant="caption" color="text.secondary" sx={{ mb: 0.4 }}>
            Live voice-channel chat (ephemeral)
          </Typography>
          <Box sx={{ flex: 1, minHeight: 90, maxHeight: 160, overflowY: "auto", mb: 0.7 }}>
            <Stack spacing={0.5}>
              {liveVoiceMessages.map((message, index) => (
                <Typography key={`${message.createdAtUtc}-${index}`} variant="caption">
                  <Box component="span" sx={{ color: "primary.light", fontWeight: 700 }}>
                    {message.username}:{" "}
                  </Box>
                  {message.content}
                </Typography>
              ))}
            </Stack>
          </Box>

          <Box component="form" onSubmit={sendLiveVoiceMessage}>
            <Stack direction="row" spacing={0.6}>
              <TextField
                fullWidth
                size="small"
                placeholder="Voice chat message"
                value={liveVoiceDraft}
                onChange={(event) => setLiveVoiceDraft(event.target.value)}
                disabled={!connectedVoiceChannelId}
              />
              <IconButton type="submit" color="primary" disabled={!connectedVoiceChannelId}>
                <SendIcon />
              </IconButton>
            </Stack>
          </Box>

          {props.currentUser.role === "Admin" && (
            <>
              <Divider sx={{ my: 1 }} />
              <Typography variant="caption" color="text.secondary">
                Pending approvals
              </Typography>
              <Stack spacing={0.7} sx={{ mt: 0.6, maxHeight: 140, overflowY: "auto" }}>
                {pendingApprovals.map((approval) => (
                  <Paper key={approval.userId} variant="outlined" sx={{ p: 0.7 }}>
                    <Typography variant="caption" sx={{ display: "block", mb: 0.4 }}>
                      {approval.username}
                    </Typography>
                    <Stack direction="row" spacing={0.6}>
                      <Button
                        size="small"
                        onClick={() =>
                          void approveUser(approval.userId).catch((reason) =>
                            setError(String(reason)),
                          )
                        }
                      >
                        Approve
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        onClick={() =>
                          void rejectUser(approval.userId).catch((reason) =>
                            setError(String(reason)),
                          )
                        }
                      >
                        Reject
                      </Button>
                    </Stack>
                  </Paper>
                ))}
              </Stack>
            </>
          )}
        </Paper>
      </Box>
    </Box>
  );
}

function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<UserDto | null>(null);
  const [authLoading, setAuthLoading] = useState(Boolean(token));
  const [stageSession, setStageSession] = useState<JoinRoomResponse | null>(null);
  const [stageChannelId, setStageChannelId] = useState<string | null>(null);

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
    setStageSession(null);
    setStageChannelId(null);
  };

  const closeStage = async () => {
    if (token && stageChannelId) {
      try {
        await apiCall<void>(
          "/voice/disconnect",
          "POST",
          { channelId: stageChannelId },
          token,
        );
      } catch {
        // best effort
      }
    }

    setStageSession(null);
    setStageChannelId(null);
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {stageSession ? (
        <RoomShell session={stageSession} onLeave={() => void closeStage()} />
      ) : authLoading ? (
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
          onOpenVoiceStage={(session, channelId) => {
            setStageSession(session);
            setStageChannelId(channelId);
          }}
        />
      )}
    </ThemeProvider>
  );
}

export default App;
