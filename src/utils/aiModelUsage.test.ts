import assert from 'node:assert/strict';
import test from 'node:test';
import { APPROX_FREE_TIER_LIMITS, nextQuotaReset, quotaDay, readAIUsageLedger, recordAIUsage, saveAIUsage, unavailableModels, usageFromResponse, usageView } from './aiModelUsage';

const at = (iso: string) => Date.parse(iso);
const memoryStorage = () => {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
};

test('the quota day follows Pacific midnight across both DST switches', () => {
  // PDT (UTC-7): the day changes at 07:00Z.
  assert.equal(quotaDay(at('2026-10-12T06:59:59Z')), '2026-10-11');
  assert.equal(quotaDay(at('2026-10-12T07:00:00Z')), '2026-10-12');
  assert.equal(nextQuotaReset(at('2026-10-12T10:00:00Z')), at('2026-10-13T07:00:00Z'));
  // DST ends on 1 Nov 2026 at 02:00 PDT: that midnight is still PDT, the next one PST.
  assert.equal(nextQuotaReset(at('2026-10-31T20:00:00Z')), at('2026-11-01T07:00:00Z'));
  assert.equal(nextQuotaReset(at('2026-11-01T07:00:00Z')), at('2026-11-02T08:00:00Z'));
  assert.equal(quotaDay(at('2026-11-02T07:59:59Z')), '2026-11-01');
  // DST starts on 8 Mar 2026: that midnight is PST, the next one PDT.
  assert.equal(nextQuotaReset(at('2026-03-07T20:00:00Z')), at('2026-03-08T08:00:00Z'));
  assert.equal(nextQuotaReset(at('2026-03-08T08:00:00Z')), at('2026-03-09T07:00:00Z'));
  // Year boundary.
  assert.equal(nextQuotaReset(at('2026-12-31T12:00:00Z')), at('2027-01-01T08:00:00Z'));
});

test('responses count answered attempts, including fallbacks, and learn limits from 429 details', () => {
  const now = at('2026-10-12T15:00:00Z');
  const failure = {
    code: 'MODEL_UNAVAILABLE',
    diagnostics: { keyId: 'abcdef0123456789', elapsedMs: 9000, attempts: [
      { model: 'gemini-2.5-flash', code: 'MODEL_UNAVAILABLE', elapsedMs: 200 },
      { model: 'gemini-3.1-flash-lite', code: 'TIMEOUT', elapsedMs: 15000 },
      { model: 'gemini-flash-latest', code: 'QUOTA_EXCEEDED', elapsedMs: 300, quota: { retryAfterMs: 43000,
        violations: [{ unit: 'requests', window: 'day', limit: 250 }, { unit: 'requests', window: 'minute', limit: 10 }] } },
      { model: 'gemini-3-flash-preview', code: 'INVALID_AI_RESPONSE', elapsedMs: 900, responded: true },
    ] },
  };
  const parsed = usageFromResponse(failure)!;
  assert.equal(parsed.keyId, 'abcdef0123456789');
  let ledger = recordAIUsage(null, parsed.attempts, now);
  // 404, our timeout and the 429 never produced a model response; the invalid answer did.
  assert.equal(ledger.models['gemini-2.5-flash'].requests, 0);
  assert.equal(ledger.models['gemini-3.1-flash-lite'].requests, 0);
  assert.equal(ledger.models['gemini-flash-latest'].requests, 0);
  assert.equal(ledger.models['gemini-3-flash-preview'].requests, 1);
  assert.deepEqual(unavailableModels(ledger), ['gemini-2.5-flash']);
  assert.deepEqual(ledger.models['gemini-flash-latest'].limits, { requestsPerDay: 250, requestsPerMinute: 10 });
  // A per-day violation lasts until the Pacific reset, not just the retry delay.
  assert.equal(ledger.models['gemini-flash-latest'].limitedUntil, at('2026-10-13T07:00:00Z'));

  const success = { reply: 'ok', aiMetrics: { model: 'gemini-3-flash-preview', keyId: 'abcdef0123456789', promptTokens: 1200, outputTokens: 80, thoughtsTokens: 20,
    failedAttempts: [{ model: 'gemini-2.5-flash', code: 'MODEL_UNAVAILABLE', elapsedMs: 150 }] } };
  ledger = recordAIUsage(ledger, usageFromResponse(success)!.attempts, now + 1000);
  assert.deepEqual(ledger.models['gemini-3-flash-preview'], { requests: 2, inputTokens: 1200, outputTokens: 100 });

  assert.deepEqual(usageView(ledger, 'gemini-flash-latest', now), { state: 'limited', used: 0, tokens: 0, resetAt: at('2026-10-13T07:00:00Z'),
    limitedUntil: at('2026-10-13T07:00:00Z'), limit: 250, percent: 100 });
  // No reported limit yet: the approximate free-tier limit is used and marked as such.
  assert.deepEqual(usageView(ledger, 'gemini-3-flash-preview', now), { state: 'known', used: 2, tokens: 1300, resetAt: at('2026-10-13T07:00:00Z'),
    limit: 20, percent: 10, approximate: true });
  assert.deepEqual(usageView(ledger, 'gemini-2.5-flash', now), { state: 'unavailable', reason: 'not_found', used: 0, tokens: 0, resetAt: at('2026-10-13T07:00:00Z') });

  // Next quota day: counts and 404 marks reset, the learned daily limit stays.
  const tomorrow = at('2026-10-13T08:00:00Z');
  const view = usageView(ledger, 'gemini-flash-latest', tomorrow);
  assert.deepEqual(view, { state: 'known', used: 0, tokens: 0, resetAt: at('2026-10-14T07:00:00Z'), limit: 250, percent: 0 });
  const rolled = recordAIUsage(ledger, [{ model: 'gemini-flash-latest' }], tomorrow);
  assert.equal(rolled.day, '2026-10-13');
  assert.equal(rolled.models['gemini-flash-latest'].requests, 1);
  assert.deepEqual(unavailableModels(rolled), []);
  assert.equal(rolled.models['gemini-3-flash-preview'], undefined);
});

