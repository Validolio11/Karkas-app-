import type { DeletedTask, PSTask } from '../types';

/** Explicit completion remains valid in legacy archives unless marked accidental. */
export function isCompletedArchivedTask(task: DeletedTask): boolean {
  return !task.scheduledPending && task.done && task.deletionReason !== 'accidental';
}

/** Unknown legacy deletion intent must never be inferred as cancellation. */
export function isCancelledArchivedTask(task: DeletedTask): boolean {
  return !task.scheduledPending && !task.done && task.deletionReason === 'cancelled';
}

/** Select only derived analytics/AI context; keep the persisted archive complete. */
export function isRelevantArchivedTask(task: DeletedTask): boolean {
  return isCompletedArchivedTask(task) || isCancelledArchivedTask(task);
}

/** Current tasks win; the first archive row is authoritative even when excluded. */
export function selectArchivedTasks(tasks: readonly Pick<PSTask, 'id'>[], archive: readonly DeletedTask[]): DeletedTask[] {
  const hasId = (id: unknown): id is string => typeof id === 'string' && id.trim().length > 0;
  const seenIds = new Set(tasks.map(task => task.id).filter(hasId));
  return archive.filter(task => {
    if (hasId(task.id)) {
      if (seenIds.has(task.id)) return false;
      seenIds.add(task.id);
    }
    return true;
  });
}

export function selectRelevantArchivedTasks(tasks: readonly Pick<PSTask, 'id'>[], archive: readonly DeletedTask[]): DeletedTask[] {
  return selectArchivedTasks(tasks, archive).filter(isRelevantArchivedTask);
}
