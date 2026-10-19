import type { PSTask } from '../types';
import { mergeTaskActivityTrail } from './taskActivity';
import { setTaskTimeSpent } from './taskOperations';
import { configureTaskCountdown, extendTaskCountdown, getTaskRemainingSeconds, getTaskTimerMode, getTaskTotalSeconds, pauseTaskTimer, startTaskTimer } from './taskTimer';

export const MAX_OVERRUN_SECONDS = 3 * 60 * 60;

/** Preserve explicit overtime bounds after the pending expiry marker is cleared. */
function recordOverrun(task: PSTask, expiredAt: number, creditedSeconds: number, now: number): PSTask {
  const workedUntil = expiredAt + creditedSeconds * 1000;
  return { ...task, activityTrail: mergeTaskActivityTrail(task.activityTrail, [{
    id: `overrun:${task.id.slice(0, 384)}:${expiredAt}:${workedUntil}`, at: now, kind: 'time_adjusted',
    workedFrom: expiredAt, workedUntil,
  }]) };
}

export function overrunGapSeconds(task: PSTask, now: number): number {
  return Number.isFinite(task.countdownExpiredAt) && Number.isFinite(now)
    ? Math.max(0, Math.floor((now - task.countdownExpiredAt!) / 1000)) : 0;
}

export function continueAfterExpiry(task: PSTask, now: number, extendMinutes = 30, newId: () => string = () => crypto.randomUUID()): PSTask {
  if (task.done || task.limitedStart || !Number.isFinite(task.countdownExpiredAt) || !Number.isFinite(now) ||
    getTaskTimerMode(task) !== 'countdown' || now < task.countdownExpiredAt! || !Number.isInteger(extendMinutes) || extendMinutes < 1 || extendMinutes > 1440 ||
    overrunGapSeconds(task, now) > MAX_OVERRUN_SECONDS) return task;
  const settled = pauseTaskTimer(task, now);
  const paused = Number.isFinite(task.scheduledFor) && task.scheduledDurationSeconds === undefined &&
    Number.isInteger(task.countdownDurationSeconds) && task.countdownDurationSeconds! >= 1 && task.countdownDurationSeconds! <= 86400
    ? { ...settled, scheduledDurationSeconds: task.countdownDurationSeconds } : settled;
  let extended = extendTaskCountdown(paused, extendMinutes * 60, now, newId);
  // A fully consumed 24h budget can still continue with a new explicit interval.
  if (extended === paused && getTaskRemainingSeconds(paused, now) === 0) {
    extended = configureTaskCountdown(paused, extendMinutes * 60, now, newId);
  }
  if (extended === paused) return task;
  const credited = setTaskTimeSpent(extended, getTaskTotalSeconds(paused, now) + overrunGapSeconds(task, now), now, newId);
  return startTaskTimer({ ...recordOverrun(credited, task.countdownExpiredAt!, overrunGapSeconds(task, now), now), countdownExpiredAt: undefined }, now, newId);
}

/** No time means acknowledge expiry; finishing the task remains a separate action. */
export function finishAfterExpiry(task: PSTask, now: number, workedUntil?: number, newId: () => string = () => crypto.randomUUID()): PSTask {
  if (!Number.isFinite(task.countdownExpiredAt) || !Number.isFinite(now)) return task;
  if (workedUntil !== undefined && (!Number.isFinite(workedUntil) || workedUntil < task.countdownExpiredAt! || workedUntil > now)) return task;
  const gap = workedUntil === undefined ? 0 : Math.min(MAX_OVERRUN_SECONDS, overrunGapSeconds(task, workedUntil));
  const credited = gap ? setTaskTimeSpent(task, getTaskTotalSeconds(task, now) + gap, now, newId) : task;
  return { ...recordOverrun(credited, task.countdownExpiredAt!, gap, now), countdownExpiredAt: undefined };
}

/** Select only the latest due reminder; a delayed wake-up never emits a burst. */
export function countdownReminderIndex(task: PSTask, now: number): 0 | 1 | 2 | undefined {
  if (task.done || task.limitedStart || !Number.isFinite(task.countdownExpiredAt) || !Number.isFinite(now) || now < task.countdownExpiredAt!) return undefined;
  const gap = overrunGapSeconds(task, now);
  if (gap >= 46 * 60) return undefined;
  return gap >= 45 * 60 ? 2 : gap >= 15 * 60 ? 1 : 0;
}
