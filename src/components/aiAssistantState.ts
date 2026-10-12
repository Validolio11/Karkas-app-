import type { AIResponse } from '../types';
import { looksLikeGeminiApiKey } from '../utils/apiKey';
import { normalizeTaskSchedule } from '../utils/taskScheduling';
import type { AIIntent } from '../types';
import { readAccountStorage, writeAccountStorage, removeAccountStorage } from '../utils/accountStorage';
import { AI_CHAT_CLIENT_TIMEOUT_MS } from '../utils/aiChatTiming';

export type AIMode = 'chat' | 'breakdown' | 'analyze' | 'generate';
export interface AIRequest {
  text: string;
  mode: AIMode;
  intent?: AIIntent;
  discoveryConfirmationId?: string;
  turnId?: string;
  purpose?: 'proposal';
  planningSource?: { text: string; mode: AIMode };
  internalAlternative?: true;
}
export interface AIAssistantDraft { prompt: string; mode: AIMode; recoverableRequest: AIRequest | null }
type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const modes: AIMode[] = ['chat', 'breakdown', 'analyze', 'generate'];
const draftPrefix = 'karkas_ai_draft';
const safeText = (value: unknown): value is string => typeof value === 'string' && !looksLikeGeminiApiKey(value);
const safeRequest = (value: unknown): AIRequest | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const request = value as Record<string, unknown>;
  if (!safeText(request.text) || !request.text.trim() || !modes.includes(request.mode as AIMode)) return null;
  const source = request.planningSource && typeof request.planningSource === 'object' && !Array.isArray(request.planningSource)
    ? request.planningSource as Record<string, unknown> : null;
  const planningSource = source && safeText(source.text) && source.text.trim() && modes.includes(source.mode as AIMode)
    ? { text: source.text, mode: source.mode as AIMode } : null;
  if (request.internalAlternative === true && !planningSource) return null;
  return {
    text: request.text,
    mode: request.mode as AIMode,
    ...(['auto', 'plan', 'analysis', 'steps'].includes(request.intent as string) ? { intent: request.intent as AIIntent } : {}),
    ...(typeof request.turnId === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(request.turnId) ? { turnId: request.turnId } : {}),
    ...(safeText(request.discoveryConfirmationId) && request.discoveryConfirmationId.length <= 200 ? { discoveryConfirmationId: request.discoveryConfirmationId } : {}),
    ...(request.purpose === 'proposal' ? { purpose: 'proposal' as const } : {}),
    ...(planningSource ? { planningSource, ...(request.internalAlternative === true ? { internalAlternative: true as const } : {}) } : {}),
  };
};

export function readAIAssistantDraft(storage: DraftStorage, accountId?: string | null): AIAssistantDraft | null {
  try {
    const value = JSON.parse(readAccountStorage(storage, draftPrefix, accountId) || 'null');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return {
      prompt: safeText(value.prompt) ? value.prompt : '',
      mode: modes.includes(value.mode) ? value.mode : 'chat',
      recoverableRequest: safeRequest(value.recoverableRequest),
    };
  } catch { return null; }
}

