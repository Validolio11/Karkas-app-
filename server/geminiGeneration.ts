import { createHash } from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import { AI_CHAT_FALLBACK_MODELS } from '../src/utils/aiChatTiming';

// A short one-way label per API key, so the client can keep per-key model usage
// without ever holding the key (desktop keeps it in the main process).
const keyFingerprints = new WeakMap<object, string>();
export const createGeminiClient = (apiKey: string) => {
  const client = new GoogleGenAI({ apiKey, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } });
  keyFingerprints.set(client, createHash('sha256').update(`karkas-usage-ledger:${apiKey}`).digest('hex').slice(0, 16));
  return client;
};

export type AIRequestCode = 'MISSING_API_KEY' | 'INVALID_API_KEY' | 'ACCESS_DENIED'
  | 'QUOTA_EXCEEDED' | 'NETWORK_ERROR' | 'TIMEOUT' | 'MODEL_UNAVAILABLE' | 'MODEL_TIER_UNAVAILABLE'
  | 'PROVIDER_ERROR' | 'PROVIDER_UNAVAILABLE' | 'INTERNAL_ERROR' | 'INVALID_AI_RESPONSE' | 'INVALID_AI_REQUEST' | 'CONTEXT_TOO_LARGE';

const statusByCode: Record<AIRequestCode, number> = {
  CONTEXT_TOO_LARGE: 413, MISSING_API_KEY: 503, INVALID_API_KEY: 401, ACCESS_DENIED: 403,
  QUOTA_EXCEEDED: 429, NETWORK_ERROR: 503, TIMEOUT: 504,
  MODEL_UNAVAILABLE: 503, MODEL_TIER_UNAVAILABLE: 503, PROVIDER_ERROR: 502, PROVIDER_UNAVAILABLE: 503, INTERNAL_ERROR: 500,
  INVALID_AI_RESPONSE: 502, INVALID_AI_REQUEST: 502,
};

/** A provider quota that a 429 reported as exceeded (google.rpc.QuotaFailure). */
export interface AIQuotaViolation { unit: 'requests' | 'input_tokens' | 'other'; window: 'day' | 'minute' | 'other'; limit?: number }
export interface AIQuotaInfo { violations: AIQuotaViolation[]; retryAfterMs?: number }

export type AIProviderUnavailableReason = 'HIGH_DEMAND' | 'OVERLOADED' | 'TEMPORARILY_UNAVAILABLE';

export interface AIAttemptRecord {
  reason?: AIProviderUnavailableReason;
  model: string; code: AIRequestCode; elapsedMs: number;
  /** Google returned a model response (HTTP 200 / a streamed chunk) that the app then rejected. */
  responded?: true;
  /** QUOTA_EXCEEDED only: what Google said about the exhausted quota. */
  quota?: AIQuotaInfo;
}

export interface AIRequestDiagnostics {
  attempts: AIAttemptRecord[];
  elapsedMs: number;
  /** One-way API key label for the client's usage ledger; never the key. */
  keyId?: string;
}

export class AIRequestError extends Error {
  constructor(public code: AIRequestCode, public diagnostics?: AIRequestDiagnostics) {
    super(code);
    this.name = 'AIRequestError';
  }
}

/**
 * A model rejected the function-calling request itself (HTTP 400 about tools or
 * functions). Nothing was generated; the caller may repeat the operation without tools.
 */
export class AIToolsRejectedError extends AIRequestError {
  constructor(diagnostics?: AIRequestDiagnostics) {
    super('INVALID_AI_REQUEST', diagnostics);
    this.name = 'AIToolsRejectedError';
  }
}

/** A function call proposed by the model. Arguments are unvalidated provider data. */
export interface AIFunctionCall { name: string; args: unknown }

/**
 * Visible text and function calls of one response or stream chunk. Thought parts
 * are skipped. Parts are read directly, so a function-call part does not make the
 * SDK warn about non-text parts; objects without candidates use text/functionCalls.
 */
export function responseOutput(response: any): { text: string; functionCalls: AIFunctionCall[] } {
  const parts = response?.candidates?.[0]?.content?.parts;
  const toCall = (call: any): AIFunctionCall => ({ name: typeof call?.name === 'string' ? call.name : '', args: call?.args });
  if (Array.isArray(parts)) {
    let text = '';
    const functionCalls: AIFunctionCall[] = [];
    for (const part of parts) {
      if (!part || typeof part !== 'object') continue;
      if (part.functionCall) functionCalls.push(toCall(part.functionCall));
      else if (typeof part.text === 'string' && part.thought !== true) text += part.text;
    }
    return { text, functionCalls };
  }
  let text = '';
  try { text = typeof response?.text === 'string' ? response.text : ''; } catch { text = ''; }
  const calls = Array.isArray(response?.functionCalls) ? response.functionCalls : [];
  return { text, functionCalls: calls.map(toCall) };
}

