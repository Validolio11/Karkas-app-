import type { DeletedTask, PSTask, TaskTab } from '../types';
import { diffWorkspaceOperations, type WorkspaceSyncOperation } from './syncOperations';
import type { WorkspaceState } from './syncState';

export const CLOUD_SHADOW_SCHEMA_VERSION = 2;
export const CLOUD_SHADOW_MAX_WRITES = 450;
const MAX_ENTITY_ID_BYTES = 900;

export interface CloudShadowManifest {
  schemaVersion: typeof CLOUD_SHADOW_SCHEMA_VERSION;
  revision: number;
  tasks: Array<{ id: string; revision: number; lifecycle: 'active' | 'deleted' | 'purged' }>;
  tabs: Array<{ id: string; revision: number; lifecycle: 'active' | 'deleted' }>;
  settingsRevision: number;
  taskCount: number;
  tabCount: number;
}

export interface CloudShadowTaskWrite {
  documentId: string;
  id: string;
  lifecycle: 'active' | 'deleted' | 'purged';
  value?: PSTask | DeletedTask;
}

export interface CloudShadowTabWrite {
  documentId: string;
  id: string;
  lifecycle: 'active' | 'deleted';
  value?: TaskTab;
}

export interface CloudShadowPlan {
  fullReconcile: boolean;
  taskWrites: CloudShadowTaskWrite[];
  tabWrites: CloudShadowTabWrite[];
  settings: WorkspaceState['settings'] | null;
  manifest: CloudShadowManifest;
  writeCount: number;
}

export interface CloudShadowPlanPage {
  taskWrites: CloudShadowTaskWrite[];
  tabWrites: CloudShadowTabWrite[];
  settings: WorkspaceState['settings'] | null;
  nextCursor: number;
  complete: boolean;
}

export interface CloudShadowStoredTask extends CloudShadowTaskWrite { revision: number }
export interface CloudShadowStoredTab extends CloudShadowTabWrite { revision: number }
export interface CloudShadowStoredSettings { revision: number; value: WorkspaceState['settings'] }

export function encodeCloudEntityDocumentId(id: string): string {
  if (typeof id !== 'string' || id.length === 0) throw new Error('Cloud entity id must be a non-empty string');
  // UTF-8 is portable across clients, but unpaired UTF-16 surrogates must be
  // rejected because TextEncoder would replace them and create collisions.
  for (let index = 0; index < id.length; index += 1) {
    const codeUnit = id.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = id.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error('Cloud entity id contains invalid Unicode');
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new Error('Cloud entity id contains invalid Unicode');
    }
  }
  const bytes = new TextEncoder().encode(id);
  if (bytes.byteLength > MAX_ENTITY_ID_BYTES) throw new Error('Cloud entity id is too large');
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `e_${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}`;
}

export function parseCloudShadowManifest(value: unknown): CloudShadowManifest {
  if (!value || typeof value !== 'object') throw new Error('Cloud shadow manifest is invalid');
  const manifest = value as CloudShadowManifest;
  const valid = manifest.schemaVersion === CLOUD_SHADOW_SCHEMA_VERSION &&
    Number.isSafeInteger(manifest.revision) && manifest.revision > 0 &&
    Array.isArray(manifest.tasks) && manifest.tasks.length <= 50000 &&
    Array.isArray(manifest.tabs) && manifest.tabs.length <= 5000 &&
    manifest.taskCount === manifest.tasks.length && manifest.tabCount === manifest.tabs.length &&
    manifest.tasks.every((entry) => entry && typeof entry.id === 'string' &&
      Number.isSafeInteger(entry.revision) && entry.revision > 0 && entry.revision <= manifest.revision &&
      ['active', 'deleted', 'purged'].includes(entry.lifecycle)) &&
    manifest.tabs.every((entry) => entry && typeof entry.id === 'string' &&
      Number.isSafeInteger(entry.revision) && entry.revision > 0 && entry.revision <= manifest.revision &&
      ['active', 'deleted'].includes(entry.lifecycle)) &&
    Number.isSafeInteger(manifest.settingsRevision) && manifest.settingsRevision > 0 &&
    manifest.settingsRevision <= manifest.revision;
  if (!valid) throw new Error('Cloud shadow manifest is invalid');
  const taskIds = new Set(manifest.tasks.map((entry) => entry.id));
  const tabIds = new Set(manifest.tabs.map((entry) => entry.id));
  if (taskIds.size !== manifest.tasks.length || tabIds.size !== manifest.tabs.length) {
    throw new Error('Cloud shadow manifest contains duplicate ids');
  }
  for (const id of [...taskIds, ...tabIds]) encodeCloudEntityDocumentId(id);
  if (new TextEncoder().encode(JSON.stringify(manifest)).byteLength > 900 * 1024) {
    throw new Error('Cloud shadow manifest is too large');
  }
  return manifest;
}

