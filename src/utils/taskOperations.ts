import type { PSTask } from '../types';
import { getTaskRemainingSeconds, pauseTaskTimer } from './taskTimer';

const MAX_RUNNING_SESSION_SECONDS = 2 * 60 * 60;

/** Repairs timers left running across a restart and caps the recovered session. */
export function sanitizeTasksTimerSafeguard(taskList: PSTask[], now = Date.now()): PSTask[] {
  return taskList.map((task) => {
    if (!task.timerRunning || task.timerStartedAt === undefined) return task;
    const remaining = getTaskRemainingSeconds(task, now);
    if (remaining !== undefined) return remaining === 0 ? pauseTaskTimer(task, now) : task;
    const elapsedSeconds = Math.floor((now - task.timerStartedAt) / 1000);
    if (elapsedSeconds <= MAX_RUNNING_SESSION_SECONDS) return task;
    return {
      ...task,
      timeSpentSeconds: (task.timeSpentSeconds || 0) + MAX_RUNNING_SESSION_SECONDS,
      timerRunning: false,
      timerStartedAt: undefined,
      autoPausedOverdue: true,
    };
  });
}
