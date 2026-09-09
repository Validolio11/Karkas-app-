import assert from 'node:assert/strict';
import test from 'node:test';
import { looksLikeGeminiApiKey, shouldVerifyAsApiKey } from './apiKey.ts';

test('recognizes legacy and current Gemini API key formats', () => {
  assert.equal(looksLikeGeminiApiKey('AIzaSyExampleKeyWithEnoughCharacters123'), true);
  assert.equal(looksLikeGeminiApiKey(`AQ.${'a'.repeat(40)}`), true);
});

test('treats any secret entered in the explicit key prompt as an API key', () => {
  assert.equal(shouldVerifyAsApiKey('future-key-format', true), true);
  assert.equal(shouldVerifyAsApiKey('ordinary chat message', false), false);
});
