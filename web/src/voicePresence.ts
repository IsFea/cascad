import { VoicePresenceChangedEvent, WorkspaceMemberDto } from "./types";

export type VoiceEarconType = "join" | "leave" | "connect" | "connecting" | "disconnect";

export const VOICE_EARCON_COOLDOWN_MS = 350;
export const VOICE_DISCONNECT_EARCON_DEDUPE_MS = 900;

export function patchWorkspaceMembersVoiceState(
  members: WorkspaceMemberDto[],
  event: VoicePresenceChangedEvent,
): WorkspaceMemberDto[] {
  const index = members.findIndex((member) => member.userId === event.userId);
  if (index < 0) {
    return members;
  }

  const current = members[index];
  if (
    current.connectedVoiceChannelId === event.currentVoiceChannelId &&
    current.isMuted === event.isMuted &&
    current.isDeafened === event.isDeafened &&
    current.isServerMuted === event.isServerMuted &&
    current.isServerDeafened === event.isServerDeafened
  ) {
    return members;
  }

  const updated = members.slice();
  updated[index] = {
    ...current,
    connectedVoiceChannelId: event.currentVoiceChannelId,
    isMuted: event.isMuted,
    isDeafened: event.isDeafened,
    isServerMuted: event.isServerMuted,
    isServerDeafened: event.isServerDeafened,
  };
  return updated;
}

export function resolveVoiceEarconType(
  event: VoicePresenceChangedEvent,
  currentConnectedVoiceChannelId: string | null,
  currentUserId: string,
): VoiceEarconType | null {
  if (!currentConnectedVoiceChannelId || event.userId === currentUserId) {
    return null;
  }

  const channelId = currentConnectedVoiceChannelId;
  const joinedCurrentChannel =
    event.currentVoiceChannelId === channelId && event.previousVoiceChannelId !== channelId;
  if (joinedCurrentChannel) {
    return "join";
  }

  const leftCurrentChannel =
    event.previousVoiceChannelId === channelId && event.currentVoiceChannelId !== channelId;
  if (leftCurrentChannel) {
    return "leave";
  }

  return null;
}

export function resolveLocalConnectEarconType(
  wasConnected: boolean,
  isConnected: boolean,
): VoiceEarconType | null {
  return !wasConnected && isConnected ? "connect" : null;
}

export function shouldStartConnectingEarconLoop(
  hasVoiceSession: boolean,
  isConnected: boolean,
  hasConnectionError: boolean,
): boolean {
  return hasVoiceSession && !isConnected && !hasConnectionError;
}

export function shouldPlayLocalDisconnectEarcon(
  previousConnectedVoiceChannelId: string | null,
  nextConnectedVoiceChannelId: string | null,
  nowMs: number,
  lastPlayedAtMs: number,
  dedupeMs = VOICE_DISCONNECT_EARCON_DEDUPE_MS,
): boolean {
  if (!previousConnectedVoiceChannelId || nextConnectedVoiceChannelId !== null) {
    return false;
  }

  return nowMs - lastPlayedAtMs >= dedupeMs;
}

export function isVoiceEarconCooldownPassed(
  nowMs: number,
  lastPlayedAtMs: number,
  cooldownMs = VOICE_EARCON_COOLDOWN_MS,
): boolean {
  return nowMs - lastPlayedAtMs >= cooldownMs;
}

function readStringField(input: Record<string, unknown>, camel: string, pascal: string): string | null {
  const value = input[camel] ?? input[pascal];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readBooleanField(input: Record<string, unknown>, camel: string, pascal: string): boolean | null {
  const value = input[camel] ?? input[pascal];
  return typeof value === "boolean" ? value : null;
}

export function normalizeVoicePresenceChangedEvent(raw: unknown): VoicePresenceChangedEvent | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const input = raw as Record<string, unknown>;
  const workspaceId = readStringField(input, "workspaceId", "WorkspaceId");
  const userId = readStringField(input, "userId", "UserId");
  const username = readStringField(input, "username", "Username");
  const isMuted = readBooleanField(input, "isMuted", "IsMuted");
  const isDeafened = readBooleanField(input, "isDeafened", "IsDeafened");
  const isServerMuted = readBooleanField(input, "isServerMuted", "IsServerMuted");
  const isServerDeafened = readBooleanField(input, "isServerDeafened", "IsServerDeafened");

  if (!workspaceId || !userId || !username || isMuted === null || isDeafened === null) {
    return null;
  }

  return {
    workspaceId,
    userId,
    username,
    avatarUrl: readStringField(input, "avatarUrl", "AvatarUrl"),
    previousVoiceChannelId: readStringField(input, "previousVoiceChannelId", "PreviousVoiceChannelId"),
    currentVoiceChannelId: readStringField(input, "currentVoiceChannelId", "CurrentVoiceChannelId"),
    isMuted,
    isDeafened,
    isServerMuted: isServerMuted ?? false,
    isServerDeafened: isServerDeafened ?? false,
    occurredAtUtc:
      readStringField(input, "occurredAtUtc", "OccurredAtUtc") ?? new Date().toISOString(),
  };
}
