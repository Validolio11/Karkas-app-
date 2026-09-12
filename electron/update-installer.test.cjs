const assert = require('node:assert/strict');
const { test } = require('node:test');
const { EventEmitter } = require('node:events');
const { launchUpdateInstaller } = require('./update-installer.cjs');

test('silent update requests NSIS relaunch and quits only after successful spawn', async () => {
  const child = new EventEmitter();
  const events = [];
  child.unref = () => events.push('unref');
  let scheduled;
  const destination = 'C:\\Temp\\Karkas Setup.exe';
  const pending = launchUpdateInstaller(destination, {
    spawnInstaller: (file, args, options) => {
      assert.equal(file, destination);
      assert.deepEqual(args, ['/S', '--updated', '--force-run']);
      assert.deepEqual(options, { detached: true, stdio: 'ignore', windowsHide: true });
      return child;
    },
    quit: () => events.push('quit'),
    schedule: (callback, delay) => { assert.equal(delay, 500); scheduled = callback; },
  });
  assert.deepEqual(events, []);
  assert.equal(scheduled, undefined);
  child.emit('spawn');
  await pending;
  assert.deepEqual(events, ['unref']);
  scheduled();
  assert.deepEqual(events, ['unref', 'quit']);
});

test('asynchronous installer failure leaves app open and reports the error', async () => {
  const child = new EventEmitter();
  child.unref = () => assert.fail('Failed child must not be detached');
  const error = Object.assign(new Error('Permission denied'), { code: 'EACCES' });
  const pending = launchUpdateInstaller('setup.exe', {
    spawnInstaller: () => child,
    quit: () => assert.fail('Must stay open'),
    schedule: () => assert.fail('Must not schedule quit'),
  });
  child.emit('error', error);
  await assert.rejects(pending, error);
});

test('synchronous launch failure also propagates without quitting', async () => {
  await assert.rejects(launchUpdateInstaller('setup.exe', {
    spawnInstaller: () => { throw new Error('Invalid executable'); },
    quit: () => assert.fail('Must stay open'),
    schedule: () => assert.fail('Must not schedule quit'),
  }), /Invalid executable/);
});
