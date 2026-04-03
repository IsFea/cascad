export type UserDto = {
  id: string;
  nickname: string;
};

export type RoomDto = {
  id: string;
  name: string;
  liveKitRoomName: string;
  ownerUserId: string;
  createdAtUtc: string;
};

export type GuestAuthResponse = {
  user: UserDto;
  appToken: string;
  expiresAtUtc: string;
};

export type CreateInviteResponse = {
  inviteToken: string;
  expiresAtUtc: string;
  inviteUrl: string;
};

export type JoinRoomResponse = {
  room: RoomDto;
  user: UserDto;
  appToken: string;
  rtcToken: string;
  rtcUrl: string;
};

export type RoomDetailsResponse = {
  room: RoomDto;
  participants: UserDto[];
};
