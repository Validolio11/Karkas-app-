const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { beginBrowserGoogleLogin } = require('./browser-auth.cjs');

function request(url, pathname, { method = 'GET', origin = url.origin, host = url.host, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: url.port, path: pathname, method,
      headers: { Host: host, Origin: origin, 'Content-Type': 'application/json', Connection: 'close' } }, (res) => {
      let text = '';
      res.on('data', (data) => { text += data; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

function start(options = {}) {
  let opened;
  const ready = new Promise((resolve) => { opened = resolve; });
  const promise = beginBrowserGoogleLogin({ assetDir: __dirname,
    openExternal: (value) => opened(new URL(value)), ...options });
  // Attach immediately so timeout/abort assertions cannot cause unhandled rejections.
  promise.catch(() => {});
  return { ready, promise };
}

test('bridge serves only its assets and authenticates one same-origin state-bound callback', async (t) => {
  const assetDir = await fs.mkdtemp(path.join(os.tmpdir(), 'karkas-browser-auth-'));
  t.after(() => fs.rm(assetDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(assetDir, 'assets'));
  await fs.writeFile(path.join(assetDir, 'desktop-auth.html'), '<!doctype html><title>Auth test</title>');
  await fs.writeFile(path.join(assetDir, 'assets/test.js'), '// Auth test asset');
  const { ready, promise } = start({ assetDir });
  const url = await ready;
  const state = new URLSearchParams(url.hash.slice(1)).get('state');
  assert.match(state, /^[a-f0-9]{64}$/);
  assert.equal((await request(url, '/desktop-auth.html')).status, 200);
  assert.equal((await request(url, '/assets/test.js')).status, 200);
  assert.equal((await request(url, '/browser-auth.cjs')).status, 404);
  assert.equal((await request(url, '/assets/../desktop-auth.html')).status, 200);
  assert.equal((await request(url, '/assets/%2e%2e/%2e%2e/package.json')).status, 404);
  assert.equal((await request(url, '/desktop-auth.html', { host: 'evil.example' })).status, 403);
  const valid = { state, idToken: 'test-google-token' };
  assert.equal((await request(url, '/callback', { method: 'POST', body: valid, origin: 'https://evil.example' })).status, 403);
  assert.equal((await request(url, '/callback', { method: 'POST', body: { ...valid, state: 'x'.repeat(64) } })).status, 403);
  assert.equal((await request(url, '/callback', { method: 'POST', body: { state } })).status, 400);
  assert.equal((await request(url, '/callback', { method: 'POST', body: valid })).status, 200);
  assert.deepEqual(await promise, { idToken: 'test-google-token' });
  await assert.rejects(request(url, '/callback', { method: 'POST', body: valid }));
});

test('timeout shuts down the listener', async () => {
  const { ready, promise } = start({ timeoutMs: 100 });
  const url = await ready;
  await assert.rejects(promise, /browser-login-timeout/);
  await assert.rejects(request(url, '/desktop-auth.html'));
});

test('abort closes an active browser login', async () => {
  const controller = new AbortController();
  const { ready, promise } = start({ signal: controller.signal });
  const url = await ready;
  controller.abort();
  await assert.rejects(promise, /browser-login-cancelled/);
  await assert.rejects(request(url, '/desktop-auth.html'));
});

test('browser launch failure rejects and cleans up', async () => {
  let url;
  const promise = beginBrowserGoogleLogin({ assetDir: __dirname, openExternal: (value) => {
    url = new URL(value);
    throw new Error('Cannot open browser');
  } });
  await assert.rejects(promise, /Cannot open browser/);
  await assert.rejects(request(url, '/desktop-auth.html'));
});

test('an already aborted login does not open the browser', async () => {
  const controller = new AbortController();
  controller.abort();
  let opened = false;
  await assert.rejects(beginBrowserGoogleLogin({ assetDir: __dirname, signal: controller.signal,
    openExternal: () => { opened = true; } }), /browser-login-cancelled/);
  assert.equal(opened, false);
});

test('oversized callback cannot finish login', async () => {
  const controller = new AbortController();
  const { ready, promise } = start({ signal: controller.signal });
  const url = await ready;
  const state = new URLSearchParams(url.hash.slice(1)).get('state');
  const response = await request(url, '/callback', { method: 'POST', body: { state, idToken: 'x'.repeat(20000) } });
  assert.equal(response.status, 413);
  controller.abort();
  await assert.rejects(promise, /browser-login-cancelled/);
});
