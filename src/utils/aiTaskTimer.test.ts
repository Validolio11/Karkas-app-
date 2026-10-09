import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AITimerSettings, PSTask } from '../types';
import { applyAITimerSettings } from './aiTaskTimer';
import { applyAITaskUpdate } from './aiTaskUpdates';
import { createTask } from './taskOperations';

const base = (extra: Partial<PSTask> = {}): PSTask => ({ id: 't', title: 'References', phase: 'focus',
  priority: 2, steps: 0, currentStep: 0, done: false, pinned: false, createdAt: 0, timerMode: 'none', ...extra });

test('AI duration creates a paused countdown and explicit start works for a newly created task', () => {
  const task = createTask({ title: 'References', phase: 'focus', priority: 2, steps: 0,
    timerMode: 'countdown', countdownDurationSeconds: 1500 }, 't', 1000)!;
  assert.equal(task.timerRunning, false);
  const started = applyAITimerSettings(task, { timerAction: 'start' }, 2000);
  assert.equal(started.timerRunning, true);
  assert.equal(started.countdownRemainingSeconds, 1500);
  const edited = applyAITaskUpdate(base(), { id: 't', title: 'New title', countdownDurationSeconds: 600 }, new Set(['focus']), 1000);
  assert.equal(edited.title, 'New title');
  assert.equal(edited.timerMode, 'countdown');
  assert.equal(edited.timerRunning, false);
  assert.equal(edited.countdownRemainingSeconds, 600);
});

test('AI stop is repeatable, banks time once, preserves remainder and does not complete the task', () => {
  const running = base({ timerMode: 'countdown', countdownDurationSeconds: 600, countdownRemainingSeconds: 400,
    timerRunning: true, timerStartedAt: 1000, timeSpentSeconds: 30 });
  const stopped = applyAITimerSettings(running, { timerAction: 'stop' }, 11000);
  assert.equal(stopped.timeSpentSeconds, 40);
  assert.equal(stopped.countdownRemainingSeconds, 390);
  assert.equal(stopped.timerRunning, false);
  assert.equal(stopped.done, false);
  assert.deepEqual(applyAITimerSettings(stopped, { timerAction: 'stop' }, 21000), stopped);
  const resumed = applyAITimerSettings(stopped, { timerAction: 'start' }, 22000);
  assert.equal(resumed.countdownRemainingSeconds, 390);
  assert.equal(resumed.timeSpentSeconds, 40);
});

test('changing or removing a running timer banks its old session before switching mode', () => {
  const running = base({ timerMode: 'stopwatch', timerRunning: true, timerStartedAt: 1000, timeSpentSeconds: 30 });
  const countdown = applyAITimerSettings(running, { countdownDurationSeconds: 600 }, 11000);
  assert.equal(countdown.timeSpentSeconds, 40);
  assert.equal(countdown.timerRunning, false);
  assert.equal(countdown.countdownRemainingSeconds, 600);
  const removed = applyAITimerSettings({ ...countdown, timerRunning: true, timerStartedAt: 11000 }, { timerMode: 'none' }, 16000);
  assert.equal(removed.timeSpentSeconds, 45);
  assert.equal(removed.countdownDurationSeconds, undefined);
  assert.equal(removed.timerMode, 'none');
});

test('reapplying the same configuration preserves consumed countdown and active session', () => {
  const running = base({ timerMode: 'countdown', countdownDurationSeconds: 600, countdownRemainingSeconds: 390,
    timerRunning: true, timerStartedAt: 1000 });
  assert.equal(applyAITimerSettings(running, { timerMode: 'countdown', countdownDurationSeconds: 600 }, 5000), running);
  assert.equal(applyAITimerSettings(running, { countdownDurationSeconds: 600 }, 5000).plannedDurationSeconds, undefined,
    'the same legacy budget may already include extensions and cannot establish the initial plan');
  const changed = applyAITimerSettings(running, { countdownDurationSeconds: 900 }, 5000);
  assert.equal(changed.plannedDurationSeconds, 900);
  assert.equal(applyAITimerSettings(changed, { countdownDurationSeconds: 1200 }, 6000).plannedDurationSeconds, 900);
});

test('invalid AI timer fields leave work intact and completed tasks cannot be started', () => {
  const task = base({ timerMode: 'stopwatch', timeSpentSeconds: 33 });
  for (const invalid of [{ countdownDurationSeconds: 0 }, { countdownDurationSeconds: 86401 },
    { countdownDurationSeconds: 60.5 }, { timerMode: 'none', countdownDurationSeconds: 60 }, { timerAction: 'reset' }]) {
    assert.equal(applyAITimerSettings(task, invalid as AITimerSettings, 1000), task);
  }
  assert.equal(applyAITimerSettings({ ...task, done: true }, { timerAction: 'start' }, 1000).timerRunning, undefined);
  const noTimer = base();
  for (const timerAction of ['start', 'pause', 'stop'] as const) {
    assert.equal(applyAITimerSettings(noTimer, { timerAction }, 1000), noTimer);
  }
  const reopened = applyAITaskUpdate({ ...task, done: true }, { id: 't', done: false, timerAction: 'start' }, new Set(['focus']), 1000);
  assert.equal(reopened.done, false);
  assert.equal(reopened.timerRunning, true);
});