function taskMap(workspace: WorkspaceState): Map<string, { lifecycle: 'active' | 'deleted'; value: PSTask | DeletedTask }> {
  const result = new Map<string, { lifecycle: 'active' | 'deleted'; value: PSTask | DeletedTask }>();
  for (const task of workspace.tasks ?? []) result.set(task.id, { lifecycle: 'active', value: task });
  for (const task of workspace.deletedTasks ?? []) result.set(task.id, { lifecycle: 'deleted', value: task });
  return result;
}

function touchedIds(operations: WorkspaceSyncOperation[], kind: 'task' | 'tab'): Set<string> {
  return new Set(operations.filter((operation): operation is Extract<WorkspaceSyncOperation, { kind: typeof kind }> =>
    operation.kind === kind).map((operation) => operation.id));
}

export function buildCloudShadowPlan(
  previousManifest: CloudShadowManifest | null | undefined,
  before: WorkspaceState & { revision?: number },
  after: WorkspaceState,
  nextRevision: number,
  options: { maxWrites?: number } = {},
): CloudShadowPlan {
  if (!Number.isSafeInteger(nextRevision) || nextRevision < 1) throw new Error('Cloud shadow revision is invalid');
  let validatedManifest: CloudShadowManifest | null = null;
  try { validatedManifest = parseCloudShadowManifest(previousManifest); } catch { /* rebuild malformed shadow */ }
  const validManifest = Boolean(validatedManifest);
  const previousTaskVersions = new Map(validatedManifest?.tasks.map((entry) => [entry.id, entry]) ?? []);
  const previousTabVersions = new Map(validatedManifest?.tabs.map((entry) => [entry.id, entry]) ?? []);
  const previousTaskIds = new Set(previousTaskVersions.keys());
  const previousTabIds = new Set(previousTabVersions.keys());
  const nextTasks = taskMap(after);
  const nextTabs = new Map((after.tabs ?? []).map((tab) => [tab.id, tab]));
  const fullReconcile = !validManifest ||
    validatedManifest!.revision !== (before.revision ?? 0);
  const operations = fullReconcile ? [] : diffWorkspaceOperations(before, after);
  const suppressedTaskIds = new Set<string>();
  const suppressedTabIds = new Set<string>();
  if (fullReconcile) {
    for (const [id, current] of nextTasks) {
      const previous = previousTaskVersions.get(id);
      if (previous?.lifecycle === 'purged' || (current.lifecycle === 'active' && previous?.lifecycle === 'deleted')) {
        suppressedTaskIds.add(id);
      }
    }
    for (const id of nextTabs.keys()) {
      if (previousTabVersions.get(id)?.lifecycle === 'deleted') suppressedTabIds.add(id);
    }
  }
  const taskIdsToWrite = fullReconcile
    ? new Set([...previousTaskIds, ...nextTasks.keys()])
    : touchedIds(operations, 'task');
  const tabIdsToWrite = fullReconcile
    ? new Set([...previousTabIds, ...nextTabs.keys()])
    : touchedIds(operations, 'tab');
  for (const id of suppressedTaskIds) taskIdsToWrite.delete(id);
  for (const id of suppressedTabIds) tabIdsToWrite.delete(id);

  const taskWrites = [...taskIdsToWrite].sort().map((id): CloudShadowTaskWrite => {
    const current = nextTasks.get(id);
    return current
      ? { documentId: encodeCloudEntityDocumentId(id), id, lifecycle: current.lifecycle, value: structuredClone(current.value) }
      : { documentId: encodeCloudEntityDocumentId(id), id, lifecycle: 'purged' };
  });
  const tabWrites = [...tabIdsToWrite].sort().map((id): CloudShadowTabWrite => {
    const current = nextTabs.get(id);
    return current
      ? { documentId: encodeCloudEntityDocumentId(id), id, lifecycle: 'active', value: structuredClone(current) }
      : { documentId: encodeCloudEntityDocumentId(id), id, lifecycle: 'deleted' };
  });
  const settingsChanged = fullReconcile || operations.some((operation) => operation.kind === 'settings');
  const taskWritesById = new Map(taskWrites.map((write) => [write.id, write]));
  const tabWritesById = new Map(tabWrites.map((write) => [write.id, write]));
  const manifest: CloudShadowManifest = {
    schemaVersion: CLOUD_SHADOW_SCHEMA_VERSION,
    revision: nextRevision,
    tasks: [...new Set([...previousTaskIds, ...nextTasks.keys()])].sort().map((id) => ({
      id,
      revision: taskIdsToWrite.has(id) ? nextRevision : previousTaskVersions.get(id)!.revision,
      lifecycle: taskWritesById.get(id)?.lifecycle ?? previousTaskVersions.get(id)!.lifecycle,
    })),
    tabs: [...new Set([...previousTabIds, ...nextTabs.keys()])].sort().map((id) => ({
      id,
      revision: tabIdsToWrite.has(id) ? nextRevision : previousTabVersions.get(id)!.revision,
      lifecycle: tabWritesById.get(id)?.lifecycle ?? previousTabVersions.get(id)!.lifecycle,
    })),
    settingsRevision: settingsChanged ? nextRevision : validatedManifest!.settingsRevision,
    taskCount: new Set([...previousTaskIds, ...nextTasks.keys()]).size,
    tabCount: new Set([...previousTabIds, ...nextTabs.keys()]).size,
  };
  for (const entry of [...manifest.tasks, ...manifest.tabs]) encodeCloudEntityDocumentId(entry.id);
  if (new TextEncoder().encode(JSON.stringify(manifest)).byteLength > 900 * 1024) {
    throw new Error('Cloud shadow manifest is too large');
  }
  // Entity/settings writes plus manifest, root and the optional client watermark.
  const writeCount = taskWrites.length + tabWrites.length + (settingsChanged ? 1 : 0) + 3;
  const maxWrites = options.maxWrites ?? CLOUD_SHADOW_MAX_WRITES;
  if (writeCount > maxWrites) {
    const error = new Error(`Cloud shadow migration requires ${writeCount} writes; maximum is ${maxWrites}.`);
    error.name = 'CloudShadowWriteLimitError';
    throw error;
  }
  return {
    fullReconcile,
    taskWrites,
    tabWrites,
    settings: settingsChanged ? structuredClone(after.settings) : null,
    manifest,
    writeCount,
  };
}