/** Retain an actionable category without exposing provider diagnostics or credentials. */
export function classifyAIRequestError(error: any): AIRequestError {
  if (error instanceof AIRequestError) return error;
  let details: any = error?.error;
  if (!details && typeof error?.message === 'string') {
    try { details = JSON.parse(error.message)?.error; } catch { /* SDK/network errors need not be JSON. */ }
  }
  // SDK errors use numeric status; structured Google errors may use a symbolic
  // status with a numeric code. Do not lose that code by converting UNAVAILABLE.
  const numericStatus = error?.status === undefined || error?.status === null ? NaN : Number(error.status);
  const status = Number.isFinite(numericStatus) ? numericStatus : Number(details?.code ?? error?.code);
  const providerStatus = details?.status ?? (typeof error?.status === 'string' ? error.status : undefined);
  const message = String(details?.message ?? error?.message ?? '');
  const reasons = Array.isArray(details?.details) ? details.details.map((entry: any) => entry?.reason) : [];
  if (status === 401 || providerStatus === 'UNAUTHENTICATED' ||
      reasons.some((reason: string) => ['API_KEY_INVALID', 'API_KEY_EXPIRED', 'API_KEY_NOT_FOUND'].includes(reason)) ||
      status === 400 && /api key (not valid|is invalid|expired)/i.test(message)) return new AIRequestError('INVALID_API_KEY');
  if (status === 403 || providerStatus === 'PERMISSION_DENIED') return new AIRequestError('ACCESS_DENIED');
  if (status === 429 || providerStatus === 'RESOURCE_EXHAUSTED') return new AIRequestError('QUOTA_EXCEEDED');
  if (status === 404 || providerStatus === 'NOT_FOUND') return new AIRequestError('MODEL_UNAVAILABLE');
  if (status === 400 || providerStatus === 'INVALID_ARGUMENT') return new AIRequestError('INVALID_AI_REQUEST');
  const networkCode = String(error?.cause?.code ?? error?.code ?? '');
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError' || status === 408 || status === 504) return new AIRequestError('TIMEOUT');
  // The provider's explicit 503 wins over timeout/network words in its message.
  if (status === 503 || providerStatus === 'UNAVAILABLE') return new AIRequestError('PROVIDER_UNAVAILABLE');
  if (/timed? ?out|timeout/i.test(message)
      || /^(ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT)$/.test(networkCode)) return new AIRequestError('TIMEOUT');
  if (/fetch failed|failed to fetch|network|ENOTFOUND|ECONNRESET|ECONNREFUSED|EAI_AGAIN/i.test(message)
      || /^(ENOTFOUND|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH)$/.test(networkCode)) return new AIRequestError('NETWORK_ERROR');
  if (status >= 400 && status < 600 || providerStatus === 'INTERNAL' || providerStatus === 'UNKNOWN') return new AIRequestError('PROVIDER_ERROR');
  // A programmer error (including TypeError) is not evidence that Google is down.
  return new AIRequestError('INTERNAL_ERROR');
}

export function aiRequestFailure(error: AIRequestError, isUk: boolean) {
  const messages: Record<AIRequestCode, [string, string]> = {
    CONTEXT_TOO_LARGE: ['Контекст запиту завеликий. Зменште кількість завдань або текст і повторіть запит.', 'The request context is too large. Reduce the task scope or text and retry.'],
    MISSING_API_KEY: ['Додайте Gemini API key у налаштуваннях AI, щоб чат працював.', 'Add a Gemini API key in AI settings to use chat.'],
    INVALID_API_KEY: ['Google відхилив ключ API. Перевірте або замініть його в налаштуваннях AI.', 'Google rejected the API key. Check or replace it in AI settings.'],
    ACCESS_DENIED: ['Ключ не має доступу до Gemini. Перевірте дозволи й обмеження ключа в Google AI Studio.', 'This key has no Gemini access. Check its permissions and restrictions in Google AI Studio.'],
    QUOTA_EXCEEDED: ['Google обмежив запити до AI. Перевірте квоту в Google AI Studio або повторіть пізніше.', 'Google limited AI requests. Check the quota in Google AI Studio or retry later.'],
    NETWORK_ERROR: ['Не вдалося підключитися до Google. Перевірте з’єднання й повторіть запит.', 'Could not connect to Google. Check your connection and retry.'],
    TIMEOUT: ['Google не відповів вчасно. Повторіть запит або виберіть іншу модель.', 'Google did not respond in time. Retry or select another model.'],
    MODEL_TIER_UNAVAILABLE: ['Вибрана модель недоступна на безкоштовному тарифі Google (ліміт 0). Оберіть іншу модель, наприклад Flash-Lite, і повторіть запит.', 'The selected model is not available on the Google free tier (limit 0). Select another model, such as Flash-Lite, and retry.'],
    MODEL_UNAVAILABLE: ['Вибрана модель недоступна для цього ключа, а резервні моделі не відповіли. Виберіть іншу модель у налаштуваннях AI й повторіть запит.', 'The selected model is unavailable for this key and the fallback models did not answer. Select another model in AI settings and retry.'],
    PROVIDER_ERROR: ['Google не зміг виконати запит до AI. Повторіть запит пізніше або виберіть іншу модель.', 'Google could not complete the AI request. Retry later or select another model.'],
    PROVIDER_UNAVAILABLE: ['Google тимчасово не може обробити запит до AI. Повторіть пізніше або виберіть іншу модель.', 'Google is temporarily unable to process the AI request. Retry later or select another model.'],
    INTERNAL_ERROR: ['Додаток не зміг обробити запит до AI. Повторіть запит; якщо помилка повторюється, оновіть додаток.', 'The app could not process the AI request. Retry; if this continues, update the app.'],
    INVALID_AI_RESPONSE: ['AI повернув некоректну відповідь. Уточніть запит і спробуйте ще раз.', 'AI returned an invalid response. Clarify the request and retry.'],
    INVALID_AI_REQUEST: ['Сервіс AI відхилив запит додатка. Повторіть пізніше; якщо помилка повторюється, оновіть додаток.', 'The AI service rejected the app request. Retry later; if the error persists, update the app.'],
  };
  return {
    status: statusByCode[error.code],
    body: {
      code: error.code, error: `${messages[error.code][isUk ? 0 : 1]} ${isUk ? 'Зміни не підготовлено й не застосовано.' : 'No changes were prepared or applied.'}`,
      ...(error.diagnostics ? { diagnostics: error.diagnostics } : {}),
      tasks: [], tabs: [], taskUpdates: [], taskDeletions: [], source: 'ai-error',
    },
  };
}

