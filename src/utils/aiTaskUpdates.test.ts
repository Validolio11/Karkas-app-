import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AITaskUpdate, PSTask } from '../types';
import { applyAITaskUpdate } from './aiTaskUpdates';

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

test('deleting the remaining incomplete subtask completes and stops the timer', () => {
  const result = applyAITaskUpdate(task({ timerRunning: true, timerStartedAt: 1000, timeSpentSeconds: 5 }), {
    id: 'task-1', stepList: [{ id: 'a', title: 'Research' }],
  } as AITaskUpdate, tabs, 11000);
  assert.equal(result.done, true);
  assert.equal(result.currentStep, 1);
  assert.equal(result.completedAt, 11000);
  assert.equal(result.timerRunning, false);
  assert.equal(result.timerStartedAt, undefined);
  assert.equal(result.timeSpentSeconds, 15);
});

test('deleting all subtasks retains a valid unfinished parent', () => {
  const result = applyAITaskUpdate(task({ done: true, completedAt: 50 }), { id: 'task-1', stepList: [] }, tabs);
  assert.deepEqual(result.stepList, []);
  assert.equal(result.steps, 1);
  assert.equal(result.currentStep, 0);
  assert.equal(result.done, false);
  assert.equal(result.completedAt, undefined);
});

test('explicit parent completion and reopening synchronize the checklist', () => {
  const completed = applyAITaskUpdate(task(), { id: 'task-1', done: true }, tabs, 100);
  assert.equal(completed.currentStep, 2);
  assert.ok(completed.stepList?.every((step) => step.done));
  const reopened = applyAITaskUpdate(completed, { id: 'task-1', done: false }, tabs, 200);
  assert.equal(reopened.currentStep, 0);
  assert.ok(reopened.stepList?.every((step) => !step.done));
  assert.equal(reopened.completedAt, undefined);
});

test('an additional subtask reopens a completed task without restarting its timer', () => {
  const completed = applyAITaskUpdate(task(), { id: 'task-1', done: true }, tabs, 100);
  const result = applyAITaskUpdate(completed, { id: 'task-1', stepList: [...completed.stepList!, { title: 'Ship' }] } as AITaskUpdate, tabs, 200);
  assert.equal(result.done, false);
  assert.equal(result.currentStep, 2);
  assert.equal(result.completedAt, undefined);
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
  assert.equal(result.done, true);
});
