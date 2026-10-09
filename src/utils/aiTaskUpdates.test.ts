import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AITaskUpdate, PSTask } from '../types';
import { applyAITaskUpdate } from './aiTaskUpdates';
import { getTaskTotalSeconds, pauseTaskTimer } from './taskTimer';

const tabs = new Set(['focus', 'work']);
const task = (overrides: Partial<PSTask> = {}): PSTask => ({
  id: 'task-1', title: 'Task', phase: 'focus', priority: 2, steps: 2,
  currentStep: 1, done: false, pinned: false, createdAt: 1,
  stepList: [{ id: 'a', title: 'Research', done: true }, { id: 'b', title: 'Build', done: false }],
  ...overrides,
});

test('AI completion preserves countdown remainder and caps credited time at expiry', () => {
  const running = task({ timerRunning: true, timerStartedAt: 1000, timeSpentSeconds: 50,
    countdownDurationSeconds: 3600, countdownRemainingSeconds: 30 });
  const result = applyAITaskUpdate(running, { id: running.id, done: true }, tabs, 61000);
  assert.equal(result.timeSpentSeconds, 80);
  assert.equal(result.countdownRemainingSeconds, 0);
  assert.equal(result.timerRunning, false);
});

test('adding a subtask preserves existing identities and completed progress', () => {
  const original = task();
  const result = applyAITaskUpdate(original, { id: original.id, stepList: [
    { title: 'Research' }, { id: 'b', title: 'Build renamed' }, { title: 'Test' },
  ] } as AITaskUpdate, tabs, 1000);
  assert.deepEqual(result.stepList?.slice(0, 2), [original.stepList![0], { id: 'b', title: 'Build renamed', done: false }]);
  assert.equal(result.steps, 3);
  assert.equal(result.currentStep, 1);
  assert.equal(original.steps, 2);
  assert.equal(new Set(result.stepList?.map((s) => s.id)).size, 3);
});

test('deleting the remaining incomplete subtask does not implicitly complete or stop the parent', () => {
  const original = task({ timerRunning: true, timerStartedAt: 1000, timeSpentSeconds: 5 });
  const result = applyAITaskUpdate(original, {
    id: 'task-1', stepList: [{ id: 'a', title: 'Research' }],
  } as AITaskUpdate, tabs, 11000);
  assert.equal(result.done, false);
  assert.equal(result.currentStep, 1);
  assert.equal(result.completedAt, undefined);
  assert.equal(result.timerRunning, true);
  assert.equal(getTaskTotalSeconds(result, 11000), getTaskTotalSeconds(original, 11000));
  assert.equal(getTaskTotalSeconds(result, 16000), 20, 'time continues after the checklist edit');
  assert.equal(pauseTaskTimer(result, 16000).timeSpentSeconds, 20, 'banked time is never counted twice');
  assert.equal(result.timerStepId, undefined, 'all remaining stages are done, so later work has no invented stage');
});

test('deleting all subtasks preserves explicit parent completion with a valid zero-step task', () => {
  const result = applyAITaskUpdate(task({ done: true, completedAt: 50 }), { id: 'task-1', stepList: [] }, tabs);
  assert.deepEqual(result.stepList, []);
  assert.equal(result.steps, 0);
  assert.equal(result.currentStep, 0);
  assert.equal(result.done, true);
  assert.equal(result.completedAt, 50);
});

test('explicit parent completion and reopening preserve actual checklist progress', () => {
  const completed = applyAITaskUpdate(task(), { id: 'task-1', done: true }, tabs, 100);
  assert.equal(completed.currentStep, 1);
  assert.deepEqual(completed.stepList?.map((step) => step.done), [true, false]);
  const reopened = applyAITaskUpdate(completed, { id: 'task-1', done: false }, tabs, 200);
  assert.equal(reopened.currentStep, 1);
  assert.deepEqual(reopened.stepList, completed.stepList);
  assert.equal(reopened.completedAt, undefined);
});

