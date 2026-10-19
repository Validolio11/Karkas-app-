import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { AIRequestError, AIStreamInterruptedError, resetModelHealthForTests, streamGeminiWithFallback } from './geminiGeneration.ts';
import { createSSEParser, type AIStreamEvent } from '../src/utils/aiEventStream.ts';

const originalFetch = globalThis.fetch;
const originalAutostart = process.env.KARKAS_SERVER_AUTOSTART;
const originalKey = process.env.GEMINI_API_KEY;
let server: typeof import('../server.ts');
let provider: typeof fetch;
const calls: { model: string; streaming: boolean; body: any; signal?: AbortSignal }[] = [];

before(async () => {
  process.env.KARKAS_SERVER_AUTOSTART = 'false';
  process.env.GEMINI_API_KEY = '';
  // Keep the real SDK and replace only its HTTP transport; the client-facing SSE protocol is exercised below.
  globalThis.fetch = ((url: any, options: RequestInit) => provider(url, options)) as typeof fetch;
  server = await import('../server.ts');
});

after(() => {
  globalThis.fetch = originalFetch;
  if (originalAutostart === undefined) delete process.env.KARKAS_SERVER_AUTOSTART;
  else process.env.KARKAS_SERVER_AUTOSTART = originalAutostart;
  if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalKey;
});

type Respond = (call: { model: string; streaming: boolean; body: any; signal?: AbortSignal; index: number }) => Response | Promise<Response>;
function mockProvider(respond: Respond) {
  calls.length = 0;
  resetModelHealthForTests();
  provider = (async (url: any, options: RequestInit) => {
    const match = /models\/([^:]+):(streamGenerateContent\?alt=sse|generateContent)/.exec(String(url));
    assert.ok(match, String(url));
    const call = { model: match[1], streaming: match[2].startsWith('stream'), body: JSON.parse(String(options.body)), signal: options.signal ?? undefined };
    calls.push(call);
    return respond({ ...call, index: calls.length - 1 });
  }) as typeof fetch;
}

const json = (data: any, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const rejected = (status: number, providerStatus: string) => json({ error: { code: status, status: providerStatus, message: 'private provider detail' } }, status);

const base = { action: 'chat', lang: 'uk', customApiKey: 'test-only-fake-key', selectedModel: 'gemini-3.1-flash-lite',
  clientClock: { now: '2026-10-12T09:00:00.000Z', timeZone: 'Europe/Kyiv' } };
// Help and general messages use the agent path too.
const HELP = 'Поясни, що таке техніка помодоро';

/** Minimal Express-like response that records SSE output. */
function fakeHttpResponse() {
  const listeners = new Map<string, Set<(...args: any[]) => void>>();
  const res: any = {
    statusCode: 200, headers: {} as Record<string, string>, chunks: [] as string[], writableEnded: false, destroyed: false, jsonBody: undefined,
    setHeader(name: string, value: string) { res.headers[name.toLowerCase()] = value; },
    flushHeaders() {},
    write(chunk: string) { res.chunks.push(chunk); return true; },
    end() { res.writableEnded = true; for (const listener of listeners.get('close') ?? []) listener(); },
    status(code: number) { res.statusCode = code; return res; },
    json(body: any) { res.jsonBody = body; res.writableEnded = true; return res; },
    on(event: string, listener: (...args: any[]) => void) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(listener); return res; },
    removeListener(event: string, listener: (...args: any[]) => void) { listeners.get(event)?.delete(listener); return res; },
    events(): AIStreamEvent[] {
      const events: AIStreamEvent[] = [];
      const parser = createSSEParser(event => events.push(event));
      parser.push(res.chunks.join('')); parser.end();
      return events;
    },
  };
  return res;
}
const httpAssist = async (body: any, signal?: AbortSignal) => {
  const res = fakeHttpResponse();
  await server.assistHandler({ body, signal, on() {}, removeListener() {} }, res);
  return res;
};

