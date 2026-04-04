namespace Cascad.Api.Contracts.Voice;

public sealed record VoiceConnectResponse(
    Guid ChannelId,
    string ChannelName,
    string LiveKitRoomName,
    string RtcToken,
    string RtcUrl,
    string SessionInstanceId,
    int? MaxParticipants,
    int? MaxConcurrentStreams);
