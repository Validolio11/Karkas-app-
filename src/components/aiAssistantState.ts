import type { AIResponse } from '../types';
import { looksLikeGeminiApiKey } from '../utils/apiKey';
import { normalizeTaskSchedule } from '../utils/taskScheduling';
import type { AIIntent } from '../types';
import { readAccountStorage, writeAccountStorage, removeAccountStorage } from '../utils/accountStorage';
import { AI_CHAT_CLIENT_TIMEOUT_MS, AI_DEFAULT_MODEL_PREFERENCE } from '../utils/aiChatTiming';

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

/** Version of a gemini-<major>[.<minor>] name for newest-first ordering within a tier. */
const modelVersion = (model: string): [number, number] => {
  const match = /^gemini-(\d+)(?:\.(\d+))?-/.exec(model);
  return match ? [Number(match[1]), Number(match[2] ?? 0)] : [-1, -1];
};

// Selector pruning rules; edit these lists when Google retires or adds families.
// Legacy generations answer poorly or return 404 for new projects.
const LEGACY_MODEL = /^gemini-[0-2](?:\.\d+)?-/;
// Name segments of specialised variants that are not general chat models
// (omni = video generation, banana = image generation).
const SPECIALISED_SEGMENTS = new Set(['embedding', 'image', 'tts', 'transcribe', 'robotics', 'computer', 'customtools',
  'live', 'audio', 'aqa', 'learnlm', 'gemma', 'banana', 'omni', 'exp', 'experimental', 'vision']);
// Versioned chat families; only the newest release of each is offered.
const FAMILY_MODEL = /^gemini-(\d+)(?:\.(\d+))?-(flash-lite|flash|pro)(-preview(?:-\d{2}-\d{4})?)?$/;
/** Family and order of a versioned model: newer version first, then stable over preview. */
const familyRank = (model: string) => {
  const match = FAMILY_MODEL.exec(model.toLowerCase());
  return match ? { family: match[3], score: Number(match[1]) * 1e6 + Number(match[2] ?? 0) * 10 + (match[4] ? 0 : 1) } : null;
};

/**
 * Chat models worth offering: no legacy generations, specialised variants or
 * models this key returned 404 for (`hidden`); per family (flash, flash-lite, pro)
 * only the newest release, so a newer preview outranks an older stable model but a
 * stable model outranks a preview of the same version. Aliases (gemini-flash-latest)
 * stay; pinned (-001) or preview duplicates of another offered name are hidden. If
 * the rules remove everything, the full list is kept so the selector is never empty.
 */
export function visibleChatModels(models: string[], hidden: readonly string[] = []): string[] {
  const candidates = models.filter(model => {
    const name = model.toLowerCase();
    return !LEGACY_MODEL.test(name) && !hidden.includes(model) && !name.split('-').some(segment => SPECIALISED_SEGMENTS.has(segment));
  });
  const offered = new Set(candidates);
  const newest = new Map<string, number>();
  for (const model of candidates) {
    const rank = familyRank(model);
    if (rank && rank.score > (newest.get(rank.family) ?? -1)) newest.set(rank.family, rank.score);
  }
  const visible = candidates.filter(model => {
    const rank = familyRank(model);
    if (rank) return rank.score === newest.get(rank.family);
    const base = /^(.+?)-(?:preview(?:-\d{2}-\d{4})?|\d{3})$/.exec(model)?.[1];
    return !(base && offered.has(base));
  });
  return visible.length ? visible : models;
}

/**
 * Keep the person's choice while it is still offered; otherwise pick the best
 * offered model by AI_DEFAULT_MODEL_PREFERENCE instead of the provider's first
 * entry, which can be a legacy model the project cannot use.
 */
export function selectAIModel(listedModels: string[], preferred: string, hidden: readonly string[] = []): string {
  const models = visibleChatModels(listedModels, hidden);
  if (models.includes(preferred)) return preferred;
  for (const tier of AI_DEFAULT_MODEL_PREFERENCE) {
    const [best] = models.filter(model => tier.test(model)).sort((a, b) => {
      const [aMajor, aMinor] = modelVersion(a);
      const [bMajor, bMinor] = modelVersion(b);
      return bMajor - aMajor || bMinor - aMinor;
    });
    if (best) return best;
  }
  return models[0] || '';
}

/**
 * The model to remember after a successful reply. Only a selected model that
 * Google reported as unavailable (404, or a 0 quota on the project's tier) is
 * replaced, and only by a listed model,
 * so quota or transient failures never override the person's choice.
 */
