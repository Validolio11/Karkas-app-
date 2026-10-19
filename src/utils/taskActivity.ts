import type { PSTask, TaskActivityEvent, TaskActivityKind } from '../types';
import { canonical } from './canonical';
import { isTaskDate } from './taskDates';

export const TASK_ACTIVITY_LIMIT = 64;

const activityKinds: TaskActivityKind[] = ['created', 'edited', 'rescheduled', 'started', 'paused', 'completed', 'reopened', 'progress', 'time_adjusted', 'attempt'];
export function isTaskActivityEvent(value: unknown): value is TaskActivityEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  if (typeof event.id !== 'string' || !event.id.trim() || event.id.length > 512 || typeof event.at !== 'number' || !Number.isFinite(event.at) || event.at < 0 || !activityKinds.includes(event.kind as TaskActivityKind)) return false;
  if (event.changeKey !== undefined && (typeof event.changeKey !== 'string' || event.changeKey.length > 128)) return false;
  if (event.workedFrom !== undefined || event.workedUntil !== undefined) {
    if (event.kind !== 'time_adjusted' || typeof event.workedFrom !== 'number' || !Number.isFinite(event.workedFrom) || event.workedFrom < 0 ||
      typeof event.workedUntil !== 'number' || !Number.isFinite(event.workedUntil) || event.workedUntil < event.workedFrom || event.workedUntil > event.at ||
      event.workedUntil - event.workedFrom > 3 * 60 * 60 * 1000) return false;
  }
  for (const key of ['attemptSeconds', 'attemptCapSeconds']) {
    if (event[key] !== undefined && (typeof event[key] !== 'number' || !Number.isInteger(event[key]) || (event[key] as number) < 0 || (event[key] as number) > 86400)) return false;
  }
  if (event.attemptOutcome !== undefined && event.attemptOutcome !== 'stopped' && event.attemptOutcome !== 'cap_reached') return false;
  if (event.attemptContinued !== undefined && typeof event.attemptContinued !== 'boolean') return false;
  for (const key of ['previousPlannedDate', 'plannedDate', 'previousDeadlineDate', 'deadlineDate']) {
    if (event[key] !== undefined && event[key] !== null && !isTaskDate(event[key])) return false;
  }
  for (const key of ['previousScheduledStartAt', 'scheduledStartAt']) {
    const start = event[key];
    if (start !== undefined && start !== null && (typeof start !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(start) || !Number.isFinite(Date.parse(start)))) return false;
  }
  return true;
}

/** Union by immutable event ID keeps independent device history instead of replacing it. */
export function mergeTaskActivityTrail(left: TaskActivityEvent[] | undefined, right: TaskActivityEvent[] | undefined): TaskActivityEvent[] {
  const known = new Map<string, TaskActivityEvent>();
  for (const event of [...(left ?? []), ...(right ?? [])]) {
    if (!isTaskActivityEvent(event)) continue;
    const existing = known.get(event.id);
    if (!existing || canonical(event) < canonical(existing)) known.set(event.id, event);
  }
  return [...known.values()].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)).slice(-TASK_ACTIVITY_LIMIT);
}

// Accumulated seconds and active-session checkpoints change while banking time.
// They are not edits, and must not fill the history on timer ticks or recovery.
function meaningfulState(task: PSTask) {
  const timer = task.limitedStart?.restore ?? task;
  return {
    title: task.title, note: task.note, phase: task.phase, priority: task.priority,
    pinned: task.pinned, steps: task.steps, currentStep: task.currentStep, done: task.done,
    stepList: task.stepList?.map(step => ({ id: step.id, title: step.title, done: step.done, estimatedDurationSeconds: step.estimatedDurationSeconds })),
    plannedDate: task.plannedDate, deadlineDate: task.deadlineDate, schedule: task.schedule,
    scheduledFor: task.scheduledFor, scheduledPending: task.scheduledPending,
    startedAt: task.startedAt, completedAt: task.completedAt,
    timerMode: timer.timerMode, timerRunning: Boolean(task.timerRunning),
    countdownDurationSeconds: timer.countdownDurationSeconds, plannedDurationSeconds: task.plannedDurationSeconds, timeResetAt: task.timeResetAt,
  };
}

