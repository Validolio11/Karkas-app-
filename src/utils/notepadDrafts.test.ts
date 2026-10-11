import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadNotepadDrafts, saveNotepadDrafts, type NotepadDrafts } from './notepadDrafts';

const storage = () => {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
};
const draft: NotepadDrafts = { composer: { title: 'Private', content: 'My draft', color: '#fff' }, edit: null };

test('saved and failed in-memory drafts are isolated by owner including guest', () => {
  const store = storage();
  assert.equal(saveNotepadDrafts(store, draft, true, 'draft-account-a'), true);
  assert.deepEqual(loadNotepadDrafts(store, 'draft-account-b').drafts, { composer: null, edit: null });
  assert.deepEqual(loadNotepadDrafts(store, null).drafts, { composer: null, edit: null });
  assert.deepEqual(loadNotepadDrafts(store, 'draft-account-a').drafts, draft);
  assert.equal(saveNotepadDrafts(undefined, draft, false, 'unsaved-account-a'), false);
  assert.deepEqual(loadNotepadDrafts(store, 'unsaved-account-a').drafts, draft);
  assert.deepEqual(loadNotepadDrafts(store, 'unsaved-account-b').drafts, { composer: null, edit: null });
});

test('legacy drafts use original workspace owner even if opened by another account', () => {
  const store = storage();
  const raw = JSON.stringify({ version: 1, ...draft });
  store.setItem('karkas_workspace_owner', 'legacy-draft-owner');
  store.setItem('karkas_notepad_drafts_v1', raw);
  assert.equal(loadNotepadDrafts(store, 'new-draft-owner').drafts.composer, null);
  assert.deepEqual(loadNotepadDrafts(store, 'legacy-draft-owner').drafts, draft);
  assert.equal(store.getItem('karkas_notepad_drafts_v1'), raw);
});

test('failed deletion cannot resurrect an already discarded disk draft', () => {
  const store = storage();
  saveNotepadDrafts(store, draft, true, 'discard-account');
  store.removeItem = () => { throw new Error('Read only'); };
  store.setItem = () => { throw new Error('Read only'); };
  const empty = { composer: null, edit: null };
  assert.equal(saveNotepadDrafts(store, empty, true, 'discard-account'), false);
  assert.deepEqual(loadNotepadDrafts(store, 'discard-account').drafts, empty);
});
