import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadNotepadDrafts, noteDraftBase, noteDraftMatches, type NotepadDrafts } from './notepadDrafts';

const storage = () => {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
};
const ownerKey = (owner: string) => `karkas_notepad_drafts_v1:${encodeURIComponent(`account:${owner}`)}`;

test('damaged draft recovery retains recoverable text and exact original bytes separately from saved notes', () => {
  const store = storage();
  const owner = 'edge-damaged-draft';
  const raw = JSON.stringify({ version: 99, composer: { title: 'Unsaved', content: 'Keep this text', color: 42 }, edit: null });
  const savedNotes = '[{"id":"saved-note","title":"Existing saved note"}]';
  store.setItem(ownerKey(owner), raw);
  store.setItem('karkas_notepad_notes_v1', savedNotes);
  const recovered = loadNotepadDrafts(store, owner);
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.canPersist, true);
  assert.equal(recovered.drafts.composer?.content, 'Keep this text');
  assert.equal(store.getItem(`${ownerKey(owner)}:recovery-backup`), raw);
  assert.equal(store.getItem(ownerKey(owner)), raw, 'loading must never overwrite the damaged source');
  assert.equal(store.getItem('karkas_notepad_notes_v1'), savedNotes);
});

test('draft recovery backup failure blocks persistence while retaining recovered text and source', () => {
  const store = storage();
  const owner = 'edge-blocked-draft';
  const raw = JSON.stringify({ version: 2, composer: { title: 'Unsaved', content: 'Keep despite disk failure', color: '#fff' }, edit: null });
  store.setItem(ownerKey(owner), raw);
  store.setItem('karkas_notepad_drafts_v1:migration-owner', `account:${owner}`);
  store.setItem = () => { throw new Error('Disk full'); };
  const recovered = loadNotepadDrafts(store, owner);
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.canPersist, false);
  assert.equal(recovered.drafts.composer?.content, 'Keep despite disk failure');
  assert.equal(store.getItem(ownerKey(owner)), raw);
});

test('a persisted note edit remains valid only against its original note snapshot', () => {
  const store = storage();
  const owner = 'edge-stale-edit';
  const original = { id: 'n', title: 'Original', content: 'First content', color: '#fff', createdAt: 1, updatedAt: 2 };
  const drafts: NotepadDrafts = { composer: null, edit: { title: 'Local edit', content: 'Uncommitted', color: '#fff', base: noteDraftBase(original) } };
  store.setItem(ownerKey(owner), JSON.stringify({ version: 1, ...drafts }));
  const loaded = loadNotepadDrafts(store, owner);
  const base = loaded.drafts.edit!.base;
  assert.equal(loaded.recovered, false);
  assert.equal(noteDraftMatches(base, original), true);
  for (const concurrent of [undefined, { ...original, updatedAt: 3 }, { ...original, content: 'Remote edit' },
    { ...original, createdAt: 3 }, { ...original, id: 'replacement' }]) {
    assert.equal(noteDraftMatches(base, concurrent), false, 'stale drafts must not overwrite a changed, replaced or deleted note');
  }
  assert.equal(loaded.drafts.edit!.content, 'Uncommitted', 'conflicting draft text stays available for manual recovery');
});
