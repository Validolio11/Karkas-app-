import type { PSTask, TaskSchedule } from '../types';
import { getTaskTimerMode } from './taskTimer';

export function describeSchedule(schedule: TaskSchedule, lang: 'uk' | 'en', nextStartAt = schedule.startAt): string {
  const locale = lang === 'uk' ? 'uk-UA' : 'en-GB';
  const date = new Date(nextStartAt);
  try {
    const start = new Intl.DateTimeFormat(locale, { timeZone: schedule.timeZone, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
    const clock = new Intl.DateTimeFormat(locale, { timeZone: schedule.timeZone, hour: '2-digit', minute: '2-digit' }).format(date);
    const when = schedule.recurrence === 'daily' ? (lang === 'uk' ? `Щодня о ${clock} · наступне: ${start}` : `Daily at ${clock} · next: ${start}`) : start;
    return `${when} · ${lang === 'uk' ? `додати за ${schedule.leadMinutes} хв` : `add ${schedule.leadMinutes} min before`} · ${schedule.timeZone}`;
  } catch { return lang === 'uk' ? 'Некоректний розклад — уточніть дату й часовий пояс' : 'Invalid schedule — check date and timezone'; }
}

type TimedTask = Pick<PSTask, 'scheduledFor' | 'scheduledDurationSeconds' | 'timerMode' | 'countdownDurationSeconds'>;

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Formatters are cached because the task list comparator calls this per comparison; an unknown zone falls back to the system one. */
function formatter(locale: string, timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${timeZone}|${JSON.stringify(options)}`;
  let cached = formatters.get(key);
  if (!cached) {
    try { cached = new Intl.DateTimeFormat(locale, { ...options, timeZone }); }
    catch { cached = new Intl.DateTimeFormat(locale, options); }
    formatters.set(key, cached);
  }
  return cached;
}

/** Calendar day (YYYY-MM-DD) of an instant as seen on the wall clock of `timeZone`. */
export function calendarDateKey(at: number, timeZone: string): string {
  const parts = formatter('en-CA', timeZone, { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? '';
  return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
}

/** Next calendar day computed on the date itself, so DST days of 23 or 25 hours cannot skip or repeat a day. */
function nextDateKey(key: string): string {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day + 1);
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function scheduledStart(task: Pick<PSTask, 'scheduledFor'>): number | undefined {
  // Outside the Date range Intl would throw while rendering the card.
  return typeof task.scheduledFor === 'number' && Number.isFinite(task.scheduledFor) && Math.abs(task.scheduledFor) <= 8.64e15 ? task.scheduledFor : undefined;
}

/** Fixed schedule length survives timer extensions; legacy blocks use their configured countdown. */
export function taskScheduledEnd(task: TimedTask): number | undefined {
  const start = scheduledStart(task);
  const duration = task.scheduledDurationSeconds ?? (getTaskTimerMode(task) === 'countdown' ? task.countdownDurationSeconds : undefined);
  if (start === undefined || typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) return undefined;
  return start + Math.floor(duration) * 1000;
}

/** «Сьогодні 14:00–14:30», «Завтра 09:00», «Ср, 22 жовт · 14:00–14:30»; undefined without a start time. */
export function taskTimeRange(task: TimedTask, now: number, timeZone: string, lang: 'uk' | 'en'): string | undefined {
  const start = scheduledStart(task);
  if (start === undefined) return undefined;
  const locale = lang === 'uk' ? 'uk-UA' : 'en-GB';
  const clock = (at: number) => formatter(locale, timeZone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
  const end = taskScheduledEnd(task);
  const endClock = end === undefined ? undefined : end % 60000 === 0 && clock(end) === '00:00' && calendarDateKey(end, timeZone) === nextDateKey(calendarDateKey(start, timeZone)) ? '24:00' : clock(end);
  const time = endClock === undefined ? clock(start) : `${clock(start)}–${endClock}`;
  const today = calendarDateKey(now, timeZone);
  const day = calendarDateKey(start, timeZone);
  if (day === today) return `${lang === 'uk' ? 'Сьогодні' : 'Today'} ${time}`;
  if (day === nextDateKey(today)) return `${lang === 'uk' ? 'Завтра' : 'Tomorrow'} ${time}`;
  const parts = formatter(locale, timeZone, { weekday: 'short', day: 'numeric', month: 'short' }).formatToParts(start);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? '';
  const weekday = part('weekday');
  const month = part('month').replace(/\.$/, '');
  return `${weekday.charAt(0).toLocaleUpperCase(locale)}${weekday.slice(1)}, ${part('day')} ${month} · ${time}`;
}

/** An unfinished task whose planned start falls on today's calendar day in `timeZone`. */
export function isTimedForToday(task: Pick<PSTask, 'scheduledFor' | 'done'>, now: number, timeZone: string): boolean {
  const start = scheduledStart(task);
  return !task.done && start !== undefined && calendarDateKey(start, timeZone) === calendarDateKey(now, timeZone);
}

/** Today's timed, unfinished tasks before everything else, in start order; 0 leaves the rest to the caller's ordering. */
export function compareTodayTimedFirst(a: Pick<PSTask, 'scheduledFor' | 'done'>, b: Pick<PSTask, 'scheduledFor' | 'done'>, now: number, timeZone: string): number {
  const aToday = isTimedForToday(a, now, timeZone);
  const bToday = isTimedForToday(b, now, timeZone);
  if (aToday !== bToday) return aToday ? -1 : 1;
  return aToday ? a.scheduledFor! - b.scheduledFor! : 0;
}
