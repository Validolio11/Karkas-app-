import type { DeletedTask, PSTask, TaskCompletionLedger } from '../types';
import { isCompletedArchivedTask, selectArchivedTasks } from './taskArchive';
import { isTaskDate, localTaskDate } from './taskDates';
import { getTaskSessionSeconds } from './taskTimer';
import type { WorkInsights } from './workInsights';

export interface DaySummary {
  date: string;
  focusSeconds: number;
  sessions: number;
  completed: { id: string; title: string }[];
  /** Includes retained completion receipts whose full task details are no longer available. */
  completedCount?: number;
  startedCount: number;
}

export const dayCompletedCount = (summary: DaySummary): number => summary.completedCount ?? summary.completed.length;

export interface DayLog {
  closed: Record<string, { closedAt: number; focusSeconds: number; sessions: number; completed: number; note?: string }>;
  resumed?: Record<string, number>;
  recapDismissed?: string;
}

const validTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 8640000000000000;
const validSeconds = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 86400;
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function dayBounds(date: string): [number, number] | null {
  if (!isTaskDate(date)) return null;
  const [year, month, day] = date.split('-').map(Number);
  const start = new Date(0);
  start.setFullYear(year, month - 1, day);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return [start.getTime(), end.getTime()];
}

interface Interval { start: number; end: number; session: boolean }

function recordedIntervals(task: PSTask, now: number, today: boolean): Interval[] {
  const intervals: Interval[] = [];
  const activeId = task.timerRunning && validTime(task.timerStartedAt)
    ? task.timerSessionId ?? 'legacy:' + task.timerStartedAt + ':' + (task.timeResetAt ?? 0) : undefined;
  const undated: number[] = [];
  const ledger = Object.entries(task.timeSessions ?? {});
  for (const [id, record] of ledger) {
    if (id === activeId || !validSeconds(record.seconds)) continue;
    const seconds = Math.floor(record.seconds);
    const match = /^legacy:(\d+):(\d+)$/.exec(id);
    if (!match) { undated.push(seconds); continue; }
    const start = Number(match[1]), end = start + seconds * 1000;
    if (validTime(start) && validTime(end) && end <= now) intervals.push({ start, end, session: true });
  }
  let startedAt: number | undefined;
  const seenEvents = new Set<string>();
  const events = [...(task.activityTrail ?? [])].filter(event => {
    if (!validTime(event.at) || event.at > now || seenEvents.has(event.id)) return false;
    seenEvents.add(event.id);
    return true;
  }).sort((a, b) => a.at - b.at);
  for (const event of events) {
    if (event.kind === 'started') { startedAt = event.at; continue; }
    if (event.kind === 'time_adjusted' && validTime(event.workedFrom) && validTime(event.workedUntil) &&
      event.workedUntil > event.workedFrom && event.workedUntil <= event.at && event.workedUntil - event.workedFrom <= 10800000) {
      intervals.push({ start: event.workedFrom, end: event.workedUntil, session: false });
    }
    if (event.kind !== 'paused' && event.kind !== 'completed' && event.kind !== 'attempt') continue;
    if (startedAt === undefined) continue;
    const start = startedAt;
    startedAt = undefined;
    const seconds = event.kind === 'attempt' ? event.attemptSeconds : Math.floor((event.at - start) / 1000);
    if (!validSeconds(seconds) || start + seconds * 1000 > event.at) continue;
    // A delayed attempt end cannot locate its credited seconds across midnight.
    if (event.kind === 'attempt' && start + seconds * 1000 !== event.at && localTaskDate(start) !== localTaskDate(event.at)) continue;
    const end = start + Math.floor(seconds) * 1000;
    if (intervals.some(interval => interval.session && interval.start === start && interval.end <= event.at)) continue;
    const matching = undated.indexOf(Math.floor(seconds));
    if (matching >= 0) undated.splice(matching, 1);
    else if (ledger.length && event.kind !== 'attempt') continue;
    intervals.push({ start, end, session: true });
  }
  // An active checkpoint is the same session, never additional work.
  if (today && !task.done && task.timerRunning && validTime(task.timerStartedAt) && task.timerStartedAt <= now) {
    const seconds = getTaskSessionSeconds(task, now);
    const end = task.timerStartedAt + seconds * 1000;
    if (Number.isSafeInteger(seconds) && seconds > 0 && validTime(end) && end <= now) {
      intervals.push({ start: task.timerStartedAt, end, session: true });
    }
  }
  return intervals;
}

