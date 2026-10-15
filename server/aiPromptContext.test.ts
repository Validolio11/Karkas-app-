import assert from 'node:assert/strict';
import test from 'node:test';
import { chatHistoryContents, compactTaskPromptContext, KARKAS_ASSISTANT_PERSONA, mergeTemporalTaskContext, priorityLabel, PROPOSAL_STATUS_NOTES } from './aiPromptContext';
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

test('oversized historical messages are omitted whole without removing negation from retained turns', () => {
  const contents = chatHistoryContents([{ role: 'user', content: `Do not ${'change '.repeat(4000)}my goal` }, { role: 'assistant', content: 'Do not change the goal.' }], 'Current question');
  assert.doesNotMatch(JSON.stringify(contents), /my goal/);
  assert.match(JSON.stringify(contents), /Do not change the goal\./);
  assert.match(JSON.stringify(contents), /Current question/);
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
  assert.deepEqual(compact.plannedDay, { date: '2026-10-12', relation: 'today', weekday: 'Monday', daysFromToday: 0, week: 'this' });
  assert.equal(compact.priorityLabel, 'normal');
  assert.ok((compact.statuses as string[]).includes('deadline_overdue'));
  assert.equal(compact.countdownDurationSeconds, 1500);
  assert.equal(compact.recentActivity, undefined);
  const [detailed] = mergeTemporalTaskContext(compactTaskPromptContext([task as any], { detailTaskIds: ['t'] }), temporal, { detailTaskIds: ['t'] });
  assert.equal((detailed.recentActivity as unknown[]).length, 1);
  // A task outside the bounded temporal context keeps its raw values.
  const [untracked] = mergeTemporalTaskContext(compactTaskPromptContext([{ ...task, id: 'other' } as any]), temporal);
  assert.equal(untracked.createdAt, task.createdAt);
});

test('every compact task record states what its priority number means', () => {
  assert.deepEqual([1, 2, 3, undefined, 7].map(priorityLabel), ['high', 'normal', 'low', undefined, undefined]);
  const records = compactTaskPromptContext([
    { id: 'a', title: 'Urgent', priority: 1 }, { id: 'b', title: 'Usual', priority: 2 },
    { id: 'c', title: 'Someday', priority: 3 }, { id: 'd', title: 'Unset' },
  ] as any[]);
  assert.deepEqual(records.map(record => [record.priority, record.priorityLabel]), [[1, 'high'], [2, 'normal'], [3, 'low'], [undefined, undefined]]);
  assert.equal('priorityLabel' in records[3], false, 'an unknown priority is not labelled');
  // The label survives the merge with temporal fields used by every chat route.
  const clock = { now: '2026-10-12T12:00:00Z', timeZone: 'Europe/Kyiv' };
  const merged = mergeTemporalTaskContext(records, buildTaskTemporalContext(records as any[], clock).tasks);
  assert.deepEqual(merged.map(record => record.priorityLabel), ['high', 'normal', 'low', undefined]);
});

test('the shared persona is a stable static instruction', () => {
  assert.match(KARKAS_ASSISTANT_PERSONA, /warm, direct and concise/);
  assert.match(KARKAS_ASSISTANT_PERSONA, /at most one clarifying question/);
  assert.doesNotMatch(KARKAS_ASSISTANT_PERSONA, /\d{4}-\d{2}-\d{2}/);
});

test('the persona asks for literary Ukrainian terms and one consistent form of address', () => {
  assert.match(KARKAS_ASSISTANT_PERSONA, /russianisms, surzhyk/);
  assert.match(KARKAS_ASSISTANT_PERSONA, /розкадровка, таймлайн, ключові кадри, композиція/);
  assert.match(KARKAS_ASSISTANT_PERSONA, /otherwise "ви"; never mix them in one reply\. When the request context has an ADDRESS FORM line, follow it\./);
});

test('a reply that carried a proposal is followed by an app note with its real status', () => {
  const contents = chatHistoryContents([
    { role: 'user', content: 'Розбий банери на кроки' },
    { role: 'assistant', content: 'Пропоную 5 кроків для банерів.', proposalStatus: 'not_applied' },
    { role: 'user', content: 'Не знаю з чого почати' },
    { role: 'assistant', content: 'Пропоную таймер на 25 хвилин.', proposalStatus: 'partial' },
    { role: 'assistant', content: 'Пропоную новий крок.', proposalStatus: 'applied' },
    { role: 'assistant', content: 'Просто відповідь.', proposalStatus: 'bogus' },
  ], 'Now');
  assert.deepEqual(contents.map(turn => turn.role), ['user', 'model', 'user', 'model', 'user', 'model', 'user', 'model', 'user']);
  // The model's own turns stay clean; the note is app data in the following user turn.
  assert.deepEqual(contents[1].parts, [{ text: 'Пропоную 5 кроків для банерів.' }]);
  assert.deepEqual(contents[2].parts, [{ text: PROPOSAL_STATUS_NOTES.not_applied }, { text: 'Не знаю з чого почати' }]);
  assert.match(contents[2].parts[0].text, /NOT applied; none of its changes happened/);
  assert.deepEqual(contents[4].parts, [{ text: PROPOSAL_STATUS_NOTES.partial }]);
  assert.deepEqual(contents[6].parts, [{ text: PROPOSAL_STATUS_NOTES.applied }]);
  // An unknown status adds nothing; the current message still closes the contents.
  assert.deepEqual(contents[7].parts, [{ text: 'Просто відповідь.' }]);
  assert.deepEqual(contents[8].parts, [{ text: 'Now' }]);
  assert.doesNotMatch(JSON.stringify(contents.filter(turn => turn.role === 'model')), /App note/);
});

test('the persona asks for current orthography and describes behaviour instead of diagnoses', () => {
  assert.match(KARKAS_ASSISTANT_PERSONA, /current orthography \("проєкт", not "проект"\)/);
  assert.match(KARKAS_ASSISTANT_PERSONA, /no medical or psychological diagnoses or labels/);
  assert.match(KARKAS_ASSISTANT_PERSONA, /СДУГ/);
  assert.match(KARKAS_ASSISTANT_PERSONA, /professional only if the person mentions serious distress/);
  assert.match(KARKAS_ASSISTANT_PERSONA, /an unapplied proposal changed nothing/);
});
