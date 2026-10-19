import type { PSTask } from '../types';
import type { AgentWorkspace } from './aiAgentActions';
import { canonical } from './canonical';

export type AgentUndoCollection = keyof AgentWorkspace;
export type AgentUndoChangedIds = Partial<Record<AgentUndoCollection, readonly string[]>>;
export interface AgentUndoConflict { collection: AgentUndoCollection; id: string }
interface AgentUndoRecord<T> { id: string; before: T | null; after: T | null; beforeIndex: number }
export type AgentUndoSnapshot = {
  [K in AgentUndoCollection]: AgentUndoRecord<AgentWorkspace[K][number]>[];
};
export interface AgentUndoResult {
  workspace: AgentWorkspace;
  undone: boolean;
  conflicts: AgentUndoConflict[];
}

const collections: AgentUndoCollection[] = ['tasks', 'deletedTasks', 'tabs', 'notes'];
const bankedFields = ['timeSpentSeconds', 'timeSessions', 'updatedAt', 'activityTrail'] as const;
const clone = <T>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value));
const same = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);

function captureRecords<T extends { id: string }>(before: T[], after: T[], ids?: readonly string[]): AgentUndoRecord<T>[] {
  const selected = ids && new Set(ids);
  const beforeById = new Map(before.map((record, index) => [record.id, { record, index }]));
  const afterById = new Map(after.map(record => [record.id, record]));
  return [...new Set([...beforeById.keys(), ...afterById.keys()])]
    .filter(id => !selected || selected.has(id))
    .flatMap(id => {
      const previous = beforeById.get(id);
      const next = afterById.get(id) ?? null;
      if (same(previous?.record ?? null, next)) return [];
      return [{ id, before: clone(previous?.record ?? null), after: clone(next), beforeIndex: previous?.index ?? -1 }];
    });
}

/** Capture only changed records; unrelated records stay live throughout Undo. */
export function captureAgentUndo(before: AgentWorkspace, after: AgentWorkspace,
  changedIds?: AgentUndoChangedIds | readonly string[]): AgentUndoSnapshot {
  const ids = (collection: AgentUndoCollection): readonly string[] | undefined =>
    Array.isArray(changedIds) ? changedIds : (changedIds as AgentUndoChangedIds | undefined)?.[collection];
  return {
    tasks: captureRecords(before.tasks, after.tasks, ids('tasks')),
    deletedTasks: captureRecords(before.deletedTasks, after.deletedTasks, ids('deletedTasks')),
    tabs: captureRecords(before.tabs, after.tabs, ids('tabs')),
    notes: captureRecords(before.notes, after.notes, ids('notes')),
  };
}

function comparableTask(task: PSTask): unknown {
  const record = { ...task };
  for (const field of bankedFields) delete record[field];
  // Banking an active session also attributes its time to the active step.
  if (record.stepList) record.stepList = record.stepList.map(step => {
    const value = { ...step };
    delete value.timeSpentSeconds;
    return value;
  });
  return record;
}

function restoreTask<T extends PSTask>(before: T, current: PSTask | undefined): T {
  const restored = clone(before);
  if (!current) return restored;
  for (const field of bankedFields) delete restored[field];
  const banked = Object.fromEntries(bankedFields.filter(field => Object.hasOwn(current, field))
    .map(field => [field, clone(current[field])]));
  Object.assign(restored, banked);
  if (restored.stepList && current.stepList) {
    const currentSteps = new Map(current.stepList.map(step => [step.id, step]));
    restored.stepList = restored.stepList.map(step => {
      const live = currentSteps.get(step.id);
      if (!live) return step;
      const value = { ...step };
      delete value.timeSpentSeconds;
      if (Object.hasOwn(live, 'timeSpentSeconds')) value.timeSpentSeconds = live.timeSpentSeconds;
      return value;
    });
  }
  return restored;
}

function restoreRecords<T extends { id: string }>(current: T[], records: AgentUndoRecord<T>[],
  restore: (before: T) => T = clone): T[] {
  const touched = new Map(records.map(record => [record.id, record]));
  const result = current.flatMap(record => {
    const entry = touched.get(record.id);
    return !entry ? [record] : entry.before ? [restore(entry.before)] : [];
  });
  const existing = new Set(current.map(record => record.id));
  for (const entry of records.filter(record => record.before && !existing.has(record.id))
    .sort((a, b) => a.beforeIndex - b.beforeIndex)) {
    result.splice(Math.min(entry.beforeIndex, result.length), 0, restore(entry.before!));
  }
  return result;
}

/** Conflict checking is atomic: a newer edit to any touched record blocks the whole turn. */
export function undoAgentTurn(current: AgentWorkspace, undo: AgentUndoSnapshot): AgentUndoResult {
  const conflicts: AgentUndoConflict[] = [];
  for (const collection of collections) {
    const taskRecords = collection === 'tasks' || collection === 'deletedTasks';
    for (const entry of undo[collection]) {
      const matches = current[collection].filter(record => record.id === entry.id);
      const record = matches[0] ?? null;
      const normalize = (value: unknown) => taskRecords && value ? comparableTask(value as PSTask) : value;
      if (matches.length > 1 || !same(normalize(record), normalize(entry.after))) conflicts.push({ collection, id: entry.id });
    }
  }
  if (conflicts.length) return { workspace: current, undone: false, conflicts };
  const liveTasks = new Map([...current.deletedTasks, ...current.tasks].map(task => [task.id, task]));
  return {
    workspace: {
      tasks: restoreRecords(current.tasks, undo.tasks, before => restoreTask(before, liveTasks.get(before.id))),
      deletedTasks: restoreRecords(current.deletedTasks, undo.deletedTasks, before => restoreTask(before, liveTasks.get(before.id))),
      tabs: restoreRecords(current.tabs, undo.tabs),
      notes: restoreRecords(current.notes, undo.notes),
    },
    undone: true,
    conflicts,
  };
}
