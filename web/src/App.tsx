import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Container,
  CssBaseline,
  GlobalStyles,
  Paper,
  Stack,
  TextField,
  ThemeProvider,
  Typography,
  createTheme,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import ScreenShareIcon from "@mui/icons-material/ScreenShare";
import {
  CreateInviteResponse,
  GuestAuthResponse,
  JoinRoomResponse,
  RoomDto,
  UserDto,
} from "./types";
import { RoomShell } from "./room/components/RoomShell";

const API_BASE = import.meta.env.VITE_API_URL ?? "/api";

type AuthState = {
  user: UserDto;
  appToken: string;
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
    h4: {
      fontWeight: 700,
      letterSpacing: "-0.02em",
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
          border: "1px solid rgba(86, 95, 110, 0.45)",
          transition: "border-color 180ms ease, box-shadow 180ms ease",
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: "none",
          fontWeight: 600,
          borderRadius: 10,
          transition: "background-color 140ms ease, border-color 140ms ease",
        },
        contained: {
          boxShadow: "0 8px 20px rgba(4, 8, 12, 0.34)",
        },
      },
    },
  },
});

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
              "radial-gradient(circle at 18% 12%, rgba(66, 103, 164, 0.17), transparent 42%), radial-gradient(circle at 82% 0%, rgba(80, 129, 117, 0.14), transparent 32%), #0f1116",
            overflow: "hidden",
          },
          "*": {
            boxSizing: "border-box",
          },
        }}
      />

      {joined ? (
        <RoomShell
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
                    sx={{ p: 1.2, backgroundColor: alpha("#57c2ff", 0.08) }}
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
