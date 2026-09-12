import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PSTask } from '../types';
import {
  clearTaskCountdown, configureTaskCountdown, getTaskRemainingSeconds,
  getTaskSessionSeconds, getTaskTotalSeconds, pauseTaskTimer, startTaskTimer,
} from './taskTimer';

const task = (overrides: Partial<PSTask> = {}): PSTask => ({
  id: 'task-1', title: 'Task', phase: 'focus', priority: 2, steps: 1,
  currentStep: 0, done: false, pinned: false, createdAt: 1, ...overrides,
});

test('one-hour countdown starts immediately and preserves accumulated time', () => {
  const original = task({ timeSpentSeconds: 300 });
  const running = configureTaskCountdown(original, 3600, 1000);
  assert.equal(running.timerRunning, true);
  assert.equal(getTaskRemainingSeconds(running, 61_000), 3540);
  assert.equal(getTaskTotalSeconds(running, 61_000), 360);
  assert.equal(original.countdownDurationSeconds, undefined);
});

test('pause and resume keep both remaining countdown and total across idle time', () => {
  const running = configureTaskCountdown(task(), 3600, 1000);
  const paused = pauseTaskTimer(running, 61_000);
  assert.equal(paused.timeSpentSeconds, 60);
  assert.equal(getTaskRemainingSeconds(paused, 600_000), 3540);
  const resumed = startTaskTimer(paused, 600_000);
  assert.equal(getTaskRemainingSeconds(resumed, 630_000), 3510);
  assert.equal(getTaskTotalSeconds(resumed, 630_000), 90);
});

test('expiry caps delayed callbacks and repeated pauses bank the interval only once', () => {
  const running = configureTaskCountdown(task({ timeSpentSeconds: 10 }), 60, 0);
  assert.equal(getTaskSessionSeconds(running, 500_000), 60);
  assert.equal(getTaskRemainingSeconds(running, 500_000), 0);
  const expired = pauseTaskTimer(running, 500_000);
  assert.equal(expired.timeSpentSeconds, 70);
  assert.deepEqual(pauseTaskTimer(expired, 900_000), expired);
});

test('task completion before or after expiry accounts only for actual allowed session', () => {
  const running = configureTaskCountdown(task({ timeSpentSeconds: 20 }), 60, 1000);
  assert.equal(pauseTaskTimer(running, 31_000).timeSpentSeconds, 50);
  assert.equal(pauseTaskTimer(running, 120_000).timeSpentSeconds, 80);
});

test('restarting an expired countdown preserves prior totals and banks unprocessed expiry', () => {
  const running = configureTaskCountdown(task({ timeSpentSeconds: 20 }), 60, 1000);
  for (const expired of [running, pauseTaskTimer(running, 61_000)]) {
    const restarted = startTaskTimer(expired, 120_000);
    assert.equal(restarted.timeSpentSeconds, 80);
    assert.equal(getTaskRemainingSeconds(restarted, 120_000), 60);
    assert.equal(getTaskTotalSeconds(restarted, 150_000), 110);
  }
});

test('changing and clearing countdown preserve work from the current session', () => {
  const running = configureTaskCountdown(task({ timeSpentSeconds: 10 }), 60, 1000);
  const changed = configureTaskCountdown(running, 120, 31_000);
  assert.equal(changed.timeSpentSeconds, 40);
  assert.equal(getTaskRemainingSeconds(changed, 31_000), 120);
  const cleared = clearTaskCountdown(changed, 61_000);
  assert.equal(cleared.timeSpentSeconds, 70);
  assert.equal(cleared.timerRunning, false);
  assert.equal('countdownDurationSeconds' in cleared, false);
  assert.equal('countdownRemainingSeconds' in cleared, false);
  assert.equal(getTaskRemainingSeconds(cleared), undefined);
  assert.equal(changed.countdownDurationSeconds, 120);
});

test('stopwatch and duplicate starts retain elapsed time, including timestamp zero', () => {
  const running = startTaskTimer(task({ timeSpentSeconds: 5 }), 0);
  assert.equal(getTaskTotalSeconds(running, 10_000), 15);
  assert.equal(startTaskTimer(running, 10_000), running);
  assert.equal(getTaskSessionSeconds(running, -1000), 0);
  assert.equal(getTaskRemainingSeconds(running, 10_000), undefined);
});

test('invalid countdown durations are rejected without mutating the task', () => {
  const original = task();
  for (const duration of [0, -1, NaN, Infinity, 0.5]) {
    assert.throws(() => configureTaskCountdown(original, duration), RangeError);
  }
  assert.equal(original.timerRunning, undefined);
});
