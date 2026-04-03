#!/usr/bin/env bash
set -euo pipefail

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

prompt() {
  local label="$1"
  local default_value="${2:-}"
  local input=""
  if [[ -n "$default_value" ]]; then
    read -r -p "$label [$default_value]: " input
    echo "${input:-$default_value}"
    return
  fi
  read -r -p "$label: " input
  echo "$input"
}

info() { echo "[INFO] $*"; }
ok() { echo "[OK]   $*"; }
fail() { echo "[FAIL] $*"; }

run_local_check() {
  local title="$1"
  local cmd="$2"
  echo
  info "$title"
  if output=$(eval "$cmd" 2>&1); then
    [[ -n "$output" ]] && echo "$output"
    ok "$title"
  else
    [[ -n "$output" ]] && echo "$output"
    fail "$title"
    FAILURES=$((FAILURES + 1))
  fi
}

run_remote_check() {
  local title="$1"
  local cmd="$2"
  echo
  info "$title"
  if output=$("${SSH_BASE[@]}" "$cmd" 2>&1); then
    [[ -n "$output" ]] && echo "$output"
    ok "$title"
  else
    [[ -n "$output" ]] && echo "$output"
    fail "$title"
    FAILURES=$((FAILURES + 1))
  fi
}

require_cmd ssh
require_cmd curl
require_cmd jq
require_cmd awk
require_cmd grep

echo "== Cascad VPS Health Check =="
echo

SSH_HOST="$(prompt "VPS host (IP or domain)")"
if [[ -z "$SSH_HOST" ]]; then
  echo "VPS host is required." >&2
  exit 1
fi

SSH_USER="$(prompt "SSH user" "ubuntu")"
SSH_PORT="$(prompt "SSH port" "22")"
REMOTE_DIR_DEFAULT="/home/$SSH_USER/cascad"
REMOTE_DIR="$(prompt "Remote project directory" "$REMOTE_DIR_DEFAULT")"
PUBLIC_DOMAIN="$(prompt "Public domain (example: voice.example.com)")"
SMOKE_NICKNAME="$(prompt "Smoke-test nickname" "smokecheck")"
SMOKE_ROOM="$(prompt "Smoke-test room name" "Smoke Room")"

SSH_TARGET="$SSH_USER@$SSH_HOST"
SSH_BASE=(ssh -p "$SSH_PORT" "$SSH_TARGET")
BASE_URL="https://$PUBLIC_DOMAIN"
FAILURES=0

echo
info "Checking SSH connectivity..."
if "${SSH_BASE[@]}" "echo connected >/dev/null"; then
  ok "SSH connectivity"
else
  fail "SSH connectivity"
  exit 1
fi

run_remote_check \
  "Docker Compose service status" \
  "cd '$REMOTE_DIR' && sudo docker compose ps"

run_remote_check \
  "API env values inside container" \
  "sudo docker inspect cascad-api --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -E 'LiveKit__RtcUrl|Client__BaseUrl|Cors__AllowedOrigins__0'"

run_remote_check \
  "LiveKit external IP flag" \
  "grep -n 'use_external_ip' '$REMOTE_DIR/infra/livekit.yaml'"

run_remote_check \
  "Host listening ports (TCP/UDP media + web)" \
  "sudo sh -lc \"ss -lntup | grep -E ':(80|443|3478|7881)\\\\b' || true; ss -lnup | grep -E ':(3478|7882)\\\\b' || true\""

run_remote_check \
  "Recent API logs" \
  "cd '$REMOTE_DIR' && sudo docker compose logs --tail=80 api"

run_remote_check \
  "Recent LiveKit/coturn logs" \
  "cd '$REMOTE_DIR' && sudo docker compose logs --tail=80 livekit coturn"