function stateKey(task: PSTask): string {
  const source = canonical(meaningfulState(task));
  let hash = 2166136261;
  for (let index = 0; index < source.length; index++) hash = Math.imul(hash ^ source.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(36);
}

function scheduledStart(task: PSTask): string | null {
  if (Number.isFinite(task.scheduledFor) && Math.abs(task.scheduledFor!) <= 8640000000000000) {
    const iso = new Date(task.scheduledFor!).toISOString();
    if (/^\d{4}-/.test(iso)) return iso;
  }
  return task.schedule?.startAt ?? null;
}

/** Pure, idempotent metadata annotation for local changes; cloud hydration must bypass it. */
export function annotateTaskChanges(previous: PSTask[], next: PSTask[], now: number): PSTask[] {
  if (next === previous) return previous;
  if (!Number.isFinite(now) || now < 0) return next;
  const beforeById = new Map(previous.map(task => [task.id, task]));
  return next.map(task => {
    const before = beforeById.get(task.id);
    const previousState = before && meaningfulState(before);
    const nextState = meaningfulState(task);
    // A limited attempt ends without a second generic pause event.
    if (previousState && before?.limitedStart && !task.timerRunning) previousState.timerRunning = false;
    const changed = previousState && canonical(previousState) !== canonical(nextState);
    const timeAdjusted = before && (before.timeResetAt !== task.timeResetAt ||
      (!before.timerRunning && !task.timerRunning && canonical(before.timeSessions) === canonical(task.timeSessions) &&
        (before.timeSpentSeconds ?? 0) !== (task.timeSpentSeconds ?? 0)));
    if (before && !changed && !timeAdjusted) return task;
    // Restored or imported historical tasks are not creations at the current time.
    if (!before && (task.activityTrail?.length || !Number.isFinite(task.createdAt) || Math.abs(now - task.createdAt) > 1000)) return task;
    const changeKey = `${stateKey(task)}:${timeAdjusted ? task.timeSpentSeconds ?? 0 : ''}`;
    const previousIds = new Set(before?.activityTrail?.map(event => event.id));
    if (task.activityTrail?.some(event => !previousIds.has(event.id) && event.changeKey === changeKey)) return task;

    const kinds: TaskActivityKind[] = [];
    const rescheduled = before && (before.plannedDate !== task.plannedDate || before.deadlineDate !== task.deadlineDate ||
      canonical(before.schedule) !== canonical(task.schedule) || before.scheduledFor !== task.scheduledFor || before.scheduledPending !== task.scheduledPending);
    if (!before) kinds.push('created');
    else {
      if (rescheduled) kinds.push('rescheduled');
      if (before.done !== task.done) kinds.push(task.done ? 'completed' : 'reopened');
      if ((!Number.isFinite(before.startedAt) && Number.isFinite(task.startedAt)) || (!before.timerRunning && task.timerRunning)) kinds.push('started');
      if (before.timerRunning && !task.timerRunning && !before.limitedStart) kinds.push('paused');
      if (before.currentStep !== task.currentStep || canonical(before.stepList?.map(step => [step.id, step.done])) !== canonical(task.stepList?.map(step => [step.id, step.done]))) kinds.push('progress');
      if (timeAdjusted) kinds.push('time_adjusted');
      if (!kinds.length || ['title', 'note', 'phase', 'priority', 'pinned', 'steps', 'timerMode', 'countdownDurationSeconds', 'plannedDurationSeconds'].some(key => canonical(previousState![key as keyof typeof nextState]) !== canonical(nextState[key as keyof typeof nextState])) ||
        canonical(before.stepList?.map(step => [step.id, step.title, step.estimatedDurationSeconds])) !== canonical(task.stepList?.map(step => [step.id, step.title, step.estimatedDurationSeconds]))) kinds.push('edited');
    }
    const events: TaskActivityEvent[] = kinds.map(kind => ({
      id: `${task.id.slice(0, 384)}:${now}:${kind}:${changeKey}`, at: now, kind, changeKey,
      ...(kind === 'rescheduled' && before ? {
        previousPlannedDate: before.plannedDate ?? null, plannedDate: task.plannedDate ?? null,
        previousDeadlineDate: before.deadlineDate ?? null, deadlineDate: task.deadlineDate ?? null,
        previousScheduledStartAt: scheduledStart(before), scheduledStartAt: scheduledStart(task),
      } : {}),
    }));
    return { ...task, ...(before ? { createdAt: before.createdAt } : {}), updatedAt: Math.max(before?.updatedAt ?? 0, task.updatedAt ?? 0, now),
      activityTrail: mergeTaskActivityTrail(mergeTaskActivityTrail(before?.activityTrail, task.activityTrail), events) };
  });
}
