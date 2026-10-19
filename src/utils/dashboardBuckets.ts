import type { AnalyticsPeriod, DeletedTask, PSTask } from '../types';
import { calendarDateKey } from './schedulePresentation';
import { isCancelledArchivedTask, isCompletedArchivedTask, selectRelevantArchivedTasks } from './taskArchive';
import { mergeTaskActivityTrail } from './taskActivity';
import { getTaskSessionSeconds } from './taskTimer';

export interface DashboardActivityBucket {
  label: string;
  tooltipLabel: string;
  delivered: number;
  dropped: number;
  worked?: number;
}

type CalendarBucket = DashboardActivityBucket & { start: string; end: string };
type Interval = { start: number; end: number };
const DAY = 86400000;
const MONTHS = {
  uk: ['січ', 'лют', 'бер', 'кві', 'тра', 'чер', 'лип', 'сер', 'вер', 'жов', 'лис', 'гру'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};
const WEEKDAYS = { uk: ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'], en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] };

function calendarDate(key: string): Date {
  return new Date(key + 'T00:00:00.000Z');
}

function shiftDay(key: string, days: number): string {
  return new Date(calendarDate(key).getTime() + days * DAY).toISOString().slice(0, 10);
}

function shiftMonth(key: string, months: number): string {
  const date = calendarDate(key);
  date.setUTCMonth(date.getUTCMonth() + months, 1);
  return date.toISOString().slice(0, 10);
}

const shortDate = (key: string) => key.slice(8) + '.' + key.slice(5, 7);
const fullDate = (key: string) => shortDate(key) + '.' + key.slice(0, 4);
const rangeLabel = (start: string, end: string) => start === end ? fullDate(start) : fullDate(start) + '–' + fullDate(end);

function clockFormatter(timeZone: string): Intl.DateTimeFormat {
  const options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' };
  try { return new Intl.DateTimeFormat('en-GB', { ...options, timeZone }); }
  catch { return new Intl.DateTimeFormat('en-GB', options); }
}

function clockParts(format: Intl.DateTimeFormat, at: number) {
  const parts = format.formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(item => item.type === type)?.value ?? 0);
  return { hour: part('hour'), minute: part('minute'), second: part('second') };
}

/** Midnight in the requested calendar, independent of the host timezone. */
function dayStart(key: string, timeZone: string, clock: Intl.DateTimeFormat): number {
  const target = calendarDate(key).getTime();
  let at = target;
  for (let index = 0; index < 4; index++) {
    const day = calendarDate(calendarDateKey(at, timeZone)).getTime();
    const parts = clockParts(clock, at);
    const correction = target - day - (parts.hour * 3600 + parts.minute * 60 + parts.second) * 1000;
    at += correction;
    if (!correction) break;
  }
  return at;
}

/** Only dated evidence is recoverable; accumulated legacy totals have no hourly attribution. */
function workIntervals(task: PSTask, now: number): Interval[] {
  const stoppedAt = Math.min(now, task.done && Number.isFinite(task.completedAt) ? task.completedAt! : now,
    'deletedAt' in task && typeof task.deletedAt === 'number' && Number.isFinite(task.deletedAt) ? task.deletedAt : now);
  const eventOrder = (kind: string) => kind === 'started' ? 2 : kind === 'paused' || kind === 'completed' || kind === 'attempt' ? 0 : 1;
  const events = mergeTaskActivityTrail(undefined, task.activityTrail).filter(event => event.at <= now)
    .sort((a, b) => a.at - b.at || eventOrder(a.kind) - eventOrder(b.kind) || a.id.localeCompare(b.id));
  const intervals: Interval[] = [];
  const overtime = events.filter(event => event.kind === 'time_adjusted' && Number.isFinite(event.workedFrom) &&
    Number.isFinite(event.workedUntil) && event.workedUntil! >= event.workedFrom! && event.workedUntil! <= event.at);
  const zeroCrossings = overtime.map(event => event.workedFrom!);
  if (Number.isFinite(task.countdownExpiredAt)) zeroCrossings.push(task.countdownExpiredAt!);
  const addSession = (start: number, end: number) => {
    const crossing = zeroCrossings.filter(at => at > start && at < end).sort((a, b) => a - b)[0];
    intervals.push({ start, end: crossing ?? end });
  };
  let started: number | undefined;
  for (const event of events) {
    if (event.kind === 'started') {
      if (started === undefined) started = event.at;
    } else if (event.kind === 'paused' || event.kind === 'completed') {
      if (started !== undefined) addSession(started, event.at);
      started = undefined;
    } else if (event.kind === 'attempt' && Number.isFinite(event.attemptSeconds) && event.attemptSeconds! > 0) {
      const duration = event.attemptSeconds! * 1000;
      // A known start preserves the actual cap crossing when an expiry callback was delayed.
      const interval = started === undefined ? { start: event.at - duration, end: event.at }
        : { start: started, end: Math.min(event.at, started + duration) };
      if (started !== undefined || !intervals.some(item => item.start < interval.end && item.end > interval.start)) intervals.push(interval);
      started = undefined;
    }
  }
  if (task.timerRunning && Number.isFinite(task.timerStartedAt)) {
    const end = task.timerStartedAt! + getTaskSessionSeconds(task, stoppedAt) * 1000;
    if (started !== undefined) addSession(started, end);
    addSession(task.timerStartedAt!, end);
  }
  for (const event of overtime) intervals.push({ start: event.workedFrom!, end: event.workedUntil! });
  // Trail, timer checkpoints and attempt fallback can describe the same work.
  const merged: Interval[] = [];
  for (const interval of intervals.map(item => ({ ...item, end: Math.min(item.end, stoppedAt) })).filter(item => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start).sort((a, b) => a.start - b.start)) {
    const previous = merged[merged.length - 1];
    if (previous && interval.start <= previous.end) previous.end = Math.max(previous.end, interval.end);
    else merged.push({ ...interval });
  }
  return merged;
}

export function buildActivityBuckets(period: AnalyticsPeriod, tasks: readonly PSTask[], archive: readonly DeletedTask[], now: number | Date, tz: string, lang: 'uk' | 'en'): DashboardActivityBucket[] {
  const end = now instanceof Date ? now.getTime() : now;
  const today = calendarDateKey(end, tz);
  const clock = clockFormatter(tz);
  const archived = selectRelevantArchivedTasks(tasks, archive);
  const buckets: CalendarBucket[] = [];
  const add = (start: string, until: string, label: string) => buckets.push({ start, end: until, label, tooltipLabel: rangeLabel(start, shiftDay(until, -1)), delivered: 0, dropped: 0 });
  if (period === 'TODAY') {
    for (let hour = 0; hour < 24; hour++) {
      const label = String(hour).padStart(2, '0');
      buckets.push({ start: today, end: shiftDay(today, 1), label, tooltipLabel: fullDate(today) + ' · ' + label + ':00–' + String(hour + 1).padStart(2, '0') + ':00', delivered: 0, dropped: 0, worked: 0 });
    }
  } else if (period === 'LAST_7_DAYS' || period === 'LAST_30_DAYS') {
    const days = period === 'LAST_7_DAYS' ? 7 : 30;
    for (let index = 0; index < days; index++) {
      const start = shiftDay(today, index - days + 1);
      const date = calendarDate(start);
      add(start, shiftDay(start, 1), period === 'LAST_7_DAYS' ? WEEKDAYS[lang][date.getUTCDay()] + ' ' + date.getUTCDate() : String(date.getUTCDate()));
    }
  } else if (period === 'LAST_90_DAYS') {
    const start = shiftDay(today, -89);
    for (let index = 0; index < 13; index++) {
      const from = shiftDay(start, index * 7);
      add(from, shiftDay(start, Math.min((index + 1) * 7, 90)), shortDate(from));
    }
  } else if (period === 'LAST_365_DAYS') {
    const start = shiftDay(today, -364);
    const month = today.slice(0, 7) + '-01';
    // 365 days usually touch 13 months; the first column honestly labels the two oldest parts.
    for (let index = 0; index < 12; index++) {
      const from = index === 0 ? start : shiftMonth(month, index - 11);
      const until = index === 11 ? shiftDay(today, 1) : shiftMonth(month, index - 10);
      const first = MONTHS[lang][calendarDate(from).getUTCMonth()];
      const last = MONTHS[lang][calendarDate(shiftDay(until, -1)).getUTCMonth()];
      add(from, until, first === last ? first : first + '–' + last);
    }
  } else {
    return [];
  }
  const bucketAt = (at: number) => {
    if (!Number.isFinite(at) || at > end) return undefined;
    const key = calendarDateKey(at, tz);
    if (period === 'TODAY') return key === today ? buckets[clockParts(clock, at).hour] : undefined;
    return buckets.find(bucket => key >= bucket.start && key < bucket.end);
  };
  for (const task of tasks) {
    if (task.done) {
      const bucket = bucketAt(task.completedAt || task.createdAt);
      if (bucket) bucket.delivered++;
    }
  }
  for (const task of archived) {
    const bucket = isCompletedArchivedTask(task) ? bucketAt(task.completedAt || task.createdAt) : isCancelledArchivedTask(task) ? bucketAt(task.deletedAt) : undefined;
    if (bucket) {
      if (isCompletedArchivedTask(task)) bucket.delivered++;
      else bucket.dropped++;
    }
  }
  if (period === 'TODAY') {
    const start = dayStart(today, tz, clock);
    for (const task of [...tasks, ...archived]) {
      if (task.scheduledPending) continue;
      for (const interval of workIntervals(task, end)) {
        let at = Math.max(start, interval.start);
        const until = Math.min(end, interval.end);
        while (at < until) {
          const parts = clockParts(clock, at);
          const next = Math.min(until, at + ((60 - parts.minute) * 60 - parts.second) * 1000 - ((at % 1000 + 1000) % 1000));
          buckets[parts.hour].worked! += (next - at) / 60000;
          at = next;
        }
      }
    }
  }
  return buckets.map(({ start: _start, end: _end, ...bucket }) => bucket);
}
