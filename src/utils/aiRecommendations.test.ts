import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAIRecommendation } from './aiRecommendations';

const recommendation = () => ({ focusAdvice: 'Focus', optimizationTip: 'Reduce friction', workloadStatus: 'Manageable',
  suggestedTasks: [{ title: 'Read a page', phase: 'study', priority: 2, steps: 1, reason: 'Small next action' }] });

test('persisted recommendations and provider responses reject malformed renderable fields', () => {
  for (const invalid of [null, [], { ...recommendation(), focusAdvice: {} },
    { ...recommendation(), futureStrategy: [] }, { ...recommendation(), suggestedTasks: [null] },
    { ...recommendation(), suggestedTasks: [{ ...recommendation().suggestedTasks[0], priority: 4 }] },
    { ...recommendation(), suggestedTasks: [{ ...recommendation().suggestedTasks[0], steps: 1.5 }] },
    { ...recommendation(), suggestedTasks: [{ ...recommendation().suggestedTasks[0], note: {} }] },
    { ...recommendation(), suggestedTasks: [{ ...recommendation().suggestedTasks[0], title: '   ' }] }]) {
    assert.throws(() => parseAIRecommendation(JSON.parse(JSON.stringify(invalid))));
  }
});

test('legacy valid recommendations remain readable and unknown provider fields are discarded', () => {
  const parsed = parseAIRecommendation({ ...recommendation(), internalPrompt: 'private', source: 'gemini' });
  assert.equal(parsed.suggestedTasks[0].note, '');
  assert.equal(parsed.suggestedTasks[0].reason, 'Small next action');
  assert.equal((parsed as any).internalPrompt, undefined);
  assert.equal(parsed.source, 'gemini');
});
