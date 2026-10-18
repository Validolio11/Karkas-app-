import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PSTask, TaskActivityEvent } from '../types';
import { serializeTaskForCloud } from './cloudTaskSerialization';
import {
  finishLimitedStart, latestAttempt, LIMITED_START_CAPS, LIMITED_START_DEFAULT, LIMITED_START_MIN_CREDIT,
  needsLimitedStartFinish, startLimitedStart, summarizeAttempts,
} from './limitedStart';
import { annotateTaskChanges, isTaskActivityEvent, mergeTaskActivityTrail, TASK_ACTIVITY_LIMIT } from './taskActivity';
import { getTaskTotalSeconds, pauseTaskTimer } from './taskTimer';

const task = (overrides: Partial<PSTask> = {}): PSTask => ({
  id: 'task-1', title: 'Task', phase: 'focus', priority: 2, steps: 1,
  currentStep: 0, done: false, pinned: false, createdAt: 1, ...overrides,
});
const attempt = (overrides: Partial<TaskActivityEvent> = {}): TaskActivityEvent => ({
  id: 'attempt:one', at: 1_000_000, kind: 'attempt', attemptSeconds: 300, attemptCapSeconds: 900,
  attemptOutcome: 'stopped', ...overrides,
});

test('limited starts restore none, stopwatch, countdown and legacy timer fields exactly', () => {
  assert.deepEqual(LIMITED_START_CAPS, [300, 900, 1500]);
  assert.equal(LIMITED_START_DEFAULT, 900);
  assert.equal(LIMITED_START_MIN_CREDIT, 60);
  for (const timer of [
    {}, { timerMode: 'none' as const }, { timerMode: 'stopwatch' as const },
    { timerMode: 'countdown' as const, countdownDurationSeconds: 1200, countdownRemainingSeconds: 650 },
    { countdownDurationSeconds: 1200 },
  ]) {
    const original = task({ ...timer, timeSpentSeconds: 20, plannedDurationSeconds: 1800 });
    const running = startLimitedStart(original, 900, 1000);
    assert.equal(running.timerMode, 'countdown');
    assert.equal(running.timerRunning, true);
    assert.equal(running.countdownRemainingSeconds, 900);
    assert.equal(running.limitedStart?.baseSeconds, 20);
    assert.equal(running.plannedDurationSeconds, 1800);
    const restored = finishLimitedStart(running, 301_000);
    for (const key of ['timerMode', 'countdownDurationSeconds', 'countdownRemainingSeconds'] as const) {
      assert.equal(restored[key], original[key]);
      assert.equal(key in restored, key in original);
    }
    assert.equal(restored.plannedDurationSeconds, 1800);
    assert.equal(restored.timerRunning, false);
    assert.equal(restored.timeSpentSeconds, 320);
    assert.equal('limitedStart' in restored, false);
  }
  const noEstimate = startLimitedStart(task(), 900, 1000);
  assert.equal('plannedDurationSeconds' in noEstimate, false);
});

test('running work is banked first and limited time retains step telemetry', () => {
  const original = task({ timerMode: 'countdown', countdownDurationSeconds: 1200, countdownRemainingSeconds: 900,
    timerRunning: true, timerStartedAt: 1000, timerSessionId: 'previous', timerStepId: 'step', startedAt: 1000,
    timeSpentSeconds: 10, stepList: [{ id: 'step', title: 'First', done: false }] });
  const running = startLimitedStart(original, 900, 61_000);
  assert.equal(running.timeSpentSeconds, 70);
  assert.equal(running.limitedStart?.baseSeconds, 70);
  assert.equal(running.limitedStart?.restore.countdownRemainingSeconds, 840);
  assert.equal(running.startedAt, 1000);
  assert.equal(running.timerStepId, 'step');
  assert.notEqual(running.timerSessionId, 'previous');
  const restored = finishLimitedStart(running, 361_000);
  assert.equal(restored.countdownRemainingSeconds, 840);
  assert.equal(restored.stepList?.[0].timeSpentSeconds, 360);
  assert.equal(restored.timeSessions?.previous.seconds, 60);
  assert.equal(restored.timeSpentSeconds, 370);
  const stopwatch = startLimitedStart(task({ timerRunning: true, timerStartedAt: 1000 }), 900, 61_000);
  assert.equal(stopwatch.limitedStart?.baseSeconds, 60);
});

