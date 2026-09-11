import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PSTask } from '../types';
import type { WorkspaceState } from './syncState';
import {
  CLOUD_SHADOW_MAX_WRITES,
  buildCloudShadowPlan,
  encodeCloudEntityDocumentId,
  materializeCloudShadow,
  pageCloudShadowPlan,
  parseCloudShadowManifest,
} from './cloudShadow';

const task = (id: string, title = id): PSTask => ({
  id, title, phase: 'work', priority: 2, steps: 1, currentStep: 0,
  done: false, pinned: false, createdAt: 1,
});
const state = (tasks: PSTask[] = []): WorkspaceState => ({
  tasks, tabs: [{ id: 'work', name: 'Work' }], deletedTasks: [],
  settings: { soundEnabled: true, fireEnabled: true, lang: 'uk', aiIconVariant: 'quantum' },
});

test('cloud entity ids are deterministic, path-safe and support Unicode', () => {
  const first = encodeCloudEntityDocumentId('проєкт/alpha');
  assert.equal(first, encodeCloudEntityDocumentId('проєкт/alpha'));
  assert.equal(first.includes('/'), false);
  assert.match(first, /^e_[A-Za-z0-9_-]+$/);
  assert.throws(() => encodeCloudEntityDocumentId('\uD800'), /invalid Unicode/);
  assert.throws(() => encodeCloudEntityDocumentId('\uD801'), /invalid Unicode/);
  assert.throws(() => encodeCloudEntityDocumentId(''));
  assert.throws(() => encodeCloudEntityDocumentId('ж'.repeat(500)));
});

test('initial shadow migration writes active tasks, tombstones and settings deterministically', () => {
  const workspace = state([task('b'), task('a')]);
  workspace.deletedTasks = [{ ...task('deleted'), deletedAt: 5 }];
  const plan = buildCloudShadowPlan(null, { ...state(), revision: 0 }, workspace, 1);
  assert.equal(plan.fullReconcile, true);
  assert.deepEqual(plan.taskWrites.map((write) => [write.id, write.lifecycle]), [
    ['a', 'active'], ['b', 'active'], ['deleted', 'deleted'],
  ]);
  assert.deepEqual(plan.manifest.tasks, [
    { id: 'a', revision: 1, lifecycle: 'active' },
    { id: 'b', revision: 1, lifecycle: 'active' },
    { id: 'deleted', revision: 1, lifecycle: 'deleted' },
  ]);
  assert.ok(plan.settings);
});

test('current shadow writes only changed entities', () => {
  const before = { ...state([task('a'), task('b')]), revision: 4 };
  const after = state([{ ...task('a'), pinned: true }, task('b')]);
  const manifest = {
    schemaVersion: 2 as const,
    revision: 4,
    tasks: [{ id: 'a', revision: 4, lifecycle: 'active' as const }, { id: 'b', revision: 3, lifecycle: 'active' as const }],
    tabs: [{ id: 'work', revision: 2, lifecycle: 'active' as const }],
    settingsRevision: 2,
    taskCount: 2,
    tabCount: 1,
  };
  const plan = buildCloudShadowPlan(manifest, before, after, 5);
  assert.equal(plan.fullReconcile, false);
  assert.deepEqual(plan.taskWrites.map((write) => write.id), ['a']);
  assert.deepEqual(plan.tabWrites, []);
  assert.equal(plan.settings, null);
  assert.deepEqual(plan.manifest.tasks, [
    { id: 'a', revision: 5, lifecycle: 'active' },
    { id: 'b', revision: 3, lifecycle: 'active' },
  ]);
});

test('stale shadow fully reconciles old ids into anti-resurrection tombstones', () => {
  const before = { ...state([task('current')]), revision: 8 };
  const manifest = {
    schemaVersion: 2 as const,
    revision: 6,
    tasks: [{ id: 'removed', revision: 6, lifecycle: 'active' as const }],
    tabs: [{ id: 'old-tab', revision: 6, lifecycle: 'active' as const }],
    settingsRevision: 6,
    taskCount: 1,
    tabCount: 1,
  };
  const plan = buildCloudShadowPlan(manifest, before, before, 9);
  assert.equal(plan.fullReconcile, true);
  assert.deepEqual(plan.taskWrites.map((write) => [write.id, write.lifecycle]), [
    ['current', 'active'], ['removed', 'purged'],
  ]);
  assert.deepEqual(plan.tabWrites.map((write) => [write.id, write.lifecycle]), [
    ['old-tab', 'deleted'], ['work', 'active'],
  ]);
});

test('stale legacy data cannot reactivate a shadow tombstone with the same id', () => {
  const before = { ...state([task('deleted-before')]), revision: 8 };
  const manifest = {
    schemaVersion: 2 as const,
    revision: 7,
    tasks: [{ id: 'deleted-before', revision: 7, lifecycle: 'deleted' as const }],
    tabs: [{ id: 'work', revision: 7, lifecycle: 'active' as const }],
    settingsRevision: 7,
    taskCount: 1,
    tabCount: 1,
  };
  const plan = buildCloudShadowPlan(manifest, before, before, 9);
  assert.deepEqual(plan.taskWrites, []);
  assert.deepEqual(plan.manifest.tasks, [
    { id: 'deleted-before', revision: 7, lifecycle: 'deleted' },
  ]);
});

