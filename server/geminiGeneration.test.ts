import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { GoogleGenAI } from '@google/genai';
import { AIRequestError, aiRequestFailure, classifyAIRequestError, generateGeminiWithFallback } from './geminiGeneration.ts';

const originalFetch = globalThis.fetch;
const originalAutostart = process.env.KARKAS_SERVER_AUTOSTART;
const originalKey = process.env.GEMINI_API_KEY;
let invokeDesktopApi: typeof import('../server.ts').invokeDesktopApi;
let provider: typeof fetch;
const calls: { model: string; body: any; signal?: AbortSignal }[] = [];

before(async () => {
  process.env.KARKAS_SERVER_AUTOSTART = 'false';
  process.env.GEMINI_API_KEY = '';
  // Keep the real SDK: intercept only its HTTP transport, so schema serialization,
  // native error shapes and response.text conversion are exercised without Google.
  globalThis.fetch = ((url: any, options: RequestInit) => provider(url, options)) as typeof fetch;
  ({ invokeDesktopApi } = await import('../server.ts'));
});

after(() => {
  globalThis.fetch = originalFetch;
  if (originalAutostart === undefined) delete process.env.KARKAS_SERVER_AUTOSTART;
  else process.env.KARKAS_SERVER_AUTOSTART = originalAutostart;
  if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalKey;
});

function mockProvider(respond: (model: string, body: any, options: RequestInit) => Response | Promise<Response>) {
  calls.length = 0;
  provider = (async (url: any, options: RequestInit) => {
    assert.match(String(url), /^https:\/\/generativelanguage\.googleapis\.com\//);
    const model = /models\/([^:]+):generateContent/.exec(String(url))?.[1];
    assert.ok(model);
    const body = JSON.parse(String(options.body));
    calls.push({ model, body, signal: options.signal ?? undefined });
    return respond(model, body, options);
  }) as typeof fetch;
}

const json = (data: any, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const success = (proposal: any) => json({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(proposal) }] }, finishReason: 'STOP' }] });
const rejected = (status: number, providerStatus: string, message = 'private-test-key provider-internal-data') => json({ error: { code: status, status: providerStatus, message } }, status);
const chat = (overrides: any = {}) => invokeDesktopApi('assist', {
  prompt: 'Допоможи скласти план на день', action: 'chat', lang: 'uk', customApiKey: 'test-only-fake-key',
  selectedModel: 'gemini-3.1-flash-lite', ...overrides,
});

test('retired selected model falls back through the real SDK and preserves serialized timer schema', async () => {
  mockProvider((model, body, options) => {
    assert.ok(options.signal);
    const schema = body.generationConfig.responseSchema;
    assert.equal(schema.properties.tasks.items.properties.countdownDurationSeconds.minimum, 60);
    assert.equal(schema.properties.tasks.items.properties.countdownDurationSeconds.maximum, 86400);
    assert.deepEqual(schema.properties.taskUpdates.items.properties.timerAction.enum, ['start', 'pause', 'stop']);
    return model === 'gemini-retired-model' ? rejected(404, 'NOT_FOUND') : success({
      reply: 'Пропоную таймер на 25 хвилин.', tasks: [], taskUpdates: [{ id: 't1', timerMode: 'countdown', countdownDurationSeconds: 1500 }],
    });
  });
  const result = await chat({ selectedModel: 'models/gemini-retired-model', currentTasks: [{ id: 't1', title: 'Референси' }] });
  assert.equal(result.status, 200);
  assert.equal(result.body.source, 'gemini-chat');
  assert.equal(result.body.taskUpdates[0].countdownDurationSeconds, 1500);
  assert.equal(result.body.usedModel, 'gemini-3.1-flash-lite');
  assert.equal(result.body.fallbackUsed, true);
  assert.deepEqual(calls.map(call => call.model), ['gemini-retired-model', 'gemini-3.1-flash-lite']);
});

test('fallback attempts each model once, then returns the quota category without raw diagnostics', async () => {
  mockProvider(() => rejected(429, 'RESOURCE_EXHAUSTED'));
  const result = await chat();
  assert.equal(result.status, 429);
  assert.equal(result.body.code, 'QUOTA_EXCEEDED');
  assert.deepEqual(calls.map(call => call.model), ['gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-flash-latest']);
  assert.deepEqual(result.body.taskUpdates, []);
  assert.equal(result.body.source, 'ai-error');
  assert.doesNotMatch(JSON.stringify(result.body), /private-test-key|provider-internal-data/);
});

