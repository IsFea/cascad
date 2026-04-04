import { describe, expect, it } from "vitest";
import { VoicePresenceChangedEvent, WorkspaceMemberDto } from "./types";
import {
  isVoiceEarconCooldownPassed,
  normalizeVoicePresenceChangedEvent,
  patchWorkspaceMembersVoiceState,
  resolveVoiceEarconType,
  VOICE_EARCON_COOLDOWN_MS,
} from "./voicePresence";

function makeMember(overrides: Partial<WorkspaceMemberDto> = {}): WorkspaceMemberDto {
  return {
    userId: "u-1",
    username: "alice",
    role: "User",
    avatarUrl: null,
    connectedVoiceChannelId: null,
    isMuted: false,
    isDeafened: false,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<VoicePresenceChangedEvent> = {}): VoicePresenceChangedEvent {
  return {
    workspaceId: "w-1",
    userId: "u-1",
    username: "alice",
    avatarUrl: null,
    previousVoiceChannelId: null,
    currentVoiceChannelId: "v-1",
    isMuted: false,
    isDeafened: false,
    occurredAtUtc: "2026-04-04T10:00:00.000Z",
    ...overrides,
  };
}

describe("voicePresence:patchWorkspaceMembersVoiceState", () => {
  it("updates target member voice fields", () => {
    const members = [makeMember(), makeMember({ userId: "u-2", username: "bob" })];
    const updated = patchWorkspaceMembersVoiceState(
      members,
      makeEvent({
        currentVoiceChannelId: "v-2",
        isMuted: true,
        isDeafened: true,
      }),
    );

    expect(updated).not.toBe(members);
    expect(updated[0].connectedVoiceChannelId).toBe("v-2");
    expect(updated[0].isMuted).toBe(true);
    expect(updated[0].isDeafened).toBe(true);
    expect(updated[1]).toEqual(members[1]);
  });

  it("returns original reference when no effective change exists", () => {
    const members = [makeMember({ connectedVoiceChannelId: "v-1" })];
    const updated = patchWorkspaceMembersVoiceState(
      members,
      makeEvent({
        currentVoiceChannelId: "v-1",
        isMuted: false,
        isDeafened: false,
      }),
    );
    expect(updated).toBe(members);
  });
});

describe("voicePresence:resolveVoiceEarconType", () => {
  it("returns join for entering current connected channel", () => {
    const type = resolveVoiceEarconType(
      makeEvent({
        userId: "u-2",
        previousVoiceChannelId: null,
        currentVoiceChannelId: "v-1",
      }),
      "v-1",
      "u-1",
    );
    expect(type).toBe("join");
  });

  it("returns leave for leaving current connected channel", () => {
    const type = resolveVoiceEarconType(
      makeEvent({
        userId: "u-2",
        previousVoiceChannelId: "v-1",
        currentVoiceChannelId: null,
      }),
      "v-1",
      "u-1",
    );
    expect(type).toBe("leave");
  });

  it("returns null for self events and unrelated channels", () => {
    expect(
      resolveVoiceEarconType(
        makeEvent({
          userId: "u-1",
          previousVoiceChannelId: null,
          currentVoiceChannelId: "v-1",
        }),
        "v-1",
        "u-1",
      ),
    ).toBeNull();

    expect(
      resolveVoiceEarconType(
        makeEvent({
          userId: "u-2",
          previousVoiceChannelId: null,
          currentVoiceChannelId: "v-2",
        }),
        "v-1",
        "u-1",
      ),
    ).toBeNull();
  });
});

describe("voicePresence:isVoiceEarconCooldownPassed", () => {
  it("suppresses earcon within cooldown window", () => {
    expect(isVoiceEarconCooldownPassed(1000, 1000, VOICE_EARCON_COOLDOWN_MS)).toBe(false);
    expect(isVoiceEarconCooldownPassed(1200, 1000, VOICE_EARCON_COOLDOWN_MS)).toBe(false);
  });

  it("allows earcon after cooldown", () => {
    expect(isVoiceEarconCooldownPassed(1350, 1000, VOICE_EARCON_COOLDOWN_MS)).toBe(true);
  });
});

describe("voicePresence:normalizeVoicePresenceChangedEvent", () => {
  it("accepts camelCase payload", () => {
    const normalized = normalizeVoicePresenceChangedEvent(makeEvent());
    expect(normalized?.workspaceId).toBe("w-1");
    expect(normalized?.userId).toBe("u-1");
  });

  it("accepts PascalCase payload", () => {
    const normalized = normalizeVoicePresenceChangedEvent({
      WorkspaceId: "w-1",
      UserId: "u-1",
      Username: "alice",
      AvatarUrl: null,
      PreviousVoiceChannelId: null,
      CurrentVoiceChannelId: "v-1",
      IsMuted: false,
      IsDeafened: false,
      OccurredAtUtc: "2026-04-04T10:00:00.000Z",
    });
    expect(normalized?.workspaceId).toBe("w-1");
    expect(normalized?.currentVoiceChannelId).toBe("v-1");
  });
});
