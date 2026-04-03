namespace Cascad.Api.Contracts.Rooms;

public sealed record RoomDto(
    Guid Id,
    string Name,
    string LiveKitRoomName,
    Guid OwnerUserId,
    DateTime CreatedAtUtc);
