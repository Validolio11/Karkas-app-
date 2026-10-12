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
  /** Streaming only: operation start to the first emitted text chunk. */
  timeToFirstTokenMs?: number;
  /** Function-calling requests only: number of function calls the model returned. */
  toolCalls?: number;
}

// Free-tier quotas are per project and per model. A model that just answered 429
// (or does not exist for this key) is tried last until its cooldown expires, so
// later requests do not wait on a request that is known to fail.
const QUOTA_COOLDOWN_MS = 60_000;
const MAX_QUOTA_COOLDOWN_MS = 15 * 60_000;
const UNAVAILABLE_COOLDOWN_MS = 10 * 60_000;
let modelCooldowns = new WeakMap<object, Map<string, number>>();
// Model + exact thinking setting combinations that were rejected keep the provider
// default; other levels/budgets for the same model are still tried.
const thinkingRejectedModels = new Set<string>();
function thinkingRejectionKey(model: string, thinkingConfig: Record<string, unknown>) {
  return `${model}|${String(thinkingConfig.thinkingLevel ?? `budget:${thinkingConfig.thinkingBudget}`)}`;
}

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

function providerMessage(error: any): string {
  let details: any = error?.error;
  if (!details && typeof error?.message === 'string') {
    try { details = JSON.parse(error.message)?.error; } catch { /* not JSON */ }
  }
  return String(details?.message ?? error?.message ?? '');
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
}

type GeminiContents = Parameters<GoogleGenAI['models']['generateContent']>[0]['contents'];
interface PlannedAttempt { model: string; applyThinking: boolean; thinkingRetry: boolean; rejectedThinkingKey?: string }

interface FallbackOptions {
  ai: GoogleGenAI; config: any; selectedModel?: string;
  totalTimeoutMs: number; fallbackModels?: string[]; maxAttempts?: number;
  thinking: AIThinkingEffort;
}

const diagnosticModelId = (model: string) => /^[a-z0-9._-]{1,100}$/i.test(model) ? model : 'custom-model';

/**
 * Shared model queue, cooldown, thinking-retry, deadline and diagnostics logic
 * for the unary and streaming paths. Only the transport differs between them.
 */
