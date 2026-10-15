import type { AIStrategyResponse, PersonalStrategyProfile, StrategyGoal, StrategyMemoryEntry, StrategyMemoryPatch } from '../types';
import { applyDiscoveryTurn, isPersonalStrategyReady, normalizeStrategyDiscovery } from './strategyDiscovery';
import { readAccountStorage } from './accountStorage';
import { preserveRawStorage } from './recoverableLocalStorage';

export type StrategyStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const strategyOwnerKey = (owner: string | null) => owner === null ? 'guest' : `account:${owner}`;
export const personalStrategyKey = (owner: string | null) => `karkas.personal-strategy.v1:${encodeURIComponent(strategyOwnerKey(owner))}`;
export function createPersonalStrategyProfile(): PersonalStrategyProfile {
  return { version: 1, onboardingStatus: 'new', phase: 'goals', goals: [], facts: [], barriers: [], preferences: [],
    feedback: [], actionHistory: [], processedTurnIds: [], reminders: { enabled: false, times: [], maxPerDay: 2 } };
}
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = 2000) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const ids = (value: unknown, limit = 200) => Array.isArray(value) ? [...new Set(value.filter(item => typeof item === 'string' && item.trim()).slice(0, limit))] as string[] : [];
const matchesUserStatement = (statement: string, source: string) => statement === source.trim()
  || source.split(/[.!?\n]+/u).some(part => part.trim() === statement);
