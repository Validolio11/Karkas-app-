import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DeletedTask, PSTask } from '../types';
import type { WorkspaceState } from './syncState';
import { applyWorkspaceMutation, diffWorkspaceMutation } from './syncOperations';

const task = (id: string, title = id): PSTask => ({
  id, title, phase: 'work', priority: 2, steps: 1, currentStep: 0,
  done: false, pinned: false, createdAt: 1,
});
const state = (tasks: PSTask[] = []): WorkspaceState => ({
  tasks, tabs: [{ id: 'work', name: 'Work' }], deletedTasks: [],
  settings: { soundEnabled: true, fireEnabled: true, lang: 'uk', aiIconVariant: 'quantum' },
});
const identity = { clientId: 'desktop-a', sequence: 1 };

test('countdown settings, remaining session and accumulated total survive workspace synchronization', () => {
  const base = state([task('timer')]);
  const next = state([{ ...task('timer'), countdownDurationSeconds: 3600,
    countdownRemainingSeconds: 2400, timeSpentSeconds: 7200, timerRunning: false }]);
  const serialized = JSON.parse(JSON.stringify(diffWorkspaceMutation(base, next, identity)));
  assert.deepEqual(applyWorkspaceMutation(base, serialized), next);
});

test('workspace mutation round-trips edits, additions, tombstones and settings', () => {
  const base = state([task('edit'), task('delete'), task('purge')]);
  base.deletedTasks = [{ ...task('purge'), deletedAt: 5 }];
  const next = state([{ ...task('edit', 'Changed'), pinned: true }, task('new')]);
  next.deletedTasks = [{ ...task('delete'), deletedAt: 10 }];
  next.settings.lang = 'en';

  const mutation = diffWorkspaceMutation(base, next, identity, 100);
  const applied = applyWorkspaceMutation(base, mutation);

  assert.deepEqual(applied, next);
  assert.equal(mutation.createdAt, 100);
  assert.deepEqual(mutation.operations.map((operation) => operation.kind === 'settings' ? 'settings' : `${operation.kind}:${operation.id}`), [
    'task:delete', 'task:edit', 'task:new', 'task:purge', 'settings',
  ]);
});

test('field patches preserve concurrent remote changes', () => {
  const base = state([task('a')]);
  const local = state([{ ...task('a'), title: 'Local title' }]);
  const remote = state([{ ...task('a'), pinned: true }]);
  const applied = applyWorkspaceMutation(remote, diffWorkspaceMutation(base, local, identity));
  assert.equal(applied.tasks[0].title, 'Local title');
  assert.equal(applied.tasks[0].pinned, true);
});

test('a stale edit cannot resurrect a remotely deleted task', () => {
  const base = state([task('a')]);
  const local = state([{ ...task('a'), title: 'Offline edit' }]);
  const remote = state();
  remote.deletedTasks = [{ ...task('a'), deletedAt: 20 } as DeletedTask];

  const applied = applyWorkspaceMutation(remote, diffWorkspaceMutation(base, local, identity));
  assert.deepEqual(applied.tasks, []);
  assert.equal(applied.deletedTasks[0].title, 'Offline edit');
  assert.equal(applied.deletedTasks[0].deletedAt, 20);
});

test('diff output is deterministic regardless of entity input order', () => {
  const left = state([task('b'), task('a')]);
  const right = state([{ ...task('b'), pinned: true }, { ...task('a'), pinned: true }]);
  const reversedLeft = { ...left, tasks: [...left.tasks].reverse() };
  const reversedRight = { ...right, tasks: [...right.tasks].reverse() };

  assert.deepEqual(
    diffWorkspaceMutation(left, right, identity, 100),
    diffWorkspaceMutation(reversedLeft, reversedRight, identity, 100),
  );
});

