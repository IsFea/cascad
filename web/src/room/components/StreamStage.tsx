import { alpha } from "@mui/material/styles";
import { Box, Chip, Paper, Stack, Typography } from "@mui/material";
import { MouseEvent, useEffect, useMemo, useState } from "react";
import {
  computeFilmstripPageSize,
  computeGridGeometry,
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
      gridViewportSize.width > 0 ? gridViewportSize.width : 960,
      gridViewportSize.height > 0 ? gridViewportSize.height : 560,
    );
  }, [gridViewportSize.height, gridViewportSize.width]);

  const gridPagination = useMemo(() => {
    return paginateItems(props.visibleScreenTracks, gridPage, gridPageSize);
  }, [gridPage, gridPageSize, props.visibleScreenTracks]);

  useEffect(() => {
    if (gridPage !== gridPagination.currentPage) {
      setGridPage(gridPagination.currentPage);
    }
  }, [gridPage, gridPagination.currentPage]);

  const gridGeometry = useMemo(() => {
    return computeGridGeometry(
      gridViewportSize.width > 0 ? gridViewportSize.width : 960,
      gridViewportSize.height > 0 ? gridViewportSize.height : 560,
      gridPagination.items.length,
    );
  }, [gridPagination.items.length, gridViewportSize.height, gridViewportSize.width]);

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

  const suppressNativeMenu = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
  };

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
    <Paper
      sx={{
        p: 1.3,
        height: "100%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
      onContextMenuCapture={suppressNativeMenu}
    >
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1}
        justifyContent="space-between"
        alignItems={{ xs: "flex-start", sm: "center" }}
        sx={{ mb: 1.1, flexShrink: 0 }}
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
        <Stack
          direction="row"
          spacing={0.8}
          flexWrap="wrap"
          useFlexGap
          sx={{ mb: 1.1, flexShrink: 0 }}
        >
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

      <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {props.visibleScreenTracks.length === 0 && (
          <Paper
            variant="outlined"
            sx={{
              borderStyle: "dashed",
              p: 3,
              textAlign: "center",
              bgcolor: alpha("#57c2ff", 0.08),
              height: "100%",
              minHeight: 0,
              display: "grid",
              placeItems: "center",
            }}
          >
            <Box>
              <Typography variant="body1" sx={{ mb: 0.5 }}>
                No visible streams right now.
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Start sharing or restore hidden streams from chips above.
              </Typography>
            </Box>
          </Paper>
        )}

        {props.visibleScreenTracks.length > 0 && props.effectiveStreamMode === "grid" && (
          <>
            <Box
              ref={gridViewportRef}
              sx={{
                flex: 1,
                minHeight: 0,
                overflow: "hidden",
                display: "flex",
                flexWrap: "wrap",
                gap: 1.1,
                alignContent: "center",
                justifyContent: "center",
                py: 0.4,
              }}
            >
              {gridPagination.items.map((item) => (
                <Box
                  key={item.sid}
                  sx={{
                    width: gridGeometry.tileWidth,
                    maxWidth: "100%",
                    flex: `0 0 ${gridGeometry.tileWidth}px`,
                  }}
                >
                  {renderStreamTile(item)}
                </Box>
              ))}
            </Box>

            <PaginationControls
              page={gridPagination.currentPage}
              totalPages={gridPagination.totalPages}
              onPrev={() => setGridPage((current) => current - 1)}
              onNext={() => setGridPage((current) => current + 1)}
            />
          </>
        )}

        {props.visibleScreenTracks.length > 0 && props.effectiveStreamMode === "focus" && (
          <Stack spacing={1} sx={{ flex: 1, minHeight: 0 }}>
            {props.focusedScreenTrack && (
              <Box sx={{ flex: 1, minHeight: 0, display: "grid", alignItems: "center" }}>
                {renderStreamTile(props.focusedScreenTrack)}
              </Box>
            )}

            {props.secondaryFocusTracks.length > 0 && (
              <Box sx={{ flexShrink: 0 }}>
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
      </Box>
    </Paper>
  );
}