export function pageCloudShadowPlan(plan: CloudShadowPlan, cursor: number, pageSize = 400): CloudShadowPlanPage {
  if (!Number.isSafeInteger(cursor) || cursor < 0 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 450) {
    throw new Error('Cloud shadow migration cursor or page size is invalid');
  }
  const entries: Array<{ kind: 'task'; value: CloudShadowTaskWrite } | { kind: 'tab'; value: CloudShadowTabWrite } | { kind: 'settings'; value: WorkspaceState['settings'] }> = [
    ...plan.taskWrites.map((value) => ({ kind: 'task' as const, value })),
    ...plan.tabWrites.map((value) => ({ kind: 'tab' as const, value })),
    ...(plan.settings ? [{ kind: 'settings' as const, value: plan.settings }] : []),
  ];
  if (cursor > entries.length) throw new Error('Cloud shadow migration cursor exceeds the plan');
  const page = entries.slice(cursor, cursor + pageSize);
  const nextCursor = cursor + page.length;
  return {
    taskWrites: page.filter((entry): entry is { kind: 'task'; value: CloudShadowTaskWrite } => entry.kind === 'task').map((entry) => entry.value),
    tabWrites: page.filter((entry): entry is { kind: 'tab'; value: CloudShadowTabWrite } => entry.kind === 'tab').map((entry) => entry.value),
    settings: page.find((entry): entry is { kind: 'settings'; value: WorkspaceState['settings'] } => entry.kind === 'settings')?.value ?? null,
    nextCursor,
    complete: nextCursor >= entries.length,
  };
}

export function materializeCloudShadow(
  manifest: CloudShadowManifest,
  taskDocuments: CloudShadowStoredTask[],
  tabDocuments: CloudShadowStoredTab[],
  settingsDocument: CloudShadowStoredSettings,
): WorkspaceState {
  const validatedManifest = parseCloudShadowManifest(manifest);
  manifest = validatedManifest;
  if (!settingsDocument || settingsDocument.revision !== manifest.settingsRevision || !settingsDocument.value) {
    throw new Error('Cloud shadow settings revision does not match its manifest');
  }
  const tasksById = new Map(taskDocuments.map((item) => [item.id, item]));
  const tabsById = new Map(tabDocuments.map((item) => [item.id, item]));
  const tasks: PSTask[] = [];
  const deletedTasks: DeletedTask[] = [];
  const tabs: TaskTab[] = [];

  for (const expected of manifest.tasks) {
    const { id } = expected;
    const item = tasksById.get(id);
    if (!item || item.documentId !== encodeCloudEntityDocumentId(id) || item.revision !== expected.revision) {
      throw new Error(`Cloud shadow task ${id} is missing or stale`);
    }
    if (item.lifecycle !== expected.lifecycle) throw new Error(`Cloud shadow task ${id} lifecycle does not match its manifest`);
    if (item.lifecycle === 'purged') continue;
    if (!item.value || item.value.id !== id) throw new Error(`Cloud shadow task ${id} has invalid data`);
    if (item.lifecycle === 'deleted') deletedTasks.push(item.value as DeletedTask);
    else tasks.push(item.value as PSTask);
  }
  for (const expected of manifest.tabs) {
    const { id } = expected;
    const item = tabsById.get(id);
    if (!item || item.documentId !== encodeCloudEntityDocumentId(id) || item.revision !== expected.revision) {
      throw new Error(`Cloud shadow tab ${id} is missing or stale`);
    }
    if (item.lifecycle !== expected.lifecycle) throw new Error(`Cloud shadow tab ${id} lifecycle does not match its manifest`);
    if (item.lifecycle === 'deleted') continue;
    if (!item.value || item.value.id !== id) throw new Error(`Cloud shadow tab ${id} has invalid data`);
    tabs.push(item.value);
  }
  if (settingsDocument.revision !== manifest.settingsRevision) {
    throw new Error('Cloud shadow settings version does not match its manifest');
  }
  return { tasks, tabs, deletedTasks, settings: structuredClone(settingsDocument.value) };
}
