import { describe, expect, it } from "vitest";
import { VoicePresenceChangedEvent, WorkspaceMemberDto } from "./types";
import {
  applyOptimisticModerationVoiceState,
  buildVoicePresenceEventSignature,
  createOptimisticSelfVoiceStateUpdate,
  isVoiceEarconCooldownPassed,
  isVoicePresenceChannelTransition,
  normalizeVoicePresenceChangedEvent,
  patchWorkspaceMembersVoiceState,
  resolveVoiceStatusIndicator,
  resolveVoicePresenceOccurredAtMs,
  resolveLocalConnectEarconType,
  resolveVoiceEarconType,
  shouldApplyVoicePresenceByTimestamp,
  shouldApplyVoicePresenceEventForSource,
  shouldForceLocalVoiceDisconnectFromPresence,
  shouldPlayLocalDisconnectEarcon,
  shouldStartConnectingEarconLoop,
  VOICE_DISCONNECT_EARCON_DEDUPE_MS,
  VOICE_EARCON_COOLDOWN_MS,
} from "./voicePresence";

function makeMember(overrides: Partial<WorkspaceMemberDto> = {}): WorkspaceMemberDto {
  return {
    userId: "u-1",
    username: "alice",
    role: "User",
    avatarUrl: null,
    connectedVoiceChannelId: null,
    isScreenSharing: false,
    isMuted: false,
    isDeafened: false,
    isServerMuted: false,
    isServerDeafened: false,
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
    isScreenSharing: false,
    isMuted: false,
    isDeafened: false,
    isServerMuted: false,
    isServerDeafened: false,
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
    expect(updated[0].isScreenSharing).toBe(false);
    expect(updated[0].isMuted).toBe(true);
    expect(updated[0].isDeafened).toBe(true);
    expect(updated[0].isServerMuted).toBe(false);
    expect(updated[0].isServerDeafened).toBe(false);
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

describe("voicePresence:resolveLocalConnectEarconType", () => {
  it("returns connect only for false -> true transition", () => {
    expect(resolveLocalConnectEarconType(false, true)).toBe("connect");
    expect(resolveLocalConnectEarconType(false, false)).toBeNull();
    expect(resolveLocalConnectEarconType(true, true)).toBeNull();
    expect(resolveLocalConnectEarconType(true, false)).toBeNull();
  });
});

describe("voicePresence:shouldStartConnectingEarconLoop", () => {
  it("starts only while voice session exists and rtc is not connected without connection errors", () => {
    expect(shouldStartConnectingEarconLoop(true, false, false)).toBe(true);
    expect(shouldStartConnectingEarconLoop(false, false, false)).toBe(false);
    expect(shouldStartConnectingEarconLoop(true, true, false)).toBe(false);
    expect(shouldStartConnectingEarconLoop(true, false, true)).toBe(false);
  });
});

describe("voicePresence:shouldPlayLocalDisconnectEarcon", () => {
  it("plays only on local channel detach outside dedupe window", () => {
    expect(
      shouldPlayLocalDisconnectEarcon("v-1", null, 2000, 900, VOICE_DISCONNECT_EARCON_DEDUPE_MS),
    ).toBe(true);

    expect(
      shouldPlayLocalDisconnectEarcon("v-1", null, 1200, 900, VOICE_DISCONNECT_EARCON_DEDUPE_MS),
    ).toBe(false);
  });

  it("does not play for unchanged or attach transitions", () => {
    expect(
      shouldPlayLocalDisconnectEarcon(null, null, 2000, 0, VOICE_DISCONNECT_EARCON_DEDUPE_MS),
    ).toBe(false);
    expect(
      shouldPlayLocalDisconnectEarcon(null, "v-1", 2000, 0, VOICE_DISCONNECT_EARCON_DEDUPE_MS),
    ).toBe(false);
    expect(
      shouldPlayLocalDisconnectEarcon("v-1", "v-2", 2000, 0, VOICE_DISCONNECT_EARCON_DEDUPE_MS),
    ).toBe(false);
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
      IsScreenSharing: true,
      IsMuted: false,
      IsDeafened: false,
      IsServerMuted: true,
      IsServerDeafened: false,
      OccurredAtUtc: "2026-04-04T10:00:00.000Z",
    });
    expect(normalized?.workspaceId).toBe("w-1");
    expect(normalized?.currentVoiceChannelId).toBe("v-1");
    expect(normalized?.isScreenSharing).toBe(true);
    expect(normalized?.isServerMuted).toBe(true);
    expect(normalized?.isServerDeafened).toBe(false);
  });

  it("defaults missing server moderation fields to false", () => {
    const normalized = normalizeVoicePresenceChangedEvent({
      WorkspaceId: "w-1",
      UserId: "u-1",
      Username: "alice",
      IsMuted: false,
      IsDeafened: true,
    });

    expect(normalized?.isServerMuted).toBe(false);
    expect(normalized?.isServerDeafened).toBe(false);
  });
});

