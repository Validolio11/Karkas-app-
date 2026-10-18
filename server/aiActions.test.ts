import assert from 'node:assert/strict';
import { test } from 'node:test';
import { taskMutationProperties, taskTimerProperties, taskActionInstructions, validateTaskMutations, validatedTimerFields, normalizeAIOptionalFields, taskScheduleProperties, validatedScheduleFields, schedulingClockContext, validatedDateFields, noteRestatesTitle, distinctTaskNote, withoutTitleEchoNotes } from './aiActions';
import { applyAITaskUpdate } from '../src/utils/aiTaskUpdates';
import type { PSTask } from '../src/types';

const parent: PSTask = {
  id: 'parent', title: 'Project', phase: 'focus', priority: 2,
  steps: 2, currentStep: 1, done: false, pinned: false, createdAt: 1,
  stepList: [{ id: 'a', title: 'Research', done: true }, { id: 'b', title: 'Draft', done: false }],
};

test('recorded work correction exposes a bounded total and leaves raw accounting private', () => {
  const field = taskMutationProperties.taskUpdates.items.properties.recordedWorkSeconds;
  assert.equal(field.minimum, 0);
  assert.equal(field.maximum, 6000059);
  for (const recordedWorkSeconds of [0, 10800, 6000059]) {
    const update = { id: parent.id, recordedWorkSeconds };
    assert.deepEqual(validateTaskMutations({ taskUpdates: [update] }, [parent]).taskUpdates, [update]);
  }
  assert.throws(() => validateTaskMutations({ taskUpdates: [{ id: parent.id, timeSpentSeconds: 10800 }] }, [parent]));
  assert.throws(() => validatedTimerFields({ recordedWorkSeconds: 10800 }), /existing task/);
});

test('recorded work rejects malformed totals, future templates and mixed timer changes', () => {
  for (const recordedWorkSeconds of [-1, 0.5, NaN, Infinity, '10800', 6000060]) {
    assert.throws(() => validateTaskMutations({ taskUpdates: [{ id: parent.id, recordedWorkSeconds }] }, [parent]), /recorded work/);
  }
  for (const conflict of [{ timerAction: 'start' }, { timerMode: 'stopwatch' }, { countdownDurationSeconds: 600 }, { schedule: {} }]) {
    assert.throws(() => validateTaskMutations({ taskUpdates: [{ id: parent.id, recordedWorkSeconds: 10800, ...conflict }] }, [parent]), /recorded work/);
  }
  assert.throws(() => validateTaskMutations({ taskUpdates: [{ id: parent.id, recordedWorkSeconds: 10800 }] }, [{ ...parent, scheduledPending: true }]), /recorded work/);
  assert.deepEqual(validateTaskMutations({ taskUpdates: [{ id: parent.id, recordedWorkSeconds: null, note: 'Keep' }] }, [parent]).taskUpdates, [{ id: parent.id, note: 'Keep' }]);
});

test('date-only updates validate against the unchanged counterpart and preserve explicit clears', () => {
  const dated = { ...parent, plannedDate: '2026-10-12', deadlineDate: '2026-10-15' };
  assert.throws(() => validateTaskMutations({ taskUpdates: [{ id: parent.id, plannedDate: '2026-10-16' }] }, [dated]), /after deadline/);
  assert.throws(() => validateTaskMutations({ taskUpdates: [{ id: parent.id, deadlineDate: '2026-10-11' }] }, [dated]), /after deadline/);
  const proposal = { taskUpdates: [{ id: parent.id, plannedDate: '2026-10-16', deadlineDate: null }] };
  const validated = validateTaskMutations(proposal, [dated]);
  const updated = applyAITaskUpdate(dated, validated.taskUpdates[0], new Set(['focus']), 100);
  assert.equal(updated.plannedDate, '2026-10-16');
  assert.equal(updated.deadlineDate, undefined);
  assert.equal(updated.currentStep, dated.currentStep);
  assert.equal(dated.deadlineDate, '2026-10-15');
});

test('AI calendar dates reject rollover, timestamps and reversed ranges without changing caller data', () => {
  for (const plannedDate of ['2026-02-30', '2026-13-01', '2026-10-12T10:00:00Z', '12.10.26', '']) {
    assert.throws(() => validatedDateFields({ plannedDate }), /calendar date/);
  }
  assert.deepEqual(validatedDateFields({ plannedDate: '2024-02-29', deadlineDate: null }), { plannedDate: '2024-02-29', deadlineDate: null });
  assert.throws(() => validatedDateFields({ plannedDate: '2026-10-16', deadlineDate: '2026-10-15' }), /after deadline/);
  const proposal = { taskUpdates: [{ id: parent.id, plannedDate: null, deadlineDate: null, note: null }] };
  assert.deepEqual(validateTaskMutations(proposal, [parent]).taskUpdates[0], { id: parent.id, plannedDate: null, deadlineDate: null });
  assert.equal(proposal.taskUpdates[0].note, null);
});

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

