import type { PSTask, TimerMode } from '../types';

export function getTaskTimerMode(task: PSTask): TimerMode {
  if (task.timerMode === 'none' || task.timerMode === 'stopwatch' || task.timerMode === 'countdown') return task.timerMode;
  return typeof task.countdownDurationSeconds === 'number' && Number.isFinite(task.countdownDurationSeconds) &&
    task.countdownDurationSeconds > 0 ? 'countdown' : 'stopwatch';
}

const seconds = (value: number | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;

function countdownBudget(task: PSTask): number | undefined {
  if (getTaskTimerMode(task) !== 'countdown') return undefined;
  const duration = seconds(task.countdownDurationSeconds);
  if (!duration) return undefined;
  return task.countdownRemainingSeconds === undefined
    ? duration
    : Math.min(duration, seconds(task.countdownRemainingSeconds));
}

/** Elapsed time in the active session, bounded by its countdown budget. */
export function getTaskSessionSeconds(task: PSTask, now = Date.now()): number {
  if (getTaskTimerMode(task) === 'none' || !task.timerRunning || typeof task.timerStartedAt !== 'number' || !Number.isFinite(task.timerStartedAt)) return 0;
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
  const mode = getTaskTimerMode(task);
  if (mode === 'none' || task.done || (mode === 'countdown' && countdownBudget(task) === undefined)) return task;
  const remaining = getTaskRemainingSeconds(task, now);
  if (task.timerRunning && (remaining === undefined || remaining > 0)) return task;
  const paused = pauseTaskTimer(task, now);
  return {
    ...paused,
    timerRunning: true,
    startedAt: Number.isFinite(task.startedAt) ? task.startedAt : now,
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
  if (task.done) return task;
  return {
    ...pauseTaskTimer(task, now),
    timerMode: 'countdown',
    countdownDurationSeconds: duration,
    countdownRemainingSeconds: duration,
    timerRunning: true,
    timerStartedAt: now,
    startedAt: Number.isFinite(task.startedAt) ? task.startedAt : now,
    autoPausedOverdue: false,
  };
}

export function clearTaskCountdown(task: PSTask, now = Date.now()): PSTask {
  const paused = pauseTaskTimer(task, now);
  paused.timerMode = 'stopwatch';
  delete paused.countdownDurationSeconds;
  delete paused.countdownRemainingSeconds;
  return paused;
}

/** Extend the remaining budget without erasing work or starting a paused task. */
export function extendTaskCountdown(task: PSTask, extraSeconds: number, now = Date.now()): PSTask {
  if (task.done || getTaskTimerMode(task) !== 'countdown' || !Number.isInteger(extraSeconds) || extraSeconds <= 0) return task;
  const remaining = getTaskRemainingSeconds(task, now);
  if (remaining === undefined || seconds(task.countdownDurationSeconds) + extraSeconds > 86400) return task;
  const paused = pauseTaskTimer(task, now);
  const running = !!task.timerRunning && remaining > 0;
  return {
    ...paused,
    countdownDurationSeconds: seconds(task.countdownDurationSeconds) + extraSeconds,
    countdownRemainingSeconds: remaining + extraSeconds,
    timerRunning: running,
    timerStartedAt: running ? now : undefined,
    autoPausedOverdue: false,
  };
}
