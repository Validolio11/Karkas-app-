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
