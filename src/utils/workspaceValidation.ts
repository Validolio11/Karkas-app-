import { parseWorkspace as parseSharedWorkspace } from '../../electron/workspace-validation.mjs';
import type { WorkspaceState } from './syncState';

/** Validate before applying data. Keep all original records intact on failure. */
export function parseWorkspace(value: unknown): WorkspaceState {
  return parseSharedWorkspace(value) as WorkspaceState;
}
