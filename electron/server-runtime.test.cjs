const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');

test('production bundle serves the desktop UI and real AI routes', async () => {
  process.env.NODE_ENV = 'production';
  process.env.KARKAS_SERVER_AUTOSTART = 'false';
  const originalFetch = global.fetch;
  let providerCalls = 0;
  global.fetch = async (input, init) => {
    if (String(input).startsWith('https://generativelanguage.googleapis.com/')) {
      providerCalls++;
      assert.equal(new URL(String(input)).searchParams.has('key'), false);
      const key = new Headers(init?.headers).get('x-goog-api-key');
      if (key === 'synthetic-invalid') {
        return Response.json({ error: { message: 'API key not valid', details: [{ reason: 'API_KEY_INVALID' }] } }, { status: 400 });
      }
      return Response.json({ models: [{ name: 'models/gemini-test', supportedGenerationMethods: ['generateContent'] }] });
    }
    return originalFetch(input, init);
  };
  const distPath = path.join(process.env.KARKAS_TEST_APP_DIR || path.join(__dirname, '..'), 'dist');
  const { startServer } = require(path.join(distPath, 'server.cjs'));
  const server = await startServer({ port: 0, host: '127.0.0.1', distPath });
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const page = await fetch(origin);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    const verify = (apiKey) => fetch(`${origin}/api/ai/verify-key`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ apiKey }),
    });
    const valid = await verify('arbitrary-synthetic-format');
    assert.equal(valid.status, 200);
    assert.deepEqual(await valid.json(), { success: true, models: ['gemini-test'] });
    const invalid = await verify('synthetic-invalid');
    assert.equal(invalid.status, 401);
    assert.equal((await invalid.json()).code, 'INVALID_API_KEY');
    assert.equal(providerCalls, 2);
    if (process.versions.electron) {
      const blocked = await fetch(`${origin}/api/ai/verify-key`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://unrelated.example' },
        body: JSON.stringify({ apiKey: 'synthetic-invalid' }),
      });
      assert.equal(blocked.status, 403);
      assert.equal(providerCalls, 2);
    }
    const assist = await fetch(`${origin}/api/ai/assist`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ prompt: 'hello', action: 'chat', lang: 'en' }),
    });
    assert.equal(assist.status, 200);
    assert.equal((await assist.json()).source, 'greeting');
  } finally {
    global.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
  }
});
