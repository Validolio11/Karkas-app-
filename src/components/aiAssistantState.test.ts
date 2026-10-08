import assert from 'node:assert/strict';
import test from 'node:test';
import { AIRequestError, aiRequestErrorMessage, appendChatRequest, readAIAssistantDraft, readAIResponse, responseRequestError, restoredAIRequestNotice, saveAIAssistantDraft, selectAIModel } from './aiAssistantState';

function storage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}

test('an unfinished request and a newer typed draft both survive restart for their own account', () => {
  const memory = storage();
  const draft = { prompt: 'Наступне запитання ще дописую', mode: 'chat' as const, recoverableRequest: { text: 'Додай завдання Референси та таймер 25 хвилин', mode: 'chat' as const } };
  assert.equal(saveAIAssistantDraft(memory, draft, 'account-a'), true);
  assert.deepEqual(readAIAssistantDraft(memory, 'account-a'), draft);
  assert.equal(readAIAssistantDraft(memory, 'account-b'), null);
  assert.equal(readAIAssistantDraft(memory), null);
  saveAIAssistantDraft(memory, { prompt: '', mode: 'chat', recoverableRequest: null }, 'account-a');
  assert.equal(readAIAssistantDraft(memory, 'account-a'), null);
});

test('API keys never enter request draft storage, while an original pending request is retained', () => {
  const memory = storage();
  const secret = `AIza${'synthetic'.repeat(6)}`;
  saveAIAssistantDraft(memory, { prompt: secret, mode: 'chat', recoverableRequest: { text: 'Підготуй план', mode: 'generate' } });
  assert.equal([...memory.values.values()].join('').includes(secret), false);
  assert.equal(readAIAssistantDraft(memory)?.recoverableRequest?.text, 'Підготуй план');
  saveAIAssistantDraft(memory, { prompt: '', mode: 'chat', recoverableRequest: { text: secret, mode: 'chat' } });
  assert.equal(memory.values.size, 0);
});

test('an alternative plan retains its source mode, proposal metadata and newer draft across restart', () => {
  const memory = storage();
  const request = {
    text: 'Internal comparison request for a different approach',
    mode: 'breakdown' as const,
    purpose: 'proposal' as const,
    internalAlternative: true as const,
    planningSource: { text: 'Break down my existing animation task with a 40-minute timer', mode: 'breakdown' as const },
  };
  const draft = { prompt: 'My next question is still being written', mode: 'chat' as const, recoverableRequest: request };
  assert.equal(saveAIAssistantDraft(memory, draft, 'account'), true);
  assert.deepEqual(readAIAssistantDraft(memory, 'account'), draft);
  assert.match(restoredAIRequestNotice(readAIAssistantDraft(memory, 'account')?.recoverableRequest, 'en') || '', /unapplied proposal was not restored/);
  assert.equal(readAIAssistantDraft(memory, 'account')?.recoverableRequest?.planningSource?.mode, 'breakdown');
  assert.equal(readAIAssistantDraft(memory, 'another-account'), null);
});

test('an intentionally empty draft stays empty while an alternative request remains recoverable', () => {
  const memory = storage();
  const request = {
    text: 'Internal alternative request', mode: 'generate' as const,
    internalAlternative: true as const,
    planningSource: { text: 'Plan my next work cycle', mode: 'generate' as const },
  };
  saveAIAssistantDraft(memory, { prompt: 'Draft I decided to clear', mode: 'generate', recoverableRequest: request });
  saveAIAssistantDraft(memory, { prompt: '', mode: 'generate', recoverableRequest: request });
  const restored = readAIAssistantDraft(memory);
  assert.equal(restored?.prompt, '');
  assert.deepEqual(restored?.recoverableRequest, request);
  assert.equal(memory.values.size, 1);
  saveAIAssistantDraft(memory, { prompt: '', mode: 'generate', recoverableRequest: null });
  assert.equal(readAIAssistantDraft(memory), null);
});

