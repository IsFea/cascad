import FiberManualRecordIcon from "@mui/icons-material/FiberManualRecord";
import FullscreenExitIcon from "@mui/icons-material/FullscreenExit";
import { alpha } from "@mui/material/styles";
import { Avatar, Box, IconButton, Paper, Stack, Tooltip, Typography } from "@mui/material";
import { MouseEvent, useEffect, useRef } from "react";
import { VideoTrack } from "livekit-client";
import { ParticipantState } from "../types";
import { initials } from "../utils";

export function FullscreenStreamLayer(props: {
  track: VideoTrack;
  label: string;
  participants: ParticipantState[];
  onClose: () => void;
  onAvatarContextMenu: (event: MouseEvent<HTMLElement>, identity: string) => void;
}) {
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
    <Box
      onContextMenuCapture={(event) => {
        event.preventDefault();
      }}
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: 1450,
        bgcolor: "#000",
      }}
    >
      <Box
        component="video"
        ref={videoRef}
        autoPlay
        playsInline
        sx={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          display: "block",
          backgroundColor: "#000",
        }}
      />

      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        sx={{
          position: "absolute",
          top: 14,
          left: 14,
          bgcolor: "rgba(4, 10, 16, 0.82)",
          borderRadius: 2,
          px: 1,
          py: 0.6,
        }}
      >
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          {props.label}
        </Typography>
      </Stack>

      <Tooltip title="Exit fullscreen stream">
        <IconButton
          aria-label="Exit fullscreen stream"
          onClick={props.onClose}
          sx={{
            position: "absolute",
            top: 10,
            right: 12,
            bgcolor: "rgba(6, 11, 18, 0.82)",
            border: "1px solid rgba(128, 182, 219, 0.35)",
          }}
        >
          <FullscreenExitIcon />
        </IconButton>
      </Tooltip>

      <Paper
        sx={{
          position: "absolute",
          right: 12,
          top: 62,
          width: 54,
          maxHeight: "calc(100vh - 90px)",
          overflowY: "auto",
          p: 0.45,
          bgcolor: "rgba(8, 16, 24, 0.52)",
          borderColor: "rgba(123, 176, 209, 0.28)",
          backdropFilter: "blur(12px)",
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
                onContextMenu={(event) => props.onAvatarContextMenu(event, participant.identity)}
              >
                <Avatar
                  sx={{
                    width: 34,
                    height: 34,
                    fontSize: "0.72rem",
                    border: participant.isVoiceActive
                      ? "2px solid rgba(69, 214, 159, 0.95)"
                      : "2px solid rgba(121, 166, 205, 0.35)",
                    boxShadow: participant.isVoiceActive
                      ? "0 0 0 2px rgba(69, 214, 159, 0.26)"
                      : "none",
                    bgcolor: alpha("#57c2ff", 0.22),
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
                      fontSize: 9,
                      color: "#ff5252",
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
    </Box>
  );
}
