import assert from 'node:assert/strict';
import test from 'node:test';
import type { PSTask } from '../types';
import { applyTaskWorkPlan, type WorkPlanEdit } from './taskWorkPlan';
import { pauseTaskTimer, startTaskTimer } from './taskTimer';
import { toggleTaskStep } from './taskOperations';

function task(): PSTask {
  return { id: 't', title: 'References', phase: 'work', priority: 2, done: false, pinned: false,
    createdAt: 1, steps: 2, currentStep: 0, timerMode: 'stopwatch', timerRunning: false, timeSpentSeconds: 10,
    plannedDurationSeconds: 600, stepList: [
      { id: 'collect', title: 'Collect', done: false, estimatedDurationSeconds: 300, timeSpentSeconds: 10 },
      { id: 'review', title: 'Review', done: false, estimatedDurationSeconds: 120 },
    ] };
}
function edit(source: PSTask): WorkPlanEdit {
  return { expected: { plannedDurationSeconds: source.plannedDurationSeconds,
    steps: source.stepList!.map(({ id, title, estimatedDurationSeconds }) => ({ id, title, estimatedDurationSeconds })) },
    plannedDurationSeconds: 900, steps: source.stepList!.map(({ id }) => ({ id, estimatedDurationSeconds: 400 })) };
}

test('plan editing preserves measurements, banks the current session once and keeps the timer running', () => {
  const original = startTaskTimer(task(), 1_000);
  const change = edit(original);
  const savedTask = structuredClone(original);
  const savedEdit = structuredClone(change);
  const result = applyTaskWorkPlan(original, change, 21_000)!;
  assert.equal(result.plannedDurationSeconds, 900);
  assert.equal(result.timeSpentSeconds, 30);
  assert.equal(result.stepList?.[0].timeSpentSeconds, 30);
  assert.equal(result.stepList?.[0].estimatedDurationSeconds, 400);
  assert.equal(result.timerRunning, true);
  assert.equal(result.timerStartedAt, 21_000);
  assert.equal(pauseTaskTimer(result, 26_000).stepList?.[0].timeSpentSeconds, 35);
  assert.deepEqual(original, savedTask);
  assert.deepEqual(change, savedEdit);
});

test('new timer evidence and completed stage progress while a form is open remain authoritative', () => {
  const opened = task();
  const change = edit(opened);
  const progressed = toggleTaskStep(startTaskTimer(opened, 1_000), 0, 11_000);
  const result = applyTaskWorkPlan(progressed, change, 16_000)!;
  assert.equal(result.currentStep, 1);
  assert.equal(result.stepList?.[0].done, true);
  assert.equal(result.stepList?.[0].timeSpentSeconds, 20);
  assert.equal(result.stepList?.[1].timeSpentSeconds, 5);
  assert.equal(result.timerStepId, 'review');
  assert.equal(result.timeSpentSeconds, 25);
});

test('stale cloud baseline, stage estimates, titles, identities and order reject the form without mutation', () => {
  const opened = task();
  const change = edit(opened);
  for (const newer of [
    { ...opened, plannedDurationSeconds: 700 },
    { ...opened, stepList: opened.stepList!.map((step, index) => index ? step : { ...step, estimatedDurationSeconds: 360 }) },
    { ...opened, stepList: opened.stepList!.map((step, index) => index ? step : { ...step, title: 'New scope' }) },
    { ...opened, stepList: opened.stepList!.map((step, index) => index ? step : { ...step, id: 'replacement' }) },
    { ...opened, stepList: [...opened.stepList!].reverse() },
    { ...opened, stepList: opened.stepList!.slice(0, 1) },
  ]) {
    const snapshot = structuredClone(newer);
    assert.equal(applyTaskWorkPlan(newer, change, 1_000), null);
    assert.deepEqual(newer, snapshot);
  }
});

test('done tasks, future templates and invalid or reordered proposed values cannot be edited', () => {
  const opened = task();
  const change = edit(opened);
  assert.equal(applyTaskWorkPlan({ ...opened, done: true }, change, 1_000), null);
  assert.equal(applyTaskWorkPlan({ ...opened, scheduledPending: true }, change, 1_000), null);
  for (const invalid of [0, -1, 1.5, 86401, NaN, Infinity, null, '60']) {
    assert.equal(applyTaskWorkPlan(opened, { ...change, plannedDurationSeconds: invalid } as WorkPlanEdit, 1_000), null);
    assert.equal(applyTaskWorkPlan(opened, { ...change, steps: [{ id: 'collect', estimatedDurationSeconds: invalid }, change.steps[1]] } as WorkPlanEdit, 1_000), null);
  }
  assert.equal(applyTaskWorkPlan(opened, { ...change, steps: [...change.steps].reverse() }, 1_000), null);
  for (const now of [-1, NaN, Infinity]) assert.equal(applyTaskWorkPlan(opened, change, now), null);
});

test('blank estimates remove plans while recorded evidence remains and paused work stays paused', () => {
  const original = task();
  const change = edit(original);
  change.plannedDurationSeconds = undefined;
  change.steps = change.steps.map(({ id }) => ({ id }));
  const result = applyTaskWorkPlan(original, change, 1_000)!;
  assert.equal('plannedDurationSeconds' in result, false);
  assert.equal(result.stepList?.[0].timeSpentSeconds, 10);
  assert.equal(result.stepList?.[0].estimatedDurationSeconds, undefined);
  assert.equal(result.timerRunning, false);
  for (const value of [1, 86400]) {
    const boundary = { ...change, plannedDurationSeconds: value, steps: change.steps.map(({ id }) => ({ id, estimatedDurationSeconds: value })) };
    assert.equal(applyTaskWorkPlan(original, boundary, 1_000)?.plannedDurationSeconds, value);
  }
});
