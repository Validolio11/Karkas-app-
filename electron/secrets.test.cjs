const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createSecretStore } = require('./secrets.cjs');

const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`encrypted:${value}`, 'utf8'),
  decryptString: (value) => value.toString('utf8').replace(/^encrypted:/, ''),
};

test('secret store encrypts, imports once and clears the Gemini key', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'karkas-secrets-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = createSecretStore({ userDataPath: directory, safeStorage: fakeSafeStorage });

  assert.equal(await store.hasGeminiApiKey(), false);
  assert.equal(await store.importLegacyGeminiApiKey('legacy-key'), true);
  assert.equal(await store.importLegacyGeminiApiKey('replacement'), false);
  assert.equal(await store.getGeminiApiKey(), 'legacy-key');
  assert.doesNotMatch(await fs.readFile(store.filePath, 'utf8'), /legacy-key/);

  await store.setGeminiApiKey('new-key');
  assert.equal(await store.getGeminiApiKey(), 'new-key');
  await store.clearGeminiApiKey();
  assert.equal(await store.hasGeminiApiKey(), false);
});
