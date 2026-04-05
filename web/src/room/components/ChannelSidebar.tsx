import AddIcon from "@mui/icons-material/Add";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import GraphicEqRoundedIcon from "@mui/icons-material/GraphicEqRounded";
import HeadsetOffIcon from "@mui/icons-material/HeadsetOff";
import HeadsetIcon from "@mui/icons-material/Headset";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import LogoutIcon from "@mui/icons-material/Logout";
import MicIcon from "@mui/icons-material/Mic";
import MicOffIcon from "@mui/icons-material/MicOff";
import ScreenShareIcon from "@mui/icons-material/ScreenShare";
import SettingsIcon from "@mui/icons-material/Settings";
import StopScreenShareIcon from "@mui/icons-material/StopScreenShare";
import { MouseEvent } from "react";
import TagIcon from "@mui/icons-material/Tag";
import VolumeUpOutlinedIcon from "@mui/icons-material/VolumeUpOutlined";
import { alpha } from "@mui/material/styles";
import {
  Avatar,
  Badge,
  Box,
  Button,
  Divider,
  IconButton,
  List,
  ListItemAvatar,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { getSafeImageUrl, markImageUrlBroken } from "../../imageUrlFallback";
import { ChannelDto, UserDto, WorkspaceMemberDto } from "../../types";
import { resolveVoiceStatusIndicator } from "../../voicePresence";
import { initials } from "../utils";

export function ChannelSidebar(props: {
  workspaceName: string;
  workspaceUnreadCount: number;
  currentUser: UserDto;
  currentAvatarUrl: string | null;
  textChannels: ChannelDto[];
  textChannelUnreadCounts: Record<string, number>;
  voiceChannels: ChannelDto[];
  members: WorkspaceMemberDto[];
  speakingUserIds: Set<string>;
  selectedTextChannelId: string | null;
  selectedVoiceChannelId: string | null;
  connectedVoiceChannelId: string | null;
  voiceTabMode: "idle" | "active" | "secondary";
  selfMuted: boolean;
  selfDeafened: boolean;
  canManageChannels: boolean;
  pendingApprovalsCount: number;
  onSelectVoiceChannel: (channelId: string) => void;
  onConnectVoiceChannel: (channelId: string) => void;
  onSelectTextChannel: (channelId: string) => void;
  onCreateChannel: (type: "Text" | "Voice") => void;
  onOpenServerSettings: () => void;
  onToggleSelfMute: () => void;
  onToggleSelfDeafen: () => void;
  onToggleShare: () => void;
  onOpenVoiceSettings: () => void;
  onDisconnectVoice: () => void;
  onTakeOverVoice: () => void;
  onPickAvatar: () => void;
  onLogout: () => void;
  onParticipantContextMenu: (
    event: MouseEvent<HTMLElement>,
    payload: {
      channelId: string;
      userId: string;
    },
  ) => void;
  sharing: boolean;
  shareEnabled: boolean;
}) {
  const membersByVoiceChannel = props.voiceChannels.reduce<Record<string, WorkspaceMemberDto[]>>(
    (acc, channel) => {
      acc[channel.id] = props.members.filter(
        (member) => member.connectedVoiceChannelId === channel.id,
      );
      return acc;
    },
    {},
  );

  const connectedVoiceName =
    props.voiceChannels.find((channel) => channel.id === props.connectedVoiceChannelId)?.name ??
    null;

  return (
    <Paper
      sx={{
        p: 1.1,
        height: "100%",
        minHeight: 0,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
        <Stack direction="row" spacing={0.7} alignItems="center" sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }} noWrap>
            {props.workspaceName}
          </Typography>
          {props.workspaceUnreadCount > 0 && (
            <Box
              sx={{
                minWidth: 18,
                height: 18,
                px: 0.6,
                borderRadius: 99,
                display: "grid",
                placeItems: "center",
                bgcolor: "rgba(241, 109, 127, 0.22)",
                border: "1px solid rgba(241, 109, 127, 0.45)",
                color: "error.light",
                fontSize: "0.67rem",
                fontWeight: 700,
              }}
            >
              {props.workspaceUnreadCount > 99 ? "99+" : props.workspaceUnreadCount}
            </Box>
          )}
        </Stack>
        {props.currentUser.role === "Admin" && (
          <Tooltip title="Server settings">
            <IconButton size="small" aria-label="Server settings" onClick={props.onOpenServerSettings}>
              <Badge
                color="error"
                variant={props.pendingApprovalsCount > 0 ? "dot" : "standard"}
                overlap="circular"
              >
                <SettingsIcon fontSize="small" />
              </Badge>
            </IconButton>
          </Tooltip>
        )}
      </Stack>

      <Divider sx={{ my: 1 }} />

      <Box className="app-scrollbar" sx={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{ px: 0.7, pb: 0.45 }}
        >
          <Typography
            variant="caption"
            sx={{
              color: "text.secondary",
              display: "block",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            Voice channels
          </Typography>
          {props.canManageChannels && (
            <IconButton
              size="small"
              aria-label="Create voice channel"
              onClick={() => props.onCreateChannel("Voice")}
            >
              <AddIcon fontSize="small" />
            </IconButton>
          )}
        </Stack>
        <List dense disablePadding>
          {props.voiceChannels.map((channel) => {
            const isConnected = props.connectedVoiceChannelId === channel.id;
            const isOutlined = isConnected;
            const participants = membersByVoiceChannel[channel.id] ?? [];
            const maxParticipantsLabel = channel.maxParticipants ?? "∞";
            const isSecondaryConnected = isConnected && props.voiceTabMode === "secondary";

            return (
              <Box
                key={channel.id}
                sx={{
                  borderRadius: 1.4,
                  mb: 0.45,
                  px: 0.35,
                  pt: 0.3,
                  pb: participants.length > 0 ? 0.35 : 0.2,
                  border: isOutlined ? `1px solid ${alpha("#6da7ff", 0.55)}` : "1px solid transparent",
                  bgcolor: isOutlined ? alpha("#6da7ff", 0.07) : "transparent",
                  boxShadow: isOutlined
                    ? `0 0 0 1px ${alpha("#6da7ff", 0.14)} inset, 0 6px 12px ${alpha("#10213e", 0.26)}`
                    : "none",
                  transition: "border-color 130ms ease, background-color 130ms ease, box-shadow 130ms ease",
                }}
              >
                <ListItemButton
                  selected={props.selectedVoiceChannelId === channel.id}
                  onClick={() => {
                    props.onSelectVoiceChannel(channel.id);
                    props.onConnectVoiceChannel(channel.id);
                  }}
                  sx={{
                    borderRadius: 1.2,
                    mb: 0,
                    "&.Mui-selected": {
                      bgcolor: alpha("#6da7ff", 0.16),
                    },
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 30 }}>
                    <VolumeUpOutlinedIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText
                    primary={channel.name}
                    secondary={
                      isSecondaryConnected
                        ? "Connected in another tab"
                        : isConnected
                          ? "Connected"
                          : undefined
                    }
                    primaryTypographyProps={{ fontSize: "0.89rem", fontWeight: 600 }}
                    secondaryTypographyProps={{ fontSize: "0.72rem" }}
                  />
                  <Typography variant="caption" color="text.secondary" sx={{ ml: 0.8 }}>
                    ({participants.length}/{maxParticipantsLabel})
                  </Typography>
                </ListItemButton>

                {participants.length > 0 && (
                  <List dense disablePadding sx={{ ml: 2.45, mt: 0.2, mb: 0 }}>
                    {participants.map((participant) => {
                      const isSpeaking = props.speakingUserIds.has(participant.userId);
                      const isScreenSharing = participant.isScreenSharing;
                      const voiceStatusIndicator = resolveVoiceStatusIndicator(participant);
                      return (
                        <ListItemButton
                          key={`${channel.id}-${participant.userId}`}
                          sx={{
                            borderRadius: 1,
                            mb: 0.2,
                            py: 0.2,
                            px: 0.6,
                            minHeight: 28,
                            "&:hover": {
                              bgcolor: alpha("#8ab8ff", 0.08),
                            },
                          }}
                          onContextMenu={(event) => {
                            if (participant.userId === props.currentUser.id) {
                              return;
                            }
                            event.preventDefault();
                            event.stopPropagation();
                            props.onParticipantContextMenu(event, {
                              channelId: channel.id,
                              userId: participant.userId,
                            });
                          }}
                        >
                          <ListItemAvatar sx={{ minWidth: 26 }}>
                            <Avatar
                              src={getSafeImageUrl(participant.avatarUrl)}
                              imgProps={{
                                onError: () => {
                                  markImageUrlBroken(participant.avatarUrl);
                                },
                              }}
                              sx={{
                                width: 18,
                                height: 18,
                                fontSize: "0.56rem",
                                border: isSpeaking
                                  ? "2px solid rgba(86, 224, 147, 0.95)"
                                  : "2px solid rgba(94, 116, 141, 0.6)",
                              }}
                            >
                              {initials(participant.username)}
                            </Avatar>
                          </ListItemAvatar>
                          <ListItemText
                            primary={
                              <Stack direction="row" spacing={0.4} alignItems="center" sx={{ minWidth: 0 }}>
                                <Typography
                                  component="span"
                                  sx={{
                                    fontSize: "0.73rem",
                                    color: isSpeaking ? "secondary.main" : "text.secondary",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {participant.username}
                                </Typography>
                                {isScreenSharing && (
                                  <Tooltip title="Screen sharing">
                                    <Box
                                      component="span"
                                      sx={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        color: "secondary.light",
                                      }}
                                    >
                                      <ScreenShareIcon sx={{ fontSize: 13 }} />
                                    </Box>
                                  </Tooltip>
                                )}
                                {voiceStatusIndicator && (
                                  <Tooltip title={voiceStatusIndicator.tooltip}>
                                    <Box
                                      component="span"
                                      sx={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        color:
                                          voiceStatusIndicator.kind === "deafened"
                                            ? "warning.light"
                                            : "error.light",
                                      }}
                                    >
                                      {voiceStatusIndicator.kind === "deafened" ? (
                                        <HeadsetOffIcon sx={{ fontSize: 13 }} />
                                      ) : (
                                        <MicOffIcon sx={{ fontSize: 13 }} />
                                      )}
                                    </Box>
                                  </Tooltip>
                                )}
                              </Stack>
                            }
                            primaryTypographyProps={{
                              component: "div",
                            }}
                          />
                        </ListItemButton>
                      );
                    })}
                  </List>
                )}
              </Box>
            );
          })}
        </List>

        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{ px: 0.7, pt: 1, pb: 0.45 }}
        >
          <Typography
            variant="caption"
            sx={{
              color: "text.secondary",
              display: "block",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            Text channels
          </Typography>
          {props.canManageChannels && (
            <IconButton
              size="small"
              aria-label="Create text channel"
              onClick={() => props.onCreateChannel("Text")}
            >
              <AddIcon fontSize="small" />
            </IconButton>
          )}
        </Stack>
        <List dense disablePadding>
          {props.textChannels.map((channel) => {
            const unreadCount = props.textChannelUnreadCounts[channel.id] ?? 0;
            return (
              <ListItemButton
                key={channel.id}
                selected={props.selectedTextChannelId === channel.id}
                onClick={() => props.onSelectTextChannel(channel.id)}
                sx={{
                  borderRadius: 1.2,
                  mb: 0.3,
                  "&.Mui-selected": {
                    bgcolor: alpha("#6da7ff", 0.12),
                  },
                }}
              >
                <ListItemIcon sx={{ minWidth: 30 }}>
                  {channel.position === 1 ? <ChatBubbleOutlineIcon fontSize="small" /> : <TagIcon fontSize="small" />}
                </ListItemIcon>
                <ListItemText
                  primary={channel.name}
                  primaryTypographyProps={{ fontSize: "0.86rem" }}
                />
                {unreadCount > 0 && (
                  <Box
                    sx={{
                      minWidth: 16,
                      px: 0.55,
                      py: 0.12,
                      borderRadius: 99,
                      bgcolor: "rgba(241, 109, 127, 0.18)",
                      border: "1px solid rgba(241, 109, 127, 0.42)",
                      color: "error.light",
                      fontWeight: 700,
                      fontSize: "0.64rem",
                      lineHeight: 1.2,
                    }}
                  >
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </Box>
                )}
              </ListItemButton>
            );
          })}
        </List>
      </Box>

      <Divider sx={{ my: 1 }} />

      {props.connectedVoiceChannelId && props.voiceTabMode === "active" && (
        <Box
          sx={{
            px: 0.8,
            py: 0.75,
            borderRadius: 1.2,
            bgcolor: alpha("#52d29b", 0.12),
            border: "1px solid rgba(82, 210, 155, 0.38)",
            mb: 0.8,
          }}
        >
          <Stack direction="row" spacing={0.7} alignItems="center" sx={{ mb: 0.65 }}>
            <GraphicEqRoundedIcon sx={{ color: "secondary.main", fontSize: 16 }} />
            <Typography variant="caption" sx={{ fontWeight: 700 }}>
              Voice connected
            </Typography>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.8 }}>
            {connectedVoiceName ?? "Voice channel"}
          </Typography>
          <Stack direction="row" spacing={0.45}>
            <Tooltip
              title={
                props.selfDeafened && props.selfMuted
                  ? "Undeafen to unmute"
                  : props.selfMuted
                    ? "Unmute"
                    : "Mute"
              }
            >
              <IconButton
                size="small"
                aria-label={props.selfMuted ? "Unmute" : "Mute"}
                onClick={props.onToggleSelfMute}
                disabled={props.selfDeafened && props.selfMuted}
              >
                {props.selfMuted ? <MicOffIcon fontSize="small" color="error" /> : <MicIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
            <Tooltip title={props.selfDeafened ? "Undeafen" : "Deafen"}>
              <IconButton
                size="small"
                aria-label={props.selfDeafened ? "Undeafen" : "Deafen"}
                onClick={props.onToggleSelfDeafen}
              >
                {props.selfDeafened ? (
                  <HeadsetOffIcon fontSize="small" color="error" />
                ) : (
                  <HeadsetIcon fontSize="small" />
                )}
              </IconButton>
            </Tooltip>
            <Tooltip title={props.sharing ? "Stop share" : "Share screen"}>
              <IconButton
                size="small"
                aria-label={props.sharing ? "Stop share" : "Share screen"}
                onClick={props.onToggleShare}
                disabled={!props.shareEnabled}
              >
                {props.sharing ? (
                  <StopScreenShareIcon fontSize="small" color="error" />
                ) : (
                  <ScreenShareIcon fontSize="small" />
                )}
              </IconButton>
            </Tooltip>
            <Tooltip title="Voice settings">
              <IconButton
                size="small"
                aria-label="Voice settings"
                onClick={props.onOpenVoiceSettings}
              >
                <SettingsIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Leave voice">
              <IconButton
                size="small"
                aria-label="Leave voice"
                onClick={props.onDisconnectVoice}
                sx={{
                  color: "error.light",
                  bgcolor: alpha("#f16d7f", 0.14),
                  "&:hover": {
                    bgcolor: alpha("#f16d7f", 0.24),
                  },
                }}
              >
                <LogoutIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        </Box>
      )}

      {props.connectedVoiceChannelId && props.voiceTabMode === "secondary" && (
        <Box
          sx={{
            px: 0.8,
            py: 0.9,
            borderRadius: 1.2,
            bgcolor: alpha("#a2a9b5", 0.12),
            border: "1px solid rgba(162, 169, 181, 0.35)",
            mb: 0.8,
          }}
        >
          <Stack direction="row" spacing={0.7} alignItems="center" sx={{ mb: 0.65 }}>
            <LockOutlinedIcon sx={{ color: "text.secondary", fontSize: 16 }} />
            <Typography variant="caption" sx={{ fontWeight: 700 }}>
              Voice is active in another tab
            </Typography>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.9 }}>
            Use takeover to move this voice session here.
          </Typography>
          <Button size="small" variant="contained" onClick={props.onTakeOverVoice}>
            Take over
          </Button>
        </Box>
      )}

      <Stack
        direction="row"
        spacing={0.8}
        alignItems="center"
        sx={{
          borderRadius: 1.2,
          p: 0.7,
          bgcolor: alpha("#8cb3f4", 0.1),
          border: "1px solid rgba(131, 153, 183, 0.33)",
        }}
      >
        <Tooltip title="Update avatar">
          <IconButton
            size="small"
            sx={{ p: 0 }}
            aria-label="Update avatar"
            onClick={props.onPickAvatar}
          >
            <Avatar
              src={getSafeImageUrl(props.currentAvatarUrl)}
              imgProps={{
                onError: () => {
                  markImageUrlBroken(props.currentAvatarUrl);
                },
              }}
              sx={{ width: 30, height: 30 }}
            >
              {initials(props.currentUser.username)}
            </Avatar>
          </IconButton>
        </Tooltip>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="body2" noWrap sx={{ fontWeight: 700 }}>
            {props.currentUser.username}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap>
            {props.currentUser.role}
          </Typography>
        </Box>
        <Tooltip title="Logout">
          <IconButton size="small" aria-label="Logout" onClick={props.onLogout}>
            <LogoutIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
    </Paper>
  );
}
