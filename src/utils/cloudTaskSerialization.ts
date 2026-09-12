import type { DeletedTask, PSTask } from '../types';

/** Explicit legacy-root serialization prevents task features from disappearing during cloud sync. */
export function serializeTaskForCloud<T extends PSTask | DeletedTask>(task: T, now = Date.now()): T {
  const result: Record<string, unknown> = {
    id: task.id, title: task.title, phase: task.phase, priority: task.priority,
    steps: task.steps, currentStep: task.currentStep, done: Boolean(task.done),
    pinned: Boolean(task.pinned), createdAt: task.createdAt || now,
  };
  if ('deletedAt' in task) result.deletedAt = task.deletedAt || now;
  if (task.note != null) result.note = task.note;
  if (task.completedAt != null) result.completedAt = task.completedAt;
  if (typeof task.timeSpentSeconds === 'number') result.timeSpentSeconds = task.timeSpentSeconds;
  if (task.timerRunning !== undefined) result.timerRunning = Boolean(task.timerRunning);
  if (typeof task.timerStartedAt === 'number') result.timerStartedAt = task.timerStartedAt;
  if (typeof task.countdownDurationSeconds === 'number') result.countdownDurationSeconds = task.countdownDurationSeconds;
  if (typeof task.countdownRemainingSeconds === 'number') result.countdownRemainingSeconds = task.countdownRemainingSeconds;
  if (task.autoPausedOverdue !== undefined) result.autoPausedOverdue = Boolean(task.autoPausedOverdue);
  if (Array.isArray(task.stepList)) result.stepList = task.stepList.map(step => ({
    id: step.id, title: step.title, done: Boolean(step.done),
  }));
  return result as T;
}
