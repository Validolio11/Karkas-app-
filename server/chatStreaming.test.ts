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
  // The real SDK runs; only its HTTP transport is replaced, so the streaming path
  // (`:streamGenerateContent?alt=sse`) and SSE chunk parsing are exercised.
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

const encoder = new TextEncoder();
/** A string chunk is one text part; an array chunk lists raw parts (e.g. functionCall). */
type Chunk = string | any[];
const chunkFrame = (chunk: Chunk, extra: any = {}) => `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: typeof chunk === 'string' ? [{ text: chunk }] : chunk } }], ...extra })}\r\n\r\n`;
/** A provider SSE body; `fail` errors the body after the listed chunks, `hang` never ends it. */
function sseResponse(chunks: Chunk[], { fail, hang, signal }: { fail?: Error; hang?: boolean; signal?: AbortSignal } = {}) {
  let next = 0;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      signal?.addEventListener('abort', () => { try { controller.error(new DOMException('aborted', 'AbortError')); } catch { /* closed */ } });
    },
    // One provider event per read, so a later failure cannot discard earlier chunks.
    pull(controller) {
      if (next < chunks.length) {
        const index = next++;
        controller.enqueue(encoder.encode(chunkFrame(chunks[index], index === chunks.length - 1
          ? { usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 9 } } : {})));
      } else if (fail) controller.error(fail);
      else if (!hang) controller.close();
      else return new Promise<void>(() => {});
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}
const json = (data: any, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const rejected = (status: number, providerStatus: string) => json({ error: { code: status, status: providerStatus, message: 'private provider detail' } }, status);

const base = { action: 'chat', lang: 'uk', customApiKey: 'test-only-fake-key', selectedModel: 'gemini-3.1-flash-lite',
  clientClock: { now: '2026-10-12T09:00:00.000Z', timeZone: 'Europe/Kyiv' } };
const GENERAL = 'Як мені краще зосередитись після обіду?';

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

test('a read-only route streams plain text deltas, then a done event with the full final body', async () => {
  mockProvider(({ streaming, body }) => {
    assert.equal(streaming, true);
    assert.equal(body.generationConfig?.responseMimeType, undefined);
    assert.equal(body.generationConfig?.responseSchema, undefined);
    const system = body.systemInstruction.parts[0].text;
    assert.match(system, /OUTPUT FORMAT: reply directly/);
    assert.doesNotMatch(system, /Return strictly valid JSON/);
    assert.doesNotMatch(system, /OPERATION FIELDS/);
    // Same thinking config as the unary path for this route (general: minimal).
    assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingLevel: 'MINIMAL' });
    return sseResponse(['Спробуйте ', 'коротку **прогулянку**', ' після обіду.']);
  });
  const res = await httpAssist({ ...base, prompt: GENERAL, stream: true });
  assert.match(res.headers['content-type'], /text\/event-stream/);
  assert.equal(res.writableEnded, true);
  const events = res.events();
  assert.deepEqual(events.map((event: AIStreamEvent) => event.event), ['delta', 'delta', 'delta', 'done']);
  assert.deepEqual(events.slice(0, 3).map((event: AIStreamEvent) => event.data.text), ['Спробуйте ', 'коротку **прогулянку**', ' після обіду.']);
  const done = events[3].data;
  assert.equal(done.reply, 'Спробуйте коротку **прогулянку** після обіду.');
  assert.equal(done.summary, done.reply);
  assert.deepEqual([done.tasks, done.tabs, done.taskUpdates, done.taskDeletions, done.insights], [[], [], [], [], []]);
  assert.equal(done.source, 'gemini-chat');
  assert.equal(done.usedModel, 'gemini-3.1-flash-lite');
  assert.equal(done.fallbackUsed, false);
  assert.ok(done.workInsights);
  assert.equal(typeof done.aiMetrics.timeToFirstTokenMs, 'number');
  assert.equal(done.aiMetrics.promptTokens, 120);
  assert.equal(done.replyReplaced, undefined);
  assert.equal(calls.length, 1);
});

