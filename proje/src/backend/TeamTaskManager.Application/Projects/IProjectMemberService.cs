namespace TeamTaskManager.Application.Projects;

public interface IProjectMemberService
{
    Task<IReadOnlyCollection<ProjectMemberDto>?> GetMembersAsync(
        ProjectAccessContext access,
        int projectId,
        CancellationToken cancellationToken = default);

    Task<ProjectOperationResult<ProjectMemberDto>> AddAsync(
        ProjectAccessContext access,
        int projectId,
        AddProjectMemberRequest request,
        CancellationToken cancellationToken = default);

    Task<ProjectOperationResult<ProjectMemberDto>> RemoveAsync(
        ProjectAccessContext access,
        int projectId,
        string userId,
        CancellationToken cancellationToken = default);
}
