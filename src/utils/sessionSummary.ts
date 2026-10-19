import type { PSTask } from '../types';
import { taskStepProgress } from '../components/strategyViewModel';
import { localTaskDate } from './taskDates';
import { getTaskSessionSeconds } from './taskTimer';

export interface EndedSession {
  taskId: string;
  endedAt: number;
  seconds: number;
  reason: 'paused' | 'completed' | 'countdownEnded';
  // Preserve identity after the timer and temporary attempt fields are cleared.
  sessionId?: string;
  limitedStart?: boolean;
}

export interface SessionSummary {
  title: string;
  minutesLabel: string;
  lines: string[];
  tone: 'focus' | 'attempt';
}

const validTime = (value: number | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 8640000000000000;
const secondsValue = (value: number | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
const boundedSeconds = (value: number | undefined) => Math.min(86400, secondsValue(value));
const timerSessionId = (task: PSTask) => task.timerSessionId ?? (validTime(task.timerStartedAt)
  ? 'legacy:' + task.timerStartedAt + ':' + (task.timeResetAt ?? 0) : undefined);

/** Only transitions of surviving tasks can end a session. */
export function detectEndedSessions(prev: readonly PSTask[], next: readonly PSTask[], now: number): EndedSession[] {
  if (!validTime(now)) return [];
  const previous = new Map(prev.map(task => [task.id, task]));
  const ended: EndedSession[] = [];
  for (const task of next) {
    const before = previous.get(task.id);
    if (!before) continue;
    const expired = validTime(task.countdownExpiredAt) && task.countdownExpiredAt !== before.countdownExpiredAt;
    if (!(before.timerRunning && !task.timerRunning) && !expired) continue;
    const sessionId = timerSessionId(before);
    const earliest = validTime(before.timerStartedAt) ? before.timerStartedAt : 0;
    let endedAt = now;
    if (expired && task.countdownExpiredAt! >= earliest && task.countdownExpiredAt! <= now) endedAt = task.countdownExpiredAt!;
    else if (task.done && !before.done && validTime(task.completedAt) && task.completedAt >= earliest && task.completedAt <= now) endedAt = task.completedAt;
    else {
      const oldEvents = new Set(before.activityTrail?.map(event => event.id));
      const stop = task.activityTrail?.filter(event => !oldEvents.has(event.id) &&
        (event.kind === 'paused' || event.kind === 'attempt') && validTime(event.at) && event.at >= earliest && event.at <= now)
        .sort((a, b) => a.at - b.at)[0];
      if (stop) endedAt = stop.at;
    }
    const record = sessionId ? task.timeSessions?.[sessionId] : undefined;
    const elapsed = getTaskSessionSeconds(before, endedAt);
    const delta = Math.max(0, secondsValue(task.timeSpentSeconds) - secondsValue(before.timeSpentSeconds));
    // A ledger checkpoint belongs to this entire session, unlike the total delta.
    const duration = record && Number.isFinite(record.seconds) && record.seconds >= 0
      ? expired && task.timerRunning ? Math.max(record.seconds, elapsed) : record.seconds
      : before.timerRunning && validTime(before.timerStartedAt) ? elapsed
      : delta;
    const seconds = boundedSeconds(duration);
    if (seconds < 60) continue;
    ended.push({ taskId: task.id, endedAt, seconds,
      reason: task.done && !before.done ? 'completed' : expired ? 'countdownEnded' : 'paused',
      ...(sessionId ? { sessionId } : {}), ...(before.limitedStart ? { limitedStart: true } : {}),
    });
  }
  return ended.sort((a, b) => a.endedAt - b.endedAt);
}

function durationLabel(seconds: number, lang: 'uk' | 'en'): string {
  const minutes = Math.max(1, Math.floor(boundedSeconds(seconds) / 60));
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  if (!hours) return lang === 'uk' ? minutes + ' хв' : minutes + ' min';
  return lang === 'uk' ? hours + ' год' + (rest ? ' ' + rest + ' хв' : '')
    : hours + ' hr' + (rest ? ' ' + rest + ' min' : '');
}

interface RecordedSession { id: string; taskId: string; seconds: number; endedAt?: number }

function recordedSessions(tasks: readonly PSTask[], now: number, current: EndedSession): RecordedSession[] {
  const records: RecordedSession[] = [];
  const seen = new Set<string>();
  for (const task of tasks) {
    if (task.scheduledPending || seen.has(task.id)) continue;
    seen.add(task.id);
    const activeId = task.timerRunning ? timerSessionId(task) : undefined;
    const taskRecords: RecordedSession[] = [];
    for (const [id, value] of Object.entries(task.timeSessions ?? {})) {
      if (id === activeId || (task.id === current.taskId && id === current.sessionId) || !Number.isFinite(value.seconds) || value.seconds < 60 || value.seconds > 86400) continue;
      const record: RecordedSession = { id, taskId: task.id, seconds: Math.floor(value.seconds) };
      const legacy = /^legacy:(\d+):(\d+)$/.exec(id);
      if (legacy) {
        const start = Number(legacy[1]), end = start + record.seconds * 1000;
        if (!validTime(start) || !validTime(end) || end > now) continue;
        record.endedAt = end;
      }
      taskRecords.push(record);
    }
    // UUID ledger entries have no dates. Match only explicit, complete activity pairs.
    let startedAt: number | undefined;
    const used = new Set<string>();
    for (const event of [...(task.activityTrail ?? [])].sort((a, b) => a.at - b.at)) {
      if (!validTime(event.at) || event.at > now) continue;
      if (event.kind === 'started') { startedAt = event.at; continue; }
      if (event.kind !== 'paused' && event.kind !== 'completed' && event.kind !== 'attempt') continue;
      if (task.id === current.taskId && event.at === current.endedAt) { startedAt = undefined; continue; }
      const duration = event.kind === 'attempt' ? boundedSeconds(event.attemptSeconds)
        : startedAt === undefined ? 0 : Math.floor((event.at - startedAt) / 1000);
      if (duration >= 60) {
        const matches = taskRecords.filter(record => !used.has(record.id) && record.seconds === duration &&
          (record.endedAt === undefined || record.endedAt === event.at));
        const record = matches.length === 1 ? matches[0] : undefined;
        if (record) { record.endedAt = event.at; used.add(record.id); }
      }
      startedAt = undefined;
    }
    records.push(...taskRecords);
  }
  return records;
}

function sessionOrdinal(count: number, lang: 'uk' | 'en'): string {
  const uk = ['', '', 'Друга', 'Третя', 'Четверта', 'П’ята', 'Шоста', 'Сьома', 'Восьма', 'Дев’ята', 'Десята'];
  const en = ['', '', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];
  if (count <= 10) return lang === 'uk' ? uk[count] + ' сесія сьогодні' : en[count] + ' session today';
  return lang === 'uk' ? 'Сесія №' + count + ' сьогодні' : 'Session #' + count + ' today';
}

/** Celebrate measured work; missing timestamps never become invented history. */
export function buildSessionSummary(session: EndedSession, task: PSTask, allTasks: readonly PSTask[], now: number, lang: 'uk' | 'en'): SessionSummary {
  const seconds = boundedSeconds(session.seconds);
  const limited = Boolean(session.limitedStart || task.limitedStart || task.activityTrail?.some(event =>
    event.kind === 'attempt' && event.at === session.endedAt && event.attemptSeconds === seconds));
  const duration = durationLabel(seconds, lang);
  const lines: string[] = [];
  if (task.stepList?.length) {
    const progress = taskStepProgress(task);
    lines.push(lang === 'uk' ? progress.done + ' з ' + progress.total + ' ' + (progress.total % 10 === 1 && progress.total % 100 !== 11 ? 'кроку' : 'кроків')
      : progress.done + ' of ' + progress.total + ' ' + (progress.total === 1 ? 'step' : 'steps'));
  }
  const tasks = allTasks.some(candidate => candidate.id === task.id) ? allTasks : [...allTasks, task];
  const records = recordedSessions(tasks, now, session);
  const earlier = records.filter(record => !(record.taskId === session.taskId && record.id === session.sessionId) &&
    (record.endedAt === undefined || record.endedAt < session.endedAt));
  // Without identity, an equal duration on this task may be the session just banked.
  if (!session.sessionId) {
    const current = earlier.findIndex(record => record.taskId === session.taskId && record.seconds === seconds);
    if (current >= 0) earlier.splice(current, 1);
  }
  if (earlier.length >= 5) {
    const values = earlier.map(record => record.seconds).sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    const median = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
    if (seconds >= median * 1.2) lines.push(lang === 'uk'
      ? 'Довше за твою звичну сесію (' + durationLabel(median, lang) + ')'
      : 'Longer than your usual session (' + durationLabel(median, lang) + ')');
  }
  if (records.every(record => record.endedAt !== undefined) && validTime(now) && validTime(session.endedAt) && session.endedAt <= now && localTaskDate(session.endedAt) === localTaskDate(now)) {
    const today = records.filter(record => record.endedAt !== undefined && record.endedAt < session.endedAt &&
      !(record.taskId === session.taskId && record.id === session.sessionId) && localTaskDate(record.endedAt) === localTaskDate(now));
    const count = today.length + 1;
    if (count >= 2) lines.push(sessionOrdinal(count, lang));
  }
  if (seconds < 600) lines.push(lang === 'uk' ? 'Старт є — це найважче.' : "You started — that's the hard part.");
  return { title: task.title, minutesLabel: limited
    ? lang === 'uk' ? 'Спробу зараховано · ' + duration : 'Attempt counted · ' + duration
    : lang === 'uk' ? duration + ' фокусу' : duration + ' of focus', lines, tone: limited ? 'attempt' : 'focus' };
}
