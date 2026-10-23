import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readEditorDrafts, readLastNoteId, readNoteCursor, writeEditorDraft, writeNoteCursor, type NoteEditorDraft } from './noteEditorState';

const memory = () => {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); } };
};
const key = (owner: string | null) => `karkas_notes_editor_v2:${encodeURIComponent(owner === null ? 'guest' : `account:${owner}`)}`;
const draft: NoteEditorDraft = { base: { id: 'n', title: '', content: 'Saved', createdAt: 1 }, title: 'Unsaved title',
  doc: { pages: [[{ t: 'text', v: 'Unsaved text' }]] }, metadata: { kind: 'lesson', pinned: true }, at: 2 };

test('editor drafts and cursor state remain owner scoped, and clearing retains other note drafts', () => {
  const disk = memory();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: disk });
  try {
    const owner = 'editor-state-owner';
    assert.equal(writeEditorDraft(owner, 'n', draft), true);
    assert.equal(writeEditorDraft(owner, 'other', { ...draft, base: { ...draft.base, id: 'other' } }), true);
    assert.deepEqual(readEditorDrafts(owner).n, draft);
    assert.deepEqual(readEditorDrafts('editor-state-other-owner'), {});
    assert.deepEqual(readEditorDrafts(null), {});
    writeNoteCursor(owner, 'n', { page: 2, start: 4, end: 9, scroll: 10 });
    assert.deepEqual(readNoteCursor(owner, 'n'), { page: 2, start: 4, end: 9, scroll: 10 });
    assert.equal(readLastNoteId(owner), 'n');
    assert.equal(readNoteCursor('editor-state-other-owner', 'n'), null);
    assert.equal(writeEditorDraft(owner, 'n', null), true);
    assert.equal(readEditorDrafts(owner).n, undefined);
    assert.ok(readEditorDrafts(owner).other);
    assert.equal(JSON.parse(disk.getItem(key(owner))!).n, undefined);
  } finally { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else Reflect.deleteProperty(globalThis, 'localStorage'); }
});

test('failed draft storage keeps in-memory text available and permits retry without retyping', () => {
  const disk = memory();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: disk });
  try {
    const owner = 'editor-write-failure';
    const write = disk.setItem;
    disk.setItem = () => { throw new Error('Quota'); };
    assert.equal(writeEditorDraft(owner, 'n', draft), false);
    assert.equal(readEditorDrafts(owner).n.doc.pages[0][0].v, 'Unsaved text');
    disk.setItem = write;
    assert.equal(writeEditorDraft(owner, 'n', readEditorDrafts(owner).n), true);
    assert.equal(JSON.parse(disk.getItem(key(owner))!).n.title, 'Unsaved title');
  } finally { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else Reflect.deleteProperty(globalThis, 'localStorage'); }
});

test('corrupted draft bases are backed up exactly before writes, and failed backups preserve the original', () => {
  for (const failBackup of [false, true]) {
    const disk = memory();
    const owner = `editor-corrupt-${failBackup}`;
    const raw = JSON.stringify({ n: { ...draft, base: { ...draft.base, doc: { pages: null } } } });
    disk.setItem(key(owner), raw);
    const write = disk.setItem;
    if (failBackup) disk.setItem = (name, value) => { if (name.includes(':recovery:')) throw new Error('Quota'); write(name, value); };
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: disk });
    try {
      assert.deepEqual(readEditorDrafts(owner), {});
      assert.equal(disk.getItem(key(owner)), raw);
      assert.equal(writeEditorDraft(owner, 'n', draft), !failBackup);
      if (failBackup) assert.equal(disk.getItem(key(owner)), raw);
      else assert.ok([...disk.values.entries()].some(([name, value]) => name.includes(':recovery:') && value === raw));
    } finally { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else Reflect.deleteProperty(globalThis, 'localStorage'); }
  }
});
