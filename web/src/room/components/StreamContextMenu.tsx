import DesktopAccessDisabledIcon from "@mui/icons-material/DesktopAccessDisabled";
import DesktopWindowsIcon from "@mui/icons-material/DesktopWindows";
import GavelIcon from "@mui/icons-material/Gavel";
import ManageAccountsIcon from "@mui/icons-material/ManageAccounts";
import MicIcon from "@mui/icons-material/Mic";
import MicOffIcon from "@mui/icons-material/MicOff";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import { Box, Divider, Menu, MenuItem, Slider, Stack, Typography } from "@mui/material";
import { PlatformRole } from "../../types";
import { ParticipantState, ScreenTrackState, StreamContextMenuState } from "../types";
import { volumePercent } from "../utils";

export function StreamContextMenu(props: {
  menu: StreamContextMenuState | null;
  participant: ParticipantState | null;
  track: ScreenTrackState | null;
  isHidden: boolean;
  onClose: () => void;
  onFocusTrack: (sid: string) => void;
  onFullscreenTrack: (sid: string) => void;
  onSetVoiceMuted: (identity: string, muted: boolean) => void;
  onSetStreamMuted: (identity: string, muted: boolean) => void;
  onToggleHidden: (identity: string) => void;
  onSetVoiceVolume: (identity: string, value: number) => void;
  onSetStreamVolume: (identity: string, value: number) => void;
  onResetAudio: (identity: string) => void;
  showLocalAudioControls: boolean;
  canModerate: boolean;
  serverMuted: boolean;
  serverDeafened: boolean;
  participantRole: PlatformRole | null;
  onKick: (identity: string) => void;
  onSetServerMuted: (identity: string, muted: boolean) => void;
  onSetServerDeafened: (identity: string, deafened: boolean) => void;
  onSetRole: (identity: string, role: PlatformRole) => void;
}) {
  return (
    <Menu
      open={Boolean(props.menu)}
      onClose={props.onClose}
      anchorReference="anchorPosition"
      sx={{ zIndex: 1700 }}
      slotProps={{ paper: { sx: { zIndex: 1701 } } }}
      anchorPosition={
        props.menu
          ? { top: props.menu.mouseY, left: props.menu.mouseX }
          : undefined
      }
    >
      {props.participant && props.track ? (
        <Box sx={{ px: 1.4, py: 1, width: 320 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            {props.participant.displayName}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Local stream controls
          </Typography>
          {!props.showLocalAudioControls && (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.7 }}>
              Join this voice channel to tune local voice/stream volume.
            </Typography>
          )}

          <MenuItem
            onClick={() => {
              props.onFocusTrack(props.track!.sid);
              props.onClose();
            }}
          >
            Focus this stream
          </MenuItem>

          <MenuItem
            onClick={() => {
              props.onFullscreenTrack(props.track!.sid);
              props.onClose();
            }}
          >
            Open fullscreen stream
          </MenuItem>

          {props.showLocalAudioControls && (
            <>
              <MenuItem
                onClick={() => {
                  props.onSetVoiceMuted(
                    props.participant!.identity,
                    !props.participant!.voiceMutedLocal,
                  );
                }}
              >
                {props.participant.voiceMutedLocal ? "Unmute voice" : "Mute voice"}
              </MenuItem>

              <MenuItem
                onClick={() => {
                  props.onSetStreamMuted(
                    props.participant!.identity,
                    !props.participant!.streamMutedLocal,
                  );
                }}
              >
                {props.participant.streamMutedLocal
                  ? "Unmute stream audio"
                  : "Mute stream audio"}
              </MenuItem>
            </>
          )}

          <MenuItem
            onClick={() => {
              props.onToggleHidden(props.participant!.identity);
              props.onClose();
            }}
          >
            {props.isHidden ? "Show stream" : "Hide stream"}
          </MenuItem>

          {props.showLocalAudioControls && <Divider sx={{ my: 0.7 }} />}

          {props.showLocalAudioControls && (
            <>
              <Stack direction="row" spacing={1} alignItems="center">
                <MicIcon fontSize="small" />
                <Slider
                  min={0}
                  max={200}
                  step={5}
                  value={volumePercent(props.participant.voiceVolume)}
                  onChange={(_, value) => {
                    const next = Array.isArray(value) ? value[0] : value;
                    props.onSetVoiceVolume(props.participant!.identity, next / 100);
                  }}
                />
                <Typography variant="caption" sx={{ width: 38 }}>
                  {volumePercent(props.participant.voiceVolume)}%
                </Typography>
                {props.participant.voiceMutedLocal ? (
                  <MicOffIcon fontSize="small" color="error" />
                ) : null}
              </Stack>

              <Stack direction="row" spacing={1} alignItems="center">
                {props.participant.streamMutedLocal ? (
                  <DesktopAccessDisabledIcon fontSize="small" color="error" />
                ) : (
                  <DesktopWindowsIcon fontSize="small" />
                )}
                <Slider
                  min={0}
                  max={200}
                  step={5}
                  value={volumePercent(props.participant.streamVolume)}
                  onChange={(_, value) => {
                    const next = Array.isArray(value) ? value[0] : value;
                    props.onSetStreamVolume(props.participant!.identity, next / 100);
                  }}
                />
                <Typography variant="caption" sx={{ width: 38 }}>
                  {volumePercent(props.participant.streamVolume)}%
                </Typography>
              </Stack>

              <Divider sx={{ my: 0.8 }} />
              <MenuItem
                onClick={() => {
                  props.onResetAudio(props.participant!.identity);
                  props.onClose();
                }}
              >
                <RestartAltIcon fontSize="small" sx={{ mr: 1 }} />
                Reset this participant audio
              </MenuItem>
            </>
          )}

          {props.canModerate && (
            <>
              <Divider sx={{ my: 0.8 }} />
              <Typography variant="caption" color="text.secondary">
                Admin moderation
              </Typography>
              <MenuItem
                onClick={() => {
                  props.onKick(props.participant!.identity);
                  props.onClose();
                }}
              >
                <GavelIcon fontSize="small" sx={{ mr: 1 }} />
                Kick from voice
              </MenuItem>
              <MenuItem
                onClick={() =>
                  props.onSetServerMuted(props.participant!.identity, !props.serverMuted)
                }
              >
                {props.serverMuted ? "Remove server mute" : "Server mute"}
              </MenuItem>
              <MenuItem
                onClick={() =>
                  props.onSetServerDeafened(
                    props.participant!.identity,
                    !props.serverDeafened,
                  )
                }
              >
                {props.serverDeafened ? "Remove server deafen" : "Server deafen"}
              </MenuItem>
              {props.participantRole !== null && (
                <MenuItem
                  onClick={() =>
                    props.onSetRole(
                      props.participant!.identity,
                      props.participantRole === "Admin" ? "User" : "Admin",
                    )
                  }
                >
                  <ManageAccountsIcon fontSize="small" sx={{ mr: 1 }} />
                  {props.participantRole === "Admin"
                    ? "Demote to user"
                    : "Promote to admin"}
                </MenuItem>
              )}
            </>
          )}
        </Box>
      ) : (
        <MenuItem disabled>No stream controls available</MenuItem>
      )}
    </Menu>
  );
}
