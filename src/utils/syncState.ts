import type { UserCloudState } from '../services/firebase';
import { applyWorkspaceMutation, diffWorkspaceMutation } from './syncOperations';

export type WorkspaceState = Pick<UserCloudState, 'tasks' | 'tabs' | 'deletedTasks' | 'settings'>;

export interface MergeWorkspaceOptions {
  /** A new device has no account baseline, so its UI defaults are not user edits. */
  preferRemoteSettingsOnFirstSync?: boolean;
}

export interface SyncMutationIdentity {
  clientId: string;
  sequence: number;
}

export const MAX_CLOUD_PAYLOAD_BYTES = 900 * 1024;

export function cloudPayloadSizeBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function assertCloudPayloadWithinLimit(value: unknown): void {
  const bytes = cloudPayloadSizeBytes(value);
  if (bytes > MAX_CLOUD_PAYLOAD_BYTES) {
    const error = new Error(`Cloud workspace is too large to sync (${Math.ceil(bytes / 1024)} KiB).`);
    error.name = 'CloudWorkspaceTooLargeError';
    throw error;
  }
}

export function isSyncMutationApplied(
  syncClients: Record<string, number> | undefined,
  mutation: SyncMutationIdentity,
): boolean {
  const appliedSequence = syncClients?.[mutation.clientId];
  return typeof appliedSequence === 'number' && Number.isSafeInteger(appliedSequence) && appliedSequence >= mutation.sequence;
}

export function recordSyncMutation(
  syncClients: Record<string, number> | undefined,
  mutation: SyncMutationIdentity,
): Record<string, number> {
  const next = Object.fromEntries(Object.entries(syncClients || {}).filter(([clientId, sequence]) =>
    /^[a-zA-Z0-9_-]{8,80}$/.test(clientId) && Number.isSafeInteger(sequence) && sequence > 0,
  ));
  delete next[mutation.clientId];
  next[mutation.clientId] = mutation.sequence;
  const overflow = Object.keys(next).length - 64;
  if (overflow > 0) {
    for (const clientId of Object.keys(next).slice(0, overflow)) delete next[clientId];
  }
  return next;
}

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

/** Replay only local edits since the last acknowledged cloud state onto fresh remote data. */
export function mergeWorkspace(
  base: WorkspaceState | null,
  local: WorkspaceState,
  remote: WorkspaceState,
  options: MergeWorkspaceOptions = {},
): WorkspaceState {
  const baseline: WorkspaceState = base ?? {
    tasks: [],
    tabs: [],
    deletedTasks: [],
    // On a first sync, using the local settings as the baseline emits no
    // settings operation and therefore preserves the remote device settings.
    settings: options.preferRemoteSettingsOnFirstSync ? local.settings : remote.settings,
  };
  const mutation = diffWorkspaceMutation(baseline, local, { clientId: 'merge-local', sequence: 1 }, 0);
  return applyWorkspaceMutation(remote, mutation);
}
