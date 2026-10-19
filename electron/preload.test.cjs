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
  await exposed.karkasDesktop.system.getAppVersion();
  exposed.karkasDesktop.system.setPresence({ lang: 'en', next: { taskId: 'task-1', title: 'Write notes' } });
  assert.equal(zoomFactor, 1.5);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['send', 'karkas:window:minimize', null],
    ['invoke', 'karkas:workspace:load-account', { ownerId: 'user-1' }],
    ['invoke', 'karkas:ai:assist', { prompt: 'hello' }],
    ['invoke', 'karkas:system:get-version', null],
    ['send', 'karkas:system:presence', { lang: 'en', next: { taskId: 'task-1', title: 'Write notes' } }],
  ]);
});

test('preload exposes the streamed chat channel and a removable delta subscription', async () => {
  const exposed = {};
  const calls = [];
  const listeners = new Map();
  const electron = {
    contextBridge: { exposeInMainWorld: (name, value) => { exposed[name] = value; } },
    ipcRenderer: {
      invoke: async (channel, payload) => { calls.push([channel, payload]); return { ok: true }; },
      send: () => {},
      on: (channel, listener) => listeners.set(channel, listener),
      removeListener: (channel, listener) => { if (listeners.get(channel) === listener) listeners.delete(channel); },
    },
    webFrame: { setZoomFactor: () => {} },
  };
  const source = fs.readFileSync(path.join(__dirname, 'preload.cjs'), 'utf8');
  vm.runInNewContext(source, { require: (id) => id === 'electron' ? electron : assert.fail(`Unexpected preload import: ${id}`) });
  const received = [];
  const unsubscribe = exposed.karkasDesktop.ai.onStreamDelta((value) => received.push(value));
  // The renderer never receives the IPC event object, only the payload.
  listeners.get('karkas:ai:stream-delta')({ sender: 'private' }, { requestId: 'request-1', text: 'Hi' });
  unsubscribe();
  assert.equal(listeners.has('karkas:ai:stream-delta'), false);
  await exposed.karkasDesktop.ai.assistStream({ prompt: 'hello', desktopRequestId: 'request-1' });
  assert.deepEqual(JSON.parse(JSON.stringify(received)), [{ requestId: 'request-1', text: 'Hi' }]);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['karkas:ai:assist-stream', { prompt: 'hello', desktopRequestId: 'request-1' }]]);
});

test('preload accepts legacy and task commands through a removable payload-only subscription', () => {
  const exposed = {};
  const listeners = new Map();
  const electron = {
    contextBridge: { exposeInMainWorld: (name, value) => { exposed[name] = value; } },
    ipcRenderer: {
      invoke: async () => ({ ok: true }),
      send: () => {},
      on: (channel, listener) => listeners.set(channel, listener),
      removeListener: (channel, listener) => { if (listeners.get(channel) === listener) listeners.delete(channel); },
    },
    webFrame: { setZoomFactor: () => {} },
  };
  const source = fs.readFileSync(path.join(__dirname, 'preload.cjs'), 'utf8');
  vm.runInNewContext(source, { require: (id) => id === 'electron' ? electron : assert.fail('Unexpected preload import: ' + id) });
  const received = [];
  const unsubscribe = exposed.karkasDesktop.window.onCommand((value) => received.push(value));
  const listener = listeners.get('karkas:command');
  const commands = [
    'new-task',
    'open-settings',
    { type: 'toggle-timer', taskId: 'task-1' },
    { type: 'complete-task', taskId: 'task-2' },
    { type: 'start-task', taskId: 'task-3' },
  ];
  for (const command of commands) listener({ sender: 'private' }, command);
  assert.deepEqual(JSON.parse(JSON.stringify(received)), commands);
  for (const command of [null, [], 'quit', {}, { type: 'quit', taskId: 'task-1' },
    { type: 'start-task', taskId: '' }, { type: 'start-task', taskId: ' ' },
    { type: 'start-task', taskId: 1 }, { type: 'start-task', taskId: 'x'.repeat(129) }]) {
    listener({}, command);
  }
  assert.equal(received.length, commands.length);
  unsubscribe();
  assert.equal(listeners.has('karkas:command'), false);
  const unsubscribeInvalid = exposed.karkasDesktop.window.onCommand(null);
  assert.equal(typeof unsubscribeInvalid, 'function');
  assert.equal(listeners.has('karkas:command'), false);
  unsubscribeInvalid();
});
