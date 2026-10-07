import type { AITimerSettings, PSTask } from '../types';
import { getTaskTimerMode, pauseTaskTimer, startTaskTimer } from './taskTimer';

/** Configure without starting or losing recorded work; only explicit actions run time. */
export function isAITimerSettingsValid(task: PSTask, settings: AITimerSettings): boolean {
  const { timerMode, countdownDurationSeconds: duration, timerAction } = settings;
  if (timerMode !== undefined && !['none', 'stopwatch', 'countdown'].includes(timerMode)) return false;
  if (duration !== undefined && (!Number.isInteger(duration) || duration < 60 || duration > 86400)) return false;
  if (timerAction !== undefined && !['start', 'pause', 'stop'].includes(timerAction)) return false;
  if (duration !== undefined && timerMode !== undefined && timerMode !== 'countdown') return false;
  const mode = timerMode ?? (duration !== undefined ? 'countdown' : getTaskTimerMode(task));
  const countdown = duration ?? task.countdownDurationSeconds;
  if (mode === 'countdown' && (!Number.isInteger(countdown) || countdown! < 60 || countdown! > 86400)) return false;
  if (timerAction !== undefined && mode === 'none') return false;
  return timerAction !== 'start' || !task.done;
}

export function applyAITimerSettings(task: PSTask, settings: AITimerSettings, now = Date.now()): PSTask {
  if (!isAITimerSettingsValid(task, settings)) return task;
  const { timerMode, countdownDurationSeconds: duration, timerAction } = settings;
  const mode = timerMode ?? (duration !== undefined ? 'countdown' : getTaskTimerMode(task));
  const countdown = duration ?? task.countdownDurationSeconds;
  let next = task;
  const changed = mode !== getTaskTimerMode(task) || (mode === 'countdown' && countdown !== task.countdownDurationSeconds);
  if (changed) {
    next = { ...pauseTaskTimer(task, now), timerMode: mode, autoPausedOverdue: false };
    if (mode === 'countdown') {
      next.countdownDurationSeconds = countdown;
      next.countdownRemainingSeconds = countdown;
    } else {
      delete next.countdownDurationSeconds;
      delete next.countdownRemainingSeconds;
    }
  }
  if (timerAction === 'start') return startTaskTimer(next, now);
  if (timerAction === 'pause' || timerAction === 'stop') return pauseTaskTimer(next, now);
  return next;
}
