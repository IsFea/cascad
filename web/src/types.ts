export type UserStatus = "Pending" | "Approved" | "Rejected";
export type PlatformRole = "User" | "Admin";
export type ChannelType = "Text" | "Voice";

export type UserDto = {
  id: string;
  username: string;
  status: UserStatus;
  role: PlatformRole;
  avatarUrl: string | null;
};

export type RegisterResponse = {
  user: UserDto;
};

export type LoginResponse = {
  user: UserDto;
  appToken: string;
  expiresAtUtc: string;
};

export type MeResponse = {
  user: UserDto;
};

export type ProfileResponse = {
  user: UserDto;
};

export type PendingApprovalDto = {
  userId: string;
  username: string;
  createdAtUtc: string;
  status: UserStatus;
};

export type ApprovalsResponse = {
  users: PendingApprovalDto[];
};

export type WorkspaceDto = {
  id: string;
  name: string;
  createdAtUtc: string;
};

export type ChannelDto = {
  id: string;
  workspaceId: string;
  name: string;
  type: ChannelType;
  position: number;
  maxParticipants: number | null;
  maxConcurrentStreams: number | null;
  liveKitRoomName: string | null;
  createdAtUtc: string;
};

export type WorkspaceMemberDto = {
  userId: string;
  username: string;
  role: PlatformRole;
  avatarUrl: string | null;
  connectedVoiceChannelId: string | null;
  isScreenSharing: boolean;
  isMuted: boolean;
  isDeafened: boolean;
  isServerMuted: boolean;
  isServerDeafened: boolean;
};

export type ChannelUnreadStateDto = {
  channelId: string;
  unreadCount: number;
  lastReadAtUtc: string | null;
};

export type ChatUnreadDto = {
  totalUnreadCount: number;
  channels: ChannelUnreadStateDto[];
};

export type WorkspaceBootstrapResponse = {
  workspace: WorkspaceDto;
  currentUser: UserDto;
  connectedVoiceChannelId: string | null;
  connectedVoiceTabInstanceId: string | null;
  channels: ChannelDto[];
  members: WorkspaceMemberDto[];
  chatUnread: ChatUnreadDto;
};

export type MessageAttachmentDto = {
  id: string;
  originalFileName: string;
  contentType: string;
  fileSizeBytes: number;
  urlPath: string;
};

export type MessageMentionDto = {
  userId: string;
  username: string;
  token: string;
};

export type ChannelMessageDto = {
  id: string;
  channelId: string;
  userId: string;
  username: string;
  avatarUrl: string | null;
  content: string;
  createdAtUtc: string;
  attachments: MessageAttachmentDto[];
  mentions: MessageMentionDto[];
};

export type ChannelMessagesResponse = {
  messages: ChannelMessageDto[];
  nextBefore: string | null;
};

export type MentionCandidateDto = {
  userId: string;
  username: string;
  avatarUrl: string | null;
};

export type MentionCandidatesResponse = {
  users: MentionCandidateDto[];
};

export type UploadImageResponse = {
  url: string;
  originalFileName: string;
  sizeBytes: number;
  contentType: string;
};

export type VoiceConnectResponse = {
  channelId: string;
  channelName: string;
  liveKitRoomName: string;
  rtcToken: string;
  rtcUrl: string;
  sessionInstanceId: string;
  maxParticipants: number | null;
  maxConcurrentStreams: number | null;
};

export type StreamPermitResponse = {
  allowed: boolean;
  reason: string | null;
  activeStreams: number;
  maxConcurrentStreams: number | null;
};

export type VoicePresenceChangedEvent = {
  workspaceId: string;
  userId: string;
  username: string;
  avatarUrl: string | null;
  previousVoiceChannelId: string | null;
  currentVoiceChannelId: string | null;
  isScreenSharing: boolean;
  isMuted: boolean;
  isDeafened: boolean;
  isServerMuted: boolean;
  isServerDeafened: boolean;
  occurredAtUtc: string;
};

export type RoomDto = {
  id: string;
  name: string;
  liveKitRoomName: string;
  ownerUserId: string;
  createdAtUtc: string;
};

export type JoinRoomResponse = {
  room: RoomDto;
  user: UserDto;
  appToken: string;
  rtcToken: string;
  rtcUrl: string;
  sessionInstanceId?: string;
};
