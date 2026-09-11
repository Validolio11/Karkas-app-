const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  createDesktopStorage,
  DesktopStorageError,
  SCHEMA_VERSION,
  MAX_PREFERENCES_BYTES,
} = require('./storage.cjs');

const workspace = (title = 'First task') => ({
  tasks: [{ id: 'task-1', title, phase: 'focus', priority: 2, steps: 1, currentStep: 0, done: false, pinned: false, createdAt: 1 }],
  tabs: [{ id: 'focus', name: 'Focus', color: '#a855f7' }],
  deletedTasks: [],
  settings: { soundEnabled: true, fireEnabled: false, lang: 'uk', aiIconVariant: 'quantum' },
});

async function temporaryStorage(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'karkas-storage-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return { directory, storage: createDesktopStorage({ userDataPath: directory }) };
}

test('workspace and preferences round-trip through versioned files', async (t) => {
  const { storage } = await temporaryStorage(t);
  assert.equal(await storage.loadWorkspace(), null);
  assert.equal(await storage.loadPreferences(), null);

  await storage.saveWorkspace(workspace());
  await storage.savePreferences({ zoomPercent: 100, launchAtStartup: false });
  assert.deepEqual(await storage.loadWorkspace(), workspace());
  assert.deepEqual(await storage.loadPreferences(), { zoomPercent: 100, launchAtStartup: false });

  const raw = JSON.parse(await fs.readFile(storage.paths.workspace, 'utf8'));
  assert.equal(raw.schemaVersion, SCHEMA_VERSION);
  assert.equal(raw.kind, 'workspace');
  assert.equal(typeof raw.updatedAt, 'number');
  assert.equal(raw.data.activeOwner, null);
  assert.deepEqual(raw.data.accounts.$guest.workspace, workspace());
});

test('concurrent saves are serialized and do not leave temporary files', async (t) => {
  const { directory, storage } = await temporaryStorage(t);
  await Promise.all(Array.from({ length: 20 }, (_, index) => storage.saveWorkspace(workspace(`Task ${index}`))));
  assert.equal((await storage.loadWorkspace()).tasks[0].title, 'Task 19');
  assert.deepEqual((await fs.readdir(directory)).sort(), ['workspace.json']);
});

test('legacy localStorage snapshot imports once and preserves the stored workspace', async (t) => {
  const { storage } = await temporaryStorage(t);
  const first = await storage.importLegacyWorkspace({
    life_todo_tasks_v2: JSON.stringify(workspace('Legacy').tasks),
    life_todo_tabs_v2: JSON.stringify(workspace().tabs),
    karkas_deleted_tasks_v2: '[]',
    karkas_sound_enabled: 'false',
    karkas_fire_enabled: 'true',
    todo_app_lang: 'en',
    karkas_ai_icon_variant: 'orbit',
  });
  assert.equal(first.imported, true);
  assert.equal(first.workspace.tasks[0].title, 'Legacy');
  assert.deepEqual(first.workspace.settings, { soundEnabled: false, fireEnabled: true, lang: 'en', aiIconVariant: 'orbit' });

  const second = await storage.importLegacyWorkspace(workspace('Must not replace'));
  assert.equal(second.imported, false);
  assert.equal(second.workspace.tasks[0].title, 'Legacy');
});

test('a corrupt existing workspace blocks legacy overwrite', async (t) => {
  const { storage } = await temporaryStorage(t);
  await fs.writeFile(storage.paths.workspace, '{broken', 'utf8');
  await assert.rejects(storage.importLegacyWorkspace(workspace()), (error) => {
    assert.ok(error instanceof DesktopStorageError);
    return error.code === 'CORRUPT_DATA';
  });
  assert.equal(await fs.readFile(storage.paths.workspace, 'utf8'), '{broken');
});

test('invalid, unsafe and oversized values are rejected without creating files', async (t) => {
  const { storage } = await temporaryStorage(t);
  await assert.rejects(storage.saveWorkspace({ tasks: [], tabs: [] }), { code: 'INVALID_DATA' });
  await assert.rejects(storage.savePreferences({ bad: undefined }), { code: 'INVALID_DATA' });
  await assert.rejects(storage.savePreferences({ huge: Array(5).fill('x'.repeat(60000)) }), { code: 'DATA_TOO_LARGE' });
  await assert.rejects(fs.stat(storage.paths.preferences), { code: 'ENOENT' });
});

test('updatePreferences merges settings and persists the result', async (t) => {
  const { storage } = await temporaryStorage(t);
  await storage.savePreferences({ zoomPercent: 100, launchAtStartup: false });
  const updated = await storage.updatePreferences({ zoomPercent: 125 });
  assert.deepEqual(updated, { zoomPercent: 125, launchAtStartup: false });
  assert.deepEqual(await storage.loadPreferences(), updated);
});

