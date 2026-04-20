import { RemoteAudioTrack, VideoTrack } from "livekit-client";

export type ScreenTrackState = {
  sid: string;
  participantIdentity: string;
  track: VideoTrack;
};

export type ParticipantState = {
  identity: string;
  displayName: string;
  isLocal: boolean;
  isScreenSharing: boolean;
  voiceVolume: number;
  streamVolume: number;
  voiceMutedLocal: boolean;
  streamMutedLocal: boolean;
  isVoiceActive: boolean;
  isScreenAudioActive: boolean;
};

export type StreamContextMenuState = {
  sid: string;
  identity: string;
  mouseX: number;
  mouseY: number;
  scope: "stream";
};

export type ParticipantAudioMenuState = {
  identity: string;
  mouseX: number;
  mouseY: number;
  channelId?: string;
  scope: "normal" | "fullscreen-avatar" | "participant-rail";
};

export type AudioAnalyserHandle = {
  calculateVolume: () => number;
  cleanup: () => Promise<void>;
};

export type BoostLifecycleState = "none" | "pending" | "active" | "degraded";

export type AudioBinding = {
  sid: string;
  identity: string;
  source: "voice" | "stream";
  track: RemoteAudioTrack;
  element: HTMLAudioElement;
  isActive: boolean;
  analyser?: AudioAnalyserHandle;
  activityIntervalId?: number;
  activeUntilMs?: number;
  boostLifecycle: BoostLifecycleState;
  boostContext?: AudioContext;
  boostSourceTrackId?: string;
  boostSourceStream?: MediaStream;
  boostSourceNode?: MediaStreamAudioSourceNode;
  boostGainNode?: GainNode;
  lastBoostFailureAtMs?: number;
};

export type ElementSize = {
  width: number;
  height: number;
};
