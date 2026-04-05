namespace Cascad.Api.Contracts.Channels;

public sealed record MentionCandidatesResponse(
    IReadOnlyList<MentionCandidateDto> Users);
