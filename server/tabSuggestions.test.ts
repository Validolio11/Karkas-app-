import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasTabSuggestionContext, normalizeTabSuggestion, readTabSuggestionInput, TAB_SUGGESTION_PALETTE } from './tabSuggestions.ts';

test('tab suggestion keeps distinct names, palette colours and one owner per current tab', () => {
  const result = normalizeTabSuggestion({
    tabs: [
      { name: '1. Клієнти', color: '#F97316', fromTabIds: ['work', 'missing'] },
      { name: 'клієнти', color: '#38bdf8', fromTabIds: [] },
      { name: 'Навчання', color: '#123456', fromTabIds: ['study', 'work'] },
      { name: 'Здоровʼя', color: '#f97316', fromTabIds: ['health'] },
    ],
    explanation: '  Набір під фриланс.  ',
  }, ['work', 'study', 'health']);

  assert.deepEqual(result?.tabs.map(tab => tab.name), ['Клієнти', 'Навчання', 'Здоровʼя']);
  assert.deepEqual(result?.tabs.map(tab => tab.fromTabIds), [['work'], ['study'], ['health']]);
  const colors = result?.tabs.map(tab => tab.color) || [];
  assert.equal(new Set(colors).size, colors.length);
  assert.ok(colors.every(color => TAB_SUGGESTION_PALETTE.includes(color)));
  assert.equal(result?.explanation, 'Набір під фриланс.');
});

test('tab suggestion rejects sets that are too small and caps large ones', () => {
  assert.equal(normalizeTabSuggestion({ tabs: [{ name: 'A' }, { name: 'a' }] }, []), null);
  assert.equal(normalizeTabSuggestion({ tabs: [{ name: 'A' }, { name: 'B' }] }, [])?.tabs.length, 2);
  assert.equal(normalizeTabSuggestion({ tabs: 'nope' }, []), null);
  const many = normalizeTabSuggestion({ tabs: Array.from({ length: 12 }, (_, index) => ({ name: `Tab ${index}` })) }, []);
  assert.equal(many?.tabs.length, 7);
});

test('tab suggestion input is bounded and requires some context', () => {
  const input = readTabSuggestionInput({
    activity: 'x'.repeat(500),
    goals: ['Ціль', 42, ''],
    currentTabs: [{ id: 'work', name: 'Робота', taskCount: 3 }, { id: '', name: 'Bad' }, 'bad'],
  });
  assert.equal(input.activity.length, 300);
  assert.deepEqual(input.goals, ['Ціль']);
  assert.deepEqual(input.currentTabs, [{ id: 'work', name: 'Робота', taskCount: 3 }]);
  assert.equal(hasTabSuggestionContext(readTabSuggestionInput({})), false);
});
