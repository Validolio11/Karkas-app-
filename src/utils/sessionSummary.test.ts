import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PSTask } from '../types';
import { annotateTaskChanges } from './taskActivity';
import { finishLimitedStart, startLimitedStart } from './limitedStart';
import { completeTask } from './taskOperations';
import { configureTaskCountdown, expireTaskCountdown, pauseTaskTimer, startTaskTimer } from './taskTimer';
import { buildSessionSummary, detectEndedSessions, type EndedSession } from './sessionSummary';

const now = new Date(2026, 9, 20, 15, 0, 0, 0).getTime();
const task = (overrides: Partial<PSTask> = {}): PSTask => ({
  id: 'task-1', title: 'Write the opening', phase: 'focus', priority: 2, steps: 0,
  currentStep: 0, done: false, pinned: false, createdAt: now - 86400000, ...overrides,
});
const session = (overrides: Partial<EndedSession> = {}): EndedSession => ({
  taskId: 'task-1', endedAt: now, seconds: 2820, reason: 'paused', sessionId: 'current', ...overrides,
});
const summary = (seconds: number, lang: 'uk' | 'en' = 'uk') =>
  buildSessionSummary(session({ seconds }), task(), [], now, lang);
const history = (minutes: number[]): PSTask => task({
  id: 'history',
  timeSessions: Object.fromEntries(minutes.map((value, index) => ['past-' + index, { seconds: value * 60 }])),
});

test('pause records only the current session, not the cumulative task time', () => {
  const running = startTaskTimer(task({ timeSpentSeconds: 7200 }), now - 2820000, () => 'current');
  const paused = pauseTaskTimer(running, now);
  const ended = detectEndedSessions([running], [paused], now);
  assert.equal(ended.length, 1);
  assert.equal(ended[0].seconds, 2820);
  assert.equal(ended[0].endedAt, now);
  assert.equal(ended[0].reason, 'paused');
  assert.equal(ended[0].sessionId, 'current');
});

test('ledger checkpoints do not shrink the acknowledged session to its unbanked tail', () => {
  const running = task({
    timerRunning: true, timerStartedAt: now - 600000, timerSessionId: 'current',
    timeSpentSeconds: 7300, timeSessions: { current: { seconds: 100 } },
  });
  const paused = pauseTaskTimer(running, now);
  assert.equal(paused.timeSpentSeconds! - running.timeSpentSeconds!, 500);
  assert.equal(detectEndedSessions([running], [paused], now)[0].seconds, 600);
});

test('legacy timer identity is preserved and missing timer starts can use a banked delta', () => {
  const running = task({ timerRunning: true, timerStartedAt: now - 120000, timeSpentSeconds: 600 });
  const paused = pauseTaskTimer(running, now);
  assert.equal(detectEndedSessions([running], [paused], now)[0].seconds, 120);
  assert.equal(detectEndedSessions([running], [paused], now)[0].sessionId, 'legacy:' + running.timerStartedAt + ':0');
  const noStart = task({ timerRunning: true, timeSpentSeconds: 600 });
  assert.equal(detectEndedSessions([noStart], [{ ...noStart, timerRunning: false, timeSpentSeconds: 690 }], now)[0].seconds, 90);
});

test('newly expired countdowns use their exact zero crossing and remaining budget after a resume', () => {
  const running = task({
    timerMode: 'countdown', countdownDurationSeconds: 1800, countdownRemainingSeconds: 420,
    timerRunning: true, timerStartedAt: now - 1200000, timerSessionId: 'current', timeSpentSeconds: 1380,
  });
  const expired = expireTaskCountdown(running, now);
  const ended = detectEndedSessions([running], [expired], now);
  assert.equal(ended[0].reason, 'countdownEnded');
  assert.equal(ended[0].seconds, 420);
  assert.equal(ended[0].endedAt, running.timerStartedAt! + 420000);
  assert.deepEqual(detectEndedSessions([expired], [{ ...expired }], now), []);
});

test('expiry works before banking and marker-only changes with no measured time stay quiet', () => {
  const running = configureTaskCountdown(task(), 600, now - 900000, () => 'current');
  const marked = { ...running, countdownExpiredAt: now - 300000 };
  assert.equal(detectEndedSessions([running], [marked], now)[0].seconds, 600);
  const checkpoint = { ...running, timeSpentSeconds: 100, timeSessions: { current: { seconds: 100 } } };
  assert.equal(detectEndedSessions([checkpoint], [{ ...checkpoint, countdownExpiredAt: now - 300000 }], now)[0].seconds, 600);
  const paused = task({ timeSpentSeconds: 300 });
  assert.deepEqual(detectEndedSessions([paused], [{ ...paused, countdownExpiredAt: now }], now), []);
});

