import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getUpdateAvailability, type UpdateRelease } from './updateModalState';
import { UpdateModal } from './UpdateModal';

function release(tag = 'v1.2.25'): UpdateRelease {
  const name = `Karkas-Setup-${tag.replace(/^v/, '')}.exe`;
  return { tag_name: tag, assets: [{ name, browser_download_url: `https://github.com/Validolio11/Karkas-app-/releases/download/${tag}/${name}` }] };
}

test('the installed release and any older release cannot offer an installer', () => {
  for (const tag of ['v1.2.24', 'v1.2.23']) {
    const result = getUpdateAvailability({ currentVersion: '1.2.24', release: release(tag) });
    assert.equal(result.status, 'current');
    assert.equal(result.installer, undefined);
  }
});

test('a verified newer Windows package may be installed', () => {
  const result = getUpdateAvailability({ currentVersion: '1.2.24', release: release() });
  assert.equal(result.status, 'available');
  assert.equal(result.installer?.name, 'Karkas-Setup-1.2.25.exe');
});

test('a newer release pointing at an old installer cannot reinstall the old version', () => {
  const data = release();
  data.assets = release('v1.2.24').assets;
  assert.deepEqual(getUpdateAvailability({ currentVersion: '1.2.24', release: data }), { status: 'unavailable' });
});

test('the download URL must match the advertised package', () => {
  const data = release();
  data.assets![0].browser_download_url = release('v1.2.24').assets![0].browser_download_url;
  assert.deepEqual(getUpdateAvailability({ currentVersion: '1.2.24', release: data }), { status: 'unavailable' });
});

test('an unavailable Windows package does not create an install action', () => {
  for (const assets of [[], undefined]) {
    assert.deepEqual(getUpdateAvailability({ currentVersion: '1.2.24', release: { ...release(), assets } }), { status: 'unavailable' });
  }
});

test('unknown installed version and invalid release data never enable installation', () => {
  assert.deepEqual(getUpdateAvailability({ currentVersion: '1.2.24', release: release(), isVersionKnown: false }), { status: 'unknown-version' });
  assert.deepEqual(getUpdateAvailability({ currentVersion: 'unknown', release: release() }), { status: 'unknown-version' });
  assert.deepEqual(getUpdateAvailability({ currentVersion: '1.2.24', release: { ...release(), tag_name: 'latest' } }), { status: 'check-error' });
});

test('checking or network failure hides even a previously available installer', () => {
  assert.deepEqual(getUpdateAvailability({ currentVersion: '1.2.24', release: release(), isChecking: true }), { status: 'checking' });
  assert.deepEqual(getUpdateAvailability({ currentVersion: '1.2.24', release: release(), checkError: 'network failure' }), { status: 'check-error' });
});

test('draft and prerelease packages cannot enter the ordinary update flow', () => {
  for (const fields of [{ draft: true }, { prerelease: true }]) {
    assert.deepEqual(getUpdateAvailability({ currentVersion: '1.2.24', release: { ...release(), ...fields } }), { status: 'check-error' });
  }
});

test('initial update dialog only offers checking and dismissal until verification finishes', () => {
  const html = renderToStaticMarkup(React.createElement(UpdateModal, {
    isOpen: true, onClose: () => {}, lang: 'uk', currentVersion: '1.2.24',
  }));
  assert.match(html, /role="dialog"/);
  assert.match(html, /Перевірка оновлень/);
  assert.match(html, /id="update-check-again-btn"[^>]*disabled/);
  assert.match(html, /id="update-cancel-btn"/);
  assert.doesNotMatch(html, /id="update-confirm-btn"|перевстановити/);
});

test('unknown installed version is visible and cannot offer installation', () => {
  const html = renderToStaticMarkup(React.createElement(UpdateModal, {
    isOpen: true, onClose: () => {}, lang: 'uk', currentVersion: '1.2.24', isVersionKnown: false,
  }));
  assert.match(html, /Уточнюємо встановлену версію/);
  assert.doesNotMatch(html, /id="update-confirm-btn"/);
});
