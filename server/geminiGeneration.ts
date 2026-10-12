import { GoogleGenAI } from '@google/genai';

export const createGeminiClient = (apiKey: string) => new GoogleGenAI({
  apiKey, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
});

export type AIRequestCode = 'MISSING_API_KEY' | 'INVALID_API_KEY' | 'ACCESS_DENIED'
  | 'QUOTA_EXCEEDED' | 'NETWORK_ERROR' | 'TIMEOUT' | 'MODEL_UNAVAILABLE'
  | 'PROVIDER_ERROR' | 'PROVIDER_UNAVAILABLE' | 'INTERNAL_ERROR' | 'INVALID_AI_RESPONSE' | 'INVALID_AI_REQUEST';

const statusByCode: Record<AIRequestCode, number> = {
  MISSING_API_KEY: 503, INVALID_API_KEY: 401, ACCESS_DENIED: 403,
  QUOTA_EXCEEDED: 429, NETWORK_ERROR: 503, TIMEOUT: 504,
  MODEL_UNAVAILABLE: 503, PROVIDER_ERROR: 502, PROVIDER_UNAVAILABLE: 503, INTERNAL_ERROR: 500,
  INVALID_AI_RESPONSE: 502, INVALID_AI_REQUEST: 502,
};

export interface AIRequestDiagnostics {
  attempts: { model: string; code: AIRequestCode; elapsedMs: number }[];
  elapsedMs: number;
}

export class AIRequestError extends Error {
  constructor(public code: AIRequestCode, public diagnostics?: AIRequestDiagnostics) {
    super(code);
    this.name = 'AIRequestError';
  }
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
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError' || status === 408 || status === 504 || /timed? ?out|timeout/i.test(message)
      || /^(ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT)$/.test(networkCode)) return new AIRequestError('TIMEOUT');
  if (/fetch failed|failed to fetch|network|ENOTFOUND|ECONNRESET|ECONNREFUSED|EAI_AGAIN/i.test(message)
      || /^(ENOTFOUND|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH)$/.test(networkCode)) return new AIRequestError('NETWORK_ERROR');
  if (status === 503 || providerStatus === 'UNAVAILABLE') return new AIRequestError('PROVIDER_UNAVAILABLE');
  if (status >= 400 && status < 600 || providerStatus === 'INTERNAL' || providerStatus === 'UNKNOWN') return new AIRequestError('PROVIDER_ERROR');
  // A programmer error (including TypeError) is not evidence that Google is down.
  return new AIRequestError('INTERNAL_ERROR');
}