test('provider authorization failures stop immediately with the correct category', async () => {
  for (const [status, providerStatus, code] of [[401, 'UNAUTHENTICATED', 'INVALID_API_KEY'], [403, 'PERMISSION_DENIED', 'ACCESS_DENIED']] as const) {
    mockProvider(() => rejected(status, providerStatus));
    const result = await chat();
    assert.equal(result.status, status);
    assert.equal(result.body.code, code);
    assert.equal(calls.length, 1);
    assert.deepEqual(result.body.tasks, []);
  }
});

test('the real SDK invalid request error is explicit, stops once and does not blame user wording', async () => {
  mockProvider(() => rejected(400, 'INVALID_ARGUMENT', 'responseSchema invalid private-test-key'));
  const result = await chat();
  assert.equal(result.status, 502);
  assert.equal(result.body.code, 'INVALID_AI_REQUEST');
  assert.equal(calls.length, 1);
  assert.match(result.body.error, /запит додатка/);
  assert.doesNotMatch(result.body.error, /responseSchema|private-test-key|Уточніть/);
});

test('model outages and network failures retain their category instead of a successful local chat reply', async () => {
  for (const [respond, code] of [
    [() => rejected(404, 'NOT_FOUND'), 'MODEL_UNAVAILABLE'],
    [() => { throw new TypeError('fetch failed'); }, 'NETWORK_ERROR'],
    [() => rejected(503, 'UNAVAILABLE'), 'PROVIDER_ERROR'],
  ] as const) {
    mockProvider(respond);
    const result = await chat();
    assert.ok(result.status >= 500);
    assert.equal(result.body.code, code);
    assert.equal(result.body.source, 'ai-error');
    assert.match(result.body.error, /не застосовано/);
  }
});

test('invalid Gemini output does not silently generate heuristic changes', async () => {
  mockProvider(() => success({ reply: 'Сформовано.', tasks: [], taskUpdates: [{ id: 'unknown', timerAction: 'start' }] }));
  const result = await chat();
  assert.equal(result.status, 502);
  assert.equal(result.body.code, 'INVALID_AI_RESPONSE');
  assert.deepEqual(result.body.tasks, []);
  assert.deepEqual(result.body.taskUpdates, []);
  assert.deepEqual(calls.map(call => call.model), ['gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-flash-latest']);
});

const lottieTask = { title: 'Пошук референсів для анімації Lottie', phase: 'focus', priority: 2, steps: 0, stepList: [], timerMode: 'countdown', countdownDurationSeconds: 2400 };
const lottiePrompt = 'Привіт, додай завдання пошук референсів для анімації лотті з таймером на 40 хвилин';

test('Lottie forty-minute task tolerates unused optional nulls and preserves zero subtasks', async () => {
  for (const action of ['chat', 'generate']) {
    mockProvider((_model, body) => {
      assert.match(body.systemInstruction.parts[0].text, /40 minutes means countdownDurationSeconds:2400/);
      return success({ reply: 'Пропоную завдання з таймером на 40 хвилин.', summary: 'Пропозицію підготовлено.',
        tasks: [{ ...lottieTask, note: null, timerAction: null }], tabs: null, taskUpdates: null, taskDeletions: null });
    });
    const result = await chat({ prompt: lottiePrompt, action, tabs: ['focus'] });
    assert.equal(result.status, 200);
    assert.equal(result.body.tasks.length, 1);
    assert.equal(result.body.tasks[0].countdownDurationSeconds, 2400);
    assert.equal(result.body.tasks[0].timerAction, undefined);
    assert.equal(result.body.tasks[0].steps, 0);
    assert.deepEqual(result.body.tasks[0].stepList, []);
    assert.deepEqual(result.body.taskUpdates, []);
    assert.deepEqual(result.body.taskDeletions, []);
    assert.equal(calls.length, 1);
  }
});

