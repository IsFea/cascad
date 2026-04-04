import DesktopAccessDisabledIcon from "@mui/icons-material/DesktopAccessDisabled";
import DesktopWindowsIcon from "@mui/icons-material/DesktopWindows";
import MicIcon from "@mui/icons-material/Mic";
import MicOffIcon from "@mui/icons-material/MicOff";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import { Box, Divider, Menu, MenuItem, Slider, Stack, Typography } from "@mui/material";
import { ParticipantAudioMenuState, ParticipantState } from "../types";
import { volumePercent } from "../utils";

export function ParticipantAudioMenu(props: {
  menu: ParticipantAudioMenuState | null;
  participant: ParticipantState | null;
  onClose: () => void;
  onSetVoiceMuted: (identity: string, muted: boolean) => void;
  onSetStreamMuted: (identity: string, muted: boolean) => void;
  onSetVoiceVolume: (identity: string, value: number) => void;
  onSetStreamVolume: (identity: string, value: number) => void;
  onResetAudio: (identity: string) => void;
}) {
  return (
    <Menu
      open={Boolean(props.menu)}
      onClose={props.onClose}
      anchorReference="anchorPosition"
      anchorPosition={
        props.menu
          ? { top: props.menu.mouseY, left: props.menu.mouseX }
          : undefined
      }
    >
      {props.participant ? (
        <Box sx={{ px: 1.4, py: 1, width: 310 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            {props.participant.displayName}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Local audio controls
          </Typography>

          <MenuItem
            onClick={() =>
              props.onSetVoiceMuted(
                props.participant!.identity,
                !props.participant!.voiceMutedLocal,
              )
            }
          >
            {props.participant.voiceMutedLocal ? "Unmute voice" : "Mute voice"}
          </MenuItem>

          <MenuItem
            onClick={() =>
              props.onSetStreamMuted(
                props.participant!.identity,
                !props.participant!.streamMutedLocal,
              )
            }
          >
            {props.participant.streamMutedLocal
              ? "Unmute stream audio"
              : "Mute stream audio"}
          </MenuItem>

          <Divider sx={{ my: 0.7 }} />

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
        </Box>
      ) : (
        <MenuItem disabled>No participant selected</MenuItem>
      )}
    </Menu>
  );
}
