import assert from 'node:assert/strict';
import { test } from 'node:test';
import { taskMutationProperties, taskTimerProperties, taskActionInstructions, validateTaskMutations, validatedTimerFields, normalizeAIOptionalFields } from './aiActions';
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
  assert.deepEqual(taskMutationProperties.taskDeletions.items.properties.deletionReason.enum, ['accidental', 'cancelled']);
  assert.deepEqual(taskMutationProperties.taskDeletions.items.required, ['id']);
});

test('deletion reason stays optional, preserves explicit intent and rejects unknown enum values', () => {
  for (const deletionReason of ['accidental', 'cancelled']) {
    const deletion = { id: 'parent', reason: 'Explicit user request', deletionReason };
    assert.deepEqual(validateTaskMutations({ taskDeletions: [deletion] }, [parent]).taskDeletions, [deletion]);
  }
  const deletion = { id: 'parent', reason: null, deletionReason: null };
  assert.deepEqual(validateTaskMutations({ taskDeletions: [deletion] }, [parent]).taskDeletions, [{ id: 'parent' }]);
  assert.equal(deletion.deletionReason, null, 'normalization must not alter the original proposal');
  for (const deletionReason of ['unknown', 'cancelled ', '', 1, false, {}, []]) {
    assert.throws(() => validateTaskMutations({ taskDeletions: [{ id: 'parent', deletionReason }] }, [parent]), /Invalid deletion reason/);
  }
  assert.throws(() => validateTaskMutations({ taskDeletions: [{ id: 'parent', reason: 123 }] }, [parent]), /Invalid deletion note/);
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

test('unused null timer fields are absent without clearing a configured timer or starting it', () => {
  assert.deepEqual(validatedTimerFields({ timerMode: 'countdown', countdownDurationSeconds: 2400, timerAction: null }), { timerMode: 'countdown', countdownDurationSeconds: 2400 });
  assert.deepEqual(validatedTimerFields({ timerMode: null, countdownDurationSeconds: 2400, timerAction: null }), { timerMode: 'countdown', countdownDurationSeconds: 2400 });
  assert.deepEqual(validatedTimerFields({ timerMode: 'stopwatch', countdownDurationSeconds: null, timerAction: null }), { timerMode: 'stopwatch' });
  assert.throws(() => validatedTimerFields({ timerMode: 'countdown', countdownDurationSeconds: null }));
});

test('optional mutation nulls are omitted but explicit false zero empty text and empty steps survive', () => {
  const response = { taskUpdates: [{ id: 'parent', title: null, phase: null, priority: null, note: null, done: null, steps: null, stepList: null, countdownDurationSeconds: 2400, timerAction: null }], taskDeletions: null };
  assert.deepEqual(validateTaskMutations(response, [parent]), { taskUpdates: [{ id: 'parent', countdownDurationSeconds: 2400, timerMode: 'countdown' }], taskDeletions: [] });
  assert.deepEqual(validateTaskMutations({ taskUpdates: [{ id: 'parent', done: false, steps: 0, note: '', stepList: [] }] }, [parent]).taskUpdates[0], { id: 'parent', done: false, steps: 0, note: '', stepList: [] });
  assert.equal(response.taskUpdates[0].title, null, 'normalization must not mutate caller data');
});

test('optional null normalization never creates a missing target or removes forbidden accounting fields', () => {
  assert.deepEqual(normalizeAIOptionalFields({ tasks: null, tabs: null, taskUpdates: null, taskDeletions: null }), {});
  assert.throws(() => validateTaskMutations({ taskUpdates: [{ id: null, note: 'Keep' }] }, [parent]));
  assert.throws(() => validateTaskMutations({ taskUpdates: [{ id: 'parent', note: null, timerAction: null }] }, [parent]));
  assert.throws(() => validateTaskMutations({ taskUpdates: [{ id: 'parent', note: 'Keep', timerRunning: null }] }, [parent]));
  assert.throws(() => validateTaskMutations({ taskUpdates: [{ id: 'parent', title: 123 }] }, [parent]));
  assert.throws(() => validateTaskMutations({ taskUpdates: [{ id: 'parent', stepList: [{ title: 'Draft', done: 'false' }] }] }, [parent]));
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
