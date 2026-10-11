const assert = require('node:assert/strict');
const { test } = require('node:test');
const https = require('node:https');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { resolveTrustedUpdate, verifyUpdateFile } = require('./update-trust.cjs');
const { downloadUpdateFile } = require('./update-download.cjs');

const repo = 'Validolio11/Karkas-app-';
const latest = `https://api.github.com/repos/${repo}/releases/latest`;
const base = `https://github.com/${repo}/releases/download/1.3.3/`;
const name = 'Karkas-Setup-1.3.3.exe';
const payload = Buffer.from('an isolated installer fixture');
const sha512 = createHash('sha512').update(payload).digest('base64');
const release = () => ({ tag_name: '1.3.3', draft: false, prerelease: false, assets: [
  { name, browser_download_url: base + name, size: payload.length },
  { name: 'latest.yml', browser_download_url: base + 'latest.yml' },
] });
const manifest = () => `version: 1.3.3\npath: ${name}\nsha512: ${sha512}\n`;

// Exercise the real HTTPS consumers and streams without contacting a network.
function fakeHttps(t, routes) {
  const original = https.get;
  const calls = [];
  https.get = (url, options, callback) => {
    calls.push(url.href);
    const request = new EventEmitter();
    request.destroy = () => {};
    let response;
    const abort = () => { response?.destroy(); request.emit('error', options.signal.reason); };
    options.signal.addEventListener('abort', abort, { once: true });
    request.destroy = () => options.signal.removeEventListener('abort', abort);
    setImmediate(() => {
      if (options.signal.aborted) { abort(); return; }
      const route = routes[url.href];
      if (!route) { request.emit('error', new Error('Unexpected network target')); return; }
      response = new PassThrough();
      response.statusCode = route.status || 200;
      response.headers = route.location ? { location: route.location } : {};
      response.once('close', () => options.signal.removeEventListener('abort', abort));
      callback(response);
      if (!route.hold) setImmediate(() => { if (!response.destroyed) response.end(route.body || ''); });
    });
    return request;
  };
  t.after(() => { https.get = original; });
  return calls;
}
async function workspace(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'karkas-update-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return path.join(directory, name);
}
const selection = () => ({ url: base + name, fileName: name, currentVersion: '1.3.2' });

test('trust derives package and digest from the official release, allowing its CDN redirect', async t => {
  const cdn = 'https://release-assets.githubusercontent.com/fixture/latest.yml';
  const calls = fakeHttps(t, {
    [latest]: { body: JSON.stringify(release()) },
    [base + 'latest.yml']: { status: 302, location: cdn },
    [cdn]: { body: manifest() },
  });
  const trusted = await resolveTrustedUpdate(selection());
  assert.equal(trusted.sha512, sha512);
  assert.equal(trusted.size, payload.length);
  assert.deepEqual(calls, [latest, base + 'latest.yml', cdn]);
  trusted.validateUrl(new URL(base + name));
  trusted.validateUrl(new URL('https://objects.githubusercontent.com/fixture'));
  for (const url of ['http://objects.githubusercontent.com/fixture', 'https://evil.test/a.exe', 'https://user@objects.githubusercontent.com/a', 'https://objects.githubusercontent.com:444/a']) {
    assert.throws(() => trusted.validateUrl(new URL(url)), { code: 'UPDATE_DOWNLOAD_UNTRUSTED' });
  }
});

test('trust rejects mismatched selection and same-version releases before fetching manifest', async t => {
  const calls = fakeHttps(t, { [latest]: { body: JSON.stringify(release()) } });
  await assert.rejects(resolveTrustedUpdate({ ...selection(), fileName: 'another.exe' }), { code: 'UPDATE_DOWNLOAD_UNTRUSTED' });
  await assert.rejects(resolveTrustedUpdate({ ...selection(), currentVersion: '1.3.3' }), { code: 'UPDATE_DOWNLOAD_UNTRUSTED' });
  assert.deepEqual(calls, [latest, latest]);
});

test('trust rejects invalid or duplicate digest metadata and wrong version', async t => {
  const routes = { [latest]: { body: JSON.stringify(release()) }, [base + 'latest.yml']: { body: manifest() } };
  fakeHttps(t, routes);
  for (const body of [manifest() + `sha512: ${sha512}\n`, manifest().replace(sha512, 'invalid'), manifest().replace('version: 1.3.3', 'version: 1.3.4')]) {
    routes[base + 'latest.yml'].body = body;
    await assert.rejects(resolveTrustedUpdate(selection()), { code: 'UPDATE_DOWNLOAD_UNTRUSTED' });
  }
});

