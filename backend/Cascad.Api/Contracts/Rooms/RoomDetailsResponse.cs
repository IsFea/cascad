using Cascad.Api.Contracts.Common;

namespace Cascad.Api.Contracts.Rooms;

public sealed record RoomDetailsResponse(RoomDto Room, IReadOnlyList<UserDto> Participants);
