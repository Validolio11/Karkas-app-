import type { PSTask } from '../types';
import { materializeStepList, setTaskSteps } from './taskOperations';

export interface WorkPlanEdit {
  expected: {
    plannedDurationSeconds?: number;
    steps: { id: string; title: string; estimatedDurationSeconds?: number }[];
  };
  plannedDurationSeconds?: number;
  steps: { id: string; estimatedDurationSeconds?: number }[];
}

const validEstimate = (value: unknown) => value === undefined ||
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 86400;

/** Apply only the form's estimates; newer measurements and checklist progress stay authoritative. */
export function applyTaskWorkPlan(task: PSTask, edit: WorkPlanEdit, now: number, stepLabel = 'Крок'): PSTask | null {
  if (task.done || task.scheduledPending || !Number.isFinite(now) || now < 0 || !edit || !edit.expected ||
    !Array.isArray(edit.steps) || !Array.isArray(edit.expected.steps) || !validEstimate(edit.plannedDurationSeconds)) return null;
  const steps = materializeStepList(task, stepLabel);
  if (!Object.is(task.plannedDurationSeconds, edit.expected.plannedDurationSeconds) ||
    steps.length !== edit.steps.length || steps.length !== edit.expected.steps.length) return null;
  const ids = new Set<string>();
  for (let index = 0; index < steps.length; index++) {
    const current = steps[index];
    const expected = edit.expected.steps[index];
    const proposed = edit.steps[index];
    if (!expected || !proposed || typeof current.id !== 'string' || !current.id.trim() || ids.has(current.id) ||
      current.id !== expected.id || current.id !== proposed.id || current.title !== expected.title ||
      !Object.is(current.estimatedDurationSeconds, expected.estimatedDurationSeconds) ||
      !validEstimate(proposed.estimatedDurationSeconds)) return null;
    ids.add(current.id);
  }
  const next = setTaskSteps(task, steps.map((step, index) => {
    const changed = { ...step };
    const estimate = edit.steps[index].estimatedDurationSeconds;
    if (estimate === undefined) delete changed.estimatedDurationSeconds;
    else changed.estimatedDurationSeconds = estimate;
    return changed;
  }), now);
  if (edit.plannedDurationSeconds === undefined) delete next.plannedDurationSeconds;
  else next.plannedDurationSeconds = edit.plannedDurationSeconds;
  return next;
}
