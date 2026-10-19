import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DeletedTask, PSTask, TaskActivityEvent } from '../types';
import { localTaskDate } from './taskDates';
import {
  carryOverCandidates, dayCloseHour, formatDayFocus, formatDaySessions, morningRecap,
  normalizeDayLog, pluralUk, shouldOfferDayClose, summarizeDay,
} from './dayRecap';

const now = new Date(2026, 9, 20, 20).getTime();
const date = localTaskDate(now);
const at = (hour: number, minute = 0) => new Date(2026, 9, 20, hour, minute).getTime();
const task = (overrides: Partial<PSTask> = {}): PSTask => ({
  id: 'one', title: 'Код-рев’ю', phase: 'focus', priority: 2, steps: 0,
  currentStep: 0, done: false, pinned: false, createdAt: at(8), ...overrides,
});
const event = (kind: TaskActivityEvent['kind'], time: number, extra: Partial<TaskActivityEvent> = {}): TaskActivityEvent =>
  ({ id: kind + ':' + time, kind, at: time, ...extra });
const legacy = (start: number, seconds: number) => ({ ['legacy:' + start + ':0']: { seconds } });
const summarize = (tasks: PSTask[], archive: DeletedTask[] = []) => summarizeDay(tasks, archive, date, now);

test('dated sessions and explicit completions produce measured daily results', () => {
  const result = summarize([task({ done: true, completedAt: at(11), timeSpentSeconds: 99999,
    timeSessions: { ...legacy(at(9), 600), ...legacy(at(10), 1200) },
    activityTrail: [event('started', at(9)), event('paused', at(9, 10)), event('started', at(10)), event('completed', at(11))],
  })]);
  assert.deepEqual(result, { date, focusSeconds: 1800, sessions: 2, completed: [{ id: 'one', title: 'Код-рев’ю' }], startedCount: 1 });
});

test('undated totals, UUID records and completion age never invent daily focus', () => {
  const result = summarize([task({ done: true, completedAt: at(10), startedAt: at(8), timeSpentSeconds: 7200,
    timeSessions: { unknown: { seconds: 7200 } },
  })]);
  assert.equal(result.focusSeconds, 0);
  assert.equal(result.sessions, 0);
  assert.equal(result.completed.length, 1);
  assert.equal(result.startedCount, 1);
});

test('UUID ledgers match complete activity pairs once, including equal duration sessions', () => {
  const result = summarize([task({ timeSessions: { a: { seconds: 600 }, b: { seconds: 600 } }, activityTrail: [
    event('started', at(9)), event('paused', at(9, 10)), event('started', at(10)), event('paused', at(10, 10)),
    event('completed', at(10, 10)), event('started', at(11)), event('paused', at(11, 10)),
  ] })]);
  assert.equal(result.focusSeconds, 1200);
  assert.equal(result.sessions, 2);
});

test('explicit activity pairs without a ledger count, while incomplete or future pairs do not', () => {
  const result = summarize([task({ activityTrail: [
    event('paused', at(8)), event('started', at(9)), event('paused', at(9, 10)),
    event('started', at(10)), event('paused', at(21)),
  ] })]);
  assert.equal(result.focusSeconds, 600);
  assert.equal(result.sessions, 1);
  assert.equal(summarize([task({ activityTrail: [event('started', at(9))] })]).focusSeconds, 0);
});

test('running timers include today only and do not double count banked checkpoints', () => {
  const running = task({ timerRunning: true, timerStartedAt: at(19, 50), timerSessionId: 'current',
    timeSpentSeconds: 4000, timeSessions: { current: { seconds: 300 } },
  });
  assert.equal(summarize([running]).focusSeconds, 600);
  assert.equal(summarize([running]).sessions, 1);
  const yesterday = new Date(2026, 9, 19, 23, 50).getTime();
  const overnight = { ...running, timerStartedAt: yesterday };
  assert.equal(summarizeDay([overnight], [], '2026-10-19', now).focusSeconds, 0);
  assert.equal(summarize([overnight]).focusSeconds, 20 * 3600);
  const longRunning = { ...running, timerStartedAt: new Date(2026, 9, 18, 23, 50).getTime() };
  assert.equal(summarize([longRunning]).focusSeconds, 20 * 3600);
  assert.equal(summarize([longRunning]).sessions, 1);
  const countdown = { ...running, timerMode: 'countdown' as const, countdownDurationSeconds: 1800, countdownRemainingSeconds: 180 };
  assert.equal(summarize([countdown]).focusSeconds, 180);
});