/**
 * How much a model may reason before answering. Speed-sensitive commands use the
 * smallest level every target model accepts; subtle memory/analysis keeps more.
 * 'default' leaves the provider default untouched.
 */
export type AIThinkingEffort = 'minimal' | 'low' | 'medium' | 'default';

/**
 * Gemini 3.x accepts thinkingLevel; Gemini 2.5 accepts thinkingBudget. Some 3.x
 * Flash models (3.7/3.8) reject MINIMAL with HTTP 400, so Flash never receives
 * it. Flash-Lite already defaults to MINIMAL, so "low" must not raise it.
 * Unknown models keep their provider default rather than risk a 400.
 */
export function thinkingConfigForModel(model: string, effort: AIThinkingEffort = 'default'): Record<string, unknown> | undefined {
  if (effort === 'default') return undefined;
  const id = model.trim().toLowerCase().replace(/^models\//, '');
  const legacy = /^gemini-2\.5-(flash-lite|flash|pro)(?![a-z])/.exec(id);
  if (legacy) {
    const budgets: Record<string, Record<'minimal' | 'low' | 'medium', number>> = {
      'flash-lite': { minimal: 0, low: 0, medium: 1024 },
      flash: { minimal: 0, low: 512, medium: 2048 },
      pro: { minimal: 128, low: 512, medium: 2048 }, // 2.5 Pro cannot disable thinking.
    };
    return { thinkingBudget: budgets[legacy[1]][effort] };
  }
  const isLite = /^gemini-(?:[3-9]|\d{2,})(?:\.\d+)?-flash-lite(?![a-z])/.test(id) || id === 'gemini-flash-lite-latest';
  if (isLite) return { thinkingLevel: effort === 'medium' ? 'LOW' : 'MINIMAL' };
  const isCurrent = /^gemini-(?:[3-9]|\d{2,})(?:\.\d+)?-(?:flash|pro)(?![a-z-]*lite)/.test(id) || id === 'gemini-flash-latest' || id === 'gemini-pro-latest';
  if (isCurrent) return { thinkingLevel: effort === 'medium' ? 'MEDIUM' : 'LOW' };
  return undefined;
}

export interface AIGenerationMetrics {
  model: string;
  elapsedMs: number;
  attempts: number;
  attemptModels?: string[];
  thinking: string;
  promptTokens?: number;
  cachedTokens?: number;
  outputTokens?: number;
  thoughtsTokens?: number;
  /** Streaming only: operation start to the first emitted text chunk. */
  timeToFirstTokenMs?: number;
  /** Function-calling requests only: number of function calls the model returned. */
  toolCalls?: number;
  /**
   * Another model answered: why the explicitly selected model did not, from this
   * request or its remembered cooldown. MODEL_UNAVAILABLE / MODEL_TIER_UNAVAILABLE
   * let the client switch.
   */
  selectedModelFailure?: AIRequestCode;
  /** Failed attempts before the answering one, so the client can count fallbacks too. */
  failedAttempts?: AIAttemptRecord[];
  /** One-way API key label for the client's usage ledger; never the key. */
  keyId?: string;
}

// Quotas are per project and per model. A model that just answered 429 goes last;
// one that answered 404 is excluded until its cooldown expires.
const QUOTA_COOLDOWN_MS = 60_000;
const MAX_QUOTA_COOLDOWN_MS = 15 * 60_000;
// A 404 for a listed model is a project-level access decision that rarely changes
// within a session; a success clears it, and a demoted model is still tried after
// the healthy ones while attempts remain.
const UNAVAILABLE_COOLDOWN_MS = 6 * 60 * 60_000;
// An overloaded (503) or silent model is likely to stay so for a short while.
const TRANSIENT_COOLDOWN_MS = 60_000;
let modelCooldowns = new WeakMap<object, Map<string, { until: number; code: AIRequestCode }>>();
let availableModelsByClient = new WeakMap<object, { models: string[]; verified: boolean }>();

/** Reuse the list already returned by key verification; never make a model-list request here. */
export function rememberAvailableGeminiModels(ai: object, value: unknown, verified = false): string[] | undefined {
  const cached = availableModelsByClient.get(ai);
  // A stale browser closure or account preference must not replace the list
  // Google just returned for this key. Only another verification refreshes it.
  if (cached?.verified && !verified) return cached.models;
  if (!Array.isArray(value)) return undefined;
  const models = [...new Set(value.slice(0, 200).flatMap(model => {
    if (typeof model !== 'string') return [];
    const id = model.trim().toLowerCase().replace(/^models\//, '');
    return /^gemini-[a-z0-9._-]{1,95}$/.test(id) ? [id] : [];
  }))];
  if (models.length) availableModelsByClient.set(ai, { models, verified });
  return models.length ? models : undefined;
}

// Automatic fallback stays in the fast, stable text family. A person's explicit
// model selection may still be Pro/preview/legacy; it is never a reserve default.
function isFastStableChatModel(model: string): boolean {
  return model === 'gemini-flash-latest' || model === 'gemini-flash-lite-latest'
    || /^gemini-(?:[3-9]|\d{2,})(?:\.\d+)?-flash(?:-lite)?(?:-\d{3})?$/.test(model);
}

function availableFallbackModels(ai: object, hints: unknown, fallbackModels?: string[]): string[] {
  if (fallbackModels?.length === 0) return [];
  const available = rememberAvailableGeminiModels(ai, hints) ?? availableModelsByClient.get(ai)?.models;
  const defaults = fallbackModels ?? AI_CHAT_FALLBACK_MODELS;
  if (!available) return defaults;
  const fastModels = available.filter(isFastStableChatModel);
  // Prefer Lite, then current Flash aliases/versions. Avoid the provider's list
  // order deciding cost or silently selecting a Pro/preview/specialized model.
  const version = (model: string) => {
    const parts = /^gemini-(\d+)(?:\.(\d+))?/.exec(model);
    return parts ? Number(parts[1]) * 1000 + Number(parts[2] ?? 0) : Infinity;
  };
  fastModels.sort((a, b) => Number(b.includes('flash-lite')) - Number(a.includes('flash-lite'))
    || version(b) - version(a) || a.localeCompare(b));
  return [...new Set([...defaults.filter(model => fastModels.includes(model)), ...fastModels])];
}
// Model + exact thinking setting combinations that were rejected keep the provider
// default; other levels/budgets for the same model are still tried.
const thinkingRejectedModels = new Set<string>();
function thinkingRejectionKey(model: string, thinkingConfig: Record<string, unknown>) {
  return `${model}|${String(thinkingConfig.thinkingLevel ?? `budget:${thinkingConfig.thinkingBudget}`)}`;
}

/** The google.rpc error object: structured, or JSON in the SDK ApiError message. */
function providerError(error: any): any {
  let details: any = error?.error;
  if (!details && typeof error?.message === 'string') {
    try { details = JSON.parse(error.message)?.error; } catch { /* not JSON */ }
  }
  return details;
}

function providerRetryDelayMs(error: any): number | undefined {
  const details = providerError(error);
  const entries = Array.isArray(details?.details) ? details.details : [];
  for (const entry of entries) {
    const match = typeof entry?.retryDelay === 'string' ? /^(\d+(?:\.\d+)?)s$/.exec(entry.retryDelay) : null;
    if (match) return Math.round(Number(match[1]) * 1000);
  }
  return undefined;
}

/**
 * Quota facts from a 429: QuotaFailure violations (e.g. quotaId
 * "GenerateRequestsPerDayPerProjectPerModel-FreeTier", quotaValue "250") and
 * RetryInfo.retryDelay. Only categories and numbers leave the server.
 */
export function quotaInfoFromError(error: unknown): AIQuotaInfo | undefined {
  const details = providerError(error);
  const entries = Array.isArray(details?.details) ? details.details : [];
  const violations: AIQuotaViolation[] = [];
  for (const entry of entries) {
    if (!Array.isArray(entry?.violations) || !/QuotaFailure/.test(String(entry?.['@type'] ?? 'QuotaFailure'))) continue;
    for (const violation of entry.violations.slice(0, 4)) {
      const id = `${violation?.quotaId ?? ''} ${violation?.quotaMetric ?? ''}`;
      // "0" is meaningful: the model has no quota on this project's tier (e.g. Pro on free tier).
      const value = String(violation?.quotaValue ?? '').trim();
      violations.push({
        unit: /input_?token|InputTokens/i.test(id) ? 'input_tokens' : /requests?/i.test(id) ? 'requests' : 'other',
        window: /PerDay/i.test(id) ? 'day' : /PerMinute/i.test(id) ? 'minute' : 'other',
        ...(/^\d{1,12}$/.test(value) ? { limit: Number(value) } : {}),
      });
    }
  }
  const retryAfterMs = providerRetryDelayMs(error);
  if (!violations.length && retryAfterMs === undefined) return undefined;
  return { violations: violations.slice(0, 4), ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) };
}

function providerMessage(error: any): string {
  const details = providerError(error);
  return String(details?.message ?? error?.message ?? '');
}

/** A fixed reason vocabulary, never the provider's raw message or request details. */
function providerUnavailableReason(code: AIRequestCode, error: unknown): AIProviderUnavailableReason | undefined {
  if (code !== 'PROVIDER_UNAVAILABLE') return undefined;
  const message = providerMessage(error);
  if (/high\s+demand|high\s+traffic/i.test(message)) return 'HIGH_DEMAND';
  if (/overload|capacity|server\s+(?:is\s+)?busy/i.test(message)) return 'OVERLOADED';
  if (/unavailable|temporarily\s+(?:unable|cannot)/i.test(message)) return 'TEMPORARILY_UNAVAILABLE';
  return undefined;
}

/** Only a 400 about the thinking setting itself justifies a retry without it. */
function mentionsThinking(error: any): boolean {
  return /thinking/i.test(providerMessage(error));
}

/** A 400 about function declarations or calling: the request may be repeated without tools. */
function mentionsTools(error: any): boolean {
  return /\btools?\b|function/i.test(providerMessage(error));
}

function cooldownsFor(ai: object) {
  let map = modelCooldowns.get(ai);
  if (!map) { map = new Map(); modelCooldowns.set(ai, map); }
  return map;
}

/** Test hook: forget remembered quota/availability state. */
export function resetModelHealthForTests() {
  thinkingRejectedModels.clear();
  modelCooldowns = new WeakMap();
  availableModelsByClient = new WeakMap();
}

type GeminiContents = Parameters<GoogleGenAI['models']['generateContent']>[0]['contents'];
interface PlannedAttempt { model: string; applyThinking: boolean; thinkingRetry: boolean; rejectedThinkingKey?: string }

interface FallbackOptions {
  ai: GoogleGenAI; config: any; selectedModel?: string;
  totalTimeoutMs: number; fallbackModels?: string[]; maxAttempts?: number;
  availableModels?: string[];
  thinking: AIThinkingEffort;
}

const diagnosticModelId = (model: string) => /^[a-z0-9._-]{1,100}$/i.test(model) ? model : 'custom-model';
// When the selected model is unavailable, these outcomes of the fallbacks are less
// actionable than "select another model"; credential and request errors are not.
const SUPERSEDED_BY_SELECTED_UNAVAILABLE: AIRequestCode[] = ['QUOTA_EXCEEDED', 'TIMEOUT', 'PROVIDER_ERROR', 'PROVIDER_UNAVAILABLE', 'INVALID_AI_RESPONSE',
  'MODEL_UNAVAILABLE', 'MODEL_TIER_UNAVAILABLE'];
/** Failures that mean the model cannot serve this project at all (404, or a 0 quota on its tier). */
const MODEL_ACCESS_FAILURES: AIRequestCode[] = ['MODEL_UNAVAILABLE', 'MODEL_TIER_UNAVAILABLE'];

/**
 * Shared model queue, cooldown, thinking-retry, deadline and diagnostics logic
 * for the unary and streaming paths. Only the transport differs between them.
 */
function createFallbackPlan({ ai, config, selectedModel, totalTimeoutMs, fallbackModels, availableModels, maxAttempts, thinking }: FallbackOptions) {
  const selected = typeof selectedModel === 'string' ? selectedModel.trim().replace(/^models\//, '') : '';
  const distinctModels = [...new Set([selected, ...availableFallbackModels(ai, availableModels, fallbackModels)].filter(Boolean))];
  const attemptLimit = typeof maxAttempts === 'number' && Number.isFinite(maxAttempts) && maxAttempts >= 1
    ? Math.floor(maxAttempts) : distinctModels.length;
  const cooldowns = cooldownsFor(ai);
  const nowMs = Date.now();
  const cooling = (model: string) => (cooldowns.get(model)?.until ?? 0) > nowMs;
  const remember = (model: string, ms: number, code: AIRequestCode) => cooldowns.set(model, { until: Date.now() + ms, code });
  // Stable partition: healthy models keep their order, cooling models go last.
  const ordered = [...distinctModels.filter(model => !cooling(model)), ...distinctModels.filter(cooling)];
  const queue: PlannedAttempt[] = ordered.slice(0, attemptLimit).map(model => {
    const planned = thinkingConfigForModel(model, thinking);
    return { model, applyThinking: !config?.thinkingConfig && !(planned && thinkingRejectedModels.has(thinkingRejectionKey(model, planned))), thinkingRetry: false };
  });
  // A cooling selected model is demoted, so "fallback" means "not the model the person preferred".
  const preferredModel = selected || distinctModels[0];
  // Why the explicitly selected model cannot answer: its failure in this request,
  // otherwise the reason it was demoted before the request started.
  const selectedCooldownCode = selected && cooling(selected) ? cooldowns.get(selected)?.code : undefined;
  let selectedFailureCode: AIRequestCode | undefined;
  const selectedFailure = () => selectedFailureCode ?? selectedCooldownCode;
  // Deadline accounting must survive a wall-clock correction during the request.
  const startedAt = performance.now();
  const deadline = startedAt + totalTimeoutMs;
  const attempts: AIRequestDiagnostics['attempts'] = [];
  const keyId = keyFingerprints.get(ai);
  let lastError = new AIRequestError('MODEL_UNAVAILABLE');
  const recordFailure = (model: string, error: unknown, attemptStartedAt: number) => {
    const failure = classifyAIRequestError(error);
    // Model IDs, categories and allowlisted reasons only; never provider prose.
    const reason = providerUnavailableReason(failure.code, error);
    attempts.push({ model: diagnosticModelId(model), code: failure.code, elapsedMs: Math.round(performance.now() - attemptStartedAt), ...(reason ? { reason } : {}) });
    if (failure.code === 'QUOTA_EXCEEDED') {
      const delay = Math.min(MAX_QUOTA_COOLDOWN_MS, Math.max(QUOTA_COOLDOWN_MS, providerRetryDelayMs(error) ?? 0));
      cooldowns.set(model, { until: Date.now() + delay, code: 'QUOTA_EXCEEDED' });
    } else if (failure.code === 'MODEL_UNAVAILABLE') {
      cooldowns.set(model, { until: Date.now() + UNAVAILABLE_COOLDOWN_MS, code: 'MODEL_UNAVAILABLE' });
    } else if (failure.code === 'TIMEOUT' || failure.code === 'PROVIDER_UNAVAILABLE') {
      cooldowns.set(model, { until: Date.now() + TRANSIENT_COOLDOWN_MS, code: failure.code });
    }
    return failure;
  };
  const withDiagnostics = (failure: AIRequestError) => new AIRequestError(failure.code, {
    attempts: attempts.map(attempt => ({ ...attempt })),
    elapsedMs: Math.round(performance.now() - startedAt),
    ...(keyId ? { keyId } : {}),
  });
  /**
   * The error that ends an exhausted or timed-out operation. A selected model that
   * does not exist for this key, or has no quota on its tier, outranks later quota,
   * overload or timeout failures of the fallbacks: choosing another model is what
   * the person can act on.
   */
  const finalFailure = (failure: AIRequestError) => {
    const selectedCode = selectedFailure();
    return withDiagnostics(selectedCode && MODEL_ACCESS_FAILURES.includes(selectedCode) && SUPERSEDED_BY_SELECTED_UNAVAILABLE.includes(failure.code)
      ? new AIRequestError(selectedCode) : failure);
  };
  return {
    queue, preferredModel, startedAt, deadline, attempts, withDiagnostics, finalFailure, recordFailure,
    canAttempt(entry: PlannedAttempt) {
      const cooldown = cooldowns.get(entry.model);
      return !(cooldown?.code === 'MODEL_UNAVAILABLE' && cooldown.until > Date.now());
    },
    lastError: () => lastError,
    thinkingConfig: (entry: PlannedAttempt) => entry.applyThinking ? thinkingConfigForModel(entry.model, thinking) : undefined,
    succeeded(entry: PlannedAttempt) {
      cooldowns.delete(entry.model);
      // Remember only when the same request succeeded without the thinking setting.
      if (entry.thinkingRetry && entry.rejectedThinkingKey) thinkingRejectedModels.add(entry.rejectedThinkingKey);
    },
    metrics(entry: PlannedAttempt, thinkingConfig: Record<string, unknown> | undefined, usage: any, extra: Partial<AIGenerationMetrics> = {}): AIGenerationMetrics {
      const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
      const selectedModelFailure = selected && entry.model !== selected ? selectedFailure() : undefined;
      return {
        model: entry.model, attempts: attempts.length + 1,
        attemptModels: [...attempts.map(attempt => attempt.model), entry.model],
        elapsedMs: Math.round(performance.now() - startedAt),
        thinking: thinkingConfig ? String(thinkingConfig.thinkingLevel ?? `budget:${thinkingConfig.thinkingBudget}`) : 'provider-default',
        ...(selectedModelFailure ? { selectedModelFailure } : {}),
        ...(attempts.length ? { failedAttempts: attempts.map(attempt => ({ ...attempt })) } : {}),
        ...(keyId ? { keyId } : {}),
        ...extra,
        ...(count(usage?.promptTokenCount) !== undefined ? { promptTokens: count(usage.promptTokenCount) } : {}),
        ...(count(usage?.cachedContentTokenCount) !== undefined ? { cachedTokens: count(usage.cachedContentTokenCount) } : {}),
        ...(count(usage?.candidatesTokenCount) !== undefined ? { outputTokens: count(usage.candidatesTokenCount) } : {}),
        ...(count(usage?.thoughtsTokenCount) !== undefined ? { thoughtsTokens: count(usage.thoughtsTokenCount) } : {}),
      };
    },
    /**
     * Record a failed attempt. Returns the error that ends the operation, or
     * undefined when the queue continues with the next (or a retried) attempt.
     */
    failed(index: number, entry: PlannedAttempt, thinkingConfig: Record<string, unknown> | undefined, error: unknown,
      attemptStartedAt: number, attemptUsedWholeBudget: boolean, responded = false): AIRequestError | undefined {
      const classified = classifyAIRequestError(error);
      const { model } = entry;
      // Only model IDs, error categories and quota numbers are returned. Provider
      // error text, API keys and the person's message are never part of diagnostics.
      const quota = classified.code === 'QUOTA_EXCEEDED' ? quotaInfoFromError(error) : undefined;
      // A quota of 0 is not exhaustion: the model is not offered on this project's tier.
      const failure = quota?.violations.some(violation => violation.limit === 0) ? new AIRequestError('MODEL_TIER_UNAVAILABLE') : classified;
      attempts.push({
        model: diagnosticModelId(model), code: failure.code, elapsedMs: Math.round(performance.now() - attemptStartedAt),
        ...(responded ? { responded: true as const } : {}), ...(quota ? { quota } : {}),
        ...(providerUnavailableReason(failure.code, error) ? { reason: providerUnavailableReason(failure.code, error) } : {}),
      });
      if (model === selected) selectedFailureCode = failure.code;
      if (failure.code === 'QUOTA_EXCEEDED') {
        remember(model, Math.min(MAX_QUOTA_COOLDOWN_MS, Math.max(QUOTA_COOLDOWN_MS, providerRetryDelayMs(error) ?? 0)), failure.code);
      } else if (MODEL_ACCESS_FAILURES.includes(failure.code)) {
        remember(model, UNAVAILABLE_COOLDOWN_MS, failure.code);
      } else if (failure.code === 'PROVIDER_UNAVAILABLE' || failure.code === 'TIMEOUT' && !attemptUsedWholeBudget) {
        // A timeout cut short by the operation deadline says nothing about the model.
        remember(model, TRANSIENT_COOLDOWN_MS, failure.code);
      }
      // A model that rejects our thinking setting gets one immediate retry with
      // its provider default instead of failing the whole request.
      if (failure.code === 'INVALID_AI_REQUEST' && thinkingConfig && mentionsThinking(error)) {
        queue.splice(index + 1, 0, { model, applyThinking: false, thinkingRetry: true, rejectedThinkingKey: thinkingRejectionKey(model, thinkingConfig) });
        return undefined;
      }
      // Function calling itself was rejected: the caller decides whether to retry without tools.
      if (failure.code === 'INVALID_AI_REQUEST' && config?.tools && mentionsTools(error)) {
        return new AIToolsRejectedError(withDiagnostics(failure).diagnostics);
      }
      // This attempt was allotted the entire remaining operation budget. A transport
      // timeout can fire fractionally before the clock reaches the deadline; do not
      // spend that rounding remainder on another fallback request.
      if (failure.code === 'TIMEOUT' && attemptUsedWholeBudget) return finalFailure(failure);
      if (!MODEL_ACCESS_FAILURES.includes(failure.code) || MODEL_ACCESS_FAILURES.includes(lastError.code)) lastError = failure;
      // Invalid structured output may recover on another model; credentials and request errors cannot.
      if (['INVALID_API_KEY', 'ACCESS_DENIED', 'INVALID_AI_REQUEST', 'INTERNAL_ERROR'].includes(failure.code) ||
          failure.code === 'PROVIDER_ERROR' && Number((error as any)?.status) < 500) return withDiagnostics(failure);
      return undefined;
    },
  };
}

/**
 * One provider attempt's transport controller. `interrupted` rejects on parent
 * cancellation or when the (re-armable) timer fires; both abort the transport.
 */
function createAttemptGuard(signal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  let rejectInterrupted!: (reason: unknown) => void;
  const interrupted = new Promise<never>((_, reject) => { rejectInterrupted = reject; });
  // Raced against the transport; never an unhandled rejection after the race settles.
  interrupted.catch(() => {});
  const cancel = () => {
    controller.abort(signal?.reason);
    rejectInterrupted(signal?.reason ?? new DOMException('Request cancelled', 'AbortError'));
  };
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      controller.abort();
      rejectInterrupted(new AIRequestError('TIMEOUT'));
    }, Math.max(0, ms));
  };
  arm(timeoutMs);
  return {
    signal: controller.signal, interrupted, arm,
    abort: () => controller.abort(),
    dispose() { clearTimeout(timer); signal?.removeEventListener('abort', cancel); },
  };
}

