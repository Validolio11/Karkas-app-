/**
 * Local per-model usage ledger for Gemini. Google exposes no API for remaining
 * quota, so the app only shows what it observed itself:
 * - requests: attempts for which Google returned a model response (success, or an
 *   answer the app rejected as invalid). 429/404/auth errors, provider failures,
 *   network errors and our own timeouts before any response are not counted;
 * - tokens from the provider's usage metadata of successful answers;
 * - limits and "limited until" learned from 429 QuotaFailure/RetryInfo details;
 * - models that returned 404 for this key, until the quota day rolls over;
 * - models whose 429 reported a quota of 0 (not offered on the project's tier,
 *   e.g. Pro on the free tier), until a later success: tiers change rarely, and a
 *   paid project never receives such a 429, so Pro is never hidden preemptively.
 * Counts cover the current Google quota day, which resets at midnight in
 * America/Los_Angeles. Usage from other devices or apps with the same key is not
 * visible, so a learned limit can be reached before the local count shows it.
 *
 * Google applies rate limits per project, not per key: the counts are this
 * device's view only. Ledgers are keyed by the server's one-way key label (keyId,
 * never the key itself) because a key belongs to exactly one project.
 */

const STORAGE_KEY = 'karkas_ai_model_usage_v1';
const MAX_KEYS = 3;
const MAX_MODELS = 40;
const QUOTA_TIME_ZONE = 'America/Los_Angeles';
const DEFAULT_LIMITED_MS = 60_000;

/**
 * APPROXIMATE Google free-tier limits (AI Studio rate-limit page, Oct 2026), shown
 * with "≈" until a 429 reports the project's real limit. Paid tiers are higher and
 * Google changes these values; update freely. Pro is omitted on purpose: its free
 * quota is 0, which is learned from the 429 instead of hiding Pro for paid users.
 */
export const APPROX_FREE_TIER_LIMITS: Readonly<Record<string, { requestsPerDay: number; requestsPerMinute: number }>> = {
  'gemini-3.8-flash': { requestsPerDay: 20, requestsPerMinute: 5 },
  'gemini-3.7-flash': { requestsPerDay: 20, requestsPerMinute: 5 },
  'gemini-3.6-flash': { requestsPerDay: 20, requestsPerMinute: 5 },
  'gemini-3-flash-preview': { requestsPerDay: 20, requestsPerMinute: 5 },
  'gemini-3.5-flash-lite': { requestsPerDay: 500, requestsPerMinute: 15 },
  'gemini-3.1-flash-lite': { requestsPerDay: 500, requestsPerMinute: 15 },
  'gemini-2.5-flash': { requestsPerDay: 20, requestsPerMinute: 5 },
  'gemini-2.5-flash-lite': { requestsPerDay: 20, requestsPerMinute: 10 },
};

export interface AIUsageAttempt {
  model: string;
  /** Provider error category; absent for the answering attempt. */
  code?: string;
  responded?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  quota?: { violations?: { unit?: string; window?: string; limit?: number }[]; retryAfterMs?: number };
}

export interface AIModelLimits { requestsPerDay?: number; requestsPerMinute?: number; inputTokensPerMinute?: number; inputTokensPerDay?: number }
export interface AIModelUsage {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  /** Learned from 429 details; kept across quota days. */
  limits?: AIModelLimits;
  limitedUntil?: number;
  limitedWindow?: 'day' | 'minute' | 'other';
  /** Google returned 404 for this key's project today. */
  unavailable?: boolean;
  /** A 429 reported a quota of 0: not offered on the project's tier; kept until a success. */
  noQuota?: boolean;
}
export interface AIUsageLedger { day: string; models: Record<string, AIModelUsage> }
interface UsageStore { current?: string; keys: Record<string, AIUsageLedger & { touchedAt: number }> }
type UsageStorage = Pick<Storage, 'getItem' | 'setItem'>;

const quotaDayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: QUOTA_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const quotaPartsFormatter = new Intl.DateTimeFormat('en-US', { timeZone: QUOTA_TIME_ZONE, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Google quota day (YYYY-MM-DD in Pacific time) containing `now`. */
export function quotaDay(now: number): string {
  return quotaDayFormatter.format(new Date(now));
}

/** Pacific wall-clock minus UTC at `instant`, in ms (-7 h in PDT, -8 h in PST). */
function pacificOffsetMs(instant: number): number {
  const parts = Object.fromEntries(quotaPartsFormatter.formatToParts(new Date(instant)).map(part => [part.type, part.value]));
  const wall = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return wall - Math.floor(instant / 1000) * 1000;
}

/** The instant the current quota day ends (next Pacific midnight), DST-safe. */
export function nextQuotaReset(now: number): number {
  const [year, month, day] = quotaDay(now).split('-').map(Number);
  const midnightAsUtc = Date.UTC(year, month - 1, day + 1);
  // DST switches at 02:00 local, so the offset 8 h after UTC midnight of that date
  // (00:00 or 01:00 Pacific) equals the offset at Pacific midnight itself.
  return midnightAsUtc - pacificOffsetMs(midnightAsUtc + 8 * 3_600_000);
}

const emptyUsage = (): AIModelUsage => ({ requests: 0, inputTokens: 0, outputTokens: 0 });
const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

/** Start a new quota day: counts, day limits and 404 marks reset; learned limits stay. */
export function rollUsageLedger(ledger: AIUsageLedger | null | undefined, now: number): AIUsageLedger {
  const day = quotaDay(now);
  if (ledger && ledger.day === day) return ledger;
  const models: Record<string, AIModelUsage> = {};
  for (const [model, usage] of Object.entries(ledger?.models ?? {})) {
    const stillLimited = usage.limitedUntil && usage.limitedUntil > now ? { limitedUntil: usage.limitedUntil, limitedWindow: usage.limitedWindow } : {};
    if (usage.limits || stillLimited.limitedUntil || usage.noQuota) {
      models[model] = { ...emptyUsage(), ...(usage.limits ? { limits: usage.limits } : {}), ...stillLimited, ...(usage.noQuota ? { noQuota: true } : {}) };
    }
  }
  return { day, models };
}

/** Apply one response's attempts (failed fallbacks and the answer) to a ledger. */
export function recordAIUsage(ledger: AIUsageLedger | null | undefined, attempts: AIUsageAttempt[], now: number): AIUsageLedger {
  const next = rollUsageLedger(ledger, now);
  const models = { ...next.models };
  for (const attempt of attempts) {
    if (!attempt || typeof attempt.model !== 'string' || !attempt.model) continue;
    const usage: AIModelUsage = { ...(models[attempt.model] ?? emptyUsage()) };
    if (!attempt.code) {
      // An answer proves the model works now.
      delete usage.unavailable; delete usage.noQuota; delete usage.limitedUntil; delete usage.limitedWindow;
    }
    if (!attempt.code || attempt.responded) usage.requests += 1;
    usage.inputTokens += count(attempt.inputTokens);
    usage.outputTokens += count(attempt.outputTokens);
    if (attempt.code === 'MODEL_UNAVAILABLE') usage.unavailable = true;
    if (attempt.code === 'MODEL_TIER_UNAVAILABLE') usage.noQuota = true;
    if (attempt.code === 'QUOTA_EXCEEDED') {
      const violations = Array.isArray(attempt.quota?.violations) ? attempt.quota!.violations : [];
      const limits: AIModelLimits = { ...usage.limits };
      for (const violation of violations) {
        const limit = count(violation?.limit);
        if (!limit) continue;
        if (violation.unit === 'requests' && violation.window === 'day') limits.requestsPerDay = limit;
        if (violation.unit === 'requests' && violation.window === 'minute') limits.requestsPerMinute = limit;
        if (violation.unit === 'input_tokens' && violation.window === 'day') limits.inputTokensPerDay = limit;
        if (violation.unit === 'input_tokens' && violation.window === 'minute') limits.inputTokensPerMinute = limit;
      }
      if (Object.keys(limits).length) usage.limits = limits;
      const daily = violations.some(violation => violation?.window === 'day');
      const retryAfterMs = count(attempt.quota?.retryAfterMs);
      usage.limitedWindow = daily ? 'day' : violations.some(violation => violation?.window === 'minute') ? 'minute' : 'other';
      usage.limitedUntil = daily ? nextQuotaReset(now) : now + (retryAfterMs || DEFAULT_LIMITED_MS);
    }
    models[attempt.model] = usage;
  }
  // Bounded: keep the most used models if a key lists unusually many.
  const entries = Object.entries(models);
  return { day: next.day, models: entries.length <= MAX_MODELS ? models
    : Object.fromEntries(entries.sort(([, a], [, b]) => b.requests - a.requests).slice(0, MAX_MODELS)) };
}

const record = (value: unknown): Record<string, any> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : null;

/**
 * Attempts and key label from an /api/ai/assist body: aiMetrics on success
 * (failedAttempts plus the answer), diagnostics on failure.
 */
export function usageFromResponse(body: unknown): { keyId: string; attempts: AIUsageAttempt[] } | null {
  const data = record(body);
  const metrics = record(data?.aiMetrics);
  const diagnostics = record(data?.diagnostics);
  const source = metrics ?? diagnostics;
  if (!source) return null;
  const keyId = typeof source.keyId === 'string' && /^[a-f0-9]{8,64}$/.test(source.keyId) ? source.keyId : 'default';
  const failed: unknown = metrics ? metrics.failedAttempts : diagnostics?.attempts;
  const listed: AIUsageAttempt[] = (Array.isArray(failed) ? failed : [])
    .filter((attempt: any) => record(attempt) && typeof attempt.model === 'string' && typeof attempt.code === 'string')
    .map((attempt: any) => ({ model: attempt.model, code: attempt.code, ...(attempt.responded === true ? { responded: true } : {}), ...(record(attempt.quota) ? { quota: attempt.quota } : {}) }));
  if (metrics && typeof metrics.model === 'string' && metrics.model) {
    listed.push({ model: metrics.model, inputTokens: count(metrics.promptTokens), outputTokens: count(metrics.outputTokens) + count(metrics.thoughtsTokens) });
  }
  return listed.length ? { keyId, attempts: listed } : null;
}

function readStore(storage: UsageStorage): UsageStore {
  try {
    const parsed = record(JSON.parse(storage.getItem(STORAGE_KEY) || 'null'));
    const keys = record(parsed?.keys);
    if (!keys) return { keys: {} };
    return { current: typeof parsed!.current === 'string' ? parsed!.current : undefined, keys: keys as UsageStore['keys'] };
  } catch { return { keys: {} }; }
}

/** The ledger of the most recently used key (or `keyId`), rolled to today. */
export function readAIUsageLedger(storage: UsageStorage, now: number, keyId?: string): AIUsageLedger {
  const store = readStore(storage);
  const entry = store.keys[keyId ?? store.current ?? ''];
  const models = record(entry?.models);
  return rollUsageLedger(entry && typeof entry.day === 'string' && models ? { day: entry.day, models: models as AIUsageLedger['models'] } : null, now);
}

/** Record a response body's usage; returns the updated ledger, or null when it had none. */
export function saveAIUsage(storage: UsageStorage, body: unknown, now: number): AIUsageLedger | null {
  const usage = usageFromResponse(body);
  if (!usage) return null;
  const store = readStore(storage);
  const previous = store.keys[usage.keyId];
  const ledger = recordAIUsage(previous && typeof previous.day === 'string' && record(previous.models) ? previous : null, usage.attempts, now);
  const keys = { ...store.keys, [usage.keyId]: { ...ledger, touchedAt: now } };
  const kept = Object.entries(keys).sort(([, a], [, b]) => (b.touchedAt || 0) - (a.touchedAt || 0)).slice(0, MAX_KEYS);
  try { storage.setItem(STORAGE_KEY, JSON.stringify({ current: usage.keyId, keys: Object.fromEntries(kept) })); }
  catch { /* Usage display is best-effort; the reply itself is unaffected. */ }
  return ledger;
}

/** Models the selector hides: 404 today, or no quota on the project's tier. */
export function unavailableModels(ledger: AIUsageLedger): string[] {
  return Object.entries(ledger.models).filter(([, usage]) => usage.unavailable || usage.noQuota).map(([model]) => model);
}

export type AIUsageState = 'unavailable' | 'limited' | 'known' | 'unknown';
export interface AIUsageView {
  state: AIUsageState;
  /** Why an unavailable model is hidden. */
  reason?: 'not_found' | 'no_quota';
  used: number;
  tokens: number;
  /** Daily request limit: reported by Google, or from APPROX_FREE_TIER_LIMITS. */
  limit?: number;
  /** The limit is the approximate free-tier value, not one Google reported. */
  approximate?: true;
  percent?: number;
  resetAt: number;
  limitedUntil?: number;
}

/** What a usage bar may honestly show for one model. */
export function usageView(ledger: AIUsageLedger, model: string, now: number): AIUsageView {
  const usage = rollUsageLedger(ledger, now).models[model] ?? emptyUsage();
  // A limit Google reported replaces the approximate free-tier value.
  const learned = usage.limits?.requestsPerDay;
  const approximate = learned ? undefined : APPROX_FREE_TIER_LIMITS[model]?.requestsPerDay;
  const limit = learned ?? approximate;
  const base = { used: usage.requests, tokens: usage.inputTokens + usage.outputTokens, resetAt: nextQuotaReset(now) };
  const limitFields = (percent: number) => limit ? { limit, percent, ...(approximate ? { approximate: true as const } : {}) } : {};
  if (usage.noQuota) return { state: 'unavailable', reason: 'no_quota', ...base };
  if (usage.unavailable) return { state: 'unavailable', reason: 'not_found', ...base };
  const share = limit ? Math.min(100, Math.round(usage.requests / limit * 100)) : 0;
  if (usage.limitedUntil && usage.limitedUntil > now) {
    return { state: 'limited', ...base, limitedUntil: usage.limitedUntil, ...limitFields(usage.limitedWindow === 'day' ? 100 : share) };
  }
  if (limit) return { state: 'known', ...base, ...limitFields(share) };
  return { state: 'unknown', ...base };
}
