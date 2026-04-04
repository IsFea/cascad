import DesktopAccessDisabledIcon from "@mui/icons-material/DesktopAccessDisabled";
import DesktopWindowsIcon from "@mui/icons-material/DesktopWindows";
import FiberManualRecordIcon from "@mui/icons-material/FiberManualRecord";
import ForumIcon from "@mui/icons-material/Forum";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import MicIcon from "@mui/icons-material/Mic";
import MicOffIcon from "@mui/icons-material/MicOff";
import PeopleIcon from "@mui/icons-material/People";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import ScreenShareIcon from "@mui/icons-material/ScreenShare";
import { alpha } from "@mui/material/styles";
import {
  Avatar,
  Badge,
  Box,
  Button,
  Chip,
  Collapse,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Paper,
  Slider,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from "@mui/material";
import { AudioChannel } from "../../roomState";
import { ParticipantState } from "../types";
import { initials, volumePercent } from "../utils";

export function ParticipantsPanel(props: {
  participants: ParticipantState[];
  remoteParticipantsCount: number;
  collapsed: boolean;
  tab: "participants" | "chat";
  expandedRows: Record<string, boolean>;
  onTabChange: (value: "participants" | "chat") => void;
  onSetCollapsed: (value: boolean) => void;
  onToggleRow: (identity: string) => void;
  onSetChannelVolume: (identity: string, source: AudioChannel, value: number) => void;
  onSetChannelMuted: (identity: string, source: AudioChannel, mutedLocal: boolean) => void;
  onResetParticipantAudio: (identity: string) => void;
}) {
  if (props.collapsed) {
    return (
      <Paper
        sx={{
          p: 0.5,
          display: "grid",
          gap: 0.65,
          justifyItems: "center",
          alignContent: "start",
        }}
      >
        <Stack spacing={0.7} alignItems="center">
          {props.participants.map((participant) => (
            <Tooltip
              key={participant.identity}
              title={`${participant.displayName}${participant.isScreenSharing ? " (streaming)" : ""}`}
              placement="left"
            >
              <Box
                sx={{ position: "relative", display: "inline-flex", cursor: "pointer" }}
                onClick={() => {
                  props.onTabChange("participants");
                  props.onSetCollapsed(false);
                }}
              >
                <Avatar
                  sx={{
                    width: 34,
                    height: 34,
                    fontSize: "0.72rem",
                    bgcolor: alpha("#57c2ff", 0.25),
                    border: participant.isVoiceActive
                      ? "2px solid rgba(69, 214, 159, 0.96)"
                      : "2px solid rgba(119, 168, 204, 0.4)",
                    boxShadow: participant.isVoiceActive
                      ? "0 0 0 2px rgba(69, 214, 159, 0.24)"
                      : "none",
                  }}
                >
                  {initials(participant.displayName)}
                </Avatar>
                {participant.isScreenSharing && (
                  <FiberManualRecordIcon
                    sx={{
                      position: "absolute",
                      right: -1,
                      bottom: -1,
                      fontSize: 10,
                      color: "#ff5b5b",
                      bgcolor: "#040a10",
                      borderRadius: "50%",
                    }}
                  />
                )}
              </Box>
            </Tooltip>
          ))}
        </Stack>
      </Paper>
    );
  }

  return (
    <Paper sx={{ p: 1 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 0.3 }}>
        <Tabs
          value={props.tab}
          onChange={(_, value: "participants" | "chat") => props.onTabChange(value)}
          sx={{ minHeight: 36 }}
        >
          <Tab
            icon={<PeopleIcon fontSize="small" />}
            iconPosition="start"
            label="Participants"
            value="participants"
            sx={{ minHeight: 36, textTransform: "none", px: 1.1 }}
          />
          <Tab
            icon={<ForumIcon fontSize="small" />}
            iconPosition="start"
            label="Chat"
            value="chat"
            sx={{ minHeight: 36, textTransform: "none", px: 1.1 }}
          />
        </Tabs>
      </Stack>

      <Divider sx={{ my: 0.8 }} />

      {props.tab === "participants" && (
        <Box>
          <Typography variant="subtitle2" sx={{ px: 0.7, mb: 1, fontWeight: 700 }}>
            Participants ({props.participants.length})
          </Typography>

          <List disablePadding>
            {props.participants.map((participant) => {
              const expanded = Boolean(props.expandedRows[participant.identity]);

              return (
                <ListItem
                  key={participant.identity}
                  disableGutters
                  sx={{
                    display: "block",
                    p: 0.8,
                    mb: 0.7,
                    borderRadius: 1.6,
                    border: participant.isVoiceActive
                      ? "1px solid rgba(69, 214, 159, 0.88)"
                      : "1px solid rgba(128, 182, 219, 0.12)",
                    boxShadow: participant.isVoiceActive
                      ? "0 0 0 1px rgba(69, 214, 159, 0.2)"
                      : "0 6px 14px rgba(3, 11, 18, 0.2)",
                    backgroundColor: alpha("#122032", 0.26),
                  }}
                >
                  <Stack direction="row" spacing={1} alignItems="center">
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
                            width: 32,
                            height: 32,
                            bgcolor: alpha("#57c2ff", 0.26),
                          }}
                        >
                          {initials(participant.displayName)}
                        </Avatar>
                      </Badge>
                    </ListItemAvatar>

                    <ListItemText
                      primary={
                        <Stack
                          direction="row"
                          spacing={0.6}
                          alignItems="center"
                          flexWrap="wrap"
                          useFlexGap
                        >
                          <Typography variant="body2" sx={{ fontWeight: 700 }}>
                            {participant.displayName}
                          </Typography>
                          {participant.isLocal && (
                            <Chip size="small" label="You" variant="outlined" sx={{ height: 20 }} />
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

                    {!participant.isLocal && (
                      <IconButton
                        size="small"
                        onClick={() => props.onToggleRow(participant.identity)}
                      >
                        {expanded ? (
                          <KeyboardArrowUpIcon fontSize="small" />
                        ) : (
                          <KeyboardArrowDownIcon fontSize="small" />
                        )}
                      </IconButton>
                    )}
                  </Stack>

                  {!participant.isLocal && (
                    <Collapse in={expanded} unmountOnExit>
                      <Stack spacing={0.9} sx={{ mt: 0.9, pl: 0.15 }}>
                        <Box
                          sx={{
                            display: "grid",
                            alignItems: "center",
                            gridTemplateColumns: "58px minmax(0,1fr) 46px 30px",
                            gap: 0.8,
                          }}
                        >
                          <Typography variant="caption">Voice</Typography>
                          <Slider
                            min={0}
                            max={200}
                            step={5}
                            value={volumePercent(participant.voiceVolume)}
                            onChange={(_, value) => {
                              const next = Array.isArray(value) ? value[0] : value;
                              props.onSetChannelVolume(participant.identity, "voice", next / 100);
                            }}
                            sx={{ minWidth: 0 }}
                          />
                          <Typography variant="caption" sx={{ textAlign: "right" }}>
                            {volumePercent(participant.voiceVolume)}%
                          </Typography>
                          <IconButton
                            size="small"
                            color={participant.voiceMutedLocal ? "error" : "default"}
                            onClick={() =>
                              props.onSetChannelMuted(
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
                        </Box>

                        <Box
                          sx={{
                            display: "grid",
                            alignItems: "center",
                            gridTemplateColumns: "58px minmax(0,1fr) 46px 30px",
                            gap: 0.8,
                          }}
                        >
                          <Typography variant="caption">Stream</Typography>
                          <Slider
                            min={0}
                            max={200}
                            step={5}
                            value={volumePercent(participant.streamVolume)}
                            onChange={(_, value) => {
                              const next = Array.isArray(value) ? value[0] : value;
                              props.onSetChannelVolume(participant.identity, "stream", next / 100);
                            }}
                            sx={{ minWidth: 0 }}
                          />
                          <Typography variant="caption" sx={{ textAlign: "right" }}>
                            {volumePercent(participant.streamVolume)}%
                          </Typography>
                          <IconButton
                            size="small"
                            color={participant.streamMutedLocal ? "error" : "default"}
                            onClick={() =>
                              props.onSetChannelMuted(
                                participant.identity,
                                "stream",
                                !participant.streamMutedLocal,
                              )
                            }
                          >
                            {participant.streamMutedLocal ? (
                              <DesktopAccessDisabledIcon fontSize="small" />
                            ) : (
                              <DesktopWindowsIcon fontSize="small" />
                            )}
                          </IconButton>
                        </Box>

                        <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
                          <Button
                            size="small"
                            startIcon={<RestartAltIcon fontSize="small" />}
                            onClick={() => props.onResetParticipantAudio(participant.identity)}
                          >
                            Reset
                          </Button>
                        </Box>
                      </Stack>
                    </Collapse>
                  )}
                </ListItem>
              );
            })}
          </List>

          {props.remoteParticipantsCount === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ px: 0.8, py: 0.5 }}>
              Invite friends to unlock per-user voice and stream controls.
            </Typography>
          )}
        </Box>
      )}

      {props.tab === "chat" && (
        <Paper
          variant="outlined"
          sx={{
            p: 2,
            borderStyle: "dashed",
            textAlign: "center",
            bgcolor: alpha("#57c2ff", 0.08),
          }}
        >
          <Typography variant="body1" sx={{ fontWeight: 700 }}>
            Chat (soon)
          </Typography>
          <Typography variant="body2" color="text.secondary">
            This panel is reserved for upcoming room text chat.
          </Typography>
        </Paper>
      )}
    </Paper>
  );
}
