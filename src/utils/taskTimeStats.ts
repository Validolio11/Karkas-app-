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

function durationParts(value: number) {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return { seconds, hours: Math.floor(seconds / 3600), minutes: Math.floor(seconds % 3600 / 60), rest: seconds % 60 };
}

/** Clock uses hours when needed; minute fields retain total minutes in editing dialogs. */
export function formatDigitalDuration(value: number, mode: 'clock' | 'minutes' = 'clock'): string {
  const { seconds, hours, minutes, rest } = durationParts(value);
  const pad = (part: number) => String(part).padStart(2, '0');
  return mode === 'clock' && hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(rest)}`
    : `${pad(mode === 'minutes' ? Math.floor(seconds / 60) : minutes)}:${pad(rest)}`;
}

export function formatDurationFull(value: number, lang: 'uk' | 'en'): string {
  const { hours, minutes, rest } = durationParts(value);
  if (lang === 'uk') return hours > 0 ? `${hours} год ${minutes} хв ${rest} сек`
    : minutes > 0 ? `${minutes} хв ${rest} сек` : `${rest} сек`;
  return hours > 0 ? `${hours}h ${minutes}m ${rest}s` : minutes > 0 ? `${minutes}m ${rest}s` : `${rest}s`;
}

export function formatRecordedDuration(seconds: number | null, lang: 'uk' | 'en'): string {
  if (seconds === null) return lang === 'uk' ? 'Не виміряно' : 'Not measured';
  const { hours, minutes, rest } = durationParts(seconds);
  const labels = lang === 'uk' ? ['год', 'хв', 'с'] : ['h', 'm', 's'];
  return hours > 0 ? `${hours} ${labels[0]} ${minutes} ${labels[1]}`
    : minutes > 0 ? `${minutes} ${labels[1]} ${rest} ${labels[2]}` : `${rest} ${labels[2]}`;
}
