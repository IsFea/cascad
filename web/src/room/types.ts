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

export type RightPanelMode = "participants" | "chat" | "rail";

export type RoomShellLayoutState = {
  leftSidebarCollapsed: boolean;
  activeVoiceChannelId: string;
  activeTextChannelId: string;
  rightPanelMode: RightPanelMode;
};

export type AudioAnalyserHandle = {
  calculateVolume: () => number;
  cleanup: () => Promise<void>;
};

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
  boostSupported: boolean;
  boostContext?: AudioContext;
  boostSourceNode?: MediaElementAudioSourceNode;
  boostGainNode?: GainNode;
};

export type ElementSize = {
  width: number;
  height: number;
};
