import type { PSTask, TaskActivityEvent } from '../types';
import { mergeTaskActivityTrail } from './taskActivity';
import { getTaskRemainingSeconds, getTaskTimerMode, getTaskTotalSeconds, pauseTaskTimer } from './taskTimer';
import { activeTaskStepId } from './taskWorkTelemetry';

export const LIMITED_START_CAPS = [300, 900, 1500];
export const LIMITED_START_DEFAULT = 900;
export const LIMITED_START_MIN_CREDIT = 60;

export function startLimitedStart(task: PSTask, capSeconds: number, now: number, options?: { continued?: boolean; newId?: () => string }): PSTask {
  if (task.done || task.limitedStart || !Number.isInteger(capSeconds) || capSeconds < 60 || capSeconds > 3600) return task;
  const paused = task.timerRunning ? pauseTaskTimer(task, now) : task;
  const newId = options?.newId ?? (() => crypto.randomUUID());
  return {
    ...paused,
    limitedStart: {
      id: newId(), capSeconds, startedAt: now, baseSeconds: getTaskTotalSeconds(paused, now),
      ...(options?.continued ? { continued: true } : {}),
      restore: {
        ...(paused.timerMode === undefined ? {} : { timerMode: paused.timerMode }),
        ...(paused.countdownDurationSeconds === undefined ? {} : { countdownDurationSeconds: paused.countdownDurationSeconds }),
        ...(paused.countdownRemainingSeconds === undefined ? {} : { countdownRemainingSeconds: paused.countdownRemainingSeconds }),
      },
    },
    timerMode: 'countdown', countdownDurationSeconds: capSeconds, countdownRemainingSeconds: capSeconds,
    timerRunning: true, timerStartedAt: now, timerSessionId: newId(), timerStepId: activeTaskStepId(paused),
    startedAt: Number.isFinite(task.startedAt) ? task.startedAt : now,
    autoPausedOverdue: false, updatedAt: Math.max(task.updatedAt ?? 0, now),
  };
}

export function finishLimitedStart(task: PSTask, now: number): PSTask {
  const attempt = task.limitedStart;
  if (!attempt) return task;
  const outcome = getTaskRemainingSeconds(task, now) === 0 ? 'cap_reached' : 'stopped';
  const paused = pauseTaskTimer(task, now);
  const worked = Math.min(attempt.capSeconds, Math.max(0, getTaskTotalSeconds(paused, now) - attempt.baseSeconds));
  const next: PSTask = { ...paused, updatedAt: Math.max(task.updatedAt ?? 0, now) };
  delete next.limitedStart;
  delete next.timerMode;
  delete next.countdownDurationSeconds;
  delete next.countdownRemainingSeconds;
  if (attempt.restore.timerMode !== undefined) next.timerMode = attempt.restore.timerMode;
  if (attempt.restore.countdownDurationSeconds !== undefined) next.countdownDurationSeconds = attempt.restore.countdownDurationSeconds;
  if (attempt.restore.countdownRemainingSeconds !== undefined) next.countdownRemainingSeconds = attempt.restore.countdownRemainingSeconds;
  if (getTaskTimerMode(next) !== 'countdown') delete next.countdownRemainingSeconds;
  if (worked >= LIMITED_START_MIN_CREDIT) {
    const event: TaskActivityEvent = {
      id: 'attempt:' + attempt.id, at: now, kind: 'attempt', attemptSeconds: worked,
      attemptCapSeconds: attempt.capSeconds, attemptOutcome: outcome,
      ...(attempt.continued === undefined ? {} : { attemptContinued: attempt.continued }),
    };
    next.activityTrail = mergeTaskActivityTrail(next.activityTrail, [event]);
  }
  return next;
}

export function needsLimitedStartFinish(task: PSTask, now: number): boolean {
  return Boolean(task.limitedStart && (task.done || !task.timerRunning || getTaskTimerMode(task) !== 'countdown' ||
    (getTaskRemainingSeconds(task, now) ?? Infinity) <= 0));
}

export function latestAttempt(task: PSTask): TaskActivityEvent | undefined {
  return mergeTaskActivityTrail(undefined, task.activityTrail).filter(event => event.kind === 'attempt').at(-1);
}

export function summarizeAttempts(tasks: PSTask[], now: number, days = 7): { count: number; seconds: number } {
  const since = now - days * 86400000;
  let count = 0, seconds = 0;
  for (const task of tasks) {
    if (task.scheduledPending || 'deletedAt' in task) continue;
    for (const event of mergeTaskActivityTrail(undefined, task.activityTrail)) {
      if (event.kind !== 'attempt' || event.at < since || event.at > now) continue;
      if (!event.attemptContinued) count++;
      seconds += event.attemptSeconds ?? 0;
    }
  }
  return { count, seconds };
}
