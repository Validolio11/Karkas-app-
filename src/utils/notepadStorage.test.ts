import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NotepadNote } from '../types';
import { loadNotepadNotes, restoreNotepadNote } from './notepadStorage';

const key = 'notes';
const note: NotepadNote = {
  id: 'note-1', title: 'A note', content: 'Keep me', createdAt: 100,
  updatedAt: 200, pinned: true, color: '#38bdf8',
};
const memoryStorage = (initial?: string) => {
  const values = new Map<string, string>(initial === undefined ? [] : [[key, initial]]);
  return {
    values,
    getItem: (name: string) => values.get(name) ?? null,
    setItem: (name: string, value: string) => { values.set(name, value); },
  };
};

test('valid notes and intentionally empty notebooks survive loading unchanged', () => {
  for (const notes of [[note], []]) {
    const storage = memoryStorage(JSON.stringify(notes));
    assert.deepEqual(loadNotepadNotes(storage, key, [note]), { notes, canPersist: true, recovered: false });
    assert.equal(storage.values.size, 1);
  }
  assert.deepEqual(loadNotepadNotes(memoryStorage(), key, [note]).notes, [note]);
});

test('damaged and duplicate records are backed up while valid notes are recovered', () => {
  const raw = JSON.stringify([
    note, null, {}, { ...note, content: 'duplicate' },
    { ...note, id: 'invalid-title', title: 3 },
    { ...note, id: 'invalid-time', createdAt: 9e15 },
    { ...note, id: 'invalid-pin', pinned: 'yes' },
    { ...note, id: 'invalid-color', color: {} },
    { ...note, id: 'invalid-updated', updatedAt: 'yesterday' },
  ]);
  const storage = memoryStorage(raw);
  assert.deepEqual(loadNotepadNotes(storage, key, []), { notes: [note], canPersist: true, recovered: true });
  assert.equal(storage.getItem(`${key}:recovery-backup`), raw);
  assert.equal(storage.getItem(key), raw);
});

test('invalid JSON and non-array storage preserve exact raw data before fallback', () => {
  for (const raw of ['{broken', '', '{}', 'null']) {
    const storage = memoryStorage(raw);
    assert.deepEqual(loadNotepadNotes(storage, key, [note]), { notes: [note], canPersist: true, recovered: true });
    assert.equal(storage.getItem(`${key}:recovery-backup`), raw);
  }
});

test('failed backup blocks persistence and leaves damaged originals untouched', () => {
  const raw = JSON.stringify([note, null]);
  const storage = memoryStorage(raw);
  storage.setItem = () => { throw new Error('Quota exceeded'); };
  const loaded = loadNotepadNotes(storage, key, []);
  assert.deepEqual(loaded.notes, [note]);
  assert.equal(loaded.canPersist, false);
  assert.ok(loaded.error);
  assert.equal(storage.getItem(key), raw);
});

test('unreadable storage blocks persistence instead of replacing existing data', () => {
  const storage = memoryStorage();
  storage.getItem = () => { throw new Error('Access denied'); };
  const loaded = loadNotepadNotes(storage, key, [note]);
  assert.equal(loaded.canPersist, false);
  assert.deepEqual(loaded.notes, [note]);
  assert.ok(loaded.error);
});

test('repeated recovery retains older backups and reuses identical backup safely', () => {
  const storage = memoryStorage('damaged-one');
  loadNotepadNotes(storage, key, []);
  loadNotepadNotes(storage, key, []);
  assert.equal(storage.values.size, 2);
  storage.setItem(key, 'damaged-two');
  loadNotepadNotes(storage, key, []);
  assert.equal(storage.getItem(`${key}:recovery-backup`), 'damaged-one');
  assert.equal(storage.getItem(`${key}:recovery-backup:1`), 'damaged-two');
});

test('undo restores identity, timestamps and fields without duplicating existing notes', () => {
  const other = { ...note, id: 'note-2', createdAt: 300 };
  const original = [other];
  const restored = restoreNotepadNote(original, note);
  assert.deepEqual(restored, [note, other]);
  assert.deepEqual(original, [other]);
  assert.equal(restored[0], note);
  assert.equal(restoreNotepadNote(restored, { ...note, content: 'stale copy' }), restored);
});
