import NavigateBeforeIcon from "@mui/icons-material/NavigateBefore";
import NavigateNextIcon from "@mui/icons-material/NavigateNext";
import { IconButton, Stack, Typography } from "@mui/material";

export function PaginationControls(props: {
  page: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
  compact?: boolean;
}) {
  if (props.totalPages <= 1) {
    return null;
  }

  return (
    <Stack
      direction="row"
      spacing={0.8}
      alignItems="center"
      justifyContent="center"
      sx={{ mt: props.compact ? 0.6 : 1.2 }}
    >
      <IconButton
        size={props.compact ? "small" : "medium"}
        onClick={props.onPrev}
        disabled={props.page <= 1}
        aria-label="Previous page"
      >
        <NavigateBeforeIcon fontSize="small" />
      </IconButton>
      <Typography variant="caption" color="text.secondary">
        Page {props.page}/{props.totalPages}
      </Typography>
      <IconButton
        size={props.compact ? "small" : "medium"}
        onClick={props.onNext}
        disabled={props.page >= props.totalPages}
        aria-label="Next page"
      >
        <NavigateNextIcon fontSize="small" />
      </IconButton>
    </Stack>
  );
}
