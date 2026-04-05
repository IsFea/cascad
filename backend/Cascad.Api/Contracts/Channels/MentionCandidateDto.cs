namespace Cascad.Api.Contracts.Channels;

public sealed record MentionCandidateDto(
    Guid UserId,
    string Username,
    string? AvatarUrl);