export function adoptedAIModel(response: { usedModel?: unknown; fallbackUsed?: unknown; aiMetrics?: unknown }, selected: string, models: string[]): string | null {
  const metrics = response.aiMetrics && typeof response.aiMetrics === 'object' ? response.aiMetrics as Record<string, unknown> : {};
  const used = typeof response.usedModel === 'string' ? response.usedModel : '';
  if (response.fallbackUsed !== true || !['MODEL_UNAVAILABLE', 'MODEL_TIER_UNAVAILABLE'].includes(metrics.selectedModelFailure as string)) return null;
  return used && used !== selected && models.includes(used) ? used : null;
}

export function appendChatRequest<T extends { role: 'user' | 'assistant'; content: string }>(messages: T[], text: string): (T | { role: 'user'; content: string })[] {
  const last = messages.at(-1);
  return last?.role === 'user' && last.content === text ? messages : [...messages, { role: 'user', content: text }];
}

export type AIRequestErrorCode = 'INVALID_API_KEY' | 'ACCESS_DENIED' | 'QUOTA_EXCEEDED' | 'MODEL_UNAVAILABLE' | 'MODEL_TIER_UNAVAILABLE' | 'INVALID_REQUEST' | 'INVALID_AI_REQUEST' | 'NETWORK_ERROR' | 'TIMEOUT' | 'CLIENT_TIMEOUT' | 'PROVIDER_ERROR' | 'PROVIDER_UNAVAILABLE' | 'INTERNAL_ERROR' | 'MISSING_API_KEY' | 'INVALID_RESPONSE' | 'CANCELLED' | 'CONTEXT_TOO_LARGE';
const knownCodes: AIRequestErrorCode[] = ['INVALID_API_KEY', 'ACCESS_DENIED', 'QUOTA_EXCEEDED', 'MODEL_UNAVAILABLE', 'MODEL_TIER_UNAVAILABLE', 'INVALID_REQUEST', 'INVALID_AI_REQUEST', 'NETWORK_ERROR', 'TIMEOUT', 'CLIENT_TIMEOUT', 'PROVIDER_ERROR', 'PROVIDER_UNAVAILABLE', 'INTERNAL_ERROR', 'MISSING_API_KEY', 'INVALID_RESPONSE', 'CANCELLED', 'CONTEXT_TOO_LARGE'];
export type AIProviderUnavailableReason = 'HIGH_DEMAND' | 'OVERLOADED' | 'TEMPORARILY_UNAVAILABLE';
const unavailableReasons: AIProviderUnavailableReason[] = ['HIGH_DEMAND', 'OVERLOADED', 'TEMPORARILY_UNAVAILABLE'];
export interface AIRequestDiagnostics {
  attempts: { model: string; code: AIRequestErrorCode; elapsedMs: number; reason?: AIProviderUnavailableReason }[];
  elapsedMs: number;
}

/** Provider messages and arbitrary model labels must never enter the error card. */
function readAIRequestDiagnostics(value: unknown): AIRequestDiagnostics | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const safeDuration = (duration: unknown): duration is number => typeof duration === 'number'
    && Number.isFinite(duration) && duration >= 0 && duration <= 600_000;
  if (!safeDuration(record.elapsedMs) || !Array.isArray(record.attempts)) return undefined;
  const attempts: AIRequestDiagnostics['attempts'] = [];
  for (const value of record.attempts.slice(0, 8)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const attempt = value as Record<string, unknown>;
    if (typeof attempt.model !== 'string' || attempt.model.length > 100
      || /(?:AIza|AQ\.)[\w.-]{20,}/i.test(attempt.model) || !safeDuration(attempt.elapsedMs)) continue;
    const model = attempt.model.replace(/^models\//, '').toLowerCase();
    if (!/^gemini-(?:\d+(?:\.\d+)*-(?:flash|pro)|(?:flash(?:-lite)?|pro)-latest)(?:-[a-z0-9]+)*$/.test(model)) continue;
    const code = attempt.code === 'INVALID_AI_RESPONSE' ? 'INVALID_RESPONSE' : attempt.code;
    if (!knownCodes.includes(code as AIRequestErrorCode)) continue;
    const reason = code === 'PROVIDER_UNAVAILABLE' && unavailableReasons.includes(attempt.reason as AIProviderUnavailableReason)
      ? attempt.reason as AIProviderUnavailableReason : undefined;
    attempts.push({ model, code: code as AIRequestErrorCode, elapsedMs: Math.round(attempt.elapsedMs), ...(reason ? { reason } : {}) });
  }
  return attempts.length ? { attempts, elapsedMs: Math.round(record.elapsedMs) } : undefined;
}

