namespace TeamTaskManager.Application.Authentication;

public interface IAuthenticationService
{
    Task<LoginResponse?> LoginAsync(LoginRequest request, CancellationToken cancellationToken = default);

    Task<AuthenticatedUser?> GetUserAsync(string userId, CancellationToken cancellationToken = default);

    Task<IReadOnlyCollection<string>> ChangePasswordAsync(
        string userId,
        ChangePasswordRequest request,
        CancellationToken cancellationToken = default);
}
