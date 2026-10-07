import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QUICK_ADD_DRAFT_KEY, buildQuickAddSteps, mergeQuickAddSuggestions, readQuickAddDraft, saveQuickAddDraft, type QuickAddDraft } from './quickAddDraft';

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
    title: 'Keep me', note: '', phase: '', priority: 2, steps: 0, customSteps: ['Valid'],
  });
});

test('empty draft creates no key, and clearing a submitted draft leaves unrelated data untouched', () => {
  const storage = memoryStorage();
  const empty = { ...draft, title: '', note: '', customSteps: [], steps: 0 };
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

test('timer and hidden step names survive closing and reloading a zero-step draft', () => {
  const storage = memoryStorage();
  const pausedCountdown = { ...draft, steps: 0, timerMode: 'countdown' as const, countdownMinutes: 45 };
  saveQuickAddDraft(storage, pausedCountdown);
  assert.deepEqual(readQuickAddDraft(storage), pausedCountdown);
  assert.equal(buildQuickAddSteps(0, pausedCountdown.customSteps, 'uk').length, 0);
  assert.deepEqual(buildQuickAddSteps(3, pausedCountdown.customSteps, 'uk').map(step => step.title), ['Підготовка', 'Крок 2', 'Перевірка']);
});

test('timer-only and count-only configurations are durable even before typing a title', () => {
  const storage = memoryStorage();
  const timerOnly = { ...draft, title: '', note: '', customSteps: [], steps: 0, timerMode: 'stopwatch' as const };
  saveQuickAddDraft(storage, timerOnly);
  assert.deepEqual(readQuickAddDraft(storage), timerOnly);
  const countOnly = { ...timerOnly, timerMode: 'none' as const, steps: 4 };
  saveQuickAddDraft(storage, countOnly);
  assert.deepEqual(readQuickAddDraft(storage), countOnly);
});

test('malformed timer configuration is bounded without losing the rest of the draft', () => {
  const storage = memoryStorage();
  storage.values.set(QUICK_ADD_DRAFT_KEY, JSON.stringify({ ...draft, steps: 99, timerMode: 'automatic', countdownMinutes: 2000 }));
  assert.deepEqual(readQuickAddDraft(storage), { ...draft, steps: 12, timerMode: 'none', countdownMinutes: 1440 });
});

test('generated suggestions fill blanks and append without replacing manual names or duplicates', () => {
  const manual = ['Мій власний крок', '', 'Збережена прихована назва'];
  assert.deepEqual(mergeQuickAddSuggestions(manual, ['Новий крок', 'мій власний крок', ' ', 'Перевірка']), ['Мій власний крок', 'Новий крок', 'Збережена прихована назва', 'Перевірка']);
  assert.deepEqual(manual, ['Мій власний крок', '', 'Збережена прихована назва']);
});

test('twelve steps remain a bounded plan with localized defaults', () => {
  assert.equal(buildQuickAddSteps(20, [], 'uk').length, 12);
  assert.equal(buildQuickAddSteps(1, ['   '], 'en')[0].title, 'Step 1');
  const names = Array.from({ length: 12 }, (_, index) => `Manual ${index + 1}`);
  assert.deepEqual(mergeQuickAddSuggestions(names, ['Extra step']), names);
});

test('incomplete countdown input is recovered exactly so users can finish editing', () => {
  const storage = memoryStorage();
  for (const countdownInput of ['', '0', '1500', '2.5']) {
    const incomplete = { ...draft, timerMode: 'countdown' as const, countdownInput };
    saveQuickAddDraft(storage, incomplete);
    assert.deepEqual(readQuickAddDraft(storage), incomplete);
  }
});

test('legacy names beyond the current slider limit remain recoverable in the draft', () => {
  const legacyNames = Array.from({ length: 15 }, (_, index) => `Previous step ${index + 1}`);
  assert.deepEqual(mergeQuickAddSuggestions(legacyNames, ['New suggestion']), legacyNames);
  const storage = memoryStorage();
  saveQuickAddDraft(storage, { ...draft, steps: 12, customSteps: legacyNames });
  assert.deepEqual(readQuickAddDraft(storage)?.customSteps, legacyNames);
});
