import { parseWorkspace } from './workspaceValidation';
import { preserveRawStorage } from './recoverableLocalStorage';
import type { WorkspaceState } from './syncState';

type Store = Pick<Storage, 'getItem' | 'setItem'>;
export function readLocalWorkspace(storage: Store, keys: { tasks: string; tabs: string; deletedTasks: string }, settings: WorkspaceState['settings']) {
  const empty: WorkspaceState = { tasks: [], tabs: [], deletedTasks: [], settings };
  const raw = new Map<string, string>();
  try {
    const value = { ...empty };
    const fields = new Map<'tasks' | 'tabs' | 'deletedTasks', string>();
    for (const field of ['tasks', 'tabs', 'deletedTasks'] as const) {
      let key = keys[field];
      let text = storage.getItem(key);
      if (field === 'tasks' && text === null) { key = 'ps_todo_tasks_v1'; text = storage.getItem(key); }
      if (text !== null) { raw.set(key, text); fields.set(field, text); }
    }
    for (const [field, text] of fields) value[field] = JSON.parse(text);
    return { workspace: parseWorkspace(value), canPersist: true, recovered: false };
  } catch {
    try {
      for (const [key, text] of raw) preserveRawStorage(storage, key, text);
      return { workspace: empty, canPersist: true, recovered: true };
    } catch {
      return { workspace: empty, canPersist: false, recovered: true };
    }
  }
}

export function parseAccountRecord(raw: string, storage: Store, key: string) {
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid account record');
    if (value.workspace) parseWorkspace(value.workspace);
    else throw new Error('Missing account workspace');
    if (value.base) parseWorkspace(value.base);
    if (value.lastSyncTime !== undefined && value.lastSyncTime !== null
      && (typeof value.lastSyncTime !== 'number' || !Number.isFinite(value.lastSyncTime) || value.lastSyncTime < 0)) throw new Error('Invalid sync timestamp');
    for (const pending of [value.pendingSync, value.inFlightSync]) {
      if (pending === undefined || pending === null) continue;
      if (typeof pending !== 'object' || Array.isArray(pending)
        || pending.lastError !== undefined && pending.lastError !== null && typeof pending.lastError !== 'string'
        || pending.nextAttemptAt !== undefined && pending.nextAttemptAt !== null
          && (typeof pending.nextAttemptAt !== 'number' || !Number.isFinite(pending.nextAttemptAt) || pending.nextAttemptAt < 0)) throw new Error('Invalid pending sync metadata');
      if (pending.workspace) parseWorkspace(pending.workspace);
      if (pending.base) parseWorkspace(pending.base);
    }
    return value;
  } catch (error) {
    preserveRawStorage(storage, key, raw);
    throw error;
  }
}
