using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using TeamTaskManager.Application.Tasks;
using TeamTaskManager.Application.Activities;
using TeamTaskManager.Application.Notifications;
using TeamTaskManager.Application.Users;
using TeamTaskManager.Domain.Entities;
using TeamTaskManager.Domain.Enums;
using TeamTaskManager.Infrastructure.Persistence;
using DomainTaskStatus = TeamTaskManager.Domain.Enums.TaskStatus;

namespace TeamTaskManager.Infrastructure.Tasks;

public sealed class TaskManagementService(
    ApplicationDbContext dbContext,
    UserManager<ApplicationUser> userManager,
    IActivityLogService activityLogService,
    INotificationService notificationService) : ITaskManagementService
{
    public Task<PagedResult<TaskItemDto>> GetTasksAsync(TaskAccessContext access, TaskListQuery query, CancellationToken cancellationToken = default) =>
        GetPagedAsync(GetAccessibleTasks(access), query, cancellationToken);

    public Task<PagedResult<TaskItemDto>> GetMyTasksAsync(TaskAccessContext access, TaskListQuery query, CancellationToken cancellationToken = default) =>
        GetPagedAsync(dbContext.TaskItems.AsNoTracking().Where(task => !task.IsArchived && task.AssignedUserId == access.UserId), query, cancellationToken);

    public async Task<TaskItemDto?> GetByIdAsync(TaskAccessContext access, int taskId, CancellationToken cancellationToken = default)
    {
        var task = await GetAccessibleTasks(access).SingleOrDefaultAsync(item => item.Id == taskId, cancellationToken);
        return task is null ? null : ToDto(task);
    }

    public async Task<TaskOperationResult<TaskItemDto>> CreateAsync(TaskAccessContext access, CreateTaskRequest request, CancellationToken cancellationToken = default)
    {
        var errors = ValidateRequest(request);
        var project = await dbContext.Projects
            .Include(candidate => candidate.Members)
            .SingleOrDefaultAsync(candidate => candidate.Id == request.ProjectId && !candidate.IsArchived, cancellationToken);

        if (project is null)
        {
            errors.Add("Proje bulunamadı veya arşivlenmiş durumda.");
        }
        else
        {
            if (project.Status is ProjectStatus.Completed or ProjectStatus.Cancelled)
            {
                errors.Add("Tamamlanmış veya iptal edilmiş projeye görev eklenemez.");
            }

            if (!access.IsAdmin && project.ManagerUserId != access.UserId)
            {
                errors.Add("Bu projede görev oluşturma yetkiniz yok.");
            }

            if (!project.Members.Any(member => member.UserId == request.AssignedUserId && member.IsActive))
            {
                errors.Add("Görev yalnızca projenin aktif üyelerinden birine atanabilir.");
            }
        }

        var assignedUser = await userManager.FindByIdAsync(request.AssignedUserId);
        if (assignedUser is null || !assignedUser.IsActive)
        {
            errors.Add("Atanan kullanıcı bulunamadı veya pasif durumda.");
        }

        if (errors.Count > 0)
        {
            return TaskOperationResult<TaskItemDto>.Failure(errors.ToArray());
        }

        var task = new TaskItem
        {
            ProjectId = request.ProjectId,
            Title = request.Title.Trim(),
            Description = NormalizeDescription(request.Description),
            AssignedUserId = request.AssignedUserId,
            Priority = request.Priority,
            Status = DomainTaskStatus.New,
            StartDate = request.StartDate,
            DueDate = request.DueDate,
            CreatedByUserId = access.UserId
        };

        dbContext.TaskItems.Add(task);
        await dbContext.SaveChangesAsync(cancellationToken);
        await activityLogService.WriteAsync(access.UserId, "TaskItem", task.Id, "Created", "Görev oluşturuldu.", cancellationToken);
        if (task.AssignedUserId != access.UserId) await notificationService.NotifyAsync(task.AssignedUserId, "Yeni görev atandı", $"'{task.Title}' görevi size atandı.", NotificationType.TaskAssigned, task.Id, cancellationToken);
        return TaskOperationResult<TaskItemDto>.Success(ToDto(task));
    }

    public async Task<TaskOperationResult<TaskItemDto>> UpdateStatusAsync(
        TaskAccessContext access,
        int taskId,
        UpdateTaskStatusRequest request,
        CancellationToken cancellationToken = default)
    {
        var task = await dbContext.TaskItems
            .Include(item => item.Project)
            .ThenInclude(project => project.Members)
            .SingleOrDefaultAsync(item => item.Id == taskId && !item.IsArchived, cancellationToken);
        if (task is null)
        {
            return TaskOperationResult<TaskItemDto>.Failure("Görev bulunamadı.");
        }

        var isManager = access.IsAdmin || task.Project.ManagerUserId == access.UserId;
        var isAssignedUser = task.AssignedUserId == access.UserId && task.Project.Members.Any(member => member.UserId == access.UserId && member.IsActive);
        if (!isManager && !isAssignedUser)
        {
            return TaskOperationResult<TaskItemDto>.Failure("Bu görevin durumunu güncelleme yetkiniz yok.");
        }

        if (!Enum.IsDefined(request.Status))
        {
            return TaskOperationResult<TaskItemDto>.Failure("Geçersiz görev durumu.");
        }

        if (!IsTransitionAllowed(task.Status, request.Status))
        {
            return TaskOperationResult<TaskItemDto>.Failure("Bu görev durumu geçişine izin verilmiyor.");
        }

        if (task.Status is DomainTaskStatus.Completed or DomainTaskStatus.Cancelled && !isManager)
        {
            return TaskOperationResult<TaskItemDto>.Failure("Tamamlanmış veya iptal edilmiş görevi yalnız proje yöneticisi yeniden açabilir.");
        }

        task.Status = request.Status;
        task.CompletedDate = request.Status == DomainTaskStatus.Completed ? DateTime.UtcNow : null;
        task.UpdatedDate = DateTime.UtcNow;
        await dbContext.SaveChangesAsync(cancellationToken);
        await activityLogService.WriteAsync(access.UserId, "TaskItem", task.Id, "StatusChanged", "Görev durumu güncellendi.", cancellationToken);
        if (task.AssignedUserId != access.UserId) await notificationService.NotifyAsync(task.AssignedUserId, "Görev durumu güncellendi", $"'{task.Title}' görevinin durumu {task.Status} oldu.", NotificationType.TaskUpdated, task.Id, cancellationToken);

        return TaskOperationResult<TaskItemDto>.Success(ToDto(task));
    }

    private async Task<PagedResult<TaskItemDto>> GetPagedAsync(IQueryable<TaskItem> tasks, TaskListQuery query, CancellationToken cancellationToken)
    {
        var pageNumber = Math.Max(1, query.PageNumber);
        var pageSize = Math.Clamp(query.PageSize, 1, 100);

        if (query.ProjectId.HasValue) tasks = tasks.Where(task => task.ProjectId == query.ProjectId.Value);
        if (!string.IsNullOrWhiteSpace(query.AssignedUserId)) tasks = tasks.Where(task => task.AssignedUserId == query.AssignedUserId);
        if (query.Status.HasValue) tasks = tasks.Where(task => task.Status == query.Status.Value);
        if (query.Priority.HasValue) tasks = tasks.Where(task => task.Priority == query.Priority.Value);
        if (query.DueFrom.HasValue) tasks = tasks.Where(task => task.DueDate >= query.DueFrom.Value);
        if (query.DueTo.HasValue) tasks = tasks.Where(task => task.DueDate <= query.DueTo.Value);

        var totalCount = await tasks.CountAsync(cancellationToken);
        tasks = query.Sort?.ToLowerInvariant() switch
        {
            "duedate:asc" => tasks.OrderBy(task => task.DueDate),
            "duedate:desc" => tasks.OrderByDescending(task => task.DueDate),
            "createddate:asc" => tasks.OrderBy(task => task.CreatedDate),
            _ => tasks.OrderByDescending(task => task.CreatedDate)
        };

        var page = await tasks.Skip((pageNumber - 1) * pageSize).Take(pageSize).ToListAsync(cancellationToken);
        return new PagedResult<TaskItemDto>(page.Select(ToDto).ToArray(), pageNumber, pageSize, totalCount, (int)Math.Ceiling(totalCount / (double)pageSize));
    }

    private IQueryable<TaskItem> GetAccessibleTasks(TaskAccessContext access)
    {
        var tasks = dbContext.TaskItems.AsNoTracking().Where(task => !task.IsArchived);
        return access.IsAdmin
            ? tasks
            : tasks.Where(task => task.Project.ManagerUserId == access.UserId || task.Project.Members.Any(member => member.UserId == access.UserId && member.IsActive));
    }

    private static List<string> ValidateRequest(CreateTaskRequest request)
    {
        var errors = new List<string>();
        if (request.ProjectId <= 0) errors.Add("Geçerli proje kimliği zorunludur.");
        if (string.IsNullOrWhiteSpace(request.Title) || request.Title.Trim().Length is < 3 or > 200) errors.Add("Görev başlığı 3 ile 200 karakter arasında olmalıdır.");
        if (request.Description?.Length > 5000) errors.Add("Görev açıklaması en fazla 5000 karakter olabilir.");
        if (string.IsNullOrWhiteSpace(request.AssignedUserId)) errors.Add("Atanan kullanıcı zorunludur.");
        if (!Enum.IsDefined(request.Priority)) errors.Add("Geçersiz görev önceliği.");
        if (request.StartDate.HasValue && request.DueDate < request.StartDate.Value) errors.Add("Bitiş tarihi başlangıç tarihinden önce olamaz.");
        return errors;
    }

    private static string? NormalizeDescription(string? description) => string.IsNullOrWhiteSpace(description) ? null : description.Trim();

    private static bool IsTransitionAllowed(DomainTaskStatus currentStatus, DomainTaskStatus targetStatus) =>
        (currentStatus, targetStatus) switch
        {
            (DomainTaskStatus.New, DomainTaskStatus.InProgress or DomainTaskStatus.OnHold or DomainTaskStatus.Cancelled) => true,
            (DomainTaskStatus.InProgress, DomainTaskStatus.OnHold or DomainTaskStatus.Completed or DomainTaskStatus.Cancelled) => true,
            (DomainTaskStatus.OnHold, DomainTaskStatus.InProgress or DomainTaskStatus.Cancelled) => true,
            (DomainTaskStatus.Completed, DomainTaskStatus.InProgress) => true,
            (DomainTaskStatus.Cancelled, DomainTaskStatus.New) => true,
            _ => false
        };

    private static TaskItemDto ToDto(TaskItem task) =>
        new(task.Id, task.ProjectId, task.Title, task.Description, task.AssignedUserId, task.Priority, task.Status, task.StartDate, task.DueDate, task.CompletedDate, task.CreatedByUserId, task.CreatedDate, task.UpdatedDate);
}
