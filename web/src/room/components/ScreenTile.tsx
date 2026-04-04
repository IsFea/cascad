import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import GraphicEqIcon from "@mui/icons-material/GraphicEq";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import { Box, Chip, IconButton, Paper, Stack, Tooltip, Typography } from "@mui/material";
import { MouseEvent, useEffect, useRef } from "react";
import { VideoTrack } from "livekit-client";
import { STREAM_VIDEO_OBJECT_FIT } from "../../roomState";

export function ScreenTile(props: {
  track: VideoTrack;
  label: string;
  isFocused: boolean;
  isScreenAudioActive: boolean;
  compact?: boolean;
  onClick: () => void;
  onHide: () => void;
  onFullscreen: () => void;
  onContextMenu: (event: MouseEvent<HTMLElement>) => void;
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

  const suppressNativeMenuOnly = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
  };

  return (
    <Paper
      onClick={props.onClick}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        props.onContextMenu(event);
      }}
      onContextMenuCapture={suppressNativeMenuOnly}
      sx={{
        position: "relative",
        overflow: "hidden",
        cursor: "pointer",
        border: props.isScreenAudioActive
          ? "1px solid rgba(69, 214, 159, 0.98)"
          : props.isFocused
            ? "1px solid rgba(120, 189, 255, 0.8)"
            : "1px solid rgba(96, 118, 145, 0.4)",
        boxShadow: props.isScreenAudioActive
          ? "0 0 0 2px rgba(69, 214, 159, 0.34)"
          : props.isFocused
            ? "0 0 0 2px rgba(120, 189, 255, 0.22)"
            : "none",
        transition: "border-color 180ms ease, box-shadow 180ms ease",
        "&:hover .tile-actions": {
          opacity: 1,
        },
      }}
    >
      <Box
        component="video"
        ref={videoRef}
        autoPlay
        playsInline
        onContextMenuCapture={suppressNativeMenuOnly}
        sx={{
          width: "100%",
          aspectRatio: "16 / 9",
          display: "block",
          backgroundColor: "#000",
          objectFit: STREAM_VIDEO_OBJECT_FIT,
        }}
      />

      <Stack
        direction="row"
        spacing={0.8}
        alignItems="center"
        sx={{
          position: "absolute",
          left: props.compact ? 6 : 8,
          bottom: props.compact ? 6 : 8,
          bgcolor: "rgba(4, 10, 16, 0.82)",
          borderRadius: 2,
          px: props.compact ? 0.8 : 1,
          py: props.compact ? 0.25 : 0.45,
          maxWidth: props.compact ? "84%" : "92%",
        }}
      >
        <Typography
          variant={props.compact ? "caption" : "body2"}
          sx={{ fontWeight: 700, maxWidth: props.compact ? 96 : 190 }}
          noWrap
        >
          {props.label}
        </Typography>
        {props.isScreenAudioActive && !props.compact && (
          <Chip
            size="small"
            color="secondary"
            icon={<GraphicEqIcon fontSize="small" />}
            label="Audio"
            sx={{ height: 20 }}
          />
        )}
        {props.isScreenAudioActive && props.compact && (
          <GraphicEqIcon sx={{ fontSize: 14, color: "secondary.main" }} />
        )}
      </Stack>

      <Stack
        className="tile-actions"
        direction="row"
        spacing={0.4}
        sx={{
          position: "absolute",
          top: props.compact ? 6 : 8,
          right: props.compact ? 6 : 8,
          opacity: props.compact ? 0 : 1,
          transition: "opacity 160ms ease",
        }}
      >
        <Tooltip title="Fullscreen stream">
          <IconButton
            size="small"
            onClick={(event) => {
              event.stopPropagation();
              props.onFullscreen();
            }}
            sx={{
              bgcolor: "rgba(6, 11, 18, 0.84)",
              border: "1px solid rgba(128, 182, 219, 0.35)",
              width: props.compact ? 24 : 30,
              height: props.compact ? 24 : 30,
            }}
          >
            <OpenInFullIcon sx={{ fontSize: props.compact ? 15 : 18 }} />
          </IconButton>
        </Tooltip>

        <Tooltip title="Hide this stream locally">
          <IconButton
            size="small"
            onClick={(event) => {
              event.stopPropagation();
              props.onHide();
            }}
            sx={{
              bgcolor: "rgba(6, 11, 18, 0.84)",
              border: "1px solid rgba(128, 182, 219, 0.35)",
              width: props.compact ? 24 : 30,
              height: props.compact ? 24 : 30,
            }}
          >
            <VisibilityOffIcon sx={{ fontSize: props.compact ? 15 : 18 }} />
          </IconButton>
        </Tooltip>
      </Stack>
    </Paper>
  );
}
