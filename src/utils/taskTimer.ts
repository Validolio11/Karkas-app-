import type { PSTask } from '../types';

const seconds = (value: number | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;

function countdownBudget(task: PSTask): number | undefined {
  const duration = seconds(task.countdownDurationSeconds);
  if (!duration) return undefined;
  return task.countdownRemainingSeconds === undefined
    ? duration
    : Math.min(duration, seconds(task.countdownRemainingSeconds));
}

/** Elapsed time in the active session, bounded by its countdown budget. */
export function getTaskSessionSeconds(task: PSTask, now = Date.now()): number {
  if (!task.timerRunning || typeof task.timerStartedAt !== 'number' || !Number.isFinite(task.timerStartedAt)) return 0;
  const elapsed = seconds((now - task.timerStartedAt) / 1000);
  const budget = countdownBudget(task);
  return budget === undefined ? elapsed : Math.min(elapsed, budget);
}

export function getTaskTotalSeconds(task: PSTask, now = Date.now()): number {
  return seconds(task.timeSpentSeconds) + getTaskSessionSeconds(task, now);
}

/** Undefined means this task uses the stopwatch rather than a countdown. */
export function getTaskRemainingSeconds(task: PSTask, now = Date.now()): number | undefined {
  const budget = countdownBudget(task);
  return budget === undefined ? undefined : budget - getTaskSessionSeconds(task, now);
}

export function pauseTaskTimer(task: PSTask, now = Date.now()): PSTask {
  const remaining = getTaskRemainingSeconds(task, now);
  return {
    ...task,
    timeSpentSeconds: getTaskTotalSeconds(task, now),
    timerRunning: false,
    timerStartedAt: undefined,
    ...(remaining === undefined ? {} : { countdownRemainingSeconds: remaining }),
  };
}

/** Resumes a paused session; an expired countdown starts a fresh full interval. */
export function startTaskTimer(task: PSTask, now = Date.now()): PSTask {
  const remaining = getTaskRemainingSeconds(task, now);
  if (task.timerRunning && (remaining === undefined || remaining > 0)) return task;
  const paused = pauseTaskTimer(task, now);
  return {
    ...paused,
    timerRunning: true,
    timerStartedAt: now,
    autoPausedOverdue: false,
    ...(remaining === undefined ? {} : {
      countdownRemainingSeconds: remaining || seconds(task.countdownDurationSeconds),
    }),
  };
}

/** Banks any current session before starting the chosen countdown. */
export function configureTaskCountdown(task: PSTask, durationSeconds: number, now = Date.now()): PSTask {
  const duration = seconds(durationSeconds);
  if (!duration) throw new RangeError('Countdown duration must be at least one second');
  return {
    ...pauseTaskTimer(task, now),
    countdownDurationSeconds: duration,
    countdownRemainingSeconds: duration,
    timerRunning: true,
    timerStartedAt: now,
    autoPausedOverdue: false,
  };
}

export function clearTaskCountdown(task: PSTask, now = Date.now()): PSTask {
  const paused = pauseTaskTimer(task, now);
  delete paused.countdownDurationSeconds;
  delete paused.countdownRemainingSeconds;
  return paused;
}
