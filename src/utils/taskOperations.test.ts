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