const agentBase = { ...base, pendingChanges: undefined };
const agentText = (text: string) => json({ candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 9 } });

test('ordinary chat sends agent tools and streams one final text delta followed by done', async () => {
  mockProvider(({ streaming, body }) => {
    assert.equal(streaming, false);
    assert.equal(body.generationConfig?.responseMimeType, undefined);
    assert.equal(body.generationConfig?.responseSchema, undefined);
    // The selected Flash Lite maps the agent's low effort to its supported minimal setting.
    assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingLevel: 'LOW' });
    const names = body.tools[0].functionDeclarations.map((entry: any) => entry.name);
    assert.ok(names.includes('find_tasks'));
    assert.ok(names.includes('set_countdown'));
    assert.ok(!names.some((name: string) => name.startsWith('propose_')));
    return agentText('Спробуйте коротку **прогулянку** після обіду.');
  });
  const res = await httpAssist({ ...agentBase, prompt: HELP, stream: true });
  assert.match(res.headers['content-type'], /text\/event-stream/);
  assert.equal(res.writableEnded, true);
  const events = res.events();
  assert.deepEqual(events.map((event: AIStreamEvent) => event.event), ['delta', 'done']);
  assert.equal(events[0].data.text, 'Спробуйте коротку **прогулянку** після обіду.');
  const done = events[1].data;
  assert.equal(done.text, events[0].data.text);
  assert.equal(done.reply, done.text);
  assert.equal(done.summary, done.text);
  assert.deepEqual(done.agent.actions, []);
  assert.deepEqual(done.agent.pendingConfirmations, []);
  assert.deepEqual([done.tasks, done.tabs, done.taskUpdates, done.taskDeletions, done.insights], [[], [], [], [], []]);
  assert.equal(done.source, 'gemini-chat');
  assert.equal(done.usedModel, 'gemini-3.1-flash-lite');
  assert.equal(done.fallbackUsed, false);
  assert.ok(done.workInsights);
  assert.equal(done.aiMetrics.promptTokens, 120);
  assert.equal(calls.length, 1);
});

test('the desktop bridge forwards the agent final delta and returns the same unary text', async () => {
  mockProvider(() => agentText('Таймер запускається кнопкою.'));
  const deltas: string[] = [];
  const result = await server.invokeDesktopApi('assist', { ...agentBase, prompt: 'Як працює таймер у застосунку?', stream: true }, { onStreamDelta: text => deltas.push(text) });
  assert.equal(result.status, 200);
  assert.deepEqual(deltas, ['Таймер запускається кнопкою.']);
  assert.equal(result.body.text, deltas[0]);
  mockProvider(({ streaming }) => {
    assert.equal(streaming, false);
    return agentText('Звичайна відповідь');
  });
  const resultWithoutCallback = await server.invokeDesktopApi('assist', { ...agentBase, prompt: 'Як працює таймер у застосунку?', stream: true });
  assert.equal(resultWithoutCallback.body.text, 'Звичайна відповідь');
});

test('an agent provider failure falls back before emitting its single final delta', async () => {
  mockProvider(({ index }) => index === 0 ? rejected(503, 'UNAVAILABLE') : agentText('Відповідь резервної моделі.'));
  const res = await httpAssist({ ...agentBase, prompt: HELP, stream: true });
  const events = res.events();
  assert.deepEqual(events.map((event: AIStreamEvent) => event.event), ['delta', 'done']);
  assert.equal(events[1].data.text, 'Відповідь резервної моделі.');
  assert.equal(events[1].data.fallbackUsed, true);
  assert.deepEqual(calls.map(call => call.streaming), [false, false]);
});

test('clock replies and invalid requests finish without calling the provider', async () => {
  mockProvider(() => assert.fail('A clock reply must not call the provider'));
  const clock = await httpAssist({ ...agentBase, prompt: 'Котра година?', stream: true });
  assert.deepEqual(clock.events().map((event: AIStreamEvent) => event.event), ['done']);
  assert.equal(clock.events()[0].data.source, 'client-clock');
  const invalid = await httpAssist({ ...agentBase, prompt: '', stream: true });
  assert.deepEqual(invalid.events().map((event: AIStreamEvent) => [event.event, event.data.status]), [['error', 400]]);
});

