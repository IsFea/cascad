using Cascad.Api.Options;
using Microsoft.Extensions.Options;

namespace Cascad.Api.Services;

public sealed class VoicePresenceCleanupHostedService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<VoicePresenceCleanupHostedService> _logger;
    private readonly TimeSpan _cleanupInterval;

    public VoicePresenceCleanupHostedService(
        IServiceScopeFactory scopeFactory,
        IOptions<VoicePresenceOptions> options,
        ILogger<VoicePresenceCleanupHostedService> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
        _cleanupInterval = TimeSpan.FromSeconds(Math.Max(1, options.Value.CleanupIntervalSeconds));
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await RunCleanupCycleAsync(stoppingToken);

        using var timer = new PeriodicTimer(_cleanupInterval);
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            await RunCleanupCycleAsync(stoppingToken);
        }
    }

    private async Task RunCleanupCycleAsync(CancellationToken cancellationToken)
    {
        try
        {
            using var scope = _scopeFactory.CreateScope();
            var maintenance = scope.ServiceProvider.GetRequiredService<IVoicePresenceMaintenanceService>();
            await maintenance.CleanupStaleVoiceStateAsync(cancellationToken, "hosted-service");
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // normal shutdown
        }
        catch (Exception exception)
        {
            _logger.LogError(exception, "Voice presence cleanup cycle failed.");
        }
    }
}
