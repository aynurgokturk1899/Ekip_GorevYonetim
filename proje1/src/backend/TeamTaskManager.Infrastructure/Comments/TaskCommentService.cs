using Microsoft.EntityFrameworkCore;
using TeamTaskManager.Application.Activities;
using TeamTaskManager.Application.Comments;
using TeamTaskManager.Application.Tasks;
using TeamTaskManager.Application.Notifications;
using TeamTaskManager.Domain.Enums;
using TeamTaskManager.Domain.Entities;
using TeamTaskManager.Infrastructure.Persistence;

namespace TeamTaskManager.Infrastructure.Comments;

public sealed class TaskCommentService(
    ApplicationDbContext dbContext,
    IActivityLogService activityLogService,
    INotificationService notificationService) : ITaskCommentService
{
    public async Task<IReadOnlyCollection<TaskCommentDto>?> GetCommentsAsync(TaskAccessContext access, int taskId, CancellationToken cancellationToken = default)
    {
        if (!await HasProjectAccessAsync(access, taskId, cancellationToken)) return null;

        return await dbContext.TaskComments.AsNoTracking()
            .Where(comment => comment.TaskItemId == taskId)
            .OrderBy(comment => comment.CreatedDate)
            .Select(comment => ToDto(comment))
            .ToListAsync(cancellationToken);
    }

    public async Task<CommentOperationResult<TaskCommentDto>> CreateAsync(TaskAccessContext access, int taskId, CreateTaskCommentRequest request, CancellationToken cancellationToken = default)
    {
        if (!await HasProjectAccessAsync(access, taskId, cancellationToken))
        {
            return CommentOperationResult<TaskCommentDto>.Failure("Görev bulunamadı veya yorum ekleme yetkiniz yok.");
        }

        var content = request.Content?.Trim();
        if (string.IsNullOrWhiteSpace(content) || content.Length > 1500)
        {
            return CommentOperationResult<TaskCommentDto>.Failure("Yorum boş olamaz ve en fazla 1500 karakter olabilir.");
        }

        var comment = new TaskComment { TaskItemId = taskId, UserId = access.UserId, Content = content };
        dbContext.TaskComments.Add(comment);
        await dbContext.SaveChangesAsync(cancellationToken);
        await activityLogService.WriteAsync(access.UserId, "TaskItem", taskId, "CommentCreated", "Göreve yorum eklendi.", cancellationToken);
        var assignedUserId = await dbContext.TaskItems.Where(task => task.Id == taskId).Select(task => task.AssignedUserId).SingleAsync(cancellationToken);
        if (assignedUserId != access.UserId) await notificationService.NotifyAsync(assignedUserId, "Göreve yorum eklendi", "Size atanan göreve yeni yorum eklendi.", NotificationType.CommentAdded, taskId, cancellationToken);
        return CommentOperationResult<TaskCommentDto>.Success(ToDto(comment));
    }

    public async Task<CommentOperationResult<TaskCommentDto>> UpdateAsync(TaskAccessContext access, int commentId, UpdateTaskCommentRequest request, CancellationToken cancellationToken = default)
    {
        var comment = await dbContext.TaskComments.SingleOrDefaultAsync(candidate => candidate.Id == commentId, cancellationToken);
        if (comment is null || comment.UserId != access.UserId)
        {
            return CommentOperationResult<TaskCommentDto>.Failure("Yorum bulunamadı veya güncelleme yetkiniz yok.");
        }

        var content = request.Content?.Trim();
        if (string.IsNullOrWhiteSpace(content) || content.Length > 1500)
        {
            return CommentOperationResult<TaskCommentDto>.Failure("Yorum boş olamaz ve en fazla 1500 karakter olabilir.");
        }

        comment.Content = content;
        comment.UpdatedDate = DateTime.UtcNow;
        await dbContext.SaveChangesAsync(cancellationToken);
        await activityLogService.WriteAsync(access.UserId, "TaskItem", comment.TaskItemId, "CommentUpdated", "Görev yorumu güncellendi.", cancellationToken);
        return CommentOperationResult<TaskCommentDto>.Success(ToDto(comment));
    }

    public async Task<CommentOperationResult<TaskCommentDto>> DeleteAsync(TaskAccessContext access, int commentId, CancellationToken cancellationToken = default)
    {
        var comment = await dbContext.TaskComments.SingleOrDefaultAsync(candidate => candidate.Id == commentId, cancellationToken);
        if (comment is null || comment.UserId != access.UserId)
        {
            return CommentOperationResult<TaskCommentDto>.Failure("Yorum bulunamadı veya silme yetkiniz yok.");
        }

        var result = ToDto(comment);
        dbContext.TaskComments.Remove(comment);
        await dbContext.SaveChangesAsync(cancellationToken);
        await activityLogService.WriteAsync(access.UserId, "TaskItem", result.TaskItemId, "CommentDeleted", "Görev yorumu silindi.", cancellationToken);
        return CommentOperationResult<TaskCommentDto>.Success(result);
    }

    private Task<bool> HasProjectAccessAsync(TaskAccessContext access, int taskId, CancellationToken cancellationToken) =>
        dbContext.TaskItems.AnyAsync(task => task.Id == taskId && !task.IsArchived &&
            (access.IsAdmin || task.Project.ManagerUserId == access.UserId || task.Project.Members.Any(member => member.UserId == access.UserId && member.IsActive)), cancellationToken);

    private static TaskCommentDto ToDto(TaskComment comment) => new(comment.Id, comment.TaskItemId, comment.UserId, comment.Content, comment.CreatedDate, comment.UpdatedDate);
}
