import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import FullscreenIcon from "@mui/icons-material/Fullscreen";
import GraphicEqIcon from "@mui/icons-material/GraphicEq";
import GridViewIcon from "@mui/icons-material/GridView";
import ViewCarouselIcon from "@mui/icons-material/ViewCarousel";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  FormGroup,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material/Select";
import { MouseEvent, useEffect, useMemo, useState } from "react";
import {
  DspSettings,
  StreamContentMode,
  StreamFpsPreset,
  StreamLayoutMode,
  StreamResolutionPreset,
} from "../../roomState";
import { JoinRoomResponse, PlatformRole, WorkspaceMemberDto } from "../../types";
import {
  ParticipantAudioMenuState,
  StreamContextMenuState,
} from "../types";
import { useRoomMediaController } from "../useRoomMediaController";
import { FullscreenStreamLayer } from "./FullscreenStreamLayer";
import { ParticipantAudioMenu } from "./ParticipantAudioMenu";
import { StreamContextMenu } from "./StreamContextMenu";
import { StreamStage } from "./StreamStage";

const API_BASE = import.meta.env.VITE_API_URL ?? "/api";

export type EmbeddedVoiceControls = {
  muted: boolean;
  sharing: boolean;
  connected: boolean;
  toggleMute: () => Promise<void>;
  toggleShare: () => Promise<void>;
  openSettings: () => void;
};

export type ParticipantMenuRequest = {
  id: number;
  channelId: string;
  userId: string;
  mouseX: number;
  mouseY: number;
};

