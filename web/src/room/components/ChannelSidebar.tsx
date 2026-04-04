import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ForumOutlinedIcon from "@mui/icons-material/ForumOutlined";
import GraphicEqIcon from "@mui/icons-material/GraphicEq";
import TagIcon from "@mui/icons-material/Tag";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import { alpha } from "@mui/material/styles";
import {
  Box,
  Divider,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";

export function ChannelSidebar(props: {
  collapsed: boolean;
  narrowMode: boolean;
  activeVoiceChannelId: string;
  activeTextChannelId: string;
  onToggleCollapsed: () => void;
  onSelectVoiceChannel: (channelId: string) => void;
  onSelectTextChannel: (channelId: string) => void;
}) {
  const voiceChannels = [{ id: "voice-main", name: "Squad room" }];
  const textChannels = [
    { id: "chat-general", name: "general", soon: true },
    { id: "chat-team", name: "team-chat", soon: true },
  ];

  if (props.collapsed) {
    return (
      <Paper
        sx={{
          p: 0.6,
          height: "100%",
          minHeight: 0,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 0.8,
          alignItems: "center",
        }}
      >
        {!props.narrowMode && (
          <Tooltip title="Expand sidebar" placement="right">
            <IconButton size="small" onClick={props.onToggleCollapsed}>
              <ChevronRightIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}

        <Tooltip title="Voice channel" placement="right">
          <IconButton
            size="small"
            color="primary"
            onClick={() => props.onSelectVoiceChannel("voice-main")}
          >
            <VolumeUpIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <Tooltip title="Text channels (soon)" placement="right">
          <IconButton
            size="small"
            onClick={() => props.onSelectTextChannel("chat-general")}
          >
            <ForumOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Paper>
    );
  }

  return (
    <Paper
      sx={{
        p: 1,
        height: "100%",
        minHeight: 0,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Stack direction="row" spacing={0.8} alignItems="center">
          <GraphicEqIcon color="primary" fontSize="small" />
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            Workspace
          </Typography>
        </Stack>
        {!props.narrowMode && (
          <Tooltip title="Collapse sidebar">
            <IconButton size="small" onClick={props.onToggleCollapsed}>
              <ChevronLeftIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Stack>

      <Divider sx={{ my: 1 }} />

      <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <Typography
          variant="caption"
          sx={{
            px: 1,
            py: 0.5,
            color: "text.secondary",
            display: "block",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          Voice channels
        </Typography>
        <List dense disablePadding>
          {voiceChannels.map((channel) => (
            <ListItemButton
              key={channel.id}
              selected={props.activeVoiceChannelId === channel.id}
              onClick={() => props.onSelectVoiceChannel(channel.id)}
              sx={{
                borderRadius: 1.2,
                mb: 0.3,
                "&.Mui-selected": {
                  bgcolor: alpha("#6da7ff", 0.15),
                },
              }}
            >
              <ListItemIcon sx={{ minWidth: 30 }}>
                <VolumeUpIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText
                primary={channel.name}
                secondary="Active now"
                primaryTypographyProps={{ fontSize: "0.88rem", fontWeight: 600 }}
              />
            </ListItemButton>
          ))}
        </List>

        <Typography
          variant="caption"
          sx={{
            px: 1,
            pt: 1.1,
            pb: 0.5,
            color: "text.secondary",
            display: "block",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          Text channels
        </Typography>
        <List dense disablePadding>
          {textChannels.map((channel) => (
            <ListItemButton
              key={channel.id}
              selected={props.activeTextChannelId === channel.id}
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
                {channel.id === "chat-general" ? (
                  <ChatBubbleOutlineIcon fontSize="small" />
                ) : (
                  <TagIcon fontSize="small" />
                )}
              </ListItemIcon>
              <ListItemText
                primary={channel.name}
                secondary={channel.soon ? "Soon" : undefined}
                primaryTypographyProps={{ fontSize: "0.86rem" }}
              />
            </ListItemButton>
          ))}
        </List>
      </Box>
    </Paper>
  );
}
