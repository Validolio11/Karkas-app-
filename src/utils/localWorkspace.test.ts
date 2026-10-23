import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorkspaceState } from './syncState';
import { parseAccountRecord, readLocalWorkspace } from './localWorkspace';

const workspace = (id = 'local'): WorkspaceState => ({
  tasks: [{ id, title: id, phase: 'work', priority: 2, steps: 0, currentStep: 0, done: false, pinned: false, createdAt: 1 }],
  deletedTasks: [], tabs: [{ id: 'work', name: 'Work' }],
  settings: { lang: 'uk', aiIconVariant: 'quantum', soundEnabled: true, fireEnabled: false },
});
const keys = { tasks: 'legacy-tasks', tabs: 'legacy-tabs', deletedTasks: 'legacy-deleted', completionLedger: 'legacy-ledger' };
const storage = () => {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; } };
};

test('a pending device mirror preserves the paired local workspace, baseline and sync time without mixing snapshots', () => {
  const store = storage();
  const record = { workspace: workspace('unsynced-edit'), base: workspace('acknowledged-base'), lastSyncTime: 45,
    desktopMirrorPending: true, recovery: workspace('recovery'), syncClientId: 'client_123', nextSyncSequence: 2,
    pendingSync: { mutationId: 'client_123:2', clientId: 'client_123', sequence: 2, createdAt: 40,
      attempts: 0, nextAttemptAt: 40, workspace: workspace('queued-edit'), base: workspace('queued-base') } };
  const raw = JSON.stringify(record);
  store.setItem('account', raw);
  const parsed = parseAccountRecord(raw, store, 'account');
  assert.deepEqual(parsed, record);
  assert.equal(parsed.desktopMirrorPending, true);
  assert.equal(parsed.workspace.tasks[0].id, 'unsynced-edit');
  assert.equal(parsed.base.tasks[0].id, 'acknowledged-base');
  assert.equal(parsed.pendingSync.base.tasks[0].id, 'queued-base');
  assert.equal(store.getItem('account'), raw);
  assert.equal(store.getItem('account:recovery-backup'), null);
});

test('acknowledged and legacy account snapshots preserve an explicit false or absent mirror status', () => {
  const store = storage();
  for (const fields of [{ desktopMirrorPending: false }, {}]) {
    const record = { workspace: workspace(), base: null, lastSyncTime: null, ...fields };
    assert.deepEqual(parseAccountRecord(JSON.stringify(record), store, 'account'), record);
  }
});

test('malformed mirror status is rejected and its exact original account bytes are retained', () => {
  for (const desktopMirrorPending of [null, 0, 1, 'true', {}, []]) {
    const store = storage();
    const raw = JSON.stringify({ workspace: workspace(), desktopMirrorPending });
    store.setItem('account', raw);
    assert.throws(() => parseAccountRecord(raw, store, 'account'), /Invalid device mirror status/);
    assert.equal(store.getItem('account:recovery-backup'), raw);
    assert.equal(store.getItem('account'), raw);
  }
});

test('owner canonical snapshot wins over stale or corrupt global mirrors before startup, including completion receipts', () => {
  const store = storage();
  const local = workspace('new-task');
  local.settings.completionLedger = { retired: { completedAt: 10, updatedAt: 20, retiredAt: 20, counted: true } };
  const raw = JSON.stringify({ workspace: local, base: workspace('base'), desktopMirrorPending: true });
  store.setItem('karkas_workspace_owner', 'owner-A');
  store.setItem('karkas_workspace:owner-A', raw);
  store.setItem('karkas_workspace:owner-B', JSON.stringify({ workspace: workspace('other-account') }));
  store.setItem('karkas_workspace:guest', JSON.stringify({ workspace: workspace('guest') }));
  store.setItem(keys.tasks, '[null]');
  store.setItem(keys.tabs, '{broken');
  store.setItem(keys.completionLedger, '{broken');
  const result = readLocalWorkspace(store, keys, workspace().settings);
  assert.equal(result.canPersist, true);
  assert.equal(result.recovered, false);
  assert.deepEqual(result.workspace, local);
  assert.equal(store.getItem('karkas_workspace:owner-A'), raw);
  assert.equal(store.getItem(keys.tasks), '[null]');
});

test('guest canonical snapshot is independent from a stored signed-in account', () => {
  const store = storage();
  store.setItem('karkas_workspace:guest', JSON.stringify({ workspace: workspace('guest-edit'), desktopMirrorPending: true }));
  store.setItem('karkas_workspace:owner-A', JSON.stringify({ workspace: workspace('private-edit') }));
  assert.equal(readLocalWorkspace(store, keys, workspace().settings).workspace.tasks[0].id, 'guest-edit');
});

test('an invalid canonical pair blocks writes rather than falling back to stale compatibility mirrors', () => {
  const store = storage();
  const raw = JSON.stringify({ workspace: workspace('keep-local'), base: { ...workspace(), tasks: [null] }, desktopMirrorPending: true });
  store.setItem('karkas_workspace_owner', 'owner-A');
  store.setItem('karkas_workspace:owner-A', raw);
  store.setItem(keys.tasks, JSON.stringify(workspace('stale').tasks));
  const result = readLocalWorkspace(store, keys, workspace().settings);
  assert.equal(result.canPersist, false);
  assert.equal(result.recovered, true);
  assert.equal(result.backupPreserved, true);
  assert.equal(result.workspace.tasks.length, 0);
  assert.equal(store.getItem('karkas_workspace:owner-A'), raw);
  assert.equal(store.getItem('karkas_workspace:owner-A:recovery-backup'), raw);
});

test('failure to preserve an invalid canonical account keeps persistence blocked and the source intact', () => {
  const store = storage();
  const raw = JSON.stringify({ workspace: workspace(), desktopMirrorPending: 'pending' });
  store.setItem('karkas_workspace:guest', raw);
  store.setItem = () => { throw new Error('Quota'); };
  const result = readLocalWorkspace(store, keys, workspace().settings);
  assert.equal(result.canPersist, false);
  assert.equal(result.backupPreserved, false);
  assert.equal(store.getItem('karkas_workspace:guest'), raw);
});

test('legacy mirrors still load when no owner snapshot exists', () => {
  const store = storage();
  const legacy = workspace('legacy');
  store.setItem(keys.tasks, JSON.stringify(legacy.tasks));
  store.setItem(keys.tabs, JSON.stringify(legacy.tabs));
  store.setItem(keys.deletedTasks, JSON.stringify(legacy.deletedTasks));
  const result = readLocalWorkspace(store, keys, legacy.settings);
  assert.equal(result.canPersist, true);
  assert.deepEqual(result.workspace, legacy);
});