// Legacy optional fields remain readable, but anything hydration would discard
// is backed up before the normalized profile can replace its source.
export function intactStoredStrategy(raw: unknown): boolean {
  if (!record(raw) || raw.version !== 1) return false;
  const list = (value: unknown, valid: (entry: any) => boolean, limit = Infinity) => value === undefined
    || Array.isArray(value) && value.length <= limit && value.every(valid);
  const stringIds = (value: unknown, limit = 200) => list(value, value => typeof value === 'string' && !!value.trim(), limit)
    && (value === undefined || new Set(value as string[]).size === (value as string[]).length);
  const optionalText = (value: unknown, limit: number) => value === undefined || typeof value === 'string' && value.length <= limit;
  const entry = (value: any) => record(value) && !!text(value.id) && !!text(value.text)
    && ['user', 'hypothesis'].includes(value.source) && optionalText(value.id, 120)
    && optionalText(value.text, 2000) && optionalText(value.messageId, 200) && optionalText(value.quote, 8000);
  return (raw.onboardingStatus === undefined || ['new', 'in_progress', 'complete'].includes(raw.onboardingStatus))
    && optionalText(raw.phase, 100)
    && list(raw.goals, value => record(value) && !!text(value.id) && !!text(value.title)
      && optionalText(value.id, 120) && optionalText(value.title, 2000) && optionalText(value.motive, 2000)
      && (value.agreed === undefined || typeof value.agreed === 'boolean') && stringIds(value.taskIds) && stringIds(value.categoryIds), 50)
    && ['facts', 'barriers', 'preferences'].every(key => list(raw[key], entry, 200))
    && list(raw.feedback, value => record(value) && !!text(value.id) && !!text(value.text) && Number.isFinite(value.createdAt), 200)
    && list(raw.actionHistory, value => record(value) && !!text(value.id) && record(value.after) && (value.before === null || record(value.before)))
    && stringIds(raw.processedTurnIds, 100000)
    && (raw.latestStrategy === undefined || record(raw.latestStrategy) && Number.isFinite(raw.latestStrategy.updatedAt))
    && (raw.reminders === undefined || record(raw.reminders) && typeof raw.reminders.enabled === 'boolean'
      && raw.reminders.maxPerDay === 2 && list(raw.reminders.times, value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value), 2))
    && (raw.discovery === undefined || record(raw.discovery) && raw.discovery.version === 1
      && record(raw.discovery.topics) && ['direction', 'motivation', 'circumstances', 'barriers', 'capacity', 'attempts'].every(topic => {
        const value = raw.discovery.topics[topic];
        return record(value) && ['unknown', 'answered', 'deferred'].includes(value.status)
          && Array.isArray(value.evidence) && value.evidence.every((item: any) => record(item) && !!text(item.quote) && !!text(item.messageId));
      }) && ['exploring', 'confirming', 'ready'].includes(raw.discovery.phase)
      && stringIds(raw.discovery.selectedGoalIds) && stringIds(raw.discovery.processedTurnIds, 100000)
      && (raw.discovery.pendingQuestion === undefined || record(raw.discovery.pendingQuestion)
        && !!text(raw.discovery.pendingQuestion.id) && !!text(raw.discovery.pendingQuestion.text)
        && ['direction', 'motivation', 'circumstances', 'barriers', 'capacity', 'attempts'].includes(raw.discovery.pendingQuestion.topic))
      && (raw.discovery.pendingSummary === undefined || record(raw.discovery.pendingSummary)
        && !!text(raw.discovery.pendingSummary.id) && typeof raw.discovery.pendingSummary.text === 'string'
        && typeof raw.discovery.pendingSummary.fingerprint === 'string' && typeof raw.discovery.pendingSummary.confirmed === 'boolean'
        && stringIds(raw.discovery.pendingSummary.goalIds)));
}
function goals(value: unknown): StrategyGoal[] {
  return Array.isArray(value) ? value.filter(record).filter(item => text(item.id) && text(item.title)).slice(0, 50).map(item => ({
    id: text(item.id, 120), title: text(item.title), motive: text(item.motive), agreed: item.agreed === true,
    taskIds: ids(item.taskIds), categoryIds: ids(item.categoryIds),
  })) : [];
}
function entries(value: unknown): StrategyMemoryEntry[] {
  return Array.isArray(value) ? value.filter(record).filter(item => text(item.id) && text(item.text)).slice(0, 200).map(item => ({
    id: text(item.id, 120), text: text(item.text), source: item.source === 'user' ? 'user' : 'hypothesis',
    ...(text(item.messageId) ? { messageId: text(item.messageId, 200) } : {}),
    ...(text(item.quote, 8000) ? { quote: text(item.quote, 8000) } : {}),
  })) : [];
}
export function readPersonalStrategy(storage: StrategyStorage, owner: string | null): PersonalStrategyProfile {
  const key = personalStrategyKey(owner);
  let source: string | null = null;
  try {
    source = storage.getItem(key);
    const raw = JSON.parse(source || 'null');
    if (!record(raw) || raw.version !== 1) {
      if (source !== null) preserveRawStorage(storage, key, source);
      return createPersonalStrategyProfile();
    }
    if (!intactStoredStrategy(raw) && source !== null) preserveRawStorage(storage, key, source);
    const profile = createPersonalStrategyProfile();
    const hydrated: PersonalStrategyProfile = { ...profile, onboardingStatus: ['new', 'in_progress', 'complete'].includes(raw.onboardingStatus) ? raw.onboardingStatus : 'new',
      phase: text(raw.phase, 100) || 'goals', goals: goals(raw.goals), facts: entries(raw.facts), barriers: entries(raw.barriers), preferences: entries(raw.preferences),
      latestStrategy: record(raw.latestStrategy) && typeof raw.latestStrategy.updatedAt === 'number' ? raw.latestStrategy as PersonalStrategyProfile['latestStrategy'] : undefined,
      feedback: Array.isArray(raw.feedback) ? raw.feedback.filter((item: any) => record(item) && text(item.id) && text(item.text) && Number.isFinite(item.createdAt)).slice(-200) : [],
      actionHistory: Array.isArray(raw.actionHistory) ? raw.actionHistory.filter((item: any) => record(item) && text(item.id) && record(item.after) && (item.before === null || record(item.before))) : [],
      processedTurnIds: ids(raw.processedTurnIds, 100000),
      discovery: record(raw.discovery) && raw.discovery.version === 1 ? raw.discovery as PersonalStrategyProfile['discovery'] : undefined,
      reminders: { enabled: raw.reminders?.enabled === true, times: ids(raw.reminders?.times).filter(time => /^([01]\d|2[0-3]):[0-5]\d$/.test(time)).slice(0, 2), maxPerDay: 2 } };
    if (!hydrated.discovery) {
      // Old memory entries can regain their full source from retained chat, without rewriting history.
      let history: { role?: string; id?: string; content?: string }[] = [];
      try {
        const saved = JSON.parse(readAccountStorage(storage, 'karkas_ai_chat_history', owner) || 'null');
        if (Array.isArray(saved)) history = saved.filter(record);
      } catch { /* Missing or malformed history does not affect the profile. */ }
      for (const group of ['facts', 'barriers', 'preferences'] as const) hydrated[group] = hydrated[group].map(entry => {
        if (entry.quote || !entry.messageId || entry.source !== 'user') return entry;
        const index = history.findIndex(message => message.role === 'assistant' && message.id === `reply-${entry.messageId}`);
        const source = index >= 0 ? history.slice(0, index).reverse().find(message => message.role === 'user' && typeof message.content === 'string')?.content : undefined;
        return source && source.toLocaleLowerCase().includes(entry.text.toLocaleLowerCase()) ? {
          ...entry, quote: source.slice(0, 8000), source: matchesUserStatement(entry.text, source) ? 'user' : 'hypothesis',
        } : entry;
      });
    }
    const discovery = normalizeStrategyDiscovery(hydrated);
    return { ...hydrated, discovery, onboardingStatus: discovery.phase === 'ready' ? 'complete' : hydrated.onboardingStatus === 'new' ? 'new' : 'in_progress', phase: discovery.phase };
  } catch {
    if (source !== null) {
      try { preserveRawStorage(storage, key, source); } catch { /* Writes independently retry backup and remain blocked on failure. */ }
    }
    return createPersonalStrategyProfile();
  }
}
function preserveDamagedStrategy(storage: StrategyStorage, owner: string | null): void {
  const key = personalStrategyKey(owner);
  const source = storage.getItem(key);
  if (source === null) return;
  let valid = false;
  try { valid = intactStoredStrategy(JSON.parse(source)); } catch { /* Preserve malformed bytes. */ }
  if (!valid) preserveRawStorage(storage, key, source);
}
export function savePersonalStrategy(storage: StrategyStorage, owner: string | null, profile: PersonalStrategyProfile): boolean {
  try {
    preserveDamagedStrategy(storage, owner);
    const serialized = JSON.stringify(profile);
    storage.setItem(personalStrategyKey(owner), serialized);
    return storage.getItem(personalStrategyKey(owner)) === serialized;
  } catch { return false; }
}
export function clearPersonalStrategy(storage: StrategyStorage, owner: string | null): boolean {
  try { preserveDamagedStrategy(storage, owner); storage.removeItem(personalStrategyKey(owner)); return true; } catch { return false; }
}
/** The ordinary chat greeting: no interview question; the discovery interview starts only from «Поглибити знайомство». */
export function strategyGreeting(lang: 'uk' | 'en'): string {
  return lang === 'uk'
    ? 'Вітаю! Я ШІ-помічник Karkas. Можу створити, змінити чи розбити на кроки завдання, допомогти спланувати роботу або проаналізувати, як вона просувається. Якщо захочете персональніших порад, натисніть «Поглибити знайомство» — я поставлю кілька коротких запитань. З чого почнемо?'
    : 'Hello! I am your Karkas AI assistant. I can create, edit or break down tasks, help plan your work or analyse how it is going. For more personal advice, press “Get to know me better” and I will ask a few short questions. Where shall we start?';
}
const mergeById = <T extends { id: string }>(before: T[], next: T[]) => {
  const merged = new Map(before.map(item => [item.id, item]));
  for (const item of next) merged.set(item.id, item);
  return [...merged.values()];
};
/** AI proposals cannot independently authorize a goal or present a hypothesis as a user statement. */
export function applyStrategyMemory(profile: PersonalStrategyProfile, patch: StrategyMemoryPatch | undefined, userText: string, messageId: string): PersonalStrategyProfile {
  if (!patch || !record(patch)) return profile;
  const nextGoals: StrategyGoal[] = (Array.isArray(patch.goals) ? patch.goals : []).filter(record).filter(raw => text(raw.id)).flatMap(raw => {
    const existing = profile.goals.find(item => item.id === text(raw.id, 120));
    const candidate: StrategyGoal = {
      id: text(raw.id, 120), title: raw.title === undefined ? existing?.title || '' : text(raw.title),
      motive: raw.motive === undefined ? existing?.motive || '' : text(raw.motive),
      taskIds: raw.taskIds === undefined ? existing?.taskIds || [] : ids(raw.taskIds),
      categoryIds: raw.categoryIds === undefined ? existing?.categoryIds || [] : ids(raw.categoryIds), agreed: false,
    };
    if (!candidate.title) return [];
    const sameIds = (left: string[], right: string[]) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
    const scopeChanged = !!existing && (candidate.title !== existing.title || candidate.motive !== existing.motive
      || !sameIds(candidate.categoryIds, existing.categoryIds) || !sameIds(candidate.taskIds, existing.taskIds));
    // A confirmation applies to the goal the person already saw, never a silently rewritten goal.
    candidate.agreed = !!existing && !scopeChanged && existing.agreed;
    return [candidate];
  });
  const grounded = (value: unknown) => entries(value).map(entry => {
    const matchesStatement = matchesUserStatement(entry.text, userText);
    return { ...entry, messageId, quote: userText.trim().slice(0, 8000), source: entry.source === 'user' && matchesStatement ? 'user' as const : 'hypothesis' as const };
  });
  const mergedGoals = mergeById(profile.goals, nextGoals);
  const revisedSelectedGoal = nextGoals.some(goal => {
    const existing = profile.goals.find(item => item.id === goal.id);
    return existing?.agreed && !goal.agreed && profile.discovery?.selectedGoalIds.includes(goal.id);
  });
  const updated = { ...profile, goals: mergedGoals,
    facts: mergeById(profile.facts, grounded(patch.facts)), barriers: mergeById(profile.barriers, grounded(patch.barriers)), preferences: mergeById(profile.preferences, grounded(patch.preferences)),
    ...(revisedSelectedGoal && profile.discovery ? { discovery: { ...profile.discovery, pendingSummary: undefined, pendingQuestion: undefined, phase: 'exploring' as const } } : {}),
  };
  const discovery = normalizeStrategyDiscovery(updated);
  return { ...updated, discovery, onboardingStatus: discovery.phase === 'ready' ? 'complete' : 'in_progress', phase: discovery.phase };
}
export function updateStrategyMemoryEntry(profile: PersonalStrategyProfile, group: 'facts' | 'barriers' | 'preferences', id: string, value: string): PersonalStrategyProfile {
  const previous = profile[group].find(entry => entry.id === id);
  if (!previous || previous.text === value.trim()) return profile;
  const discovery = normalizeStrategyDiscovery(profile);
  let affected = false;
  for (const topic of Object.keys(discovery.topics) as (keyof typeof discovery.topics)[]) {
    const answer = discovery.topics[topic];
    const retained = answer.evidence.filter(entry => !(previous.messageId && entry.messageId === previous.messageId && (!previous.quote || entry.quote === previous.quote)));
    if (retained.length !== answer.evidence.length) {
      discovery.topics[topic] = { status: 'unknown', evidence: retained };
      affected = true;
    }
  }
  if (affected) { discovery.pendingSummary = undefined; discovery.pendingQuestion = undefined; discovery.phase = 'exploring'; }
  const updated = { ...profile, [group]: value.trim() ? profile[group].map(entry => entry.id === id ? {
    ...entry, text: value.trim(), quote: value.trim(), messageId: `memory-edit:${id}`, source: 'user' as const,
  } : entry) : profile[group].filter(entry => entry.id !== id), discovery };
  return affected ? { ...updated, onboardingStatus: 'in_progress', phase: 'exploring' } : updated;
}
export function applyStrategyResponse(profile: PersonalStrategyProfile, response: AIStrategyResponse, userText: string, turnId: string, now = Date.now(), source?: string): PersonalStrategyProfile {
  if (normalizeStrategyDiscovery(profile).processedTurnIds.includes(turnId)) return profile;
  const updated = applyDiscoveryTurn(applyStrategyMemory(profile, response.memoryPatch, userText, turnId), response, userText, turnId);
  // Interview questions and reflections remain in chat; they never replace the saved actionable strategy.
  const actionable = isPersonalStrategyReady(updated) && response.status === 'ready' && !response.question?.trim()
    && !response.memoryPatch?.discovery?.question && (!!response.nextAction?.trim() || !!response.narrative?.trim() || !!response.actions?.length);
  return actionable ? { ...updated, latestStrategy: { ...response, updatedAt: now, source } } : updated;
}
