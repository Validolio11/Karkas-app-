import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { GoogleGenAI } from '@google/genai';
import { createVoiceDictation, encodePcm, type VoicePhase } from './voiceDictation';

test('PCM clips samples and preserves little-endian signed values', () => {
  const bytes = Buffer.from(encodePcm(new Float32Array([-2, -1, 0, 1, 2])), 'base64');
  assert.deepEqual(Array.from({ length: 5 }, (_, i) => bytes.readInt16LE(i * 2)), [-32768, -32768, 0, 32767, 32767]);
});

test('worklet flush preserves the last incomplete audio packet', () => {
  let Processor: any;
  const packets: any[] = [];
  vm.runInNewContext(readFileSync(new URL('../../public/voice-capture.js', import.meta.url), 'utf8'), {
    AudioWorkletProcessor: class { port = { postMessage: (packet: any) => packets.push(packet), onmessage: null }; },
    registerProcessor: (_name: string, constructor: any) => { Processor = constructor; },
    Float32Array,
  });
  const capture = new Processor();
  capture.process([[new Float32Array([0.25, -0.5, 0.75])]]);
  assert.equal(packets.length, 0);
  capture.port.onmessage({ data: 'flush' });
  assert.deepEqual(Array.from(packets[0].samples), [0.25, -0.5, 0.75]);
  assert.equal(packets[0].flushed, true);
});

function environment(t: any, getUserMedia: () => Promise<any>, fetcher: typeof fetch, overrides: Record<string, unknown> = {}) {
  const globals: Record<string, unknown> = {
    window: {}, navigator: { mediaDevices: { getUserMedia } },
    localStorage: { getItem: () => null }, fetch: fetcher,
    cancelAnimationFrame: () => {},
    AudioContext: class { constructor() { throw new Error('Worklet unavailable'); } },
    MediaRecorder: class {
      static isTypeSupported() { return true; }
      state = 'inactive'; mimeType = 'audio/webm';
      ondataavailable?: (event: any) => void; onstop?: () => void;
      start() { this.state = 'recording'; }
      stop() {
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob([new Uint8Array(300)]) });
        this.onstop?.();
      }
    },
    ...overrides,
  };
  for (const [name, value] of Object.entries(globals)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete (globalThis as any)[name]; });
  }
}

test('cancel during microphone permission releases the late stream', async t => {
  let allow!: (stream: any) => void;
  let released = 0;
  const phases: VoicePhase[] = [];
  environment(t, () => new Promise(resolve => { allow = resolve; }), async () => new Response('{}', { status: 503 }));
  const voice = createVoiceDictation({ lang: 'uk', onPhase: phase => phases.push(phase), onLevel: () => {}, onText: () => assert.fail('Cancelled text'), onError: () => assert.fail('Cancelled error') });
  const starting = voice.start();
  voice.cancel();
  allow({ getTracks: () => [{ stop: () => released++ }] });
  await starting;
  assert.equal(released, 1);
  assert.deepEqual(phases, ['starting']);
});

