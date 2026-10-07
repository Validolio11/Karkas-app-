import assert from 'node:assert/strict';
import { test } from 'node:test';
import { taskMutationProperties, taskTimerProperties, taskActionInstructions, validateTaskMutations, validatedTimerFields } from './aiActions';
import { applyAITaskUpdate } from '../src/utils/aiTaskUpdates';
import type { PSTask } from '../src/types';

const parent: PSTask = {
  id: 'parent', title: 'Project', phase: 'focus', priority: 2,
  steps: 2, currentStep: 1, done: false, pinned: false, createdAt: 1,
  stepList: [{ id: 'a', title: 'Research', done: true }, { id: 'b', title: 'Draft', done: false }],
};

test('structured output exposes subtask replacement and entire-task deletion separately', () => {
  const fields = taskMutationProperties.taskUpdates.items.properties;
  assert.ok(fields.stepList.items.properties.id);
  assert.ok(fields.stepList.items.properties.done);
  assert.ok(taskMutationProperties.taskDeletions.items.properties.id);
});

test('timer contract exposes real configuration and explicit actions', () => {
  const fields = taskMutationProperties.taskUpdates.items.properties;
  assert.deepEqual(fields.timerMode.enum, ['none', 'stopwatch', 'countdown']);
  assert.deepEqual(taskTimerProperties.timerAction.enum, ['start', 'pause', 'stop']);
  assert.equal(fields.countdownDurationSeconds.minimum, 60);
  assert.equal(fields.countdownDurationSeconds.maximum, 86400);
  assert.doesNotMatch(taskActionInstructions, /cannot[^\n]*control timers/i);
});

test('new countdown configuration is retained paused and duration-only means countdown', () => {
  assert.deepEqual(validatedTimerFields({ timerMode: 'countdown', countdownDurationSeconds: 1500 }), { timerMode: 'countdown', countdownDurationSeconds: 1500 });
  assert.deepEqual(validatedTimerFields({ countdownDurationSeconds: 60 }), { timerMode: 'countdown', countdownDurationSeconds: 60 });
  assert.deepEqual(validatedTimerFields({ timerMode: 'stopwatch', timerAction: 'start' }), { timerMode: 'stopwatch', timerAction: 'start' });
});

test('existing countdown accepts start pause stop and completed task must reopen before start', () => {
  const task = { ...parent, timerMode: 'countdown', countdownDurationSeconds: 1500 };
  for (const timerAction of ['start', 'pause', 'stop']) {
    assert.equal(validateTaskMutations({ taskUpdates: [{ id: 'parent', timerAction }] }, [task]).taskUpdates[0].timerAction, timerAction);
  }
  assert.throws(() => validateTaskMutations({ taskUpdates: [{ id: 'parent', timerAction: 'start' }] }, [{ ...task, done: true }]));
  assert.equal(validateTaskMutations({ taskUpdates: [{ id: 'parent', done: false, timerAction: 'start' }] }, [{ ...task, done: true }]).taskUpdates[0].done, false);
  assert.deepEqual(validatedTimerFields({ timerAction: 'start' }, { countdownDurationSeconds: 1500 }), { timerAction: 'start' });
});

test('malformed timer proposals and direct accounting overrides are rejected', () => {
  for (const proposal of [
    { timerMode: 'invalid' }, { timerAction: 'resume' }, { timerMode: 'countdown' },
    { countdownDurationSeconds: '1500' }, { countdownDurationSeconds: 59 }, { countdownDurationSeconds: 86401 }, { countdownDurationSeconds: 60.5 },
    { timerMode: 'stopwatch', countdownDurationSeconds: 1500 }, { timerMode: 'none', timerAction: 'start' },
    { timerMode: 'stopwatch', timerAction: 'start', done: true },
    { timerRunning: true }, { timerStartedAt: 123 }, { timeSpentSeconds: 0 }, { countdownRemainingSeconds: 0 },
  ]) assert.throws(() => validatedTimerFields(proposal), JSON.stringify(proposal));
  assert.throws(() => validatedTimerFields({ timerAction: 'stop' }, { timerMode: 'none' }));
});

test('AI response adds then deletes a subtask without creating or deleting its parent', () => {
  const added = validateTaskMutations({ taskUpdates: [{ id: 'parent', stepList: [...parent.stepList!, { title: 'Review' }] }] }, [parent]);
  const updated = applyAITaskUpdate(parent, added.taskUpdates[0], new Set(['focus']), 100);
  assert.equal(updated.id, parent.id);
  assert.equal(updated.stepList?.length, 3);
  assert.equal(updated.currentStep, 1);
  assert.deepEqual(added.taskDeletions, []);
  const removed = validateTaskMutations({ taskUpdates: [{ id: 'parent', stepList: updated.stepList!.filter(s => s.id !== 'b') }] }, [updated]);
  const final = applyAITaskUpdate(updated, removed.taskUpdates[0], new Set(['focus']), 101);
  assert.deepEqual(final.stepList?.map(s => s.title), ['Research', 'Review']);
  assert.equal(final.stepList?.[0].done, true);
  assert.equal(final.steps, 2);
});

test('empty subtask list is retained, whole-task deletion is returned', () => {
  assert.deepEqual(validateTaskMutations({ taskUpdates: [{ id: 'parent', stepList: [] }] }, [parent]).taskUpdates[0].stepList, []);
  assert.deepEqual(validateTaskMutations({ taskDeletions: [{ id: 'parent' }] }, [parent]).taskDeletions, [{ id: 'parent' }]);
});

test('unknown, duplicate, conflicting targets and malformed subtasks are rejected', () => {
  for (const response of [
    { taskUpdates: [{ id: 'parent' }] },
    { taskUpdates: [{ id: 'parent', unsupportedSetting: 'value' }] },
    { taskUpdates: [{ id: 'missing' }] },
    { taskDeletions: [{ id: 'missing' }] },
    { taskUpdates: [{ id: 'parent' }, { id: 'parent' }] },
    { taskUpdates: [{ id: 'parent' }], taskDeletions: [{ id: 'parent' }] },
    { taskUpdates: [{ id: 'parent', stepList: [{ title: '' }] }] },
    { taskUpdates: [{ id: 'parent', stepList: [{ id: 'a', title: 'A' }, { id: 'a', title: 'B' }] }] },
  ]) assert.throws(() => validateTaskMutations(response, [parent]));
});
