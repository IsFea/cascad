namespace Cascad.Api.Services;

public interface IVoicePresenceMaintenanceService
{
    Task CleanupStaleVoiceStateAsync(CancellationToken cancellationToken);
}
