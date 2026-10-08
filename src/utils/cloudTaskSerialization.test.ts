import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DeletedTask, PSTask } from '../types';
import { serializeTaskForCloud } from './cloudTaskSerialization';

const task: PSTask = {
  id: 't1', title: 'Focus', phase: 'work', priority: 2, steps: 1,
  currentStep: 0, done: false, pinned: false, createdAt: 10,
  timeSpentSeconds: 7200, timerRunning: false,
  countdownDurationSeconds: 3600, countdownRemainingSeconds: 900,
};

test('cloud serialization retains countdown and accumulated time', () => {
  const value = serializeTaskForCloud(task);
  assert.equal(value.countdownDurationSeconds, 3600);
  assert.equal(value.countdownRemainingSeconds, 900);
  assert.equal(value.timeSpentSeconds, 7200);
});

test('deleted task retains countdown state and deletion timestamp', () => {
  const value = serializeTaskForCloud({ ...task, deletedAt: 50 } as DeletedTask);
  assert.equal(value.deletedAt, 50);
  assert.equal(value.countdownRemainingSeconds, 900);
});

test('archive intent survives cloud serialization without omitting recoverable accidental tasks', () => {
  for (const deletionReason of ['accidental', 'cancelled'] as const) {
    for (const done of [false, true]) {
      const archived: DeletedTask = { ...task, done, deletedAt: 50, deletionReason };
      const saved = structuredClone(archived);
      const value = serializeTaskForCloud(archived);
      assert.equal(value.deletionReason, deletionReason);
      assert.equal(value.done, done);
      assert.equal(value.deletedAt, 50);
      assert.equal(value.timeSpentSeconds, task.timeSpentSeconds);
      assert.deepEqual(archived, saved);
    }
  }
});

test('legacy unknown archive intent remains absent and invalid reasons are not sent', () => {
  const unknown: DeletedTask = { ...task, deletedAt: 50 };
  assert.equal('deletionReason' in serializeTaskForCloud(unknown), false);
  for (const deletionReason of [undefined, null, 'completed', 'dropped', '']) {
    const invalid = { ...unknown, deletionReason } as unknown as DeletedTask;
    assert.equal('deletionReason' in serializeTaskForCloud(invalid), false);
  }
});

test('current tasks do not retain stray archive classification in their cloud payload', () => {
  const restored = { ...task, deletionReason: 'accidental' };
  const value = serializeTaskForCloud(restored);
  assert.equal('deletedAt' in value, false);
  assert.equal('deletionReason' in value, false);
});

test('active timers including timestamp zero survive cloud serialization', () => {
  const value = serializeTaskForCloud({ ...task, timerRunning: true, timerStartedAt: 0 });
  assert.equal(value.timerRunning, true);
  assert.equal(value.timerStartedAt, 0);
  assert.equal(value.countdownRemainingSeconds, 900);
});

test('non-finite timer values are omitted from the cloud payload', () => {
  const value = serializeTaskForCloud({ ...task, timeSpentSeconds: NaN, timerStartedAt: Infinity,
    countdownDurationSeconds: Infinity, countdownRemainingSeconds: NaN });
  for (const key of ['timeSpentSeconds', 'timerStartedAt', 'countdownDurationSeconds', 'countdownRemainingSeconds']) {
    assert.equal(key in value, false);
  }
});

test('timer choice, first work timestamp and zero-subtask tasks survive cloud serialization', () => {
  for (const timerMode of ['none', 'stopwatch', 'countdown'] as const) {
    const value = serializeTaskForCloud({ ...task, steps: 0, currentStep: 0, timerMode, startedAt: 0 });
    assert.equal(value.timerMode, timerMode);
    assert.equal(value.startedAt, 0);
    assert.equal(value.steps, 0);
  }
  assert.equal('timerMode' in serializeTaskForCloud(task), false);
});