/** Missing dates and cumulative totals never become invented daily work. */
export function summarizeDay(tasks: readonly PSTask[], deletedTasks: readonly DeletedTask[], date: string, now: number, completionLedger?: TaskCompletionLedger): DaySummary {
  const summary: DaySummary = { date, focusSeconds: 0, sessions: 0, completed: [], startedCount: 0 };
  const bounds = dayBounds(date);
  if (!bounds || !validTime(now)) return summary;
  const [start, end] = bounds;
  const inDay = (at: unknown): at is number => validTime(at) && at >= start && at < end && at <= now;
  const seen = new Set<string>();
  const selected = [...tasks, ...selectArchivedTasks(tasks, deletedTasks).filter(isCompletedArchivedTask)];
  for (const task of selected) {
    if (seen.has(task.id) || task.scheduledPending) continue;
    seen.add(task.id);
    const events = task.activityTrail ?? [];
    if (inDay(task.startedAt) || events.some(event => event.kind === 'started' && inDay(event.at)) ||
      (task.timerRunning && inDay(task.timerStartedAt))) summary.startedCount++;
    const receipt = completionLedger && Object.hasOwn(completionLedger, task.id) ? completionLedger[task.id] : undefined;
    if (receipt ? receipt.counted && inDay(receipt.completedAt)
      : (task.done && inDay(task.completedAt)) || events.some(event => event.kind === 'completed' && inDay(event.at))) {
      summary.completed.push({ id: task.id, title: task.title });
    }
    const intervals = recordedIntervals(task, now, date === localTaskDate(now));
    const clips = intervals.map(interval => ({ ...interval, start: Math.max(start, interval.start), end: Math.min(end, now, interval.end) }))
      .filter(interval => interval.end > interval.start).sort((a, b) => a.start - b.start || a.end - b.end);
    const sessionKeys = new Set<string>();
    for (const interval of intervals) {
      if (interval.session && interval.end - interval.start >= 60000 && Math.min(end, now, interval.end) > Math.max(start, interval.start)) {
        sessionKeys.add(interval.start + ':' + interval.end);
      }
    }
    summary.sessions += sessionKeys.size;
    // Explicit credited intervals may overlap timer records; count their union.
    let coveredUntil = start;
    for (const interval of clips) {
      summary.focusSeconds += Math.floor(Math.max(0, interval.end - Math.max(coveredUntil, interval.start)) / 1000);
      coveredUntil = Math.max(coveredUntil, interval.end);
    }
  }
  // Receipts retain only completion evidence. They cannot supply a title, timer or session.
  const knownIds = new Set([...tasks, ...deletedTasks].map(task => task.id));
  const additional = Object.entries(completionLedger ?? {}).filter(([id, receipt]) =>
    !knownIds.has(id) && receipt.counted && inDay(receipt.completedAt)).length;
  if (additional > 0) summary.completedCount = summary.completed.length + additional;
  return summary;
}

export function carryOverCandidates(tasks: readonly PSTask[], date: string): PSTask[] {
  if (!isTaskDate(date)) return [];
  return tasks.filter(task => !task.done && !task.scheduledPending &&
    ((isTaskDate(task.plannedDate) && task.plannedDate <= date) || task.deadlineDate === date))
    .sort((a, b) => a.priority - b.priority || (a.deadlineDate ?? '9999-99-99').localeCompare(b.deadlineDate ?? '9999-99-99') || a.id.localeCompare(b.id));
}

export function dayCloseHour(pattern: Pick<WorkInsights['workingPattern'], 'observedHours' | 'confidence'>): number {
  if (pattern.confidence === 'insufficient') return 18;
  const hours = pattern.observedHours.filter(item => Number.isInteger(item.hour) && item.hour >= 0 && item.hour <= 23 && item.count > 0).map(item => item.hour);
  return hours.length ? Math.max(16, Math.min(23, Math.max(...hours) + 1)) : 18;
}

