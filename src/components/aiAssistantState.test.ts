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