test('accounts are isolated and compatibility methods follow the active owner', async (t) => {
  const { directory, storage } = await temporaryStorage(t);
  await storage.saveAccount('alice', { workspace: workspace('Alice'), base: null, lastSyncTime: 10 });
  await storage.saveAccount('../../bob', { workspace: workspace('Bob') });

  assert.equal((await storage.loadAccount('alice')).workspace.tasks[0].title, 'Alice');
  assert.equal((await storage.loadAccount('../../bob')).workspace.tasks[0].title, 'Bob');
  await storage.setActiveOwner('alice');
  assert.equal(await storage.getActiveOwner(), 'alice');
  assert.equal((await storage.loadWorkspace()).tasks[0].title, 'Alice');
  await storage.saveWorkspace(workspace('Alice updated'));
  assert.equal((await storage.loadAccount('alice')).workspace.tasks[0].title, 'Alice updated');
  assert.equal((await storage.loadAccount('../../bob')).workspace.tasks[0].title, 'Bob');
  assert.deepEqual((await fs.readdir(directory)).sort(), ['workspace.json']);
});

test('recovery points preserve a restorable workspace per account', async (t) => {
  const { storage } = await temporaryStorage(t);
  await storage.saveAccount('alice', { workspace: workspace('Current') });
  await storage.createRecoveryPoint('alice');
  await storage.saveAccount('alice', { ...(await storage.loadAccount('alice')), workspace: workspace('Changed') });
  const account = await storage.loadAccount('alice');
  assert.equal(account.workspace.tasks[0].title, 'Changed');
  assert.equal(account.recovery.tasks[0].title, 'Current');
  await assert.rejects(storage.createRecoveryPoint('missing'), { code: 'ACCOUNT_NOT_FOUND' });
});

test('partial account saves preserve recovery and last sync metadata', async (t) => {
  const { storage } = await temporaryStorage(t);
  await storage.saveAccount('alice', {
    workspace: workspace('Before'),
    base: workspace('Acknowledged'),
    recovery: workspace('Recovery'),
    lastSyncTime: 1234,
  });

  await storage.saveAccount('alice', { workspace: workspace('After') });

  const account = await storage.loadAccount('alice');
  assert.equal(account.workspace.tasks[0].title, 'After');
  assert.equal(account.recovery.tasks[0].title, 'Recovery');
  assert.equal(account.lastSyncTime, 1234);
});

test('legacy account snapshots migrate owner, base and recovery without cross-account loss', async (t) => {
  const { storage } = await temporaryStorage(t);
  const result = await storage.importLegacySnapshot({
    karkas_workspace_owner: 'alice',
    karkas_last_sync_time: '1234',
    'karkas_workspace:alice': JSON.stringify({ workspace: workspace('Alice'), base: workspace('Alice base') }),
    'karkas_workspace:alice:before-restore': JSON.stringify(workspace('Alice recovery')),
    'karkas_workspace:bob': JSON.stringify({ workspace: workspace('Bob'), base: null }),
  });
  assert.equal(result.imported, true);
  assert.equal(await storage.getActiveOwner(), 'alice');
  assert.equal((await storage.loadAccount('alice')).base.tasks[0].title, 'Alice base');
  assert.equal((await storage.loadAccount('alice')).lastSyncTime, 1234);
  assert.equal((await storage.loadAccount('alice')).recovery.tasks[0].title, 'Alice recovery');
  assert.equal((await storage.loadAccount('bob')).workspace.tasks[0].title, 'Bob');

  const ignored = await storage.importLegacySnapshot({
    'karkas_workspace:alice': JSON.stringify({ workspace: workspace('Overwrite attempt') }),
  });
  assert.equal(ignored.imported, false);
  assert.equal((await storage.loadAccount('alice')).workspace.tasks[0].title, 'Alice');
});

test('staged sync survives storage restart and can be claimed afterwards', async (t) => {
  const { directory, storage } = await temporaryStorage(t);
  await storage.saveAccount('alice', { workspace: workspace('Initial') });

  const staged = await storage.stageSync('alice', {
    workspace: workspace('Offline edit'),
    base: workspace('Initial'),
  });

  const restarted = createDesktopStorage({ userDataPath: directory });
  const persisted = await restarted.loadAccount('alice');
  assert.equal(persisted.pendingSync.mutationId, staged.mutationId);
  assert.equal(persisted.pendingSync.workspace.tasks[0].title, 'Offline edit');

  const claimed = await restarted.claimSync('alice');
  assert.equal(claimed.mutationId, staged.mutationId);
  assert.equal((await restarted.loadAccount('alice')).pendingSync, undefined);
  assert.equal((await restarted.loadAccount('alice')).inFlightSync.mutationId, staged.mutationId);
});

test('failed sync retries keep the same mutation id and increment attempts', async (t) => {
  const { storage } = await temporaryStorage(t);
  await storage.saveAccount('alice', { workspace: workspace('Initial') });
  const staged = await storage.stageSync('alice', { workspace: workspace('Edit A'), base: workspace('Initial') });
  const firstClaim = await storage.claimSync('alice');
  assert.equal(firstClaim.mutationId, staged.mutationId);

  const failed = await storage.markSyncFailed('alice', firstClaim.mutationId, 'offline');
  assert.equal(failed.mutationId, staged.mutationId);
  assert.equal(failed.attempts, 1);
  assert.equal(failed.lastError, 'offline');
  assert.ok(failed.nextAttemptAt > Date.now());
  assert.equal(await storage.claimSync('alice'), null, 'normal claim must respect retry backoff');

  const retry = await storage.claimSync('alice', true);
  assert.equal(retry.mutationId, staged.mutationId);
  assert.equal(retry.attempts, 1);
});

test('acknowledging A rebases staged B without clearing it', async (t) => {
  const { storage } = await temporaryStorage(t);
  await storage.saveAccount('alice', { workspace: workspace('Initial'), base: workspace('Initial') });
  const mutationA = await storage.stageSync('alice', { workspace: workspace('Edit A'), base: workspace('Initial') });
  await storage.claimSync('alice');
  const mutationB = await storage.stageSync('alice', { workspace: workspace('Edit B'), base: workspace('Initial') });
  assert.notEqual(mutationB.mutationId, mutationA.mutationId);

  const acknowledgedBase = workspace('Cloud after A');
  const remaining = await storage.acknowledgeSync('alice', mutationA.mutationId, {
    base: acknowledgedBase,
    lastSyncTime: 1234,
  });

  assert.equal(remaining.acknowledged, true);
  assert.equal(remaining.pending.mutationId, mutationB.mutationId);
  assert.equal(remaining.pending.workspace.tasks[0].title, 'Edit B');
  assert.equal(remaining.pending.base.tasks[0].title, 'Cloud after A');
  const account = await storage.loadAccount('alice');
  assert.equal(account.inFlightSync, undefined);
  assert.equal(account.pendingSync.mutationId, mutationB.mutationId);
  assert.equal(account.workspace.tasks[0].title, 'Edit B');
  assert.equal(account.base.tasks[0].title, 'Cloud after A');
  assert.equal(account.lastSyncTime, 1234);
});

test('stale acknowledgement cannot mutate base or clear a newer in-flight mutation', async (t) => {
  const { storage } = await temporaryStorage(t);
  await storage.saveAccount('alice', { workspace: workspace('Initial'), base: workspace('Initial') });
  const mutationA = await storage.stageSync('alice', { workspace: workspace('Edit A'), base: workspace('Initial') });
  await storage.claimSync('alice');
  await storage.acknowledgeSync('alice', mutationA.mutationId, {
    base: workspace('Cloud after A'),
    lastSyncTime: 100,
  });
  const mutationB = await storage.stageSync('alice', { workspace: workspace('Edit B'), base: workspace('Cloud after A') });
  await storage.claimSync('alice');

  const result = await storage.acknowledgeSync('alice', mutationA.mutationId, {
    base: workspace('Stale cloud state'),
    lastSyncTime: 999,
  });

  assert.equal(result.acknowledged, false);
  const account = await storage.loadAccount('alice');
  assert.equal(account.inFlightSync.mutationId, mutationB.mutationId);
  assert.equal(account.base.tasks[0].title, 'Cloud after A');
  assert.equal(account.lastSyncTime, 100);
});

test('sync queues and retry backoff are isolated per account and persist across restart', async (t) => {
  const { directory, storage } = await temporaryStorage(t);
  await storage.saveAccount('alice', { workspace: workspace('Alice initial') });
  await storage.saveAccount('bob', { workspace: workspace('Bob initial') });
  const aliceMutation = await storage.stageSync('alice', { workspace: workspace('Alice edit'), base: null });
  const bobMutation = await storage.stageSync('bob', { workspace: workspace('Bob edit'), base: null });
  await storage.claimSync('alice');
  const failedAlice = await storage.markSyncFailed('alice', aliceMutation.mutationId, 'network unavailable');

  const restarted = createDesktopStorage({ userDataPath: directory });
  assert.equal(await restarted.claimSync('alice'), null, 'Alice backoff must survive restart');
  const claimedBob = await restarted.claimSync('bob');
  assert.equal(claimedBob.mutationId, bobMutation.mutationId);
  assert.equal(claimedBob.attempts, 0);

  const aliceAccount = await restarted.loadAccount('alice');
  const bobAccount = await restarted.loadAccount('bob');
  assert.equal(aliceAccount.inFlightSync.mutationId, aliceMutation.mutationId);
  assert.equal(aliceAccount.inFlightSync.attempts, 1);
  assert.equal(aliceAccount.inFlightSync.nextAttemptAt, failedAlice.nextAttemptAt);
  assert.equal(bobAccount.inFlightSync.mutationId, bobMutation.mutationId);
  assert.notEqual(aliceAccount.syncClientId, bobAccount.syncClientId);
});

test('explicit cloud restore atomically replaces workspace and clears stale sync queues', async (t) => {
  const { storage } = await temporaryStorage(t);
  await storage.saveAccount('alice', { workspace: workspace('Initial'), base: workspace('Initial') });
  await storage.stageSync('alice', { workspace: workspace('Edit A'), base: workspace('Initial') });
  await storage.claimSync('alice');
  await storage.stageSync('alice', { workspace: workspace('Edit B'), base: workspace('Initial') });

  await storage.replaceWithCloud('alice', workspace('Cloud truth'), 4321);

  const account = await storage.loadAccount('alice');
  assert.equal(account.workspace.tasks[0].title, 'Cloud truth');
  assert.equal(account.base.tasks[0].title, 'Cloud truth');
  assert.equal(account.lastSyncTime, 4321);
  assert.equal(account.pendingSync, undefined);
  assert.equal(account.inFlightSync, undefined);
  assert.equal(await storage.claimSync('alice', true), null);
});

test('malformed persisted sync identities are rejected without rewriting the account store', async (t) => {
  const { storage } = await temporaryStorage(t);
  const invalid = {
    workspace: workspace('Local'),
    syncClientId: 'desktop-valid',
    nextSyncSequence: 3,
    pendingSync: {
      mutationId: 'different-client:99',
      clientId: 'desktop-valid',
      sequence: 3,
      createdAt: 1,
      attempts: 0,
      nextAttemptAt: 1,
      workspace: workspace('Queued'),
      base: workspace('Local'),
    },
  };

  await assert.rejects(storage.saveAccount('alice', invalid), { code: 'INVALID_DATA' });
  assert.equal(await storage.loadAccount('alice'), null);
});

test('field-level sync operations persist with the durable mutation and reject id rewrites', async (t) => {
  const { storage } = await temporaryStorage(t);
  await storage.saveAccount('alice', { workspace: workspace('Initial'), base: workspace('Initial') });
  const operations = [{ kind: 'task', id: 'task-a', patch: { title: 'Offline edit' } }];
  const staged = await storage.stageSync('alice', {
    workspace: workspace('Offline edit'),
    base: workspace('Initial'),
    operations,
  });
  assert.deepEqual(staged.operations, operations);
  assert.deepEqual((await storage.loadAccount('alice')).pendingSync.operations, operations);

  await assert.rejects(storage.stageSync('alice', {
    workspace: workspace('Invalid'),
    base: workspace('Initial'),
    operations: [{ kind: 'task', id: 'task-a', patch: { id: 'task-b' } }],
  }), { code: 'INVALID_DATA' });
});

test('schema v1 workspace remains readable and upgrades to the account store on next save', async (t) => {
  const { storage } = await temporaryStorage(t);
  const legacyWorkspace = workspace('Schema v1 task');
  await fs.writeFile(storage.paths.workspace, JSON.stringify({
    schemaVersion: 1,
    kind: 'workspace',
    updatedAt: 100,
    data: legacyWorkspace,
  }), 'utf8');

  assert.deepEqual(await storage.loadWorkspace(), legacyWorkspace);
  assert.deepEqual((await storage.loadAccount(null)).workspace, legacyWorkspace);

  await storage.saveWorkspace(workspace('Edited after migration'));
  const upgraded = JSON.parse(await fs.readFile(storage.paths.workspace, 'utf8'));
  assert.equal(upgraded.schemaVersion, SCHEMA_VERSION);
  assert.equal(upgraded.data.activeOwner, null);
  assert.equal(upgraded.data.accounts.$guest.workspace.tasks[0].title, 'Edited after migration');
});

test('unknown future workspace schema is rejected without rewriting its data', async (t) => {
  const { storage } = await temporaryStorage(t);
  const futureEnvelope = JSON.stringify({
    schemaVersion: SCHEMA_VERSION + 1,
    kind: 'workspace',
    updatedAt: 100,
    data: workspace('Future data'),
  });
  await fs.writeFile(storage.paths.workspace, futureEnvelope, 'utf8');

  await assert.rejects(storage.loadWorkspace(), { code: 'UNSUPPORTED_SCHEMA' });
  assert.equal(await fs.readFile(storage.paths.workspace, 'utf8'), futureEnvelope);
});