echo
info "Public site responds over HTTPS"
HOME_STATUS="$(curl -sk -o /tmp/cascad_home_check.out -w '%{http_code}' "$BASE_URL/" || true)"
echo "status: ${HOME_STATUS:-unknown}"
if [[ "$HOME_STATUS" == "200" || "$HOME_STATUS" == "304" ]]; then
  ok "Public site responds over HTTPS"
else
  fail "Unexpected home status: ${HOME_STATUS:-unknown}"
  FAILURES=$((FAILURES + 1))
fi

echo
info "WebSocket route /rtc is reachable"
RTC_STATUS="$(curl -sk -o /tmp/cascad_rtc_check.out -w '%{http_code}' \
  -H 'Connection: Upgrade' \
  -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: SGVsbG8sIHdvcmxkIQ==' \
  "$BASE_URL/rtc" || true)"
echo "status: ${RTC_STATUS:-unknown}"
if [[ "$RTC_STATUS" == "101" || "$RTC_STATUS" == "401" ]]; then
  ok "WebSocket route /rtc is reachable"
else
  fail "Unexpected /rtc status: ${RTC_STATUS:-unknown} (expected 101 or 401)"
  FAILURES=$((FAILURES + 1))
fi

echo
info "Running public API smoke flow (auth -> room -> invite -> join)..."
AUTH_JSON="$(curl -sk -X POST "$BASE_URL/api/auth/guest" -H "content-type: application/json" -d "{\"nickname\":\"$SMOKE_NICKNAME\"}")" || {
  fail "Guest auth request failed"
  exit 1
}

APP_TOKEN="$(echo "$AUTH_JSON" | jq -r '.appToken // empty')"
if [[ -z "$APP_TOKEN" ]]; then
  echo "$AUTH_JSON"
  fail "No appToken from /api/auth/guest"
  exit 1
fi

ROOM_JSON="$(curl -sk -X POST "$BASE_URL/api/rooms" -H "content-type: application/json" -H "Authorization: Bearer $APP_TOKEN" -d "{\"name\":\"$SMOKE_ROOM\"}")"
ROOM_ID="$(echo "$ROOM_JSON" | jq -r '.id // empty')"
if [[ -z "$ROOM_ID" ]]; then
  echo "$ROOM_JSON"
  fail "No room id from /api/rooms"
  exit 1
fi

INVITE_JSON="$(curl -sk -X POST "$BASE_URL/api/rooms/$ROOM_ID/invites" -H "content-type: application/json" -H "Authorization: Bearer $APP_TOKEN" -d '{"expiresInHours":24}')"
INVITE_TOKEN="$(echo "$INVITE_JSON" | jq -r '.inviteToken // empty')"
if [[ -z "$INVITE_TOKEN" ]]; then
  echo "$INVITE_JSON"
  fail "No invite token from /api/rooms/{id}/invites"
  exit 1
fi

JOIN_JSON="$(curl -sk -X POST "$BASE_URL/api/rooms/join" -H "content-type: application/json" -H "Authorization: Bearer $APP_TOKEN" -d "{\"inviteToken\":\"$INVITE_TOKEN\"}")"
RTC_URL="$(echo "$JOIN_JSON" | jq -r '.rtcUrl // empty')"
if [[ -z "$RTC_URL" ]]; then
  echo "$JOIN_JSON"
  fail "No rtcUrl from /api/rooms/join"
  exit 1
fi

echo "rtcUrl: $RTC_URL"
if [[ "$RTC_URL" == "wss://$PUBLIC_DOMAIN" ]]; then
  ok "Join response returns correct public rtcUrl"
else
  fail "Join response rtcUrl mismatch (expected wss://$PUBLIC_DOMAIN)"
  FAILURES=$((FAILURES + 1))
fi

echo
if [[ "$FAILURES" -eq 0 ]]; then
  ok "All checks passed."
  exit 0
fi

fail "Checks finished with $FAILURES issue(s)."
echo "Tip: start with 'docker compose logs -f api livekit coturn' on VPS and browser about:webrtc."
exit 1