test('a purged shadow task cannot be downgraded to deleted by a stale legacy client', () => {
  const before = { ...state(), revision: 8 };
  before.deletedTasks = [{ ...task('purged-before'), deletedAt: 3 }];
  const manifest = {
    schemaVersion: 2 as const,
    revision: 7,
    tasks: [{ id: 'purged-before', revision: 7, lifecycle: 'purged' as const }],
    tabs: [{ id: 'work', revision: 7, lifecycle: 'active' as const }],
    settingsRevision: 7,
    taskCount: 1,
    tabCount: 1,
  };
  const plan = buildCloudShadowPlan(manifest, before, before, 9);
  assert.deepEqual(plan.taskWrites, []);
  assert.deepEqual(plan.manifest.tasks, [
    { id: 'purged-before', revision: 7, lifecycle: 'purged' },
  ]);
});

test('malformed remote manifests are ignored and rebuilt from the legacy workspace', () => {
  const before = { ...state([task('safe')]), revision: 3 };
  const malformed = { schemaVersion: 2, revision: 3, tasks: 'not-an-array', tabs: [] } as unknown as Parameters<typeof buildCloudShadowPlan>[0];
  const plan = buildCloudShadowPlan(malformed, before, before, 4);
  assert.equal(plan.fullReconcile, true);
  assert.deepEqual(plan.manifest.tasks, [{ id: 'safe', revision: 4, lifecycle: 'active' }]);
  assert.deepEqual(plan.taskWrites.map((write) => write.id), ['safe']);
});

test('manifest parser rejects duplicates and incorrect declared counts', () => {
  const plan = buildCloudShadowPlan(null, { ...state(), revision: 0 }, state([task('a')]), 1);
  assert.deepEqual(parseCloudShadowManifest(plan.manifest), plan.manifest);
  assert.throws(() => parseCloudShadowManifest({ ...plan.manifest, taskCount: 99 }), /invalid/);
  assert.throws(() => parseCloudShadowManifest({
    ...plan.manifest,
    taskCount: 2,
    tasks: [...plan.manifest.tasks, ...plan.manifest.tasks],
  }), /duplicate/);
});

test('shadow plan rejects transactions beyond its reserved write budget', () => {
  const tooManyTasks = Array.from({ length: CLOUD_SHADOW_MAX_WRITES }, (_, index) => task(`task-${index}`));
  assert.throws(
    () => buildCloudShadowPlan(null, { ...state(), revision: 0 }, state(tooManyTasks), 1),
    { name: 'CloudShadowWriteLimitError' },
  );
});

test('oversized migration plans can be paged deterministically without losing writes', () => {
  const tasks = Array.from({ length: 900 }, (_, index) => task(`task-${String(index).padStart(4, '0')}`));
  const plan = buildCloudShadowPlan(null, { ...state(), revision: 0 }, state(tasks), 1, {
    maxWrites: Number.MAX_SAFE_INTEGER,
  });
  const first = pageCloudShadowPlan(plan, 0, 400);
  const second = pageCloudShadowPlan(plan, first.nextCursor, 400);
  const third = pageCloudShadowPlan(plan, second.nextCursor, 400);
  assert.equal(first.complete, false);
  assert.equal(second.complete, false);
  assert.equal(third.complete, true);
  assert.equal(first.taskWrites.length + second.taskWrites.length + third.taskWrites.length, 900);
  assert.ok(third.settings);
  assert.throws(() => pageCloudShadowPlan(plan, 9999, 400), /cursor exceeds/);
});

test('verified shadow materialization round-trips the canonical workspace', () => {
  const workspace = state([task('active')]);
  workspace.deletedTasks = [{ ...task('deleted'), deletedAt: 4 }];
  const plan = buildCloudShadowPlan(null, { ...state(), revision: 0 }, workspace, 1);
  const materialized = materializeCloudShadow(
    plan.manifest,
    plan.taskWrites.map((write) => ({ ...write, revision: 1 })),
    plan.tabWrites.map((write) => ({ ...write, revision: 1 })),
    { revision: 1, value: plan.settings! },
  );
  assert.deepEqual(materialized, workspace);
});

test('shadow materialization rejects missing and mixed-revision documents', () => {
  const workspace = state([task('active')]);
  const plan = buildCloudShadowPlan(null, { ...state(), revision: 0 }, workspace, 1);
  assert.throws(() => materializeCloudShadow(
    plan.manifest,
    [],
    plan.tabWrites.map((write) => ({ ...write, revision: 1 })),
    { revision: 1, value: plan.settings! },
  ), /missing or stale/);
  assert.throws(() => materializeCloudShadow(
    plan.manifest,
    plan.taskWrites.map((write) => ({ ...write, revision: 2 })),
    plan.tabWrites.map((write) => ({ ...write, revision: 1 })),
    { revision: 1, value: plan.settings! },
  ), /missing or stale/);
  assert.throws(() => materializeCloudShadow(
    plan.manifest,
    plan.taskWrites.map((write) => ({ ...write, lifecycle: 'purged' as const, value: undefined, revision: 1 })),
    plan.tabWrites.map((write) => ({ ...write, revision: 1 })),
    { revision: 1, value: plan.settings! },
  ), /lifecycle does not match/);
});
