import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NotepadNote } from '../types';
import { appendNotepadOperation, loadNotepadJournal, notesOperationPrefix } from './notepadStorage';

const note: NotepadNote = { id: 'n1', title: 'Нотатка', content: 'До', createdAt: 100 };
const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    values,
    get length() { return values.size; },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
};

test('one journal record persists an agent turn changing several notes and Undo reverses it', () => {
  const storage = memoryStorage();
  loadNotepadJournal(storage, 'owner', [note]);
  const updated = { ...note, content: 'Після', updatedAt: 200 };
  const created = { ...note, id: 'n2', title: 'Нова', createdAt: 300 };
  appendNotepadOperation(storage, 'owner', { id: 'turn', clock: 1, changes: [
    { noteId: note.id, before: note, after: updated },
    { noteId: created.id, before: null, after: created },
  ] });
  assert.equal([...storage.values.keys()].filter(key => key.startsWith(notesOperationPrefix('owner'))).length, 1);
  assert.deepEqual(loadNotepadJournal(storage, 'owner', []).notes, [created, updated]);
  appendNotepadOperation(storage, 'owner', { id: 'undo', clock: 2, changes: [
    { noteId: note.id, before: updated, after: note },
    { noteId: created.id, before: created, after: null },
  ] });
  assert.deepEqual(loadNotepadJournal(storage, 'owner', []).notes, [note]);
});

test('batch records coexist with existing single-note records and remain account scoped', () => {
  const storage = memoryStorage();
  loadNotepadJournal(storage, 'first', [note]);
  const edited = { ...note, content: 'Редаговано' };
  appendNotepadOperation(storage, 'first', { id: 'single', clock: 1, noteId: note.id, before: note, after: edited });
  appendNotepadOperation(storage, 'first', { id: 'batch', clock: 2,
    changes: [{ noteId: note.id, before: edited, after: { ...edited, title: 'Інша назва' } }] });
  assert.equal(loadNotepadJournal(storage, 'first', []).notes[0].title, 'Інша назва');
  assert.deepEqual(loadNotepadJournal(storage, 'second', []).notes, []);
});

test('malformed or duplicate batch changes block persistence while preserving the journal', () => {
  for (const changes of [[], [{ noteId: note.id, before: null, after: { ...note, id: 'wrong' } }],
    [{ noteId: note.id, before: null, after: note }, { noteId: note.id, before: note, after: null }]]) {
    const storage = memoryStorage();
    loadNotepadJournal(storage, null, [note]);
    const raw = JSON.stringify({ id: 'bad', clock: 1, changes });
    storage.setItem(notesOperationPrefix(null) + 'bad', raw);
    assert.equal(loadNotepadJournal(storage, null, []).canPersist, false);
    assert.equal(storage.getItem(notesOperationPrefix(null) + 'bad'), raw);
  }
});

test('failed atomic batch write leaves every note unchanged', () => {
  const storage = memoryStorage();
  loadNotepadJournal(storage, null, [note]);
  const originalWrite = storage.setItem;
  storage.setItem = (key, value) => {
    if (key.startsWith(notesOperationPrefix(null))) throw new Error('Quota');
    originalWrite(key, value);
  };
  assert.throws(() => appendNotepadOperation(storage, null, { id: 'turn', clock: 1,
    changes: [{ noteId: note.id, before: note, after: null }] }), /Quota/);
  assert.deepEqual(loadNotepadJournal(storage, null, []).notes, [note]);
});
