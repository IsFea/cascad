import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  createAudioAnalyser,
  createLocalAudioTrack,
  LocalAudioTrack,
  RemoteAudioTrack,
  RemoteParticipant,
  Room,
  RoomEvent,
  supportsAudioOutputSelection,
  Track,
  VideoTrack,
} from "livekit-client";
import {
  AudioChannel,
  buildMicTrackOptions,
  buildScreenShareConfig,
  createInitialLayoutState,
  DEFAULT_DSP_SETTINGS,
  DEFAULT_STREAM_START_OPTIONS,
  DspSettings,
  getAudioChannelForSource,
  getEffectiveStreamMode,
  hideStreamIdentity,
  resolveActivityWithHold,
  resolveFocusedStreamSid,
  resolvePlaybackLevels,
  restoreStreamIdentity,
  StreamLayoutMode,
  StreamStartOptions,
  streamLayoutReducer,
  withoutVoiceIsolation,
} from "../roomState";
import { JoinRoomResponse } from "../types";
import { AudioBinding, ParticipantState, ScreenTrackState } from "./types";
import { resolveDisplayName } from "./utils";

const DEFAULT_CHANNEL_VOLUME = 1;
const VOICE_ACTIVE_HOLD_MS = 320;
const STREAM_ACTIVE_HOLD_MS = 740;

type UseRoomMediaControllerResult = {
  connected: boolean;
  muted: boolean;
  sharing: boolean;
  error: string | null;
  setError: (value: string | null) => void;
  participants: ParticipantState[];
  participantMap: Map<string, ParticipantState>;
  visibleScreenTracks: ScreenTrackState[];
  hiddenStreamIdentities: string[];
  totalStreamsCount: number;
  layoutState: ReturnType<typeof createInitialLayoutState>;
  effectiveStreamMode: "grid" | "focus";
  focusedStreamSid: string | null;
  focusedScreenTrack: ScreenTrackState | null;
  secondaryFocusTracks: ScreenTrackState[];
  inputDevices: MediaDeviceInfo[];
  outputDevices: MediaDeviceInfo[];
  selectedInputId: string;
  selectedOutputId: string;
  devicesLoading: boolean;
  dspSettings: DspSettings;
  dspApplying: boolean;
  streamStartOptions: StreamStartOptions;
  supportsOutputSelection: boolean;
  remoteParticipantsCount: number;
  setLayoutMode: (mode: StreamLayoutMode) => void;
  setFocusedStream: (sid: string | null) => void;
  toggleLocalMute: () => Promise<void>;
  startScreenShare: () => Promise<void>;
  stopScreenShare: () => Promise<void>;
  changeMicrophoneDevice: (deviceId: string) => Promise<void>;
  changeOutputDevice: (deviceId: string) => Promise<void>;
  updateDspSettings: (settings: DspSettings) => void;
  applyDspSettings: () => Promise<void>;
  updateStreamStartOptions: (patch: Partial<StreamStartOptions>) => void;
  setChannelVolume: (identity: string, source: AudioChannel, value: number) => void;
  setChannelMuted: (identity: string, source: AudioChannel, mutedLocal: boolean) => void;
  resetParticipantAudio: (identity: string) => void;
  hideStream: (identity: string) => void;
  restoreStream: (identity: string) => void;
};