test('a bare greeting is answered without the provider and keeps the final stream contract', async () => {
  mockProvider(() => agentText('Привіт!'));
  const res = await httpAssist({ ...agentBase, prompt: 'Привіт', stream: true });
  const events = res.events();
  assert.equal(events.at(-1).event, 'done');
  assert.equal(events.at(-1).data.source, 'greeting');
  assert.equal(calls.length, 0);
});

test('an agent provider rejection produces only the safe error event', async () => {
  mockProvider(() => rejected(401, 'UNAUTHENTICATED'));
  const res = await httpAssist({ ...agentBase, prompt: HELP, stream: true });
  const events = res.events();
  assert.deepEqual(events.map((event: AIStreamEvent) => event.event), ['error']);
  assert.equal(events[0].data.code, 'INVALID_API_KEY');
  assert.equal(events[0].data.status, 401);
  assert.doesNotMatch(JSON.stringify(events), /test-only-fake-key|private provider detail/);
  assert.equal(calls.length, 1);
});

test('cancelling an agent round aborts its transport without a final event', async () => {
  const controller = new AbortController();
  mockProvider(({ signal }) => new Promise<Response>((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    controller.abort();
  }));
  const res = await httpAssist({ ...agentBase, prompt: HELP, stream: true }, controller.signal);
  assert.deepEqual(res.events(), []);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].signal?.aborted, true);
});

// Direct unit tests of the streaming fallback rules with a fake SDK client.
function fakeAi(streams: Record<string, () => AsyncGenerator<any>>) {
  const requested: string[] = [];
  return { requested, ai: { models: { generateContentStream: async ({ model }: any) => { requested.push(model); return streams[model](); } } } as any };
}
const chunk = (text: string) => ({ text, usageMetadata: undefined });

test('time to first chunk is bounded per model and a silent model falls back', async () => {
  resetModelHealthForTests();
  const { ai, requested } = fakeAi({
    silent: async function* () { await new Promise(() => {}); },
    ok: async function* () { yield chunk('fast'); },
  });
  const deltas: string[] = [];
  const result = await streamGeminiWithFallback({ ai, contents: 'x', config: {}, selectedModel: 'silent', fallbackModels: ['ok'],
    timeoutMs: 30, idleTimeoutMs: 30, totalTimeoutMs: 1000, onText: text => deltas.push(text) });
  assert.deepEqual(requested, ['silent', 'ok']);
  assert.deepEqual(deltas, ['fast']);
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.metrics.attempts, 2);
});

test('an idle gap after the first chunk times out without fallback and keeps the partial text', async () => {
  resetModelHealthForTests();
  const { ai, requested } = fakeAi({
    stall: async function* () { yield chunk('partial'); await new Promise(() => {}); },
    ok: async function* () { yield chunk('never'); },
  });
  const deltas: string[] = [];
  await assert.rejects(streamGeminiWithFallback({ ai, contents: 'x', config: {}, selectedModel: 'stall', fallbackModels: ['ok'],
    timeoutMs: 500, idleTimeoutMs: 30, totalTimeoutMs: 1000, onText: text => deltas.push(text) }), (error: unknown) => {
    assert.ok(error instanceof AIStreamInterruptedError);
    assert.equal(error.code, 'TIMEOUT');
    assert.equal(error.partialText, 'partial');
    assert.deepEqual(error.diagnostics?.attempts.map(attempt => attempt.model), ['stall']);
    return true;
  });
  assert.deepEqual(requested, ['stall']);
  assert.deepEqual(deltas, ['partial']);
});