test('existing-task forty-minute timer with null optional text remains a valid complete mutation', async () => {
  mockProvider(() => success({ reply: 'Пропоную таймер на 40 хвилин.', tasks: [], taskUpdates: [{
    id: 't1', title: null, note: null, phase: null, priority: null, done: null, steps: null, stepList: null,
    timerMode: null, countdownDurationSeconds: 2400, timerAction: null,
  }], taskDeletions: null }));
  const result = await chat({ prompt: 'Додай таймер на 40 хвилин до пошуку референсів', currentTasks: [{ id: 't1', title: lottieTask.title, note: 'Моя примітка' }] });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.taskUpdates, [{ id: 't1', countdownDurationSeconds: 2400, timerMode: 'countdown' }]);
  assert.equal(calls.length, 1);
});

test('invalid duration is not reinterpreted as minutes and a valid distinct fallback repairs the entire proposal', async () => {
  mockProvider(model => success({ reply: 'Пропоную завдання.', tasks: [{ ...lottieTask,
    countdownDurationSeconds: model === 'gemini-3.1-flash-lite' ? 40 : 2400 }] }));
  const result = await chat({ prompt: lottiePrompt, tabs: ['focus'] });
  assert.equal(result.status, 200);
  assert.equal(result.body.tasks[0].countdownDurationSeconds, 2400);
  assert.equal(result.body.usedModel, 'gemini-2.5-flash');
  assert.equal(result.body.fallbackUsed, true);
  assert.deepEqual(calls.map(call => call.model), ['gemini-3.1-flash-lite', 'gemini-2.5-flash']);
});

test('all invalid timer, target and required-title variants fail without a partial proposal', async () => {
  for (const malformed of [
    { tasks: [{ ...lottieTask, countdownDurationSeconds: 40 }] },
    { tasks: [{ ...lottieTask, countdownDurationSeconds: '2400' }] },
    { tasks: [lottieTask, { ...lottieTask, countdownDurationSeconds: 0 }] },
    { tasks: [{ ...lottieTask, title: null }] },
    { tasks: [null] },
    { tasks: [], taskUpdates: [{ id: 'unknown', timerAction: 'start' }] },
    { tasks: [{ ...lottieTask, timerRunning: null }] },
  ]) {
    mockProvider(() => success({ reply: 'Пропоную завдання.', ...malformed }));
    const result = await chat({ prompt: lottiePrompt, tabs: ['focus'] });
    assert.equal(result.status, 502, JSON.stringify(malformed));
    assert.equal(result.body.code, 'INVALID_AI_RESPONSE');
    assert.deepEqual(result.body.tasks, []);
    assert.deepEqual(result.body.taskUpdates, []);
    assert.equal(calls.length, 3);
  }
});

test('malformed optional mutation values trigger model fallback before a successful server response', async () => {
  for (const malformed of [{ title: {} }, { note: [] }, { phase: {} }, { steps: {} }, { steps: 2.5 }, { done: 'false' }]) {
    mockProvider(model => success({ reply: 'Пропоную таймер.', tasks: [], taskUpdates: [{ id: 't1',
      countdownDurationSeconds: 2400, ...(model === 'gemini-3.1-flash-lite' ? malformed : {}) }] }));
    const result = await chat({ currentTasks: [{ id: 't1', title: lottieTask.title }] });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.taskUpdates, [{ id: 't1', countdownDurationSeconds: 2400, timerMode: 'countdown' }]);
    assert.equal(result.body.usedModel, 'gemini-2.5-flash');
    assert.equal(calls.length, 2);
  }
});

test('real SDK ignores thought text and joins fenced JSON text parts for the Lottie proposal', async () => {
  mockProvider(() => {
    const proposal = JSON.stringify({ reply: 'Пропоную завдання.', tasks: [lottieTask] });
    const split = Math.floor(proposal.length / 2);
    return json({ candidates: [{ content: { role: 'model', parts: [
      { thought: true, text: 'Internal reasoning must not be parsed.' },
      { text: '\uFEFF```json\n' + proposal.slice(0, split) }, { text: proposal.slice(split) + '\n```' },
    ] }, finishReason: 'STOP' }] });
  });
  const result = await chat({ prompt: lottiePrompt, tabs: ['focus'] });
  assert.equal(result.status, 200);
  assert.equal(result.body.tasks[0].countdownDurationSeconds, 2400);
  assert.equal(calls.length, 1);
});