export function useRoomMediaController(
  session: JoinRoomResponse,
): UseRoomMediaControllerResult {
  const [connected, setConnected] = useState(false);
  const [muted, setMuted] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [participants, setParticipants] = useState<ParticipantState[]>([]);
  const [screenTracks, setScreenTracks] = useState<ScreenTrackState[]>([]);
  const [hiddenStreamsByIdentity, setHiddenStreamsByIdentity] =
    useState<Record<string, true>>({});

  const [layoutState, dispatchLayout] = useReducer(
    streamLayoutReducer,
    undefined,
    createInitialLayoutState,
  );

  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedInputId, setSelectedInputId] = useState("");
  const [selectedOutputId, setSelectedOutputId] = useState("");
  const [devicesLoading, setDevicesLoading] = useState(false);

  const [dspSettings, setDspSettings] = useState<DspSettings>(DEFAULT_DSP_SETTINGS);
  const [dspApplying, setDspApplying] = useState(false);

  const [streamStartOptions, setStreamStartOptions] = useState<StreamStartOptions>(
    DEFAULT_STREAM_START_OPTIONS,
  );

  const roomRef = useRef<Room | null>(null);
  const localAudioRef = useRef<LocalAudioTrack | null>(null);
  const audioBindingsRef = useRef<Map<string, AudioBinding>>(new Map());

  const selectedInputRef = useRef("");
  const selectedOutputRef = useRef("");
  const mutedRef = useRef(false);
  const dspSettingsRef = useRef<DspSettings>(DEFAULT_DSP_SETTINGS);

  const voiceVolumeMapRef = useRef<Record<string, number>>({});
  const streamVolumeMapRef = useRef<Record<string, number>>({});
  const voiceMuteMapRef = useRef<Record<string, boolean>>({});
  const streamMuteMapRef = useRef<Record<string, boolean>>({});

  const activeSpeakersRef = useRef<Set<string>>(new Set());
  const voiceActivityRef = useRef<Set<string>>(new Set());
  const screenAudioActivityRef = useRef<Set<string>>(new Set());
  const syncQueuedRef = useRef(false);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    dspSettingsRef.current = dspSettings;
  }, [dspSettings]);

  const participantMap = useMemo(() => {
    return new Map(participants.map((participant) => [participant.identity, participant]));
  }, [participants]);

  const visibleScreenTracks = useMemo(() => {
    return screenTracks.filter((track) => !hiddenStreamsByIdentity[track.participantIdentity]);
  }, [hiddenStreamsByIdentity, screenTracks]);

  const visibleScreenTrackSids = useMemo(
    () => visibleScreenTracks.map((item) => item.sid),
    [visibleScreenTracks],
  );

  useEffect(() => {
    dispatchLayout({ type: "ensure-visible", visibleSids: visibleScreenTrackSids });
  }, [visibleScreenTrackSids]);

  const effectiveStreamMode = getEffectiveStreamMode(layoutState);
  const focusedStreamSid = resolveFocusedStreamSid(layoutState, visibleScreenTrackSids);

  const focusedScreenTrack =
    focusedStreamSid !== null
      ? visibleScreenTracks.find((item) => item.sid === focusedStreamSid) ?? null
      : null;

  const secondaryFocusTracks = useMemo(() => {
    if (!focusedStreamSid) {
      return visibleScreenTracks;
    }

    return visibleScreenTracks.filter((item) => item.sid !== focusedStreamSid);
  }, [focusedStreamSid, visibleScreenTracks]);

  const hiddenStreamIdentities = useMemo(() => {
    const activeStreamIdentities = new Set(
      screenTracks.map((item) => item.participantIdentity),
    );

    return Object.keys(hiddenStreamsByIdentity).filter((identity) =>
      activeStreamIdentities.has(identity),
    );
  }, [hiddenStreamsByIdentity, screenTracks]);

  const queueSyncParticipants = () => {
    if (syncQueuedRef.current) {
      return;
    }

    syncQueuedRef.current = true;
    window.requestAnimationFrame(() => {
      syncQueuedRef.current = false;
      if (roomRef.current) {
        syncParticipants(roomRef.current);
      }
    });
  };

  const setupBoostPath = (binding: AudioBinding) => {
    if (binding.boostSupported || selectedOutputRef.current) {
      return;
    }

    const Ctx = (window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);

    if (!Ctx) {
      return;
    }

    try {
      const context = new Ctx();
      const sourceNode = context.createMediaElementSource(binding.element);
      const gainNode = context.createGain();
      sourceNode.connect(gainNode);
      gainNode.connect(context.destination);

      binding.boostContext = context;
      binding.boostSourceNode = sourceNode;
      binding.boostGainNode = gainNode;
      binding.boostSupported = true;
      binding.element.muted = true;

      void context.resume().catch(() => {
        // autoplay policy may block resume until user interaction
      });
    } catch {
      binding.boostSupported = false;
      binding.boostContext = undefined;
      binding.boostSourceNode = undefined;
      binding.boostGainNode = undefined;
    }
  };

  const disableBoostPath = (binding: AudioBinding) => {
    if (!binding.boostSupported) {
      return;
    }

    try {
      binding.boostSourceNode?.disconnect();
      binding.boostGainNode?.disconnect();
      void binding.boostContext?.close();
    } catch {
      // best-effort cleanup
    }

    binding.boostSupported = false;
    binding.boostContext = undefined;
    binding.boostSourceNode = undefined;
    binding.boostGainNode = undefined;
    binding.element.muted = false;
  };

  const applyOutputDevice = async (binding: AudioBinding) => {
    if (binding.boostSupported) {
      return;
    }

    const sinkId = selectedOutputRef.current;
    if (!sinkId) {
      return;
    }

    const sinkable = binding.element as HTMLAudioElement & {
      setSinkId?: (nextSinkId: string) => Promise<void>;
      sinkId?: string;
    };

    if (typeof sinkable.setSinkId !== "function") {
      return;
    }

    if (sinkable.sinkId === sinkId) {
      return;
    }

    try {
      await sinkable.setSinkId(sinkId);
    } catch {
      // browser-specific
    }
  };

  const getChannelVolume = (identity: string, source: AudioChannel): number => {
    const map = source === "voice" ? voiceVolumeMapRef.current : streamVolumeMapRef.current;
    return Math.min(2, Math.max(0, map[identity] ?? DEFAULT_CHANNEL_VOLUME));
  };

  const getChannelMute = (identity: string, source: AudioChannel): boolean => {
    const map = source === "voice" ? voiceMuteMapRef.current : streamMuteMapRef.current;
    return Boolean(map[identity]);
  };

  const applyBindingAudioSettings = (binding: AudioBinding) => {
    const requestedVolume = getChannelVolume(binding.identity, binding.source);
    const isMuted = getChannelMute(binding.identity, binding.source);

    const shouldTryBoost = requestedVolume > 1 && !selectedOutputRef.current;
    if (shouldTryBoost) {
      setupBoostPath(binding);
    }

    if (selectedOutputRef.current && binding.boostSupported) {
      disableBoostPath(binding);
    }

    const levels = resolvePlaybackLevels(requestedVolume, binding.boostSupported);

    if (binding.boostSupported && binding.boostGainNode) {
      binding.element.muted = true;
      binding.boostGainNode.gain.value = isMuted ? 0 : levels.gainValue;
    } else {
      binding.element.muted = false;
      binding.element.volume = isMuted ? 0 : levels.elementVolume;
      void applyOutputDevice(binding);
    }
  };

  const applyAudioSettings = (identity: string, source?: AudioChannel) => {
    for (const binding of audioBindingsRef.current.values()) {
      if (binding.identity !== identity) {
        continue;
      }

      if (source && binding.source !== source) {
        continue;
      }

      applyBindingAudioSettings(binding);
    }
  };

  const setSourceActivity = (
    identity: string,
    source: AudioChannel,
    active: boolean,
  ) => {
    const setRef = source === "voice" ? voiceActivityRef.current : screenAudioActivityRef.current;
    const hadValue = setRef.has(identity);

    if (active && !hadValue) {
      setRef.add(identity);
      queueSyncParticipants();
      return;
    }

    if (!active && hadValue) {
      setRef.delete(identity);
      queueSyncParticipants();
    }
  };

  const recomputeIdentitySourceActivity = (
    identity: string,
    source: AudioChannel,
  ) => {
    const hasActive = Array.from(audioBindingsRef.current.values()).some(
      (binding) =>
        binding.identity === identity &&
        binding.source === source &&
        binding.isActive,
    );

    setSourceActivity(identity, source, hasActive);
  };

  const cleanupBinding = (binding: AudioBinding) => {
    if (binding.activityIntervalId !== undefined) {
      window.clearInterval(binding.activityIntervalId);
    }

    if (binding.analyser) {
      void binding.analyser.cleanup();
    }

    disableBoostPath(binding);

    binding.track.detach(binding.element);
    binding.element.pause();
    binding.element.srcObject = null;
    binding.element.remove();

    audioBindingsRef.current.delete(binding.sid);
    binding.isActive = false;
    binding.activeUntilMs = undefined;
    recomputeIdentitySourceActivity(binding.identity, binding.source);
  };

  const cleanupParticipantAudio = (identity: string) => {
    const bindings = Array.from(audioBindingsRef.current.values()).filter(
      (item) => item.identity === identity,
    );

    for (const binding of bindings) {
      cleanupBinding(binding);
    }
  };

  const syncParticipants = (room: Room) => {
    const remoteParticipants = Array.from(room.remoteParticipants.values());
    const remoteIdentitySet = new Set(remoteParticipants.map((item) => item.identity));

    const cleanupMap = <T,>(map: Record<string, T>) => {
      for (const identity of Object.keys(map)) {
        if (!remoteIdentitySet.has(identity)) {
          delete map[identity];
        }
      }
    };

    cleanupMap(voiceVolumeMapRef.current);
    cleanupMap(streamVolumeMapRef.current);
    cleanupMap(voiceMuteMapRef.current);
    cleanupMap(streamMuteMapRef.current);

    for (const identity of Array.from(voiceActivityRef.current.values())) {
      if (!remoteIdentitySet.has(identity)) {
        voiceActivityRef.current.delete(identity);
      }
    }

    for (const identity of Array.from(screenAudioActivityRef.current.values())) {
      if (!remoteIdentitySet.has(identity)) {
        screenAudioActivityRef.current.delete(identity);
      }
    }

    const localIdentity = room.localParticipant.identity;
    const localState: ParticipantState = {
      identity: localIdentity,
      displayName: resolveDisplayName(room.localParticipant, session.user.nickname),
      isLocal: true,
      isScreenSharing: room.localParticipant.isScreenShareEnabled,
      voiceVolume: DEFAULT_CHANNEL_VOLUME,
      streamVolume: DEFAULT_CHANNEL_VOLUME,
      voiceMutedLocal: mutedRef.current,
      streamMutedLocal: false,
      isVoiceActive:
        activeSpeakersRef.current.has(localIdentity) || voiceActivityRef.current.has(localIdentity),
      isScreenAudioActive: screenAudioActivityRef.current.has(localIdentity),
    };

    const remoteStates = remoteParticipants
      .map((participant): ParticipantState => {
        const identity = participant.identity;

        if (voiceVolumeMapRef.current[identity] === undefined) {
          voiceVolumeMapRef.current[identity] = DEFAULT_CHANNEL_VOLUME;
        }

        if (streamVolumeMapRef.current[identity] === undefined) {
          streamVolumeMapRef.current[identity] = DEFAULT_CHANNEL_VOLUME;
        }

        if (voiceMuteMapRef.current[identity] === undefined) {
          voiceMuteMapRef.current[identity] = false;
        }

        if (streamMuteMapRef.current[identity] === undefined) {
          streamMuteMapRef.current[identity] = false;
        }

        return {
          identity,
          displayName: resolveDisplayName(participant),
          isLocal: false,
          isScreenSharing: participant.isScreenShareEnabled,
          voiceVolume: voiceVolumeMapRef.current[identity],
          streamVolume: streamVolumeMapRef.current[identity],
          voiceMutedLocal: Boolean(voiceMuteMapRef.current[identity]),
          streamMutedLocal: Boolean(streamMuteMapRef.current[identity]),
          isVoiceActive:
            voiceActivityRef.current.has(identity) || activeSpeakersRef.current.has(identity),
          isScreenAudioActive: screenAudioActivityRef.current.has(identity),
        };
      })
      .sort((left, right) => {
        if (left.isVoiceActive !== right.isVoiceActive) {
          return left.isVoiceActive ? -1 : 1;
        }

        return left.displayName.localeCompare(right.displayName);
      });

    setParticipants([localState, ...remoteStates]);
  };

  const refreshDevices = async (requestPermissions: boolean) => {
    setDevicesLoading(true);

    try {
      const inputs = await Room.getLocalDevices("audioinput", requestPermissions);
      setInputDevices(inputs);
      setSelectedInputId((previous) => {
        const fallback = inputs[0]?.deviceId ?? "";
        const next = previous || selectedInputRef.current || fallback;
        selectedInputRef.current = next;
        return next;
      });

      if (supportsAudioOutputSelection()) {
        const outputs = await Room.getLocalDevices("audiooutput", false);
        setOutputDevices(outputs);
        setSelectedOutputId((previous) => {
          const fallback = outputs[0]?.deviceId ?? "";
          const next = previous || selectedOutputRef.current || fallback;
          selectedOutputRef.current = next;
          return next;
        });
      } else {
        setOutputDevices([]);
        setSelectedOutputId("");
        selectedOutputRef.current = "";
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Failed to read media devices.";
      setError(message);
    } finally {
      setDevicesLoading(false);
    }
  };

  const createLocalMicrophoneTrack = async (deviceId?: string) => {
    const trackOptions = buildMicTrackOptions(dspSettingsRef.current, deviceId);

    try {
      return await createLocalAudioTrack(trackOptions as any);
    } catch (reason) {
      if (trackOptions.voiceIsolation) {
        const fallback = withoutVoiceIsolation(trackOptions);
        try {
          setError("Voice isolation unsupported in this browser. Fallback applied.");
          return await createLocalAudioTrack(fallback as any);
        } catch {
          // keep original error
        }
      }

      throw reason;
    }
  };

  const createAndPublishMicrophoneTrack = async (room: Room, deviceId?: string) => {
    if (localAudioRef.current) {
      await room.localParticipant.unpublishTrack(localAudioRef.current);
      localAudioRef.current.stop();
      localAudioRef.current = null;
    }

    const microphone = await createLocalMicrophoneTrack(deviceId);

    await room.localParticipant.publishTrack(microphone, {
      source: Track.Source.Microphone,
    });

    if (mutedRef.current) {
      await microphone.mute();
    }

    localAudioRef.current = microphone;
  };

  useEffect(() => {
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
    });

    roomRef.current = room;

    const onTrackSubscribed = (
      track: Track,
      _publication: unknown,
      participant: RemoteParticipant,
    ) => {
      if (track.kind === Track.Kind.Audio) {
        const source = getAudioChannelForSource(track.source);
        const sid = track.sid ?? `${participant.identity}-${source}-${Date.now()}`;

        if (!audioBindingsRef.current.has(sid)) {
          const element = new Audio();
          element.autoplay = true;

          const remoteAudioTrack = track as RemoteAudioTrack;
          remoteAudioTrack.attach(element);

          const binding: AudioBinding = {
            sid,
            identity: participant.identity,
            source,
            track: remoteAudioTrack,
            element,
            isActive: false,
            boostSupported: false,
          };

          try {
            const analyser = createAudioAnalyser(remoteAudioTrack, { cloneTrack: false });
            binding.analyser = analyser;
            binding.activityIntervalId = window.setInterval(() => {
              if (!binding.analyser) {
                return;
              }

              const level = binding.analyser.calculateVolume();
              const threshold = binding.source === "voice" ? 0.035 : 0.02;
              const holdMs =
                binding.source === "voice" ? VOICE_ACTIVE_HOLD_MS : STREAM_ACTIVE_HOLD_MS;
              const now = Date.now();
              const activity = resolveActivityWithHold(
                level,
                threshold,
                now,
                binding.activeUntilMs,
                holdMs,
              );
              binding.activeUntilMs = activity.activeUntilMs;
              const nextActive = activity.isActive;
              if (binding.isActive !== nextActive) {
                binding.isActive = nextActive;
                recomputeIdentitySourceActivity(binding.identity, binding.source);
              }
            }, 160);
          } catch {
            // optional activity metrics for per-source indicators
          }

          audioBindingsRef.current.set(binding.sid, binding);
          applyBindingAudioSettings(binding);
        }
      }

      if (track.kind === Track.Kind.Video && track.source === Track.Source.ScreenShare) {
        const sid = track.sid ?? `${participant.identity}-screen`;
        setScreenTracks((previous) => {
          if (previous.some((item) => item.sid === sid)) {
            return previous;
          }

          return [
            ...previous,
            {
              sid,
              participantIdentity: participant.identity,
              track: track as VideoTrack,
            },
          ];
        });
      }

      syncParticipants(room);
    };

    const onTrackUnsubscribed = (
      track: Track,
      _publication: unknown,
      participant: RemoteParticipant,
    ) => {
      if (track.kind === Track.Kind.Audio) {
        const direct = track.sid ? audioBindingsRef.current.get(track.sid) : undefined;
        const fallbackBinding = Array.from(audioBindingsRef.current.values()).find(
          (binding) => binding.track === track,
        );

        const binding = direct ?? fallbackBinding;
        if (binding) {
          cleanupBinding(binding);
        }
      }

      if (track.kind === Track.Kind.Video && track.source === Track.Source.ScreenShare) {
        const sid = track.sid ?? `${participant.identity}-screen`;
        dispatchLayout({ type: "remove-stream", sid });
        setScreenTracks((previous) => previous.filter((item) => item.sid !== sid));
      }

      syncParticipants(room);
    };

    const onParticipantDisconnected = (participant: RemoteParticipant) => {
      cleanupParticipantAudio(participant.identity);

      voiceActivityRef.current.delete(participant.identity);
      screenAudioActivityRef.current.delete(participant.identity);
      activeSpeakersRef.current.delete(participant.identity);

      setScreenTracks((previous) =>
        previous.filter((item) => item.participantIdentity !== participant.identity),
      );

      setHiddenStreamsByIdentity((previous) =>
        restoreStreamIdentity(previous, participant.identity),
      );

      delete voiceVolumeMapRef.current[participant.identity];
      delete streamVolumeMapRef.current[participant.identity];
      delete voiceMuteMapRef.current[participant.identity];
      delete streamMuteMapRef.current[participant.identity];

      syncParticipants(room);
    };

    const onActiveSpeakersChanged = (
      activeParticipants: Array<{ identity: string }>,
    ) => {
      activeSpeakersRef.current = new Set(activeParticipants.map((item) => item.identity));
      queueSyncParticipants();
    };

    room.on(RoomEvent.TrackSubscribed, onTrackSubscribed);
    room.on(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
    room.on(RoomEvent.ParticipantConnected, () => syncParticipants(room));
    room.on(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
    room.on(RoomEvent.ParticipantNameChanged, () => syncParticipants(room));
    room.on(RoomEvent.MediaDevicesChanged, () => {
      void refreshDevices(false);
    });
    room.on(RoomEvent.ActiveSpeakersChanged, onActiveSpeakersChanged);
    room.on(RoomEvent.Disconnected, () => {
      setConnected(false);
      setSharing(false);
    });
    room.on(RoomEvent.LocalTrackPublished, (publication) => {
      if (publication.track?.source === Track.Source.ScreenShare) {
        setSharing(true);
      }
    });
    room.on(RoomEvent.LocalTrackUnpublished, (publication) => {
      if (publication.track?.source === Track.Source.ScreenShare) {
        setSharing(false);
      }
    });

    const connect = async () => {
      try {
        await room.connect(session.rtcUrl, session.rtcToken, {
          autoSubscribe: true,
        });

        await refreshDevices(true);
        await createAndPublishMicrophoneTrack(room, selectedInputRef.current || undefined);
        await room.startAudio();

        syncParticipants(room);
        setConnected(true);
        setError(null);
      } catch (reason) {
        const message =
          reason instanceof Error ? reason.message : "Failed to connect to the room.";
        setError(message);
      }
    };

    void connect();

    return () => {
      room.off(RoomEvent.TrackSubscribed, onTrackSubscribed);
      room.off(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
      room.off(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
      room.off(RoomEvent.ActiveSpeakersChanged, onActiveSpeakersChanged);

      void room.disconnect();

      localAudioRef.current?.stop();
      localAudioRef.current = null;

      for (const binding of Array.from(audioBindingsRef.current.values())) {
        cleanupBinding(binding);
      }

      audioBindingsRef.current.clear();
      roomRef.current = null;
    };
  }, [session.rtcToken, session.rtcUrl, session.user.nickname]);

  const patchParticipant = (identity: string, patch: Partial<ParticipantState>) => {
    setParticipants((previous) =>
      previous.map((participant) =>
        participant.identity === identity ? { ...participant, ...patch } : participant,
      ),
    );
  };

  const setChannelVolume = (identity: string, source: AudioChannel, value: number) => {
    const next = Math.max(0, Math.min(2, value));

    if (source === "voice") {
      voiceVolumeMapRef.current[identity] = next;
      patchParticipant(identity, { voiceVolume: next });
    } else {
      streamVolumeMapRef.current[identity] = next;
      patchParticipant(identity, { streamVolume: next });
    }

    applyAudioSettings(identity, source);
  };

  const setChannelMuted = (identity: string, source: AudioChannel, mutedLocal: boolean) => {
    if (source === "voice") {
      voiceMuteMapRef.current[identity] = mutedLocal;
      patchParticipant(identity, { voiceMutedLocal: mutedLocal });
    } else {
      streamMuteMapRef.current[identity] = mutedLocal;
      patchParticipant(identity, { streamMutedLocal: mutedLocal });
    }

    applyAudioSettings(identity, source);
  };

  const resetParticipantAudio = (identity: string) => {
    voiceVolumeMapRef.current[identity] = DEFAULT_CHANNEL_VOLUME;
    streamVolumeMapRef.current[identity] = DEFAULT_CHANNEL_VOLUME;
    voiceMuteMapRef.current[identity] = false;
    streamMuteMapRef.current[identity] = false;

    patchParticipant(identity, {
      voiceVolume: DEFAULT_CHANNEL_VOLUME,
      streamVolume: DEFAULT_CHANNEL_VOLUME,
      voiceMutedLocal: false,
      streamMutedLocal: false,
    });

    applyAudioSettings(identity);
  };

  const toggleLocalMute = async () => {
    const nextMuted = !muted;
    setMuted(nextMuted);

    if (!localAudioRef.current) {
      return;
    }

    if (nextMuted) {
      await localAudioRef.current.mute();
    } else {
      await localAudioRef.current.unmute();
    }

    const localIdentity = roomRef.current?.localParticipant.identity ?? session.user.id;
    patchParticipant(localIdentity, { voiceMutedLocal: nextMuted });
  };

  const hideStream = (identity: string) => {
    setHiddenStreamsByIdentity((previous) => hideStreamIdentity(previous, identity));
  };

  const restoreStream = (identity: string) => {
    setHiddenStreamsByIdentity((previous) => restoreStreamIdentity(previous, identity));
  };

  const setLayoutMode = (mode: StreamLayoutMode) => {
    dispatchLayout({ type: "set-mode", mode });
  };

  const setFocusedStream = (sid: string | null) => {
    dispatchLayout({ type: "set-focus", sid });
  };

  const startScreenShare = async () => {
    if (!roomRef.current) {
      return;
    }

    try {
      const config = buildScreenShareConfig(streamStartOptions);

      try {
        await roomRef.current.localParticipant.setScreenShareEnabled(
          true,
          config.captureOptions,
          config.publishOptions,
        );
      } catch (reason) {
        if (!config.fallback) {
          throw reason;
        }

        await roomRef.current.localParticipant.setScreenShareEnabled(
          true,
          config.fallback.captureOptions,
          config.fallback.publishOptions,
        );

        setStreamStartOptions((previous) => ({
          ...previous,
          fps: 30,
        }));

        setError(config.fallback.notice);
      }

      setSharing(true);
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : "Failed to start screen share.";
      setError(message);
      setSharing(roomRef.current.localParticipant.isScreenShareEnabled);
    }
  };

  const stopScreenShare = async () => {
    if (!roomRef.current) {
      return;
    }

    try {
      await roomRef.current.localParticipant.setScreenShareEnabled(false);
      setSharing(false);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Failed to stop screen share.";
      setError(message);
    }
  };

  const changeMicrophoneDevice = async (nextDeviceId: string) => {
    if (!nextDeviceId) {
      return;
    }

    setSelectedInputId(nextDeviceId);
    selectedInputRef.current = nextDeviceId;

    const room = roomRef.current;
    if (!room) {
      return;
    }

    setDevicesLoading(true);
    try {
      const switched = await room.switchActiveDevice("audioinput", nextDeviceId, true);
      if (!switched) {
        await createAndPublishMicrophoneTrack(room, nextDeviceId);
      }
      setError(null);
    } catch {
      try {
        await createAndPublishMicrophoneTrack(room, nextDeviceId);
        setError(null);
      } catch (reason) {
        const message =
          reason instanceof Error ? reason.message : "Could not switch microphone.";
        setError(message);
      }
    } finally {
      setDevicesLoading(false);
      syncParticipants(room);
    }
  };

  const changeOutputDevice = async (nextDeviceId: string) => {
    setSelectedOutputId(nextDeviceId);
    selectedOutputRef.current = nextDeviceId;

    if (nextDeviceId) {
      for (const binding of audioBindingsRef.current.values()) {
        disableBoostPath(binding);
      }
    }

    const room = roomRef.current;
    if (room) {
      try {
        await room.switchActiveDevice("audiooutput", nextDeviceId, true);
      } catch {
        // best effort on browser-specific output routing
      }
    }

    for (const binding of audioBindingsRef.current.values()) {
      void applyOutputDevice(binding);
      applyBindingAudioSettings(binding);
    }
  };

  const updateDspSettings = (settings: DspSettings) => {
    setDspSettings(settings);
  };

  const applyDspSettings = async () => {
    const room = roomRef.current;
    if (!room) {
      return;
    }

    setDspApplying(true);
    try {
      await createAndPublishMicrophoneTrack(room, selectedInputRef.current || undefined);
      setError(null);
    } catch (reason) {
      const message =
        reason instanceof Error
          ? reason.message
          : "Could not apply microphone processing options.";
      setError(message);
    } finally {
      setDspApplying(false);
      syncParticipants(room);
    }
  };

  const updateStreamStartOptions = (patch: Partial<StreamStartOptions>) => {
    setStreamStartOptions((previous) => ({
      ...previous,
      ...patch,
    }));
  };

  return {
    connected,
    muted,
    sharing,
    error,
    setError,
    participants,
    participantMap,
    visibleScreenTracks,
    hiddenStreamIdentities,
    totalStreamsCount: screenTracks.length,
    layoutState,
    effectiveStreamMode,
    focusedStreamSid,
    focusedScreenTrack,
    secondaryFocusTracks,
    inputDevices,
    outputDevices,
    selectedInputId,
    selectedOutputId,
    devicesLoading,
    dspSettings,
    dspApplying,
    streamStartOptions,
    supportsOutputSelection: supportsAudioOutputSelection(),
    remoteParticipantsCount: participants.filter((participant) => !participant.isLocal).length,
    setLayoutMode,
    setFocusedStream,
    toggleLocalMute,
    startScreenShare,
    stopScreenShare,
    changeMicrophoneDevice,
    changeOutputDevice,
    updateDspSettings,
    applyDspSettings,
    updateStreamStartOptions,
    setChannelVolume,
    setChannelMuted,
    resetParticipantAudio,
    hideStream,
    restoreStream,
  };
}