test('task completion wins over a simultaneous expiry and keeps the actual completion time', () => {
  const running = startTaskTimer(task(), now - 120000, () => 'current');
  const completed = completeTask(running, now - 10000);
  const ended = detectEndedSessions([running], [completed], now)[0];
  assert.equal(ended.reason, 'completed');
  assert.equal(ended.seconds, 110);
  assert.equal(ended.endedAt, now - 10000);
});

test('deletion, insertion, continued timers, negative time and accidental clicks have no card', () => {
  const running = startTaskTimer(task(), now - 59000, () => 'current');
  assert.deepEqual(detectEndedSessions([running], [], now), []);
  assert.deepEqual(detectEndedSessions([], [pauseTaskTimer(running, now)], now), []);
  assert.deepEqual(detectEndedSessions([running], [{ ...running }], now), []);
  assert.deepEqual(detectEndedSessions([running], [pauseTaskTimer(running, now)], now), []);
  const future = { ...running, timerStartedAt: now + 100000 };
  assert.deepEqual(detectEndedSessions([future], [pauseTaskTimer(future, now)], now), []);
  assert.deepEqual(detectEndedSessions([running], [pauseTaskTimer(running, now)], NaN), []);
  const exactly = { ...running, timerStartedAt: now - 60000 };
  assert.equal(detectEndedSessions([exactly], [pauseTaskTimer(exactly, now)], now)[0].seconds, 60);
});

test('detected durations are capped at 24 hours and multiple endings are chronological', () => {
  const older = startTaskTimer(task({ id: 'older' }), now - 200000, () => 'older-session');
  const long = startTaskTimer(task(), now - 172800000, () => 'current');
  const result = detectEndedSessions([long, older], [pauseTaskTimer(long, now), completeTask(older, now - 10000)], now);
  assert.equal(result[0].taskId, 'older');
  assert.equal(result[1].seconds, 86400);
});

test('limited attempts remain recognizable after the temporary timer fields are restored', () => {
  const running = startLimitedStart(task(), 600, now - 600000, { newId: () => 'attempt-session' });
  const finished = finishLimitedStart(running, now);
  const ended = detectEndedSessions([running], [finished], now)[0];
  assert.equal(finished.limitedStart, undefined);
  assert.equal(ended.limitedStart, true);
  assert.equal(buildSessionSummary(ended, finished, [finished], now, 'uk').minutesLabel, 'Спробу зараховано · 10 хв');
  assert.equal(buildSessionSummary(ended, finished, [finished], now, 'en').tone, 'attempt');
});

test('headlines express minutes and hours with English equivalents', () => {
  assert.equal(summary(2820).minutesLabel, '47 хв фокусу');
  assert.equal(summary(4320).minutesLabel, '1 год 12 хв фокусу');
  assert.equal(summary(3600).minutesLabel, '1 год фокусу');
  assert.equal(summary(2820, 'en').minutesLabel, '47 min of focus');
  assert.equal(summary(4320, 'en').minutesLabel, '1 hr 12 min of focus');
  assert.equal(summary(60).title, 'Write the opening');
});

test('short sessions get encouragement only below ten minutes', () => {
  assert.ok(summary(599).lines.includes('Старт є — це найважче.'));
  assert.ok(summary(599, 'en').lines.includes("You started — that's the hard part."));
  assert.ok(!summary(600).lines.some(line => line.includes('найважче')));
});

test('named-step totals use reliable progress without inventing closure timestamps', () => {
  const stepped = task({ stepList: [
    { id: '1', title: 'One', done: true }, { id: '2', title: 'Two', done: true },
    { id: '3', title: 'Three', done: false }, { id: '4', title: 'Four', done: false },
  ] });
  assert.deepEqual(buildSessionSummary(session(), stepped, [], now, 'uk').lines, ['2 з 4 кроків']);
  assert.deepEqual(buildSessionSummary(session(), stepped, [], now, 'en').lines, ['2 of 4 steps']);
  const single = task({ stepList: [{ id: '1', title: 'One', done: false }] });
  assert.equal(buildSessionSummary(session(), single, [], now, 'uk').lines[0], '0 з 1 кроку');
  const twentyOne = task({ stepList: Array.from({ length: 21 }, (_, index) => ({ id: String(index), title: 'Step', done: index < 2 })) });
  assert.equal(buildSessionSummary(session(), twentyOne, [], now, 'uk').lines[0], '2 з 21 кроку');
  const eleven = task({ stepList: twentyOne.stepList!.slice(0, 11) });
  assert.equal(buildSessionSummary(session(), eleven, [], now, 'uk').lines[0], '2 з 11 кроків');
  assert.deepEqual(buildSessionSummary(session(), task({ steps: 4, currentStep: 2 }), [], now, 'uk').lines, []);
});