test('local midnight clips historical intervals without moving yesterday work into today', () => {
  const start = new Date(2026, 9, 19, 23, 50).getTime();
  const recorded = task({ timeSessions: legacy(start, 1200) });
  assert.equal(summarizeDay([recorded], [], '2026-10-19', now).focusSeconds, 600);
  assert.equal(summarize([recorded]).focusSeconds, 600);
  assert.equal(summarize([recorded]).sessions, 1);
  assert.equal(summarizeDay([recorded], [], 'invalid', now).focusSeconds, 0);
  assert.equal(summarizeDay([recorded], [], date, NaN).focusSeconds, 0);
});

test('calendar bounds follow local dates around DST and year changes', () => {
  for (const day of [[2026, 2, 29], [2026, 9, 25], [2026, 11, 31]]) {
    const midnight = new Date(day[0], day[1], day[2]).getTime();
    const next = new Date(midnight);
    next.setDate(next.getDate() + 1);
    const start = midnight - 600000;
    const recorded = task({ timeSessions: legacy(start, 1200) });
    assert.equal(summarizeDay([recorded], [], localTaskDate(midnight), next.getTime()).focusSeconds, 600);
  }
});

test('completed archive work is retained, accidental and unfinished archive records are excluded', () => {
  const archived = (id: string, extra: Partial<DeletedTask> = {}): DeletedTask => ({
    ...task({ id, done: true, completedAt: at(12), timeSessions: legacy(at(11), 600) }), deletedAt: at(13), ...extra,
  });
  const archive = [archived('closed'), archived('accidental', { deletionReason: 'accidental' }),
    archived('cancelled', { done: false, deletionReason: 'cancelled' }), archived('pending', { scheduledPending: true }), archived('closed')];
  const result = summarize([], archive);
  assert.deepEqual(result.completed.map(value => value.id), ['closed']);
  assert.equal(result.focusSeconds, 600);
  assert.equal(summarize([task({ id: 'closed' })], archive).completed.length, 0);
});

test('duplicate rows and duplicate completion events acknowledge each task once', () => {
  const closed = task({ done: true, completedAt: at(12), activityTrail: [event('completed', at(12)), event('completed', at(13))], timeSessions: legacy(at(11), 600) });
  assert.equal(summarize([closed, closed]).completed.length, 1);
  assert.equal(summarize([closed, closed]).focusSeconds, 600);
  assert.equal(summarize([task({ activityTrail: [event('completed', at(12)), event('reopened', at(13))] })]).completed.length, 1);
});

test('recorded attempts count their credited duration and overlapping explicit credits are counted once', () => {
  const attempted = task({ timeSessions: { attempt: { seconds: 300 } }, activityTrail: [
    event('started', at(9)), event('attempt', at(9, 10), { attemptSeconds: 300 }),
    event('time_adjusted', at(10), { workedFrom: at(9), workedUntil: at(9, 5) }),
  ] });
  assert.equal(summarize([attempted]).focusSeconds, 300);
  assert.equal(summarize([attempted]).sessions, 1);
  const invalid = task({ activityTrail: [event('time_adjusted', at(10)), event('attempt', at(11), { attemptSeconds: 300 })] });
  assert.equal(summarize([invalid]).focusSeconds, 0);
});

test('ambiguous or unmatched UUIDs and delayed overnight attempts stay unattributed', () => {
  const unknown = task({ timeSessions: { a: { seconds: 600 }, b: { seconds: 1200 } }, activityTrail: [
    event('started', at(9)), event('paused', at(9, 15)),
  ] });
  assert.equal(summarize([unknown]).focusSeconds, 0);
  const overnight = task({ timeSessions: { attempt: { seconds: 300 } }, activityTrail: [
    event('started', new Date(2026, 9, 19, 23, 55).getTime()),
    event('attempt', at(0, 10), { attemptSeconds: 300 }),
  ] });
  assert.equal(summarize([overnight]).focusSeconds, 0);
  assert.equal(summarizeDay([overnight], [], '2026-10-19', now).focusSeconds, 0);
});

test('carry over includes missed plans and today deadlines and sorts priority before deadline', () => {
  const candidates = [
    task({ id: 'missed', priority: 2, plannedDate: '2026-10-18' }),
    task({ id: 'due', priority: 2, deadlineDate: date }),
    task({ id: 'urgent', priority: 1, plannedDate: date, deadlineDate: '2026-10-25' }),
    task({ id: 'future', plannedDate: '2026-10-21' }), task({ id: 'none' }),
    task({ id: 'done', done: true, plannedDate: date }), task({ id: 'pending', scheduledPending: true, plannedDate: date }),
    task({ id: 'invalid', plannedDate: '2026-00-00' }),
  ];
  assert.deepEqual(carryOverCandidates(candidates, date).map(value => value.id), ['urgent', 'due', 'missed']);
  assert.equal(candidates[0].id, 'missed');
  assert.deepEqual(carryOverCandidates(candidates, 'invalid'), []);
});

