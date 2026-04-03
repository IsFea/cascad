import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  createLocalAudioTrack,
  LocalAudioTrack,
  RemoteAudioTrack,
  RemoteParticipant,
  Room,
  RoomEvent,
  Track,
  VideoTrack,
} from "livekit-client";
import {
  CreateInviteResponse,
  GuestAuthResponse,
  JoinRoomResponse,
  RoomDto,
  UserDto,
} from "./types";

const API_BASE = import.meta.env.VITE_API_URL ?? "/api";

type AuthState = {
  user: UserDto;
  appToken: string;
};

type ScreenTrackState = {
  sid: string;
  participant: string;
  track: VideoTrack;
};

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

function ScreenTile(props: { track: VideoTrack; label: string }) {
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

  return (
    <article className="screen-tile">
      <video ref={videoRef} autoPlay playsInline />
      <div className="screen-label">{props.label}</div>
    </article>
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
  const [participants, setParticipants] = useState<string[]>([]);
  const [screenTracks, setScreenTracks] = useState<ScreenTrackState[]>([]);
  const [volumes, setVolumes] = useState<Record<string, number>>({});

  const roomRef = useRef<Room | null>(null);
  const localAudioRef = useRef<LocalAudioTrack | null>(null);
  const remoteAudioElRef = useRef<Record<string, HTMLAudioElement>>({});
  const volumesRef = useRef<Record<string, number>>({});

  useEffect(() => {
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
    });
    roomRef.current = room;

    const syncParticipants = () => {
      const ids = Array.from(room.remoteParticipants.values()).map(
        (participant) => participant.identity,
      );
      setParticipants(ids);
      setVolumes((prev) => {
        const next: Record<string, number> = {};
        for (const id of ids) {
          next[id] = prev[id] ?? 1;
        }
        volumesRef.current = next;
        return next;
      });
    };

    const attachRemoteAudio = (participant: RemoteParticipant, track: RemoteAudioTrack) => {
      const identity = participant.identity;
      const current = remoteAudioElRef.current[identity] ?? new Audio();
      current.autoplay = true;
      current.volume = volumesRef.current[identity] ?? 1;
      track.attach(current);
      remoteAudioElRef.current[identity] = current;
    };

    const onTrackSubscribed = (
      track: Track,
      _publication: unknown,
      participant: RemoteParticipant,
    ) => {
      if (track.kind === Track.Kind.Audio) {
        attachRemoteAudio(participant, track as RemoteAudioTrack);
        return;
      }

      if (track.kind === Track.Kind.Video && track.source === Track.Source.ScreenShare) {
        const sid = track.sid ?? `${participant.identity}-screen`;
        setScreenTracks((prev) => {
          if (prev.some((item) => item.sid === sid)) {
            return prev;
          }

          return [
            ...prev,
            {
              sid,
              participant: participant.identity,
              track: track as VideoTrack,
            },
          ];
        });
      }
    };

    const onTrackUnsubscribed = (track: Track, _publication: unknown, participant: RemoteParticipant) => {
      if (track.kind === Track.Kind.Audio) {
        const element = remoteAudioElRef.current[participant.identity];
        if (element) {
          track.detach(element);
          element.remove();
          delete remoteAudioElRef.current[participant.identity];
        }
      }

      if (track.kind === Track.Kind.Video && track.source === Track.Source.ScreenShare) {
        const sid = track.sid ?? `${participant.identity}-screen`;
        setScreenTracks((prev) => prev.filter((item) => item.sid !== sid));
      }
    };

    room.on(RoomEvent.TrackSubscribed, onTrackSubscribed);
    room.on(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
    room.on(RoomEvent.ParticipantConnected, syncParticipants);
    room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      const element = remoteAudioElRef.current[participant.identity];
      if (element) {
        element.remove();
        delete remoteAudioElRef.current[participant.identity];
      }
      setScreenTracks((prev) =>
        prev.filter((item) => item.participant !== participant.identity),
      );
      syncParticipants();
    });
    room.on(RoomEvent.Disconnected, () => {
      setConnected(false);
      setSharing(false);
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

        const microphone = await createLocalAudioTrack({
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        });

        await room.localParticipant.publishTrack(microphone, {
          source: Track.Source.Microphone,
        });

        localAudioRef.current = microphone;
        syncParticipants();
        setConnected(true);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to connect to LiveKit room.");
      }
    };

    void connect();

    return () => {
      room.off(RoomEvent.TrackSubscribed, onTrackSubscribed);
      room.off(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
      room.disconnect();
      localAudioRef.current?.stop();
      Object.values(remoteAudioElRef.current).forEach((element) => {
        element.pause();
        element.remove();
      });
      remoteAudioElRef.current = {};
      roomRef.current = null;
    };
  }, [props.session.rtcToken, props.session.rtcUrl]);

  const toggleMute = async () => {
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
  };

  const toggleShare = async () => {
    if (!roomRef.current) {
      return;
    }

    const next = !sharing;
    setSharing(next);
    try {
      await roomRef.current.localParticipant.setScreenShareEnabled(next);
    } catch (e) {
      setSharing(!next);
      setError(e instanceof Error ? e.message : "Screen share failed.");
    }
  };

  const updateVolume = (participantIdentity: string, value: number) => {
    setVolumes((prev) => {
      const next = { ...prev, [participantIdentity]: value };
      volumesRef.current = next;
      return next;
    });
    const element = remoteAudioElRef.current[participantIdentity];
    if (element) {
      element.volume = value;
    }
  };

  return (
    <main className="room-page">
      <section className="room-header">
        <div>
          <h2>{props.session.room.name}</h2>
          <p>{connected ? "Connected to voice" : "Connecting..."}</p>
        </div>
        <div className="room-actions">
          <button onClick={toggleMute}>{muted ? "Unmute" : "Mute"}</button>
          <button onClick={toggleShare}>{sharing ? "Stop Share" : "Share Screen"}</button>
          <button className="danger" onClick={props.onLeave}>
            Leave
          </button>
        </div>
      </section>

      {error && <p className="error-box">{error}</p>}

      <section className="grid">
        <div className="screen-grid">
          {screenTracks.length === 0 && (
            <p className="empty-hint">No active screen streams yet.</p>
          )}
          {screenTracks.map((item) => (
            <ScreenTile
              key={item.sid}
              track={item.track}
              label={`${item.participant} screen`}
            />
          ))}
        </div>
      </section>

      <section className="participants">
        <h3>Remote Participants ({participants.length})</h3>
        {participants.length === 0 && <p className="empty-hint">No one else in room yet.</p>}
        {participants.map((participant) => (
          <label className="volume-row" key={participant}>
            <span>{participant}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volumes[participant] ?? 1}
              onChange={(event) => updateVolume(participant, Number(event.target.value))}
            />
            <span>{Math.round((volumes[participant] ?? 1) * 100)}%</span>
          </label>
        ))}
      </section>
    </main>
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to authenticate guest.");
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create room.");
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to join room.");
    } finally {
      setLoading(false);
    }
  };

  if (joined) {
    return (
      <RoomView
        session={joined}
        onLeave={() => {
          setJoined(null);
        }}
      />
    );
  }

  return (
    <main className="lobby-page">
      <section className="card">
        <h1>Cascad Voice MVP</h1>
        <p>Self-hosted voice room with multi-user screen sharing.</p>

        <form onSubmit={handleGuestLogin} className="auth-form">
          <label>
            Nickname
            <input
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              minLength={2}
              maxLength={32}
              placeholder="Your nickname"
              required
            />
          </label>
          <button disabled={loading} type="submit">
            {auth ? "Re-login Guest" : "Login as Guest"}
          </button>
        </form>

        {auth && (
          <p className="status-line">
            Logged in as <strong>{auth.user.nickname}</strong>
          </p>
        )}
      </section>

      <section className="card">
        <h2>Room Controls</h2>
        <label>
          Room name
          <input
            value={roomName}
            onChange={(event) => setRoomName(event.target.value)}
            minLength={2}
            maxLength={80}
            disabled={!canCreateOrJoin}
          />
        </label>
        <button disabled={!canCreateOrJoin || loading} onClick={handleCreateRoom}>
          Create Room + Invite
        </button>

        {createdInvite && (
          <div className="invite-box">
            <p>Invite URL:</p>
            <code>{createdInvite.inviteUrl}</code>
          </div>
        )}

        <label>
          Invite token
          <input
            value={inviteToken}
            onChange={(event) => setInviteToken(event.target.value)}
            placeholder="Paste invite token"
            disabled={!canCreateOrJoin}
          />
        </label>
        <button disabled={!canCreateOrJoin || !inviteToken || loading} onClick={handleJoin}>
          Join Room
        </button>
      </section>

      {error && <p className="error-box">{error}</p>}
    </main>
  );
}

export default App;