test('self-comparison requires five earlier ledger sessions and excludes the current session', () => {
  const current = task({ timeSessions: { current: { seconds: 2820 } } });
  assert.deepEqual(buildSessionSummary(session(), current, [current, history([20, 25, 31, 35])], now, 'uk').lines, []);
  assert.ok(buildSessionSummary(session(), current, [current, history([20, 25, 31, 35, 40])], now, 'uk').lines
    .includes('Довше за твою звичну сесію (31 хв)'));
  assert.ok(buildSessionSummary(session(), current, [current, history([20, 25, 31, 35, 40])], now, 'en').lines
    .includes('Longer than your usual session (31 min)'));
  assert.deepEqual(buildSessionSummary(session({ seconds: 2200 }), current, [current, history([20, 25, 31, 35, 40])], now, 'uk').lines, []);
});

test('the median averages its two middle observations and ignores active checkpoints and invalid samples', () => {
  const active = task({ id: 'running', timerRunning: true, timerSessionId: 'active', timeSessions: { active: { seconds: 60 } } });
  const invalid = task({ id: 'invalid', timeSessions: {
    zero: { seconds: 0 }, negative: { seconds: -60 }, nan: { seconds: NaN }, huge: { seconds: 90000 },
  } });
  const records = history([20, 25, 30, 32, 35, 40]);
  const lines = buildSessionSummary(session(), task(), [records, active, invalid], now, 'uk').lines;
  assert.ok(lines.includes('Довше за твою звичну сесію (31 хв)'));
});

test('UUID sessions count today only when complete activity pairs match recorded time', () => {
  let recorded = task({ id: 'history' });
  for (let index = 0; index < 2; index++) {
    const startAt = now - (5 - index * 2) * 3600000;
    const running = annotateTaskChanges([recorded], [startTaskTimer(recorded, startAt, () => 'past-' + index)], startAt)[0];
    recorded = annotateTaskChanges([running], [pauseTaskTimer(running, startAt + (600 + index * 300) * 1000)], startAt + (600 + index * 300) * 1000)[0];
  }
  const uk = buildSessionSummary(session(), task(), [recorded], now, 'uk').lines;
  assert.ok(uk.includes('Третя сесія сьогодні'));
  assert.ok(buildSessionSummary(session(), task(), [recorded], now, 'en').lines.includes('Third session today'));
  const undated = history([10, 10]);
  assert.ok(!buildSessionSummary(session(), task(), [undated], now, 'uk').lines.some(line => line.includes('сьогодні')));
  assert.ok(!buildSessionSummary(session(), task(), [recorded, task({ ...undated, id: 'unknown-day' })], now, 'uk').lines.some(line => line.includes('сьогодні')));
});

test('legacy timestamps count local calendar days, use ordinal words through ten and then session numbers', () => {
  const localStart = new Date(2026, 9, 20, 8).getTime();
  const past = task({ id: 'history', timeSessions: Object.fromEntries(Array.from({ length: 10 }, (_, index) => [
    'legacy:' + (localStart + index * 1200000) + ':0', { seconds: 600 },
  ])) });
  assert.ok(buildSessionSummary(session(), task(), [past], now, 'uk').lines.includes('Сесія №11 сьогодні'));
  const two = task({ id: 'history', timeSessions: { ['legacy:' + localStart + ':0']: { seconds: 600 } } });
  assert.ok(buildSessionSummary(session(), task(), [two], now, 'uk').lines.includes('Друга сесія сьогодні'));
  const yesterday = task({ id: 'history', timeSessions: { ['legacy:' + (localStart - 86400000) + ':0']: { seconds: 600 } } });
  assert.ok(!buildSessionSummary(session(), task(), [yesterday], now, 'uk').lines.some(line => line.includes('сьогодні')));
});
