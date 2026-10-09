import assert from 'node:assert/strict';
import test from 'node:test';
import { createVoiceDraft } from './voiceDraft';

test('dictation preserves the exact typed prefix and replaces interim recognition before editing', () => {
  const draft = createVoiceDraft('Мій план\n');
  assert.equal(draft.receive('навча').text, 'Мій план\nнавча');
  assert.equal(draft.receive('навчання друку').text, 'Мій план\nнавчання друку');
});

test('deleting recognized words while speaking preserves the edit and subsequent new speech', () => {
  const draft = createVoiceDraft('');
  draft.receive('додай зайве навчання');
  draft.edit('додай навчання');
  assert.equal(draft.receive('додай зайве навчання завтра').text, 'додай навчання завтра');
  assert.equal(draft.receive('додай зайве навчання завтра').text, 'додай навчання завтра');
});

test('a late whole-recording fallback cannot replace a manually edited draft', () => {
  const draft = createVoiceDraft('Мій запит: ');
  draft.receive('помилкове завдання');
  draft.edit('Мій запит: правильне завдання');
  const result = draft.receive('Цілком інша розшифровка запису');
  assert.equal(result.text, 'Мій запит: правильне завдання');
  assert.equal(result.needsReview, true);
});

test('typing during recording and clearing all recognized text survives late final output', () => {
  const draft = createVoiceDraft('');
  draft.receive('навчання друку');
  draft.edit('навчання друку о 20:00');
  assert.equal(draft.receive('навчання друку щодня').text, 'навчання друку о 20:00 щодня');
  draft.edit('');
  assert.equal(draft.receive('навчання друку щодня').text, '');
  assert.equal(draft.receive('').text, '');
});

test('completing a deleted interim word cannot reinsert its remaining fragment', () => {
  const draft = createVoiceDraft('');
  draft.receive('додай помил');
  draft.edit('додай');
  const result = draft.receive('додай помилкове завтра');
  assert.equal(result.text, 'додай завтра');
});
