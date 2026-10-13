import type { AIStrategyResponse, PersonalStrategyProfile, StrategyGoal, StrategyMemoryEntry, StrategyMemoryPatch } from '../types';
import { applyDiscoveryTurn, isPersonalStrategyReady, normalizeStrategyDiscovery } from './strategyDiscovery';
import { readAccountStorage } from './accountStorage';

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
  try {
    const raw = JSON.parse(storage.getItem(personalStrategyKey(owner)) || 'null');
    if (!record(raw) || raw.version !== 1) return createPersonalStrategyProfile();
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
  } catch { return createPersonalStrategyProfile(); }
}
export function savePersonalStrategy(storage: StrategyStorage, owner: string | null, profile: PersonalStrategyProfile): boolean {
  try { storage.setItem(personalStrategyKey(owner), JSON.stringify(profile)); return true; } catch { return false; }
}
export function clearPersonalStrategy(storage: StrategyStorage, owner: string | null): boolean {
  try { storage.removeItem(personalStrategyKey(owner)); return true; } catch { return false; }
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