/** Bound the whole operation and cancel transport before trying a distinct fallback. */
export async function generateGeminiWithFallback({
  ai, contents, config, selectedModel, validateResponse, timeoutMs = 15_000, totalTimeoutMs = 30_000,
  fallbackTimeoutMs, fallbackModels, availableModels, maxAttempts, allowEmptyText = false, signal, thinking = 'default',
}: {
  ai: GoogleGenAI; contents: GeminiContents; config: any; selectedModel?: string;
  /** Throwing rejects this model's answer (INVALID_AI_RESPONSE) and tries the next model. */
  validateResponse?: (text: string, output: { text: string; functionCalls: AIFunctionCall[] }) => unknown;
  timeoutMs?: number; fallbackTimeoutMs?: number; totalTimeoutMs?: number;
  fallbackModels?: string[]; availableModels?: string[]; maxAttempts?: number; allowEmptyText?: boolean;
  signal?: AbortSignal;
  thinking?: AIThinkingEffort;
}) {
  signal?.throwIfAborted();
  const plan = createFallbackPlan({ ai, config, selectedModel, totalTimeoutMs, fallbackModels, availableModels, maxAttempts, thinking });
  const { queue } = plan;
  for (let index = 0; index < queue.length; index++) {
    const entry = queue[index];
    const { model } = entry;
    signal?.throwIfAborted();
    if (!plan.canAttempt(entry)) continue;
    const remaining = plan.deadline - performance.now();
    if (remaining <= 0) throw plan.finalFailure(new AIRequestError('TIMEOUT'));
    const attemptMs = Math.min(timeoutMs, remaining);
    const attemptStartedAt = performance.now();
    const thinkingConfig = plan.thinkingConfig(entry);
    const guard = createAttemptGuard(signal, attemptMs);
    let responded = false;
    try {
      const response = await Promise.race([
        ai.models.generateContent({
          model, contents,
          config: {
            ...config, ...(thinkingConfig ? { thinkingConfig } : {}), abortSignal: guard.signal,
            httpOptions: { ...config?.httpOptions, timeout: attemptMs, retryOptions: { attempts: 1 } },
          },
        }),
        guard.interrupted,
      ]);
      responded = true;
      const output = responseOutput(response);
      const responseText = output.text;
      if (!responseText.trim() && !output.functionCalls.length && !allowEmptyText) throw new AIRequestError('INVALID_AI_RESPONSE');
      let validatedResponse: unknown;
      if (validateResponse) {
        try { validatedResponse = validateResponse(responseText, output); }
        catch { throw new AIRequestError('INVALID_AI_RESPONSE'); }
      }
      plan.succeeded(entry);
      const metrics = plan.metrics(entry, thinkingConfig, (response as any)?.usageMetadata, config?.tools ? { toolCalls: output.functionCalls.length } : {});
      return { ...response, text: responseText, functionCalls: output.functionCalls, usedModel: model, fallbackUsed: model !== plan.preferredModel, validatedResponse, metrics };
    } catch (error) {
      // Cancelling the parent request must never start another provider attempt.
      if (signal?.aborted) throw signal.reason ?? error;
      const fatal = plan.failed(index, entry, thinkingConfig, error, attemptStartedAt, attemptMs === remaining, responded);
      if (fatal) throw fatal;
    } finally {
      guard.dispose();
    }
  }
  throw plan.finalFailure(plan.lastError());
}