test('the desktop bridge forwards deltas through its callback and returns the final body', async () => {
  mockProvider(() => sseResponse(['Таймер ', 'запускається кнопкою.']));
  const deltas: string[] = [];
  const result = await server.invokeDesktopApi('assist', { ...base, prompt: 'Як працює таймер у застосунку?', stream: true }, { onStreamDelta: text => deltas.push(text) });
  assert.equal(result.status, 200);
  assert.deepEqual(deltas, ['Таймер ', 'запускається кнопкою.']);
  assert.equal(result.body.reply, 'Таймер запускається кнопкою.');
  // Without a delta callback the bridge keeps the unary JSON path.
  mockProvider(({ streaming }) => {
    assert.equal(streaming, false);
    return json({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify({ reply: 'JSON reply' }) }] }, finishReason: 'STOP' }] });
  });
  const unary = await server.invokeDesktopApi('assist', { ...base, prompt: 'Як працює таймер у застосунку?', stream: true });
  assert.equal(unary.body.reply, 'JSON reply');
});

test('a model that fails before its first chunk falls back; only the fallback text is streamed', async () => {
  mockProvider(({ index }) => index === 0 ? rejected(503, 'UNAVAILABLE') : sseResponse(['Відповідь резервної моделі.']));
  const res = await httpAssist({ ...base, prompt: GENERAL, stream: true });
  const events = res.events();
  assert.deepEqual(events.map((event: AIStreamEvent) => event.event), ['delta', 'done']);
  assert.equal(events[1].data.reply, 'Відповідь резервної моделі.');
  assert.equal(events[1].data.fallbackUsed, true);
  assert.notEqual(events[1].data.usedModel, 'gemini-3.1-flash-lite');
  assert.deepEqual(calls.map(call => call.streaming), [true, true]);
});

test('a failure after text was emitted ends with an error event and never tries another model', async () => {
  mockProvider(() => sseResponse(['Перша частина відповіді'], { fail: new TypeError('fetch failed') }));
  const res = await httpAssist({ ...base, prompt: GENERAL, stream: true });
  const events = res.events();
  assert.deepEqual(events.map((event: AIStreamEvent) => event.event), ['delta', 'error']);
  assert.equal(events[0].data.text, 'Перша частина відповіді');
  const error = events[1].data;
  assert.equal(error.code, 'NETWORK_ERROR');
  assert.equal(error.status, 503);
  assert.equal(error.partial, true);
  assert.match(error.error, /Не вдалося підключитися до Google/);
  assert.doesNotMatch(JSON.stringify(error), /test-only-fake-key|private provider detail/);
  assert.equal(calls.length, 1);
});

test('reply guards run on the final text and the done payload carries the replacement', async () => {
  mockProvider(() => sseResponse(['Я переніс ', 'ваше завдання на завтра.']));
  const res = await httpAssist({ ...base, prompt: GENERAL, stream: true });
  const events = res.events();
  assert.deepEqual(events.map((event: AIStreamEvent) => event.event), ['delta', 'delta', 'done']);
  const done = events[2].data;
  assert.equal(done.replyReplaced, true);
  assert.doesNotMatch(done.reply, /Я переніс/);
  assert.match(done.reply, /нічого не застосовано/);
  assert.deepEqual(done.taskUpdates, []);
});

test('canned replies and invalid requests return a single final event without calling the provider', async () => {
  mockProvider(() => assert.fail('A canned reply must not call the provider'));
  for (const prompt of ['Привіт', 'Котра година?']) {
    const canned = await httpAssist({ ...base, prompt, stream: true });
    const events = canned.events();
    assert.deepEqual(events.map((event: AIStreamEvent) => event.event), ['done'], prompt);
    assert.ok(events[0].data.reply);
  }
  const invalid = await httpAssist({ ...base, prompt: '', stream: true });
  assert.deepEqual(invalid.events().map((event: AIStreamEvent) => [event.event, event.data.status]), [['error', 400]]);
});

test('a provider rejection before streaming becomes an error event with the safe failure body', async () => {
  mockProvider(() => rejected(401, 'UNAUTHENTICATED'));
  const res = await httpAssist({ ...base, prompt: GENERAL, stream: true });
  const events = res.events();
  assert.deepEqual(events.map((event: AIStreamEvent) => event.event), ['error']);
  assert.equal(events[0].data.code, 'INVALID_API_KEY');
  assert.equal(events[0].data.status, 401);
  assert.equal(events[0].data.partial, undefined);
  assert.equal(calls.length, 1);
});

