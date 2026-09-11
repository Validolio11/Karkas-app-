import type { DeletedTask, PSTask, TaskTab } from '../types';
import type { SyncMutationIdentity, WorkspaceState } from './syncState';

type Lifecycle = 'active' | 'deleted' | 'purged';
type Patch<T> = Partial<Omit<T, 'id'>>;

export interface TaskSyncOperation {
  kind: 'task';
  id: string;
  lifecycle?: Lifecycle;
  patch?: Patch<DeletedTask>;
  unset?: string[];
}

export interface TabSyncOperation {
  kind: 'tab';
  id: string;
  lifecycle?: 'active' | 'deleted';
  patch?: Patch<TaskTab>;
  unset?: string[];
}

export interface SettingsSyncOperation {
  kind: 'settings';
  patch?: Partial<WorkspaceState['settings']>;
  unset?: string[];
}

export type WorkspaceSyncOperation = TaskSyncOperation | TabSyncOperation | SettingsSyncOperation;

export interface WorkspaceMutation extends SyncMutationIdentity {
  createdAt: number;
  operations: WorkspaceSyncOperation[];
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function diffFields<T extends object>(before: T | undefined, after: T): { patch?: Partial<T>; unset?: string[] } {
  const patch: Partial<T> = {};
  const unset: string[] = [];
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after)]);
  for (const key of [...keys].sort()) {
    if (key === 'id') continue;
    const field = key as keyof T;
    if (canonical(before?.[field]) === canonical(after[field])) continue;
    if (after[field] === undefined) unset.push(key);
    else patch[field] = structuredClone(after[field]);
  }
  return {
    ...(Object.keys(patch).length ? { patch } : {}),
    ...(unset.length ? { unset } : {}),
  };
}

function taskRecords(workspace: WorkspaceState): Map<string, { lifecycle: 'active' | 'deleted'; value: DeletedTask }> {
  const result = new Map<string, { lifecycle: 'active' | 'deleted'; value: DeletedTask }>();
  for (const task of workspace.tasks ?? []) {
    result.set(task.id, { lifecycle: 'active', value: task as DeletedTask });
  }
  // A tombstone is authoritative if malformed legacy data contains both copies.
  for (const task of workspace.deletedTasks ?? []) {
    result.set(task.id, { lifecycle: 'deleted', value: task });
  }
  return result;
}

export function diffWorkspaceMutation(
  base: WorkspaceState,
  next: WorkspaceState,
  identity: SyncMutationIdentity,
  createdAt = Date.now(),
): WorkspaceMutation {
  return { ...identity, createdAt, operations: diffWorkspaceOperations(base, next) };
}

export function diffWorkspaceOperations(base: WorkspaceState, next: WorkspaceState): WorkspaceSyncOperation[] {
  const operations: WorkspaceSyncOperation[] = [];
  const beforeTasks = taskRecords(base);
  const afterTasks = taskRecords(next);
  const taskIds = [...new Set([...beforeTasks.keys(), ...afterTasks.keys()])].sort();
  for (const id of taskIds) {
    const before = beforeTasks.get(id);
    const after = afterTasks.get(id);
    if (!after) {
      operations.push({ kind: 'task', id, lifecycle: 'purged' });
      continue;
    }
    const fields = diffFields(before?.value, after.value);
    const lifecycle = before?.lifecycle === after.lifecycle ? undefined : after.lifecycle;
    if (!before || lifecycle || fields.patch || fields.unset) {
      operations.push({ kind: 'task', id, ...(lifecycle ? { lifecycle } : {}), ...fields });
    }
  }

  const beforeTabs = new Map((base.tabs ?? []).map((tab) => [tab.id, tab]));
  const afterTabs = new Map((next.tabs ?? []).map((tab) => [tab.id, tab]));
  const tabIds = [...new Set([...beforeTabs.keys(), ...afterTabs.keys()])].sort();
  for (const id of tabIds) {
    const before = beforeTabs.get(id);
    const after = afterTabs.get(id);
    if (!after) {
      operations.push({ kind: 'tab', id, lifecycle: 'deleted' });
      continue;
    }
    const fields = diffFields(before, after);
    const lifecycle = before ? undefined : 'active' as const;
    if (!before || fields.patch || fields.unset) {
      operations.push({ kind: 'tab', id, ...(lifecycle ? { lifecycle } : {}), ...fields });
    }
  }

  const settings = diffFields(base.settings, next.settings);
  if (settings.patch || settings.unset) operations.push({ kind: 'settings', ...settings });
  return operations;
}

function applyPatch<T extends object>(current: T, patch?: object, unset?: string[]): T {
  const result = { ...current, ...(patch ? structuredClone(patch) : {}) } as T;
  for (const key of unset ?? []) delete (result as Record<string, unknown>)[key];
  return result;
}

export function applyWorkspaceMutation(remote: WorkspaceState, mutation: WorkspaceMutation): WorkspaceState {
  const tasks = taskRecords(structuredClone(remote));
  const tabs = new Map((remote.tabs ?? []).map((tab) => [tab.id, structuredClone(tab)]));
  let settings = structuredClone(remote.settings);

  for (const operation of mutation.operations) {
    if (operation.kind === 'settings') {
      settings = applyPatch(settings, operation.patch, operation.unset);
      continue;
    }
    if (operation.kind === 'tab') {
      if (operation.lifecycle === 'deleted') {
        tabs.delete(operation.id);
        continue;
      }
      const current = tabs.get(operation.id);
      if (!current && operation.lifecycle !== 'active') continue;
      tabs.set(operation.id, applyPatch(current ?? { id: operation.id, name: '' }, operation.patch, operation.unset));
      continue;
    }

    if (operation.lifecycle === 'purged') {
      tasks.delete(operation.id);
      continue;
    }
    const current = tasks.get(operation.id);
    if (!current && !operation.lifecycle) continue;
    const lifecycle = operation.lifecycle ?? current?.lifecycle;
    if (!lifecycle) continue;
    const fallback = { id: operation.id } as DeletedTask;
    const value = applyPatch(current?.value ?? fallback, operation.patch, operation.unset);
    tasks.set(operation.id, { lifecycle, value });
  }

  return {
    tasks: [...tasks.values()].filter((item) => item.lifecycle === 'active').map((item) => item.value as PSTask),
    deletedTasks: [...tasks.values()].filter((item) => item.lifecycle === 'deleted').map((item) => item.value),
    tabs: [...tabs.values()],
    settings,
  };
}
