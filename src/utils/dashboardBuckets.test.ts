import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AnalyticsPeriod, DeletedTask, PSTask, TaskActivityEvent } from '../types';
import { buildActivityBuckets } from './dashboardBuckets';
import { continueAfterExpiry, finishAfterExpiry } from './countdownOverrun';
import { serializeTaskForCloud } from './cloudTaskSerialization';
import { annotateTaskChanges, isTaskActivityEvent } from './taskActivity';
import { parseWorkspace } from './workspaceValidation';
import { parseWorkspace as parseSharedWorkspace } from '../../electron/workspace-validation.mjs';
import { configureTaskCountdown, expireTaskCountdown, pauseTaskTimer } from './taskTimer';
import { completeTask } from './taskOperations';

const zone = 'Europe/Kyiv';
const at = (value: string) => Date.parse(value);
const now = at('2025-10-19T12:00:00+03:00');
const task = (overrides: Partial<PSTask> = {}): PSTask => ({
  id: 'task-1', title: 'Task', phase: 'focus', priority: 2, steps: 0,
  currentStep: 0, done: false, pinned: false, createdAt: now, ...overrides,
});
const event = (kind: TaskActivityEvent['kind'], time: string, extra: Partial<TaskActivityEvent> = {}): TaskActivityEvent => ({ id: kind + ':' + time, kind, at: at(time), ...extra });
const buckets = (period: AnalyticsPeriod, tasks: PSTask[] = [], archive: DeletedTask[] = [], end = now, lang: 'uk' | 'en' = 'uk') => buildActivityBuckets(period, tasks, archive, end, zone, lang);
const worked = (data: ReturnType<typeof buckets>, hour: number) => data[hour].worked;