test('approximate free-tier limits yield to reported ones; a 0 quota hides the model until it answers', () => {
  const now = at('2026-10-12T15:00:00Z');
  let ledger = recordAIUsage(null, [{ model: 'gemini-3.5-flash-lite' }, { model: 'gemini-flash-latest' }], now);
  assert.equal(APPROX_FREE_TIER_LIMITS['gemini-3.5-flash-lite'].requestsPerDay, 500);
  assert.equal(usageView(ledger, 'gemini-3.5-flash-lite', now).approximate, true);
  assert.equal(usageView(ledger, 'gemini-3.5-flash-lite', now).limit, 500);
  // Models outside the table (aliases, Pro) have no invented limit.
  assert.equal(usageView(ledger, 'gemini-flash-latest', now).state, 'unknown');
  assert.equal(usageView(ledger, 'gemini-3.1-pro-preview', now).state, 'unknown');
  // A reported daily limit replaces the approximation.
  ledger = recordAIUsage(ledger, [{ model: 'gemini-3.5-flash-lite', code: 'QUOTA_EXCEEDED',
    quota: { violations: [{ unit: 'requests', window: 'minute', limit: 15 }, { unit: 'requests', window: 'day', limit: 1000 }] } }], now);
  const learned = usageView(ledger, 'gemini-3.5-flash-lite', now + 120_000);
  assert.equal(learned.limit, 1000);
  assert.equal(learned.approximate, undefined);

  // Pro on the free tier: the server reports MODEL_TIER_UNAVAILABLE (a 429 with quota 0).
  ledger = recordAIUsage(ledger, [{ model: 'gemini-3.1-pro-preview', code: 'MODEL_TIER_UNAVAILABLE',
    quota: { violations: [{ unit: 'requests', window: 'day', limit: 0 }] } }], now);
  assert.deepEqual(unavailableModels(ledger), ['gemini-3.1-pro-preview']);
  assert.equal(usageView(ledger, 'gemini-3.1-pro-preview', now).reason, 'no_quota');
  // Unlike a 404, it survives the quota day, and only an answer clears it.
  const nextWeek = at('2026-10-19T15:00:00Z');
  assert.deepEqual(unavailableModels(recordAIUsage(ledger, [], nextWeek)), ['gemini-3.1-pro-preview']);
  assert.deepEqual(unavailableModels(recordAIUsage(ledger, [{ model: 'gemini-3.1-pro-preview' }], nextWeek)), []);
});

test('a minute limit without details uses RetryInfo or a short default and ends on success', () => {
  const now = at('2026-10-12T15:00:00Z');
  let ledger = recordAIUsage(null, [{ model: 'm', code: 'QUOTA_EXCEEDED', quota: { retryAfterMs: 30000, violations: [{ unit: 'requests', window: 'minute' }] } }], now);
  assert.equal(ledger.models.m.limitedUntil, now + 30000);
  assert.equal(ledger.models.m.limits, undefined);
  assert.equal(usageView(ledger, 'm', now + 31000).state, 'unknown');
  ledger = recordAIUsage(null, [{ model: 'm', code: 'QUOTA_EXCEEDED' }], now);
  assert.equal(ledger.models.m.limitedUntil, now + 60000);
  ledger = recordAIUsage(ledger, [{ model: 'm' }], now + 1000);
  assert.equal(ledger.models.m.limitedUntil, undefined);
  assert.equal(usageView(ledger, 'm', now + 1000).state, 'unknown');
});

test('the stored ledger is per key label, bounded and never contains the key', () => {
  const storage = memoryStorage();
  const now = at('2026-10-12T15:00:00Z');
  for (const [index, keyId] of ['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb', 'cccccccccccccccc', 'dddddddddddddddd'].entries()) {
    saveAIUsage(storage, { aiMetrics: { model: 'gemini-3-flash-preview', keyId, promptTokens: 10 } }, now + index);
  }
  const stored = JSON.parse(storage.values.get('karkas_ai_model_usage_v1')!);
  assert.deepEqual(Object.keys(stored.keys).sort(), ['bbbbbbbbbbbbbbbb', 'cccccccccccccccc', 'dddddddddddddddd']);
  assert.equal(stored.current, 'dddddddddddddddd');
  assert.equal(readAIUsageLedger(storage, now).models['gemini-3-flash-preview'].requests, 1);
  // Bodies without usage (local replies) change nothing; a malformed key label is not stored.
  assert.equal(saveAIUsage(storage, { reply: 'local' }, now), null);
  saveAIUsage(storage, { aiMetrics: { model: 'x', keyId: 'AIza-not-a-label' } }, now);
  assert.doesNotMatch(storage.values.get('karkas_ai_model_usage_v1')!, /AIza/);
  // Unreadable storage yields an empty ledger.
  assert.deepEqual(readAIUsageLedger({ getItem: () => '{bad', setItem: () => {} }, now).models, {});
});