test('an empty stream may fall back, and parent cancellation never starts another attempt', async () => {
  resetModelHealthForTests();
  const { ai, requested } = fakeAi({
    empty: async function* () { yield chunk(''); },
    ok: async function* () { yield chunk('text'); },
  });
  const result = await streamGeminiWithFallback({ ai, contents: 'x', config: { responseMimeType: 'application/json', responseSchema: {} },
    selectedModel: 'empty', fallbackModels: ['ok'], onText: () => {} });
  assert.equal(result.text, 'text');
  assert.deepEqual(requested, ['empty', 'ok']);

  const controller = new AbortController();
  const hanging = fakeAi({ first: async function* () { await new Promise(() => {}); }, second: async function* () { yield chunk('no'); } });
  const pending = streamGeminiWithFallback({ ai: hanging.ai, contents: 'x', config: {}, selectedModel: 'first', fallbackModels: ['second'],
    signal: controller.signal, onText: () => {} });
  setTimeout(() => controller.abort(new DOMException('cancelled', 'AbortError')), 10);
  await assert.rejects(pending, { name: 'AbortError' });
  assert.deepEqual(hanging.requested, ['first']);
  assert.ok(!(new AIRequestError('TIMEOUT') instanceof AIStreamInterruptedError));
});

const READING = [{ id: 't', title: 'Читання', done: false, pinned: false, phase: 'focus', priority: 2, steps: 0, currentStep: 0, createdAt: 1 },
  { id: 'x', title: 'Інше', done: false, pinned: false, phase: 'focus', priority: 2, steps: 0, currentStep: 0, createdAt: 1 }];
const call = (name: string, args: any) => ({ functionCall: { name, args } });
const unary = (parts: any[]) => json({ candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 5 } });
const jsonProposal = (proposal: any) => unary([{ text: JSON.stringify(proposal) }]);

test('agent declarations are static and action tools replace the legacy proposal schema', async () => {
  const declarations: string[] = [];
  for (const prompt of ['Додай завдання Ескіз', 'Постав таймер Читання на 25 хвилин']) {
    mockProvider(({ body }) => {
      declarations.push(JSON.stringify(body.tools));
      assert.equal(body.generationConfig.responseSchema, undefined);
      assert.ok(body.tools[0].functionDeclarations.some((entry: any) => entry.name === 'create_task'));
      return unary([{ text: 'Гаразд.' }]);
    });
    assert.equal((await httpAssist({ ...agentBase, prompt, currentTasks: READING })).statusCode, 200);
  }
  assert.equal(declarations[0], declarations[1]);
});

test('invalid agent arguments return an error to the same model which can recover', async () => {
  mockProvider(({ index, body }) => {
    if (index === 0) return unary([call('set_countdown', { taskId: 't', minutes: -1 })]);
    const response = body.contents.at(-1).parts[0].functionResponse;
    assert.equal(response.name, 'set_countdown');
    assert.equal(response.response.ok, false);
    assert.equal(response.response.code, 'invalid');
    return unary([{ text: 'Тривалість має бути додатною.' }]);
  });
  const res = await httpAssist({ ...agentBase, prompt: 'Постав таймер Читання', currentTasks: READING, stream: true });
  assert.deepEqual(res.events().map((event: AIStreamEvent) => event.event), ['delta', 'done']);
  const done = res.events()[1].data;
  assert.deepEqual(done.agent.actions, []);
  assert.equal(done.fallbackUsed, false);
  assert.equal(calls.length, 2);
});

test('destructive agent calls remain pending confirmations without applied actions', async () => {
  mockProvider(({ index, body }) => {
    if (index === 0) return unary([call('find_tasks', { query: 'Читання' })]);
    if (index === 1) return unary([call('delete_task', { taskId: 't', reason: 'cancelled' })]);
    const response = body.contents.at(-1).parts[0].functionResponse.response;
    assert.equal(response.code, 'needs_confirmation');
    assert.equal(response.awaitingConfirmation, true);
    return unary([{ text: 'Підтвердьте видалення «Читання».' }]);
  });
  const result = await server.invokeDesktopApi('assist', { ...agentBase, prompt: 'Видали Читання', currentTasks: READING });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.agent.actions, []);
  assert.deepEqual(result.body.agent.pendingConfirmations, [{ type: 'delete_task', taskId: 't', reason: 'cancelled' }]);
});

