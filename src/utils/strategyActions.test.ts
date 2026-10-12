import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PSTask, StrategyAction } from '../types';
import { applyStrategyActions, undoStrategyAction } from './strategyActions';
import { createPersonalStrategyProfile } from './personalStrategy';
import { confirmedProfile } from './strategyDiscovery.testHelpers';
import { isPersonalStrategyReady } from './strategyDiscovery';

const task: PSTask = { id: 't', title: 'Study', phase: 'work', priority: 2, steps: 2, currentStep: 1, done: false, pinned: false,
  createdAt: 1, timeSpentSeconds: 700, startedAt: 2, stepList: [{ id: 's1', title: 'Completed', done: true, timeSpentSeconds: 300 }, { id: 's2', title: 'Current', done: false, timeSpentSeconds: 400 }], timerStepId: 's2' };
const profile = () => confirmedProfile([{ id: 'g', title: 'Learn', motive: 'Freedom', agreed: false, taskIds: ['t'], categoryIds: ['work'] }]);
const options = (actions: StrategyAction[]) => ({ tasks: [task], profile: profile(), actions, ownerId: 'a', currentOwnerId: 'a', turnId: 'turn', tabs: [{ id: 'work', name: 'Work' }], now: 100 });
const action = (changes: StrategyAction['changes']): StrategyAction => ({ id: 'action', goalId: 'g', type: 'update', taskId: 't', expectedTask: task, reason: 'Reduce friction', changes });

test('autonomous dates preserve recorded progress and can be undone; invalid ranges cannot apply', () => {
  const result = applyStrategyActions(options([action({ plannedDate: '2026-10-12', deadlineDate: '2026-10-15' })]));
  assert.equal(result.applied.length, 1);
  assert.equal(result.tasks[0].plannedDate, '2026-10-12');
  assert.equal(result.tasks[0].deadlineDate, '2026-10-15');
  assert.equal(result.tasks[0].timeSpentSeconds, task.timeSpentSeconds);
  assert.deepEqual(result.tasks[0].stepList, task.stepList);
  const undone = undoStrategyAction({ ...result, actionId: result.applied[0].id, ownerId: 'a', currentOwnerId: 'a' });
  assert.equal(undone.undone, true);
  assert.deepEqual(undone.tasks, [task]);
  for (const dates of [{ plannedDate: '2026-02-30' }, { plannedDate: '2026-10-15', deadlineDate: '2026-10-12' }]) {
    const rejected = applyStrategyActions(options([action(dates)]));
    assert.equal(rejected.applied.length, 0);
    assert.deepEqual(rejected.tasks, [task]);
  }
});

test('over-limit autonomous proposals are rejected atomically without partially creating tasks', () => {
  const actions: StrategyAction[] = Array.from({ length: 4 }, (_, index) => ({ id: `create-${index}`, goalId: 'g', reason: 'Next action', type: 'create', changes: { title: `Next ${index}`, phase: 'work' } }));
  const oversized = applyStrategyActions(options(actions));
  assert.equal(oversized.applied.length, 0);
  assert.deepEqual(oversized.tasks, [task]);
  assert.equal(applyStrategyActions(options(actions.slice(0, 3))).applied.length, 3);
});

