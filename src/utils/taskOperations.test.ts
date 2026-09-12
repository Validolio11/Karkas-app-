import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PSTask } from '../types';
import { sanitizeTasksTimerSafeguard } from './taskOperations';

const task = (overrides: Partial<PSTask> = {}): PSTask => ({
  id: 'task-1', title: 'Task', phase: 'focus', priority: 2, steps: 1,
  currentStep: 0, done: false, pinned: false, createdAt: 1, ...overrides,
});

test('stale running timers are capped and paused after desktop restart', () => {
  const now = 10_000_000;
  const [repaired] = sanitizeTasksTimerSafeguard([
    task({ timerRunning: true, timerStartedAt: now - 3 * 60 * 60 * 1000, timeSpentSeconds: 30 }),
  ], now);
  assert.equal(repaired.timerRunning, false);
  assert.equal(repaired.timerStartedAt, undefined);
  assert.equal(repaired.timeSpentSeconds, 7230);
  assert.equal(repaired.autoPausedOverdue, true);
});

test('expired countdown restored after restart banks only its remaining session once', () => {
  const original = task({ timerRunning: true, timerStartedAt: 1000, timeSpentSeconds: 900,
    countdownDurationSeconds: 3600, countdownRemainingSeconds: 1800 });
  const restored = JSON.parse(JSON.stringify(original));
  const [settled] = sanitizeTasksTimerSafeguard([restored], 10_000_000);
  assert.equal(settled.timeSpentSeconds, 2700);
  assert.equal(settled.countdownRemainingSeconds, 0);
  assert.equal(settled.timerRunning, false);
  assert.equal(settled.done, false);
  assert.equal(sanitizeTasksTimerSafeguard([settled], 20_000_000)[0], settled);
});

test('explicit long countdown is not cut short by the stopwatch two-hour safeguard', () => {
  const running = task({ timerRunning: true, timerStartedAt: 1000,
    countdownDurationSeconds: 14400, countdownRemainingSeconds: 14400 });
  assert.equal(sanitizeTasksTimerSafeguard([running], 3 * 3600 * 1000)[0], running);
});