export function aiRequestFailure(error: AIRequestError, isUk: boolean) {
  const messages: Record<AIRequestCode, [string, string]> = {
    MISSING_API_KEY: ['Додайте Gemini API key у налаштуваннях AI, щоб чат працював.', 'Add a Gemini API key in AI settings to use chat.'],
    INVALID_API_KEY: ['Google відхилив ключ API. Перевірте або замініть його в налаштуваннях AI.', 'Google rejected the API key. Check or replace it in AI settings.'],
    ACCESS_DENIED: ['Ключ не має доступу до Gemini. Перевірте дозволи й обмеження ключа в Google AI Studio.', 'This key has no Gemini access. Check its permissions and restrictions in Google AI Studio.'],
    QUOTA_EXCEEDED: ['Google обмежив запити до AI. Перевірте квоту в Google AI Studio або повторіть пізніше.', 'Google limited AI requests. Check the quota in Google AI Studio or retry later.'],
    NETWORK_ERROR: ['Не вдалося підключитися до Google. Перевірте з’єднання й повторіть запит.', 'Could not connect to Google. Check your connection and retry.'],
    TIMEOUT: ['Google не відповів вчасно. Повторіть запит або виберіть іншу модель.', 'Google did not respond in time. Retry or select another model.'],
    MODEL_UNAVAILABLE: ['Вибрана модель і резервні моделі недоступні. Оновіть список моделей у налаштуваннях AI й повторіть запит.', 'The selected and fallback models are unavailable. Refresh the model list in AI settings and retry.'],
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
  thinking: string;
  promptTokens?: number;
  cachedTokens?: number;
  outputTokens?: number;
  thoughtsTokens?: number;
}

// Free-tier quotas are per project and per model. A model that just answered 429
// (or does not exist for this key) is tried last until its cooldown expires, so
// later requests do not wait on a request that is known to fail.
const QUOTA_COOLDOWN_MS = 60_000;
const MAX_QUOTA_COOLDOWN_MS = 15 * 60_000;
const UNAVAILABLE_COOLDOWN_MS = 10 * 60_000;
let modelCooldowns = new WeakMap<object, Map<string, number>>();
// Models that rejected an explicit thinking setting keep their provider default.
const thinkingRejectedModels = new Set<string>();

function providerRetryDelayMs(error: any): number | undefined {
  let details: any = error?.error;
  if (!details && typeof error?.message === 'string') {
    try { details = JSON.parse(error.message)?.error; } catch { /* not JSON */ }
  }
  const entries = Array.isArray(details?.details) ? details.details : [];
  for (const entry of entries) {
    const match = typeof entry?.retryDelay === 'string' ? /^(\d+(?:\.\d+)?)s$/.exec(entry.retryDelay) : null;
    if (match) return Math.round(Number(match[1]) * 1000);
  }
  return undefined;
}

/** Only a 400 about the thinking setting itself justifies a retry without it. */
function mentionsThinking(error: any): boolean {
  let details: any = error?.error;
  if (!details && typeof error?.message === 'string') {
    try { details = JSON.parse(error.message)?.error; } catch { /* not JSON */ }
  }
  return /thinking/i.test(String(details?.message ?? error?.message ?? ''));
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
}

/** Bound the whole operation and cancel transport before trying a distinct fallback. */
export async function generateGeminiWithFallback({
  ai, contents, config, selectedModel, validateResponse, timeoutMs = 15_000, totalTimeoutMs = 30_000,
  fallbackModels, maxAttempts, allowEmptyText = false, signal, thinking = 'default',
}: {
  ai: GoogleGenAI; contents: Parameters<GoogleGenAI['models']['generateContent']>[0]['contents']; config: any; selectedModel?: string;
  validateResponse?: (text: string) => unknown;
  timeoutMs?: number; totalTimeoutMs?: number;
  fallbackModels?: string[]; maxAttempts?: number; allowEmptyText?: boolean;
  signal?: AbortSignal;
  thinking?: AIThinkingEffort;
}) {
  signal?.throwIfAborted();
  const selected = typeof selectedModel === 'string' ? selectedModel.trim().replace(/^models\//, '') : '';
  const distinctModels = [...new Set([selected, ...(fallbackModels ?? ['gemini-3.1-flash-lite', 'gemini-flash-latest', 'gemini-2.5-flash'])].filter(Boolean))];
  const attemptLimit = typeof maxAttempts === 'number' && Number.isFinite(maxAttempts) && maxAttempts >= 1
    ? Math.floor(maxAttempts) : distinctModels.length;
  const cooldowns = cooldownsFor(ai);
  const nowMs = Date.now();
  const cooling = (model: string) => (cooldowns.get(model) ?? 0) > nowMs;
  // Stable partition: healthy models keep their order, cooling models go last.
  const ordered = [...distinctModels.filter(model => !cooling(model)), ...distinctModels.filter(cooling)];
  const queue = ordered.slice(0, attemptLimit).map(model => ({ model, applyThinking: !config?.thinkingConfig && !thinkingRejectedModels.has(model), thinkingRetry: false }));
  const firstModel = queue[0]?.model;
  // Deadline accounting must survive a wall-clock correction during the request.
  const startedAt = performance.now();
  const deadline = startedAt + totalTimeoutMs;
  const attempts: AIRequestDiagnostics['attempts'] = [];
  const withDiagnostics = (failure: AIRequestError) => new AIRequestError(failure.code, {
    attempts: attempts.map(attempt => ({ ...attempt })),
    elapsedMs: Math.round(performance.now() - startedAt),
  });
  let lastError = new AIRequestError('MODEL_UNAVAILABLE');
  for (let index = 0; index < queue.length; index++) {
    const { model, applyThinking, thinkingRetry } = queue[index];
    signal?.throwIfAborted();
    const remaining = deadline - performance.now();
    if (remaining <= 0) throw withDiagnostics(new AIRequestError('TIMEOUT'));
    const attemptMs = Math.min(timeoutMs, remaining);
    const attemptStartedAt = performance.now();
    const thinkingConfig = applyThinking ? thinkingConfigForModel(model, thinking) : undefined;
    const controller = new AbortController();
    let cancelAttempt: (() => void) | undefined;
    const cancelled = new Promise<never>((_, reject) => {
      cancelAttempt = () => {
        controller.abort(signal?.reason);
        reject(signal?.reason ?? new DOMException('Request cancelled', 'AbortError'));
      };
      signal?.addEventListener('abort', cancelAttempt, { once: true });
      if (signal?.aborted) cancelAttempt();
    });
    let timer: ReturnType<typeof setTimeout>;
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new AIRequestError('TIMEOUT'));
      }, attemptMs);
    });
    try {
      const response = await Promise.race([
        ai.models.generateContent({
          model, contents,
          config: {
            ...config, ...(thinkingConfig ? { thinkingConfig } : {}), abortSignal: controller.signal,
            httpOptions: { ...config?.httpOptions, timeout: attemptMs, retryOptions: { attempts: 1 } },
          },
        }),
        timedOut,
        cancelled,
      ]);
      const responseText = response?.text ?? '';
      if (!responseText.trim() && !allowEmptyText) throw new AIRequestError('INVALID_AI_RESPONSE');
      let validatedResponse: unknown;
      if (validateResponse) {
        try { validatedResponse = validateResponse(responseText); }
        catch { throw new AIRequestError('INVALID_AI_RESPONSE'); }
      }
      cooldowns.delete(model);
      // Remember only when the same request succeeded without the thinking setting.
      if (thinkingRetry) thinkingRejectedModels.add(model);
      const usage: any = (response as any)?.usageMetadata;
      const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
      const metrics: AIGenerationMetrics = {
        model, attempts: attempts.length + 1,
        elapsedMs: Math.round(performance.now() - startedAt),
        thinking: thinkingConfig ? String(thinkingConfig.thinkingLevel ?? `budget:${thinkingConfig.thinkingBudget}`) : 'provider-default',
        ...(count(usage?.promptTokenCount) !== undefined ? { promptTokens: count(usage.promptTokenCount) } : {}),
        ...(count(usage?.cachedContentTokenCount) !== undefined ? { cachedTokens: count(usage.cachedContentTokenCount) } : {}),
        ...(count(usage?.candidatesTokenCount) !== undefined ? { outputTokens: count(usage.candidatesTokenCount) } : {}),
        ...(count(usage?.thoughtsTokenCount) !== undefined ? { thoughtsTokens: count(usage.thoughtsTokenCount) } : {}),
      };
      return { ...response, text: responseText, usedModel: model, fallbackUsed: model !== firstModel, validatedResponse, metrics };
    } catch (error) {
      // Cancelling the parent request must never start another provider attempt.
      if (signal?.aborted) throw signal.reason ?? error;
      const failure = classifyAIRequestError(error);
      // Only model IDs and error categories are returned. Provider error text,
      // API keys and the person's message are never part of diagnostics.
      attempts.push({ model: /^[a-z0-9._-]{1,100}$/i.test(model) ? model : 'custom-model',
        code: failure.code, elapsedMs: Math.round(performance.now() - attemptStartedAt) });
      if (failure.code === 'QUOTA_EXCEEDED') {
        const delay = Math.min(MAX_QUOTA_COOLDOWN_MS, Math.max(QUOTA_COOLDOWN_MS, providerRetryDelayMs(error) ?? 0));
        cooldowns.set(model, Date.now() + delay);
      } else if (failure.code === 'MODEL_UNAVAILABLE') {
        cooldowns.set(model, Date.now() + UNAVAILABLE_COOLDOWN_MS);
      }
      // A model that rejects our thinking setting gets one immediate retry with
      // its provider default instead of failing the whole request.
      if (failure.code === 'INVALID_AI_REQUEST' && thinkingConfig && mentionsThinking(error)) {
        queue.splice(index + 1, 0, { model, applyThinking: false, thinkingRetry: true });
        continue;
      }
      // This attempt was allotted the entire remaining operation budget. A transport
      // timeout can fire fractionally before the clock reaches the deadline; do not
      // spend that rounding remainder on another fallback request.
      if (failure.code === 'TIMEOUT' && attemptMs === remaining) throw withDiagnostics(failure);
      if (failure.code !== 'MODEL_UNAVAILABLE' || lastError.code === 'MODEL_UNAVAILABLE') lastError = failure;
      // Invalid structured output may recover on another model; credentials and request errors cannot.
      if (['INVALID_API_KEY', 'ACCESS_DENIED', 'INVALID_AI_REQUEST', 'INTERNAL_ERROR'].includes(failure.code) ||
          failure.code === 'PROVIDER_ERROR' && Number((error as any)?.status) < 500) throw withDiagnostics(failure);
    } finally {
      clearTimeout(timer!);
      if (cancelAttempt) signal?.removeEventListener('abort', cancelAttempt);
    }
  }
  throw withDiagnostics(lastError);
}