const dailySchedule = { startAt: '2026-10-10T20:00:00+03:00', recurrence: 'daily', timeZone: 'Europe/Kyiv', leadMinutes: 5 };
test('future and recurring schedule proposals survive new and existing task validation', () => {
  assert.deepEqual(taskScheduleProperties.schedule.required, ['startAt', 'recurrence', 'timeZone', 'leadMinutes']);
  assert.deepEqual(validatedScheduleFields({ schedule: dailySchedule }), { schedule: dailySchedule });
  assert.deepEqual(validateTaskMutations({ taskUpdates: [{ id: parent.id, schedule: dailySchedule }] }, [parent]).taskUpdates, [{ id: parent.id, schedule: dailySchedule }]);
  assert.deepEqual(normalizeAIOptionalFields({ tasks: [{ title: 'Typing', schedule: null }] }).tasks, [{ title: 'Typing' }]);
});
test('schedule validation rejects rollover dates, absent offset, invalid timezone and accounting forgery', () => {
  for (const startAt of ['2026-02-30T20:00:00Z', '2026-13-01T20:00:00Z', '2026-10-10T24:00:00Z', '2026-10-10T20:00:00', '2026-10-10T20:00:00+14:30']) {
    assert.throws(() => validatedScheduleFields({ schedule: { ...dailySchedule, startAt } }), /Invalid task schedule/);
  }
  for (const override of [{ timeZone: 'unknown/zone' }, { recurrence: 'hourly' }, { leadMinutes: -1 }, { leadMinutes: 1.5 }, { leadMinutes: 1441 }, { arbitrary: true }]) {
    assert.throws(() => validatedScheduleFields({ schedule: { ...dailySchedule, ...override } }), /Invalid task schedule/);
  }
  assert.throws(() => validatedScheduleFields({ schedule: dailySchedule, timerAction: 'start' }), /remain paused/);
  assert.throws(() => validatedScheduleFields({ scheduledPending: false }), /accounting field/);
});
test('clock context uses client timezone calendar day instead of host date', () => {
  const clock = schedulingClockContext({ now: '2026-10-09T22:30:00Z', timeZone: 'Europe/Kyiv' });
  assert.equal(clock.localDateTime, '2026-10-10 01:30:00');
  assert.equal(clock.timeZone, 'Europe/Kyiv');
  assert.throws(() => schedulingClockContext({ now: 'tomorrow', timeZone: 'Europe/Kyiv' }));
  assert.throws(() => schedulingClockContext({ now: '2026-10-09T22:30:00Z', timeZone: 'bad' }));
});

test('pending existing scheduled templates reject completion and start even without a new schedule field', () => {
  const plan = { ...parent, scheduledPending: true, timerMode: 'stopwatch' as const };
  for (const changes of [{ done: true }, { timerAction: 'start' }, { stepList: [{ title: 'Typing', done: true }] }]) {
    assert.throws(() => validateTaskMutations({ taskUpdates: [{ id: plan.id, ...changes }] }, [plan]), /cannot be started or completed/);
  }
  assert.deepEqual(validateTaskMutations({ taskUpdates: [{ id: plan.id, title: 'Practice typing', timerAction: 'pause' }] }, [plan]).taskUpdates,
    [{ id: plan.id, title: 'Practice typing', timerAction: 'pause' }]);
  assert.throws(() => validateTaskMutations({ taskUpdates: [{ id: parent.id, schedule: dailySchedule, done: true }] }, [parent]), /cannot be started or completed/);
});

test('a proposed note that only repeats the task title is dropped; a useful note stays', () => {
  const title = 'Змонтувати шоурил моушн-дизайну 2026';
  assert.equal(noteRestatesTitle(title, title), true);
  assert.equal(noteRestatesTitle('  змонтувати ШОУРИЛ моушн дизайну 2026.  ', title), true);
  assert.equal(noteRestatesTitle('Завдання: змонтувати шоурил моушн-дизайну 2026', title), true);
  assert.equal(noteRestatesTitle('шоурил моушн-дизайну', title), true);
  assert.equal(noteRestatesTitle('Взяти найкращі кадри з трьох останніх проєктів', title), false);
  assert.equal(noteRestatesTitle('Змонтувати шоурил моушн-дизайну 2026 під музику з бібліотеки Artlist', title), false);
  assert.equal(noteRestatesTitle('', title), false);
  assert.equal(distinctTaskNote(title, title), '');
  assert.equal(distinctTaskNote(' До 90 секунд, найсильніші роботи на початку ', title), 'До 90 секунд, найсильніші роботи на початку');
  assert.equal(distinctTaskNote(undefined, title), '');
});

test('task updates lose a note identical to the current or new title; a note-only echo is dropped entirely', () => {
  const tasks = [{ id: 'reel', title: 'Змонтувати шоурил' }, { id: 'site', title: 'Оновити сайт' }];
  assert.deepEqual(withoutTitleEchoNotes([
    { id: 'reel', note: 'Змонтувати шоурил' },
    { id: 'site', note: 'Оновити сайт', priority: 1 },
    { id: 'reel', title: 'Шоурил 2026', note: 'шоурил 2026' },
  ], tasks), [{ id: 'site', priority: 1 }, { id: 'reel', title: 'Шоурил 2026' }]);
  const useful = [{ id: 'reel', note: 'Музика вже обрана' }];
  assert.deepEqual(withoutTitleEchoNotes(useful, tasks), useful);
});

test('limited starts and credited attempts remain application-owned across AI proposals', () => {
  const fields = taskMutationProperties.taskUpdates.items.properties;
  assert.equal('limitedStart' in fields, false);
  assert.equal('activityTrail' in fields, false);
  const limitedStart = { id: 'limited', capSeconds: 900, startedAt: 1000, baseSeconds: 0, restore: {} };
  const activityTrail = [{ id: 'attempt:forged', at: 1000, kind: 'attempt', attemptSeconds: 900, attemptCapSeconds: 900, attemptOutcome: 'cap_reached' }];
  for (const patch of [{ limitedStart }, { activityTrail }]) {
    assert.throws(() => validatedTimerFields(patch), /accounting field/);
    assert.throws(() => validateTaskMutations({ taskUpdates: [{ id: parent.id, note: 'Keep', ...patch }] }, [parent]), /accounting field/);
    const updated = applyAITaskUpdate(parent, { id: parent.id, note: 'Keep', ...patch } as any, new Set(['focus']), 1000);
    assert.equal(updated.limitedStart, undefined);
    assert.equal(updated.activityTrail, undefined);
  }
});
