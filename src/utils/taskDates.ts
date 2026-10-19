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

/** Compare calendar days in UTC so local DST changes do not affect the distance. */
export function taskDayDiff(value: string, now = Date.now()): number | null {
  if (!isTaskDate(value) || !Number.isFinite(now)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const current = new Date(now);
  if (!Number.isFinite(current.getTime())) return null;
  const targetDay = new Date(0);
  const today = new Date(0);
  targetDay.setUTCFullYear(year, month - 1, day);
  today.setUTCFullYear(current.getFullYear(), current.getMonth(), current.getDate());
  return (targetDay.getTime() - today.getTime()) / 86400000;
}

export function pluralTaskDays(count: number): string {
  const value = Math.abs(count);
  const lastTwo = value % 100;
  if (lastTwo >= 11 && lastTwo <= 14) return 'днів';
  const last = value % 10;
  return last === 1 ? 'день' : last >= 2 && last <= 4 ? 'дні' : 'днів';
}

function absoluteTaskDate(value: string): string {
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
}

function shortTaskDate(value: string, now: number): string {
  const [year, month, day] = value.split('-');
  return `${day}.${month}${Number(year) === new Date(now).getFullYear() ? '' : '.' + year}`;
}

export function describeDeadline(value: string, lang: 'uk' | 'en', now = Date.now()): { label: string; tone: 'overdue' | 'today' | 'soon' | 'later'; full: string } {
  const diff = taskDayDiff(value, now);
  if (diff === null) return { label: '', tone: 'later', full: '' };
  const full = absoluteTaskDate(value);
  if (diff < 0) {
    const days = -diff;
    return { label: lang === 'uk' ? `Прострочено на ${days} ${pluralTaskDays(days)}` : `Overdue by ${days} ${days === 1 ? 'day' : 'days'}`, tone: 'overdue', full };
  }
  if (diff === 0) return { label: lang === 'uk' ? 'Дедлайн сьогодні' : 'Due today', tone: 'today', full };
  if (diff === 1) return { label: lang === 'uk' ? 'Дедлайн завтра' : 'Due tomorrow', tone: 'soon', full };
  if (diff <= 13) return { label: lang === 'uk' ? `Дедлайн через ${diff} ${pluralTaskDays(diff)}` : `Due in ${diff} days`, tone: diff <= 3 ? 'soon' : 'later', full };
  return { label: lang === 'uk' ? `Дедлайн ${shortTaskDate(value, now)}` : `Due ${shortTaskDate(value, now)}`, tone: 'later', full };
}

export function describePlannedDate(value: string, lang: 'uk' | 'en', now = Date.now()): { label: string; tone: 'missed' | 'today' | 'upcoming'; full: string } {
  const diff = taskDayDiff(value, now);
  if (diff === null) return { label: '', tone: 'upcoming', full: '' };
  const full = absoluteTaskDate(value);
  if (diff < 0) {
    const days = -diff;
    return { label: lang === 'uk' ? `Планувалось ${days} ${pluralTaskDays(days)} тому` : `Planned ${days} ${days === 1 ? 'day' : 'days'} ago`, tone: 'missed', full };
  }
  if (diff === 0) return { label: lang === 'uk' ? 'Сьогодні' : 'Today', tone: 'today', full };
  if (diff === 1) return { label: lang === 'uk' ? 'Завтра' : 'Tomorrow', tone: 'upcoming', full };
  if (diff <= 6) {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    const weekdays = lang === 'uk' ? ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return { label: `${weekdays[date.getUTCDay()]}, ${shortTaskDate(value, now)}`, tone: 'upcoming', full };
  }
  return { label: shortTaskDate(value, now), tone: 'upcoming', full };
}

/** Elapsed deadline window, not completed-work percentage. */
export function getDeadlineProgress(task: Pick<PSTask, 'createdAt' | 'deadlineDate' | 'done' | 'completedAt'>, now = Date.now()): number {
  const end = task.deadlineDate ? taskDateEnd(task.deadlineDate) : null;
  if (end === null || !Number.isFinite(task.createdAt) || !Number.isFinite(now)) return 0;
  const observed = task.done && Number.isFinite(task.completedAt) ? task.completedAt! : now;
  if (end <= task.createdAt) return observed >= end ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round((observed - task.createdAt) / (end - task.createdAt) * 100)));
}