test('stopping below one minute banks time without an attempt event', () => {
  const running = startLimitedStart(task(), 900, 1000);
  const stopped = finishLimitedStart(running, 31_000);
  assert.equal(stopped.timeSpentSeconds, 30);
  assert.equal(latestAttempt(stopped), undefined);
  assert.equal(stopped.updatedAt, 31_000);
});

test('five minutes of a longer session credits one stopped attempt and finish is idempotent', () => {
  const running = startLimitedStart(task(), 900, 1000);
  const stopped = finishLimitedStart(running, 301_000);
  const event = latestAttempt(stopped)!;
  assert.equal(event.id, 'attempt:' + running.limitedStart!.id);
  assert.equal(event.attemptSeconds, 300);
  assert.equal(event.attemptCapSeconds, 900);
  assert.equal(event.attemptOutcome, 'stopped');
  assert.equal(finishLimitedStart(stopped, 401_000), stopped);
  assert.equal(mergeTaskActivityTrail(stopped.activityTrail, stopped.activityTrail).length, 1);
});

test('delayed cap handling credits and banks only the ceiling', () => {
  const running = startLimitedStart(task({ timeSpentSeconds: 40 }), 300, 1000);
  const stopped = finishLimitedStart(running, 9_001_000);
  assert.equal(getTaskTotalSeconds(stopped), 340);
  assert.equal(latestAttempt(stopped)?.attemptSeconds, 300);
  assert.equal(latestAttempt(stopped)?.attemptOutcome, 'cap_reached');
});

test('invalid starts and completed tasks are no-ops; any integer cap from one to sixty minutes is allowed', () => {
  const original = task();
  for (const cap of [0, 59, 3601, 900.5, NaN, Infinity]) assert.equal(startLimitedStart(original, cap, 1000), original);
  assert.equal(startLimitedStart(original, 77, 1000).limitedStart?.capSeconds, 77);
  const done = task({ done: true });
  assert.equal(startLimitedStart(done, 900, 1000), done);
  const running = startLimitedStart(original, 900, 1000);
  assert.equal(startLimitedStart(running, 300, 2000), running);
  assert.equal(finishLimitedStart(original, 1000), original);
});

test('finish normalization handles completion, external pause, changed mode and expiry', () => {
  const running = startLimitedStart(task(), 900, 1000);
  assert.equal(needsLimitedStartFinish(task(), 1000), false);
  assert.equal(needsLimitedStartFinish(running, 31_000), false);
  assert.equal(needsLimitedStartFinish({ ...running, done: true }, 31_000), true);
  assert.equal(needsLimitedStartFinish(pauseTaskTimer(running, 31_000), 31_000), true);
  assert.equal(needsLimitedStartFinish({ ...running, timerMode: 'stopwatch' }, 31_000), true);
  assert.equal(needsLimitedStartFinish(running, 901_000), true);
});

test('restoring a non-countdown drops stale remaining and undefined restore keys', () => {
  const running = startLimitedStart(task({ timerMode: 'none', countdownDurationSeconds: 300, countdownRemainingSeconds: 100 }), 900, 1000);
  const restored = finishLimitedStart(running, 31_000);
  assert.equal(restored.timerMode, 'none');
  assert.equal(restored.countdownDurationSeconds, 300);
  assert.equal('countdownRemainingSeconds' in restored, false);
  const legacy = startLimitedStart(task(), 900, 1000);
  legacy.limitedStart!.restore.timerMode = undefined;
  assert.equal('timerMode' in finishLimitedStart(legacy, 31_000), false);
});

