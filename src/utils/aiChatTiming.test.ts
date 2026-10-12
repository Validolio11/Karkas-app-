import assert from 'node:assert/strict';
import test from 'node:test';
import { AI_CHAT_CLIENT_TIMEOUT_MS, AI_CHAT_MAX_ATTEMPTS, AI_CHAT_MODEL_TIMEOUT_MS, AI_CHAT_TOTAL_TIMEOUT_MS } from './aiChatTiming';

test('chat deadlines are tight but each fallback keeps a full share and the client outlives the server', () => {
  assert.equal(AI_CHAT_MODEL_TIMEOUT_MS, 15_000);
  assert.equal(AI_CHAT_TOTAL_TIMEOUT_MS, 45_000);
  assert.equal(AI_CHAT_CLIENT_TIMEOUT_MS, 55_000);
  assert.ok(AI_CHAT_MODEL_TIMEOUT_MS * AI_CHAT_MAX_ATTEMPTS <= AI_CHAT_TOTAL_TIMEOUT_MS);
  assert.ok(AI_CHAT_CLIENT_TIMEOUT_MS > AI_CHAT_TOTAL_TIMEOUT_MS);
});