test('an additional subtask preserves completion until an explicit reopen without restarting the timer', () => {
  const completed = applyAITaskUpdate(task(), { id: 'task-1', done: true }, tabs, 100);
  const result = applyAITaskUpdate(completed, { id: 'task-1', stepList: [...completed.stepList!, { title: 'Ship' }] } as AITaskUpdate, tabs, 200);
  assert.equal(result.done, true);
  assert.equal(result.currentStep, 1);
  assert.equal(result.completedAt, 100);
  assert.equal(result.timerRunning, false);
});

test('invalid fields cannot alter unrelated task properties or corrupt a checklist', () => {
  const original = task();
  const result = applyAITaskUpdate(original, {
    id: 'task-1', title: ' ', priority: 99, phase: 'unknown', pinned: true,
    steps: -2, note: '', stepList: [{ title: null }],
  } as unknown as AITaskUpdate, tabs);
  assert.deepEqual(result, { ...original, note: '' });
  assert.equal(applyAITaskUpdate(original, { id: 'other', done: true }, tabs), original);
});

test('duplicate step IDs are repaired without changing another existing step identity', () => {
  const result = applyAITaskUpdate(task(), { id: 'task-1', stepList: [
    { id: 'a', title: 'Research' }, { id: 'a', title: 'Another' }, { id: 'b', title: 'Build' },
  ] } as AITaskUpdate, tabs, 100);
  assert.equal(new Set(result.stepList?.map((s) => s.id)).size, 3);
  assert.equal(result.stepList?.[2].id, 'b');
});

test('numeric steps update tasks without a checklist and clamp completed progress', () => {
  const result = applyAITaskUpdate(task({ stepList: undefined, steps: 4, currentStep: 3 }), { id: 'task-1', steps: 2 }, tabs, 100);
  assert.equal(result.steps, 2);
  assert.equal(result.currentStep, 2);
  assert.equal(result.done, false);
});

test('naming legacy numeric steps preserves ordered progress and generated identities', () => {
  const original = task({ stepList: undefined, steps: 3, currentStep: 2, timeSpentSeconds: 120 });
  const result = applyAITaskUpdate(original, { id: original.id, stepList: [
    { title: 'Collect inputs' }, { title: 'Prepare draft' }, { title: 'Review draft' }, { title: 'Publish' },
  ] }, tabs, 1000);
  assert.equal(result.currentStep, 2);
  assert.deepEqual(result.stepList?.map(step => step.done), [true, true, false, false]);
  assert.deepEqual(result.stepList?.slice(0, 3).map(step => step.id), ['s-task-1-0', 's-task-1-1', 's-task-1-2']);
  assert.equal(result.steps, 4);
  assert.equal(result.done, false);
  assert.equal(result.timeSpentSeconds, 120);
  assert.equal(original.stepList, undefined);
  const renamed = applyAITaskUpdate(result, { id: result.id, stepList: result.stepList!.map(step => ({
    id: step.id, title: `${step.title} updated`,
  })) }, tabs, 2000);
  assert.deepEqual(renamed.stepList?.map(step => step.id), result.stepList?.map(step => step.id));
  assert.deepEqual(renamed.stepList?.map(step => step.done), [true, true, false, false]);
});

test('legacy migration respects explicit checks and never reuses one row identity twice', () => {
  const original = task({ stepList: undefined, steps: 3, currentStep: 2 });
  const result = applyAITaskUpdate(original, { id: original.id, stepList: [
    { id: 's-task-1-1', title: 'Second stage first' },
    { title: 'Replacement', done: false }, { title: 'Final stage', done: true },
  ] }, tabs, 1000);
  assert.equal(new Set(result.stepList?.map(step => step.id)).size, 3);
  assert.equal(result.stepList![0].id, 's-task-1-1');
  assert.deepEqual(result.stepList?.map(step => step.done), [true, false, true]);
  assert.equal(result.done, false);
  const reordered = applyAITaskUpdate(original, { id: original.id, stepList: [
    { id: 's-task-1-1', title: 'Second stage first' }, { title: 'First stage' }, { title: 'Final stage' },
  ] }, tabs, 2000);
  assert.deepEqual(reordered.stepList?.map(step => step.id), ['s-task-1-1', 's-task-1-0', 's-task-1-2']);
  assert.deepEqual(reordered.stepList?.map(step => step.done), [true, true, false]);
  assert.equal(reordered.currentStep, 2);
});