for (const lang of ['uk', 'en'] as const) {
  test('dashboard calendar bucket counts and human labels (' + lang + ')', () => {
    const day = buckets('TODAY', [], [], now, lang);
    assert.equal(day.length, 24);
    assert.deepEqual(day.map(item => item.label), Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0')));
    const week = buckets('LAST_7_DAYS', [], [], now, lang);
    assert.equal(week.length, 7);
    assert.equal(week[0].label, lang === 'uk' ? 'Пн 13' : 'Mon 13');
    assert.equal(week[6].label, lang === 'uk' ? 'Нд 19' : 'Sun 19');
    const month = buckets('LAST_30_DAYS', [], [], now, lang);
    assert.equal(month.length, 30);
    assert.equal(month[0].label, '20');
    assert.equal(month[29].label, '19');
    assert.equal(month[0].tooltipLabel, '20.09.2025');
    const quarter = buckets('LAST_90_DAYS', [], [], now, lang);
    assert.equal(quarter.length, 13);
    assert.equal(quarter[0].label, '22.07');
    assert.equal(quarter[12].label, '14.10');
    const year = buckets('LAST_365_DAYS', [], [], now, lang);
    assert.equal(year.length, 12);
    assert.equal(year[0].label, lang === 'uk' ? 'жов–лис' : 'Oct–Nov');
    assert.equal(year[1].label, lang === 'uk' ? 'гру' : 'Dec');
    assert.equal(year[11].label, lang === 'uk' ? 'жов' : 'Oct');
    assert.equal(year[0].tooltipLabel, '20.10.2024–30.11.2024');
  });
}

test('Kyiv midnight assigns 23:59 and 00:00 to separate calendar days', () => {
  const data = buckets('LAST_7_DAYS', [
    task({ id: 'late', done: true, completedAt: at('2025-10-18T23:59:00+03:00') }),
    task({ id: 'early', done: true, completedAt: at('2025-10-19T00:00:00+03:00') }),
    task({ id: 'too-old', done: true, completedAt: at('2025-10-12T23:59:59+03:00') }),
    task({ id: 'future', done: true, completedAt: now + 1 }),
  ]);
  assert.deepEqual(data.map(item => item.delivered), [0, 0, 0, 0, 0, 1, 1]);
});

test('Kyiv winter-time transition preserves calendar days and both repeated hours', () => {
  const end = at('2025-10-26T12:00:00+02:00');
  const tasks = [
    task({ id: 'before-midnight', done: true, completedAt: at('2025-10-25T23:59:00+03:00') }),
    task({ id: 'midnight', done: true, completedAt: at('2025-10-26T00:00:00+03:00') }),
    task({ id: 'first-03', done: true, completedAt: at('2025-10-26T03:20:00+03:00') }),
    task({ id: 'second-03', done: true, completedAt: at('2025-10-26T03:20:00+02:00') }),
    task({ id: 'work', activityTrail: [event('started', '2025-10-26T03:00:00+03:00'), event('paused', '2025-10-26T04:00:00+02:00')] }),
  ];
  const week = buckets('LAST_7_DAYS', tasks, [], end);
  assert.equal(week.length, 7);
  assert.equal(week[0].label, 'Пн 20');
  assert.equal(week[5].delivered, 1);
  assert.equal(week[6].delivered, 3);
  const day = buckets('TODAY', tasks, [], end);
  assert.equal(day.length, 24);
  assert.equal(day[3].delivered, 2);
  assert.equal(worked(day, 3), 120);
});

test('Kyiv spring transition leaves the missing wall-clock hour empty', () => {
  const end = at('2025-03-30T12:00:00+03:00');
  const data = buckets('TODAY', [task({ activityTrail: [event('started', '2025-03-30T02:40:00+02:00'), event('paused', '2025-03-30T04:20:00+03:00')] })], [], end);
  assert.equal(worked(data, 2), 20);
  assert.equal(worked(data, 3), 0);
  assert.equal(worked(data, 4), 20);
});

test('day splits a 09:40–10:20 session into 20 minutes in each hour', () => {
  const data = buckets('TODAY', [task({ activityTrail: [event('started', '2025-10-19T09:40:00+03:00'), event('paused', '2025-10-19T10:20:00+03:00')] })]);
  assert.equal(worked(data, 9), 20);
  assert.equal(worked(data, 10), 20);
  assert.equal(worked(data, 8), 0);
  assert.equal(worked(data, 11), 0);
});

test('running timer counts to now without duplicating its started trail', () => {
  const data = buckets('TODAY', [task({ timerMode: 'stopwatch', timerRunning: true, timerStartedAt: at('2025-10-19T11:40:00+03:00'),
    activityTrail: [event('started', '2025-10-19T11:40:00+03:00')] })]);
  assert.equal(worked(data, 11), 20);
  assert.equal(worked(data, 12), 0);
});

test('day clips running work from yesterday at local midnight', () => {
  const end = at('2025-10-19T00:20:00+03:00');
  const data = buckets('TODAY', [task({ timerMode: 'stopwatch', timerRunning: true, timerStartedAt: at('2025-10-18T23:40:00+03:00') })], [], end);
  assert.equal(worked(data, 0), 20);
  assert.equal(worked(data, 23), 0);
});

test('running countdown stops at zero rather than guessing pending overtime', () => {
  const data = buckets('TODAY', [task({ timerMode: 'countdown', countdownDurationSeconds: 600, countdownRemainingSeconds: 600,
    timerRunning: true, timerStartedAt: at('2025-10-19T09:50:00+03:00'), activityTrail: [event('started', '2025-10-19T09:50:00+03:00')] })]);
  assert.equal(worked(data, 9), 10);
  assert.equal(worked(data, 10), 0);
});

test('unpaired attempt uses its recorded duration and paired attempt is counted once', () => {
  const data = buckets('TODAY', [
    task({ id: 'unpaired', activityTrail: [event('attempt', '2025-10-19T10:10:00+03:00', { attemptSeconds: 1200 })] }),
    task({ id: 'paired', activityTrail: [event('started', '2025-10-19T10:40:00+03:00'), event('paused', '2025-10-19T10:55:00+03:00'),
      event('attempt', '2025-10-19T10:56:00+03:00', { attemptSeconds: 900 })] }),
  ]);
  assert.equal(worked(data, 9), 10);
  assert.equal(worked(data, 10), 25);
});

test('limited attempt with a known start preserves its true cap crossing', () => {
  const data = buckets('TODAY', [task({ activityTrail: [event('started', '2025-10-19T09:50:00+03:00'),
    event('attempt', '2025-10-19T11:00:00+03:00', { attemptSeconds: 1200, attemptOutcome: 'cap_reached' })] })]);
  assert.equal(worked(data, 9), 10);
  assert.equal(worked(data, 10), 10);
});

test('confirmed overtime is dated and a late expiry pause cannot add uncredited work', () => {
  const start = at('2025-10-19T09:40:00+03:00');
  const expired = at('2025-10-19T10:00:00+03:00');
  const pause = at('2025-10-19T10:30:00+03:00');
  const original = task({ timerMode: 'countdown', countdownDurationSeconds: 1200, countdownRemainingSeconds: 0,
    countdownExpiredAt: expired, timeSpentSeconds: 1200,
    activityTrail: [event('started', '2025-10-19T09:40:00+03:00'), event('paused', '2025-10-19T10:30:00+03:00')] });
  const finished = finishAfterExpiry(original, pause, at('2025-10-19T10:20:00+03:00'), () => 'finish');
  const data = buckets('TODAY', [finished]);
  assert.equal(worked(data, 9), (expired - start) / 60000);
  assert.equal(worked(data, 10), 20);
  const continued = continueAfterExpiry(original, pause, 30, () => 'continue');
  const continuingData = buckets('TODAY', [continued], [], at('2025-10-19T10:40:00+03:00'));
  assert.equal(worked(continuingData, 9), 20);
  assert.equal(worked(continuingData, 10), 40);
});

test('legacy time adjustments and unresolved expiry never invent hourly work', () => {
  const data = buckets('TODAY', [
    task({ id: 'legacy', timeSpentSeconds: 3600, activityTrail: [event('time_adjusted', '2025-10-19T09:00:00+03:00')] }),
    task({ id: 'pending', countdownExpiredAt: at('2025-10-19T10:00:00+03:00'), timeSpentSeconds: 1200,
      activityTrail: [event('started', '2025-10-19T09:40:00+03:00'), event('paused', '2025-10-19T10:30:00+03:00')] }),
  ]);
  assert.equal(worked(data, 9), 20);
  assert.equal(worked(data, 10), 0);
  assert.equal(worked(data, 11), 0);
});

test('archive semantics use completion/deletion dates and current tasks remain authoritative', () => {
  const tasks = [task({ id: 'live', done: true, completedAt: now })];
  const archive: DeletedTask[] = [
    { ...task({ id: 'live', done: true, completedAt: now }), deletedAt: now },
    { ...task({ id: 'completed', done: true, completedAt: at('2025-10-18T12:00:00+03:00') }), deletedAt: now },
    { ...task({ id: 'cancelled' }), deletedAt: now, deletionReason: 'cancelled' },
    { ...task({ id: 'unknown' }), deletedAt: now },
    { ...task({ id: 'accidental', done: true, completedAt: now }), deletedAt: now, deletionReason: 'accidental' },
    { ...task({ id: 'pending', done: true, completedAt: now, scheduledPending: true }), deletedAt: now },
  ];
  const data = buckets('LAST_7_DAYS', tasks, archive);
  assert.equal(data[5].delivered, 1);
  assert.equal(data[6].delivered, 1);
  assert.equal(data[6].dropped, 1);
});

test('all 90 and 365 calendar days fit once, including the oldest partial month', () => {
  for (const [period, days] of [['LAST_90_DAYS', 90], ['LAST_365_DAYS', 365]] as const) {
    const tasks = Array.from({ length: days + 1 }, (_, index) => task({ id: String(index), done: true,
      completedAt: now - index * 86400000 }));
    const data = buckets(period, tasks);
    assert.equal(data.reduce((total, item) => total + item.delivered, 0), days);
    assert.equal(data[0].delivered, period === 'LAST_90_DAYS' ? 7 : 42);
  }
});

test('hourly work, including archived sessions, is absent without events or a running timer', () => {
  const archived: DeletedTask = { ...task({ id: 'archived', done: true, completedAt: now,
    activityTrail: [event('started', '2025-10-19T09:00:00+03:00'), event('completed', '2025-10-19T09:35:00+03:00')] }), deletedAt: now };
  const data = buckets('TODAY', [task({ timeSpentSeconds: 10000, startedAt: now - 10000 })], [archived]);
  assert.equal(worked(data, 9), 35);
  assert.equal(worked(data, 10), 0);
  assert.equal(data[12].delivered, 1);
});

test('explicit overtime survives cloud serialization and renderer/native workspace validation', () => {
  const expired = at('2025-10-19T10:00:00+03:00');
  const original = task({ timerMode: 'countdown', countdownDurationSeconds: 1200, countdownRemainingSeconds: 0,
    countdownExpiredAt: expired, timeSpentSeconds: 1200 });
  for (const credited of [finishAfterExpiry(original, now, expired + 20 * 60000, () => 'finish'),
    continueAfterExpiry(original, at('2025-10-19T10:20:00+03:00'), 30, () => 'continue')]) {
    const serialized = serializeTaskForCloud(credited, now);
    const input = { tasks: [serialized], deletedTasks: [], tabs: [{ id: 'focus', name: 'Focus' }],
      settings: { lang: 'uk', aiIconVariant: 'quantum', soundEnabled: true, fireEnabled: false } };
    for (const parse of [parseWorkspace, parseSharedWorkspace]) {
      const restored = parse(JSON.parse(JSON.stringify(input))) as { tasks: PSTask[] };
      const adjusted = restored.tasks[0].activityTrail?.find(item => item.kind === 'time_adjusted');
      assert.equal(adjusted?.workedFrom, expired);
      assert.equal(adjusted?.workedUntil, expired + 20 * 60000);
      // Stop at the decision instant so the continued timer adds no extra work.
      const data = buckets('TODAY', restored.tasks, [], at('2025-10-19T10:20:00+03:00'));
      if (credited.timerRunning) assert.equal(worked(data, 10), 20);
      else assert.equal(worked(buckets('TODAY', restored.tasks), 10), 20);
    }
  }
});

test('renderer and native validators reject malformed explicit overtime intervals', () => {
  const valid = event('time_adjusted', '2025-10-19T12:00:00+03:00', {
    workedFrom: at('2025-10-19T10:00:00+03:00'), workedUntil: at('2025-10-19T10:20:00+03:00'),
  });
  assert.equal(isTaskActivityEvent(valid), true);
  for (const patch of [{ workedFrom: undefined }, { workedUntil: undefined }, { workedFrom: NaN },
    { workedUntil: valid.workedFrom! - 1 }, { workedUntil: now + 1 }, { workedFrom: now - 4 * 3600000, workedUntil: now },
    { kind: 'paused' }]) {
    const invalid = { ...valid, ...patch };
    assert.equal(isTaskActivityEvent(invalid), false);
    const input = { tasks: [{ ...task(), activityTrail: [invalid] }], deletedTasks: [], tabs: [{ id: 'focus', name: 'Focus' }],
      settings: { lang: 'uk', aiIconVariant: 'quantum', soundEnabled: true, fireEnabled: false } };
    for (const parse of [parseWorkspace, parseSharedWorkspace]) assert.throws(() => parse(input));
  }
});

test('acknowledging late expiry without overtime preserves the zero crossing', () => {
  const original = task({ timerMode: 'countdown', countdownDurationSeconds: 1200, countdownRemainingSeconds: 0,
    countdownExpiredAt: at('2025-10-19T10:00:00+03:00'), timeSpentSeconds: 1200,
    activityTrail: [event('started', '2025-10-19T09:40:00+03:00'), event('paused', '2025-10-19T10:30:00+03:00')] });
  const acknowledged = finishAfterExpiry(original, at('2025-10-19T10:30:00+03:00'), undefined, () => 'ack');
  for (const current of [acknowledged, { ...acknowledged, done: true, completedAt: at('2025-10-19T11:00:00+03:00') }]) {
    const data = buckets('TODAY', [current]);
    assert.equal(worked(data, 9), 20);
    assert.equal(worked(data, 10), 0);
  }
});

test('stale running timers on completed and archived tasks stop at completion or deletion', () => {
  const start = at('2025-10-19T09:40:00+03:00');
  const tasks = [task({ id: 'done-running', done: true, completedAt: at('2025-10-19T10:10:00+03:00'), timerMode: 'stopwatch', timerRunning: true, timerStartedAt: start })];
  const archive: DeletedTask[] = [{ ...task({ id: 'deleted-running', timerMode: 'stopwatch', timerRunning: true, timerStartedAt: start }),
    deletedAt: at('2025-10-19T10:20:00+03:00'), deletionReason: 'cancelled' }];
  const data = buckets('TODAY', tasks, archive);
  assert.equal(worked(data, 9), 40);
  assert.equal(worked(data, 10), 30);
  assert.equal(worked(data, 11), 0);
});

test('late countdown expiry and direct completion retain the actual stop time', () => {
  const start = at('2025-10-19T09:40:00+03:00');
  const late = at('2025-10-19T10:30:00+03:00');
  const running = configureTaskCountdown(task({ activityTrail: [event('started', '2025-10-19T09:40:00+03:00')] }), 1200, start, () => 'countdown');
  const expired = expireTaskCountdown(running, late);
  for (const current of [expired, completeTask(expired, late), completeTask(running, late)]) {
    const data = buckets('TODAY', [current]);
    assert.equal(worked(data, 9), 20);
    assert.equal(worked(data, 10), 0);
  }
});

test('continuing exactly at zero does not cap the newly started session', () => {
  const zero = at('2025-10-19T10:00:00+03:00');
  const original = task({ timerMode: 'countdown', countdownDurationSeconds: 1200, countdownRemainingSeconds: 0,
    countdownExpiredAt: zero, timeSpentSeconds: 1200,
    activityTrail: [event('started', '2025-10-19T09:40:00+03:00'), event('paused', '2025-10-19T10:00:00+03:00')] });
  const continued = continueAfterExpiry(original, zero, 30, () => 'immediate');
  const data = buckets('TODAY', [continued], [], at('2025-10-19T10:20:00+03:00'));
  assert.equal(worked(data, 9), 20);
  assert.equal(worked(data, 10), 20);
});

test('a stop and resumed start at the same zero crossing retain the later paused session', () => {
  const start = at('2025-10-19T09:40:00+03:00');
  const zero = at('2025-10-19T10:00:00+03:00');
  const end = at('2025-10-19T10:20:00+03:00');
  const original = task({ id: 'a' });
  const running = annotateTaskChanges([original], [configureTaskCountdown(original, 1200, start, () => 'first')], start)[0];
  const expired = expireTaskCountdown(running, zero);
  const continued = annotateTaskChanges([expired], [continueAfterExpiry(expired, zero, 30, () => 'resumed')], zero)[0];
  const paused = annotateTaskChanges([continued], [pauseTaskTimer(continued, end)], end)[0];
  const data = buckets('TODAY', [paused]);
  assert.equal(worked(data, 9), 20);
  assert.equal(worked(data, 10), 20);
  assert.equal(worked(data, 11), 0);
});
