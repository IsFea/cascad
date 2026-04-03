using Cascad.Api.Contracts.Common;

namespace Cascad.Api.Contracts.Rooms;

public sealed record JoinRoomResponse(
    RoomDto Room,
    UserDto User,
    string AppToken,
    string RtcToken,
    string RtcUrl);
