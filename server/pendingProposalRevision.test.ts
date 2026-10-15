import assert from 'node:assert/strict';
import test from 'node:test';
import { assertRequestedTimeWindow, pendingRevisionTargets, reconcilePendingProposal, requestedTimeWindow } from './pendingProposalRevision';

const typing = { title: 'Швидкий друк навчання', phase: 'focus', priority: 2, steps: 0,
  schedule: { startAt: '2026-10-15T19:00:00+03:00', timeZone: 'Europe/Kiev', recurrence: 'once', leadMinutes: 5 } };
const pending = { tasks: [{ title: 'Зробити три анімації', phase: 'focus', priority: 1, steps: 3,
  plannedDate: '2026-10-15', stepList: [{ title: 'Анімація 1' }, { title: 'Анімація 2' }, { title: 'Анімація 3' }] }, typing],
  taskUpdates: [{ id: 'other', priority: 3 }], taskDeletions: [{ id: 'old', deletionReason: 'cancelled' }], tabs: [{ id: 'study', name: 'Навчання' }] };
const live = [{ id: 'animation', title: 'Робота над анімацією' }, { id: 'other', title: 'Інше' }, { id: 'old', title: 'Старе' }];

test('a scoped draft timer patch retains the other new task, steps, schedule and all untouched operations', () => {
  const snapshot = JSON.stringify(pending);
  const targets = pendingRevisionTargets(pending, live);
  const revision = { targets, allowedIds: ['pending-task:0'] };
  const schedule = { ...typing.schedule, startAt: '2026-10-15T15:30:00+03:00' };
  const result = reconcilePendingProposal({ reply: 'Timer', taskUpdates: [{ id: 'pending-task:0', timerMode: 'countdown', countdownDurationSeconds: 10800, schedule }] }, pending, revision);
  assert.deepEqual(result.tasks[0], { ...pending.tasks[0], timerMode: 'countdown', countdownDurationSeconds: 10800, schedule });
  assert.deepEqual(result.tasks[1], typing);
  for (const field of ['tabs', 'taskUpdates', 'taskDeletions']) assert.deepEqual(result[field], pending[field as keyof typeof pending]);
  assert.equal(JSON.stringify(pending), snapshot, 'reconciliation must not mutate the original draft');
  assert.ok(!JSON.stringify(result).includes('pending-task:'), 'synthetic identities must not reach the client');
});

test('clarification, an unrelated live patch and an empty filtered patch never restore an actionable draft', () => {
  const revision = { targets: pendingRevisionTargets(pending, live), allowedIds: ['pending-task:0'] };
  for (const parsed of [{ reply: 'Which task?' }, { taskUpdates: [{ id: 'animation', timerMode: 'stopwatch' }] }, { taskUpdates: [{ id: 'pending-task:0' }] }]) {
    const result = reconcilePendingProposal(parsed, pending, revision);
    for (const field of ['tasks', 'tabs', 'taskUpdates', 'taskDeletions']) assert.deepEqual(result[field], []);
  }
});

test('only an explicit addition mode appends a new task while retaining the current draft', () => {
  const targets = pendingRevisionTargets(pending, live);
  const added = { title: 'Створити скрипт', phase: 'focus', priority: 2, steps: 0 };
  assert.deepEqual(reconcilePendingProposal({ tasks: [added] }, pending, { targets, allowedIds: [] }).tasks, []);
  const result = reconcilePendingProposal({ tasks: [added] }, pending, { targets, allowedIds: [], allowCreate: true });
  assert.deepEqual(result.tasks, [...pending.tasks, added]);
  assert.deepEqual(result.taskUpdates, pending.taskUpdates);
});

test('draft ids cannot collide with a real workspace id and renames preserve draft identity', () => {
  const targets = pendingRevisionTargets(pending, [...live, { id: 'pending-task:0', title: 'Real' }]);
  assert.equal(targets[0].id, '_pending-task:0');
  const result = reconcilePendingProposal({ taskUpdates: [{ id: targets[0].id, title: 'Три готові анімації' }] }, pending, { targets, allowedIds: [targets[0].id] });
  assert.equal(result.tasks.length, 2);
  assert.equal(result.tasks[0].title, 'Три готові анімації');
  assert.equal(result.tasks[0].stepList.length, 3);
});

test('15:30–18:30 requires the actual local start and a paused three-hour timer', () => {
  const prompt = 'Додай до анімації таймер з 15:30 до 18:30';
  assert.deepEqual(requestedTimeWindow(prompt), { ambiguous: false, start: '15:30', durationSeconds: 10800 });
  const task = { timerMode: 'countdown', countdownDurationSeconds: 10800, schedule: { ...typing.schedule, startAt: '2026-10-15T15:30:00+03:00' } };
  assert.doesNotThrow(() => assertRequestedTimeWindow(prompt, [task], 'Europe/Kiev'));
  assert.throws(() => assertRequestedTimeWindow(prompt, [{ ...task, schedule: undefined }], 'Europe/Kiev'));
  assert.throws(() => assertRequestedTimeWindow(prompt, [{ ...task, countdownDurationSeconds: 180 }], 'Europe/Kiev'));
  assert.throws(() => assertRequestedTimeWindow(prompt, [{ ...task, schedule: { ...task.schedule, startAt: '2026-10-15T16:30:00+03:00' } }], 'Europe/Kiev'));
  assert.deepEqual(requestedTimeWindow('з 23:00 до 01:00'), { ambiguous: true });
  assert.deepEqual(requestedTimeWindow('з 25:00 до 26:00'), { ambiguous: true });
  assert.deepEqual(requestedTimeWindow('з 23:00 до 01:00 наступного дня'), { ambiguous: false, start: '23:00', durationSeconds: 7200 });
});
