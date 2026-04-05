# AI Context: Cascad

This file is a fast onboarding brief for AI agents working in this repository.
Use it as the first source of truth before making changes.

## 1) Product Snapshot

- Goal: self-hosted "Discord-like" room experience for friends.
- Core value now: stable voice + multi-user screen share + clear room UX.
- Current auth model: invite + guest nickname.
- Non-goals (for current stage): full social graph, enterprise moderation, deep account system.

## 2) System Overview

- `backend/`:
  - ASP.NET Core 8 API
  - EF Core + PostgreSQL
  - App JWT + LiveKit RTC token issuing
- `web/`:
  - React + TypeScript + MUI
  - LiveKit client integration
  - Room UI and local media controls
- `infra/` + `docker-compose.yml`:
  - LiveKit (SFU), coturn, postgres, caddy reverse proxy

High-level flow:
1. Guest authenticates (`/api/auth/guest`).
2. User creates room and invite (`/api/rooms`, `/api/rooms/{id}/invites`).
3. User joins by invite (`/api/rooms/join`) and gets `{ appToken, rtcToken, rtcUrl }`.
4. Web connects to LiveKit and handles voice/screen tracks.

## 3) Frontend Architecture (Current)

- Entry: `web/src/App.tsx`
  - Lobby/auth/create/join shell.
  - Mounts room experience.
- Room module: `web/src/room/`
  - `components/RoomShell.tsx`: room page composition + top bar + dialogs + menus
  - `useRoomMediaController.ts`: media/session state, LiveKit events, local controls
  - `components/StreamStage.tsx`: grid/focus/theater stream rendering and pagination
  - `components/ParticipantsPanel.tsx`: expanded/collapsed participant UI and per-user controls
  - `components/StreamContextMenu.tsx`: stream tile right-click actions
  - `components/ParticipantAudioMenu.tsx`: fullscreen avatar right-click audio controls
  - `components/FullscreenStreamLayer.tsx`: fullscreen stream overlay
- Shared room logic: `web/src/roomState.ts`
  - layout reducer and helpers
  - stream share config mapping
  - volume/boost helpers
  - activity hold/hysteresis helpers

## 4) Working Agreements for AI Changes

- Default approach:
  - Keep backend API contracts stable unless explicitly requested.
  - Prefer frontend-only changes for UX tasks.
  - Keep local-only controls local (volume/mute/hide/reset should not affect other users).
- UI/UX principles for this project:
  - No raw participant IDs in UI, use nickname/display name.
  - Right-click on stream/avatar should open app menu, not browser menu.
  - Avoid jumpy hover animations in media tiles.
  - Prefer predictable layout over flashy motion.
- Media behavior expectations:
  - Voice and stream audio are separate channels.
  - Per-user volume range is `0..200%`.
  - Boost above 100% is local best-effort only.
  - Stream tile active border should react to `screen_share_audio` with short hold.

## 5) Safe Change Checklist

Before committing:
1. `cd web && npm run build`
2. `cd web && npm run test:unit`
3. `cd web && npm run test:e2e:smoke` (when relevant to room UX)

For backend-impacting changes:
1. `export DOTNET_CLI_HOME="$PWD/.dotnet"`
2. `dotnet test backend/Cascad.sln`

## 6) Common Pitfalls

- HTTPS/WSS mismatch:
  - If web runs on `https://...`, RTC URL must be `wss://...`.
- LiveKit signal route:
  - Keep reverse proxy behavior intact for `/rtc` and websocket upgrade.
- Device/output selection:
  - `setSinkId` is browser-dependent; always keep graceful fallback.
- Avoid accidental reconnect loops:
  - Keep room connect effect dependencies stable.

## 7) Task Routing (How to Decide Where to Edit)

- If task mentions:
  - **layout/visual polish** -> `room/components/*`
  - **mute/volume/speaking indicators/track mapping** -> `useRoomMediaController.ts` + `roomState.ts`
  - **share presets/start options** -> `roomState.ts` + share dialog in `RoomShell.tsx`
  - **invite/auth/room APIs** -> `backend/Cascad.Api/*`

## 8) Definition of Done for Typical UX Tasks

- Behavior implemented in UI.
- No regressions in join/connect/mute/share flows.
- Build + tests pass.
- New behavior is reflected in tests when practical.
- Changes stay minimal and scoped; avoid broad refactors unless requested.

## 9) Git Remotes

- Primary remote (GitHub): `origin -> https://github.com/IsFea/cascad.git`
- Mirror/secondary remote (GitVerse): `gitverse -> https://gitverse.ru/isfea/cascad`

Default behavior for AI agents:
- Push to `origin` unless user explicitly asks for `gitverse`.
- When user asks to publish to both, push the same branch to both remotes.
