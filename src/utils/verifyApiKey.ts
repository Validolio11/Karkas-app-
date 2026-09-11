import { karkasApiFetch } from './desktopApi';

export type KeyVerificationCode = 'INVALID_API_KEY' | 'ACCESS_DENIED' | 'QUOTA_EXCEEDED' | 'NETWORK_ERROR' | 'TIMEOUT' | 'NO_MODELS' | 'PROVIDER_ERROR' | 'MISSING_API_KEY' | 'SERVER_UNAVAILABLE';

const codes: KeyVerificationCode[] = ['INVALID_API_KEY', 'ACCESS_DENIED', 'QUOTA_EXCEEDED', 'NETWORK_ERROR', 'TIMEOUT', 'NO_MODELS', 'PROVIDER_ERROR', 'MISSING_API_KEY', 'SERVER_UNAVAILABLE'];

export class KeyVerificationError extends Error {
  constructor(public readonly code: KeyVerificationCode) {
    super(code);
    this.name = 'KeyVerificationError';
  }
}

export async function verifyApiKey(apiKey: string, options: {
  signal?: AbortSignal;
  timeoutMs?: number;
  fetcher?: typeof fetch;
} = {}): Promise<string[]> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? 20000);
  try {
    const response = await (options.fetcher ?? karkasApiFetch)('/api/ai/verify-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: apiKey.trim() }),
      signal: controller.signal,
    });
    // A static-host HTML fallback or proxy error says nothing about the key.
    const data = await response.json().catch(() => {
      throw new KeyVerificationError('SERVER_UNAVAILABLE');
    });
    if (data?.success === false && codes.includes(data.code)) {
      throw new KeyVerificationError(data.code);
    }
    if (!response.ok || data?.success !== true || !Array.isArray(data.models)) {
      throw new KeyVerificationError('SERVER_UNAVAILABLE');
    }
    const models = data.models.filter((model: unknown): model is string => typeof model === 'string' && model.trim().length > 0);
    if (!models.length) throw new KeyVerificationError('NO_MODELS');
    return models;
  } catch (error) {
    if (options.signal?.aborted) throw new DOMException('Verification cancelled', 'AbortError');
    if (timedOut) throw new KeyVerificationError('TIMEOUT');
    if (error instanceof KeyVerificationError) throw error;
    throw new KeyVerificationError('NETWORK_ERROR');
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
  }
}

const messages: Record<KeyVerificationCode, { uk: string; en: string }> = {
  INVALID_API_KEY: { uk: 'Google відхилив цей API-ключ. Вставте правильний Gemini API-ключ у цей самий рядок.', en: 'Google rejected this API key. Paste a valid Gemini API key into this same input.' },
  MISSING_API_KEY: { uk: 'Вставте Gemini API-ключ у рядок нижче.', en: 'Paste your Gemini API key into the input below.' },
  ACCESS_DENIED: { uk: 'Google заборонив доступ. Перевірте дозволи й обмеження ключа та доступ до Gemini API, потім повторіть перевірку.', en: 'Google denied access. Check the key permissions and restrictions and access to the Gemini API, then retry.' },
  QUOTA_EXCEEDED: { uk: 'Google повідомив про вичерпаний ліміт запитів. Зачекайте або перевірте квоту проєкту, потім повторіть перевірку.', en: 'Google reported an exhausted request quota. Wait or check the project quota, then retry.' },
  NETWORK_ERROR: { uk: 'Не вдалося з’єднатися із сервісом перевірки. Перевірте інтернет і повторіть спробу. Це не означає, що ключ неправильний.', en: 'Could not connect to the verification service. Check your internet connection and retry. This does not mean the key is invalid.' },
  TIMEOUT: { uk: 'Сервіс перевірки не відповів вчасно. Спробуйте ще раз із тим самим ключем.', en: 'The verification service did not respond in time. Try again with the same key.' },
  NO_MODELS: { uk: 'Для цього ключа немає доступних моделей чату Gemini. Перевірте доступ до моделей у проєкті Google або використайте інший ключ.', en: 'No Gemini chat models are available for this key. Check model access in your Google project or use another key.' },
  PROVIDER_ERROR: { uk: 'Помилка сервісу Google. Спробуйте перевірити цей самий ключ пізніше.', en: 'The Google service returned an error. Try verifying the same key later.' },
  SERVER_UNAVAILABLE: { uk: 'Сервіс перевірки KARKAS недоступний або повернув некоректну відповідь. Ключ не вдалося перевірити. Спробуйте пізніше.', en: 'The KARKAS verification service is unavailable or returned an unexpected response. The key could not be checked. Try again later.' },
};

export const keyVerificationMessage = (error: unknown, lang: 'uk' | 'en'): string =>
  messages[error instanceof KeyVerificationError ? error.code : 'SERVER_UNAVAILABLE'][lang];
