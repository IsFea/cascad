import { alpha } from "@mui/material/styles";
import { Box, Chip, Paper, Stack, Typography } from "@mui/material";
import { MouseEvent, useEffect, useMemo, useState } from "react";
import {
  computeFilmstripPageSize,
  computeGridPageSize,
  paginateItems,
  shouldCenterFilmstrip,
  StreamLayoutMode,
} from "../../roomState";
import { ParticipantState, ScreenTrackState } from "../types";
import { clampNumber, useElementSize } from "../utils";
import { PaginationControls } from "./PaginationControls";
import { ScreenTile } from "./ScreenTile";

export function StreamStage(props: {
  participantMap: Map<string, ParticipantState>;
  visibleScreenTracks: ScreenTrackState[];
  hiddenStreamIdentities: string[];
  totalStreamsCount: number;
  layoutMode: StreamLayoutMode;
  effectiveStreamMode: "grid" | "focus";
  focusedStreamSid: string | null;
  focusedScreenTrack: ScreenTrackState | null;
  secondaryFocusTracks: ScreenTrackState[];
  onSetFocus: (sid: string) => void;
  onHideStream: (identity: string) => void;
  onRestoreStream: (identity: string) => void;
  onOpenFullscreen: (sid: string) => void;
  onOpenStreamContextMenu: (
    event: MouseEvent<HTMLElement>,
    track: ScreenTrackState,
  ) => void;
}) {
  const [gridPage, setGridPage] = useState(1);
  const [focusStripPage, setFocusStripPage] = useState(1);
  const [gridViewportRef, gridViewportSize] = useElementSize<HTMLDivElement>();
  const [focusStripRef, focusStripSize] = useElementSize<HTMLDivElement>();

  const gridPageSize = useMemo(() => {
    return computeGridPageSize(
      gridViewportSize.width,
      gridViewportSize.height > 0 ? gridViewportSize.height : 520,
    );
  }, [gridViewportSize.height, gridViewportSize.width]);

  const gridColumns = useMemo(() => {
    const width = gridViewportSize.width > 0 ? gridViewportSize.width : 960;
    return Math.max(1, Math.floor(width / 280));
  }, [gridViewportSize.width]);

  const gridPagination = useMemo(() => {
    return paginateItems(props.visibleScreenTracks, gridPage, gridPageSize);
  }, [gridPage, gridPageSize, props.visibleScreenTracks]);

  useEffect(() => {
    if (gridPage !== gridPagination.currentPage) {
      setGridPage(gridPagination.currentPage);
    }
  }, [gridPage, gridPagination.currentPage]);

  const focusStripPageSize = useMemo(() => {
    return computeFilmstripPageSize(focusStripSize.width > 0 ? focusStripSize.width : 960);
  }, [focusStripSize.width]);

  const focusStripPagination = useMemo(() => {
    return paginateItems(props.secondaryFocusTracks, focusStripPage, focusStripPageSize);
  }, [focusStripPage, focusStripPageSize, props.secondaryFocusTracks]);

  useEffect(() => {
    if (focusStripPage !== focusStripPagination.currentPage) {
      setFocusStripPage(focusStripPagination.currentPage);
    }
  }, [focusStripPage, focusStripPagination.currentPage]);

  const focusTileWidth = useMemo(() => {
    const visibleCount = Math.max(1, focusStripPagination.items.length);
    const width = focusStripSize.width > 0 ? focusStripSize.width : 960;
    const totalGap = (visibleCount - 1) * 8;
    const raw = (width - totalGap) / visibleCount;
    return clampNumber(Math.floor(raw), 132, 220);
  }, [focusStripPagination.items.length, focusStripSize.width]);

  const renderStreamTile = (item: ScreenTrackState, options?: { compact?: boolean }) => {
    const participant = props.participantMap.get(item.participantIdentity);
    const label = participant?.displayName ?? item.participantIdentity;
    const isScreenAudioActive = participant?.isScreenAudioActive ?? false;

    return (
      <ScreenTile
        key={item.sid}
        track={item.track}
        label={label}
        isFocused={item.sid === props.focusedStreamSid}
        isScreenAudioActive={isScreenAudioActive}
        compact={options?.compact}
        onClick={() => props.onSetFocus(item.sid)}
        onHide={() => props.onHideStream(item.participantIdentity)}
        onFullscreen={() => props.onOpenFullscreen(item.sid)}
        onContextMenu={(event) => props.onOpenStreamContextMenu(event, item)}
      />
    );
  };

  return (
    <Paper sx={{ p: 2 }} onContextMenuCapture={suppressStreamNativeMenu}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1}
        justifyContent="space-between"
        alignItems={{ xs: "flex-start", sm: "center" }}
        sx={{ mb: 1.5 }}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Streams
          </Typography>
          <Chip
            label={`Visible ${props.visibleScreenTracks.length} / Total ${props.totalStreamsCount}`}
            size="small"
            color={props.visibleScreenTracks.length > 0 ? "primary" : "default"}
            variant={props.visibleScreenTracks.length > 0 ? "filled" : "outlined"}
          />
        </Stack>

        <Chip
          size="small"
          variant="outlined"
          label={
            props.layoutMode === "theater"
              ? `Theater (${props.effectiveStreamMode})`
              : props.effectiveStreamMode === "focus"
                ? "Focus"
                : "Grid"
          }
        />
      </Stack>

      {props.hiddenStreamIdentities.length > 0 && (
        <Stack direction="row" spacing={0.8} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
          <Typography variant="caption" color="text.secondary" sx={{ alignSelf: "center" }}>
            Hidden streams:
          </Typography>
          {props.hiddenStreamIdentities.map((identity) => {
            const participant = props.participantMap.get(identity);
            const label = participant?.displayName ?? identity;
            return (
              <Chip
                key={identity}
                label={label}
                onClick={() => props.onRestoreStream(identity)}
                variant="outlined"
                size="small"
              />
            );
          })}
        </Stack>
      )}

      {props.visibleScreenTracks.length === 0 && (
        <Paper
          variant="outlined"
          sx={{
            borderStyle: "dashed",
            p: 3,
            textAlign: "center",
            bgcolor: alpha("#57c2ff", 0.08),
          }}
        >
          <Typography variant="body1" sx={{ mb: 0.5 }}>
            No visible streams right now.
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Start sharing or restore hidden streams from chips above.
          </Typography>
        </Paper>
      )}

      {props.visibleScreenTracks.length > 0 && props.effectiveStreamMode === "grid" && (
        <Box
          ref={gridViewportRef}
          sx={{
            minHeight: 330,
            height: { xs: "auto", md: "calc(100vh - 320px)" },
            maxHeight: "calc(100vh - 250px)",
            overflow: "hidden",
            display: "grid",
            gridTemplateColumns: `repeat(${Math.min(
              Math.max(1, gridPagination.items.length),
              gridColumns,
            )}, minmax(0, 1fr))`,
            gap: 1.2,
            alignContent: "start",
          }}
        >
          {gridPagination.items.map((item) => renderStreamTile(item))}
        </Box>
      )}

      {props.visibleScreenTracks.length > 0 && props.effectiveStreamMode === "grid" && (
        <PaginationControls
          page={gridPagination.currentPage}
          totalPages={gridPagination.totalPages}
          onPrev={() => setGridPage((current) => current - 1)}
          onNext={() => setGridPage((current) => current + 1)}
        />
      )}

      {props.visibleScreenTracks.length > 0 && props.effectiveStreamMode === "focus" && (
        <Stack spacing={1}>
          {props.focusedScreenTrack && (
            <Box
              sx={{
                maxHeight: { xs: "52vh", md: "calc(100vh - 365px)" },
                overflow: "hidden",
              }}
            >
              {renderStreamTile(props.focusedScreenTrack)}
            </Box>
          )}

          {props.secondaryFocusTracks.length > 0 && (
            <Box>
              <Box
                ref={focusStripRef}
                sx={{
                  display: "flex",
                  gap: 1,
                  justifyContent: shouldCenterFilmstrip(
                    focusStripPagination.items.length,
                    focusStripPageSize,
                  )
                    ? "center"
                    : "flex-start",
                  alignItems: "start",
                  minHeight: 92,
                  maxHeight: 116,
                  overflow: "hidden",
                }}
              >
                {focusStripPagination.items.map((item) => (
                  <Box
                    key={item.sid}
                    sx={{
                      width: focusTileWidth,
                      flex: `0 0 ${focusTileWidth}px`,
                      maxWidth: focusTileWidth,
                    }}
                  >
                    {renderStreamTile(item, { compact: true })}
                  </Box>
                ))}
              </Box>

              <PaginationControls
                compact
                page={focusStripPagination.currentPage}
                totalPages={focusStripPagination.totalPages}
                onPrev={() => setFocusStripPage((current) => current - 1)}
                onNext={() => setFocusStripPage((current) => current + 1)}
              />
            </Box>
          )}
        </Stack>
      )}
    </Paper>
  );
}
  const suppressStreamNativeMenu = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };
