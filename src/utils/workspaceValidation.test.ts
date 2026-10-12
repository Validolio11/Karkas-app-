import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseWorkspace } from './workspaceValidation';
import { readLocalWorkspace, parseAccountRecord } from './localWorkspace';
import type { WorkspaceState } from './syncState';

const workspace = (): WorkspaceState => ({ tasks: [{ id: 'a', title: 'Keep', phase: 'work', priority: 2,
  steps: 0, currentStep: 0, done: false, pinned: false, createdAt: 0 }], deletedTasks: [],
  tabs: [{ id: 'work', name: 'Work' }], settings: { lang: 'uk', aiIconVariant: 'quantum', soundEnabled: true, fireEnabled: false } });
const keys = { tasks: 'tasks', deletedTasks: 'deleted', tabs: 'tabs' };
const storage = () => {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); } };
};

test('legacy valid tasks survive unchanged but malformed entities and duplicate identities are rejected', () => {
  const valid = workspace();
  assert.deepEqual(parseWorkspace(valid), valid);
  for (const patch of [{ title: null }, { timeSpentSeconds: -1 }, { priority: 7 }, { currentStep: 1 },
    { stepList: [null] }, { timeSessions: { bad: { seconds: '30' } } }]) {
    assert.throws(() => parseWorkspace({ ...valid, tasks: [{ ...valid.tasks[0], ...patch }] }));
  }
  assert.throws(() => parseWorkspace({ ...valid, tasks: [valid.tasks[0], valid.tasks[0]] }));
});

test('invalid local and account data preserve exact raw source before fallback or rejection', () => {
  const store = storage();
  const raw = JSON.stringify([{ id: 'bad', title: null }]);
  store.setItem(keys.tasks, raw);
  const result = readLocalWorkspace(store, keys, workspace().settings);
  assert.equal(result.recovered, true);
  assert.equal(result.canPersist, false);
  assert.equal(result.backupPreserved, true);
  assert.equal(store.getItem('tasks:recovery-backup'), raw);
  assert.equal(store.getItem('tasks'), raw);
  const accountRaw = JSON.stringify({ workspace: workspace(), base: { ...workspace(), tasks: [null] } });
  assert.throws(() => parseAccountRecord(accountRaw, store, 'account'));
  assert.equal(store.getItem('account:recovery-backup'), accountRaw);
});

test('backup failure blocks persistence instead of destroying malformed local tasks', () => {
  const store = storage();
  store.setItem('tasks', '[null]');
  store.setItem = () => { throw new Error('Quota'); };
  assert.equal(readLocalWorkspace(store, keys, workspace().settings).canPersist, false);
  assert.equal(store.getItem('tasks'), '[null]');
});

test('legacy category labels migrate without altering the original workspace and raw storage is backed up', () => {
  const original = { ...workspace(), tabs: [{ id: 'work', label: 'Work', color: '#fff' }] };
  const migrated = parseWorkspace(original);
  assert.deepEqual(migrated.tabs, [{ id: 'work', label: 'Work', name: 'Work', color: '#fff' }]);
  assert.equal('name' in original.tabs[0], false);
  const store = storage();
  store.setItem(keys.tasks, JSON.stringify(original.tasks));
  store.setItem(keys.tabs, JSON.stringify(original.tabs));
  const result = readLocalWorkspace(store, keys, original.settings);
  assert.equal(result.canPersist, true);
  assert.equal(result.workspace.tabs[0].name, 'Work');
  assert.equal(store.getItem('tabs:recovery-backup'), JSON.stringify(original.tabs));
  assert.equal(store.getItem(keys.tabs), JSON.stringify(original.tabs));
  const accountRaw = JSON.stringify({ workspace: original, base: original });
  const account = parseAccountRecord(accountRaw, store, 'account');
  assert.equal(account.workspace.tabs[0].name, 'Work');
  assert.equal(account.base.tabs[0].name, 'Work');
  assert.equal(store.getItem('account:recovery-backup'), accountRaw);
});