describe("voicePresence:timestamp ordering", () => {
  it("parses valid occurredAtUtc", () => {
    const occurredAtMs = resolveVoicePresenceOccurredAtMs("2026-04-04T10:00:00.000Z", 123);
    expect(occurredAtMs).toBe(Date.parse("2026-04-04T10:00:00.000Z"));
  });

  it("falls back when occurredAtUtc is invalid", () => {
    const occurredAtMs = resolveVoicePresenceOccurredAtMs("not-a-date", 555);
    expect(occurredAtMs).toBe(555);
  });

  it("ignores out-of-order events", () => {
    const outOfOrder = shouldApplyVoicePresenceByTimestamp(
      "2026-04-04T09:59:59.000Z",
      Date.parse("2026-04-04T10:00:00.000Z"),
      0,
    );
    expect(outOfOrder.shouldApply).toBe(false);
  });

  it("accepts newer events", () => {
    const inOrder = shouldApplyVoicePresenceByTimestamp(
      "2026-04-04T10:00:01.000Z",
      Date.parse("2026-04-04T10:00:00.000Z"),
      0,
    );
    expect(inOrder.shouldApply).toBe(true);
  });

  it("builds stable dedupe signature from user/channel transition/time", () => {
    const signature = buildVoicePresenceEventSignature(
      makeEvent({
        userId: "u-9",
        previousVoiceChannelId: "v-1",
        currentVoiceChannelId: "v-2",
        isScreenSharing: true,
        isMuted: true,
        occurredAtUtc: "2026-04-04T10:00:01.000Z",
      }),
    );
    expect(signature).toBe(
      "u-9|v-1|v-2|screen|muted|undeafened|server-unmuted|server-undeafened|2026-04-04T10:00:01.000Z",
    );
  });
});

describe("voicePresence:event source filtering", () => {
  it("treats channel change as transition", () => {
    expect(
      isVoicePresenceChannelTransition(
        makeEvent({
          previousVoiceChannelId: "v-1",
          currentVoiceChannelId: "v-2",
        }),
      ),
    ).toBe(true);
  });

  it("applies workspace events only for transitions or active-channel fallback", () => {
    const stateOnly = makeEvent({
      previousVoiceChannelId: "v-1",
      currentVoiceChannelId: "v-1",
    });

    expect(shouldApplyVoicePresenceEventForSource(stateOnly, "workspace", null)).toBe(false);
    expect(shouldApplyVoicePresenceEventForSource(stateOnly, "workspace", "v-2")).toBe(false);
    expect(shouldApplyVoicePresenceEventForSource(stateOnly, "workspace", "v-1")).toBe(true);
    expect(shouldApplyVoicePresenceEventForSource(stateOnly, "voiceChannel", null)).toBe(true);
  });
});

