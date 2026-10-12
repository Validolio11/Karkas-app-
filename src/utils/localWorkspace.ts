import { parseWorkspace } from './workspaceValidation';
import { preserveRawStorage } from './recoverableLocalStorage';
import type { WorkspaceState } from './syncState';

type Store = Pick<Storage, 'getItem' | 'setItem'> & Partial<Pick<Storage, 'key' | 'length'>>;
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
    const workspace = parseWorkspace(value);
    if (workspace !== value) for (const [key, text] of raw) preserveRawStorage(storage, key, text);
    return { workspace, canPersist: true, recovered: false, backupPreserved: true };
  } catch (error) {
    console.warn('Local workspace validation failed:', error instanceof Error ? error.message : 'Invalid workspace');
    try {
      for (const [key, text] of raw) preserveRawStorage(storage, key, text);
      // A retained backup does not make an empty replacement authoritative.
      // Keep every workspace write blocked until the original data is recovered.
      return { workspace: empty, canPersist: false, recovered: true, backupPreserved: true };
    } catch {
      return { workspace: empty, canPersist: false, recovered: true, backupPreserved: false };
    }
  }
}

export function parseAccountRecord(raw: string, storage: Store, key: string) {
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid account record');
    if (value.workspace) {
      const parsed = parseWorkspace(value.workspace);
      if (parsed !== value.workspace) preserveRawStorage(storage, key, raw);
      value.workspace = parsed;
    }
    else throw new Error('Missing account workspace');
    if (value.base) {
      const parsed = parseWorkspace(value.base);
      if (parsed !== value.base) preserveRawStorage(storage, key, raw);
      value.base = parsed;
    }
    if (value.lastSyncTime !== undefined && value.lastSyncTime !== null
      && (typeof value.lastSyncTime !== 'number' || !Number.isFinite(value.lastSyncTime) || value.lastSyncTime < 0)) throw new Error('Invalid sync timestamp');
    for (const pending of [value.pendingSync, value.inFlightSync]) {
      if (pending === undefined || pending === null) continue;
      if (typeof pending !== 'object' || Array.isArray(pending)
        || pending.lastError !== undefined && pending.lastError !== null && typeof pending.lastError !== 'string'
        || pending.nextAttemptAt !== undefined && pending.nextAttemptAt !== null
          && (typeof pending.nextAttemptAt !== 'number' || !Number.isFinite(pending.nextAttemptAt) || pending.nextAttemptAt < 0)) throw new Error('Invalid pending sync metadata');
      for (const field of ['workspace', 'base']) {
        if (!pending[field]) continue;
        const parsed = parseWorkspace(pending[field]);
        if (parsed !== pending[field]) preserveRawStorage(storage, key, raw);
        pending[field] = parsed;
      }
    }
    return value;
  } catch (error) {
    preserveRawStorage(storage, key, raw);
    throw error;
  }
}

/** Find an owner-scoped retained snapshot without restoring or changing it. */
export function readAccountRecovery(storage: Store, key: string): { raw: string; workspace: WorkspaceState } | null {
  if (!storage.key || typeof storage.length !== 'number') return null;
  const prefix = `${key}:recovery-backup`;
  let best: { raw: string; workspace: WorkspaceState } | null = null;
  let bestRank = -1;
  for (let index = 0; index < storage.length; index++) {
    const candidateKey = storage.key(index);
    if (!candidateKey) continue;
    const suffix = candidateKey === prefix ? '0' : candidateKey.startsWith(`${prefix}:`) ? candidateKey.slice(prefix.length + 1) : '';
    if (!/^\d+$/.test(suffix)) continue;
    const rank = Number(suffix);
    try {
      const raw = storage.getItem(candidateKey);
      if (!raw) continue;
      const value = JSON.parse(raw);
      const workspace = parseWorkspace(value.workspace);
      if (!workspace.tasks.length && !workspace.tabs.length && !workspace.deletedTasks.length) continue;
      if (rank > bestRank) { best = { raw, workspace }; bestRank = rank; }
    } catch { /* Never offer an invalid snapshot for recovery. */ }
  }
  return best;
}
