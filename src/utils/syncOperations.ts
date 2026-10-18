import { canonical } from './canonical';
import type { DeletedTask, PSTask, TaskTab, TaskStepItem } from '../types';
import type { SyncMutationIdentity, WorkspaceState } from './syncState';
import { mergeTaskActivityTrail } from './taskActivity';

type Lifecycle = 'active' | 'deleted' | 'purged';
type Patch<T> = Partial<Omit<T, 'id'>>;

export interface TaskSyncOperation {
  kind: 'task';
  id: string;
  lifecycle?: Lifecycle;
  patch?: Patch<DeletedTask>;
  unset?: string[];
  /** Legacy absolute patches remain readable; new edits use independent operations. */
  stepChanges?: { id: string; create?: boolean; remove?: boolean; patch?: Partial<TaskStepItem>; unset?: string[]; timeDelta?: number }[];
  stepOrder?: string[];
  timeDelta?: number;
  timeBaseResetAt?: number;
  sessions?: NonNullable<PSTask['timeSessions']>;
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
    let stepChanges: TaskSyncOperation['stepChanges'];
    let stepOrder: string[] | undefined;
    let timeDelta: number | undefined;
    let sessions: TaskSyncOperation['sessions'];
    let sessionDelta = 0;
    const stepSessionDeltas = new Map<string, number>();
    if (before) {
      if (after.value.timeResetAt === before.value.timeResetAt && after.value.timeSessions) {
        for (const [sessionId, session] of Object.entries(after.value.timeSessions)) {
          const oldSeconds = before.value.timeSessions?.[sessionId]?.seconds ?? 0;
          if (session.seconds <= oldSeconds) continue;
          (sessions ??= {})[sessionId] = structuredClone(session);
          sessionDelta += session.seconds - oldSeconds;
          if (session.stepId) stepSessionDeltas.set(session.stepId, (stepSessionDeltas.get(session.stepId) ?? 0) + session.seconds - oldSeconds);
        }
        if (fields.patch) delete fields.patch.timeSessions;
      }
      const previousTime = before.value.timeSpentSeconds ?? 0;
      const nextTime = after.value.timeSpentSeconds ?? 0;
      if (nextTime > previousTime && after.value.timeResetAt === before.value.timeResetAt) {
        timeDelta = Math.max(0, nextTime - previousTime - sessionDelta);
        if (fields.patch) delete fields.patch.timeSpentSeconds;
      }
      if (Array.isArray(after.value.stepList)) {
        const oldSteps = before.value.stepList ?? [];
        const previous = new Map(oldSteps.map(step => [step.id, step]));
        const current = new Map(after.value.stepList.map(step => [step.id, step]));
        stepChanges = [];
        for (const stepId of new Set([...previous.keys(), ...current.keys()])) {
          const oldStep = previous.get(stepId);
          const newStep = current.get(stepId);
          if (!newStep) { stepChanges.push({ id: stepId, remove: true }); continue; }
          const change = diffFields(oldStep, newStep);
          if (!oldStep && change.patch?.timeSpentSeconds !== undefined && stepSessionDeltas.has(stepId)) {
            change.patch.timeSpentSeconds = Math.max(0, change.patch.timeSpentSeconds - stepSessionDeltas.get(stepId)!);
          }
          const delta = oldStep && after.value.timeResetAt === before.value.timeResetAt &&
            (newStep.timeSpentSeconds ?? 0) > (oldStep.timeSpentSeconds ?? 0)
            ? Math.max(0, (newStep.timeSpentSeconds ?? 0) - (oldStep.timeSpentSeconds ?? 0) - (stepSessionDeltas.get(stepId) ?? 0)) : undefined;
          if (delta !== undefined && change.patch) delete change.patch.timeSpentSeconds;
          if (change.patch && !Object.keys(change.patch).length) delete change.patch;
          if (change.patch || change.unset || delta !== undefined) stepChanges.push({ id: stepId, ...(!oldStep ? { create: true } : {}), ...change, ...(delta !== undefined ? { timeDelta: delta } : {}) });
        }
        if (canonical(oldSteps.map(step => step.id)) !== canonical(after.value.stepList.map(step => step.id))) {
          stepOrder = after.value.stepList.map(step => step.id);
        }
        if (fields.patch) { delete fields.patch.stepList; delete fields.patch.steps; delete fields.patch.currentStep; }
      }
      if (fields.patch && !Object.keys(fields.patch).length) delete fields.patch;
    }
    const lifecycle = before?.lifecycle === after.lifecycle ? undefined : after.lifecycle;
    if (!before || lifecycle || fields.patch || fields.unset || stepChanges?.length || stepOrder || timeDelta !== undefined || sessions) {
      operations.push({ kind: 'task', id, ...(lifecycle ? { lifecycle } : {}), ...fields,
        ...(stepChanges?.length ? { stepChanges } : {}), ...(stepOrder ? { stepOrder } : {}),
        ...(timeDelta !== undefined ? { timeDelta } : {}),
        ...(sessions ? { sessions } : {}),
        ...(before ? { timeBaseResetAt: before.value.timeResetAt ?? 0 } : {}) });
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
    // A lifecycle-only edit from an offline client cannot recreate a purged task.
    // New tasks carry their complete record; deletes/restores only carry a delta.
    if (!current && (!operation.patch || typeof operation.patch.title !== 'string'
      || typeof operation.patch.phase !== 'string' || ![1, 2, 3].includes(operation.patch.priority!)
      || !Number.isInteger(operation.patch.steps) || !Number.isInteger(operation.patch.currentStep)
      || typeof operation.patch.done !== 'boolean' || typeof operation.patch.createdAt !== 'number')) continue;
    const lifecycle = operation.lifecycle ?? current?.lifecycle;
    if (!lifecycle) continue;
    const fallback = { id: operation.id } as DeletedTask;
    const patch = operation.patch ? { ...operation.patch } : undefined;
    // Offline devices may independently append history. An absolute array
    // patch must not erase the events already recorded on the other device.
    if (patch?.activityTrail !== undefined) patch.activityTrail = mergeTaskActivityTrail(current?.value.activityTrail,
      Array.isArray(patch.activityTrail) ? patch.activityTrail : undefined);
    if (patch?.updatedAt !== undefined) {
      if (Number.isFinite(patch.updatedAt) && patch.updatedAt >= 0) patch.updatedAt = Math.max(current?.value.updatedAt ?? 0, patch.updatedAt);
      else delete patch.updatedAt;
    }
    const staleReset = patch?.timeResetAt !== undefined && patch.timeResetAt < (current?.value.timeResetAt ?? 0);
    if (staleReset) {
      delete patch.timeResetAt;
      delete patch.timeSpentSeconds;
      delete patch.timeSessions;
    }
    const sameTimeEpoch = (current?.value.timeResetAt ?? 0) === (operation.timeBaseResetAt ?? current?.value.timeResetAt ?? 0);
    const appliesNewReset = patch?.timeResetAt !== undefined && patch.timeResetAt >= (current?.value.timeResetAt ?? 0);
    const obsoleteTime = staleReset || (!sameTimeEpoch && !appliesNewReset);
    const timeFields = new Set(['timeSpentSeconds', 'timeSessions', 'timeResetAt', 'timerRunning', 'timerStartedAt', 'timerSessionId',
      'timerStepId', 'countdownRemainingSeconds', 'countdownDurationSeconds', 'timerMode', 'autoPausedOverdue', 'limitedStart']);
    if (obsoleteTime && patch) for (const field of timeFields) delete (patch as Record<string, unknown>)[field];
    // App-owned chronology is cumulative and cannot be removed by older
    // clients or an undo patch that lacks the newer metadata fields.
    const unset = operation.unset?.filter(field => field !== 'activityTrail' && field !== 'updatedAt' && (!obsoleteTime || !timeFields.has(field)));
    const value = applyPatch(current?.value ?? fallback, patch, unset);
    if (operation.timeDelta !== undefined && sameTimeEpoch) value.timeSpentSeconds = (value.timeSpentSeconds ?? 0) + operation.timeDelta;
    if (operation.stepChanges || operation.stepOrder) {
      const steps = new Map((value.stepList ?? []).map(step => [step.id, step]));
      for (const change of operation.stepChanges ?? []) {
        if (change.remove) { steps.delete(change.id); continue; }
        const oldStep = steps.get(change.id);
        // A field-only change cannot resurrect a concurrently removed step.
        if (!oldStep && (change.create !== true || typeof change.patch?.title !== 'string')) continue;
        const stepPatch = change.patch ? { ...change.patch } : undefined;
        if (obsoleteTime && stepPatch) delete stepPatch.timeSpentSeconds;
        const stepUnset = obsoleteTime ? change.unset?.filter(field => field !== 'timeSpentSeconds') : change.unset;
        const step = applyPatch(oldStep ?? { id: change.id, title: '', done: false }, stepPatch, stepUnset);
        if (change.timeDelta !== undefined && sameTimeEpoch) step.timeSpentSeconds = (step.timeSpentSeconds ?? 0) + change.timeDelta;
        steps.set(change.id, step);
      }
      const order = [...new Set([...(operation.stepOrder ?? []), ...steps.keys()])];
      value.stepList = order.filter(id => steps.has(id)).map(id => steps.get(id)!);
      value.steps = value.stepList.length;
      value.currentStep = value.stepList.filter(step => step.done).length;
    }
    if (operation.sessions && sameTimeEpoch) {
      value.timeSessions = { ...value.timeSessions };
      for (const [sessionId, session] of Object.entries(operation.sessions)) {
        const old = value.timeSessions[sessionId];
        const added = Math.max(0, session.seconds - (old?.seconds ?? 0));
        if (!added) continue;
        value.timeSessions[sessionId] = structuredClone(session);
        value.timeSpentSeconds = (value.timeSpentSeconds ?? 0) + added;
        if (session.stepId && value.stepList) value.stepList = value.stepList.map(step => step.id === session.stepId
          ? { ...step, timeSpentSeconds: (step.timeSpentSeconds ?? 0) + added } : step);
      }
    }
    tasks.set(operation.id, { lifecycle, value });
  }

  const categoryIds = new Set(tabs.keys());
  if ([...tasks.values()].some(({ value }) => !categoryIds.has(value.phase))) {
    let fallbackId = 'recovered-tasks';
    if (tabs.has(fallbackId)) fallbackId = tabs.get(fallbackId)!.id;
    else tabs.set(fallbackId, { id: fallbackId, name: settings.lang === 'en' ? 'Recovered tasks' : 'Відновлені завдання' });
    for (const record of tasks.values()) {
      if (!categoryIds.has(record.value.phase)) record.value = { ...record.value, phase: fallbackId };
    }
  }
  return {
    tasks: [...tasks.values()].filter((item) => item.lifecycle === 'active').map((item) => item.value as PSTask),
    deletedTasks: [...tasks.values()].filter((item) => item.lifecycle === 'deleted').map((item) => item.value),
    tabs: [...tabs.values()],
    settings,
  };
}
