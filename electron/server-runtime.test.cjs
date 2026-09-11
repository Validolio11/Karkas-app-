const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const fs = require('node:fs');

test('production bundle exposes AI services in-process without a TCP server', async () => {
  process.env.NODE_ENV = 'production';
  process.env.KARKAS_SERVER_AUTOSTART = 'false';
  const originalFetch = global.fetch;
  let providerCalls = 0;
  global.fetch = async (input, init) => {
    if (String(input).startsWith('https://generativelanguage.googleapis.com/')) {
      providerCalls += 1;
      assert.equal(new URL(String(input)).searchParams.has('key'), false);
      const key = new Headers(init?.headers).get('x-goog-api-key');
      if (key === 'synthetic-invalid') {
        return Response.json({ error: { message: 'API key not valid', details: [{ reason: 'API_KEY_INVALID' }] } }, { status: 400 });
      }
      return Response.json({ models: [{ name: 'models/gemini-test', supportedGenerationMethods: ['generateContent'] }] });
    }
    return originalFetch(input, init);
  };

  try {
    const appDir = process.env.KARKAS_TEST_APP_DIR || path.join(__dirname, '..');
    const { invokeDesktopApi } = require(path.join(appDir, 'dist', 'server.cjs'));
    const valid = await invokeDesktopApi('verifyKey', { apiKey: 'arbitrary-synthetic-format' });
    assert.equal(valid.status, 200);
    assert.deepEqual(valid.body, { success: true, models: ['gemini-test'] });

    const invalid = await invokeDesktopApi('verifyKey', { apiKey: 'synthetic-invalid' });
    assert.equal(invalid.status, 401);
    assert.equal(invalid.body.code, 'INVALID_API_KEY');
    assert.equal(providerCalls, 2);

    const assist = await invokeDesktopApi('assist', { prompt: 'hello', action: 'chat', lang: 'en' });
    assert.equal(assist.status, 200);
    assert.equal(assist.body.source, 'greeting');
  } finally {
    global.fetch = originalFetch;
  }
});

test('packaged legacy migration does not open the former production TCP port', () => {
  const source = fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8');
  assert.equal(/\.listen\s*\(\s*LEGACY_PORT/.test(source), false);
  assert.equal(/legacyServer\s*=\s*http\.createServer/.test(source), false);
  assert.match(source, /interceptStringProtocol\s*\(\s*['"]http['"]/);
  assert.match(source, /uninterceptProtocol\s*\(\s*['"]http['"]\s*\)/);
});