test('live buffers audio until connected, previews text and flushes before end', async t => {
  const sent: any[] = [];
  const texts: string[] = [];
  let port: any;
  let callbacks: any;
  let connect!: (session: any) => void;
  let connecting!: () => void;
  const ready = new Promise<void>(resolve => { connecting = resolve; });
  const node = () => ({ connect(target: any) { return target; }, disconnect() {} });
  environment(t, async () => ({ getTracks: () => [{ stop() {} }] }), async () => Response.json({
    token: 'auth_tokens/test', model: 'gemini-3.5-transcribe-live', config: {},
  }), {
    document: { baseURI: 'http://localhost:3000/' },
    requestAnimationFrame: () => 1,
    AudioContext: class {
      sampleRate = 16000;
      audioWorklet = { addModule: async () => {} };
      destination = {};
      async resume() {} async close() {}
      createMediaStreamSource() { return node(); }
      createAnalyser() { return { ...node(), fftSize: 256 }; }
      createGain() { return { ...node(), gain: { value: 1 } }; }
    },
    AudioWorkletNode: class {
      port = { onmessage: (_event: any) => {}, postMessage: () => {
        queueMicrotask(() => this.port.onmessage({ data: { samples: new Float32Array([0.5]), flushed: true } }));
      } };
      constructor() { port = this.port; }
      connect(target: any) { return target; } disconnect() {}
    },
  });
  const live = new GoogleGenAI({ apiKey: 'test' }).live;
  t.mock.method(Object.getPrototypeOf(live), 'connect', (options: any) => {
    callbacks = options.callbacks;
    connecting();
    return new Promise(resolve => { connect = resolve; });
  });
  const voice = createVoiceDictation({ lang: 'uk', onPhase: () => {}, onLevel: () => {}, onText: value => texts.push(value), onError: message => assert.fail(message) });
  const starting = voice.start();
  await ready;
  port.onmessage({ data: { samples: new Float32Array([0.25]), flushed: false } });
  assert.equal(sent.length, 0);
  connect({ sendRealtimeInput: (packet: any) => sent.push(packet), close() {} });
  await starting;
  assert.equal(sent.length, 1);
  callbacks.onmessage({ serverContent: { interimInputTranscription: { text: 'Перша' } } });
  callbacks.onmessage({ serverContent: { inputTranscription: { text: 'Перша фраза.' } } });
  callbacks.onmessage({ serverContent: { inputTranscription: { text: 'Друга фраза.' } } });
  assert.equal(texts.at(-1), 'Перша фраза. Друга фраза.');
  await voice.stop();
  assert.ok(sent.at(-2).audio);
  assert.deepEqual(sent.at(-1), { audioStreamEnd: true });
  callbacks.onmessage({ serverContent: { turnComplete: true } });
  assert.equal(texts.at(-1), 'Перша фраза. Друга фраза.');
  voice.cancel();
});

test('unavailable Live API retains full recording for batch fallback', async t => {
  let result = '';
  let payload: any;
  const phases: VoicePhase[] = [];
  environment(t, async () => ({ getTracks: () => [{ stop() {} }] }), async (url, init) => {
    if (String(url).endsWith('voice-token')) return new Response('{}', { status: 503 });
    payload = JSON.parse(init!.body as string);
    return Response.json({ text: 'Перша фраза' });
  });
  let complete!: () => void;
  const done = new Promise<void>(resolve => { complete = resolve; });
  const voice = createVoiceDictation({ lang: 'uk', onPhase: phase => { phases.push(phase); if (phase === 'idle') complete(); }, onLevel: () => {}, onText: text => { result = text; }, onError: message => assert.fail(message) });
  await voice.start();
  await voice.stop();
  await done;
  assert.equal(result, 'Перша фраза');
  assert.equal(Buffer.from(payload.audioBase64, 'base64').length, 300);
  assert.equal(payload.model, undefined);
  assert.ok(phases.includes('recording'));
});

test('cancel ignores batch response already in flight', async t => {
  let respond!: (response: Response) => void;
  let requestStarted!: () => void;
  const requested = new Promise<void>(resolve => { requestStarted = resolve; });
  environment(t, async () => ({ getTracks: () => [{ stop() {} }] }), async url => {
    if (String(url).endsWith('voice-token')) return new Response('{}', { status: 503 });
    requestStarted();
    return new Promise<Response>(resolve => { respond = resolve; });
  });
  const voice = createVoiceDictation({ lang: 'uk', onPhase: () => {}, onLevel: () => {}, onText: () => assert.fail('Stale text'), onError: () => assert.fail('Stale error') });
  await voice.start();
  await voice.stop();
  await requested;
  voice.cancel();
  respond(Response.json({ text: 'Запізнілий текст' }));
  await new Promise(resolve => setImmediate(resolve));
});
