import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NotepadNote } from '../types';
import { PAGE_BREAK } from './noteDoc';
import { noteSourceHash, noteTaskCandidates } from './noteTaskConversion';

test('repeated lines keep distinct source keys shared by note, page and exact selection scopes', () => {
  const repeated = '- Купити хліб';
  const note: NotepadNote = { id: 'n', title: '', content: `Початок\n${repeated}\n\n${repeated}${PAGE_BREAK}${repeated}`, createdAt: 1 };
  const all = noteTaskCandidates(note, 'note', 0, '');
  const page = noteTaskCandidates(note, 'page', 0, '');
  assert.deepEqual(all.slice(0, page.length).map(row => row.sourceKey), page.map(row => row.sourceKey));
  const start = note.content.indexOf(repeated, note.content.indexOf(repeated) + repeated.length);
  const selection = noteTaskCandidates(note, 'selection', 0, repeated, start);
  assert.equal(selection[0].sourceKey, page[2].sourceKey);
  assert.equal(selection[0].title, 'Купити хліб');
  assert.equal(selection[0].sourceText, repeated);
  assert.equal(new Set(all.map(row => row.sourceKey)).size, 4);
  assert.equal(noteTaskCandidates(note, 'page', 1, '')[0].sourceKey, all[3].sourceKey);
});

test('long Unicode source text has bounded keys, stable normalized identity and a changing snapshot guard', () => {
  const line = 'Дуже довга нотатка 🚀 '.repeat(200);
  const note: NotepadNote = { id: 'note-id', title: '', content: `1. ${line}`, createdAt: 1 };
  const first = noteTaskCandidates(note, 'page', 0, '')[0];
  const revised = { ...note, title: 'Renamed', content: `- ${line.toLocaleUpperCase('uk-UA')}` };
  const second = noteTaskCandidates(revised, 'page', 0, '')[0];
  assert.ok(first.sourceKey.length < 512);
  assert.equal(first.sourceKey, second.sourceKey);
  assert.notEqual(first.id, second.id);
  assert.equal(first.sourceContentHash, noteSourceHash(note.content));
  assert.notEqual(first.sourceContentHash, second.sourceContentHash);
  assert.equal(first.noteTitle.length, 120);
  assert.equal(first.sourceText, note.content.trim());
});

test('multiline partial selection keeps the same full-line identities and ignores empty lines', () => {
  const note: NotepadNote = { id: 'n', title: 'Context', content: 'First line\n- Second line\n\n3. Third line', createdAt: 1 };
  const selected = note.content.slice(note.content.indexOf('- Second'));
  const page = noteTaskCandidates(note, 'page', 0, '');
  const rows = noteTaskCandidates(note, 'selection', 0, selected, note.content.indexOf('- Second'));
  assert.deepEqual(rows.map(row => row.sourceKey), page.slice(1).map(row => row.sourceKey));
  assert.deepEqual(rows.map(row => row.title), ['Second line', 'Third line']);
  assert.ok(rows.every(row => row.noteTitle === 'Context' && row.noteId === note.id));
});
