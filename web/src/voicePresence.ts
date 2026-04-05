import { VoicePresenceChangedEvent, WorkspaceMemberDto } from "./types";

export type VoiceEarconType = "join" | "leave" | "connect" | "connecting" | "disconnect";
export type VoicePresenceEventSource = "workspace" | "voiceChannel";
export type VoiceStatusIndicator = {
  kind: "muted" | "deafened";
  tooltip: string;
};
export type VoiceSelfStateSnapshot = Pick<
  WorkspaceMemberDto,
  "isMuted" | "isDeafened" | "isServerMuted" | "isServerDeafened"
>;

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
    current.isScreenSharing === event.isScreenSharing &&
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
    isScreenSharing: event.isScreenSharing,
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

export function resolveVoicePresenceOccurredAtMs(
  occurredAtUtc: string,
  fallbackNowMs = Date.now(),
): number {
  const parsedOccurredAtMs = Date.parse(occurredAtUtc);
  return Number.isFinite(parsedOccurredAtMs) ? parsedOccurredAtMs : fallbackNowMs;
}

export function shouldApplyVoicePresenceByTimestamp(
  occurredAtUtc: string,
  lastOccurredAtMs: number,
  fallbackNowMs = Date.now(),
): { shouldApply: boolean; occurredAtMs: number } {
  const occurredAtMs = resolveVoicePresenceOccurredAtMs(occurredAtUtc, fallbackNowMs);
  return {
    shouldApply: occurredAtMs >= lastOccurredAtMs,
    occurredAtMs,
  };
}

export function buildVoicePresenceEventSignature(event: VoicePresenceChangedEvent): string {
  return [
    event.userId,
    event.previousVoiceChannelId ?? "",
    event.currentVoiceChannelId ?? "",
    event.isScreenSharing ? "screen" : "noscreen",
    event.isMuted ? "muted" : "unmuted",
    event.isDeafened ? "deafened" : "undeafened",
    event.isServerMuted ? "server-muted" : "server-unmuted",
    event.isServerDeafened ? "server-deafened" : "server-undeafened",
    event.occurredAtUtc,
  ].join("|");
}

export function isVoicePresenceChannelTransition(event: VoicePresenceChangedEvent): boolean {
  return event.previousVoiceChannelId !== event.currentVoiceChannelId;
}

export function shouldApplyVoicePresenceEventForSource(
  event: VoicePresenceChangedEvent,
  source: VoicePresenceEventSource,
  connectedVoiceChannelId: string | null,
): boolean {
  if (source === "voiceChannel") {
    return true;
  }

  if (isVoicePresenceChannelTransition(event)) {
    return true;
  }

  return Boolean(
    connectedVoiceChannelId &&
      event.previousVoiceChannelId === connectedVoiceChannelId &&
      event.currentVoiceChannelId === connectedVoiceChannelId,
  );
}

export function shouldForceLocalVoiceDisconnectFromPresence(
  event: VoicePresenceChangedEvent,
  currentUserId: string,
  connectedVoiceChannelId: string | null,
  hasVoiceConnectRequestInFlight: boolean,
): boolean {
  if (
    event.userId !== currentUserId ||
    !connectedVoiceChannelId ||
    hasVoiceConnectRequestInFlight
  ) {
    return false;
  }

  return (
    isVoicePresenceChannelTransition(event) &&
    event.previousVoiceChannelId === connectedVoiceChannelId &&
    event.currentVoiceChannelId === null
  );
}

export function resolveVoiceStatusIndicator(
  member: Pick<
    WorkspaceMemberDto,
    "isMuted" | "isDeafened" | "isServerMuted" | "isServerDeafened"
  >,
): VoiceStatusIndicator | null {
  if (member.isDeafened) {
    return {
      kind: "deafened",
      tooltip: member.isServerDeafened ? "Server deafened" : "Self deafened",
    };
  }

  if (member.isMuted) {
    const serverMuted = member.isServerMuted || member.isServerDeafened;
    return {
      kind: "muted",
      tooltip: serverMuted ? "Server muted" : "Self muted",
    };
  }

  return null;
}

export function createOptimisticSelfVoiceStateUpdate(
  current: VoiceSelfStateSnapshot,
  nextMuted: boolean,
  nextDeafened: boolean,
  isAdmin: boolean,
): {
  optimistic: VoiceSelfStateSnapshot;
  rollback: VoiceSelfStateSnapshot;
} {
  const effectiveMuted = nextDeafened ? true : nextMuted;
  const optimistic: VoiceSelfStateSnapshot = {
    isMuted: effectiveMuted,
    isDeafened: nextDeafened,
    isServerMuted: isAdmin && !effectiveMuted ? false : current.isServerMuted,
    isServerDeafened: isAdmin && !nextDeafened ? false : current.isServerDeafened,
  };
  return {
    optimistic,
    rollback: current,
  };
}

export function applyOptimisticModerationVoiceState(
  member: Pick<
    WorkspaceMemberDto,
    "isMuted" | "isDeafened" | "isServerMuted" | "isServerDeafened"
  >,
  patch: {
    isServerMuted?: boolean;
    isServerDeafened?: boolean;
  },
): Pick<WorkspaceMemberDto, "isMuted" | "isDeafened" | "isServerMuted" | "isServerDeafened"> {
  const selfMuted = member.isMuted && !member.isServerMuted && !member.isServerDeafened;
  const selfDeafened = member.isDeafened && !member.isServerDeafened;
  const isServerMuted = patch.isServerMuted ?? member.isServerMuted;
  const isServerDeafened = patch.isServerDeafened ?? member.isServerDeafened;
  const isDeafened = selfDeafened || isServerDeafened;
  const isMuted = selfMuted || isServerMuted || isServerDeafened;

  return {
    isMuted,
    isDeafened,
    isServerMuted,
    isServerDeafened,
  };
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
  const isScreenSharing = readBooleanField(input, "isScreenSharing", "IsScreenSharing");
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
    isScreenSharing: isScreenSharing ?? false,
    isMuted,
    isDeafened,
    isServerMuted: isServerMuted ?? false,
    isServerDeafened: isServerDeafened ?? false,
    occurredAtUtc:
      readStringField(input, "occurredAtUtc", "OccurredAtUtc") ?? new Date().toISOString(),
  };
}
