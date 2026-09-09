import type { UserCloudState } from '../services/firebase';

export type WorkspaceState = Pick<UserCloudState, 'tasks' | 'tabs' | 'deletedTasks' | 'settings'>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().filter((key) => (value as any)[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonical((value as any)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

export function sameWorkspace(left: WorkspaceState, right: WorkspaceState): boolean {
  return (['tasks', 'tabs', 'deletedTasks', 'settings'] as const)
    .every((key) => canonical(left[key]) === canonical(right[key]));
}

function mergeFields<T extends object>(base: T | undefined, local: T, remote: T): T {
  const result = { ...remote };
  for (const key of new Set([...Object.keys(base ?? {}), ...Object.keys(local)])) {
    const field = key as keyof T;
    if (!base || canonical(local[field]) !== canonical(base[field])) {
      if (local[field] === undefined) delete result[field];
      else result[field] = local[field];
    }
  }
  return result;
}

function mergeEntities<T extends { id: string }>(base: T[] | undefined, local: T[], remote: T[]): T[] {
  const baseline = new Map((base ?? []).map((item) => [item.id, item]));
  const localItems = new Map(local.map((item) => [item.id, item]));
  const result = new Map(remote.map((item) => [item.id, item]));
  for (const [id, original] of baseline) {
    const current = localItems.get(id);
    if (!current) result.delete(id);
    else if (canonical(current) !== canonical(original)) {
      result.set(id, mergeFields(original, current, result.get(id) ?? original));
    }
  }
  for (const [id, current] of localItems) {
    if (!baseline.has(id)) result.set(id, mergeFields(undefined, current, result.get(id) ?? current));
  }
  return [...result.values()];
}

/** Replay only local edits since the last acknowledged cloud state onto fresh remote data. */
export function mergeWorkspace(
  base: WorkspaceState | null,
  local: WorkspaceState,
  remote: WorkspaceState,
): WorkspaceState {
  return {
    tasks: mergeEntities(base?.tasks, local.tasks ?? [], remote.tasks ?? []),
    tabs: mergeEntities(base?.tabs, local.tabs ?? [], remote.tabs ?? []),
    deletedTasks: mergeEntities(base?.deletedTasks, local.deletedTasks ?? [], remote.deletedTasks ?? []),
    settings: mergeFields(base?.settings, local.settings, remote.settings),
  };
}
