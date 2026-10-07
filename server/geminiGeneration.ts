import type { GoogleGenAI } from '@google/genai';

export type AIRequestCode = 'MISSING_API_KEY' | 'INVALID_API_KEY' | 'ACCESS_DENIED'
  | 'QUOTA_EXCEEDED' | 'NETWORK_ERROR' | 'TIMEOUT' | 'MODEL_UNAVAILABLE'
  | 'PROVIDER_ERROR' | 'INVALID_AI_RESPONSE' | 'INVALID_AI_REQUEST';

const statusByCode: Record<AIRequestCode, number> = {
  MISSING_API_KEY: 503, INVALID_API_KEY: 401, ACCESS_DENIED: 403,
  QUOTA_EXCEEDED: 429, NETWORK_ERROR: 503, TIMEOUT: 504,
  MODEL_UNAVAILABLE: 503, PROVIDER_ERROR: 502, INVALID_AI_RESPONSE: 502, INVALID_AI_REQUEST: 502,
};

export class AIRequestError extends Error {
  constructor(public code: AIRequestCode) {
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
  const status = Number(error?.status ?? details?.code);
  const message = String(details?.message ?? error?.message ?? '');
  const reasons = Array.isArray(details?.details) ? details.details.map((entry: any) => entry?.reason) : [];
  if (status === 401 || details?.status === 'UNAUTHENTICATED' ||
      reasons.some((reason: string) => ['API_KEY_INVALID', 'API_KEY_EXPIRED', 'API_KEY_NOT_FOUND'].includes(reason)) ||
      status === 400 && /api key (not valid|is invalid|expired)/i.test(message)) return new AIRequestError('INVALID_API_KEY');
  if (status === 403 || details?.status === 'PERMISSION_DENIED') return new AIRequestError('ACCESS_DENIED');
  if (status === 429 || details?.status === 'RESOURCE_EXHAUSTED') return new AIRequestError('QUOTA_EXCEEDED');
  if (status === 404 || details?.status === 'NOT_FOUND') return new AIRequestError('MODEL_UNAVAILABLE');
  if (status === 400 || details?.status === 'INVALID_ARGUMENT') return new AIRequestError('INVALID_AI_REQUEST');
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError' || status === 408 || status === 504 || /timed? ?out|timeout/i.test(message)) return new AIRequestError('TIMEOUT');
  if (error instanceof TypeError || /fetch failed|network|ENOTFOUND|ECONNRESET|ECONNREFUSED|EAI_AGAIN/i.test(message)) return new AIRequestError('NETWORK_ERROR');
  return new AIRequestError('PROVIDER_ERROR');
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
    INVALID_AI_RESPONSE: ['AI повернув некоректну відповідь. Уточніть запит і спробуйте ще раз.', 'AI returned an invalid response. Clarify the request and retry.'],
    INVALID_AI_REQUEST: ['Сервіс AI відхилив запит додатка. Повторіть пізніше; якщо помилка повторюється, оновіть додаток.', 'The AI service rejected the app request. Retry later; if the error persists, update the app.'],
  };
  return {
    status: statusByCode[error.code],
    body: {
      code: error.code, error: `${messages[error.code][isUk ? 0 : 1]} ${isUk ? 'Зміни не підготовлено й не застосовано.' : 'No changes were prepared or applied.'}`,
      tasks: [], tabs: [], taskUpdates: [], taskDeletions: [], source: 'ai-error',
    },
  };
}

/** Bound the whole operation and cancel transport before trying a distinct fallback. */
export async function generateGeminiWithFallback({
  ai, contents, config, selectedModel, timeoutMs = 15_000, totalTimeoutMs = 30_000,
}: {
  ai: GoogleGenAI; contents: string; config: any; selectedModel?: string;
  timeoutMs?: number; totalTimeoutMs?: number;
}) {
  const selected = typeof selectedModel === 'string' ? selectedModel.trim().replace(/^models\//, '') : '';
  const models = [...new Set([selected, 'gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-flash-latest'].filter(Boolean))];
  const deadline = Date.now() + totalTimeoutMs;
  let lastError = new AIRequestError('MODEL_UNAVAILABLE');
  for (const model of models) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new AIRequestError('TIMEOUT');
    const attemptMs = Math.min(timeoutMs, remaining);
    const controller = new AbortController();
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
            ...config, abortSignal: controller.signal,
            httpOptions: { ...config?.httpOptions, timeout: attemptMs, retryOptions: { attempts: 1 } },
          },
        }),
        timedOut,
      ]);
      if (!response?.text?.trim()) throw new AIRequestError('INVALID_AI_RESPONSE');
      return { ...response, text: response.text, usedModel: model, fallbackUsed: model !== models[0] };
    } catch (error) {
      const failure = classifyAIRequestError(error);
      if (failure.code !== 'MODEL_UNAVAILABLE' || lastError.code === 'MODEL_UNAVAILABLE') lastError = failure;
      // Bad credentials, malformed output and invalid requests cannot be repaired by changing models.
      if (['INVALID_API_KEY', 'ACCESS_DENIED', 'INVALID_AI_RESPONSE', 'INVALID_AI_REQUEST'].includes(failure.code) ||
          failure.code === 'PROVIDER_ERROR' && Number((error as any)?.status) < 500) throw failure;
    } finally {
      clearTimeout(timer!);
    }
  }
  throw lastError;
}