export class AIRequestError extends Error {
  readonly diagnostics?: AIRequestDiagnostics;
  constructor(public readonly code: AIRequestErrorCode, diagnostics?: unknown) {
    super(code);
    this.name = 'AIRequestError';
    this.diagnostics = readAIRequestDiagnostics(diagnostics);
  }
}

export function responseRequestError(data: unknown, status: number): AIRequestError {
  const code = data && typeof data === 'object' && 'code' in data ? data.code : null;
  const diagnostics = data && typeof data === 'object' && 'diagnostics' in data ? data.diagnostics : undefined;
  if (code === 'INVALID_AI_RESPONSE') return new AIRequestError('INVALID_RESPONSE', diagnostics);
  if (knownCodes.includes(code as AIRequestErrorCode)) return new AIRequestError(code as AIRequestErrorCode, diagnostics);
  // Native transport failures are not evidence that Google is unavailable.
  if (code === 'DESKTOP_ERROR' || code === 'UNTRUSTED_SENDER') return new AIRequestError('INTERNAL_ERROR');
  return new AIRequestError(status === 429 ? 'QUOTA_EXCEEDED' : status === 401 ? 'INVALID_API_KEY'
    : status === 403 ? 'ACCESS_DENIED' : status === 408 || status === 504 ? 'TIMEOUT'
      : status === 400 || status === 413 || status === 422 ? 'INVALID_REQUEST'
        : status === 503 ? 'PROVIDER_UNAVAILABLE' : status >= 500 ? 'PROVIDER_ERROR' : 'INTERNAL_ERROR', diagnostics);
}

