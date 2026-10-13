import assert from 'node:assert/strict';
import test from 'node:test';
import { AI_CHAT_CLIENT_TIMEOUT_MS, AI_CHAT_FALLBACK_MODELS, AI_CHAT_MAX_ATTEMPTS, AI_CHAT_MODEL_TIMEOUT_MS, AI_CHAT_TOTAL_TIMEOUT_MS, AI_DEFAULT_MODEL_PREFERENCE } from './aiChatTiming';

test('chat deadlines are tight but each fallback keeps a full share and the client outlives the server', () => {
  assert.equal(AI_CHAT_MODEL_TIMEOUT_MS, 15_000);
  assert.equal(AI_CHAT_TOTAL_TIMEOUT_MS, 45_000);
  assert.equal(AI_CHAT_CLIENT_TIMEOUT_MS, 55_000);
  assert.ok(AI_CHAT_MODEL_TIMEOUT_MS * AI_CHAT_MAX_ATTEMPTS <= AI_CHAT_TOTAL_TIMEOUT_MS);
  assert.ok(AI_CHAT_CLIENT_TIMEOUT_MS > AI_CHAT_TOTAL_TIMEOUT_MS);
});

test('the first fallbacks are current Flash models, not legacy ones a new project may not get', () => {
  assert.equal(new Set(AI_CHAT_FALLBACK_MODELS).size, AI_CHAT_FALLBACK_MODELS.length);
  // A selected model leaves AI_CHAT_MAX_ATTEMPTS - 1 fallback attempts.
  const reachable = AI_CHAT_FALLBACK_MODELS.slice(0, AI_CHAT_MAX_ATTEMPTS - 1);
  // Quota-cheap Flash-Lite (~500 requests/day free) before Flash (~20/day).
  assert.deepEqual(reachable, ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']);
  assert.ok(reachable.every(model => !/^gemini-2\./.test(model)));
  // Every fallback is a model the default preference recognizes.
  assert.ok(AI_CHAT_FALLBACK_MODELS.every(model => AI_DEFAULT_MODEL_PREFERENCE.some(tier => tier.test(model))));
});
