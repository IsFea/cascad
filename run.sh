#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "docker-compose.yml not found in $SCRIPT_DIR" >&2
  exit 1
fi

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose -f "$COMPOSE_FILE" "$@"
    return
  fi

  if sudo docker compose version >/dev/null 2>&1; then
    sudo docker compose -f "$COMPOSE_FILE" "$@"
    return
  fi

  echo "docker compose is not available (with or without sudo)." >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage:
  ./run.sh --start [--build]
  ./run.sh --stop
  ./run.sh --restart [--build]
  ./run.sh --status
  ./run.sh --logs [service]

Examples:
  ./run.sh --start --build
  ./run.sh --logs api
EOF
}

ACTION=""
WITH_BUILD="false"
LOG_SERVICE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --start|--stop|--restart|--status|--logs)
      ACTION="$1"
      shift
      ;;
    --build)
      WITH_BUILD="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      if [[ "$ACTION" == "--logs" && -z "$LOG_SERVICE" ]]; then
        LOG_SERVICE="$1"
        shift
        continue
      fi
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$ACTION" ]]; then
  usage
  exit 1
fi

case "$ACTION" in
  --start)
    if [[ "$WITH_BUILD" == "true" ]]; then
      compose up -d --build
    else
      compose up -d
    fi
    compose ps
    ;;
  --stop)
    compose down
    ;;
  --restart)
    compose down
    if [[ "$WITH_BUILD" == "true" ]]; then
      compose up -d --build
    else
      compose up -d
    fi
    compose ps
    ;;
  --status)
    compose ps
    ;;
  --logs)
    if [[ -n "$LOG_SERVICE" ]]; then
      compose logs -f "$LOG_SERVICE"
    else
      compose logs -f
    fi
    ;;
esac