export function readAIResponse(value: unknown, mode: AIMode): AIResponse & { usedModel?: string; fallbackUsed?: boolean; aiMetrics?: unknown } {
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
  CONTEXT_TOO_LARGE: { uk: 'Контекст запиту завеликий. Зменште кількість завдань або текст і повторіть запит.', en: 'The request context is too large. Reduce the task scope or text and retry.' },
  INVALID_API_KEY: { uk: 'Google відхилив API-ключ. Введіть правильний ключ і повторіть запит.', en: 'Google rejected the API key. Enter a valid key and retry.' },
  MISSING_API_KEY: { uk: 'Для цього запиту потрібен Gemini API-ключ. Вставте його нижче, щоб продовжити.', en: 'This request needs a Gemini API key. Paste it below to continue.' },
  ACCESS_DENIED: { uk: 'Google заборонив доступ до AI. Перевірте дозволи ключа та доступ до Gemini API.', en: 'Google denied AI access. Check key permissions and Gemini API access.' },
  QUOTA_EXCEEDED: { uk: 'Ліміт Gemini вичерпано. Зачекайте на його відновлення або перевірте квоту проєкту Google, потім повторіть запит.', en: 'The Gemini quota is exhausted. Wait for it to reset or check your Google project quota, then retry.' },
  MODEL_UNAVAILABLE: { uk: 'Вибрана модель Gemini недоступна. Виберіть іншу модель і повторіть запит.', en: 'The selected Gemini model is unavailable. Select another model and retry.' },
  MODEL_TIER_UNAVAILABLE: { uk: 'Модель недоступна на безкоштовному тарифі Google — оберіть іншу, наприклад Flash-Lite, і повторіть запит.', en: 'This model is not available on the Google free tier — select another one, such as Flash-Lite, and retry.' },
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
const diagnosticReasons: Record<AIRequestErrorCode, { uk: string; en: string }> = {
  MODEL_TIER_UNAVAILABLE: { uk: 'модель недоступна на цьому тарифі', en: 'model unavailable on this tier' },
  CONTEXT_TOO_LARGE: { uk: 'контекст завеликий', en: 'context too large' },
  INVALID_API_KEY: { uk: 'ключ відхилено', en: 'key rejected' },
  MISSING_API_KEY: { uk: 'немає API-ключа', en: 'API key missing' },
  ACCESS_DENIED: { uk: 'доступ заборонено', en: 'access denied' },
  QUOTA_EXCEEDED: { uk: 'ліміт запитів вичерпано', en: 'quota exhausted' },
  MODEL_UNAVAILABLE: { uk: 'модель недоступна', en: 'model unavailable' },
  INVALID_REQUEST: { uk: 'запит відхилено', en: 'request rejected' },
  INVALID_AI_REQUEST: { uk: 'запит додатка відхилено', en: 'app request rejected' },
  NETWORK_ERROR: { uk: 'не вдалося з’єднатися', en: 'connection failed' },
  TIMEOUT: { uk: 'перевищено час очікування', en: 'response timed out' },
  CLIENT_TIMEOUT: { uk: 'додаток припинив очікування', en: 'app stopped waiting' },
  PROVIDER_ERROR: { uk: 'помилка обробки запиту', en: 'request processing failed' },
  PROVIDER_UNAVAILABLE: { uk: 'сервіс тимчасово недоступний', en: 'service temporarily unavailable' },
  INTERNAL_ERROR: { uk: 'помилка обробки в додатку', en: 'app processing error' },
  INVALID_RESPONSE: { uk: 'некоректна відповідь', en: 'invalid response' },
  CANCELLED: { uk: 'запит перервано', en: 'request cancelled' },
};
const unavailableReasonLabels: Record<AIProviderUnavailableReason, { uk: string; en: string }> = {
  HIGH_DEMAND: { uk: 'високий попит на модель', en: 'high demand for the model' },
  OVERLOADED: { uk: 'модель перевантажена', en: 'model overloaded' },
  TEMPORARILY_UNAVAILABLE: { uk: 'сервіс тимчасово недоступний', en: 'service temporarily unavailable' },
};
export const aiRequestDiagnosticReason = (code: AIRequestErrorCode, lang: 'uk' | 'en', reason?: AIProviderUnavailableReason): string =>
  code === 'PROVIDER_UNAVAILABLE' && reason ? unavailableReasonLabels[reason][lang] : diagnosticReasons[code][lang];
export const formatAIRequestDuration = (elapsedMs: number, lang: 'uk' | 'en'): string =>
  `${new Intl.NumberFormat(lang === 'uk' ? 'uk-UA' : 'en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(elapsedMs / 1000)} ${lang === 'uk' ? 'с' : 's'}`;

export function aiRequestErrorMessage(error: unknown, lang: 'uk' | 'en'): string {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : '';
  const code: AIRequestErrorCode = error instanceof AIRequestError ? error.code
    : name === 'AbortError' ? 'CANCELLED' : name === 'TimeoutError' ? 'TIMEOUT'
      : name === 'NetworkError' || /failed to fetch|fetch failed|network(?:error| error| request failed)|load failed|ENOTFOUND|ECONNRESET|ECONNREFUSED|EAI_AGAIN/i.test(message)
        ? 'NETWORK_ERROR' : 'INTERNAL_ERROR';
  const reasons = error instanceof AIRequestError && !['CANCELLED', 'CLIENT_TIMEOUT'].includes(code)
    ? [...new Set(error.diagnostics?.attempts.map(attempt => attempt.code))] : [];
  const messageText = reasons.length > 1
    ? (lang === 'uk'
      ? `Не вдалося отримати відповідь. Причини спроб: ${reasons.map(reason => aiRequestDiagnosticReason(reason, lang)).join('; ')}. Повторіть запит або виберіть іншу модель.`
      : `Could not obtain a response. Attempt results: ${reasons.map(reason => aiRequestDiagnosticReason(reason, lang)).join('; ')}. Retry or select another model.`)
    : errorMessages[code][lang];
  return `${messageText} ${lang === 'uk' ? 'Зміни до завдань не застосовано.' : 'No task changes were applied.'}`;
}

export function restoredAIRequestNotice(request: AIRequest | null | undefined, lang: 'uk' | 'en'): string | null {
  if (!request) return null;
  if (request.purpose === 'proposal') return lang === 'uk'
    ? 'Незастосовану пропозицію не відновлено. Повторіть запит, щоб підготувати нову пропозицію. Зміни до завдань не застосовано.'
    : 'The unapplied proposal was not restored. Retry the request to prepare a new proposal. No task changes were applied.';
  return aiRequestErrorMessage(new AIRequestError('CANCELLED'), lang);
}

/**
 * Accumulates streamed reply fragments and publishes the growing text at most
 * once per animation frame, so a fast stream does not re-render per token.
 */
export function createStreamedReplyBuffer(publish: (text: string) => void, schedule: (callback: () => void) => unknown = callback => requestAnimationFrame(callback),
  unschedule: (handle: unknown) => void = handle => cancelAnimationFrame(handle as number)) {
  let text = '';
  let handle: unknown = null;
  let stopped = false;
  const flush = () => {
    handle = null;
    if (!stopped) publish(text);
  };
  return {
    get text() { return text; },
    push(delta: string) {
      if (stopped || !delta) return;
      text += delta;
      if (handle === null) handle = schedule(flush);
    },
    /** Stop publishing; the accumulated text stays readable. */
    stop() {
      stopped = true;
      if (handle !== null) unschedule(handle);
      handle = null;
    },
  };
}