describe("voicePresence:self disconnect decision", () => {
  it("forces local disconnect when current user is kicked from currently connected channel", () => {
    expect(
      shouldForceLocalVoiceDisconnectFromPresence(
        makeEvent({
          userId: "u-1",
          previousVoiceChannelId: "v-1",
          currentVoiceChannelId: null,
        }),
        "u-1",
        "v-1",
        false,
      ),
    ).toBe(true);
  });

  it("does not force local disconnect during active connect/disconnect request", () => {
    expect(
      shouldForceLocalVoiceDisconnectFromPresence(
        makeEvent({
          userId: "u-1",
          previousVoiceChannelId: "v-1",
          currentVoiceChannelId: null,
        }),
        "u-1",
        "v-1",
        true,
      ),
    ).toBe(false);
  });

  it("ignores events for other users or other channels", () => {
    expect(
      shouldForceLocalVoiceDisconnectFromPresence(
        makeEvent({
          userId: "u-2",
          previousVoiceChannelId: "v-1",
          currentVoiceChannelId: null,
        }),
        "u-1",
        "v-1",
        false,
      ),
    ).toBe(false);

    expect(
      shouldForceLocalVoiceDisconnectFromPresence(
        makeEvent({
          userId: "u-1",
          previousVoiceChannelId: "v-2",
          currentVoiceChannelId: null,
        }),
        "u-1",
        "v-1",
        false,
      ),
    ).toBe(false);
  });
});

describe("voicePresence:status indicators", () => {
  it("prefers deafened icon over muted and reports source", () => {
    expect(
      resolveVoiceStatusIndicator(
        makeMember({
          isMuted: true,
          isDeafened: true,
          isServerDeafened: true,
        }),
      ),
    ).toEqual({
      kind: "deafened",
      tooltip: "Server deafened",
    });
  });

  it("returns self/server muted reasons", () => {
    expect(
      resolveVoiceStatusIndicator(
        makeMember({
          isMuted: true,
          isDeafened: false,
          isServerMuted: false,
        }),
      ),
    ).toEqual({
      kind: "muted",
      tooltip: "Self muted",
    });

    expect(
      resolveVoiceStatusIndicator(
        makeMember({
          isMuted: true,
          isDeafened: false,
          isServerMuted: true,
        }),
      ),
    ).toEqual({
      kind: "muted",
      tooltip: "Server muted",
    });
  });

  it("returns null when no mute/deafen is active", () => {
    expect(resolveVoiceStatusIndicator(makeMember())).toBeNull();
  });
});

describe("voicePresence:optimistic updates", () => {
  it("builds optimistic self update with rollback snapshot", () => {
    const current = {
      isMuted: false,
      isDeafened: false,
      isServerMuted: true,
      isServerDeafened: true,
    } as const;

    const update = createOptimisticSelfVoiceStateUpdate(current, false, false, true);
    expect(update.optimistic).toEqual({
      isMuted: false,
      isDeafened: false,
      isServerMuted: false,
      isServerDeafened: false,
    });
    expect(update.rollback).toEqual(current);
  });

  it("forces muted state when self-deafened is requested", () => {
    const current = {
      isMuted: false,
      isDeafened: false,
      isServerMuted: false,
      isServerDeafened: false,
    } as const;

    const update = createOptimisticSelfVoiceStateUpdate(current, false, true, false);
    expect(update.optimistic).toEqual({
      isMuted: true,
      isDeafened: true,
      isServerMuted: false,
      isServerDeafened: false,
    });
  });

  it("applies optimistic moderation patch with effective state recalculation", () => {
    const current = {
      isMuted: false,
      isDeafened: false,
      isServerMuted: false,
      isServerDeafened: false,
    };

    expect(
      applyOptimisticModerationVoiceState(current, {
        isServerMuted: true,
      }),
    ).toEqual({
      isMuted: true,
      isDeafened: false,
      isServerMuted: true,
      isServerDeafened: false,
    });

    expect(
      applyOptimisticModerationVoiceState(
        {
          isMuted: true,
          isDeafened: true,
          isServerMuted: false,
          isServerDeafened: true,
        },
        {
          isServerDeafened: false,
        },
      ),
    ).toEqual({
      isMuted: false,
      isDeafened: false,
      isServerMuted: false,
      isServerDeafened: false,
    });
  });
});