test('cancelling mid-stream aborts the provider transport and sends no final event', async () => {
  const controller = new AbortController();
  mockProvider(({ signal }) => sseResponse(['Початок'], { hang: true, signal }));
  const res = fakeHttpResponse();
  const write = res.write;
  res.write = (chunk: string) => { const result = write(chunk); if (chunk.includes('event: delta')) controller.abort(); return result; };
  await server.assistHandler({ body: { ...base, prompt: GENERAL, stream: true }, signal: controller.signal, on() {}, removeListener() {} }, res);
  assert.deepEqual(res.events().map((event: AIStreamEvent) => event.event), ['delta']);
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

// ---- task_command: function calling (stage 3) ----
const READING = [{ id: 't', title: 'Читання', done: false, phase: 'focus', priority: 2, steps: 0, currentStep: 0, createdAt: 1 },
  { id: 'x', title: 'Інше', done: false, phase: 'focus', priority: 2, steps: 0, currentStep: 0, createdAt: 1 }];
const TIMER_PROMPT = 'Додай таймер на 25 хвилин до завдання Читання';
const call = (name: string, args: any) => ({ functionCall: { name, args } });
const timerCall = (seconds = 1500) => call('propose_update_task', { id: 't', timerMode: 'countdown', countdownDurationSeconds: seconds });
const unary = (parts: any[]) => json({ candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 5 } });
const jsonProposal = (proposal: any) => json({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(proposal) }] }, finishReason: 'STOP' }] });
const TIMER_UPDATE = [{ id: 't', timerMode: 'countdown', countdownDurationSeconds: 1500 }];
async function withToolsOff<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.KARKAS_AI_TOOLS;
  process.env.KARKAS_AI_TOOLS = 'off';
  try { return await run(); } finally {
    if (previous === undefined) delete process.env.KARKAS_AI_TOOLS;
    else process.env.KARKAS_AI_TOOLS = previous;
  }
}

test('task_command declares static tools with the JSON schema constraints and maps calls to the proposal shape', async () => {
  const declarationSets: string[] = [];
  mockProvider(({ streaming, body }) => {
    assert.equal(streaming, false);
    assert.equal(body.generationConfig?.responseMimeType, undefined);
    assert.equal(body.generationConfig?.responseSchema, undefined);
    assert.equal(body.toolConfig.functionCallingConfig.mode, 'AUTO');
    const declarations = body.tools[0].functionDeclarations;
    declarationSets.push(JSON.stringify(body.tools));
    assert.deepEqual(declarations.map((declaration: any) => declaration.name), ['propose_create_task', 'propose_update_task', 'propose_delete_task', 'propose_create_tab']);
    const byName = Object.fromEntries(declarations.map((declaration: any) => [declaration.name, declaration.parameters]));
    for (const name of ['propose_create_task', 'propose_update_task']) {
      assert.equal(byName[name].properties.countdownDurationSeconds.minimum, 60);
      assert.equal(byName[name].properties.countdownDurationSeconds.maximum, 86400);
      assert.deepEqual(byName[name].properties.schedule.required, ['startAt', 'recurrence', 'timeZone', 'leadMinutes']);
    }
    assert.deepEqual(byName.propose_create_task.required, ['title', 'phase', 'priority', 'steps']);
    assert.deepEqual(byName.propose_update_task.required, ['id']);
    assert.deepEqual(byName.propose_delete_task.properties.deletionReason.enum, ['accidental', 'cancelled']);
    const system = body.systemInstruction.parts[0].text;
    assert.match(system, /APPLICATION ACTION CONTRACT/);
    assert.match(system, /OPERATIONS ARE TOOL CALLS/);
    assert.doesNotMatch(system, /Return strictly valid JSON|OPERATION FIELDS/);
    assert.doesNotMatch(system, /Читання|25 хвилин/);
    return unary([{ text: 'Пропоную таймер на 25 хвилин для «Читання».' }, timerCall()]);
  });
  const result = await server.invokeDesktopApi('assist', { ...base, prompt: TIMER_PROMPT, currentTasks: READING });
  assert.equal(result.status, 200);
  assert.equal(result.body.reply, 'Пропоную таймер на 25 хвилин для «Читання».');
  assert.deepEqual(result.body.taskUpdates, TIMER_UPDATE);
  assert.deepEqual([result.body.tasks, result.body.tabs, result.body.taskDeletions], [[], [], []]);
  assert.equal(result.body.aiMetrics.toolCalls, 1);
  assert.equal(result.body.source, 'gemini-chat');
  // Different data, same static tool prefix.
  await server.invokeDesktopApi('assist', { ...base, prompt: 'Додай таймер на 10 хвилин до завдання Інше', currentTasks: READING });
  assert.equal(declarationSets.length, 2);
  assert.equal(declarationSets[0], declarationSets[1]);
});

