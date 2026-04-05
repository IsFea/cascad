using System.Net;
using System.Text.RegularExpressions;

namespace Cascad.Api.Services;

public interface IMessageContentSanitizer
{
    string Sanitize(string content);
}

public sealed partial class MessageContentSanitizer : IMessageContentSanitizer
{
    public string Sanitize(string content)
    {
        if (string.IsNullOrWhiteSpace(content))
        {
            return content;
        }

        // Escape HTML special characters to prevent XSS
        var sanitized = WebUtility.HtmlEncode(content);

        // Auto-link URLs
        sanitized = UrlRegex().Replace(sanitized, "<a href=\"$0\" target=\"_blank\" rel=\"noopener noreferrer\">$0</a>");

        // Bold: **text** or __text__
        sanitized = BoldRegex().Replace(sanitized, "<strong>$1</strong>");

        // Italic: *text* (not inside other * chars)
        sanitized = ItalicRegex().Replace(sanitized, "<em>$1</em>");

        // Inline code: `text`
        sanitized = InlineCodeRegex().Replace(sanitized, "<code>$1</code>");

        // Code blocks: ```text```
        sanitized = CodeBlockRegex().Replace(sanitized, "<pre><code>$1</code></pre>");

        // @mentions: wrap in styled span for highlighting
        sanitized = MentionRegex().Replace(sanitized, "<span class=\"mention\">$0</span>");

        return sanitized;
    }

    [GeneratedRegex(@"https?:\/\/[^\s<""&]+", RegexOptions.Compiled)]
    private static partial Regex UrlRegex();

    [GeneratedRegex(@"\*\*(.+?)\*\*", RegexOptions.Compiled)]
    private static partial Regex BoldRegex();

    [GeneratedRegex(@"(?<!\S)\*(?!\*)(.+?)(?<!\*)\*(?!\S)", RegexOptions.Compiled)]
    private static partial Regex ItalicRegex();

    [GeneratedRegex(@"`([^`]+?)`", RegexOptions.Compiled)]
    private static partial Regex InlineCodeRegex();

    [GeneratedRegex(@"```([\s\S]*?)```", RegexOptions.Compiled)]
    private static partial Regex CodeBlockRegex();

    [GeneratedRegex(@"@([\p{L}\p{N}._\-]{2,32})", RegexOptions.Compiled)]
    private static partial Regex MentionRegex();
}
