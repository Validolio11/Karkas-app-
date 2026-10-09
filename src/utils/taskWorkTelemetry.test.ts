import assert from 'node:assert/strict';
import test from 'node:test';
import type { PSTask } from '../types';
import { activeTaskStepId, bankTaskStepSession } from './taskWorkTelemetry';
import { configureTaskCountdown, extendTaskCountdown, pauseTaskTimer, startTaskTimer } from './taskTimer';
import { completeTask, createTask, sanitizeTasksTimerSafeguard, setTaskSteps, setTaskTimeSpent, toggleTaskStep } from './taskOperations';

function task(overrides: Partial<PSTask> = {}): PSTask {
  return {
    id: 'research', title: 'Research', phase: 'work', priority: 2, done: false, pinned: false,
    createdAt: 1, steps: 2, currentStep: 0, timerMode: 'stopwatch', timerRunning: false, timeSpentSeconds: 0,
    stepList: [
      { id: 'collect', title: 'Collect references', done: false, estimatedDurationSeconds: 120 },
      { id: 'select', title: 'Select references', done: false, estimatedDurationSeconds: 60 },
    ],
    ...overrides,
  };
}

test('pause, repeated pause and resume bank each real session exactly once', () => {
  const original = task();
  const snapshot = structuredClone(original);
  const started = startTaskTimer(original, 10_000);
  assert.equal(started.timerStepId, 'collect');
  const paused = pauseTaskTimer(started, 25_900);
  assert.equal(paused.timeSpentSeconds, 15);
  assert.equal(paused.stepList?.[0].timeSpentSeconds, 15);
  assert.equal(paused.timerStepId, undefined);
  const twice = pauseTaskTimer(paused, 40_000);
  assert.equal(twice.timeSpentSeconds, 15);
  assert.equal(twice.stepList?.[0].timeSpentSeconds, 15);
  const resumed = startTaskTimer(twice, 50_000);
  const final = completeTask(resumed, 57_000);
  assert.equal(final.timeSpentSeconds, 22);
  assert.equal(final.stepList?.[0].timeSpentSeconds, 22);
  assert.equal(completeTask(final, 80_000).stepList?.[0].timeSpentSeconds, 22);
  assert.deepEqual(original, snapshot);
});

test('completing a checklist stage banks its session before routing future time to the next stage', () => {
  const started = startTaskTimer(task(), 1_000);
  const next = toggleTaskStep(started, 0, 31_000);
  assert.equal(next.timerRunning, true);
  assert.equal(next.timerStartedAt, 31_000);
  assert.equal(next.timerStepId, 'select');
  assert.equal(next.stepList?.[0].timeSpentSeconds, 30);
  const final = pauseTaskTimer(next, 41_000);
  assert.equal(final.timeSpentSeconds, 40);
  assert.equal(final.stepList?.[0].timeSpentSeconds, 30);
  assert.equal(final.stepList?.[1].timeSpentSeconds, 10);
});

test('editing a checklist from a stale copy preserves freshly banked work by stable stage identity', () => {
  const started = startTaskTimer(task(), 1_000);
  const replacement = started.stepList!.map(step => ({ ...step, estimatedDurationSeconds: 300, timeSpentSeconds: 999 }));
  const edited = setTaskSteps(started, replacement, 21_000);
  assert.equal(edited.timeSpentSeconds, 20);
  assert.equal(edited.stepList?.[0].timeSpentSeconds, 20);
  assert.equal(edited.stepList?.[1].timeSpentSeconds, undefined);
  assert.equal(edited.stepList?.[0].estimatedDurationSeconds, 300);
  assert.equal(pauseTaskTimer(edited, 26_000).stepList?.[0].timeSpentSeconds, 25);
});

test('deleting or adding stages never reassigns an old session to a different stage', () => {
  const started = startTaskTimer(task(), 1_000);
  const edited = setTaskSteps(started, [{ id: 'new', title: 'New', done: false, timeSpentSeconds: 999 }], 11_000);
  assert.equal(edited.timeSpentSeconds, 10);
  assert.equal(edited.stepList?.[0].timeSpentSeconds, undefined);
  assert.equal(edited.timerStepId, 'new');
  assert.equal(pauseTaskTimer(edited, 16_000).stepList?.[0].timeSpentSeconds, 5);
});

