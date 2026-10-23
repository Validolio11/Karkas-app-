import type { PersonalStrategyProfile } from '../types';
import type { WorkspaceState } from './syncState';
import { canonical } from './canonical';
import { intactStoredStrategy, strategyOwnerKey, type StrategyStorage } from './personalStrategy';
import { parseWorkspace } from './workspaceValidation';
import { applyNotepadBatch, isNotepadBatchOperation, type NoteBatchOperation } from './notepadStorage';

export interface WorkspaceTabTransaction {
  version: 1;
  ownerId: string | null;
  beforeWorkspace: WorkspaceState;
  afterWorkspace: WorkspaceState;
  beforeProfile: PersonalStrategyProfile;
  afterProfile: PersonalStrategyProfile;
  notesOperation?: NoteBatchOperation;
}
export const workspaceTabTransactionKey = (owner: string | null) =>
  `karkas.workspace-tab-transaction.v1:${encodeURIComponent(strategyOwnerKey(owner))}`;

const fullProfile = (profile: unknown): profile is PersonalStrategyProfile => {
  if (!intactStoredStrategy(profile) || !profile || typeof profile !== 'object') return false;
  const value = profile as PersonalStrategyProfile;
  return ['new', 'in_progress', 'complete'].includes(value.onboardingStatus) && typeof value.phase === 'string'
    && ['goals', 'facts', 'barriers', 'preferences', 'feedback', 'actionHistory', 'processedTurnIds'].every(key => Array.isArray((value as unknown as Record<string, unknown>)[key]))
    && !!value.reminders && typeof value.reminders.enabled === 'boolean' && Array.isArray(value.reminders.times);
};
function parseJournal(raw: string, owner: string | null): WorkspaceTabTransaction | null {
  try {
    const value = JSON.parse(raw) as WorkspaceTabTransaction;
    if (!value || value.version !== 1 || value.ownerId !== owner
      || !fullProfile(value.beforeProfile) || !fullProfile(value.afterProfile)
      || value.notesOperation !== undefined && !isNotepadBatchOperation(value.notesOperation)) return null;
    // Recovery must retain the exact staged state, never silently normalize it.
    for (const workspace of [value.beforeWorkspace, value.afterWorkspace]) {
      if (canonical(parseWorkspace(workspace)) !== canonical(workspace)) return null;
    }
    return value;
  } catch { return null; }
}

/** A retained transaction (including malformed/conflicted data) is never overwritten. */
export function stageWorkspaceTabTransaction(storage: StrategyStorage, owner: string | null,
  beforeWorkspace: WorkspaceState, afterWorkspace: WorkspaceState,
  beforeProfile: PersonalStrategyProfile, afterProfile: PersonalStrategyProfile, notesOperation?: NoteBatchOperation): boolean {
  try {
    const key = workspaceTabTransactionKey(owner);
    if (storage.getItem(key) !== null) return false;
    const journal: WorkspaceTabTransaction = { version: 1, ownerId: owner, beforeWorkspace, afterWorkspace, beforeProfile, afterProfile,
      ...(notesOperation ? { notesOperation } : {}) };
    const raw = JSON.stringify(journal);
    if (!parseJournal(raw, owner)) return false;
    storage.setItem(key, raw);
    return storage.getItem(key) === raw;
  } catch { return false; }
}

export interface WorkspaceTabRecovery {
  status: 'none' | 'recovered' | 'conflict' | 'invalid';
  workspace: WorkspaceState;
  profile: PersonalStrategyProfile;
  conflictParts: string[];
}
/** Accept partial commits only when each part remains exactly before or already after. */
export function recoverWorkspaceTabTransaction(storage: StrategyStorage, owner: string | null,
  currentWorkspace: WorkspaceState, currentProfile: PersonalStrategyProfile): WorkspaceTabRecovery {
  const unchanged = (status: WorkspaceTabRecovery['status'], conflictParts: string[] = []): WorkspaceTabRecovery =>
    ({ status, workspace: currentWorkspace, profile: currentProfile, conflictParts });
  try {
    const raw = storage.getItem(workspaceTabTransactionKey(owner));
    if (raw === null) return unchanged('none');
    const journal = parseJournal(raw, owner);
    if (!journal) return unchanged('invalid');
    const matches = (current: unknown, before: unknown, after: unknown) =>
      canonical(current) === canonical(before) || canonical(current) === canonical(after);
    const conflictParts: string[] = [];
    for (const part of ['tasks', 'tabs', 'deletedTasks', 'settings', 'skills', 'measurements', 'practiceSessions'] as const) {
      if (!matches(currentWorkspace[part], journal.beforeWorkspace[part], journal.afterWorkspace[part])) conflictParts.push(part);
    }
    if (!matches(currentProfile, journal.beforeProfile, journal.afterProfile)) conflictParts.push('profile');
    if (conflictParts.length) return unchanged('conflict', conflictParts);
    if (journal.notesOperation && !applyNotepadBatch(storage as StrategyStorage & Pick<Storage, 'key' | 'length'>, owner, journal.notesOperation)) return unchanged('conflict', ['notes']);
    return { status: 'recovered', workspace: structuredClone(journal.afterWorkspace), profile: structuredClone(journal.afterProfile), conflictParts: [] };
  } catch { return unchanged('invalid'); }
}

/** Clear only the exact transaction after its account snapshot has been durably saved. */
export async function completeWorkspaceTabTransaction(storage: StrategyStorage, owner: string | null,
  expectedJournal: string | null, workspaceSaved: Promise<boolean>, isCurrent: () => boolean): Promise<boolean> {
  try {
    const key = workspaceTabTransactionKey(owner);
    if (!await workspaceSaved || expectedJournal === null || !isCurrent()
      || storage.getItem(key) !== expectedJournal) return false;
    const journal = parseJournal(expectedJournal, owner);
    if (!journal || journal.notesOperation && !applyNotepadBatch(storage as StrategyStorage & Pick<Storage, 'key' | 'length'>, owner, journal.notesOperation)) return false;
    storage.removeItem(key);
    return storage.getItem(key) === null;
  } catch { return false; }
}
