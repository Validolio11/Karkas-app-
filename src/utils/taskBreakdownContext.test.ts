import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PSTask } from '../types';
import { taskBreakdownContext } from './taskBreakdownContext';

const task: PSTask = { id: 'a', title: 'Work', phase: 'focus', priority: 2, steps: 0, currentStep: 0, done: false, pinned: false, createdAt: 1 };

test('generated steps become stale after manual task edits, progress or completion', () => {
  const baseline = taskBreakdownContext(task);
  for (const update of [{ title: 'Changed' }, { priority: 1 as const }, { note: 'Keep' }, { phase: 'home' }, { done: true }, { currentStep: 1 }, { stepList: [{ id: 's', title: 'Manual', done: false }] }]) {
    assert.notEqual(taskBreakdownContext({ ...task, ...update }), baseline);
  }
});

test('running timer accounting does not invalidate generated steps', () => {
  assert.equal(taskBreakdownContext({ ...task, timerRunning: true, timerStartedAt: 123, timeSpentSeconds: 10 }), taskBreakdownContext(task));
});
