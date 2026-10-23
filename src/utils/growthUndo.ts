import type { GrowthSkill, PracticeSession, SkillMeasurement } from '../types';
import type { WorkspaceState } from './syncState';
import { canonical } from './canonical';

export type GrowthUndoTarget = { collection: 'skills' | 'measurements' | 'practiceSessions'; id: string };
type Entity = GrowthSkill | SkillMeasurement | PracticeSession;
export type GrowthUndoChange = GrowthUndoTarget & { before: Entity | null; after: Entity | null };
export type GrowthUndoJournal = { expiresAt: number; changes: GrowthUndoChange[]; scopeKey: string };

/** Check owner, target, expiry and every affected record before restoring a snapshot. */
export function canUndoGrowthJournal(journal: GrowthUndoJournal | null, scopeKey: string, workspace: WorkspaceState, now: number, target?: GrowthUndoTarget): boolean {
  if (!journal || journal.scopeKey !== scopeKey || journal.expiresAt < now
    || target && !journal.changes.some(change => change.collection === target.collection && change.id === target.id)) return false;
  return journal.changes.every(change => canonical((workspace[change.collection] ?? []).find(value => value.id === change.id) ?? null) === canonical(change.after));
}
