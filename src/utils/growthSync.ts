import type { GrowthSkill, SkillMeasurement, PracticeSession } from '../types';
import { validGrowthEntity } from '../../electron/workspace-validation.mjs';
import { canonical } from './canonical';
import type { WorkspaceState } from './syncState';

export const GROWTH_COLLECTIONS = ['skills', 'measurements', 'practiceSessions'] as const;
export const GROWTH_KINDS = { skills: 'skill', measurements: 'measurement', practiceSessions: 'practiceSession' } as const;
export type GrowthCollection = typeof GROWTH_COLLECTIONS[number];
export type GrowthEntity = GrowthSkill | SkillMeasurement | PracticeSession;
export interface GrowthSyncOperation {
  kind: 'skill' | 'measurement' | 'practiceSession';
  id: string;
  lifecycle?: 'active' | 'deleted' | 'purged';
  patch?: Record<string, unknown>;
  unset?: string[];
}
export const isGrowthOperation = (operation: { kind: string }): operation is GrowthSyncOperation =>
  Object.values(GROWTH_KINDS).includes(operation.kind as GrowthSyncOperation['kind']);

export function diffGrowthWorkspaceOperations(base: WorkspaceState, next: WorkspaceState): GrowthSyncOperation[] {
  const operations: GrowthSyncOperation[] = [];
  for (const collection of GROWTH_COLLECTIONS) {
    // A legacy client/snapshot lacking this field has made no Growth edits.
    if (next[collection] === undefined) continue;
    const before = new Map<string, GrowthEntity>((base[collection] ?? []).map((value: GrowthEntity) => [value.id, value] as const));
    const after = new Map<string, GrowthEntity>((next[collection] ?? []).map((value: GrowthEntity) => [value.id, value] as const));
    for (const id of [...new Set([...before.keys(), ...after.keys()])].sort()) {
      const oldValue = before.get(id);
      const value = after.get(id);
      if (!value) {
        if (oldValue) operations.push({ kind: GROWTH_KINDS[collection], id, lifecycle: 'purged' });
        continue;
      }
      // Tombstones survive imports and stale offline updates.
      if (oldValue?.deletedAt !== undefined && value.deletedAt === undefined &&
          (value.updatedAt ?? 0) <= Math.max(oldValue.updatedAt ?? 0, oldValue.deletedAt)) continue;
      const patch: Record<string, unknown> = {};
      const unset: string[] = [];
      for (const key of [...new Set([...Object.keys(oldValue ?? {}), ...Object.keys(value)])].sort()) {
        if (key === 'id') continue;
        const oldField = (oldValue as unknown as Record<string, unknown> | undefined)?.[key];
        const field = (value as unknown as Record<string, unknown>)[key];
        if (canonical(oldField) === canonical(field)) continue;
        if (field === undefined) unset.push(key);
        else patch[key] = structuredClone(field);
      }
      const lifecycle = value.deletedAt === undefined ? 'active' : 'deleted';
      const changedLifecycle = !oldValue || (oldValue.deletedAt === undefined ? 'active' : 'deleted') !== lifecycle;
      if (changedLifecycle || Object.keys(patch).length || unset.length) operations.push({
        kind: GROWTH_KINDS[collection], id, ...(changedLifecycle ? { lifecycle } : {}),
        ...(Object.keys(patch).length ? { patch } : {}), ...(unset.length ? { unset } : {}),
      });
    }
  }
  return operations;
}

export function applyGrowthWorkspaceOperations(remote: WorkspaceState, operations: GrowthSyncOperation[], at: number): Pick<WorkspaceState, GrowthCollection> {
  const result: Pick<WorkspaceState, GrowthCollection> = {};
  for (const collection of GROWTH_COLLECTIONS) {
    const records = new Map<string, GrowthEntity>((remote[collection] ?? []).map((value: GrowthEntity) => [value.id, structuredClone(value)] as const));
    for (const operation of operations) {
      if (operation.kind !== GROWTH_KINDS[collection]) continue;
      if (operation.lifecycle === 'purged') { records.delete(operation.id); continue; }
      const current = records.get(operation.id);
      const restoring = current?.deletedAt !== undefined && operation.lifecycle === 'active' && operation.unset?.includes('deletedAt')
        && typeof operation.patch?.updatedAt === 'number' && operation.patch.updatedAt > Math.max(current.updatedAt ?? 0, current.deletedAt);
      if (current?.deletedAt !== undefined && !restoring) continue;
      if (current && typeof operation.patch?.updatedAt === 'number' && operation.patch.updatedAt < (current.updatedAt ?? 0)) continue;
      // A deterministic goal migration from an offline device cannot overwrite a previously imported skill.
      if (operation.kind === 'skill' && operation.lifecycle === 'active' && operation.patch?.needsSetup === true &&
          current && 'sourceGoalId' in current && current.sourceGoalId) continue;
      if (!current && operation.lifecycle !== 'active' && operation.lifecycle !== 'deleted') continue;
      // Delete payloads retain a fallback for out-of-order creation, never overwrite newer remote fields.
      const patch = current && operation.lifecycle === 'deleted'
        ? { deletedAt: operation.patch?.deletedAt ?? at, updatedAt: operation.patch?.updatedAt ?? at } : operation.patch ?? {};
      const value = { ...(current ?? { id: operation.id }), ...structuredClone(patch) } as unknown as Record<string, unknown>;
      for (const key of current && operation.lifecycle === 'deleted' ? [] : operation.unset ?? []) {
        if (key !== 'id' && (key !== 'deletedAt' || restoring)) delete value[key];
      }
      if (operation.lifecycle === 'deleted') value.deletedAt ??= at;
      if (current && typeof value.updatedAt === 'number') value.updatedAt = Math.max('updatedAt' in current ? current.updatedAt ?? 0 : 0, value.updatedAt);
      // A partial offline edit cannot recreate a missing entity.
      if (validGrowthEntity(operation.kind, value)) records.set(operation.id, value as unknown as GrowthEntity);
    }
    if (remote[collection] !== undefined || records.size || operations.some(operation => operation.kind === GROWTH_KINDS[collection])) {
      Object.assign(result, { [collection]: [...records.values()] });
    }
  }
  return result;
}
