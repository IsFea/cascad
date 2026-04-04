import {
  Alert,
  AppBar,
  Box,
  Button,
  Checkbox,
  Chip,
  Container,
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
  Popover,
  Select,
  Stack,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
  Toolbar,
  Tooltip,
  Typography,
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material/Select";
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
import { MouseEvent, useEffect, useMemo, useState } from "react";
import {
  DspSettings,
  StreamContentMode,
  StreamFpsPreset,
  StreamLayoutMode,
  StreamResolutionPreset,
} from "../../roomState";
import { JoinRoomResponse } from "../../types";
import { ParticipantAudioMenuState, StreamContextMenuState } from "../types";
import { useRoomMediaController } from "../useRoomMediaController";
import { FullscreenStreamLayer } from "./FullscreenStreamLayer";
import { ParticipantAudioMenu } from "./ParticipantAudioMenu";
import { ParticipantsPanel } from "./ParticipantsPanel";
import { StreamContextMenu } from "./StreamContextMenu";
import { StreamStage } from "./StreamStage";

export function RoomShell(props: {
  session: JoinRoomResponse;
  onLeave: () => void;
}) {
  const media = useRoomMediaController(props.session);

  const [streamContextMenu, setStreamContextMenu] =
    useState<StreamContextMenuState | null>(null);
  const [participantAudioMenu, setParticipantAudioMenu] =
    useState<ParticipantAudioMenuState | null>(null);

  const [settingsAnchorEl, setSettingsAnchorEl] = useState<HTMLElement | null>(null);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  const [rightPanelTab, setRightPanelTab] = useState<"participants" | "chat">(
    "participants",
  );
  const [expandedParticipantControls, setExpandedParticipantControls] = useState<
    Record<string, boolean>
  >({});
  const [fullscreenStreamSid, setFullscreenStreamSid] = useState<string | null>(null);

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
    return media.participantMap.get(participantAudioMenu.identity) ?? null;
  }, [media.participantMap, participantAudioMenu]);

  const fullscreenTrack = useMemo(() => {
    if (!fullscreenStreamSid) {
      return null;
    }
    return media.visibleScreenTracks.find((item) => item.sid === fullscreenStreamSid) ?? null;
  }, [fullscreenStreamSid, media.visibleScreenTracks]);

  useEffect(() => {
    if (fullscreenStreamSid && !fullscreenTrack) {
      setFullscreenStreamSid(null);
    }
  }, [fullscreenStreamSid, fullscreenTrack]);

  useEffect(() => {
    if (!fullscreenStreamSid) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFullscreenStreamSid(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [fullscreenStreamSid]);

  const isTheaterMode = media.layoutState.mode === "theater";
  const settingsOpen = Boolean(settingsAnchorEl);

  const handleLayoutModeChange = (
    _event: MouseEvent<HTMLElement>,
    nextMode: StreamLayoutMode | null,
  ) => {
    if (!nextMode) {
      return;
    }
    media.setLayoutMode(nextMode);
  };

  const handleShareButtonClick = async () => {
    if (media.sharing) {
      await media.stopScreenShare();
      return;
    }
    setShareDialogOpen(true);
  };

  const toggleParticipantRow = (identity: string) => {
    setExpandedParticipantControls((previous) => ({
      ...previous,
      [identity]: !previous[identity],
    }));
  };

  const applyDspPatch = (patch: Partial<DspSettings>) => {
    media.updateDspSettings({
      ...media.dspSettings,
      ...patch,
    });
  };

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
            "linear-gradient(110deg, rgba(9, 21, 32, 0.86), rgba(10, 36, 28, 0.64))",
        }}
      >
        <Toolbar sx={{ gap: 1.2, flexWrap: "wrap" }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ flexGrow: 1 }}>
            <MonitorIcon color="primary" />
            <Box>
              <Typography variant="h6">{props.session.room.name}</Typography>
              <Typography variant="caption" color="text.secondary">
                {media.connected ? "Connected to voice" : "Connecting to room..."}
              </Typography>
            </Box>
          </Stack>

          <Chip
            icon={<GraphicEqIcon />}
            color={media.connected ? "secondary" : "default"}
            label={media.connected ? "Voice online" : "Voice offline"}
            variant={media.connected ? "filled" : "outlined"}
          />

          <ToggleButtonGroup
            size="small"
            value={media.layoutState.mode}
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

          {!isTheaterMode && (
            <Tooltip
              title={
                rightPanelCollapsed
                  ? "Open participants panel"
                  : "Collapse participants panel"
              }
            >
              <IconButton
                aria-label={
                  rightPanelCollapsed
                    ? "Open participants panel"
                    : "Collapse participants panel"
                }
                color={rightPanelCollapsed ? "primary" : "default"}
                onClick={() => {
                  setRightPanelTab("participants");
                  setRightPanelCollapsed((current) => !current);
                }}
              >
                <PeopleIcon />
              </IconButton>
            </Tooltip>
          )}

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

          <Tooltip title={media.muted ? "Unmute microphone" : "Mute microphone"}>
            <IconButton
              aria-label={media.muted ? "Unmute microphone" : "Mute microphone"}
              color={media.muted ? "error" : "primary"}
              onClick={() => {
                void media.toggleLocalMute();
              }}
            >
              {media.muted ? <MicOffIcon /> : <MicIcon />}
            </IconButton>
          </Tooltip>

          <Button
            onClick={() => {
              void handleShareButtonClick();
            }}
            startIcon={media.sharing ? <StopScreenShareIcon /> : <ScreenShareIcon />}
            color={media.sharing ? "error" : "primary"}
            variant={media.sharing ? "outlined" : "contained"}
          >
            {media.sharing ? "Stop Share" : "Share Screen"}
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

      <Dialog
        open={shareDialogOpen}
        onClose={() => setShareDialogOpen(false)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Start Screen Share</DialogTitle>
        <DialogContent sx={{ pt: "8px !important" }}>
          <Stack spacing={1.2}>
            <FormControl fullWidth size="small">
              <InputLabel id="share-resolution-label">Resolution</InputLabel>
              <Select
                labelId="share-resolution-label"
                value={media.streamStartOptions.resolution}
                label="Resolution"
                onChange={(event) => {
                  media.updateStreamStartOptions({
                    resolution: event.target.value as StreamResolutionPreset,
                  });
                }}
              >
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
                <Checkbox
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

            <Typography variant="caption" color="text.secondary">
              60 FPS may fallback to 30 FPS on unsupported browsers.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShareDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => {
              void media.startScreenShare().then(() => {
                setShareDialogOpen(false);
              });
            }}
          >
            Start Share
          </Button>
        </DialogActions>
      </Dialog>

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
                startAdornment={<MicIcon fontSize="small" />}
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
                startAdornment={<HearingIcon fontSize="small" />}
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
        </Box>
      </Popover>

      <Container maxWidth={false} sx={{ py: 2 }}>
        {media.error && (
          <Alert
            severity="error"
            sx={{ mb: 2 }}
            onClose={() => {
              media.setError(null);
            }}
          >
            {media.error}
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
                  : "minmax(0, 1fr) 304px",
            },
            gap: 1.6,
            alignItems: "start",
          }}
        >
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
              });
            }}
          />

          {!isTheaterMode && (
            <ParticipantsPanel
              participants={media.participants}
              remoteParticipantsCount={media.remoteParticipantsCount}
              collapsed={rightPanelCollapsed}
              tab={rightPanelTab}
              expandedRows={expandedParticipantControls}
              onTabChange={setRightPanelTab}
              onSetCollapsed={setRightPanelCollapsed}
              onToggleRow={toggleParticipantRow}
              onSetChannelVolume={media.setChannelVolume}
              onSetChannelMuted={media.setChannelMuted}
              onResetParticipantAudio={media.resetParticipantAudio}
            />
          )}
        </Box>
      </Container>

      <StreamContextMenu
        menu={streamContextMenu}
        participant={selectedContextParticipant}
        track={selectedContextTrack}
        isHidden={
          selectedContextParticipant
            ? Boolean(
                media.hiddenStreamIdentities.includes(selectedContextParticipant.identity),
              )
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
          } else {
            media.hideStream(identity);
          }
        }}
        onSetVoiceVolume={(identity, value) => media.setChannelVolume(identity, "voice", value)}
        onSetStreamVolume={(identity, value) => media.setChannelVolume(identity, "stream", value)}
        onResetAudio={media.resetParticipantAudio}
      />

      <ParticipantAudioMenu
        menu={participantAudioMenu}
        participant={selectedAudioMenuParticipant}
        onClose={() => setParticipantAudioMenu(null)}
        onSetVoiceMuted={(identity, muted) => media.setChannelMuted(identity, "voice", muted)}
        onSetStreamMuted={(identity, muted) => media.setChannelMuted(identity, "stream", muted)}
        onSetVoiceVolume={(identity, value) => media.setChannelVolume(identity, "voice", value)}
        onSetStreamVolume={(identity, value) => media.setChannelVolume(identity, "stream", value)}
        onResetAudio={media.resetParticipantAudio}
      />

      {fullscreenTrack && (
        <FullscreenStreamLayer
          track={fullscreenTrack.track}
          label={media.participantMap.get(fullscreenTrack.participantIdentity)?.displayName ?? "Screen"}
          participants={media.participants}
          onClose={() => setFullscreenStreamSid(null)}
          onAvatarContextMenu={(event, identity) => {
            event.preventDefault();
            event.stopPropagation();
            setParticipantAudioMenu({
              identity,
              mouseX: event.clientX + 2,
              mouseY: event.clientY - 6,
              scope: "fullscreen",
            });
          }}
        />
      )}
    </Box>
  );
}