export function EmbeddedVoiceStage(props: {
  session: JoinRoomResponse;
  appToken: string;
  voiceMessages: Array<{ userId: string; username: string; content: string; createdAtUtc: string }>;
  onSendVoiceMessage: (content: string) => Promise<void>;
  onSpeakingUsersChange: (userIds: Set<string>) => void;
  onControlsChange: (controls: EmbeddedVoiceControls | null) => void;
  isInActiveVoiceChannel: boolean;
  canModerate: boolean;
  memberStateByUserId: Map<string, WorkspaceMemberDto>;
  participantMenuRequest: ParticipantMenuRequest | null;
  onParticipantMenuHandled: (requestId: number) => void;
  onKick: (channelId: string, userId: string) => Promise<void>;
  onSetServerMuted: (channelId: string, userId: string, muted: boolean) => Promise<void>;
  onSetServerDeafened: (channelId: string, userId: string, deafened: boolean) => Promise<void>;
  onSetRole: (userId: string, role: PlatformRole) => Promise<void>;
}) {
  const media = useRoomMediaController(props.session);

  const [streamContextMenu, setStreamContextMenu] =
    useState<StreamContextMenuState | null>(null);
  const [participantAudioMenu, setParticipantAudioMenu] =
    useState<ParticipantAudioMenuState | null>(null);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatDraft, setChatDraft] = useState("");
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareSubmitting, setShareSubmitting] = useState(false);
  const [fullscreenStreamSid, setFullscreenStreamSid] = useState<string | null>(null);

  const fullscreenTrack = useMemo(() => {
    if (!fullscreenStreamSid) {
      return null;
    }
    return media.visibleScreenTracks.find((item) => item.sid === fullscreenStreamSid) ?? null;
  }, [fullscreenStreamSid, media.visibleScreenTracks]);

  const selectedContextParticipant = useMemo(() => {
    if (!streamContextMenu) {
      return null;
    }

    return media.participantMap.get(streamContextMenu.identity) ?? null;
  }, [media.participantMap, streamContextMenu]);

  const selectedContextTrack =
    streamContextMenu !== null
      ? media.visibleScreenTracks.find((track) => track.sid === streamContextMenu.sid) ?? null
      : null;

  const selectedAudioMenuParticipant = useMemo(() => {
    if (!participantAudioMenu) {
      return null;
    }

    const liveParticipant = media.participantMap.get(participantAudioMenu.identity);
    if (liveParticipant) {
      return liveParticipant;
    }

    const userState = props.memberStateByUserId.get(participantAudioMenu.identity);
    if (!userState) {
      return null;
    }

    return {
      identity: userState.userId,
      displayName: userState.username,
      isLocal: userState.userId === props.session.user.id,
      isScreenSharing: false,
      voiceVolume: 1,
      streamVolume: 1,
      voiceMutedLocal: false,
      streamMutedLocal: false,
      isVoiceActive: false,
      isScreenAudioActive: false,
    };
  }, [media.participantMap, participantAudioMenu, props.memberStateByUserId, props.session.user.id]);

  const selectedParticipantUserState =
    selectedAudioMenuParticipant !== null
      ? props.memberStateByUserId.get(selectedAudioMenuParticipant.identity) ?? null
      : null;

  const selectedContextUserState =
    selectedContextParticipant !== null
      ? props.memberStateByUserId.get(selectedContextParticipant.identity) ?? null
      : null;

  useEffect(() => {
    if (fullscreenStreamSid && !fullscreenTrack) {
      setFullscreenStreamSid(null);
    }
  }, [fullscreenStreamSid, fullscreenTrack]);

  useEffect(() => {
    if (!props.participantMenuRequest) {
      return;
    }

    setParticipantAudioMenu({
      identity: props.participantMenuRequest.userId,
      mouseX: props.participantMenuRequest.mouseX,
      mouseY: props.participantMenuRequest.mouseY,
      channelId: props.participantMenuRequest.channelId,
      scope: "normal",
    });
    props.onParticipantMenuHandled(props.participantMenuRequest.id);
  }, [
    props.participantMenuRequest,
    props.session.room.id,
    props.onParticipantMenuHandled,
  ]);

  const stopShare = async () => {
    if (!props.session.sessionInstanceId) {
      return;
    }

    await media.stopScreenShare();
    await fetch(`${API_BASE}/voice/streams/release`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${props.appToken}`,
      },
      body: JSON.stringify({
        channelId: props.session.room.id,
        sessionInstanceId: props.session.sessionInstanceId,
      }),
    }).catch(() => undefined);
  };

  const startShareWithPreset = async () => {
    if (!media.connected) {
      media.setError("Voice engine is still connecting. Please wait a few seconds and try again.");
      return;
    }

    setShareSubmitting(true);
    let permitGranted = false;

    try {
      const permitResponse = await fetch(`${API_BASE}/voice/streams/permit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${props.appToken}`,
        },
        body: JSON.stringify({
          channelId: props.session.room.id,
          sessionInstanceId: props.session.sessionInstanceId,
        }),
      });

      if (!permitResponse.ok) {
        const payload = await permitResponse.text();
        media.setError(payload || "Unable to get stream permit.");
        return;
      }

      const permit = (await permitResponse.json()) as {
        allowed: boolean;
        reason?: string;
      };

      if (!permit.allowed) {
        media.setError(permit.reason ?? "Stream limit reached in this voice channel.");
        return;
      }

      permitGranted = true;
      const started = await media.startScreenShare();
      if (!started) {
        await fetch(`${API_BASE}/voice/streams/release`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${props.appToken}`,
          },
          body: JSON.stringify({
            channelId: props.session.room.id,
            sessionInstanceId: props.session.sessionInstanceId,
          }),
        }).catch(() => undefined);
        return;
      }
      setShareDialogOpen(false);
    } catch {
      if (permitGranted) {
        await fetch(`${API_BASE}/voice/streams/release`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${props.appToken}`,
          },
          body: JSON.stringify({
            channelId: props.session.room.id,
            sessionInstanceId: props.session.sessionInstanceId,
          }),
        }).catch(() => undefined);
      }
      media.setError("Failed to start stream publish.");
    } finally {
      setShareSubmitting(false);
    }
  };

  useEffect(() => {
    props.onControlsChange({
      muted: media.muted,
      sharing: media.sharing,
      connected: media.connected,
      toggleMute: media.toggleLocalMute,
      toggleShare: async () => {
        if (media.sharing) {
          await stopShare();
          return;
        }

        if (!media.connected) {
          media.setError("Voice engine is still connecting. Please wait and try again.");
          return;
        }

        setShareDialogOpen(true);
      },
      openSettings: () => setSettingsOpen(true),
    });
  }, [media.connected, media.muted, media.sharing, media.toggleLocalMute, props.onControlsChange]);

  useEffect(() => {
    const speakingUsers = new Set(
      media.participants.filter((participant) => participant.isVoiceActive).map((item) => item.identity),
    );
    props.onSpeakingUsersChange(speakingUsers);
  }, [media.participants, props.onSpeakingUsersChange]);

  useEffect(() => {
    return () => {
      props.onControlsChange(null);
    };
  }, [props.onControlsChange]);

  const handleLayoutModeChange = (
    _event: MouseEvent<HTMLElement>,
    nextMode: StreamLayoutMode | null,
  ) => {
    if (!nextMode) {
      return;
    }
    media.setLayoutMode(nextMode);
  };

  const applyDspPatch = (patch: Partial<DspSettings>) => {
    media.updateDspSettings({
      ...media.dspSettings,
      ...patch,
    });
  };

  const menuChannelId = participantAudioMenu?.channelId ?? props.session.room.id;
  const allowLocalAudioControls =
    props.isInActiveVoiceChannel && menuChannelId === props.session.room.id;

  const canModerateSelectedParticipant = (
    identity: string,
  ) => props.canModerate && identity !== props.session.user.id;

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0, gap: 1 }}>
      <Paper
        sx={{
          p: 1,
          borderRadius: 1.4,
          borderColor: "rgba(95, 117, 140, 0.5)",
        }}
      >
        <Stack direction="row" alignItems="center" spacing={0.8}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: 1 }}>
            {props.session.room.name}
          </Typography>
          <Chip
            icon={<GraphicEqIcon />}
            color={media.connected ? "secondary" : "default"}
            label={media.connected ? "Voice online" : "Connecting..."}
            variant={media.connected ? "filled" : "outlined"}
            size="small"
          />
          <ToggleButtonGroup
            size="small"
            value={media.layoutState.mode}
            exclusive
            onChange={handleLayoutModeChange}
            sx={{
              ".MuiToggleButton-root": {
                px: 0.9,
                minWidth: 36,
                height: 32,
              },
            }}
          >
            <ToggleButton value="grid" aria-label="Grid layout">
              <GridViewIcon fontSize="small" />
            </ToggleButton>
            <ToggleButton value="focus" aria-label="Focus layout">
              <ViewCarouselIcon fontSize="small" />
            </ToggleButton>
            <ToggleButton value="theater" aria-label="Theater mode">
              <FullscreenIcon fontSize="small" />
            </ToggleButton>
          </ToggleButtonGroup>

          <IconButton size="small" onClick={() => setChatOpen((current) => !current)}>
            <ChatBubbleOutlineIcon fontSize="small" />
          </IconButton>
        </Stack>
      </Paper>

      {media.error && (
        <Alert severity="error" onClose={() => media.setError(null)}>
          {media.error}
        </Alert>
      )}

      <Box sx={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: chatOpen ? "minmax(0,1fr) 300px" : "minmax(0,1fr)", gap: 1 }}>
        <StreamStage
          participantMap={media.participantMap}
          visibleScreenTracks={media.visibleScreenTracks}
          hiddenStreamIdentities={media.hiddenStreamIdentities}
          totalStreamsCount={media.totalStreamsCount}
          layoutMode={media.layoutState.mode}
          effectiveStreamMode={media.effectiveStreamMode}
          focusedStreamSid={media.focusedStreamSid}
          focusedScreenTrack={media.focusedScreenTrack}
          secondaryFocusTracks={media.secondaryFocusTracks}
          onSetFocus={(sid) => {
            media.setLayoutMode("focus");
            media.setFocusedStream(sid);
          }}
          onHideStream={media.hideStream}
          onRestoreStream={media.restoreStream}
          onOpenFullscreen={setFullscreenStreamSid}
          onOpenStreamContextMenu={(event, track) => {
            setStreamContextMenu({
              sid: track.sid,
              identity: track.participantIdentity,
              mouseX: event.clientX + 2,
              mouseY: event.clientY - 6,
              scope: "stream",
            });
          }}
        />

        {chatOpen && (
          <Paper sx={{ p: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.8 }}>
              Voice Chat
            </Typography>
            <Divider sx={{ mb: 0.8 }} />
            <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", mb: 0.8 }}>
              <Stack spacing={0.6}>
                {props.voiceMessages.map((message, index) => (
                  <Typography key={`${message.createdAtUtc}-${index}`} variant="caption">
                    <Box component="span" sx={{ color: "primary.light", fontWeight: 700 }}>
                      {message.username}:{" "}
                    </Box>
                    {message.content}
                  </Typography>
                ))}
              </Stack>
            </Box>
            <Box
              component="form"
              onSubmit={(event) => {
                event.preventDefault();
                const trimmed = chatDraft.trim();
                if (!trimmed) {
                  return;
                }
                void props.onSendVoiceMessage(trimmed).then(() => setChatDraft(""));
              }}
            >
              <Stack direction="row" spacing={0.6}>
                <TextField
                  fullWidth
                  size="small"
                  placeholder="Type message"
                  value={chatDraft}
                  onChange={(event) => setChatDraft(event.target.value)}
                />
                <Button type="submit" variant="contained" size="small">
                  Send
                </Button>
              </Stack>
            </Box>
          </Paper>
        )}
      </Box>

      <Dialog open={shareDialogOpen} onClose={() => setShareDialogOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Start Screen Share</DialogTitle>
        <DialogContent sx={{ pt: "8px !important" }}>
          <Stack spacing={1.2}>
            <FormControl fullWidth size="small">
              <InputLabel id="share-resolution-label">Quality</InputLabel>
              <Select
                labelId="share-resolution-label"
                value={media.streamStartOptions.resolution}
                label="Quality"
                onChange={(event) => {
                  media.updateStreamStartOptions({
                    resolution: event.target.value as StreamResolutionPreset,
                  });
                }}
              >
                <MenuItem value="auto">Auto</MenuItem>
                <MenuItem value="240p">240p</MenuItem>
                <MenuItem value="360p">360p</MenuItem>
                <MenuItem value="480p">480p</MenuItem>
                <MenuItem value="720p">720p</MenuItem>
                <MenuItem value="1080p">1080p</MenuItem>
              </Select>
            </FormControl>

            <FormControl fullWidth size="small">
              <InputLabel id="share-fps-label">FPS</InputLabel>
              <Select
                labelId="share-fps-label"
                value={String(media.streamStartOptions.fps)}
                label="FPS"
                onChange={(event) => {
                  media.updateStreamStartOptions({
                    fps: Number(event.target.value) as StreamFpsPreset,
                  });
                }}
              >
                <MenuItem value="15">15</MenuItem>
                <MenuItem value="30">30</MenuItem>
                <MenuItem value="60">60</MenuItem>
              </Select>
            </FormControl>

            <FormControl fullWidth size="small">
              <InputLabel id="share-mode-label">Mode</InputLabel>
              <Select
                labelId="share-mode-label"
                value={media.streamStartOptions.mode}
                label="Mode"
                onChange={(event) => {
                  media.updateStreamStartOptions({
                    mode: event.target.value as StreamContentMode,
                  });
                }}
              >
                <MenuItem value="game">Game (motion)</MenuItem>
                <MenuItem value="text">Text (clarity)</MenuItem>
              </Select>
            </FormControl>

            <FormControlLabel
              control={
                <Switch
                  checked={media.streamStartOptions.includeSystemAudio}
                  onChange={(event) => {
                    media.updateStreamStartOptions({
                      includeSystemAudio: event.target.checked,
                    });
                  }}
                />
              }
              label="Include system audio"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShareDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={() => void startShareWithPreset()} disabled={shareSubmitting}>
            {shareSubmitting ? "Starting..." : "Start Share"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Voice Settings</DialogTitle>
        <DialogContent sx={{ pt: "8px !important" }}>
          <Stack spacing={1.5}>
            <FormControl
              fullWidth
              size="small"
              disabled={media.devicesLoading || media.inputDevices.length === 0}
            >
              <InputLabel id="settings-input-label">Microphone</InputLabel>
              <Select
                labelId="settings-input-label"
                value={media.selectedInputId}
                label="Microphone"
                onChange={(event: SelectChangeEvent<string>) => {
                  void media.changeMicrophoneDevice(event.target.value);
                }}
              >
                {media.inputDevices.map((device) => (
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
                media.devicesLoading ||
                !media.supportsOutputSelection ||
                media.outputDevices.length === 0
              }
            >
              <InputLabel id="settings-output-label">Output</InputLabel>
              <Select
                labelId="settings-output-label"
                value={media.selectedOutputId}
                label="Output"
                onChange={(event: SelectChangeEvent<string>) => {
                  void media.changeOutputDevice(event.target.value);
                }}
              >
                {media.outputDevices.map((device) => (
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
                    checked={media.dspSettings.echoCancellation}
                    onChange={(event) =>
                      applyDspPatch({
                        echoCancellation: event.target.checked,
                      })
                    }
                  />
                }
                label="Echo cancellation"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={media.dspSettings.noiseSuppression}
                    onChange={(event) =>
                      applyDspPatch({
                        noiseSuppression: event.target.checked,
                      })
                    }
                  />
                }
                label="Noise suppression"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={media.dspSettings.autoGainControl}
                    onChange={(event) =>
                      applyDspPatch({
                        autoGainControl: event.target.checked,
                      })
                    }
                  />
                }
                label="Auto gain control"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={media.dspSettings.voiceIsolation}
                    onChange={(event) =>
                      applyDspPatch({
                        voiceIsolation: event.target.checked,
                      })
                    }
                  />
                }
                label="Voice isolation (experimental)"
              />
            </FormGroup>

            <Button
              variant="outlined"
              onClick={() => {
                void media.applyDspSettings();
              }}
              disabled={media.dspApplying}
            >
              {media.dspApplying ? "Applying..." : "Apply Microphone Settings"}
            </Button>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSettingsOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      <ParticipantAudioMenu
        menu={participantAudioMenu}
        participant={selectedAudioMenuParticipant}
        onClose={() => setParticipantAudioMenu(null)}
        onSetVoiceMuted={(identity, muted) => media.setChannelMuted(identity, "voice", muted)}
        onSetStreamMuted={(identity, muted) => media.setChannelMuted(identity, "stream", muted)}
        onSetVoiceVolume={(identity, value) => media.setChannelVolume(identity, "voice", value)}
        onSetStreamVolume={(identity, value) => media.setChannelVolume(identity, "stream", value)}
        onResetAudio={(identity) => media.resetParticipantAudio(identity)}
        showLocalAudioControls={allowLocalAudioControls}
        canModerate={
          selectedAudioMenuParticipant !== null &&
          canModerateSelectedParticipant(selectedAudioMenuParticipant.identity)
        }
        serverMuted={selectedParticipantUserState?.isMuted ?? false}
        serverDeafened={selectedParticipantUserState?.isDeafened ?? false}
        participantRole={selectedParticipantUserState?.role ?? null}
        onKick={(identity) => void props.onKick(menuChannelId, identity)}
        onSetServerMuted={(identity, muted) =>
          void props.onSetServerMuted(menuChannelId, identity, muted)
        }
        onSetServerDeafened={(identity, deafened) =>
          void props.onSetServerDeafened(menuChannelId, identity, deafened)
        }
        onSetRole={(identity, role) => void props.onSetRole(identity, role)}
      />

      <StreamContextMenu
        menu={streamContextMenu}
        participant={selectedContextParticipant}
        track={selectedContextTrack}
        isHidden={
          selectedContextParticipant
            ? media.hiddenStreamIdentities.includes(selectedContextParticipant.identity)
            : false
        }
        onClose={() => setStreamContextMenu(null)}
        onFocusTrack={(sid) => {
          media.setLayoutMode("focus");
          media.setFocusedStream(sid);
        }}
        onFullscreenTrack={setFullscreenStreamSid}
        onSetVoiceMuted={(identity, muted) => media.setChannelMuted(identity, "voice", muted)}
        onSetStreamMuted={(identity, muted) => media.setChannelMuted(identity, "stream", muted)}
        onToggleHidden={(identity) => {
          if (media.hiddenStreamIdentities.includes(identity)) {
            media.restoreStream(identity);
            return;
          }
          media.hideStream(identity);
        }}
        onSetVoiceVolume={(identity, value) => media.setChannelVolume(identity, "voice", value)}
        onSetStreamVolume={(identity, value) => media.setChannelVolume(identity, "stream", value)}
        onResetAudio={(identity) => media.resetParticipantAudio(identity)}
        showLocalAudioControls={allowLocalAudioControls}
        canModerate={
          selectedContextParticipant !== null &&
          canModerateSelectedParticipant(selectedContextParticipant.identity)
        }
        serverMuted={selectedContextUserState?.isMuted ?? false}
        serverDeafened={selectedContextUserState?.isDeafened ?? false}
        participantRole={selectedContextUserState?.role ?? null}
        onKick={(identity) => void props.onKick(props.session.room.id, identity)}
        onSetServerMuted={(identity, muted) =>
          void props.onSetServerMuted(props.session.room.id, identity, muted)
        }
        onSetServerDeafened={(identity, deafened) =>
          void props.onSetServerDeafened(props.session.room.id, identity, deafened)
        }
        onSetRole={(identity, role) => void props.onSetRole(identity, role)}
      />

      {fullscreenTrack && (
        <FullscreenStreamLayer
          track={fullscreenTrack.track}
          label={media.participantMap.get(fullscreenTrack.participantIdentity)?.displayName ?? fullscreenTrack.participantIdentity}
          participants={media.participants}
          onClose={() => setFullscreenStreamSid(null)}
          onAvatarContextMenu={(event, identity) => {
            setParticipantAudioMenu({
              identity,
              mouseX: event.clientX + 2,
              mouseY: event.clientY - 6,
              channelId: props.session.room.id,
              scope: "fullscreen-avatar",
            });
          }}
        />
      )}
    </Box>
  );
}
