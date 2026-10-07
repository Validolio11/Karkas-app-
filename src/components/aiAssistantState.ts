import type { AIResponse } from '../types';
import { looksLikeGeminiApiKey } from '../utils/apiKey';

export type AIMode = 'chat' | 'breakdown' | 'analyze' | 'generate';
export interface AIRequest { text: string; mode: AIMode; purpose?: 'proposal' }
export interface AIAssistantDraft { prompt: string; mode: AIMode; recoverableRequest: AIRequest | null }
type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const modes: AIMode[] = ['chat', 'breakdown', 'analyze', 'generate'];
const draftKey = (accountId?: string | null) => `karkas_ai_draft:${accountId || 'guest'}`;
const safeText = (value: unknown): value is string => typeof value === 'string' && !looksLikeGeminiApiKey(value);

export function readAIAssistantDraft(storage: DraftStorage, accountId?: string | null): AIAssistantDraft | null {
  try {
    const value = JSON.parse(storage.getItem(draftKey(accountId)) || 'null');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const request = value.recoverableRequest;
    return {
      prompt: safeText(value.prompt) ? value.prompt : '',
      mode: modes.includes(value.mode) ? value.mode : 'chat',
      recoverableRequest: request && safeText(request.text) && request.text.trim() && modes.includes(request.mode)
        ? { text: request.text, mode: request.mode, ...(request.purpose === 'proposal' ? { purpose: 'proposal' as const } : {}) } : null,
    };
  } catch { return null; }
}

export function saveAIAssistantDraft(storage: DraftStorage, draft: AIAssistantDraft, accountId?: string | null): boolean {
  try {
    const safeDraft = { ...draft, prompt: safeText(draft.prompt) ? draft.prompt : '',
      recoverableRequest: draft.recoverableRequest && safeText(draft.recoverableRequest.text) ? draft.recoverableRequest : null };
    if (safeDraft.prompt || safeDraft.recoverableRequest) storage.setItem(draftKey(accountId), JSON.stringify(safeDraft));
    else storage.removeItem(draftKey(accountId));
    return true;
  } catch { return false; }
}

export function selectAIModel(models: string[], preferred: string): string {
  return models.includes(preferred) ? preferred : models[0] || '';
}

export function appendChatRequest<T extends { role: 'user' | 'assistant'; content: string }>(messages: T[], text: string): (T | { role: 'user'; content: string })[] {
  const last = messages.at(-1);
  return last?.role === 'user' && last.content === text ? messages : [...messages, { role: 'user', content: text }];
}

export type AIRequestErrorCode = 'INVALID_API_KEY' | 'ACCESS_DENIED' | 'QUOTA_EXCEEDED' | 'MODEL_UNAVAILABLE' | 'INVALID_REQUEST' | 'INVALID_AI_REQUEST' | 'NETWORK_ERROR' | 'TIMEOUT' | 'PROVIDER_ERROR' | 'MISSING_API_KEY' | 'INVALID_RESPONSE' | 'CANCELLED';
const knownCodes: AIRequestErrorCode[] = ['INVALID_API_KEY', 'ACCESS_DENIED', 'QUOTA_EXCEEDED', 'MODEL_UNAVAILABLE', 'INVALID_REQUEST', 'INVALID_AI_REQUEST', 'NETWORK_ERROR', 'TIMEOUT', 'PROVIDER_ERROR', 'MISSING_API_KEY', 'INVALID_RESPONSE', 'CANCELLED'];
export class AIRequestError extends Error {
  constructor(public readonly code: AIRequestErrorCode) { super(code); this.name = 'AIRequestError'; }
}

export function responseRequestError(data: unknown, status: number): AIRequestError {
  const code = data && typeof data === 'object' && 'code' in data ? data.code : null;
  return new AIRequestError(code === 'INVALID_AI_RESPONSE' ? 'INVALID_RESPONSE' : knownCodes.includes(code as AIRequestErrorCode) ? code as AIRequestErrorCode
    : status === 429 ? 'QUOTA_EXCEEDED' : status === 401 ? 'INVALID_API_KEY' : status === 403 ? 'ACCESS_DENIED' : 'PROVIDER_ERROR');
}