test('ask_user returns concrete clarification options and stops before another provider round', async () => {
  const clarification = { question: 'Для якого завдання?', options: [
    { label: 'Читання', message: 'Постав таймер на 25 хвилин для «Читання»' },
    { label: 'Інше', message: 'Постав таймер на 25 хвилин для «Інше»' },
  ] };
  mockProvider(() => unary([call('ask_user', clarification)]));
  const res = await httpAssist({ ...agentBase, prompt: 'Постав таймер на 25 хвилин', currentTasks: READING, stream: true });
  const done = res.events().at(-1)!.data;
  assert.deepEqual(done.agent.clarification, clarification);
  assert.equal(done.text, clarification.question);
  assert.equal(calls.length, 1);
});

test('an accepted offer reaches the agent with the conversation and already stated values', async () => {
  const offer = 'Додати до «Читання» крок «Відкрити книгу» на 15 хвилин?';
  mockProvider(({ body }) => {
    assert.ok(body.tools);
    const history = JSON.stringify(body.contents);
    assert.match(history, /Відкрити книгу/);
    assert.match(history, /15 хвилин/);
    assert.match(history, /Так, додай/);
    return unary([{ text: 'Додам крок після уточнення завдання.' }]);
  });
  const result = await server.invokeDesktopApi('assist', { ...agentBase, prompt: 'Так, додай', currentTasks: READING,
    conversation: [{ role: 'user', content: 'Як почати читати?' }, { role: 'assistant', content: offer }] });
  assert.equal(result.status, 200);
  assert.ok(result.body.agent);
  assert.equal(calls.length, 1);
});

test('agent personal handoff answers the same message through the existing personal flow', async () => {
  const prompt = 'Мені потрібна допомога з мотивацією';
  mockProvider(({ index, body }) => {
    if (index === 0) return unary([call('open_personal_coaching', { reason: 'Motivation and life goals' })]);
    assert.match(body.systemInstruction.parts[0].text, /PERSONAL_DISCOVERY RULES/);
    assert.match(JSON.stringify(body.contents), /Мені потрібна допомога з мотивацією/);
    return jsonProposal({ reply: 'Що зараз найбільше заважає почати?', memoryPatch: { discovery: {} } });
  });
  const result = await server.invokeDesktopApi('assist', { ...agentBase, prompt });
  assert.equal(result.status, 200);
  assert.equal(result.body.agent.handoff, 'personal');
  assert.equal(result.body.aiMetrics.promptTokens, 100);
  assert.equal(result.body.aiMetrics.toolCalls, 1);
  assert.ok(result.body.reply);
  assert.equal(calls.length, 2);
});

test('the discovery interview runs only in the explicit discovery mode', async () => {
  const prompt = 'В мене жахлива прокрастинація, не можу почати працювати';
  mockProvider(() => unary([{ text: 'Почніть з найменшого кроку.' }]));
  await httpAssist({ ...agentBase, prompt, currentTasks: READING, stream: true });
  assert.doesNotMatch(calls[0].body.systemInstruction.parts[0].text, /PERSONAL_DISCOVERY RULES/);
  assert.ok(calls[0].body.tools);
  mockProvider(() => jsonProposal({ memoryPatch: { discovery: {} } }));
  await httpAssist({ ...agentBase, prompt, currentTasks: READING, stream: true, discoveryMode: true });
  assert.match(calls[0].body.systemInstruction.parts[0].text, /PERSONAL_DISCOVERY RULES/);
  // A clear command in discovery mode is still handled by the task agent.
  mockProvider(() => unary([{ text: 'Додам кроки після читання завдання.' }]));
  await httpAssist({ ...agentBase, prompt: 'Розбий завдання Читання на кроки', currentTasks: READING, stream: true, discoveryMode: true });
  assert.ok(calls[0].body.tools[0].functionDeclarations.some((entry: any) => entry.name === 'add_steps'));
});

