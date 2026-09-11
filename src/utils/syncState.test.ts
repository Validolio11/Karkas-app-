import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_CLOUD_PAYLOAD_BYTES,
  assertCloudPayloadWithinLimit,
  cloudPayloadSizeBytes,
  isSyncMutationApplied,
  mergeWorkspace,
  recordSyncMutation,
  sameWorkspace,
  type WorkspaceState,
} from './syncState';
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

test('remote deletion wins over an offline edit and never leaves the task active and deleted', () => {
  const base = state([task('deleted-remotely', 'Original title')]);
  const local = state([{ ...task('deleted-remotely', 'Edited offline'), pinned: true }]);
  const remote = state();
  remote.deletedTasks = [{ ...task('deleted-remotely', 'Original title'), deletedAt: 10 }];

  const result = mergeWorkspace(base, local, remote);
  const activeCopies = result.tasks.filter((item) => item.id === 'deleted-remotely');
  const deletedCopies = result.deletedTasks.filter((item) => item.id === 'deleted-remotely');

  assert.deepEqual(activeCopies, []);
  assert.equal(deletedCopies.length, 1);
  assert.equal(deletedCopies[0].deletedAt, 10);
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

test('first sync prefers remote settings over untouched defaults while preserving local entities', () => {
  const local = state([task('local-draft')]);
  const remote = state([task('remote-task')]);
  remote.settings = {
    soundEnabled: false,
    fireEnabled: false,
    lang: 'en',
    aiIconVariant: 'orbit',
  };

  const result = mergeWorkspace(null, local, remote, { preferRemoteSettingsOnFirstSync: true });

  assert.deepEqual(result.settings, remote.settings);
  assert.deepEqual(result.tasks.map((item) => item.id).sort(), ['local-draft', 'remote-task']);
});

test('canonical workspace equality ignores key order and cloud metadata', () => {
  const original = state([task('a')]);
  const reordered = { ...original, tasks: original.tasks.map((item) => Object.fromEntries(Object.entries(item).reverse()) as PSTask), updatedAt: 100 };
  assert.equal(sameWorkspace(original, reordered), true);
  assert.equal(sameWorkspace(original, state()), false);
});

test('sync mutation identity makes a lost-response retry idempotent per client', () => {
  const recorded = recordSyncMutation({ 'other-client': 4 }, { clientId: 'desktop-a', sequence: 7 });
  assert.equal(isSyncMutationApplied(recorded, { clientId: 'desktop-a', sequence: 7 }), true);
  assert.equal(isSyncMutationApplied(recorded, { clientId: 'desktop-a', sequence: 8 }), false);
  assert.equal(isSyncMutationApplied(recorded, { clientId: 'desktop-b', sequence: 7 }), false);
  assert.deepEqual(recorded, { 'other-client': 4, 'desktop-a': 7 });
});

test('sync mutation metadata ignores malformed cloud values', () => {
  const malformed = { 'desktop-a': '999', short: 5, 'desktop-valid': -2 } as unknown as Record<string, number>;
  assert.equal(isSyncMutationApplied(malformed, { clientId: 'desktop-a', sequence: 1 }), false);
  assert.deepEqual(recordSyncMutation(malformed, { clientId: 'desktop-new', sequence: 3 }), { 'desktop-new': 3 });
});

test('cloud payload guard leaves headroom below the Firestore document limit', () => {
  const valid = { text: 'ж'.repeat(100) };
  assert.ok(cloudPayloadSizeBytes(valid) > 100, 'size must be measured as UTF-8 bytes');
  assert.doesNotThrow(() => assertCloudPayloadWithinLimit(valid));
  assert.throws(
    () => assertCloudPayloadWithinLimit({ text: 'x'.repeat(MAX_CLOUD_PAYLOAD_BYTES) }),
    { name: 'CloudWorkspaceTooLargeError' },
  );
});
