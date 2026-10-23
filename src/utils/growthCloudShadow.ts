import type { WorkspaceState } from './syncState';
import { encodeCloudEntityDocumentId } from './cloudEntityId';
import { GROWTH_COLLECTIONS, GROWTH_KINDS, diffGrowthWorkspaceOperations, type GrowthCollection, type GrowthEntity } from './growthSync';
import { validGrowthEntity } from '../../electron/workspace-validation.mjs';

interface GrowthShadowEntry { id: string; revision: number; lifecycle: 'active' | 'deleted' | 'purged' }
export type GrowthShadowManifest = Partial<Record<GrowthCollection, GrowthShadowEntry[]>>;
export interface GrowthShadowWrite {
  documentId: string;
  id: string;
  lifecycle: 'active' | 'deleted' | 'purged';
  value?: GrowthEntity;
}
export type GrowthShadowWrites = Record<GrowthCollection, GrowthShadowWrite[]>;
export type GrowthShadowStoredDocuments = Record<GrowthCollection, (GrowthShadowWrite & { revision: number })[]>;
export const emptyGrowthShadowWrites = (): GrowthShadowStoredDocuments => ({ skills: [], measurements: [], practiceSessions: [] });

export function validateGrowthCloudManifest(manifest: GrowthShadowManifest, revision: number): void {
  for (const collection of GROWTH_COLLECTIONS) {
    const entries = manifest[collection];
    if (entries === undefined) continue;
    if (!Array.isArray(entries) || entries.length > 50000 || entries.some(entry => !entry || typeof entry.id !== 'string' ||
      !Number.isSafeInteger(entry.revision) || entry.revision < 1 || entry.revision > revision ||
      !['active', 'deleted', 'purged'].includes(entry.lifecycle)) || new Set(entries.map(entry => entry.id)).size !== entries.length) {
      throw new Error('Cloud shadow Growth inventory is invalid');
    }
    for (const entry of entries) encodeCloudEntityDocumentId(entry.id);
  }
}

export function buildGrowthCloudShadow(
  previous: GrowthShadowManifest | null, before: WorkspaceState, after: WorkspaceState, revision: number, fullReconcile: boolean,
): { writes: GrowthShadowWrites; inventory: GrowthShadowManifest; writeCount: number } {
  const writes: GrowthShadowWrites = emptyGrowthShadowWrites();
  const inventory: GrowthShadowManifest = {};
  const operations = diffGrowthWorkspaceOperations(before, after);
  for (const collection of GROWTH_COLLECTIONS) {
    const previousEntries = new Map((previous?.[collection] ?? []).map(entry => [entry.id, entry]));
    if (after[collection] === undefined) {
      if (previous?.[collection] !== undefined) inventory[collection] = structuredClone(previous[collection]);
      continue;
    }
    const nextRecords = new Map<string, GrowthEntity>((after[collection] ?? []).map((value: GrowthEntity) => [value.id, value] as const));
    const oldRecords = new Map<string, GrowthEntity>((before[collection] ?? []).map((value: GrowthEntity) => [value.id, value] as const));
    // Old clients can overwrite the manifest without Growth inventory. Rebuild it from the root mirror.
    const reconcile = fullReconcile || previous?.[collection] === undefined;
    const touched = reconcile ? new Set([...previousEntries.keys(), ...oldRecords.keys(), ...nextRecords.keys()]) :
      new Set(operations.filter(operation => operation.kind === GROWTH_KINDS[collection]).map(operation => operation.id));
    for (const id of [...touched].sort()) {
      const current = nextRecords.get(id);
      const previousEntry = previousEntries.get(id);
      // A permanent receipt is authoritative even when an offline peer sends a complete old record.
      if (previousEntry?.lifecycle === 'purged') continue;
      const old = oldRecords.get(id);
      if (previousEntry?.lifecycle === 'deleted' && current && current.deletedAt === undefined &&
          (!old?.deletedAt || (current?.updatedAt ?? 0) <= Math.max(old.updatedAt ?? 0, old.deletedAt))) continue;
      const value = current;
      const lifecycle = !current ? 'purged' : current.deletedAt !== undefined ? 'deleted' : 'active';
      writes[collection].push({ documentId: encodeCloudEntityDocumentId(id), id, lifecycle,
        ...(value ? { value: structuredClone(value) } : {}) });
      previousEntries.set(id, { id, revision, lifecycle });
    }
    inventory[collection] = [...previousEntries.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
  return { writes, inventory, writeCount: GROWTH_COLLECTIONS.reduce((count, collection) => count + writes[collection].length, 0) };
}

export function materializeGrowthCloudShadow(manifest: GrowthShadowManifest, documents: GrowthShadowStoredDocuments): Pick<WorkspaceState, GrowthCollection> {
  const workspace: Pick<WorkspaceState, GrowthCollection> = {};
  for (const collection of GROWTH_COLLECTIONS) {
    const entries = manifest[collection];
    if (entries === undefined) continue;
    const byId = new Map(documents[collection].map(item => [item.id, item]));
    const records: GrowthEntity[] = [];
    for (const expected of entries) {
      const item = byId.get(expected.id);
      if (!item || item.documentId !== encodeCloudEntityDocumentId(expected.id) || item.revision !== expected.revision || item.lifecycle !== expected.lifecycle) {
        throw new Error('Cloud shadow Growth record is missing or stale');
      }
      if (item.lifecycle === 'purged') continue;
      if (!item.value && item.lifecycle === 'deleted') continue;
      if (!item.value || item.value.id !== expected.id || !validGrowthEntity(GROWTH_KINDS[collection], item.value) ||
          (item.value.deletedAt !== undefined) !== (item.lifecycle === 'deleted')) throw new Error('Cloud shadow Growth record has invalid data');
      records.push(structuredClone(item.value));
    }
    Object.assign(workspace, { [collection]: records });
  }
  return workspace;
}

/** Also sanitize the legacy root mirror when applying offline operations, not only shadow documents. */
export function suppressPurgedGrowth(workspace: WorkspaceState, manifest: GrowthShadowManifest | null): WorkspaceState {
  const next = { ...workspace };
  const purgedSkills = new Set((manifest?.skills ?? []).filter(value => value.lifecycle === 'purged').map(value => value.id));
  const purgedSessions = new Set((manifest?.practiceSessions ?? []).filter(value => value.lifecycle === 'purged').map(value => value.id));
  const purgedMeasurements = new Set((manifest?.measurements ?? []).filter(value => value.lifecycle === 'purged').map(value => value.id));
  for (const collection of GROWTH_COLLECTIONS) {
    const purged = new Set((manifest?.[collection] ?? []).filter(value => value.lifecycle === 'purged').map(value => value.id));
    if (workspace[collection] !== undefined) Object.assign(next, { [collection]: workspace[collection]!.filter(value => !purged.has(value.id) && !('skillId' in value && purgedSkills.has(value.skillId)) && !('sessionId' in value && value.sessionId && purgedSessions.has(value.sessionId))) });
  }
  if (next.practiceSessions && purgedMeasurements.size) next.practiceSessions = next.practiceSessions.map(value => value.measurementId && purgedMeasurements.has(value.measurementId) ? { ...value, measurementId: undefined } : value);
  if (purgedSkills.size) {
    const unlink = <T extends { skillId?: string; subskillId?: string; measurementMode?: boolean }>(value: T): T => value.skillId && purgedSkills.has(value.skillId) ? { ...value, skillId: undefined, subskillId: undefined, measurementMode: undefined } : value;
    next.tasks = next.tasks.map(unlink); next.deletedTasks = next.deletedTasks.map(unlink);
  }
  return next;
}