function createFallbackPlan({ ai, config, selectedModel, totalTimeoutMs, fallbackModels, maxAttempts, thinking }: FallbackOptions) {
  const selected = typeof selectedModel === 'string' ? selectedModel.trim().replace(/^models\//, '') : '';
  const distinctModels = [...new Set([selected, ...(fallbackModels ?? ['gemini-3.1-flash-lite', 'gemini-flash-latest', 'gemini-2.5-flash'])].filter(Boolean))];
  const attemptLimit = typeof maxAttempts === 'number' && Number.isFinite(maxAttempts) && maxAttempts >= 1
    ? Math.floor(maxAttempts) : distinctModels.length;
  const cooldowns = cooldownsFor(ai);
  const nowMs = Date.now();
  const cooling = (model: string) => (cooldowns.get(model) ?? 0) > nowMs;
  // Stable partition: healthy models keep their order, cooling models go last.
  const ordered = [...distinctModels.filter(model => !cooling(model)), ...distinctModels.filter(cooling)];
  const queue: PlannedAttempt[] = ordered.slice(0, attemptLimit).map(model => {
    const planned = thinkingConfigForModel(model, thinking);
    return { model, applyThinking: !config?.thinkingConfig && !(planned && thinkingRejectedModels.has(thinkingRejectionKey(model, planned))), thinkingRetry: false };
  });
  // A cooling selected model is demoted, so "fallback" means "not the model the person preferred".
  const preferredModel = selected || distinctModels[0];
  // Deadline accounting must survive a wall-clock correction during the request.
  const startedAt = performance.now();
  const deadline = startedAt + totalTimeoutMs;
  const attempts: AIRequestDiagnostics['attempts'] = [];
  let lastError = new AIRequestError('MODEL_UNAVAILABLE');
  const withDiagnostics = (failure: AIRequestError) => new AIRequestError(failure.code, {
    attempts: attempts.map(attempt => ({ ...attempt })),
    elapsedMs: Math.round(performance.now() - startedAt),
  });
  return {
    queue, preferredModel, startedAt, deadline, attempts, withDiagnostics,
    lastError: () => lastError,
    thinkingConfig: (entry: PlannedAttempt) => entry.applyThinking ? thinkingConfigForModel(entry.model, thinking) : undefined,
    succeeded(entry: PlannedAttempt) {
      cooldowns.delete(entry.model);
      // Remember only when the same request succeeded without the thinking setting.
      if (entry.thinkingRetry && entry.rejectedThinkingKey) thinkingRejectedModels.add(entry.rejectedThinkingKey);
    },
    metrics(entry: PlannedAttempt, thinkingConfig: Record<string, unknown> | undefined, usage: any, extra: Partial<AIGenerationMetrics> = {}): AIGenerationMetrics {
      const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
      return {
        model: entry.model, attempts: attempts.length + 1,
        elapsedMs: Math.round(performance.now() - startedAt),
        thinking: thinkingConfig ? String(thinkingConfig.thinkingLevel ?? `budget:${thinkingConfig.thinkingBudget}`) : 'provider-default',
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
      attemptStartedAt: number, attemptUsedWholeBudget: boolean): AIRequestError | undefined {
      const failure = classifyAIRequestError(error);
      const { model } = entry;
      // Only model IDs and error categories are returned. Provider error text,
      // API keys and the person's message are never part of diagnostics.
      attempts.push({ model: diagnosticModelId(model), code: failure.code, elapsedMs: Math.round(performance.now() - attemptStartedAt) });
      if (failure.code === 'QUOTA_EXCEEDED') {
        const delay = Math.min(MAX_QUOTA_COOLDOWN_MS, Math.max(QUOTA_COOLDOWN_MS, providerRetryDelayMs(error) ?? 0));
        cooldowns.set(model, Date.now() + delay);
      } else if (failure.code === 'MODEL_UNAVAILABLE') {
        cooldowns.set(model, Date.now() + UNAVAILABLE_COOLDOWN_MS);
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
      if (failure.code === 'TIMEOUT' && attemptUsedWholeBudget) return withDiagnostics(failure);
      if (failure.code !== 'MODEL_UNAVAILABLE' || lastError.code === 'MODEL_UNAVAILABLE') lastError = failure;
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
  fallbackModels, maxAttempts, allowEmptyText = false, signal, thinking = 'default',
}: {
  ai: GoogleGenAI; contents: GeminiContents; config: any; selectedModel?: string;
  /** Throwing rejects this model's answer (INVALID_AI_RESPONSE) and tries the next model. */
  validateResponse?: (text: string, output: { text: string; functionCalls: AIFunctionCall[] }) => unknown;
  timeoutMs?: number; totalTimeoutMs?: number;
  fallbackModels?: string[]; maxAttempts?: number; allowEmptyText?: boolean;
  signal?: AbortSignal;
  thinking?: AIThinkingEffort;
}) {
  signal?.throwIfAborted();
  const plan = createFallbackPlan({ ai, config, selectedModel, totalTimeoutMs, fallbackModels, maxAttempts, thinking });
  const { queue } = plan;
  for (let index = 0; index < queue.length; index++) {
    const entry = queue[index];
    const { model } = entry;
    signal?.throwIfAborted();
    const remaining = plan.deadline - performance.now();
    if (remaining <= 0) throw plan.withDiagnostics(new AIRequestError('TIMEOUT'));
    const attemptMs = Math.min(timeoutMs, remaining);
    const attemptStartedAt = performance.now();
    const thinkingConfig = plan.thinkingConfig(entry);
    const guard = createAttemptGuard(signal, attemptMs);
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
      const fatal = plan.failed(index, entry, thinkingConfig, error, attemptStartedAt, attemptMs === remaining);
      if (fatal) throw fatal;
    } finally {
      guard.dispose();
    }
  }
  throw plan.withDiagnostics(plan.lastError());
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
  fallbackModels, maxAttempts, signal, thinking = 'default',
}: {
  ai: GoogleGenAI; contents: GeminiContents; config: any; selectedModel?: string;
  onText: (delta: string) => void;
  /** Runs on the completed output; throwing rejects it as INVALID_AI_RESPONSE. */
  validate?: (output: { text: string; functionCalls: AIFunctionCall[] }) => T;
  timeoutMs?: number; idleTimeoutMs?: number; totalTimeoutMs?: number;
  fallbackModels?: string[]; maxAttempts?: number;
  signal?: AbortSignal;
  thinking?: AIThinkingEffort;
}): Promise<AIStreamResult<T>> {
  signal?.throwIfAborted();
  // Streaming is plain text: structured output would arrive as unreadable JSON fragments.
  const { responseMimeType: _mime, responseSchema: _schema, responseJsonSchema: _jsonSchema, ...textConfig } = config ?? {};
  const plan = createFallbackPlan({ ai, config: textConfig, selectedModel, totalTimeoutMs, fallbackModels, maxAttempts, thinking });
  const { queue } = plan;
  for (let index = 0; index < queue.length; index++) {
    const entry = queue[index];
    const { model } = entry;
    signal?.throwIfAborted();
    const remaining = plan.deadline - performance.now();
    if (remaining <= 0) throw plan.withDiagnostics(new AIRequestError('TIMEOUT'));
    const attemptMs = Math.min(timeoutMs, remaining);
    const attemptStartedAt = performance.now();
    const thinkingConfig = plan.thinkingConfig(entry);
    const guard = createAttemptGuard(signal, attemptMs);
    let text = '';
    const functionCalls: AIFunctionCall[] = [];
    let timeToFirstTokenMs: number | undefined;
    let usage: any;
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
        plan.attempts.push({ model: diagnosticModelId(model), code: failure.code, elapsedMs: Math.round(performance.now() - attemptStartedAt) });
        throw new AIStreamInterruptedError(failure.code, plan.withDiagnostics(failure).diagnostics, text);
      }
      const fatal = plan.failed(index, entry, thinkingConfig, error, attemptStartedAt, attemptMs === remaining);
      if (fatal) throw fatal;
    } finally {
      guard.dispose();
    }
  }
  throw plan.withDiagnostics(plan.lastError());
}
