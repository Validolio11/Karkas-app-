const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const appDir = process.env.KARKAS_TEST_APP_DIR;
assert.ok(appDir && appDir.endsWith('app.asar'));
const { createDesktopStorage } = require(path.join(appDir, 'electron/storage.cjs'));
const { verifyUpdateFile } = require(path.join(appDir, 'electron/update-trust.cjs'));
const manifest = require('./release-manifest.json');
(async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'karkas-134-native-'));
  try {
    const storage = createDesktopStorage({ userDataPath: temporary });
    const workspace = { tasks: [], deletedTasks: [], tabs: [], settings: { soundEnabled: true, fireEnabled: true, lang: 'uk', aiIconVariant: 'quantum' } };
    await storage.saveAccount(null, { workspace });
    assert.deepEqual((await storage.loadAccount(null)).workspace, workspace);
    await assert.rejects(storage.saveAccount(null, { workspace: { ...workspace, tasks: [null] } }));
    assert.deepEqual((await storage.loadAccount(null)).workspace, workspace);
    await verifyUpdateFile(path.resolve(__dirname, '../../release/release-1.3.4', manifest.installer), manifest);
    console.log('Packaged native storage, shared ESM validator and installer digest passed.');
  } finally {
    assert.ok(temporary.startsWith(path.join(os.tmpdir(), 'karkas-134-native-')));
    await fs.rm(temporary, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