test('task_command streams its prose, never the tool call, and ends with the validated proposal', async () => {
  mockProvider(({ streaming, body }) => {
    assert.equal(streaming, true);
    assert.ok(body.tools);
    return sseResponse(['Пропоную ', 'таймер на 25 хвилин.', [timerCall()]]);
  });
  const res = await httpAssist({ ...base, prompt: TIMER_PROMPT, currentTasks: READING, stream: true });
  const events = res.events();
  assert.deepEqual(events.map((event: AIStreamEvent) => event.event), ['delta', 'delta', 'done']);
  assert.doesNotMatch(JSON.stringify(events.slice(0, 2)), /propose_|functionCall|countdownDurationSeconds/);
  const done = events[2].data;
  assert.equal(done.reply, 'Пропоную таймер на 25 хвилин.');
  assert.equal(done.replyReplaced, undefined);
  assert.deepEqual(done.taskUpdates, TIMER_UPDATE);
  assert.equal(done.aiMetrics.toolCalls, 1);
  assert.equal(typeof done.aiMetrics.timeToFirstTokenMs, 'number');
  assert.equal(calls.length, 1);
});

test('tool calls outside the concrete command scope are dropped by the shared constraints', async () => {
  mockProvider(() => sseResponse(['Пропоную таймер.', [
    call('propose_create_task', { title: 'Unrequested', phase: 'focus', priority: 2, steps: 0 }),
    call('propose_delete_task', { id: 'y' }),
    call('propose_update_task', { id: 'x', timerMode: 'countdown', countdownDurationSeconds: 600 }),
    call('propose_update_task', { id: 't', timerMode: 'countdown', countdownDurationSeconds: 1500, title: 'Renamed' }),
    call('propose_create_tab', { id: 'extra', name: 'Extra' }),
  ]]));
  const res = await httpAssist({ ...base, prompt: TIMER_PROMPT, currentTasks: [...READING, { ...READING[1], id: 'y', title: 'Третє' }], stream: true });
  const done = res.events().at(-1)!;
  assert.equal(done.event, 'done');
  // Timer scope keeps only the in-scope task and only its timer fields.
  assert.deepEqual(done.data.taskUpdates, TIMER_UPDATE);
  assert.deepEqual([done.data.tasks, done.data.tabs, done.data.taskDeletions], [[], [], []]);
});

test('invalid tool arguments fall back to another model while no text was shown', async () => {
  for (const invalid of [[timerCall(40)], [call('propose_launch_rocket', { id: 't' })], [call('propose_update_task', { id: 'missing', done: true })], [call('propose_update_task', null)]]) {
    mockProvider(({ index }) => index === 0 ? sseResponse([invalid]) : sseResponse(['Пропоную таймер.', [timerCall()]]));
    const res = await httpAssist({ ...base, prompt: TIMER_PROMPT, currentTasks: READING, stream: true });
    const events = res.events();
    assert.deepEqual(events.map((event: AIStreamEvent) => event.event), ['delta', 'done'], JSON.stringify(invalid));
    assert.equal(events[1].data.fallbackUsed, true);
    assert.deepEqual(events[1].data.taskUpdates, TIMER_UPDATE);
    assert.equal(calls.length, 2);
  }
});

test('invalid tool arguments after streamed text end with an error and no operations, without another model', async () => {
  mockProvider(() => sseResponse(['Пропоную таймер на 40 секунд.', [timerCall(40)]]));
  const res = await httpAssist({ ...base, prompt: TIMER_PROMPT, currentTasks: READING, stream: true });
  const events = res.events();
  assert.deepEqual(events.map((event: AIStreamEvent) => event.event), ['delta', 'error']);
  assert.equal(events[1].data.code, 'INVALID_AI_RESPONSE');
  assert.equal(events[1].data.partial, true);
  assert.deepEqual(events[1].data.taskUpdates, []);
  assert.match(events[1].data.error, /не застосовано/);
  assert.equal(calls.length, 1);
  // Non-streaming callers saw no text, so the same output may still be repaired by a fallback model.
  mockProvider(({ index }) => unary([{ text: 'Пропоную таймер.' }, timerCall(index === 0 ? 40 : 1500)]));
  const repaired = await server.invokeDesktopApi('assist', { ...base, prompt: TIMER_PROMPT, currentTasks: READING });
  assert.equal(repaired.status, 200);
  assert.equal(repaired.body.fallbackUsed, true);
  assert.deepEqual(repaired.body.taskUpdates, TIMER_UPDATE);
  assert.equal(calls.length, 2);
});

