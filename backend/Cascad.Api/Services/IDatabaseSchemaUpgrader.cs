namespace Cascad.Api.Services;

public interface IDatabaseSchemaUpgrader
{
    Task UpgradeAsync(CancellationToken cancellationToken = default);
}
