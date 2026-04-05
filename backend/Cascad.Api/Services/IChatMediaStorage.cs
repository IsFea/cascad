using Cascad.Api.Contracts.Uploads;
using Microsoft.AspNetCore.Http;

namespace Cascad.Api.Services;

public interface IChatMediaStorage
{
    Task<UploadImageResponse> SaveChatImageAsync(IFormFile file, CancellationToken cancellationToken);
}