test('day closure follows the latest reliable hour and a bounded evening window', () => {
  const pattern = { confidence: 'low' as const, observedHours: [{ hour: 18, count: 5 }, { hour: 20, count: 1 }] };
  assert.equal(dayCloseHour(pattern), 21);
  assert.equal(dayCloseHour({ ...pattern, confidence: 'insufficient' }), 18);
  assert.equal(dayCloseHour({ ...pattern, observedHours: [{ hour: 7, count: 5 }] }), 16);
  assert.equal(dayCloseHour({ ...pattern, observedHours: [{ hour: 23, count: 1 }] }), 23);
  const summary = summarize([task({ timeSessions: legacy(at(9), 60) })]);
  assert.equal(shouldOfferDayClose({ now, closeHour: 18, summary, closedDates: {} }), true);
  for (const closedDates of [[date], new Set([date]), { [date]: {} }]) {
    assert.equal(shouldOfferDayClose({ now, closeHour: 18, summary, closedDates }), false);
  }
  assert.equal(shouldOfferDayClose({ now: at(17), closeHour: 18, summary, closedDates: [] }), false);
  assert.equal(shouldOfferDayClose({ now, closeHour: 18, summary: { ...summary, date: '2026-10-19' }, closedDates: [] }), false);
  assert.equal(shouldOfferDayClose({ now, closeHour: 18, summary: { ...summary, focusSeconds: 59 }, closedDates: [] }), false);
  assert.equal(shouldOfferDayClose({ now, closeHour: 18, summary: { ...summary, focusSeconds: 0, completed: [{ id: 'one', title: 'Done' }] }, closedDates: [] }), true);
});

test('morning recap exposes only yesterday recorded results and first completed title', () => {
  const empty = summarize([]);
  assert.equal(morningRecap(empty), null);
  assert.deepEqual(morningRecap({ ...empty, focusSeconds: 30 }), { date, focusSeconds: 30, remainingCompleted: 0, completedCount: 0 });
  assert.deepEqual(morningRecap({ ...empty, completed: [{ id: 'a', title: 'Review' }, { id: 'b', title: 'Draft' }] }),
    { date, focusSeconds: 0, completedTitle: 'Review', remainingCompleted: 1, completedCount: 2 });
});

test('duration labels and Ukrainian session plurals remain calm and factual', () => {
  assert.equal(formatDayFocus(7800, 'uk'), '2 год 10 хв фокусу');
  assert.equal(formatDayFocus(3600, 'en'), '1 hr of focus');
  assert.equal(formatDayFocus(0, 'uk'), '0 хв фокусу');
  assert.equal(formatDaySessions(3, 'uk'), '3 сесії');
  assert.equal(formatDaySessions(1, 'en'), '1 session');
  assert.equal(formatDaySessions(2, 'en'), '2 sessions');
  for (const count of [1, 21, 101]) assert.equal(pluralUk(count, 'сесія', 'сесії', 'сесій'), 'сесія');
  for (const count of [2, 4, 22]) assert.equal(pluralUk(count, 'сесія', 'сесії', 'сесій'), 'сесії');
  for (const count of [0, 5, 11, 12, 14, 111]) assert.equal(pluralUk(count, 'сесія', 'сесії', 'сесій'), 'сесій');
});

test('local day log rejects malformed records and bounds notes and retained dates', () => {
  assert.deepEqual(normalizeDayLog(null), { closed: {} });
  const entry = { closedAt: now, focusSeconds: 60, sessions: 1, completed: 0 };
  const closed: Record<string, unknown> = {};
  for (let index = 0; index < 65; index++) {
    const day = new Date(2026, 7, 1 + index);
    closed[localTaskDate(day.getTime())] = entry;
  }
  closed.invalid = entry;
  closed['2026-10-20'] = { ...entry, focusSeconds: -1 };
  closed['2026-10-21'] = { ...entry, note: '  One\nline\t' + 'x'.repeat(300) };
  const result = normalizeDayLog({ closed, recapDismissed: date });
  assert.equal(Object.keys(result.closed).length, 60);
  assert.equal(result.closed['2026-10-20'], undefined);
  assert.equal(result.closed['2026-08-01'], undefined);
  assert.equal(result.closed['2026-10-21'].note!.length, 240);
  assert.ok(!result.closed['2026-10-21'].note!.includes('\n'));
  assert.equal(result.recapDismissed, date);
  assert.equal(normalizeDayLog({ closed: {}, recapDismissed: 'invalid' }).recapDismissed, undefined);
});