test('offline edits to different steps preserve both changes and concurrently added steps', () => {
  const base = state([{ ...task('a'), steps: 2, stepList: [
    { id: 'one', title: 'One', done: false }, { id: 'two', title: 'Two', done: false },
  ] }]);
  const left = structuredClone(base);
  left.tasks[0].stepList![0].done = true;
  const right = structuredClone(base);
  right.tasks[0].stepList![1].title = 'Revised';
  right.tasks[0].stepList!.push({ id: 'three', title: 'Three', done: false });
  right.tasks[0].steps = 3;
  const merged = applyWorkspaceMutation(right, diffWorkspaceMutation(base, left, identity));
  assert.deepEqual(merged.tasks[0].stepList, [
    { id: 'one', title: 'One', done: true }, { id: 'two', title: 'Revised', done: false },
    { id: 'three', title: 'Three', done: false },
  ]);
  assert.equal(merged.tasks[0].currentStep, 1);
  assert.equal(merged.tasks[0].steps, 3);
});

test('shared sessions use the maximum; independent sessions add and repeated delivery does not double count', () => {
  const base = state([{ ...task('a'), timeSpentSeconds: 0, stepList: [{ id: 'one', title: 'One', done: false }] }]);
  const left = structuredClone(base);
  left.tasks[0].timeSpentSeconds = 30;
  left.tasks[0].timeSessions = { shared: { seconds: 30, stepId: 'one' } };
  left.tasks[0].stepList![0].timeSpentSeconds = 30;
  const right = structuredClone(base);
  right.tasks[0].timeSpentSeconds = 60;
  right.tasks[0].timeSessions = { shared: { seconds: 40, stepId: 'one' }, other: { seconds: 20 } };
  right.tasks[0].stepList![0].timeSpentSeconds = 40;
  const mutation = diffWorkspaceMutation(base, left, identity);
  const merged = applyWorkspaceMutation(right, mutation);
  assert.equal(merged.tasks[0].timeSpentSeconds, 60);
  assert.equal(merged.tasks[0].stepList![0].timeSpentSeconds, 40);
  assert.deepEqual(applyWorkspaceMutation(merged, mutation), merged);
  left.tasks[0].timeSessions = { independent: { seconds: 30, stepId: 'one' } };
  const independent = applyWorkspaceMutation(right, diffWorkspaceMutation(base, left, identity));
  assert.equal(independent.tasks[0].timeSpentSeconds, 90);
  assert.equal(independent.tasks[0].stepList![0].timeSpentSeconds, 70);
});

test('newer reset rejects stale time, resume and correction while retaining independent title edits', () => {
  const base = state([{ ...task('a'), timeResetAt: 10, timeSpentSeconds: 10, stepList: [
    { id: 'one', title: 'One', done: false, timeSpentSeconds: 10 },
  ] }]);
  const newer = structuredClone(base);
  newer.tasks[0] = { ...newer.tasks[0], timeResetAt: 30, timeSpentSeconds: 0, timerRunning: false, timeSessions: {} };
  newer.tasks[0].stepList![0].timeSpentSeconds = 0;
  for (const reset of [10, 20]) {
    const stale = structuredClone(base);
    stale.tasks[0] = { ...stale.tasks[0], title: 'Keep this edit', timeResetAt: reset,
      timeSpentSeconds: 50, timerRunning: true, timerStartedAt: 40,
      timeSessions: { old: { seconds: 40, stepId: 'one' } } };
    stale.tasks[0].stepList![0].timeSpentSeconds = 50;
    const merged = applyWorkspaceMutation(newer, diffWorkspaceMutation(base, stale, identity));
    assert.equal(merged.tasks[0].title, 'Keep this edit');
    assert.equal(merged.tasks[0].timeSpentSeconds, 0);
    assert.equal(merged.tasks[0].stepList![0].timeSpentSeconds, 0);
    assert.equal(merged.tasks[0].timerRunning, false);
    assert.equal(merged.tasks[0].timerStartedAt, undefined);
    assert.deepEqual(merged.tasks[0].timeSessions, {});
  }
});

test('removed categories recover orphaned active and archived tasks without dropping either', () => {
  const base = state([task('a')]);
  base.deletedTasks = [{ ...task('old'), deletedAt: 50 }];
  const local = structuredClone(base);
  local.tabs = [];
  const merged = applyWorkspaceMutation(base, diffWorkspaceMutation(base, local, identity));
  assert.equal(merged.tabs[0].id, 'recovered-tasks');
  assert.equal(merged.tasks[0].phase, 'recovered-tasks');
  assert.equal(merged.deletedTasks[0].phase, 'recovered-tasks');
});