// Agent tool rounds stay private; only the final answer is emitted to the client.
const agentTask = { id: 'agent-task', title: 'Робота над анімацією', phase: 'focus', priority: 2,
  steps: 3, currentStep: 0, done: false, pinned: false, createdAt: 1,
  timerMode: 'countdown', countdownDurationSeconds: 3600, countdownRemainingSeconds: 3600, timerRunning: false };

test('agent tool rounds return applied actions in done without streaming intermediate prose', async () => {
  const actions = [call('set_countdown', { taskId: 'agent-task', minutes: 180, start: false }),
    call('set_step_done', { taskId: 'agent-task', step: 3, done: true })];
  mockProvider(({ index, body }) => {
    assert.equal(calls[index].streaming, false);
    if (index === 0) return unary([{ text: 'Перевіряю завдання.' }, call('find_tasks', { query: 'анімація' })]);
    if (index === 1) {
      assert.equal(body.contents.at(-2).role, 'model');
      assert.equal(body.contents.at(-1).role, 'user');
      assert.equal(body.contents.at(-1).parts[0].functionResponse.name, 'find_tasks');
      return unary(actions);
    }
    assert.deepEqual(body.contents.at(-1).parts.map((part: any) => part.functionResponse.name), ['set_countdown', 'set_step_done']);
    return unary([{ text: 'Встановлено 3 години та завершено третій етап.' }]);
  });
  const before = structuredClone(agentTask);
  const res = await httpAssist({ ...agentBase, prompt: 'Збільш час роботи над анімацією до 3х годин і заверш 3 етап',
    currentTasks: [agentTask], tabs: [{ id: 'focus', name: 'Робота' }], stream: true });
  const events = res.events();
  assert.deepEqual(events.map((event: AIStreamEvent) => event.event), ['delta', 'done']);
  assert.equal(events[0].data.text, 'Встановлено 3 години та завершено третій етап.');
  assert.deepEqual(events[1].data.agent.actions.map((entry: any) => entry.action), [
    { type: 'set_countdown', taskId: 'agent-task', minutes: 180, start: false },
    { type: 'set_step_done', taskId: 'agent-task', step: 3, done: true },
  ]);
  assert.deepEqual(events[1].data.agent.pendingConfirmations, []);
  assert.deepEqual(agentTask, before);
  assert.equal(calls.length, 3);
});

test('agentConfirm applies a confirmed action without a model request', async () => {
  mockProvider(() => assert.fail('Confirmation must not invoke the provider'));
  const pending = { type: 'delete_task', taskId: 'agent-task', reason: 'cancelled' };
  const result = await server.invokeDesktopApi('assist', { ...agentBase, customApiKey: undefined, prompt: undefined,
    agentConfirm: pending, confirmed: true, currentTasks: [agentTask], tabs: [{ id: 'focus', name: 'Робота' }] });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.agent.actions[0].action, pending);
  assert.deepEqual(result.body.agent.actions[0].changedTaskIds, ['agent-task']);
  assert.equal(typeof result.body.agent.actions[0].summary.uk, 'string');
  assert.equal(calls.length, 0);
});

test('agentConfirm rejects missing consent, invalid arguments and malformed workspace before transport', async () => {
  mockProvider(() => assert.fail('Invalid confirmation must not invoke the provider'));
  const request = { ...agentBase, prompt: undefined, agentConfirm: { type: 'delete_task', taskId: 'agent-task' },
    confirmed: true, currentTasks: [agentTask] };
  for (const patch of [
    { confirmed: false }, { confirmed: undefined }, { agentConfirm: { type: 'delete_task', taskId: 'agent-task', confirmed: true } },
    { agentConfirm: { type: 'delete_task', taskId: 12 } }, { deletedTasks: {} }, { notes: [null] },
    { currentTasks: [{ ...agentTask, pinned: 'yes' }] },
  ]) {
    const result = await server.invokeDesktopApi('assist', { ...request, ...patch });
    assert.equal(result.status, 400, JSON.stringify(patch));
  }
  assert.equal(calls.length, 0);
});