test('malformed JSON uses a distinct model, while repeated truncation stays an explicit failure', async () => {
  for (const repair of [true, false]) {
    mockProvider(model => model !== 'gemini-3.1-flash-lite' && repair
      ? success({ reply: 'Пропоную завдання.', tasks: [lottieTask] })
      : json({ candidates: [{ content: { parts: [{ text: '{"reply":"Пропоную", "tasks": [' }] } }] }));
    const result = await chat({ prompt: lottiePrompt, tabs: ['focus'] });
    assert.equal(result.status, repair ? 200 : 502);
    assert.equal(calls.length, repair ? 2 : 3);
    if (!repair) assert.deepEqual(result.body.tasks, []);
  }
});

test('validation fallback shares the original deadline and does not grant another full timeout', async () => {
  mockProvider((model, _body, options) => model === 'gemini-3.1-flash-lite' ? success({ invalid: true })
    : new Promise((_resolve, reject) => options.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })));
  const started = performance.now();
  await assert.rejects(generateGeminiWithFallback({
    ai: new GoogleGenAI({ apiKey: 'test-only-fake-key' }), contents: 'Test', config: {},
    validateResponse: () => { throw new Error('Invalid proposal'); }, timeoutMs: 30, totalTimeoutMs: 15,
  }), (error: unknown) => error instanceof AIRequestError && error.code === 'TIMEOUT');
  assert.ok(performance.now() - started < 150);
  assert.ok(calls.length <= 2);
  assert.ok(calls.at(-1)?.signal?.aborted);
});

test('provider failures in planning, breakdown and recommendations are explicit too', async () => {
  const inputs = [
    ['assist', { prompt: 'План роботи', action: 'generate' }],
    ['breakdown', { task: { id: 't1', title: 'Робота' } }],
    ['recommendations', { tasks: [] }],
  ] as const;
  for (const [operation, input] of inputs) {
    mockProvider(() => rejected(401, 'UNAUTHENTICATED'));
    const result = await invokeDesktopApi(operation, { ...input, customApiKey: 'test-only-fake-key', lang: 'uk' });
    assert.equal(result.status, 401);
    assert.equal(result.body.code, 'INVALID_API_KEY');
    assert.equal(result.body.source, 'ai-error');
  }
});

test('missing chat credentials are explicit while the local greeting remains available', async () => {
  mockProvider(() => { throw new Error('Google must not be called without credentials'); });
  const missing = await invokeDesktopApi('assist', { prompt: 'Допоможи скласти план', action: 'chat', lang: 'uk' });
  assert.equal(missing.status, 503);
  assert.equal(missing.body.code, 'MISSING_API_KEY');
  const greeting = await invokeDesktopApi('assist', { prompt: 'Привіт', action: 'chat', lang: 'uk' });
  assert.equal(greeting.status, 200);
  assert.equal(greeting.body.source, 'greeting');
  assert.equal(calls.length, 0);
});

test('the generation deadline aborts every unfinished SDK transport and stays bounded', async () => {
  mockProvider((_model, _body, options) => new Promise((_resolve, reject) => {
    options.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }));
  const started = performance.now();
  await assert.rejects(generateGeminiWithFallback({
    ai: new GoogleGenAI({ apiKey: 'test-only-fake-key' }), contents: 'Test', config: {}, timeoutMs: 10, totalTimeoutMs: 25,
  }), (error: unknown) => error instanceof AIRequestError && error.code === 'TIMEOUT');
  assert.ok(performance.now() - started < 500);
  assert.ok(calls.length >= 1 && calls.length <= 3);
  assert.ok(calls.every(call => call.signal?.aborted));
});

test('structured API key reasons and malformed request failures are categorized without disclosure', () => {
  const invalid = classifyAIRequestError({ status: 400, message: JSON.stringify({ error: { details: [{ reason: 'API_KEY_INVALID' }] } }) });
  assert.equal(invalid.code, 'INVALID_API_KEY');
  assert.equal(classifyAIRequestError({ status: 400, message: 'responseSchema not supported' }).code, 'INVALID_AI_REQUEST');
  const failure = aiRequestFailure(invalid, false);
  assert.equal(failure.status, 401);
  assert.match(failure.body.error, /No changes were prepared or applied/);
});
