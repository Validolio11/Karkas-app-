import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeWorkspace, sameWorkspace, type WorkspaceState } from './syncState';
import type { PSTask } from '../types';

const task = (id: string, title = id): PSTask => ({
  id, title, phase: 'work', priority: 2, steps: 1, currentStep: 0,
  done: false, pinned: false, createdAt: 1,
});
const state = (tasks: PSTask[] = []): WorkspaceState => ({
  tasks, tabs: [{ id: 'work', name: 'Work' }], deletedTasks: [],
  settings: { soundEnabled: true, fireEnabled: true, lang: 'uk', aiIconVariant: 'quantum' },
});

test('offline task edits survive reconnect while remote edits to other fields survive', () => {
  const base = state([task('a')]);
  const local = state([{ ...task('a'), title: 'Offline title' }]);
  const remote = state([{ ...task('a'), pinned: true }, task('remote')]);
  const result = mergeWorkspace(base, local, remote);
  assert.deepEqual(result.tasks, [{ ...task('a'), title: 'Offline title', pinned: true }, task('remote')]);
});

test('local deletion removes remote task and remote deletion is not resurrected by unchanged local copy', () => {
  const base = state([task('local-delete'), task('remote-delete')]);
  const local = state([task('remote-delete')]);
  local.deletedTasks = [{ ...task('local-delete'), deletedAt: 2 }];
  const remote = state([task('local-delete')]);
  remote.deletedTasks = [{ ...task('remote-delete'), deletedAt: 3 }];
  const result = mergeWorkspace(base, local, remote);
  assert.deepEqual(result.tasks, []);
  assert.deepEqual(result.deletedTasks.map((item) => item.id).sort(), ['local-delete', 'remote-delete']);
});

test('both devices can add tasks concurrently', () => {
  const result = mergeWorkspace(state(), state([task('local')]), state([task('remote')]));
  assert.deepEqual(result.tasks.map((item) => item.id).sort(), ['local', 'remote']);
});

test('settings changes merge individually and field removal is preserved', () => {
  const base = state([{ ...task('a'), note: 'Old note' }]);
  const local = state([task('a')]);
  local.settings.soundEnabled = false;
  const remote = structuredClone(base);
  remote.settings.lang = 'en';
  const result = mergeWorkspace(base, local, remote);
  assert.equal(result.settings.soundEnabled, false);
  assert.equal(result.settings.lang, 'en');
  assert.equal('note' in result.tasks[0], false);
});

test('first sync unions local and remote entities without mutating inputs', () => {
  const local = state([task('local')]);
  const remote = state([task('remote')]);
  const result = mergeWorkspace(null, local, remote);
  assert.equal(result.tasks.length, 2);
  assert.deepEqual(local.tasks, [task('local')]);
  assert.deepEqual(remote.tasks, [task('remote')]);
});

test('canonical workspace equality ignores key order and cloud metadata', () => {
  const original = state([task('a')]);
  const reordered = { ...original, tasks: original.tasks.map((item) => Object.fromEntries(Object.entries(item).reverse()) as PSTask), updatedAt: 100 };
  assert.equal(sameWorkspace(original, reordered), true);
  assert.equal(sameWorkspace(original, state()), false);
});