/** A stream failed after text was already delivered; no other model was tried. */
export class AIStreamInterruptedError extends AIRequestError {
  constructor(code: AIRequestCode, diagnostics: AIRequestDiagnostics | undefined, public partialText: string) {
    super(code, diagnostics);
    this.name = 'AIStreamInterruptedError';
  }
}

export interface AIStreamResult<T = unknown> {
  text: string;
  /** Function calls collected from every chunk; never emitted as text. */
  functionCalls: AIFunctionCall[];
  /** The value returned by `validate`, when one was given. */
  validated?: T;
  usedModel: string;
  fallbackUsed: boolean;
  metrics: AIGenerationMetrics;
}

/**
 * Streaming counterpart of generateGeminiWithFallback, sharing its model queue,
 * cooldowns, thinking retry, deadline and diagnostics. Text parts are emitted via
 * onText; function-call parts (config.tools) are collected and returned, never
 * emitted. Another model may be tried only until the first text chunk was
 * emitted; afterwards any failure, including a `validate` rejection of the
 * completed output, ends the operation with AIStreamInterruptedError (the caller
 * keeps the partial text). timeoutMs bounds time-to-first-chunk, idleTimeoutMs
 * each gap between chunks and totalTimeoutMs the whole operation.
 */
export async function streamGeminiWithFallback<T = unknown>({
  ai, contents, config, selectedModel, onText, validate, timeoutMs = 15_000, idleTimeoutMs = 10_000, totalTimeoutMs = 30_000,
  fallbackTimeoutMs, fallbackModels, availableModels, maxAttempts, signal, thinking = 'default',
}: {
  ai: GoogleGenAI; contents: GeminiContents; config: any; selectedModel?: string;
  onText: (delta: string) => void;
  /** Runs on the completed output; throwing rejects it as INVALID_AI_RESPONSE. */
  validate?: (output: { text: string; functionCalls: AIFunctionCall[] }) => T;
  timeoutMs?: number; fallbackTimeoutMs?: number; idleTimeoutMs?: number; totalTimeoutMs?: number;
  fallbackModels?: string[]; availableModels?: string[]; maxAttempts?: number;
  signal?: AbortSignal;
  thinking?: AIThinkingEffort;
}): Promise<AIStreamResult<T>> {
  signal?.throwIfAborted();
  // Streaming is plain text: structured output would arrive as unreadable JSON fragments.
  const { responseMimeType: _mime, responseSchema: _schema, responseJsonSchema: _jsonSchema, ...textConfig } = config ?? {};
  const plan = createFallbackPlan({ ai, config: textConfig, selectedModel, totalTimeoutMs, fallbackModels, availableModels, maxAttempts, thinking });
  const { queue } = plan;
  for (let index = 0; index < queue.length; index++) {
    const entry = queue[index];
    const { model } = entry;
    signal?.throwIfAborted();
    if (!plan.canAttempt(entry)) continue;
    const remaining = plan.deadline - performance.now();
    if (remaining <= 0) throw plan.finalFailure(new AIRequestError('TIMEOUT'));
    const attemptMs = Math.min(timeoutMs, remaining);
    const attemptStartedAt = performance.now();
    const thinkingConfig = plan.thinkingConfig(entry);
    const guard = createAttemptGuard(signal, attemptMs);
    let text = '';
    const functionCalls: AIFunctionCall[] = [];
    let timeToFirstTokenMs: number | undefined;
    let usage: any;
    let responded = false;
    let iterator: AsyncIterator<any> | undefined;
    try {
      const stream = await Promise.race([
        ai.models.generateContentStream({
          model, contents,
          config: {
            ...textConfig, ...(thinkingConfig ? { thinkingConfig } : {}), abortSignal: guard.signal,
            // The SDK timeout spans the whole streamed body, so it gets the remaining
            // operation budget; first-chunk and idle limits are enforced by the guard.
            httpOptions: { ...textConfig?.httpOptions, timeout: Math.max(1, Math.ceil(remaining)), retryOptions: { attempts: 1 } },
          },
        }),
        guard.interrupted,
      ]);
      iterator = stream[Symbol.asyncIterator]();
      while (true) {
        const step = await Promise.race([iterator.next(), guard.interrupted]);
        if (step.done) break;
        responded = true;
        const chunk = step.value;
        if (chunk?.usageMetadata) usage = chunk.usageMetadata;
        const output = responseOutput(chunk);
        const delta = output.text;
        functionCalls.push(...output.functionCalls);
        if (delta) {
          if (timeToFirstTokenMs === undefined) timeToFirstTokenMs = Math.round(performance.now() - plan.startedAt);
          text += delta;
          onText(delta);
        }
        // Any chunk proves the stream is alive; bound the next gap and the total deadline.
        guard.arm(Math.min(idleTimeoutMs, plan.deadline - performance.now()));
      }
      if (!text.trim() && !functionCalls.length) throw new AIRequestError('INVALID_AI_RESPONSE');
      let validated: T | undefined;
      if (validate) {
        try { validated = validate({ text, functionCalls }); }
        catch { throw new AIRequestError('INVALID_AI_RESPONSE'); }
      }
      plan.succeeded(entry);
      const metrics = plan.metrics(entry, thinkingConfig, usage, {
        ...(timeToFirstTokenMs !== undefined ? { timeToFirstTokenMs } : {}),
        ...(textConfig?.tools ? { toolCalls: functionCalls.length } : {}),
      });
      return { text, functionCalls, ...(validate ? { validated } : {}), usedModel: model, fallbackUsed: model !== plan.preferredModel, metrics };
    } catch (error) {
      guard.abort();
      const pending = iterator;
      if (pending?.return) void Promise.resolve().then(() => pending.return!()).catch(() => {});
      if (signal?.aborted) throw signal.reason ?? error;
      if (text) {
        // Text already reached the person: another model would splice two answers.
        const failure = classifyAIRequestError(error);
        plan.attempts.push({ model: diagnosticModelId(model), code: failure.code, elapsedMs: Math.round(performance.now() - attemptStartedAt), responded: true });
        throw new AIStreamInterruptedError(failure.code, plan.withDiagnostics(failure).diagnostics, text);
      }
      const fatal = plan.failed(index, entry, thinkingConfig, error, attemptStartedAt, attemptMs === remaining, responded);
      if (fatal) throw fatal;
    } finally {
      guard.dispose();
    }
  }
  throw plan.finalFailure(plan.lastError());
}