test('successful agent actions survive a personal handoff provider failure in the final done event', async () => {
  mockProvider(({ index }) => {
    if (index === 0) return unary([call('find_tasks', { query: 'анімація' })]);
    if (index === 1) return unary([
      call('set_countdown', { taskId: 'agent-task', minutes: 180, start: false }),
      call('open_personal_coaching', { reason: 'Help with motivation after updating the task' }),
    ]);
    return rejected(401, 'UNAUTHENTICATED');
  });
  const res = await httpAssist({ ...agentBase, prompt: 'Збільш час роботи над анімацією до 3 годин і допоможи з мотивацією',
    currentTasks: [agentTask], stream: true });
  const events = res.events();
  assert.deepEqual(events.map((event: AIStreamEvent) => event.event), ['delta', 'done']);
  const done = events[1].data;
  assert.equal(res.statusCode, 200);
  assert.equal(done.agent.handoff, 'personal');
  assert.deepEqual(done.agent.actions.map((entry: any) => entry.action), [
    { type: 'set_countdown', taskId: 'agent-task', minutes: 180, start: false },
  ]);
  assert.ok(done.text.includes(done.agent.actions[0].summary.uk));
  assert.match(done.text, /ключ API/);
  assert.doesNotMatch(done.text, /Зміни не підготовлено й не застосовано|No changes were prepared or applied/);
  assert.doesNotMatch(done.text, /test-only-fake-key|private provider detail/);
  assert.equal(calls.length, 3);
});

test('cancelling in the final personal handoff delta prevents the done event', async () => {
  const controller = new AbortController();
  mockProvider(({ index }) => index === 0
    ? unary([call('open_personal_coaching', { reason: 'Motivation and life goals' })])
    : jsonProposal({ memoryPatch: { discovery: {} } }));
  const res = fakeHttpResponse();
  const write = res.write;
  res.write = (chunk: string) => {
    const result = write(chunk);
    if (chunk.includes('event: delta')) controller.abort(new DOMException('cancelled', 'AbortError'));
    return result;
  };
  await server.assistHandler({ body: { ...agentBase, prompt: 'Мені потрібна допомога з мотивацією', stream: true },
    signal: controller.signal, on() {}, removeListener() {} }, res);
  assert.deepEqual(res.events().map((event: AIStreamEvent) => event.event), ['delta']);
  assert.equal(controller.signal.aborted, true);
  assert.equal(calls.length, 2);
});


test('personal handoff reads the updated task snapshot and includes successful action summaries', async () => {
  mockProvider(({ index, body }) => {
    if (index === 0) return unary([call('find_tasks', { query: 'анімація' })]);
    if (index === 1) return unary([
      call('update_task', { taskId: 'agent-task', plannedDate: '2026-10-12' }),
      call('open_personal_coaching', { reason: 'Motivation after scheduling the task' }),
    ]);
    const context = body.contents.flatMap((turn: any) => turn.parts.map((part: any) => part.text ?? '')).join('\n');
    assert.match(context, /"plannedTodayUnfinished":1/);
    return jsonProposal({ memoryPatch: { discovery: {} } });
  });
  const result = await server.invokeDesktopApi('assist', { ...agentBase,
    prompt: 'Заплануй анімацію на сьогодні й допоможи з мотивацією', currentTasks: [agentTask] });
  assert.equal(result.status, 200);
  assert.equal(result.body.agent.handoff, 'personal');
  assert.ok(result.body.text.includes(result.body.agent.actions[0].summary.uk));
  assert.equal(result.body.reply, result.body.text);
  assert.equal(calls.length, 3);
});