test('malformed alternative source metadata cannot restore an internal request without its safe source', () => {
  const memory = storage();
  const secret = `AIza${'synthetic'.repeat(6)}`;
  for (const planningSource of [
    undefined, null, [], 'not a source', {},
    { text: '', mode: 'generate' },
    { text: '   ', mode: 'generate' },
    { text: 'Original task', mode: 'unknown' },
    { text: {}, mode: 'generate' },
    { text: secret, mode: 'generate' },
  ]) {
    const draft = {
      prompt: 'Keep my visible draft', mode: 'chat' as const,
      recoverableRequest: { text: 'Internal alternative request', mode: 'generate' as const, internalAlternative: true as const, planningSource },
    };
    memory.values.set('karkas_ai_draft:guest', JSON.stringify(draft));
    assert.deepEqual(readAIAssistantDraft(memory), { prompt: draft.prompt, mode: 'chat', recoverableRequest: null });
    assert.equal(saveAIAssistantDraft(memory, draft as unknown as Parameters<typeof saveAIAssistantDraft>[1]), true);
    assert.deepEqual(readAIAssistantDraft(memory), { prompt: draft.prompt, mode: 'chat', recoverableRequest: null });
    assert.equal([...memory.values.values()].join('').includes(secret), false);
  }
});

test('draft storage preserves only supported typed request metadata', () => {
  const memory = storage();
  const draft = {
    prompt: 'Next question', mode: 'analyze' as const, unexpectedDraftField: 'discard me',
    recoverableRequest: {
      text: 'Compare approaches', mode: 'chat' as const, purpose: 'proposal' as const, internalAlternative: true as const,
      planningSource: { text: 'Plan the existing task', mode: 'chat' as const, rawProviderDetails: 'discard me' },
      tasks: [{ title: 'Must never restore an executable proposal' }], rawProviderDetails: 'discard me',
    },
  };
  const expected = {
    prompt: draft.prompt, mode: draft.mode,
    recoverableRequest: {
      text: draft.recoverableRequest.text, mode: 'chat', purpose: 'proposal', internalAlternative: true,
      planningSource: { text: 'Plan the existing task', mode: 'chat' },
    },
  };
  memory.values.set('karkas_ai_draft:guest', JSON.stringify(draft));
  assert.deepEqual(readAIAssistantDraft(memory), expected);
  assert.equal(saveAIAssistantDraft(memory, draft), true);
  assert.deepEqual(JSON.parse(memory.values.get('karkas_ai_draft:guest') || 'null'), expected);
  assert.equal([...memory.values.values()].join('').includes('rawProviderDetails'), false);
});

test('an unapplied chat proposal restores only its original request with an explicit notice and clears after confirmation', () => {
  const memory = storage();
  const request = { text: 'Додай Референси з таймером 25 хвилин', mode: 'chat' as const, purpose: 'proposal' as const };
  saveAIAssistantDraft(memory, { prompt: '', mode: 'chat', recoverableRequest: request }, 'account');
  const restored = readAIAssistantDraft(memory, 'account');
  assert.deepEqual(restored?.recoverableRequest, request);
  assert.match(restoredAIRequestNotice(restored?.recoverableRequest, 'uk') || '', /Незастосовану пропозицію не відновлено/);
  assert.match(restoredAIRequestNotice(restored?.recoverableRequest, 'uk') || '', /Повторіть запит/);
  assert.equal('tasks' in (restored || {}), false);
  saveAIAssistantDraft(memory, { prompt: '', mode: 'chat', recoverableRequest: null }, 'account');
  assert.equal(readAIAssistantDraft(memory, 'account'), null);
  assert.equal(restoredAIRequestNotice(null, 'uk'), null);
});

