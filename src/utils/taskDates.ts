import type { PSTask } from '../types';

/** Calendar dates deliberately have no UTC conversion or timer semantics. */
export function isTaskDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const date = new Date(0);
  date.setUTCFullYear(year, month, 0);
  return day <= date.getUTCDate();
}

export function localTaskDate(now = Date.now()): string {
  const date = new Date(now);
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** The deadline includes its whole local calendar day, including DST changes. */
export function taskDateEnd(value: string): number | null {
  if (!isTaskDate(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 1);
  return date.getTime() - 1;
}

export function formatTaskDate(value: string, lang: 'uk' | 'en', now = Date.now()): string {
  if (!isTaskDate(value)) return '';
  if (value === localTaskDate(now)) return lang === 'uk' ? 'Сьогодні' : 'Today';
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (value === localTaskDate(tomorrow.getTime())) return lang === 'uk' ? 'Завтра' : 'Tomorrow';
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
}

/** Elapsed deadline window, not completed-work percentage. */
export function getDeadlineProgress(task: Pick<PSTask, 'createdAt' | 'deadlineDate' | 'done' | 'completedAt'>, now = Date.now()): number {
  const end = task.deadlineDate ? taskDateEnd(task.deadlineDate) : null;
  if (end === null || !Number.isFinite(task.createdAt) || !Number.isFinite(now)) return 0;
  const observed = task.done && Number.isFinite(task.completedAt) ? task.completedAt! : now;
  if (end <= task.createdAt) return observed >= end ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round((observed - task.createdAt) / (end - task.createdAt) * 100)));
}
