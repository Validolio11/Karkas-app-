const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function bridge() {
  let api;
  const listeners = new Map();
  const invocations = [];
  const removals = [];
  const electron = {
    contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } },
    ipcRenderer: {
      invoke: async (channel, payload) => { invocations.push({ channel, payload }); return { ok: true }; },
      send: () => {},
      on: (channel, listener) => { listeners.set(channel, listener); },
      removeListener: (channel, listener) => { removals.push({ channel, listener }); if (listeners.get(channel) === listener) listeners.delete(channel); },
    },
    webFrame: { setZoomFactor: () => {} },
  };
  const source = fs.readFileSync(path.join(__dirname, 'preload.cjs'), 'utf8');
  vm.runInNewContext(source, { require: id => id === 'electron' ? electron : assert.fail(`Unexpected import: ${id}`) });
  return { api, listeners, invocations, removals };
}

test('notification bridge preserves the task and owner context including guest owner', async () => {
  const { api, invocations } = bridge();
  const input = { title: 'Karkas', body: 'Start the agreed task', target: { view: 'STRATEGY', ownerId: null, taskId: 'task-1' } };
  await api.system.showNotification(input);
  assert.deepEqual(invocations, [{ channel: 'karkas:system:notify', payload: input }]);
});

test('notification click subscription delivers only target context and is fully removable', () => {
  const { api, listeners, removals } = bridge();
  const received = [];
  const unsubscribe = api.system.onNotificationClick(value => received.push(value));
  const channel = 'karkas:system:notification-click';
  const listener = listeners.get(channel);
  assert.equal(typeof listener, 'function');
  const target = { view: 'STRATEGY', ownerId: 'A', taskId: 'task-2' };
  listener({ sender: 'private-electron-event' }, target);
  assert.deepEqual(received, [target]);
  unsubscribe();
  assert.equal(listeners.has(channel), false);
  assert.equal(removals[0].listener, listener);
});

test('invalid callback does not register an IPC listener', () => {
  const { api, listeners } = bridge();
  const unsubscribe = api.system.onNotificationClick(undefined);
  assert.equal(typeof unsubscribe, 'function');
  unsubscribe();
  assert.equal(listeners.size, 0);
});
