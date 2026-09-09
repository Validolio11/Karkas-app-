import assert from 'node:assert/strict';
import test from 'node:test';
import { KeyVerificationError, keyVerificationMessage, verifyApiKey } from './verifyApiKey.ts';

test('passes arbitrary trimmed keys to the server without imposing a format', async () => {
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(url, '/api/ai/verify-key');
    assert.equal(init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(init?.body)), { apiKey: 'a future key format' });
    return Response.json({ success: true, models: ['gemini-test'] });
  };
  assert.deepEqual(await verifyApiKey('  a future key format  ', { fetcher }), ['gemini-test']);
});

test('preserves provider failure categories instead of claiming every key is invalid', async () => {
  for (const code of ['INVALID_API_KEY', 'ACCESS_DENIED', 'QUOTA_EXCEEDED', 'NETWORK_ERROR', 'TIMEOUT', 'NO_MODELS', 'PROVIDER_ERROR', 'MISSING_API_KEY'] as const) {
    await assert.rejects(verifyApiKey('secret', {
      fetcher: async () => Response.json({ success: false, code, error: 'provider text containing secret' }, { status: 400 }),
    }), (error: unknown) => {
      assert.ok(error instanceof KeyVerificationError);
      assert.equal(error.code, code);
      assert.ok(!error.message.includes('secret'));
      assert.ok(!keyVerificationMessage(error, 'uk').includes('secret'));
      return true;
    });
  }
});

test('HTML fallback and malformed JSON responses are service failures, not invalid keys', async () => {
  for (const response of [new Response('<!doctype html><html>App</html>'), new Response('bad gateway', { status: 502 }), Response.json({})]) {
    await assert.rejects(verifyApiKey('secret', { fetcher: async () => response }), { code: 'SERVER_UNAVAILABLE' });
  }
});

test('reports lack of usable models separately', async () => {
  await assert.rejects(verifyApiKey('secret', {
    fetcher: async () => Response.json({ success: true, models: ['', null, 42] }),
  }), { code: 'NO_MODELS' });
});

test('network errors do not leak provider details or mislabel the key', async () => {
  await assert.rejects(verifyApiKey('secret', {
    fetcher: async () => { throw new TypeError('Failed to fetch secret'); },
  }), { code: 'NETWORK_ERROR', message: 'NETWORK_ERROR' });
});

const stalledFetch: typeof fetch = async (_url, init) => new Promise<Response>((_resolve, reject) => {
  const abort = () => reject(new DOMException('Aborted', 'AbortError'));
  if (init?.signal?.aborted) abort();
  else init?.signal?.addEventListener('abort', abort, { once: true });
});

test('aborts a stalled verification and reports timeout', async () => {
  await assert.rejects(verifyApiKey('secret', { fetcher: stalledFetch, timeoutMs: 5 }), { code: 'TIMEOUT' });
});

test('caller cancellation remains distinguishable from a failed key check', async () => {
  const controller = new AbortController();
  const result = verifyApiKey('secret', { fetcher: stalledFetch, signal: controller.signal });
  controller.abort();
  await assert.rejects(result, { name: 'AbortError' });
});
