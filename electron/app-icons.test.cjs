const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const { resolveIconPaths } = require('./app-icons.cjs');

const appRoot = path.resolve('fixture-app');
const resourcesPath = path.resolve('fixture-resources');

function resolve(isPackaged, files, platform = 'win32') {
  return resolveIconPaths({ isPackaged, resourcesPath, appRoot, platform, existsSync: (file) => files.includes(file) });
}

test('Windows uses a PNG window icon and the multi-size ICO tray resource', () => {
  const png = path.join(resourcesPath, 'icon.png');
  const ico = path.join(resourcesPath, 'icon.ico');
  assert.deepEqual(resolve(true, [png, ico]), { window: png, tray: ico });
});

test('packaged fallback uses the shipped Vite asset, never the excluded public directory', () => {
  const png = path.join(appRoot, 'dist', 'icon.png');
  assert.deepEqual(resolve(true, [png]), { window: png, tray: png });
  assert.throws(() => resolve(true, [path.join(appRoot, 'public', 'icon.png')]), /application icon is missing/);
});

test('development prefers build resources and supports the public asset fallback', () => {
  const png = path.join(appRoot, 'build', 'icon.png');
  const ico = path.join(appRoot, 'build', 'icon.ico');
  const publicPng = path.join(appRoot, 'public', 'icon.png');
  assert.deepEqual(resolve(false, [png, ico, publicPng]), { window: png, tray: ico });
  assert.deepEqual(resolve(false, [publicPng]), { window: publicPng, tray: publicPng });
});

test('non-Windows platforms use PNG for both surfaces', () => {
  const png = path.join(resourcesPath, 'icon.png');
  assert.deepEqual(resolve(true, [png, path.join(resourcesPath, 'icon.ico')], 'linux'), { window: png, tray: png });
});