test('activity records only the attempt at finish and keeps real completion or edits', () => {
  const original = task();
  const running = annotateTaskChanges([original], [startLimitedStart(original, 900, 1000)], 1000)[0];
  assert.deepEqual(running.activityTrail?.map(event => event.kind), ['started']);
  const finished = annotateTaskChanges([running], [finishLimitedStart(running, 301_000)], 301_000)[0];
  assert.deepEqual(finished.activityTrail?.map(event => event.kind), ['started', 'attempt']);
  const short = annotateTaskChanges([running], [finishLimitedStart(running, 31_000)], 31_000)[0];
  assert.deepEqual(short.activityTrail?.map(event => event.kind), ['started']);
  const safeguarded = annotateTaskChanges([running], [pauseTaskTimer(running, 301_000)], 301_000)[0];
  assert.deepEqual(safeguarded.activityTrail?.map(event => event.kind), ['started']);
  const completed = annotateTaskChanges([running], [{ ...finishLimitedStart(running, 301_000), done: true }], 301_000)[0];
  assert.deepEqual(completed.activityTrail?.map(event => event.kind).sort(), ['attempt', 'completed', 'started']);
  const edited = annotateTaskChanges([running], [{ ...finishLimitedStart(running, 301_000), title: 'Changed' }], 301_000)[0];
  assert.equal(edited.activityTrail?.filter(event => event.kind === 'edited').length, 1);
});

test('attempt summaries count initial attempts and include continued seconds in the seven-day window', () => {
  const now = 10 * 86400000;
  const initial = attempt({ at: now - 1000 });
  const continuation = attempt({ id: 'attempt:two', at: now, attemptSeconds: 60, attemptContinued: true });
  const old = attempt({ id: 'attempt:old', at: now - 8 * 86400000 });
  const future = attempt({ id: 'attempt:future', at: now + 1 });
  const live = task({ activityTrail: [continuation, old, initial, future] });
  assert.deepEqual(summarizeAttempts([live], now), { count: 1, seconds: 360 });
  assert.deepEqual(summarizeAttempts([{ ...live, scheduledPending: true }], now), { count: 0, seconds: 0 });
  assert.equal(latestAttempt(live)?.id, future.id);
});

test('attempt event validation rejects malformed optional fields', () => {
  assert.equal(isTaskActivityEvent(attempt({ attemptContinued: true })), true);
  for (const key of ['attemptSeconds', 'attemptCapSeconds']) {
    for (const value of [-1, 0.5, NaN, Infinity, 86401, '300', null]) {
      assert.equal(isTaskActivityEvent({ ...attempt(), [key]: value }), false);
    }
  }
  assert.equal(isTaskActivityEvent({ ...attempt(), attemptOutcome: 'failed' }), false);
  assert.equal(isTaskActivityEvent({ ...attempt(), attemptContinued: 1 }), false);
});

test('attempt trail stays bounded and cloud serialization preserves limited and attempt metadata', () => {
  const history = Array.from({ length: TASK_ACTIVITY_LIMIT }, (_, index) => attempt({ id: 'attempt:' + index, at: index }));
  const running = startLimitedStart(task({ activityTrail: history }), 900, 1000, { continued: true });
  const cloud = JSON.parse(JSON.stringify(serializeTaskForCloud(running))) as PSTask;
  assert.deepEqual(cloud.limitedStart, running.limitedStart);
  assert.equal(cloud.timerSessionId, running.timerSessionId);
  const finished = finishLimitedStart(cloud, 301_000);
  assert.equal(finished.activityTrail?.length, TASK_ACTIVITY_LIMIT);
  assert.equal(latestAttempt(finished)?.attemptContinued, true);
  const serialized = serializeTaskForCloud(finished);
  assert.deepEqual(serialized.activityTrail, finished.activityTrail);
});
