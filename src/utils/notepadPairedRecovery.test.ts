import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NotepadNote } from '../types';
import type { WorkspaceState } from './syncState';
import { appendNotepadOperation, applyNotepadBatch, isNotepadBatchOperation, loadNotepadJournal, notesOperationPrefix, prepareNotepadReplacement } from './notepadStorage';
import { createPersonalStrategyProfile } from './personalStrategy';
import { completeWorkspaceTabTransaction, recoverWorkspaceTabTransaction, stageWorkspaceTabTransaction, workspaceTabTransactionKey } from './workspaceTabTransaction';

const memory = () => {
  const values = new Map<string, string>();
  return { values, get length() { return values.size; }, key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
};
const owner = 'paired-owner';
const original: NotepadNote = { id: 'source', title: '', content: 'Original source', createdAt: 1 };
const changed = { ...original, content: 'Changed source', updatedAt: 2 };
const workspace: WorkspaceState = { tasks: [], deletedTasks: [], tabs: [{ id: 'work', name: 'Work' }],
  settings: { soundEnabled: true, fireEnabled: true, lang: 'uk', aiIconVariant: 'quantum' } };
const profile = createPersonalStrategyProfile();
const afterWorkspace = { ...workspace, tabs: [{ id: 'work', name: 'Renamed work' }] };

for (const interruptedAt of ['before-notes', 'after-notes', 'after-workspace'] as const) test(`paired recovery resumes ${interruptedAt} exactly once`, async () => {
  const disk = memory();
  loadNotepadJournal(disk, owner, [original]);
  const operation = prepareNotepadReplacement(disk, owner, [original], [changed])!;
  assert.equal(isNotepadBatchOperation(operation), true);
  assert.equal(stageWorkspaceTabTransaction(disk, owner, workspace, afterWorkspace, profile, profile, operation), true);
  const raw = disk.getItem(workspaceTabTransactionKey(owner));
  if (interruptedAt !== 'before-notes') assert.equal(applyNotepadBatch(disk, owner, operation), true);
  const recovered = recoverWorkspaceTabTransaction(disk, owner, interruptedAt === 'after-workspace' ? afterWorkspace : workspace, profile);
  assert.equal(recovered.status, 'recovered');
  assert.deepEqual(recovered.workspace, afterWorkspace);
  assert.deepEqual(loadNotepadJournal(disk, owner, []).notes, [changed]);
  assert.equal(recoverWorkspaceTabTransaction(disk, owner, afterWorkspace, profile).status, 'recovered');
  assert.equal([...disk.values.keys()].filter(key => key.startsWith(notesOperationPrefix(owner))).length, 1);
  assert.equal(await completeWorkspaceTabTransaction(disk, owner, raw, Promise.resolve(false), () => true), false);
  assert.equal(disk.getItem(workspaceTabTransactionKey(owner)), raw);
  assert.equal(await completeWorkspaceTabTransaction(disk, owner, raw, Promise.resolve(true), () => false), false);
  assert.equal(await completeWorkspaceTabTransaction(disk, owner, raw, Promise.resolve(true), () => true), true);
  assert.equal(disk.getItem(workspaceTabTransactionKey(owner)), null);
});

test('a newer note edit blocks paired recovery without overwriting either half', async () => {
  const disk = memory();
  loadNotepadJournal(disk, owner, [original]);
  const operation = prepareNotepadReplacement(disk, owner, [original], [changed])!;
  assert.equal(stageWorkspaceTabTransaction(disk, owner, workspace, afterWorkspace, profile, profile, operation), true);
  assert.equal(applyNotepadBatch(disk, owner, operation), true);
  const newer = { ...changed, content: 'Typed after the agent turn', updatedAt: 3 };
  appendNotepadOperation(disk, owner, { id: 'newer-edit', clock: operation.clock + 1, noteId: original.id, before: changed, after: newer });
  const raw = disk.getItem(workspaceTabTransactionKey(owner));
  const recovered = recoverWorkspaceTabTransaction(disk, owner, workspace, profile);
  assert.equal(recovered.status, 'conflict');
  assert.deepEqual(recovered.conflictParts, ['notes']);
  assert.deepEqual(recovered.workspace, workspace);
  assert.equal(await completeWorkspaceTabTransaction(disk, owner, raw, Promise.resolve(true), () => true), false);
  assert.deepEqual(loadNotepadJournal(disk, owner, []).notes, [newer]);
  assert.equal(disk.getItem(workspaceTabTransactionKey(owner)), raw);
});

test('purging a staged source blocks replay and stale restore snapshots cannot resurrect it', () => {
  const disk = memory();
  loadNotepadJournal(disk, owner, [original]);
  const operation = prepareNotepadReplacement(disk, owner, [original], [changed])!;
  assert.equal(stageWorkspaceTabTransaction(disk, owner, workspace, afterWorkspace, profile, profile, operation), true);
  const deleted = { ...original, deletedAt: 10, undoUntil: 8010, updatedAt: 10 };
  appendNotepadOperation(disk, owner, { id: 'delete', clock: operation.clock, noteId: original.id, before: original, after: deleted });
  appendNotepadOperation(disk, owner, { id: 'purge', clock: operation.clock + 1, noteId: original.id, before: deleted, after: null });
  assert.equal(applyNotepadBatch(disk, owner, operation), false);
  assert.equal(recoverWorkspaceTabTransaction(disk, owner, workspace, profile).status, 'conflict');
  assert.throws(() => prepareNotepadReplacement(disk, owner, [], [original], { [original.id]: deleted }), /Notes changed/);
  assert.deepEqual(loadNotepadJournal(disk, owner, []).notes, []);
});

test('failed paired note writes retain the staged journal, and unrelated newer growth prevents all replay', () => {
  const disk = memory();
  loadNotepadJournal(disk, owner, [original]);
  const operation = prepareNotepadReplacement(disk, owner, [original], [])!;
  assert.equal(operation.changes[0].after?.deletedAt !== undefined, true);
  assert.equal(operation.changes[0].after!.undoUntil! - operation.changes[0].after!.deletedAt!, 8000);
  assert.equal(stageWorkspaceTabTransaction(disk, owner, workspace, afterWorkspace, profile, profile, operation), true);
  const raw = disk.getItem(workspaceTabTransactionKey(owner));
  const write = disk.setItem;
  disk.setItem = (key, value) => { if (key.startsWith(notesOperationPrefix(owner))) throw new Error('Quota'); write(key, value); };
  assert.equal(recoverWorkspaceTabTransaction(disk, owner, workspace, profile).status, 'conflict');
  assert.deepEqual(loadNotepadJournal(disk, owner, []).notes, [original]);
  assert.equal(disk.getItem(workspaceTabTransactionKey(owner)), raw);
  disk.setItem = write;
  const concurrent = { ...workspace, skills: [] };
  const recovered = recoverWorkspaceTabTransaction(disk, owner, concurrent, profile);
  assert.equal(recovered.status, 'conflict');
  assert.deepEqual(recovered.conflictParts, ['skills']);
  assert.deepEqual(recovered.workspace, concurrent);
  assert.deepEqual(loadNotepadJournal(disk, owner, []).notes, [original]);
});
