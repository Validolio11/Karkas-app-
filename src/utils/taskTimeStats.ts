import type { PSTask } from '../types';

// A missing or zero reading is not evidence that a task took zero time.
export function recordedTaskSeconds(task: Pick<PSTask, 'timeSpentSeconds'>): number | null {
  return typeof task.timeSpentSeconds === 'number' && Number.isFinite(task.timeSpentSeconds) && task.timeSpentSeconds >= 1
    ? Math.floor(task.timeSpentSeconds) : null;
}

export function summarizeTaskTime(tasks: Pick<PSTask, 'timeSpentSeconds'>[]) {
  const readings = tasks.map(recordedTaskSeconds).filter((seconds): seconds is number => seconds !== null);
  const totalSeconds = readings.reduce((sum, seconds) => sum + seconds, 0);
  return {
    measuredTasks: readings.length,
    unmeasuredTasks: tasks.length - readings.length,
    totalSeconds,
    averageSeconds: readings.length ? Math.round(totalSeconds / readings.length) : null,
  };
}

export function formatRecordedDuration(seconds: number | null, lang: 'uk' | 'en'): string {
  if (seconds === null) return lang === 'uk' ? 'Не виміряно' : 'Not measured';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const rest = Math.floor(seconds % 60);
  const labels = lang === 'uk' ? ['год', 'хв', 'с'] : ['h', 'm', 's'];
  return hours > 0 ? `${hours} ${labels[0]} ${minutes} ${labels[1]}`
    : minutes > 0 ? `${minutes} ${labels[1]} ${rest} ${labels[2]}` : `${rest} ${labels[2]}`;
}
