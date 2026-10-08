import type { DeletedTask, PSTask } from '../types';

/** Explicit legacy-root serialization prevents task features from disappearing during cloud sync. */
export function serializeTaskForCloud<T extends PSTask | DeletedTask>(task: T, now = Date.now()): T {
  const result: Record<string, unknown> = {
    id: task.id, title: task.title, phase: task.phase, priority: task.priority,
    steps: task.steps, currentStep: task.currentStep, done: Boolean(task.done),
    pinned: Boolean(task.pinned), createdAt: task.createdAt || now,
  };
  if ('deletedAt' in task) {
    result.deletedAt = task.deletedAt || now;
    if ('deletionReason' in task && (task.deletionReason === 'accidental' || task.deletionReason === 'cancelled')) result.deletionReason = task.deletionReason;
  }
  if (task.note != null) result.note = task.note;
  if (task.completedAt != null) result.completedAt = task.completedAt;
  if (Number.isFinite(task.startedAt)) result.startedAt = task.startedAt;
  if (task.timerMode === 'none' || task.timerMode === 'stopwatch' || task.timerMode === 'countdown') result.timerMode = task.timerMode;
  if (Number.isFinite(task.timeSpentSeconds)) result.timeSpentSeconds = task.timeSpentSeconds;
  if (task.timerRunning !== undefined) result.timerRunning = Boolean(task.timerRunning);
  if (Number.isFinite(task.timerStartedAt)) result.timerStartedAt = task.timerStartedAt;
  if (Number.isFinite(task.countdownDurationSeconds)) result.countdownDurationSeconds = task.countdownDurationSeconds;
  if (Number.isFinite(task.countdownRemainingSeconds)) result.countdownRemainingSeconds = task.countdownRemainingSeconds;
  if (task.autoPausedOverdue !== undefined) result.autoPausedOverdue = Boolean(task.autoPausedOverdue);
  if (Array.isArray(task.stepList)) result.stepList = task.stepList.map(step => ({
    id: step.id, title: step.title, done: Boolean(step.done),
  }));
  return result as T;
}