test('timer extensions and reconfiguration preserve the original estimate while banking work', () => {
  const created = createTask({ title: 'Focus', phase: 'work', priority: 2, steps: 2, stepList: task().stepList,
    timerMode: 'countdown', countdownDurationSeconds: 120 }, 'focus', 1_000)!;
  assert.equal(created.plannedDurationSeconds, 120);
  const started = startTaskTimer(created, 1_000);
  const extended = extendTaskCountdown(started, 60, 31_000);
  assert.equal(extended.plannedDurationSeconds, 120);
  assert.equal(extended.countdownDurationSeconds, 180);
  assert.equal(extended.countdownRemainingSeconds, 150);
  assert.equal(extended.stepList?.[0].timeSpentSeconds, 30);
  const reconfigured = configureTaskCountdown(extended, 300, 41_000);
  assert.equal(reconfigured.plannedDurationSeconds, 120);
  assert.equal(reconfigured.stepList?.[0].timeSpentSeconds, 40);
  assert.equal(reconfigured.countdownRemainingSeconds, 300);
  assert.equal(pauseTaskTimer(reconfigured, 46_000).stepList?.[0].timeSpentSeconds, 45);
  const legacy = extendTaskCountdown(task({ timerMode: 'countdown', countdownDurationSeconds: 120, countdownRemainingSeconds: 120 }), 60, 1_000);
  assert.equal(legacy.plannedDurationSeconds, undefined, 'an already extended historical budget is not invented as a plan');
});

test('expired countdown records only its budget and checklist edit cannot restart it', () => {
  const started = configureTaskCountdown(task(), 60, 1_000);
  const edited = toggleTaskStep(started, 0, 101_000);
  assert.equal(edited.timerRunning, false);
  assert.equal(edited.countdownRemainingSeconds, 0);
  assert.equal(edited.timeSpentSeconds, 60);
  assert.equal(edited.stepList?.[0].timeSpentSeconds, 60);
  assert.equal(edited.stepList?.[1].timeSpentSeconds, undefined);
});

test('manual total correction clears ambiguous stage history but keeps estimates and future attribution', () => {
  const started = startTaskTimer(task(), 1_000);
  const banked = pauseTaskTimer(started, 11_000);
  const resumed = startTaskTimer(banked, 20_000);
  const corrected = setTaskTimeSpent(resumed, 120, 25_000);
  assert.equal(corrected.timeSpentSeconds, 120);
  assert.equal(corrected.stepList?.[0].timeSpentSeconds, undefined);
  assert.equal(corrected.stepList?.[0].estimatedDurationSeconds, 120);
  assert.equal(corrected.timerStartedAt, 25_000);
  assert.equal(corrected.timerStepId, 'collect');
  const after = pauseTaskTimer(corrected, 30_000);
  assert.equal(after.timeSpentSeconds, 125);
  assert.equal(after.stepList?.[0].timeSpentSeconds, 5);
});

test('restart safeguard attributes the same capped duration to task and captured stage only once', () => {
  const started = startTaskTimer(task({ timeSpentSeconds: 20 }), 1_000);
  const recovered = sanitizeTasksTimerSafeguard([started], 10_001_000)[0];
  assert.equal(recovered.timeSpentSeconds, 7220);
  assert.equal(recovered.stepList?.[0].timeSpentSeconds, 7200);
  assert.equal(recovered.timerRunning, false);
  assert.equal(recovered.timerStepId, undefined);
  assert.deepEqual(sanitizeTasksTimerSafeguard([recovered], 20_001_000)[0], recovered);
});

test('legacy progress, missing stage and duplicate stage IDs do not invent attribution', () => {
  const numeric = task({ stepList: undefined, currentStep: 1 });
  assert.equal(startTaskTimer(numeric, 1_000).timerStepId, undefined);
  const legacy = task({ timerRunning: true, timerStartedAt: 1_000 });
  assert.equal(pauseTaskTimer(legacy, 11_000).stepList?.[0].timeSpentSeconds, undefined);
  const missing = task({ timerStepId: 'missing' });
  assert.equal(bankTaskStepSession(missing, 5), missing);
  const duplicate = task({ stepList: [{ id: 'same', title: 'A', done: false }, { id: 'same', title: 'B', done: false }], timerStepId: 'same' });
  assert.equal(activeTaskStepId(duplicate), undefined);
  assert.equal(bankTaskStepSession(duplicate, 5), duplicate);
});
