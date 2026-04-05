using System.Collections.Concurrent;

namespace Cascad.Api.Services;

public interface IRateLimitingService
{
    bool AllowMessage(Guid userId, Guid channelId);
}

public sealed class RateLimitingService : IRateLimitingService
{
    private readonly ConcurrentDictionary<string, List<DateTime>> _messageTimestamps = new();
    private readonly TimeSpan _window = TimeSpan.FromMinutes(1);
    private const int MaxMessagesPerWindow = 30;

    public bool AllowMessage(Guid userId, Guid channelId)
    {
        var key = $"{userId}:{channelId}";
        var now = DateTime.UtcNow;
        var windowStart = now - _window;

        var timestamps = _messageTimestamps.GetOrAdd(key, _ => new List<DateTime>());

        lock (timestamps)
        {
            // Remove old entries outside the window
            timestamps.RemoveAll(t => t < windowStart);

            if (timestamps.Count >= MaxMessagesPerWindow)
            {
                return false;
            }

            timestamps.Add(now);
            return true;
        }
    }
}
