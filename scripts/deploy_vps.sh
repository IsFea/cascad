#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

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

prompt_yes_no() {
  local label="$1"
  local default_answer="${2:-y}"
  local answer=""
  local hint="y/N"
  if [[ "$default_answer" == "y" ]]; then
    hint="Y/n"
  fi
  read -r -p "$label ($hint): " answer
  answer="${answer:-$default_answer}"
  [[ "${answer,,}" == "y" ]]
}

random_secret() {
  local length="${1:-48}"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 64 | tr -dc 'A-Za-z0-9' | head -c "$length"
  else
    LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$length"
  fi
}

require_cmd ssh
require_cmd scp
require_cmd tar
require_cmd awk
require_cmd mktemp

echo "== Cascad VPS Deploy =="
echo "Project: $PROJECT_ROOT"
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
if [[ -z "$PUBLIC_DOMAIN" ]]; then
  echo "Public domain is required." >&2
  exit 1
fi

POSTGRES_DB="$(prompt "Postgres DB name" "cascad")"
POSTGRES_USER="$(prompt "Postgres user" "cascad")"
POSTGRES_PASSWORD="$(prompt "Postgres password" "$(random_secret 20)")"

APP_JWT_SIGNING_KEY="$(prompt "App JWT signing key" "$(random_secret 64)")"
LIVEKIT_API_KEY="$(prompt "LiveKit API key" "devkey")"
LIVEKIT_API_SECRET="$(prompt "LiveKit API secret" "$(random_secret 48)")"

SEED_INVITE_DEFAULT="DEMO_INVITE_HOST_LOBBY"
SEED_INVITE_TOKEN="$(prompt "Seed invite token" "$SEED_INVITE_DEFAULT")"
SEED_ENABLED="true"
if ! prompt_yes_no "Enable demo seed room/invite?" "y"; then
  SEED_ENABLED="false"
fi

INSTALL_DOCKER="true"
if ! prompt_yes_no "Install/repair Docker on VPS if missing?" "y"; then
  INSTALL_DOCKER="false"
fi

CONFIGURE_UFW="true"
if ! prompt_yes_no "Configure UFW rules for required ports?" "y"; then
  CONFIGURE_UFW="false"
fi

echo
echo "Target: $SSH_USER@$SSH_HOST:$REMOTE_DIR"
echo "Domain: https://$PUBLIC_DOMAIN"
echo
if ! prompt_yes_no "Proceed with deployment?" "y"; then
  echo "Cancelled."
  exit 0
fi

TMP_ENV="$(mktemp)"
TMP_CADDY="$(mktemp)"
cleanup() {
  rm -f "$TMP_ENV" "$TMP_CADDY"
}
trap cleanup EXIT

cat >"$TMP_ENV" <<EOF
POSTGRES_DB=$POSTGRES_DB
POSTGRES_USER=$POSTGRES_USER
POSTGRES_PASSWORD=$POSTGRES_PASSWORD

APP_JWT_ISSUER=Cascad.Api
APP_JWT_AUDIENCE=Cascad.Web
APP_JWT_SIGNING_KEY=$APP_JWT_SIGNING_KEY
APP_JWT_EXPIRES_MINUTES=180

LIVEKIT_API_KEY=$LIVEKIT_API_KEY
LIVEKIT_API_SECRET=$LIVEKIT_API_SECRET
RTC_URL=wss://$PUBLIC_DOMAIN
COTURN_IMAGE=coturn/coturn:latest

DOMAIN=$PUBLIC_DOMAIN
CLIENT_BASE_URL=https://$PUBLIC_DOMAIN
CORS_ORIGIN_0=https://$PUBLIC_DOMAIN
CORS_ORIGIN_1=http://localhost:5173
WEB_API_URL=/api

SEED_ENABLED=$SEED_ENABLED
SEED_CREATE_DEMO_ROOM=true
SEED_DEMO_OWNER_NICKNAME=host
SEED_DEMO_ROOM_NAME=Lobby
SEED_DEMO_INVITE_TOKEN=$SEED_INVITE_TOKEN
SEED_DEMO_INVITE_EXPIRES_HOURS=720
EOF

