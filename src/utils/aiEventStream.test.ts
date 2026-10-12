import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createSSEParser, readAIEventStream, type AIStreamEvent } from './aiEventStream.ts';
import { karkasApiStream } from './desktopApi.ts';
import { AIChatText, settlePartialMarkdown } from '../components/AIChatText.tsx';
import { createStreamedReplyBuffer } from '../components/aiAssistantState.ts';

const encoder = new TextEncoder();
const bodyOf = (parts: string[]) => new ReadableStream<Uint8Array>({
  start(controller) { for (const part of parts) controller.enqueue(encoder.encode(part)); controller.close(); },
});
const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

test('the SSE parser reassembles events split across reads and CRLF framing', () => {
  const events: AIStreamEvent[] = [];
  const parser = createSSEParser(event => events.push(event));
  const text = frame('delta', { text: 'При' }) + ': keep-alive comment\n\n' + frame('delta', { text: 'віт\n\nрядок' }).replace(/\n/g, '\r\n') + frame('done', { reply: 'Привіт' });
  for (let index = 0; index < text.length; index += 7) parser.push(text.slice(index, index + 7));
  parser.end();
  assert.deepEqual(events, [
    { event: 'delta', data: { text: 'При' } },
    { event: 'delta', data: { text: 'віт\n\nрядок' } },
    { event: 'done', data: { reply: 'Привіт' } },
  ]);
});

test('a stream resolves to the final done body or the error status and body', async () => {
  const deltas: string[] = [];
  const done = await readAIEventStream(bodyOf([frame('delta', { text: 'a' }), frame('delta', { text: 'b' }), frame('done', { reply: 'ab!' })]), text => deltas.push(text));
  assert.deepEqual(deltas, ['a', 'b']);
  assert.equal(done.status, 200);
  assert.deepEqual(await done.json(), { reply: 'ab!' });

  const failed = await readAIEventStream(bodyOf([frame('delta', { text: 'partial' }), frame('error', { status: 504, code: 'TIMEOUT', error: 'Late', partial: true })]), () => {});
  assert.equal(failed.status, 504);
  assert.deepEqual(await failed.json(), { code: 'TIMEOUT', error: 'Late', partial: true });

  await assert.rejects(readAIEventStream(bodyOf([frame('delta', { text: 'cut' })]), () => {}), TypeError);
});

const installWindow = (desktop: unknown) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: desktop === undefined ? {} : { karkasDesktop: desktop } });
  return () => {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  };
};

test('browser mode reads SSE from fetch and passes plain JSON responses through', async () => {
  const restore = installWindow(undefined);
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response(bodyOf([frame('delta', { text: 'Hi' }), frame('done', { reply: 'Hi there' })]),
      { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } })) as typeof fetch;
    const deltas: string[] = [];
    const response = await karkasApiStream('/api/ai/assist', { method: 'POST', body: '{"stream":true}' }, text => deltas.push(text));
    assert.deepEqual(deltas, ['Hi']);
    assert.equal((await response.json()).reply, 'Hi there');

    globalThis.fetch = (async () => new Response('{"error":"Prompt is required"}', { status: 400, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
    const plain = await karkasApiStream('/api/ai/assist', { method: 'POST', body: '{}' }, () => assert.fail('No deltas'));
    assert.equal(plain.status, 400);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test('desktop streaming accepts only its own request deltas, unsubscribes and cancels natively', async () => {
  let listener: ((event: { requestId: string; text: string }) => void) | null = null;
  let unsubscribed = 0;
  const cancelled: string[] = [];
  let release!: (value: unknown) => void;
  const desktop = { ai: {
    onStreamDelta: (callback: typeof listener) => { listener = callback; return () => { unsubscribed++; listener = null; }; },
    assistStream: (input: any) => {
      assert.equal(input.prompt, 'hello');
      assert.match(input.desktopRequestId, /^[a-zA-Z0-9_-]{8,128}$/);
      listener!({ requestId: 'someone-else-request', text: 'foreign' });
      listener!({ requestId: input.desktopRequestId, text: 'Пер' });
      listener!({ requestId: input.desktopRequestId, text: 'ша' });
      return new Promise(resolve => { release = resolve; });
    },
    cancelRequest: async (id: string) => { cancelled.push(id); return { ok: true, value: { cancelled: true } }; },
  } };
  const restore = installWindow(desktop);
  try {
    const deltas: string[] = [];
    const pending = karkasApiStream('/api/ai/assist', { body: JSON.stringify({ prompt: 'hello', stream: true }) }, text => deltas.push(text));
    await new Promise(resolve => setImmediate(resolve));
    release({ ok: true, value: { status: 200, body: { reply: 'Перша' } } });
    const response = await pending;
    assert.deepEqual(deltas, ['Пер', 'ша']);
    assert.equal((await response.json()).reply, 'Перша');
    assert.equal(unsubscribed, 1);

    const controller = new AbortController();
    const aborted = karkasApiStream('/api/ai/assist', { body: JSON.stringify({ prompt: 'hello' }), signal: controller.signal }, text => deltas.push(text));
    await new Promise(resolve => setImmediate(resolve));
    controller.abort();
    await assert.rejects(aborted, { name: 'AbortError' });
    assert.equal(cancelled.length, 1);
    assert.equal(unsubscribed, 2);
    // A late fragment after cancellation is ignored.
    assert.equal(listener, null);
  } finally { restore(); }
});

test('an older desktop bridge without streaming still returns the final body', async () => {
  const restore = installWindow({ ai: { assist: async () => ({ ok: true, value: { status: 200, body: { reply: 'unary' } } }) } });
  try {
    const response = await karkasApiStream('/api/ai/assist', { body: '{"prompt":"x","stream":true}' }, () => assert.fail('No deltas'));
    assert.equal((await response.json()).reply, 'unary');
  } finally { restore(); }
});

test('streamed reply updates are batched to one publish per frame', () => {
  const frames: (() => void)[] = [];
  const published: string[] = [];
  const buffer = createStreamedReplyBuffer(text => published.push(text), callback => frames.push(callback), () => {});
  buffer.push('a'); buffer.push('b'); buffer.push('c');
  assert.equal(frames.length, 1);
  frames.shift()!();
  assert.deepEqual(published, ['abc']);
  buffer.push('d');
  buffer.stop();
  buffer.push('e');
  assert.equal(buffer.text, 'abcd');
  assert.deepEqual(published, ['abc']);
});

test('partial markdown in a streaming reply hides only dangling markers', () => {
  assert.equal(settlePartialMarkdown('**Готово** і **поч'), '**Готово** і поч');
  assert.equal(settlePartialMarkdown('Код `npm'), 'Код npm');
  assert.equal(settlePartialMarkdown('Слово *'), 'Слово ');
  assert.equal(settlePartialMarkdown('Повний **текст**'), 'Повний **текст**');
  const html = renderToStaticMarkup(React.createElement(AIChatText, { text: '1. Перший\n2. **Друг', streaming: true }));
  assert.ok(html.includes('<ol start="1"><li>Перший</li><li>Друг</li></ol>'));
  const fence = renderToStaticMarkup(React.createElement(AIChatText, { text: 'Приклад:\n```\nconst a = 1', streaming: true }));
  assert.ok(fence.includes('<pre><code>const a = 1</code></pre>'));
});
