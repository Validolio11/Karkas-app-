import type { AnalyticsPeriod, DeletedTask, PSTask, TaskStepItem } from '../types';

export function getPeriodBounds(period: AnalyticsPeriod, now: Date) {
  const year = now.getFullYear();
  const month = now.getMonth();
  const end = now.getTime();
  switch (period) {
    case 'THIS_YEAR': return { start: new Date(year, 0, 1).getTime(), end };
    case 'LAST_YEAR': return { start: new Date(year - 1, 0, 1).getTime(), end: new Date(year, 0, 1).getTime() - 1 };
    case 'THIS_MONTH': return { start: new Date(year, month, 1).getTime(), end };
    case 'LAST_30_DAYS': return { start: end - 30 * 24 * 60 * 60 * 1000, end };
    default: return { start: -Infinity, end };
  }
}

export function selectPeriodTasks(tasks: PSTask[], deletedTasks: DeletedTask[], period: AnalyticsPeriod, now: Date) {
  const { start, end } = getPeriodBounds(period, now);
  const inPeriod = (timestamp: number) => Number.isFinite(timestamp) && timestamp >= start && timestamp <= end;
  // Older saved tasks can lack a completion date. Preserve their historical fallback.
  const completedInPeriod = tasks.filter(task => task.done && inPeriod(task.completedAt || task.createdAt));
  const deletedCompleted = deletedTasks.filter(task => task.done && inPeriod(task.completedAt || task.createdAt));
  return {
    activeInPeriod: tasks.filter(task => !task.done && inPeriod(task.createdAt)),
    completedInPeriod,
    deletedCompleted,
    deletedInPeriod: deletedTasks.filter(task => inPeriod(task.deletedAt)),
    droppedInPeriod: deletedTasks.filter(task => !task.done && inPeriod(task.deletedAt)),
    createdInPeriod: [...tasks, ...deletedTasks].filter(task => inPeriod(task.createdAt)),
  };
}

export function getRollingWindows(now: number, days: number, count = 4) {
  const width = days * 24 * 60 * 60 * 1000 / count;
  return Array.from({ length: count }, (_, index) => ({
    start: now - (count - index) * width,
    end: now - (count - index - 1) * width,
    includeStart: index === 0,
  }));
}

export function getPendingTaskIndexes(taskCount: number, injectedIndexes: readonly number[]) {
  const injected = new Set(injectedIndexes);
  return Array.from({ length: taskCount }, (_, index) => index).filter(index => !injected.has(index));
}

export function getNextPendingStepIndex(steps: readonly TaskStepItem[]) {
  return steps.findIndex(step => !step.done);
}