cat >"$TMP_CADDY" <<EOF
$PUBLIC_DOMAIN {
  encode gzip

  @api path /api/*
  handle @api {
    reverse_proxy api:8080
  }

  @rtc path /rtc*
  handle @rtc {
    reverse_proxy livekit:7880
  }

  handle {
    reverse_proxy web:80
  }
}
EOF

SSH_TARGET="$SSH_USER@$SSH_HOST"
SSH_BASE=(ssh -p "$SSH_PORT" "$SSH_TARGET")
SCP_BASE=(scp -P "$SSH_PORT")

echo "Creating remote directory..."
"${SSH_BASE[@]}" "mkdir -p '$REMOTE_DIR'"

echo "Uploading project source..."
tar -C "$PROJECT_ROOT" \
  --exclude=".git" \
  --exclude=".dotnet" \
  --exclude="web/node_modules" \
  --exclude="web/dist" \
  --exclude="backend/Cascad.Api/bin" \
  --exclude="backend/Cascad.Api/obj" \
  --exclude="backend/Cascad.Api.Tests/bin" \
  --exclude="backend/Cascad.Api.Tests/obj" \
  --exclude=".DS_Store" \
  -czf - . | "${SSH_BASE[@]}" "tar -xzf - -C '$REMOTE_DIR'"

echo "Uploading production .env and Caddyfile..."
"${SCP_BASE[@]}" "$TMP_ENV" "$SSH_TARGET:$REMOTE_DIR/.env"
"${SCP_BASE[@]}" "$TMP_CADDY" "$SSH_TARGET:$REMOTE_DIR/infra/Caddyfile"

echo "Running remote setup..."
ssh -tt -p "$SSH_PORT" "$SSH_TARGET" \
  "REMOTE_DIR='$REMOTE_DIR' INSTALL_DOCKER='$INSTALL_DOCKER' CONFIGURE_UFW='$CONFIGURE_UFW' bash -s" <<'EOF'
set -euo pipefail

if [[ "$INSTALL_DOCKER" == "true" ]]; then
  if ! command -v docker >/dev/null 2>&1; then
    echo "Installing Docker..."
    sudo apt-get update
    sudo apt-get install -y ca-certificates curl gnupg lsb-release
    sudo install -m 0755 -d /etc/apt/keyrings
    if [[ ! -f /etc/apt/keyrings/docker.gpg ]]; then
      curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    fi
    sudo chmod a+r /etc/apt/keyrings/docker.gpg
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
      $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
      sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
    sudo apt-get update
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi
fi

if [[ "$CONFIGURE_UFW" == "true" ]] && command -v ufw >/dev/null 2>&1; then
  echo "Configuring UFW rules..."
  sudo ufw allow 22/tcp || true
  sudo ufw allow 80/tcp || true
  sudo ufw allow 443/tcp || true
  sudo ufw allow 3478/tcp || true
  sudo ufw allow 3478/udp || true
  sudo ufw allow 7881/tcp || true
  sudo ufw allow 7882/udp || true
fi

LIVEKIT_CFG="$REMOTE_DIR/infra/livekit.yaml"
if [[ -f "$LIVEKIT_CFG" ]] && grep -q "use_external_ip:" "$LIVEKIT_CFG"; then
  sed -i.bak 's/use_external_ip:.*/use_external_ip: true/' "$LIVEKIT_CFG"
fi

cd "$REMOTE_DIR"

if sudo docker compose version >/dev/null 2>&1; then
  sudo docker compose up -d --build
  sudo docker compose ps
else
  echo "Docker Compose plugin is missing on VPS." >&2
  exit 1
fi
EOF

echo
echo "Deployment complete."
echo "Public URL: https://$PUBLIC_DOMAIN"
echo "Run logs: ssh -p $SSH_PORT $SSH_TARGET 'cd $REMOTE_DIR && sudo docker compose logs -f api'"