export function saveAIAssistantDraft(storage: DraftStorage, draft: AIAssistantDraft, accountId?: string | null): boolean {
  try {
    const safeDraft: AIAssistantDraft = {
      prompt: safeText(draft.prompt) ? draft.prompt : '',
      mode: modes.includes(draft.mode) ? draft.mode : 'chat',
      recoverableRequest: safeRequest(draft.recoverableRequest),
    };
    if (safeDraft.prompt || safeDraft.recoverableRequest) writeAccountStorage(storage, draftPrefix, accountId, JSON.stringify(safeDraft));
    else removeAccountStorage(storage, draftPrefix, accountId);
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

export type AIRequestErrorCode = 'INVALID_API_KEY' | 'ACCESS_DENIED' | 'QUOTA_EXCEEDED' | 'MODEL_UNAVAILABLE' | 'INVALID_REQUEST' | 'INVALID_AI_REQUEST' | 'NETWORK_ERROR' | 'TIMEOUT' | 'CLIENT_TIMEOUT' | 'PROVIDER_ERROR' | 'PROVIDER_UNAVAILABLE' | 'INTERNAL_ERROR' | 'MISSING_API_KEY' | 'INVALID_RESPONSE' | 'CANCELLED';
const knownCodes: AIRequestErrorCode[] = ['INVALID_API_KEY', 'ACCESS_DENIED', 'QUOTA_EXCEEDED', 'MODEL_UNAVAILABLE', 'INVALID_REQUEST', 'INVALID_AI_REQUEST', 'NETWORK_ERROR', 'TIMEOUT', 'CLIENT_TIMEOUT', 'PROVIDER_ERROR', 'PROVIDER_UNAVAILABLE', 'INTERNAL_ERROR', 'MISSING_API_KEY', 'INVALID_RESPONSE', 'CANCELLED'];
export class AIRequestError extends Error {
  constructor(public readonly code: AIRequestErrorCode) { super(code); this.name = 'AIRequestError'; }
}

export function responseRequestError(data: unknown, status: number): AIRequestError {
  const code = data && typeof data === 'object' && 'code' in data ? data.code : null;
  if (code === 'INVALID_AI_RESPONSE') return new AIRequestError('INVALID_RESPONSE');
  if (knownCodes.includes(code as AIRequestErrorCode)) return new AIRequestError(code as AIRequestErrorCode);
  // Native transport failures are not evidence that Google is unavailable.
  if (code === 'DESKTOP_ERROR' || code === 'UNTRUSTED_SENDER') return new AIRequestError('INTERNAL_ERROR');
  return new AIRequestError(status === 429 ? 'QUOTA_EXCEEDED' : status === 401 ? 'INVALID_API_KEY'
    : status === 403 ? 'ACCESS_DENIED' : status === 408 || status === 504 ? 'TIMEOUT'
      : status === 400 || status === 413 || status === 422 ? 'INVALID_REQUEST'
        : status === 503 ? 'PROVIDER_UNAVAILABLE' : status >= 500 ? 'PROVIDER_ERROR' : 'INTERNAL_ERROR');
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
  for (const item of [...(record.tasks || []), ...(record.taskUpdates || [])]) {
    if (item.schedule !== undefined && !normalizeTaskSchedule(item.schedule)) throw new AIRequestError('INVALID_RESPONSE');
  }
  if (record.tasks?.some((item: Record<string, unknown>) => typeof item.title !== 'string' || !item.title.trim()
    || hasInvalidText(item, ['title', 'note', 'phase']) || hasInvalidSteps(item) || (item.steps !== undefined && typeof item.steps !== 'number'))) throw new AIRequestError('INVALID_RESPONSE');
  if (record.tabs?.some((item: Record<string, unknown>) => typeof item.id !== 'string' || typeof item.name !== 'string' || hasInvalidText(item, ['color']))) throw new AIRequestError('INVALID_RESPONSE');
  if (record.taskUpdates?.some((item: Record<string, unknown>) => typeof item.id !== 'string' || hasInvalidText(item, ['title', 'note', 'phase']) || hasInvalidSteps(item))) throw new AIRequestError('INVALID_RESPONSE');
  if (record.taskDeletions?.some((item: Record<string, unknown>) => typeof item.id !== 'string'
    || hasInvalidText(item, ['reason'])
    || (item.deletionReason !== undefined && item.deletionReason !== 'accidental' && item.deletionReason !== 'cancelled'))) throw new AIRequestError('INVALID_RESPONSE');
  if (record.categoryHealth?.some((item: Record<string, unknown>) => hasInvalidText(item, ['phase', 'phaseName', 'status', 'recommendation']) || (item.taskCount !== undefined && typeof item.taskCount !== 'number'))) throw new AIRequestError('INVALID_RESPONSE');
  if (record.workloadDiagnosis && (typeof record.workloadDiagnosis !== 'object' || Array.isArray(record.workloadDiagnosis)
    || hasInvalidText(record.workloadDiagnosis, ['status']) || ['bottlenecks', 'strengths'].some(field => record.workloadDiagnosis[field] !== undefined
      && (!Array.isArray(record.workloadDiagnosis[field]) || record.workloadDiagnosis[field].some((text: unknown) => typeof text !== 'string'))))) throw new AIRequestError('INVALID_RESPONSE');
  if (record.insights?.some((item: unknown) => typeof item !== 'string')) throw new AIRequestError('INVALID_RESPONSE');
  if (record.strategy !== undefined) {
    const strategy = record.strategy;
    const isObject = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
    const stringArray = (value: unknown) => Array.isArray(value) && value.every(item => typeof item === 'string');
    if (!isObject(strategy) || hasInvalidText(strategy, ['question', 'narrative', 'nextAction', 'focusTaskId'])
      || (strategy.status !== undefined && !['getting_to_know', 'clarifying', 'ready'].includes(strategy.status))) throw new AIRequestError('INVALID_RESPONSE');
    if (strategy.actions !== undefined && (!Array.isArray(strategy.actions) || strategy.actions.some((action: unknown) => !isObject(action)
      || typeof action.id !== 'string' || typeof action.goalId !== 'string' || typeof action.reason !== 'string'
      || !['create', 'update'].includes(action.type) || !isObject(action.changes)
      || (action.taskId !== undefined && typeof action.taskId !== 'string')
      || hasInvalidText(action.changes, ['title', 'phase', 'note'])
      || (action.changes.stepTitles !== undefined && !stringArray(action.changes.stepTitles))))) throw new AIRequestError('INVALID_RESPONSE');
    if (strategy.memoryPatch !== undefined) {
      const patch = strategy.memoryPatch;
      if (!isObject(patch) || hasInvalidText(patch, ['phase'])
        || (patch.onboardingStatus !== undefined && !['new', 'in_progress', 'complete'].includes(patch.onboardingStatus))) throw new AIRequestError('INVALID_RESPONSE');
      for (const field of ['facts', 'barriers', 'preferences']) {
        if (patch[field] !== undefined && (!Array.isArray(patch[field]) || patch[field].some((entry: unknown) => !isObject(entry)
          || typeof entry.id !== 'string' || typeof entry.text !== 'string' || !['user', 'hypothesis'].includes(entry.source)))) throw new AIRequestError('INVALID_RESPONSE');
      }
      if (patch.goals !== undefined && (!Array.isArray(patch.goals) || patch.goals.some((goal: unknown) => !isObject(goal)
        || typeof goal.id !== 'string' || typeof goal.title !== 'string' || typeof goal.motive !== 'string'
        || typeof goal.agreed !== 'boolean' || !stringArray(goal.taskIds) || !stringArray(goal.categoryIds)))) throw new AIRequestError('INVALID_RESPONSE');
      if (patch.discovery !== undefined) {
        const discovery = patch.discovery;
        const topics = ['direction', 'motivation', 'circumstances', 'barriers', 'capacity', 'attempts'];
        if (!isObject(discovery)
          || (discovery.answers !== undefined && (!Array.isArray(discovery.answers) || discovery.answers.length > 12
            || discovery.answers.some((answer: unknown) => !isObject(answer) || !topics.includes(answer.topic)
              || typeof answer.quote !== 'string' || !answer.quote.trim() || !['answered', 'deferred'].includes(answer.status))))
          || (discovery.selectedGoalIds !== undefined && (!stringArray(discovery.selectedGoalIds) || discovery.selectedGoalIds.length > 50))
          || (discovery.question !== undefined && (!isObject(discovery.question) || !topics.includes(discovery.question.topic)
            || typeof discovery.question.text !== 'string' || !discovery.question.text.trim()))
          || (discovery.summary !== undefined && (typeof discovery.summary !== 'string' || !discovery.summary.trim()))) throw new AIRequestError('INVALID_RESPONSE');
      }
    }
  }
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
  TIMEOUT: { uk: 'Google не відповів у відведений для запиту час. Повторіть запит або виберіть іншу модель.', en: 'Google did not respond within the request time limit. Retry or select another model.' },
  CLIENT_TIMEOUT: { uk: `Додаток припинив очікування відповіді через ${AI_CHAT_CLIENT_TIMEOUT_MS / 1000} секунд. Повторіть запит або виберіть іншу модель.`, en: `The app stopped waiting for a response after ${AI_CHAT_CLIENT_TIMEOUT_MS / 1000} seconds. Retry or select another model.` },
  PROVIDER_ERROR: { uk: 'Google не зміг виконати запит до AI. Повторіть запит пізніше або виберіть іншу модель.', en: 'Google could not complete the AI request. Retry later or select another model.' },
  PROVIDER_UNAVAILABLE: { uk: 'Google повідомив, що AI тимчасово недоступний. Зачекайте й повторіть запит або виберіть іншу модель.', en: 'Google reported that AI is temporarily unavailable. Wait and retry or select another model.' },
  INTERNAL_ERROR: { uk: 'Додаток не зміг обробити AI-запит. Повторіть запит; якщо помилка повторюється, повідомте про неї.', en: 'The app could not process the AI request. Retry; if this continues, report the problem.' },
  INVALID_RESPONSE: { uk: 'AI не зміг підготувати коректну відповідь. Повторіть запит або виберіть іншу модель.', en: 'AI could not prepare a valid response. Retry the request or select another model.' },
  CANCELLED: { uk: 'Запит перервано. Його збережено, щоб ви могли продовжити.', en: 'The request was interrupted and saved so you can continue.' },
};
export function aiRequestErrorMessage(error: unknown, lang: 'uk' | 'en'): string {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : '';
  const code: AIRequestErrorCode = error instanceof AIRequestError ? error.code
    : name === 'AbortError' ? 'CANCELLED' : name === 'TimeoutError' ? 'TIMEOUT'
      : name === 'NetworkError' || /failed to fetch|fetch failed|network(?:error| error| request failed)|load failed|ENOTFOUND|ECONNRESET|ECONNREFUSED|EAI_AGAIN/i.test(message)
        ? 'NETWORK_ERROR' : 'INTERNAL_ERROR';
  return `${errorMessages[code][lang]} ${lang === 'uk' ? 'Зміни до завдань не застосовано.' : 'No task changes were applied.'}`;
}

export function restoredAIRequestNotice(request: AIRequest | null | undefined, lang: 'uk' | 'en'): string | null {
  if (!request) return null;
  if (request.purpose === 'proposal') return lang === 'uk'
    ? 'Незастосовану пропозицію не відновлено. Повторіть запит, щоб підготувати нову пропозицію. Зміни до завдань не застосовано.'
    : 'The unapplied proposal was not restored. Retry the request to prepare a new proposal. No task changes were applied.';
  return aiRequestErrorMessage(new AIRequestError('CANCELLED'), lang);
}
