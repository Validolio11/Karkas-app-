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
