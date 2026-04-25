namespace Cascad.Api.Services;

public interface IVoicePresenceMaintenanceService
{
    Task CleanupStaleVoiceStateAsync(CancellationToken cancellationToken, string source = "unknown");
}
