import assert from 'node:assert/strict';
import test from 'node:test';
import { chatHistoryContents, compactTaskPromptContext, KARKAS_ASSISTANT_PERSONA, mergeTemporalTaskContext } from './aiPromptContext';
import { buildTaskTemporalContext } from '../src/utils/taskTemporalContext';

test('chat history becomes alternating Gemini turns that start with user and end with the current turn', () => {
  const contents = chatHistoryContents([
    { role: 'assistant', content: 'Welcome' },
    { role: 'user', content: 'First' },
    { role: 'user', content: 'Second' },
    { role: 'assistant', content: 'Answer' },
    { role: 'system', content: 'Ignored role' },
    { role: 'user', content: '   ' },
    null,
  ], 'REQUEST CONTEXT\n\nCURRENT USER MESSAGE:\nNow');
  assert.deepEqual(contents.map(turn => turn.role), ['user', 'model', 'user', 'model', 'user']);
  assert.deepEqual(contents[1].parts, [{ text: 'Welcome' }]);
  assert.deepEqual(contents[2].parts, [{ text: 'First' }, { text: 'Second' }]);
  assert.doesNotMatch(JSON.stringify(contents), /Ignored role/);
  assert.match(contents.at(-1)!.parts.at(-1)!.text, /CURRENT USER MESSAGE:\nNow$/);
});

test('an unanswered trailing user message is merged into the final user turn', () => {
  const contents = chatHistoryContents([{ role: 'user', content: 'Earlier' }], 'Current');
  assert.deepEqual(contents, [{ role: 'user', parts: [{ text: 'Earlier' }, { text: 'Current' }] }]);
  assert.deepEqual(chatHistoryContents(undefined, 'Only'), [{ role: 'user', parts: [{ text: 'Only' }] }]);
});

test('each task is sent once with client-local temporal fields instead of raw epochs', () => {
  const clock = { now: '2026-10-12T12:00:00Z', timeZone: 'Europe/Kyiv' };
  const task = { id: 't', title: 'Report', phase: 'work', priority: 2, done: false, createdAt: Date.parse('2026-10-10T08:00:00Z'),
    plannedDate: '2026-10-12', deadlineDate: '2026-10-11', countdownDurationSeconds: 1500, timerMode: 'countdown' as const,
    activityTrail: [{ type: 'edited', at: Date.parse('2026-10-11T08:00:00Z') }] };
  const temporal = buildTaskTemporalContext([task as any], clock).tasks;
  const [compact] = mergeTemporalTaskContext(compactTaskPromptContext([task as any]), temporal);
  assert.equal(compact.createdAt, undefined);
  assert.equal(compact.plannedDate, undefined);
  assert.equal(compact.created, '2026-10-10 11:00:00');
  assert.deepEqual(compact.plannedDay, { date: '2026-10-12', relation: 'today' });
  assert.ok((compact.statuses as string[]).includes('deadline_overdue'));
  assert.equal(compact.countdownDurationSeconds, 1500);
  assert.equal(compact.recentActivity, undefined);
  const [detailed] = mergeTemporalTaskContext(compactTaskPromptContext([task as any], { detailTaskIds: ['t'] }), temporal, { detailTaskIds: ['t'] });
  assert.equal((detailed.recentActivity as unknown[]).length, 1);
  // A task outside the bounded temporal context keeps its raw values.
  const [untracked] = mergeTemporalTaskContext(compactTaskPromptContext([{ ...task, id: 'other' } as any]), temporal);
  assert.equal(untracked.createdAt, task.createdAt);
});

test('the shared persona is a stable static instruction', () => {
  assert.match(KARKAS_ASSISTANT_PERSONA, /warm, direct and concise/);
  assert.match(KARKAS_ASSISTANT_PERSONA, /at most one clarifying question/);
  assert.doesNotMatch(KARKAS_ASSISTANT_PERSONA, /\d{4}-\d{2}-\d{2}/);
});