test('metadata redirects outside the official download hosts are rejected without requesting them', async t => {
  const calls = fakeHttps(t, { [latest]: { body: JSON.stringify(release()) }, [base + 'latest.yml']: { status: 302, location: 'https://evil.test/latest.yml' } });
  await assert.rejects(resolveTrustedUpdate(selection()), { code: 'UPDATE_DOWNLOAD_UNTRUSTED' });
  assert.equal(calls.length, 2);
});

test('file verification accepts exact size and digest and rejects modified bytes or size', async t => {
  const file = await workspace(t);
  await fs.writeFile(file, payload);
  await verifyUpdateFile(file, { size: payload.length, sha512 });
  await assert.rejects(verifyUpdateFile(file, { size: payload.length + 1, sha512 }), { code: 'UPDATE_DOWNLOAD_UNTRUSTED' });
  await fs.writeFile(file, Buffer.alloc(payload.length));
  await assert.rejects(verifyUpdateFile(file, { size: payload.length, sha512 }), { code: 'UPDATE_DOWNLOAD_UNTRUSTED' });
});

test('download follows an allowed redirect and preserves existing destination files', async t => {
  const file = await workspace(t);
  const cdn = 'https://release-assets.githubusercontent.com/fixture/setup.exe';
  fakeHttps(t, { [base + name]: { status: 302, location: cdn }, [cdn]: { body: payload } });
  await downloadUpdateFile(base + name, file);
  assert.deepEqual(await fs.readFile(file), payload);
  await assert.rejects(downloadUpdateFile(base + name, file), { code: 'UPDATE_DOWNLOAD_FAILED' });
  assert.deepEqual(await fs.readFile(file), payload);
});

test('download cancellation removes the partial package before retry becomes available', async t => {
  const file = await workspace(t);
  fakeHttps(t, { [base + name]: { hold: true } });
  const controller = new AbortController();
  const pending = downloadUpdateFile(base + name, file, { signal: controller.signal });
  const rejection = assert.rejects(pending, { code: 'UPDATE_DOWNLOAD_CANCELLED' });
  for (let i = 0; i < 50; i++) {
    if (await fs.stat(file).then(() => true, () => false)) break;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  controller.abort(Object.assign(new Error('cancelled'), { code: 'UPDATE_DOWNLOAD_CANCELLED' }));
  await rejection;
  await assert.rejects(fs.stat(file), { code: 'ENOENT' });
});

test('stalled download expires and removes its partial file', async t => {
  const file = await workspace(t);
  fakeHttps(t, { [base + name]: { hold: true } });
  await assert.rejects(downloadUpdateFile(base + name, file, { inactivityTimeoutMs: 30, totalTimeoutMs: 500 }), { code: 'UPDATE_DOWNLOAD_STALLED' });
  await assert.rejects(fs.stat(file), { code: 'ENOENT' });
});

test('one overall deadline bounds download even if the inactivity allowance is longer', async t => {
  const file = await workspace(t);
  fakeHttps(t, { [base + name]: { hold: true } });
  await assert.rejects(downloadUpdateFile(base + name, file, { inactivityTimeoutMs: 500, totalTimeoutMs: 30 }), { code: 'UPDATE_DOWNLOAD_TIMEOUT' });
  await assert.rejects(fs.stat(file), { code: 'ENOENT' });
});

test('download redirect limit and policy reject before creating a destination', async t => {
  const file = await workspace(t);
  const calls = fakeHttps(t, { [base + name]: { status: 302, location: base + name } });
  await assert.rejects(downloadUpdateFile(base + name, file, { maxRedirects: 1 }), { code: 'UPDATE_DOWNLOAD_REDIRECT_LIMIT' });
  assert.equal(calls.length, 2);
  await assert.rejects(downloadUpdateFile(base + name, file, { validateUrl: () => { throw Object.assign(new Error('Untrusted'), { code: 'UPDATE_DOWNLOAD_UNTRUSTED' }); } }), { code: 'UPDATE_DOWNLOAD_UNTRUSTED' });
  assert.equal(calls.length, 2);
  await assert.rejects(fs.stat(file), { code: 'ENOENT' });
});

test('already cancelled trust request never contacts metadata authority', async t => {
  const calls = fakeHttps(t, {});
  const controller = new AbortController();
  controller.abort(Object.assign(new Error('cancelled'), { code: 'UPDATE_DOWNLOAD_CANCELLED' }));
  await assert.rejects(resolveTrustedUpdate({ ...selection(), signal: controller.signal }), { code: 'UPDATE_DOWNLOAD_CANCELLED' });
  assert.deepEqual(calls, []);
});
