const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('preload exposes only the grouped Karkas desktop bridge', async () => {
  const exposed = {};
  const calls = [];
  let zoomFactor = null;
  const electron = {
    contextBridge: { exposeInMainWorld: (name, value) => { exposed[name] = value; } },
    ipcRenderer: {
      invoke: async (channel, payload) => { calls.push(['invoke', channel, payload]); return { ok: true }; },
      send: (channel, payload) => { calls.push(['send', channel, payload]); },
      on: () => {},
      removeListener: () => {},
    },
    webFrame: { setZoomFactor: (value) => { zoomFactor = value; } },
  };
  const source = fs.readFileSync(path.join(__dirname, 'preload.cjs'), 'utf8');
  vm.runInNewContext(source, { require: (id) => id === 'electron' ? electron : assert.fail(`Unexpected preload import: ${id}`) });

  assert.deepEqual(Object.keys(exposed), ['karkasDesktop']);
  assert.equal(exposed.karkasDesktop.isDesktop, true);
  exposed.karkasDesktop.window.minimize();
  exposed.karkasDesktop.window.setZoomFactor(9);
  await exposed.karkasDesktop.workspace.loadAccount('user-1');
  await exposed.karkasDesktop.ai.assist({ prompt: 'hello' });
  assert.equal(zoomFactor, 1.5);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['send', 'karkas:window:minimize', null],
    ['invoke', 'karkas:workspace:load-account', { ownerId: 'user-1' }],
    ['invoke', 'karkas:ai:assist', { prompt: 'hello' }],
  ]);
});
