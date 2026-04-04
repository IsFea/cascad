namespace Cascad.Api.Realtime;

public static class ChatGroupNames
{
    public static string Workspace(Guid workspaceId) => $"workspace:{workspaceId:N}";

    public static string TextChannel(Guid channelId) => $"text:{channelId:N}";

    public static string VoiceChannel(Guid channelId) => $"voice:{channelId:N}";
}
