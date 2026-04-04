namespace Cascad.Api.Contracts.Voice;

public sealed record VoiceConnectResponse(
    Guid ChannelId,
    string ChannelName,
    string LiveKitRoomName,
    string RtcToken,
    string RtcUrl,
    int? MaxParticipants,
    int? MaxConcurrentStreams);
