import assert from 'node:assert/strict';
import test from 'node:test';
import { beginAIUsage, readAIUsage } from './aiUsage';

test('usage includes secondary actions and every model fallback attempt without counting a local proposal apply', () => {
  const records = new Map<string, string>();
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => records.get(key) ?? null, setItem: (key: string, value: string) => records.set(key, value) } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  try {
    beginAIUsage('breakdown')({ aiMetrics: { model: 'gemini-3.5-flash', attempts: 2, attemptModels: ['gemini-3.5-pro', 'gemini-3.5-flash'] } });
    beginAIUsage('recommendations')({ aiMetrics: { model: 'gemini-3.5-flash', attempts: 1 } });
    beginAIUsage('assist')({ source: 'pending-proposal-confirmation' });
    beginAIUsage('transcribeAudio')();
    beginAIUsage('voiceToken')({ token: 'redacted' });
    beginAIUsage('verifyKey')({ success: true, models: ['gemini-3.5-flash'] });
    beginAIUsage('liveTranscription')({ liveSessionModel: 'gemini-3.5-transcribe-live' });
    const usage = readAIUsage();
    assert.equal(usage.models['gemini-3.5-pro'], 1);
    assert.equal(usage.models['gemini-3.5-flash'], 2);
    assert.equal(usage.operations.breakdown, 1);
    assert.equal(usage.operations.recommendations, 1);
    assert.equal(usage.unresolved, 1);
    assert.equal(usage.sessions['gemini-3.5-transcribe-live'], 1);
    assert.equal(usage.operations.verifyKey, 1);
    assert.equal(usage.operations.voiceToken, 1);
  } finally {
    if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage); else Reflect.deleteProperty(globalThis, 'localStorage');
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else Reflect.deleteProperty(globalThis, 'window');
  }
});