test('a model that rejects function calling repeats the request on the JSON schema path', async () => {
  mockProvider(({ body }) => body.tools
    ? json({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Function calling is not enabled for this model.' } }, 400)
    : jsonProposal({ reply: 'Пропоную таймер.', taskUpdates: TIMER_UPDATE }));
  const res = await httpAssist({ ...base, prompt: TIMER_PROMPT, currentTasks: READING, stream: true });
  const events = res.events();
  assert.deepEqual(events.map((event: AIStreamEvent) => event.event), ['done']);
  assert.deepEqual(events[0].data.taskUpdates, TIMER_UPDATE);
  assert.deepEqual(calls.map(entry => [entry.streaming, Boolean(entry.body.tools), Boolean(entry.body.generationConfig?.responseSchema)]), [[true, true, false], [false, false, true]]);
  assert.match(calls[1].body.systemInstruction.parts[0].text, /Return strictly valid JSON/);
  // Any other invalid request stays an explicit failure.
  mockProvider(() => json({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Request contains an invalid argument.' } }, 400));
  const failed = await server.invokeDesktopApi('assist', { ...base, prompt: TIMER_PROMPT, currentTasks: READING });
  assert.equal(failed.body.code, 'INVALID_AI_REQUEST');
  assert.equal(calls.length, 1);
});

test('KARKAS_AI_TOOLS=off forces the forced-JSON path for task commands', () => withToolsOff(async () => {
  mockProvider(({ streaming, body }) => {
    assert.equal(streaming, false);
    assert.equal(body.tools, undefined);
    assert.ok(body.generationConfig.responseSchema.properties.taskUpdates);
    assert.match(body.systemInstruction.parts[0].text, /OPERATION FIELDS/);
    return jsonProposal({ reply: 'Пропоную таймер.', taskUpdates: TIMER_UPDATE });
  });
  const res = await httpAssist({ ...base, prompt: TIMER_PROMPT, currentTasks: READING, stream: true });
  const events = res.events();
  assert.deepEqual(events.map((event: AIStreamEvent) => event.event), ['done']);
  assert.deepEqual(events[0].data.taskUpdates, TIMER_UPDATE);
  assert.equal(calls.length, 1);
}));

test('a text-only clarifying answer streams and proposes no operations', async () => {
  mockProvider(() => sseResponse(['Для якого завдання ', 'додати таймер?']));
  const res = await httpAssist({ ...base, prompt: 'Додай таймер на 25 хвилин', currentTasks: READING, stream: true });
  const events = res.events();
  assert.deepEqual(events.map((event: AIStreamEvent) => event.event), ['delta', 'delta', 'done']);
  const done = events[2].data;
  assert.equal(done.reply, 'Для якого завдання додати таймер?');
  assert.deepEqual([done.tasks, done.tabs, done.taskUpdates, done.taskDeletions], [[], [], [], []]);
  assert.equal(done.aiMetrics.toolCalls, 0);
});

test('tool calls without text get a summary reply; claims of applied changes are rewritten', async () => {
  mockProvider(() => unary([{ text: 'Internal reasoning', thought: true }, timerCall()]));
  const silent = await server.invokeDesktopApi('assist', { ...base, prompt: TIMER_PROMPT, currentTasks: READING });
  assert.equal(silent.status, 200);
  assert.match(silent.body.reply, /Пропозиція готова: зміни в завданнях \(1\)/);
  assert.match(silent.body.reply, /Застосувати зміни/);
  assert.doesNotMatch(silent.body.reply, /Internal reasoning/);
  assert.equal(silent.body.summary, silent.body.reply);
  assert.deepEqual(silent.body.taskUpdates, TIMER_UPDATE);

  mockProvider(() => sseResponse(['Я додав таймер на 25 хвилин.', [timerCall()]]));
  const res = await httpAssist({ ...base, prompt: TIMER_PROMPT, currentTasks: READING, stream: true });
  const done = res.events().at(-1)!.data;
  assert.equal(done.replyReplaced, true);
  assert.doesNotMatch(done.reply, /Я додав/);
  assert.deepEqual(done.taskUpdates, TIMER_UPDATE);
});
