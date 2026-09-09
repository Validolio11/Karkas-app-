import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyGeminiKey } from './geminiKeyVerification.ts';

const chat = (name = 'gemini-2.5-flash') => ({ name: `models/${name}`, supportedGenerationMethods: ['generateContent'] });
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

test('accepts any key format via model listing only; paginates, filters and deduplicates', async () => {
  const requests: URL[] = [];
  const result = await verifyGeminiKey('  future-secret-format  ', {
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      requests.push(url);
      assert.equal(url.pathname, '/v1beta/models');
      assert.equal(url.searchParams.has('key'), false);
      assert.equal(new Headers(init?.headers).get('x-goog-api-key'), 'future-secret-format');
      assert.equal(init?.body, undefined);
      assert.ok(!init?.method || init.method === 'GET');
      return requests.length === 1
        ? json({ models: [chat(), chat('gemini-image'), { name: 'models/gemini-embedding', supportedGenerationMethods: ['embedContent'] }], nextPageToken: 'next page' })
        : json({ models: [chat(), chat('gemini-flash-latest')] });
    },
  });
  assert.deepEqual(result, { status: 200, body: { success: true, models: ['gemini-2.5-flash', 'gemini-flash-latest'] } });
  assert.equal(requests.length, 2);
  assert.equal(requests[1].searchParams.get('pageToken'), 'next page');
});

test('rejects missing input without a provider request', async () => {
  for (const input of [null, undefined, 42, '', '   ']) {
    const result = await verifyGeminiKey(input, { fetchImpl: async () => { throw new Error('must not call'); } });
    assert.equal(result.status, 400);
    assert.equal('code' in result.body && result.body.code, 'MISSING_API_KEY');
  }
});

for (const [status, error, code, expectedStatus] of [
  [400, { details: [{ reason: 'API_KEY_INVALID' }] }, 'INVALID_API_KEY', 401],
  [400, { message: 'API key not valid. Please pass a valid API key.' }, 'INVALID_API_KEY', 401],
  [401, { status: 'UNAUTHENTICATED' }, 'INVALID_API_KEY', 401],
  [403, { status: 'PERMISSION_DENIED', details: [{ reason: 'API_KEY_SERVICE_BLOCKED' }] }, 'ACCESS_DENIED', 403],
  [429, { status: 'RESOURCE_EXHAUSTED' }, 'QUOTA_EXCEEDED', 429],
  [503, { status: 'UNAVAILABLE' }, 'PROVIDER_ERROR', 502],
  [400, { status: 'FAILED_PRECONDITION' }, 'PROVIDER_ERROR', 502],
] as const) {
  test(`maps provider ${status} ${code} without leaking key or raw provider errors`, async () => {
    const result = await verifyGeminiKey('private-test-key', { fetchImpl: async () => json({ error: { message: 'private-test-key provider-internal-data', ...error } }, status) });
    assert.equal(result.status, expectedStatus);
    assert.equal('code' in result.body && result.body.code, code);
    assert.equal(JSON.stringify(result).includes('private-test-key'), false);
    assert.equal(JSON.stringify(result).includes('provider-internal-data'), false);
  });
}

test('empty compatible model list is not an invalid key', async () => {
  const result = await verifyGeminiKey('key', { fetchImpl: async () => json({ models: [chat('gemini-tts')] }) });
  assert.equal(result.status, 422);
  assert.equal('code' in result.body && result.body.code, 'NO_MODELS');
});

test('network failure is safely distinguished from invalid credentials', async () => {
  const result = await verifyGeminiKey('secret', { fetchImpl: async () => { throw new Error('secret in network error'); } });
  assert.equal('code' in result.body && result.body.code, 'NETWORK_ERROR');
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('deadline aborts a stalled request and does not classify its key as invalid', async () => {
  let signal: AbortSignal | undefined;
  const result = await verifyGeminiKey('secret', {
    timeoutMs: 10,
    fetchImpl: async (_input, init) => { signal = init?.signal; return new Promise<Response>(() => {}); },
  });
  assert.equal('code' in result.body && result.body.code, 'TIMEOUT');
  assert.equal(signal?.aborted, true);
});

test('malformed successful response is a provider error', async () => {
  for (const response of [new Response('<html>gateway</html>'), json({ models: 'unexpected' })]) {
    const result = await verifyGeminiKey('key', { fetchImpl: async () => response });
    assert.equal('code' in result.body && result.body.code, 'PROVIDER_ERROR');
  }
});

test('pagination is bounded even if the provider never finishes', async () => {
  let requests = 0;
  const result = await verifyGeminiKey('key', {
    fetchImpl: async () => json({ models: [chat()], nextPageToken: String(++requests) }),
  });
  assert.equal(requests, 10);
  assert.equal('code' in result.body && result.body.code, 'PROVIDER_ERROR');
});

test('repeated page tokens stop pagination safely', async () => {
  let requests = 0;
  const result = await verifyGeminiKey('key', {
    fetchImpl: async () => { requests += 1; return json({ models: [], nextPageToken: 'same' }); },
  });
  assert.equal(requests, 2);
  assert.equal('code' in result.body && result.body.code, 'PROVIDER_ERROR');
});
