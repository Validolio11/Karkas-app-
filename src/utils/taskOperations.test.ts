import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PSTask } from '../types';
import { addTaskStep, deleteTaskStep, materializeStepList, sanitizeTasksTimerSafeguard, setTaskProgress,
  setTaskTimeSpent, toggleTaskDone, toggleTaskStep } from './taskOperations';

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

test('legacy progress is materialized and completion banks a countdown only once', () => {
  const running = task({ steps: 3, currentStep: 1, timerRunning: true, timerStartedAt: 1000,
    timeSpentSeconds: 20, countdownDurationSeconds: 60, countdownRemainingSeconds: 60 });
  assert.deepEqual(materializeStepList(running).map(step => step.done), [true, false, false]);
  const done = setTaskProgress(running, 99, 120_000);
  assert.equal(done.done, true);
  assert.equal(done.currentStep, 3);
  assert.equal(done.completedAt, 120_000);
  assert.equal(done.timerRunning, false);
  assert.equal(done.timeSpentSeconds, 80);
  assert.equal(done.countdownRemainingSeconds, 0);
  assert.equal(setTaskProgress(done, 3, 150_000).timeSpentSeconds, 80);
  const reopened = toggleTaskStep(done, 1, 160_000);
  assert.equal(reopened.done, false);
  assert.equal(reopened.completedAt, undefined);
  assert.equal(reopened.currentStep, 2);
});

test('adding and removing steps keep completion and archive dates consistent', () => {
  const done = toggleTaskDone(task({ steps: 2 }), 10_000);
  const added = addTaskStep(done, { id: 'new-step', title: ' Verify ', done: true }, 20_000);
  assert.equal(added.done, false);
  assert.equal(added.completedAt, undefined);
  assert.equal(added.currentStep, 2);
  assert.equal(added.stepList![2].title, 'Verify');
  const closed = deleteTaskStep(added, 2, 30_000);
  assert.equal(closed.done, true);
  assert.equal(closed.completedAt, 30_000);
  assert.equal(deleteTaskStep(closed, -1, 40_000), closed);
  assert.equal(addTaskStep(added, { id: 'new-step', title: 'Duplicate', done: false }, 40_000), added);
});

test('manual time editing preserves consumed countdown budget and rejects invalid totals', () => {
  const running = task({ timerRunning: true, timerStartedAt: 1000,
    countdownDurationSeconds: 60, countdownRemainingSeconds: 60 });
  const edited = setTaskTimeSpent(running, 300, 31_000);
  assert.equal(edited.countdownRemainingSeconds, 30);
  assert.equal(edited.timerStartedAt, 31_000);
  assert.equal(edited.timeSpentSeconds, 300);
  assert.equal(setTaskTimeSpent(edited, NaN, 40_000), edited);
  assert.equal(setTaskTimeSpent(edited, -10, 40_000).timeSpentSeconds, 0);
});

test('malformed or future running timestamps are safely paused rather than running forever', () => {
  for (const started of [undefined, NaN, Infinity, 200_000]) {
    const [repaired] = sanitizeTasksTimerSafeguard([task({ timerRunning: true, timerStartedAt: started, timeSpentSeconds: 20 })], 100_000);
    assert.equal(repaired.timerRunning, false);
    assert.equal(repaired.timeSpentSeconds, 20);
    assert.equal(repaired.autoPausedOverdue, true);
  }
});
