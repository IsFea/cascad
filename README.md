# Cascad MVP

Self-hosted MVP voice platform on ASP.NET Core with multi-user screen sharing (Discord-like room behavior).

## Stack

- `backend`: ASP.NET Core 8 + EF Core + PostgreSQL + JWT
- `web`: React + TypeScript + LiveKit client
- `infra`: Docker Compose with LiveKit SFU, coturn, Caddy reverse proxy, PostgreSQL

## Implemented API

- `POST /api/auth/guest` - create/get guest user by nickname
- `POST /api/rooms` - create room (auth required)
- `POST /api/rooms/{roomId}/invites` - create invite token (owner only)
- `POST /api/rooms/join` - validate invite + return `{ room, user, appToken, rtcToken, rtcUrl }`
- `GET /api/rooms/{roomId}` - room metadata and participants

## Local Run (Docker Compose)

1. Copy `.env.example` to `.env` and set secrets.
2. Start services:

```bash
docker compose up --build
```

For local dev profile (`.env.local`):

```bash
docker compose --env-file .env.local up -d --build --force-recreate
```

3. Open:
- web: `https://localhost` (self-signed cert by Caddy internal CA)
- api endpoints via reverse proxy: `https://localhost/api/*`
- livekit through proxy: `wss://localhost` (client connects to `/rtc` internally)

## VPS One-Command Deploy (Interactive)

Run from your local machine:

```bash
chmod +x scripts/deploy_vps.sh
./scripts/deploy_vps.sh
```

The script will:
- ask SSH access and domain settings
- generate and upload production `.env`
- upload project files to VPS
- optionally install Docker + Compose on Ubuntu
- configure required UFW ports
- set `use_external_ip: true` in LiveKit config
- run `docker compose up -d --build` remotely

Health-check script (after deploy):

```bash
chmod +x scripts/check_vps.sh
./scripts/check_vps.sh
```

It validates:
- docker compose status/logs on VPS
- API env (`rtcUrl`, `baseUrl`) in running container
- public HTTPS + `/rtc` websocket route
- full public API flow: `auth -> create room -> invite -> join`

## Run Script On VPS

After code is uploaded to VPS:

```bash
cd /home/<user>/cascad
bash run.sh --start --build
```

Common commands:
- `bash run.sh --start` - start stack
- `bash run.sh --stop` - stop stack
- `bash run.sh --restart --build` - rebuild and restart
- `bash run.sh --status` - show containers
- `bash run.sh --logs api` - follow service logs

## Local Dev Run (without Docker for API/Web)

1. Start infrastructure only:

```bash
docker compose up -d postgres livekit coturn
```

2. Run API:

```bash
export DOTNET_CLI_HOME="$PWD/.dotnet"
dotnet run --project backend/Cascad.Api/Cascad.Api.csproj
```

3. Run web:

```bash
cd web
npm install
npm run dev
```

Open `http://localhost:5173`.

## Test

```bash
export DOTNET_CLI_HOME="$PWD/.dotnet"
dotnet test backend/Cascad.sln
```

Covered:
- JWT generation checks
- Invite token hash behavior
- Integration flow `guest -> create room -> invite -> join -> rtc token`
- Rejection on expired invite
