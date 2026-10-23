import type { DeletedTask, PSTask, TaskCompletionLedger, TaskCompletionReceipt } from '../types';
import type { WorkspaceState } from './syncState';

export const COMPLETED_TASK_HISTORY_LIMIT = 50;

const ownReceipt = (ledger: TaskCompletionLedger | undefined, id: string): TaskCompletionReceipt | undefined =>
  ledger && Object.hasOwn(ledger, id) ? ledger[id] : undefined;

function taskStateAt(task: PSTask | DeletedTask): number {
  return Math.max(task.createdAt, task.updatedAt ?? 0, task.completedAt ?? 0,
    ...((task.activityTrail ?? []).filter(event => event.kind === 'completed' || event.kind === 'reopened').map(event => event.at)),
    'deletedAt' in task ? task.deletedAt : 0);
}

/** Merge by task ID so independent devices never overwrite each other's receipts. */
export function mergeCompletionLedgers(left?: TaskCompletionLedger, right?: TaskCompletionLedger): TaskCompletionLedger {
  const receipts = new Map<string, TaskCompletionReceipt>();
  for (const [id, receipt] of [...Object.entries(left ?? {}), ...Object.entries(right ?? {})]) {
    const previous = receipts.get(id);
    const winner = !previous || receipt.updatedAt > previous.updatedAt ||
      receipt.updatedAt === previous.updatedAt && (Number(receipt.counted) < Number(previous.counted) ||
        receipt.counted === previous.counted && receipt.completedAt > previous.completedAt)
      ? receipt : previous;
    const retiredAt = previous?.retiredAt !== undefined || receipt.retiredAt !== undefined
      ? Math.max(previous?.retiredAt ?? 0, receipt.retiredAt ?? 0) : undefined;
    receipts.set(id, { ...winner, ...(retiredAt !== undefined ? { retiredAt } : {}) });
  }
  return Object.fromEntries([...receipts].sort(([a], [b]) => a.localeCompare(b)));
}

/** Read credits before a destructive mutation without retiring any additional tasks. */
export function captureTaskCompletionLedger(tasks: readonly PSTask[], deletedTasks: readonly DeletedTask[], existing?: TaskCompletionLedger): TaskCompletionLedger {
  const ledger: TaskCompletionLedger = Object.assign(Object.create(null), mergeCompletionLedgers(existing));
  const records = [...tasks, ...selectArchivedTasks(tasks, deletedTasks)];
  for (const task of records) {
    const counted = !task.scheduledPending && task.done && !('deletionReason' in task && task.deletionReason === 'accidental');
    const previous = ledger[task.id];
    if ((!task.done || task.scheduledPending) && !previous) continue;
    const updatedAt = taskStateAt(task);
    if (previous?.retiredAt !== undefined && updatedAt <= previous.retiredAt) continue;
    // Restoring or editing an excluded completed record must not grant its credit again.
    // Only a later actual completion can supersede an explicit false receipt.
    // In recorded history, changing the displayed completion date is only an edit.
    // Legacy records without a trail retain their timestamp-based completion evidence.
    const lastCompletionAt = task.activityTrail?.length
      ? Math.max(0, ...task.activityTrail.filter(event => event.kind === 'completed').map(event => event.at))
      : task.completedAt ?? 0;
    if (previous && !previous.counted && counted && lastCompletionAt <= previous.updatedAt) continue;
    if (previous && (previous.updatedAt > updatedAt ||
      previous.updatedAt === updatedAt && !previous.counted && counted)) continue;
    ledger[task.id] = {
      completedAt: task.completedAt ?? previous?.completedAt ?? task.createdAt,
      updatedAt,
      counted,
      ...(previous?.retiredAt !== undefined ? { retiredAt: previous.retiredAt } : {}),
    };
  }
  return Object.fromEntries(Object.entries(ledger));
}

/** Capture history before pruning, and remove stale copies previously retired on another device. */
export function normalizeCompletedTaskHistory(workspace: WorkspaceState, now = Date.now()): WorkspaceState {
  const ledger: TaskCompletionLedger = Object.assign(Object.create(null),
    captureTaskCompletionLedger(workspace.tasks, workspace.deletedTasks, workspace.settings.completionLedger));
  const retired = (task: PSTask | DeletedTask) => {
    const receipt = ledger[task.id];
    return receipt?.retiredAt !== undefined && taskStateAt(task) <= receipt.retiredAt;
  };
  let tasks = workspace.tasks.filter(task => !retired(task));
  let deletedTasks = workspace.deletedTasks.filter(task => !retired(task));
  const records = [...tasks, ...selectArchivedTasks(tasks, deletedTasks)];
  const completed = records.filter(task => !task.scheduledPending && task.done
    && !('deletionReason' in task && task.deletionReason === 'accidental'))
    .sort((a, b) => (b.completedAt ?? b.createdAt) - (a.completedAt ?? a.createdAt) || a.id.localeCompare(b.id));
  const overflow = new Set(completed.slice(COMPLETED_TASK_HISTORY_LIMIT).map(task => task.id));
  for (const task of completed) {
    if (!overflow.has(task.id)) continue;
    const previous = ledger[task.id];
    ledger[task.id] = { ...previous, retiredAt: Math.max(now, taskStateAt(task), previous.retiredAt ?? 0) };
  }
  if (overflow.size) {
    tasks = tasks.filter(task => !overflow.has(task.id));
    deletedTasks = deletedTasks.filter(task => !overflow.has(task.id));
  }
  return {
    ...workspace,
    tasks,
    deletedTasks,
    settings: {
      ...workspace.settings,
      ...(Object.keys(ledger).length || workspace.settings.completionLedger !== undefined
        ? { completionLedger: Object.fromEntries(Object.entries(ledger)) } : {}),
    },
  };
}

/** Remove a full completed record while retaining either its credit or an accidental exclusion. */
export function retireCompletedTask(workspace: WorkspaceState, id: string, options: { accidental?: boolean } = {}, now = Date.now()): WorkspaceState {
  const task = workspace.tasks.find(task => task.id === id) ?? workspace.deletedTasks.find(task => task.id === id);
  if (!task || !task.done || task.scheduledPending) return workspace;
  // Capture the final status before dropping its only full record; callers may
  // purge a fresh completion before the next normal history normalization.
  const captured = captureTaskCompletionLedger(workspace.tasks, workspace.deletedTasks, workspace.settings.completionLedger);
  const previous = ownReceipt(captured, id);
  const updatedAt = Math.max(now, taskStateAt(task), (previous?.updatedAt ?? 0) + 1, (previous?.retiredAt ?? 0) + 1);
  return normalizeCompletedTaskHistory({
    ...workspace,
    tasks: workspace.tasks.filter(task => task.id !== id),
    deletedTasks: workspace.deletedTasks.filter(task => task.id !== id),
    settings: { ...workspace.settings, completionLedger: {
      ...captured,
      [id]: { completedAt: task.completedAt ?? previous?.completedAt ?? task.createdAt,
        updatedAt, counted: !options.accidental && previous?.counted !== false && !('deletionReason' in task && task.deletionReason === 'accidental'), retiredAt: updatedAt },
    } },
  }, now);
}

/** Lifetime unique completion count; reopening and accidental entries do not count. */
export function countCompletedTasks(workspace: WorkspaceState): number {
  const normalized = normalizeCompletedTaskHistory(workspace);
  return Object.values(normalized.settings.completionLedger ?? {}).filter(receipt => receipt.counted).length;
}

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