test('corrupt draft data and unavailable storage do not break opening the assistant', () => {
  const memory = storage();
  for (const raw of ['{broken', 'null', '[]', '42']) {
    memory.values.set('karkas_ai_draft:guest', raw);
    assert.equal(readAIAssistantDraft(memory), null);
  }
  memory.values.set('karkas_ai_draft:guest', JSON.stringify({ prompt: 'Залишити текст', mode: 'unknown', recoverableRequest: { text: {}, mode: 'chat' } }));
  assert.deepEqual(readAIAssistantDraft(memory), { prompt: 'Залишити текст', mode: 'chat', recoverableRequest: null });
  const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('blocked'); } };
  assert.equal(readAIAssistantDraft(blocked), null);
  assert.equal(saveAIAssistantDraft(blocked, { prompt: 'Keep me', mode: 'chat', recoverableRequest: null }), false);
});

test('model selection preserves an explicit supported choice and falls back only when unavailable', () => {
  const models = ['gemini-3.1-flash-lite', 'gemini-2.5-flash'];
  assert.equal(selectAIModel(models, 'gemini-2.5-flash'), 'gemini-2.5-flash');
  assert.equal(selectAIModel(models, 'retired-model'), models[0]);
  assert.equal(selectAIModel([], 'retired-model'), '');
});

test('retry and verification resume do not duplicate an unanswered user request', () => {
  const messages = [{ role: 'assistant' as const, content: 'Привіт' }, { role: 'user' as const, content: 'Додай таймер' }];
  assert.equal(appendChatRequest(messages, 'Додай таймер'), messages);
  assert.equal(appendChatRequest(messages, 'Зупини таймер').length, 3);
  assert.equal(appendChatRequest([...messages, { role: 'assistant' as const, content: 'Готово' }], 'Додай таймер').length, 4);
});

test('provider failures retain the specific safe reason and never expose raw provider details', () => {
  for (const code of ['INVALID_API_KEY', 'MISSING_API_KEY', 'ACCESS_DENIED', 'QUOTA_EXCEEDED', 'MODEL_UNAVAILABLE', 'INVALID_AI_REQUEST', 'NETWORK_ERROR', 'TIMEOUT', 'PROVIDER_ERROR']) {
    const error = responseRequestError({ code, error: 'raw secret detail' }, 503);
    assert.equal(error.code, code);
    const notice = aiRequestErrorMessage(error, 'uk');
    assert.match(notice, /не застосовано/);
    assert.equal(notice.includes('raw secret'), false);
    assert.equal(notice.includes('локальному режимі'), false);
  }
  assert.equal(responseRequestError({ code: 'INVALID_AI_RESPONSE' }, 502).code, 'INVALID_RESPONSE');
  assert.equal(responseRequestError({}, 429).code, 'QUOTA_EXCEEDED');
  assert.equal(responseRequestError({ code: 'untrusted' }, 500).code, 'PROVIDER_ERROR');
});

test('invalid and legacy fallback responses cannot masquerade as a successful chat or fabricated plan', () => {
  assert.equal(readAIResponse({ reply: 'Перевіримо твої задачі', source: 'gemini-chat' }, 'chat').reply, 'Перевіримо твої задачі');
  assert.equal(readAIResponse({ summary: 'Таймер запропоновано', tasks: [] }, 'generate').tasks?.length, 0);
  for (const data of [null, {}, { reply: 42 }, { reply: 'Answer', tasks: {} }, { reply: 'Answer', tasks: [null] }, { reply: 'Answer', insights: [{}] }, { reply: 'No AI', source: 'local-chat-fallback' }, { reply: 'Invalid', source: 'invalid-ai-proposal' }]) {
    assert.throws(() => readAIResponse(data, 'chat'), AIRequestError);
  }
  assert.throws(() => readAIResponse({ summary: 'Unavailable', tasks: [], source: 'local-timer-fallback' }, 'generate'), AIRequestError);
});