export function shouldOfferDayClose({ now, closeHour, summary, closedDates }: {
  now: number; closeHour: number; summary: DaySummary;
  closedDates: readonly string[] | ReadonlySet<string> | Readonly<Record<string, unknown>>;
}): boolean {
  if (!validTime(now) || !Number.isFinite(closeHour) || summary.date !== localTaskDate(now)) return false;
  const closed = Array.isArray(closedDates) ? closedDates.includes(summary.date)
    : closedDates instanceof Set ? closedDates.has(summary.date) : Object.prototype.hasOwnProperty.call(closedDates, summary.date);
  return !closed && new Date(now).getHours() >= closeHour && (summary.focusSeconds >= 60 || dayCompletedCount(summary) > 0);
}

export function morningRecap(summary: DaySummary): {
  date: string; focusSeconds: number; completedTitle?: string; remainingCompleted: number; completedCount: number;
} | null {
  const completedCount = dayCompletedCount(summary);
  if (summary.focusSeconds <= 0 && completedCount <= 0) return null;
  const completedTitle = summary.completed[0]?.title;
  return { date: summary.date, focusSeconds: summary.focusSeconds,
    ...(completedTitle ? { completedTitle } : {}),
    remainingCompleted: Math.max(0, completedCount - (completedTitle ? 1 : 0)), completedCount };
}

export function pluralUk(count: number, one: string, few: string, many: string): string {
  const value = Math.abs(Math.floor(count)), last = value % 10, lastTwo = value % 100;
  return lastTwo >= 11 && lastTwo <= 14 ? many : last === 1 ? one : last >= 2 && last <= 4 ? few : many;
}

export function formatDayFocus(seconds: number, lang: 'uk' | 'en'): string {
  const minutes = Math.floor((Number.isFinite(seconds) ? Math.max(0, seconds) : 0) / 60);
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  const duration = hours ? (lang === 'uk' ? hours + ' год' : hours + ' hr') + (rest ? ' ' + rest + (lang === 'uk' ? ' хв' : ' min') : '')
    : minutes + (lang === 'uk' ? ' хв' : ' min');
  return duration + (lang === 'uk' ? ' фокусу' : ' of focus');
}

export function formatDaySessions(count: number, lang: 'uk' | 'en'): string {
  return count + ' ' + (lang === 'uk' ? pluralUk(count, 'сесія', 'сесії', 'сесій') : count === 1 ? 'session' : 'sessions');
}

/** Local-only journal data is bounded and validated before reuse. */
export function normalizeDayLog(value: unknown): DayLog {
  const result: DayLog = { closed: {} };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  const source = value as Record<string, unknown>;
  if (source.closed && typeof source.closed === 'object' && !Array.isArray(source.closed)) {
    for (const [date, value] of Object.entries(source.closed).filter(([date]) => isTaskDate(date)).sort(([a], [b]) => b.localeCompare(a))) {
      if (Object.keys(result.closed).length >= 60) break;
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const entry = value as Record<string, unknown>;
      if (!validTime(entry.closedAt) || !nonnegative(entry.focusSeconds) || !nonnegative(entry.sessions) || !nonnegative(entry.completed)) continue;
      const note = typeof entry.note === 'string' ? entry.note.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 240) : '';
      result.closed[date] = { closedAt: entry.closedAt, focusSeconds: entry.focusSeconds, sessions: entry.sessions, completed: entry.completed,
        ...(note ? { note } : {}) };
    }
  }
  if (isTaskDate(source.recapDismissed)) result.recapDismissed = source.recapDismissed;
  if (source.resumed && typeof source.resumed === 'object' && !Array.isArray(source.resumed)) {
    result.resumed = Object.fromEntries(Object.entries(source.resumed).filter(([date, at]) => isTaskDate(date) && validTime(at)).sort(([a], [b]) => b.localeCompare(a)).slice(0, 60)) as Record<string, number>;
  }
  return result;
}