export function readAIResponse(value: unknown, mode: AIMode): AIResponse & { usedModel?: string; fallbackUsed?: boolean } {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : null;
  if (!record || typeof (mode === 'chat' ? record.reply || record.summary : record.summary) !== 'string'
    || !(mode === 'chat' ? record.reply || record.summary : record.summary).trim()) throw new AIRequestError('INVALID_RESPONSE');
  for (const name of ['tasks', 'tabs', 'taskUpdates', 'taskDeletions', 'categoryHealth', 'insights']) {
    if (record[name] !== undefined && !Array.isArray(record[name])) throw new AIRequestError('INVALID_RESPONSE');
  }
  for (const name of ['tasks', 'tabs', 'taskUpdates', 'taskDeletions', 'categoryHealth']) {
    if (record[name]?.some((item: unknown) => !item || typeof item !== 'object' || Array.isArray(item))) throw new AIRequestError('INVALID_RESPONSE');
  }
  const hasInvalidText = (item: Record<string, unknown>, fields: string[]) => fields.some(field => item[field] !== undefined && typeof item[field] !== 'string');
  const hasInvalidSteps = (item: Record<string, unknown>) => item.stepList !== undefined && (!Array.isArray(item.stepList)
    || item.stepList.some(step => !step || typeof step !== 'object' || typeof step.title !== 'string'));
  if (record.tasks?.some((item: Record<string, unknown>) => typeof item.title !== 'string' || !item.title.trim()
    || hasInvalidText(item, ['title', 'note', 'phase']) || hasInvalidSteps(item) || (item.steps !== undefined && typeof item.steps !== 'number'))) throw new AIRequestError('INVALID_RESPONSE');
  if (record.tabs?.some((item: Record<string, unknown>) => typeof item.id !== 'string' || typeof item.name !== 'string' || hasInvalidText(item, ['color']))) throw new AIRequestError('INVALID_RESPONSE');
  if (record.taskUpdates?.some((item: Record<string, unknown>) => typeof item.id !== 'string' || hasInvalidText(item, ['title', 'note', 'phase']) || hasInvalidSteps(item))) throw new AIRequestError('INVALID_RESPONSE');
  if (record.taskDeletions?.some((item: Record<string, unknown>) => typeof item.id !== 'string')) throw new AIRequestError('INVALID_RESPONSE');
  if (record.categoryHealth?.some((item: Record<string, unknown>) => hasInvalidText(item, ['phase', 'phaseName', 'status', 'recommendation']) || (item.taskCount !== undefined && typeof item.taskCount !== 'number'))) throw new AIRequestError('INVALID_RESPONSE');
  if (record.workloadDiagnosis && (typeof record.workloadDiagnosis !== 'object' || Array.isArray(record.workloadDiagnosis)
    || hasInvalidText(record.workloadDiagnosis, ['status']) || ['bottlenecks', 'strengths'].some(field => record.workloadDiagnosis[field] !== undefined
      && (!Array.isArray(record.workloadDiagnosis[field]) || record.workloadDiagnosis[field].some((text: unknown) => typeof text !== 'string'))))) throw new AIRequestError('INVALID_RESPONSE');
  if (record.insights?.some((item: unknown) => typeof item !== 'string')) throw new AIRequestError('INVALID_RESPONSE');
  if (record.source === 'local-chat-fallback' || record.source === 'local-timer-fallback') throw new AIRequestError('PROVIDER_ERROR');
  if (record.source === 'invalid-ai-proposal') throw new AIRequestError('INVALID_RESPONSE');
  return record as AIResponse;
}

const errorMessages: Record<AIRequestErrorCode, { uk: string; en: string }> = {
  INVALID_API_KEY: { uk: 'Google відхилив API-ключ. Введіть правильний ключ і повторіть запит.', en: 'Google rejected the API key. Enter a valid key and retry.' },
  MISSING_API_KEY: { uk: 'Для цього запиту потрібен Gemini API-ключ. Вставте його нижче, щоб продовжити.', en: 'This request needs a Gemini API key. Paste it below to continue.' },
  ACCESS_DENIED: { uk: 'Google заборонив доступ до AI. Перевірте дозволи ключа та доступ до Gemini API.', en: 'Google denied AI access. Check key permissions and Gemini API access.' },
  QUOTA_EXCEEDED: { uk: 'Ліміт Gemini вичерпано. Зачекайте на його відновлення або перевірте квоту проєкту Google, потім повторіть запит.', en: 'The Gemini quota is exhausted. Wait for it to reset or check your Google project quota, then retry.' },
  MODEL_UNAVAILABLE: { uk: 'Вибрана модель Gemini недоступна. Виберіть іншу модель і повторіть запит.', en: 'The selected Gemini model is unavailable. Select another model and retry.' },
  INVALID_REQUEST: { uk: 'Gemini не прийняв запит. Уточніть його й спробуйте ще раз.', en: 'Gemini did not accept this request. Revise it and try again.' },
  INVALID_AI_REQUEST: { uk: 'Сервіс AI відхилив запит додатка. Повторіть пізніше; якщо помилка повторюється, оновіть додаток.', en: 'The AI service rejected the app request. Retry later; if this continues, update the app.' },
  NETWORK_ERROR: { uk: 'Не вдалося з’єднатися з AI. Перевірте інтернет і повторіть запит.', en: 'Could not connect to AI. Check your connection and retry.' },
  TIMEOUT: { uk: 'AI не відповів вчасно. Спробуйте ще раз або виберіть іншу модель.', en: 'AI did not respond in time. Retry or select another model.' },
  PROVIDER_ERROR: { uk: 'Сервіс AI зараз недоступний. Спробуйте повторити запит пізніше.', en: 'The AI service is unavailable. Retry later.' },
  INVALID_RESPONSE: { uk: 'AI не зміг підготувати коректну відповідь. Повторіть запит або виберіть іншу модель.', en: 'AI could not prepare a valid response. Retry the request or select another model.' },
  CANCELLED: { uk: 'Запит перервано. Його збережено, щоб ви могли продовжити.', en: 'The request was interrupted and saved so you can continue.' },
};
export function aiRequestErrorMessage(error: unknown, lang: 'uk' | 'en'): string {
  const code = error instanceof AIRequestError ? error.code : 'NETWORK_ERROR';
  return `${errorMessages[code][lang]} ${lang === 'uk' ? 'Зміни до завдань не застосовано.' : 'No task changes were applied.'}`;
}

export function restoredAIRequestNotice(request: AIRequest | null | undefined, lang: 'uk' | 'en'): string | null {
  if (!request) return null;
  if (request.purpose === 'proposal') return lang === 'uk'
    ? 'Незастосовану пропозицію не відновлено. Повторіть запит, щоб підготувати нову пропозицію. Зміни до завдань не застосовано.'
    : 'The unapplied proposal was not restored. Retry the request to prepare a new proposal. No task changes were applied.';
  return aiRequestErrorMessage(new AIRequestError('CANCELLED'), lang);
}