test('malformed proposal fields fail safely before rendering or offering task changes', () => {
  for (const fields of [
    { tasks: [{ title: { malformed: true } }] },
    { tasks: [{ title: 'Valid title', steps: {} }] },
    { tasks: [{ title: 'Valid title', stepList: [null] }] },
    { tabs: [{ id: 'tab', name: {} }] },
    { taskUpdates: [{ id: 'task', note: { malformed: true } }] },
    { taskDeletions: [{ id: null }] },
    { categoryHealth: [{ recommendation: {} }] },
    { workloadDiagnosis: { bottlenecks: [null] } },
  ]) assert.throws(() => readAIResponse({ reply: 'Malformed proposal', ...fields }, 'chat'), AIRequestError);
});

test('task deletion intent accepts only accidental, cancelled or legacy missing metadata', () => {
  for (const mode of ['chat', 'breakdown', 'analyze', 'generate'] as const) {
    const response = {
      reply: 'Review these removals', summary: 'Review these removals',
      taskDeletions: [
        { id: 'accidental-task', deletionReason: 'accidental' as const, reason: 'Created by mistake' },
        { id: 'cancelled-task', deletionReason: 'cancelled' as const, reason: 'The task is no longer needed' },
        { id: 'legacy-task' },
      ],
    };
    assert.equal(readAIResponse(response, mode), response);
    for (const deletionReason of ['deleted', 'done', 'cancel', '', null, 0, false, {}, []]) {
      assert.throws(() => readAIResponse({
        reply: 'Malformed removal', summary: 'Malformed removal',
        taskDeletions: [{ id: 'task', deletionReason }],
      }, mode), error => error instanceof AIRequestError && error.code === 'INVALID_RESPONSE');
    }
    for (const reason of [null, 0, false, {}, []]) {
      assert.throws(() => readAIResponse({
        reply: 'Malformed removal', summary: 'Malformed removal',
        taskDeletions: [{ id: 'task', deletionReason: 'cancelled', reason }],
      }, mode), error => error instanceof AIRequestError && error.code === 'INVALID_RESPONSE');
    }
  }
});

test('the normalized backend chat shape accepts a Lottie reference task with a forty-minute countdown', () => {
  // This is the actual shape emitted by assistHandler after its task normalization.
  const response = {
    reply: 'Пропоную пошук референсів для анімації Lottie з таймером 40 хвилин.',
    summary: 'Пропоную пошук референсів для анімації Lottie з таймером 40 хвилин.',
    insights: [], tasks: [{
      title: 'Пошук референсів для анімації Lottie', phase: 'focus', priority: 2, steps: 0,
      stepList: [], note: '',
      timerMode: 'countdown', countdownDurationSeconds: 2400,
    }], tabs: [], taskUpdates: [], taskDeletions: [], source: 'gemini-chat',
    usedModel: 'gemini-3.1-flash-lite', fallbackUsed: false,
  };
  const accepted = readAIResponse(response, 'chat');
  assert.equal(accepted, response);
  assert.equal(accepted.tasks?.length, 1);
  assert.equal(accepted.tasks?.[0].countdownDurationSeconds, 2400);
  assert.equal(accepted.tasks?.[0].timerAction, undefined);
  assert.equal(accepted.tasks?.[0].steps, 0);
  assert.deepEqual(accepted.tasks?.[0].stepList, []);
  assert.deepEqual(accepted.taskUpdates, []);
});

test('an invalid model response never blames a valid user request or asks for different wording', () => {
  const error = responseRequestError({ code: 'INVALID_AI_RESPONSE' }, 502);
  const uk = aiRequestErrorMessage(error, 'uk');
  const en = aiRequestErrorMessage(error, 'en');
  assert.match(uk, /Повторіть запит або виберіть іншу модель/);
  assert.doesNotMatch(uk, /Уточніть|змініть|перефразуйте/i);
  assert.doesNotMatch(en, /revise|clarify|rephrase/i);
  assert.match(uk, /не застосовано/);
});
