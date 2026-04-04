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
import { MouseEvent } from "react";
import { AudioChannel } from "../../roomState";
import { ParticipantAudioMenuState, ParticipantState } from "../types";
import { initials, volumePercent } from "../utils";

export function ParticipantsPanel(props: {
  participants: ParticipantState[];
  remoteParticipantsCount: number;
  collapsed: boolean;
  narrowMode: boolean;
  tab: "participants" | "chat";
  expandedRows: Record<string, boolean>;
  onTabChange: (value: "participants" | "chat") => void;
  onSetCollapsed: (value: boolean) => void;
  onToggleRow: (identity: string) => void;
  onSetChannelVolume: (identity: string, source: AudioChannel, value: number) => void;
  onSetChannelMuted: (identity: string, source: AudioChannel, mutedLocal: boolean) => void;
  onResetParticipantAudio: (identity: string) => void;
  onOpenParticipantMenu: (
    event: MouseEvent<HTMLElement>,
    identity: string,
    scope: ParticipantAudioMenuState["scope"],
  ) => void;
}) {
  if (props.collapsed) {
    return (
      <Paper
        sx={{
          p: 0.5,
          display: "grid",
          gap: 0.6,
          justifyItems: "center",
          alignContent: "start",
          height: "100%",
          minHeight: 0,
          overflowY: "auto",
          overflowX: "hidden",
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
                sx={{ position: "relative", display: "inline-flex", cursor: "context-menu" }}
                onClick={() => {
                  if (!props.narrowMode) {
                    props.onTabChange("participants");
                    props.onSetCollapsed(false);
                  }
                }}
                onContextMenu={(event) => {
                  if (participant.isLocal) {
                    return;
                  }
                  event.preventDefault();
                  event.stopPropagation();
                  props.onOpenParticipantMenu(event, participant.identity, "participant-rail");
                }}
              >
                <Avatar
                  sx={{
                    width: 34,
                    height: 34,
                    fontSize: "0.72rem",
                    bgcolor: alpha("#6ea4ff", 0.2),
                    border: participant.isVoiceActive
                      ? "2px solid rgba(86, 224, 147, 0.95)"
                      : "2px solid rgba(87, 109, 136, 0.68)",
                    boxShadow: participant.isVoiceActive
                      ? "0 0 0 2px rgba(86, 224, 147, 0.2)"
                      : "none",
                  }}
                >
                  {initials(participant.displayName)}
                </Avatar>
                {participant.isScreenSharing && (
                  <FiberManualRecordIcon
                    sx={{
                      position: "absolute",
                      right: -2,
                      bottom: -2,
                      fontSize: 10,
                      color: "#ff5555",
                      bgcolor: "#0d1117",
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
    <Paper
      sx={{
        p: 1,
        width: "100%",
        height: "100%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
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
            sx={{ minHeight: 36, textTransform: "none", px: 0.9 }}
          />
          <Tab
            icon={<ForumIcon fontSize="small" />}
            iconPosition="start"
            label="Chat"
            value="chat"
            sx={{ minHeight: 36, textTransform: "none", px: 0.9 }}
          />
        </Tabs>
      </Stack>

      <Divider sx={{ my: 0.8 }} />

      <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", pr: 0.2 }}>
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
                    onContextMenu={(event) => {
                      if (participant.isLocal) {
                        return;
                      }
                      event.preventDefault();
                      event.stopPropagation();
                      props.onOpenParticipantMenu(event, participant.identity, "normal");
                    }}
                    sx={{
                      display: "block",
                      p: 0.75,
                      mb: 0.65,
                      borderRadius: 1.5,
                      border: participant.isVoiceActive
                        ? "1px solid rgba(86, 224, 147, 0.85)"
                        : "1px solid rgba(94, 114, 139, 0.4)",
                      boxShadow: participant.isVoiceActive
                        ? "0 0 0 1px rgba(86, 224, 147, 0.16)"
                        : "0 4px 10px rgba(6, 12, 18, 0.28)",
                      bgcolor: alpha("#101723", 0.75),
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
                              bgcolor: alpha("#6ea4ff", 0.25),
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
                              gridTemplateColumns: "58px minmax(0,1fr) 46px 28px",
                              gap: 0.7,
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
                              sx={{ minWidth: 0, px: 0.5 }}
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
                              gridTemplateColumns: "58px minmax(0,1fr) 46px 28px",
                              gap: 0.7,
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
                              sx={{ minWidth: 0, px: 0.5 }}
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
              bgcolor: alpha("#5fa9ff", 0.06),
            }}
          >
            <Typography variant="body1" sx={{ fontWeight: 700 }}>
              Chat (soon)
            </Typography>
            <Typography variant="body2" color="text.secondary">
              This area is reserved for upcoming room text chat.
            </Typography>
          </Paper>
        )}
      </Box>
    </Paper>
  );
}