test('autonomous changes preserve work readings and measured/completed steps', () => {
  const result = applyStrategyActions(options([action({ title: 'A smaller beginning', stepTitles: ['A next small step'] })]));
  assert.equal(result.applied.length, 1);
  assert.equal(result.tasks[0].timeSpentSeconds, 700);
  assert.equal(result.tasks[0].startedAt, 2);
  assert.deepEqual(result.tasks[0].stepList?.slice(0, 2), task.stepList);
  assert.equal(result.tasks[0].currentStep, 1);
  assert.equal(result.tasks[0].done, false);
  assert.equal(task.title, 'Study');
});
test('unknown goals, wrong accounts, stale task snapshots and protected fields cannot apply', () => {
  for (const changes of [{ done: true }, { timeSpentSeconds: 0 }, { timerRunning: true }, { priority: 9 }]) {
    assert.equal(applyStrategyActions(options([action(changes as any)])).applied.length, 0);
  }
  assert.equal(applyStrategyActions({ ...options([action({ priority: 1 })]), currentOwnerId: 'b' }).applied.length, 0);
  assert.equal(applyStrategyActions({ ...options([action({ priority: 1 })]), tasks: [{ ...task, note: 'Edited after request' }] }).applied.length, 0);
  const unagreed = profile(); unagreed.goals[0].agreed = false;
  assert.equal(applyStrategyActions({ ...options([action({ priority: 1 })]), profile: unagreed }).applied.length, 0);
});
test('unchanged unmeasured step titles retain their IDs, readings and estimates', () => {
  const unmeasured = { id: 'same-id', title: 'Same next step', done: false, timeSpentSeconds: 0, estimatedDurationSeconds: 300 };
  const existing = { ...task, stepList: [...task.stepList!, unmeasured] };
  const result = applyStrategyActions({ ...options([{ ...action({ stepTitles: ['Same next step', 'New step'] }), expectedTask: existing }]), tasks: [existing] });
  assert.equal(result.applied.length, 1);
  assert.deepEqual(result.tasks[0].stepList?.find(step => step.id === 'same-id'), unmeasured);
});
test('durable turn and action IDs prevent duplicates and retries after undo do not reapply', () => {
  const create: StrategyAction = { id: 'new', goalId: 'g', reason: 'Prepare next action', type: 'create', changes: { title: 'Prepare', phase: 'work' } };
  const original = options([create]);
  const first = applyStrategyActions(original);
  assert.equal(isPersonalStrategyReady(first.profile), true);
  const repeated = applyStrategyActions({ ...original, tasks: first.tasks, profile: first.profile });
  assert.equal(repeated.tasks.length, 2);
  assert.equal(repeated.applied.length, 0);
  const undone = undoStrategyAction({ ...first, actionId: first.applied[0].id, ownerId: 'a', currentOwnerId: 'a' });
  assert.equal(undone.undone, true);
  assert.equal(undone.tasks.length, 1);
  assert.equal(applyStrategyActions({ ...original, tasks: undone.tasks, profile: undone.profile }).tasks.length, 1);
});
test('early autonomy cannot bypass discovery with an agreed goal or provider ready status', () => {
  const early = { ...createPersonalStrategyProfile(), onboardingStatus: 'complete' as const, goals: profile().goals };
  const result = applyStrategyActions({ ...options([action({ priority: 1 })]), profile: early });
  assert.equal(result.applied.length, 0);
  assert.equal(result.tasks[0], task);
  assert.match(result.rejected[0].reason, /discovery/);
});
test('undo refuses newer task edits, timer progress and another account', () => {
  const changed = applyStrategyActions(options([action({ priority: 1 })]));
  const base = { ...changed, actionId: changed.applied[0].id, ownerId: 'a', currentOwnerId: 'a' };
  assert.equal(undoStrategyAction({ ...base, tasks: [{ ...changed.tasks[0], timeSpentSeconds: 701 }] }).undone, false);
  assert.equal(undoStrategyAction({ ...base, currentOwnerId: 'b' }).undone, false);
  assert.equal(undoStrategyAction(base).tasks[0].priority, 2);
});
test('rescheduling existing work keeps identity and progress, new scheduled work uses templates', () => {
  const schedule = { startAt: '2026-11-01T09:00:00+02:00', recurrence: 'once' as const, timeZone: 'Europe/Kyiv', leadMinutes: 5 };
  const result = applyStrategyActions(options([action({ schedule })]));
  assert.equal(result.tasks[0].scheduledPending, false);
  assert.equal(result.tasks[0].scheduledFor, Date.parse(schedule.startAt));
  assert.equal(result.tasks[0].id, task.id);
  const created = applyStrategyActions(options([{ id: 'new', goalId: 'g', type: 'create', reason: 'Scheduled preparation', changes: { title: 'New task', phase: 'work', schedule } }]));
  assert.equal(created.tasks[1].scheduledPending, true);
  assert.equal(created.tasks[1].scheduleNextStartAt, schedule.startAt);
  assert.equal(result.tasks[0].timeSpentSeconds, 700);
  const running = { ...task, timerRunning: true };
  assert.equal(applyStrategyActions({ ...options([{ ...action({ schedule }), expectedTask: running }]), tasks: [running] }).applied.length, 0);
});
