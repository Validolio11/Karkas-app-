import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NotepadNote, PSTask } from '../types';
import type { WorkspaceState } from './syncState';
import { applyWorkspaceMutation, diffWorkspaceMutation } from './syncOperations';
import { appendNotepadOperation, loadNotepadJournal, notesOperationPrefix, ownedNotesKey } from './notepadStorage';
import { clearPersonalStrategy, createPersonalStrategyProfile, personalStrategyKey, readPersonalStrategy, savePersonalStrategy } from './personalStrategy';
import { completeWorkspaceTabTransaction, recoverWorkspaceTabTransaction, stageWorkspaceTabTransaction, workspaceTabTransactionKey } from './workspaceTabTransaction';
import { continueStrategyDiscovery, DISCOVERY_MODE_QUESTION_ID } from './strategyDiscovery';
import { remapWorkspaceTabs } from './workspaceTabs';

const store = () => {
  const values = new Map<string, string>();
  return { values, get length() { return values.size; }, key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
};
const note: NotepadNote = { id: 'n', title: 'Original', content: 'Keep', createdAt: 1 };

test('independent browser note writes survive, and concurrent text edits retain both versions', () => {
  const disk = store();
  disk.setItem(ownedNotesKey(null), JSON.stringify([note]));
  appendNotepadOperation(disk, null, { id: 'a', clock: 1, noteId: 'n', before: note, after: { ...note, content: 'Tab A' } });
  appendNotepadOperation(disk, null, { id: 'b', clock: 1, noteId: 'n', before: note, after: { ...note, content: 'Tab B' } });
  const another = { ...note, id: 'other', content: 'New note' };
  appendNotepadOperation(disk, null, { id: 'c', clock: 1, noteId: 'other', before: null, after: another });
  assert.deepEqual(new Set(loadNotepadJournal(disk, null, []).notes.map(value => value.content)), new Set(['Tab A', 'Tab B', 'New note']));
  assert.equal(loadNotepadJournal(disk, 'different-owner', []).notes.length, 0);
});

test('stale note deletion cannot erase a concurrent edit', () => {
  const disk = store();
  disk.setItem(ownedNotesKey(null), JSON.stringify([note]));
  appendNotepadOperation(disk, null, { id: 'a', clock: 1, noteId: 'n', before: note, after: { ...note, content: 'New text' } });
  appendNotepadOperation(disk, null, { id: 'b', clock: 1, noteId: 'n', before: note, after: null });
  assert.equal(loadNotepadJournal(disk, null, []).notes[0].content, 'New text');
});

test('sequential note edit/delete replay causally, and malformed journals block writes without replacing bytes', () => {
  const disk = store();
  disk.setItem(ownedNotesKey(null), JSON.stringify([note]));
  const edited = { ...note, content: 'Changed' };
  appendNotepadOperation(disk, null, { id: 'z-edit', clock: 1, noteId: 'n', before: note, after: edited });
  appendNotepadOperation(disk, null, { id: 'a-delete', clock: 2, noteId: 'n', before: edited, after: null });
  assert.deepEqual(loadNotepadJournal(disk, null, []).notes, []);
  const brokenKey = notesOperationPrefix(null) + 'broken';
  disk.setItem(brokenKey, '{broken');
  assert.equal(loadNotepadJournal(disk, null, []).canPersist, false);
  assert.equal(disk.getItem(brokenKey), '{broken');
});

test('malformed strategy is backed up; failed backup blocks both save and clear', () => {
  const disk = store();
  const key = personalStrategyKey(null);
  disk.setItem(key, '{broken');
  readPersonalStrategy(disk, null);
  assert.equal(disk.getItem(key + ':recovery-backup'), '{broken');
  assert.equal(savePersonalStrategy(disk, null, createPersonalStrategyProfile()), true);
  disk.setItem(key, '{different');
  const denied = { ...disk, setItem: (name: string, value: string) => {
    if (name.includes(':recovery-backup')) throw new Error('Quota');
    disk.setItem(name, value);
  } };
  assert.equal(savePersonalStrategy(denied, null, createPersonalStrategyProfile()), false);
  assert.equal(clearPersonalStrategy(denied, null), false);
  assert.equal(disk.getItem(key), '{different');
});

test('valid strategy version with malformed members also retains its original bytes', () => {
  const disk = store();
  const key = personalStrategyKey(null);
  const raw = JSON.stringify({ ...createPersonalStrategyProfile(), goals: [{ id: 'lost', title: 42 }], facts: 'broken' });
  disk.setItem(key, raw);
  readPersonalStrategy(disk, null);
  assert.equal(disk.getItem(key + ':recovery-backup'), raw);
  assert.equal(savePersonalStrategy(disk, null, createPersonalStrategyProfile()), true);
});

test('explicit discovery question id survives strategy storage and paired tab journal recovery', () => {
  const disk = store();
  const profile = continueStrategyDiscovery(createPersonalStrategyProfile(), 'uk', 1791961200000);
  assert.equal(DISCOVERY_MODE_QUESTION_ID.test(profile.discovery!.pendingQuestion!.id), true);
  assert.equal(savePersonalStrategy(disk, null, profile), true);
  const loaded = readPersonalStrategy(disk, null);
  assert.equal(loaded.discovery!.pendingQuestion!.id, profile.discovery!.pendingQuestion!.id);
  const workspace: WorkspaceState = { tasks: [], deletedTasks: [], tabs: [{ id: 'work', name: 'Work' }],
    settings: { soundEnabled: true, fireEnabled: true, lang: 'uk', aiIconVariant: 'quantum' } };
  const changed = { ...workspace, tabs: [{ id: 'home', name: 'Home' }] };
  assert.equal(stageWorkspaceTabTransaction(disk, null, workspace, changed, loaded, loaded), true);
  const recovered = recoverWorkspaceTabTransaction(disk, null, workspace, loaded);
  assert.equal(recovered.status, 'recovered');
  assert.equal(recovered.profile.discovery!.pendingQuestion!.id, loaded.discovery!.pendingQuestion!.id);
});

test('offline delete and restore cannot recreate an incomplete remotely purged task', () => {
  const task: PSTask = { id: 't', title: 'Task', phase: 'work', priority: 2, steps: 0, currentStep: 0, done: false, pinned: false, createdAt: 1 };
  const base: WorkspaceState = { tasks: [task], deletedTasks: [], tabs: [{ id: 'work', name: 'Work' }],
    settings: { soundEnabled: true, fireEnabled: true, lang: 'uk', aiIconVariant: 'quantum' } };
  const deleted = { ...base, tasks: [], deletedTasks: [{ ...task, deletedAt: 2 }] };
  const purged = { ...base, tasks: [], deletedTasks: [] };
  for (const [before, after] of [[base, deleted], [deleted, base]] as const) {
    const merged = applyWorkspaceMutation(purged, diffWorkspaceMutation(before, after, { clientId: 'client-a', sequence: 1 }));
    assert.deepEqual(merged.tasks, []);
    assert.deepEqual(merged.deletedTasks, []);
  }
  const created = applyWorkspaceMutation(purged, diffWorkspaceMutation(purged, base, { clientId: 'client-a', sequence: 2 }));
  assert.deepEqual(created.tasks, [task]);
});

test('tab transaction recovers partial paired commits and retains conflicts or failed durable saves', async () => {
  const disk = store();
  const profile = createPersonalStrategyProfile();
  const before: WorkspaceState = { tasks: [], deletedTasks: [], tabs: [{ id: 'work', name: 'Work' }],
    settings: { soundEnabled: true, fireEnabled: true, lang: 'uk', aiIconVariant: 'quantum' } };
  const after = { ...before, tabs: [{ id: 'home', name: 'Home' }] };
  const afterProfile = { ...profile, goals: [{ id: 'goal', title: 'Goal', motive: '', agreed: false, taskIds: [], categoryIds: ['home'] }] };
  assert.equal(stageWorkspaceTabTransaction(disk, null, before, after, profile, afterProfile), true);
  const raw = disk.getItem(workspaceTabTransactionKey(null));
  assert.equal(stageWorkspaceTabTransaction(disk, null, after, before, afterProfile, profile), false);
  assert.equal(recoverWorkspaceTabTransaction(disk, null, before, afterProfile).status, 'recovered');
  assert.equal(recoverWorkspaceTabTransaction(disk, null, { ...before, tabs: [{ id: 'new', name: 'New' }] }, profile).status, 'conflict');
  assert.equal(await completeWorkspaceTabTransaction(disk, null, raw, Promise.resolve(false), () => true), false);
  assert.equal(disk.getItem(workspaceTabTransactionKey(null)), raw);
  assert.equal(await completeWorkspaceTabTransaction(disk, null, raw, Promise.resolve(true), () => false), false);
  assert.equal(await completeWorkspaceTabTransaction(disk, null, raw, Promise.resolve(true), () => true), true);
});

test('explicit tab destinations survive paired persistence for tasks, history and goal scopes', () => {
  const disk = store();
  const task: PSTask = { id: 'task', title: 'Keep', phase: 'old-work', priority: 2, steps: 0, currentStep: 0,
    done: true, pinned: false, createdAt: 1, completedAt: 2 };
  const workspace: WorkspaceState = { tasks: [task], deletedTasks: [{ ...task, id: 'history', phase: 'old-home', deletedAt: 3 }],
    tabs: [{ id: 'old-work', name: 'Work' }, { id: 'old-home', name: 'Home' }],
    settings: { soundEnabled: true, fireEnabled: true, lang: 'uk', aiIconVariant: 'quantum' } };
  const profile = { ...createPersonalStrategyProfile(), goals: [{ id: 'g', title: 'Goal', motive: '', agreed: true,
    taskIds: ['task', 'history'], categoryIds: ['old-work', 'old-home'] }] };
  const result = remapWorkspaceTabs(workspace, profile, [{ id: 'fallback', name: 'Fallback' }, { id: 'focus', name: 'Focus' }],
    { 'old-work': 'focus', 'old-home': 'focus' })!;
  assert.equal(stageWorkspaceTabTransaction(disk, null, workspace, result.workspace, profile, result.profile), true);
  const recovered = recoverWorkspaceTabTransaction(disk, null, result.workspace, profile);
  assert.equal(recovered.status, 'recovered');
  assert.equal(recovered.workspace.tasks[0].phase, 'focus');
  assert.equal(recovered.workspace.deletedTasks[0].phase, 'focus');
  assert.equal(recovered.workspace.deletedTasks[0].completedAt, 2);
  assert.deepEqual(recovered.profile.goals[0].categoryIds, ['focus']);
  assert.deepEqual(recovered.profile.goals[0].taskIds, ['task', 'history']);
  assert.equal(recovered.profile.goals[0].agreed, true);
});
