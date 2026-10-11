import type { PersonalStrategyProfile, PSTask } from '../types';
import { strategyOwnerKey, type StrategyStorage } from './personalStrategy';

export interface StrategyTransaction {
  version: 1;
  ownerId: string | null;
  beforeTasks: PSTask[];
  afterTasks: PSTask[];
  profile: PersonalStrategyProfile;
  status: 'pending' | 'conflict';
  conflictTaskIds?: string[];
}

export interface StrategyTransactionRecovery {
  status: 'none' | 'recovered' | 'conflict' | 'invalid';
  tasks: PSTask[];
  /** Apply the profile only when the entire affected task set can be recovered. */
  profile: PersonalStrategyProfile | null;
  conflictTaskIds: string[];
}

export const strategyTransactionKey = (owner: string | null) =>
  `karkas.strategy-transaction.v1:${encodeURIComponent(strategyOwnerKey(owner))}`;

const record = (value: unknown): value is Record<string, any> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function validTasks(value: unknown): value is PSTask[] {
  if (!Array.isArray(value)) return false;
  const seen = new Set<string>();
  return value.every(task => {
    if (!record(task) || typeof task.id !== 'string' || !task.id.trim() || seen.has(task.id)
      || typeof task.title !== 'string' || !task.title.trim() || typeof task.phase !== 'string' || !task.phase.trim()
      || ![1, 2, 3].includes(task.priority) || !Number.isSafeInteger(task.steps) || task.steps < 0
      || !Number.isSafeInteger(task.currentStep) || task.currentStep < 0 || task.currentStep > task.steps
      || typeof task.done !== 'boolean' || typeof task.pinned !== 'boolean'
      || !Number.isFinite(task.createdAt) || task.createdAt < 0) return false;
    seen.add(task.id);
    return true;
  });
}

function validProfile(value: unknown): value is PersonalStrategyProfile {
  return record(value) && value.version === 1 && ['new', 'in_progress', 'complete'].includes(value.onboardingStatus)
    && typeof value.phase === 'string'
    && ['goals', 'facts', 'barriers', 'preferences', 'feedback', 'actionHistory', 'processedTurnIds'].every(key => Array.isArray(value[key]))
    && record(value.reminders) && typeof value.reminders.enabled === 'boolean'
    && Array.isArray(value.reminders.times) && value.reminders.maxPerDay === 2;
}

function parseTransaction(raw: string, owner: string | null): StrategyTransaction | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!record(parsed) || parsed.version !== 1 || parsed.ownerId !== owner
      || !validTasks(parsed.beforeTasks) || !validTasks(parsed.afterTasks) || !validProfile(parsed.profile)
      || !['pending', 'conflict'].includes(parsed.status)
      || (parsed.conflictTaskIds !== undefined && (!Array.isArray(parsed.conflictTaskIds)
        || parsed.conflictTaskIds.some((id: unknown) => typeof id !== 'string')))) return null;
    return parsed as StrategyTransaction;
  } catch { return null; }
}

/** Write ahead of both workspace and profile. Never replace an unresolved journal. */
export function stageStrategyTransaction(
  storage: StrategyStorage,
  owner: string | null,
  beforeTasks: PSTask[],
  afterTasks: PSTask[],
  profile: PersonalStrategyProfile,
): boolean {
  try {
    if (storage.getItem(strategyTransactionKey(owner)) !== null
      || !validTasks(beforeTasks) || !validTasks(afterTasks) || !validProfile(profile)) return false;
    const journal: StrategyTransaction = { version: 1, ownerId: owner, beforeTasks, afterTasks, profile, status: 'pending' };
    const raw = JSON.stringify(journal);
    // Verify the persisted shape before permitting the caller to mutate anything.
    if (!parseTransaction(raw, owner)) return false;
    storage.setItem(strategyTransactionKey(owner), raw);
    return true;
  } catch { return false; }
}

export function readStrategyTransaction(storage: StrategyStorage, owner: string | null): StrategyTransaction | null {
  try {
    const raw = storage.getItem(strategyTransactionKey(owner));
    return raw === null ? null : parseTransaction(raw, owner);
  } catch { return null; }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (record(value)) return `{${Object.keys(value).sort().filter(key => value[key] !== undefined)
    .map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'undefined';
}
const sameTask = (a: PSTask | undefined, b: PSTask | undefined) => canonical(a) === canonical(b);

/**
 * Pure recovery: replay only affected IDs that are still before or already after.
 * A conflict prevents the whole paired commit; newer progress and unrelated tasks
 * remain untouched. The caller persists both results before clearing the journal.
 */
export function recoverStrategyTransaction(
  storage: StrategyStorage,
  owner: string | null,
  currentTasks: PSTask[],
): StrategyTransactionRecovery {
  const result = (status: StrategyTransactionRecovery['status'], conflictTaskIds: string[] = []): StrategyTransactionRecovery =>
    ({ status, tasks: currentTasks, profile: null, conflictTaskIds });
  let raw: string | null;
  try { raw = storage.getItem(strategyTransactionKey(owner)); }
  catch { return result('invalid'); }
  if (raw === null) return result('none');
  const journal = parseTransaction(raw, owner);
  if (!journal || !validTasks(currentTasks)) return result('invalid');
  const before = new Map(journal.beforeTasks.map(task => [task.id, task]));
  const after = new Map(journal.afterTasks.map(task => [task.id, task]));
  const current = new Map(currentTasks.map(task => [task.id, task]));
  const affected = [...new Set([...before.keys(), ...after.keys()])]
    .filter(id => !sameTask(before.get(id), after.get(id)));
  const conflicts = affected.filter(id => !sameTask(current.get(id), before.get(id)) && !sameTask(current.get(id), after.get(id)));
  if (conflicts.length) return result('conflict', conflicts);

  const changed = new Set(affected);
  const recovered = currentTasks.filter(task => !changed.has(task.id) || after.has(task.id))
    .map(task => changed.has(task.id) ? structuredClone(after.get(task.id)!) : task);
  const created = journal.afterTasks.filter(task => changed.has(task.id) && !current.has(task.id))
    .map(task => structuredClone(task));
  return { status: 'recovered', tasks: [...created, ...recovered], profile: structuredClone(journal.profile), conflictTaskIds: [] };
}

/** Retain evidence after a conflict; clearing is reserved for a resolved commit. */
export function markStrategyTransactionConflict(storage: StrategyStorage, owner: string | null, ids: string[]): boolean {
  try {
    const journal = readStrategyTransaction(storage, owner);
    if (!journal) return false;
    storage.setItem(strategyTransactionKey(owner), JSON.stringify({ ...journal, status: 'conflict', conflictTaskIds: [...new Set(ids)] }));
    return true;
  } catch { return false; }
}

export function clearStrategyTransaction(storage: StrategyStorage, owner: string | null): boolean {
  try { storage.removeItem(strategyTransactionKey(owner)); return true; } catch { return false; }
}

/** Clear only the exact journal whose paired local writes and durable workspace save completed. */
export async function completeStrategyTransaction(
  storage: StrategyStorage,
  owner: string | null,
  expectedJournal: string | null,
  workspaceSaved: Promise<boolean>,
  isCurrent: () => boolean,
): Promise<boolean> {
  try {
    if (!await workspaceSaved || expectedJournal === null || !isCurrent()
      || storage.getItem(strategyTransactionKey(owner)) !== expectedJournal) return false;
    return clearStrategyTransaction(storage, owner);
  } catch { return false; }
}
