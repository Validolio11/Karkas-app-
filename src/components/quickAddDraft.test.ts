import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QUICK_ADD_DRAFT_KEY, readQuickAddDraft, saveQuickAddDraft, type QuickAddDraft } from './quickAddDraft';

const draft: QuickAddDraft = {
  title: ' Чернетка ', note: 'Не втратити нотатку', phase: 'home', priority: 1,
  steps: 3, customSteps: ['Підготовка', '', 'Перевірка'],
};

function memoryStorage() {
  const values = new Map<string, string>();
  const writes: string[] = [];
  return {
    values, writes,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); writes.push(key); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

test('draft round trip preserves title, notes, custom steps, phase, count and priority', () => {
  const storage = memoryStorage();
  assert.equal(saveQuickAddDraft(storage, draft), true);
  assert.deepEqual(readQuickAddDraft(storage), draft);
  assert.deepEqual(storage.writes, [QUICK_ADD_DRAFT_KEY]);
});

test('invalid JSON and non-object drafts do not crash recovery', () => {
  const storage = memoryStorage();
  for (const value of ['{ broken', 'null', '42', '[]']) {
    storage.values.set(QUICK_ADD_DRAFT_KEY, value);
    assert.equal(readQuickAddDraft(storage), null);
  }
});

test('malformed fields are guarded while usable draft text is preserved', () => {
  const storage = memoryStorage();
  storage.values.set(QUICK_ADD_DRAFT_KEY, JSON.stringify({
    title: 'Keep me', note: 7, phase: 'DASHBOARD', priority: 99, steps: -5,
    customSteps: ['Valid', null, 0, { title: 'Wrong shape' }],
  }));
  assert.deepEqual(readQuickAddDraft(storage), {
    title: 'Keep me', note: '', phase: '', priority: 2, steps: 1, customSteps: ['Valid'],
  });
});

test('empty draft creates no key, and clearing a submitted draft leaves unrelated data untouched', () => {
  const storage = memoryStorage();
  const empty = { ...draft, title: '', note: '', customSteps: [] };
  saveQuickAddDraft(storage, empty);
  assert.equal(storage.values.has(QUICK_ADD_DRAFT_KEY), false);
  assert.equal(storage.writes.length, 0);
  storage.values.set('tasks', 'important');
  saveQuickAddDraft(storage, draft);
  saveQuickAddDraft(storage, empty);
  assert.equal(storage.values.has(QUICK_ADD_DRAFT_KEY), false);
  assert.equal(storage.values.get('tasks'), 'important');
});

test('draft save and restore tolerate unavailable storage or exceeded quota', () => {
  const storage = {
    getItem: () => { throw new Error('Unavailable'); },
    setItem: () => { throw new Error('Quota'); },
    removeItem: () => { throw new Error('Unavailable'); },
  };
  assert.equal(readQuickAddDraft(storage), null);
  assert.equal(saveQuickAddDraft(storage, draft), false);
});
