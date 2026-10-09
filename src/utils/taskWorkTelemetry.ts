import type { PSTask } from '../types';

const measuredSeconds = (value: number | undefined) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? Math.floor(value) : 0;

function uniqueStepIds(task: PSTask): Set<string> {
  const counts = new Map<string, number>();
  for (const step of Array.isArray(task.stepList) ? task.stepList : []) {
    if (step && typeof step.id === 'string' && step.id.trim()) counts.set(step.id, (counts.get(step.id) || 0) + 1);
  }
  return new Set(Array.from(counts).filter(([, count]) => count === 1).map(([id]) => id));
}

/** An unfinished named step is the active stage; numeric legacy progress is not invented. */
export function activeTaskStepId(task: PSTask): string | undefined {
  if (task.done || !Array.isArray(task.stepList)) return undefined;
  const ids = uniqueStepIds(task);
  const step = task.stepList.find(step => step && !step.done);
  return step && ids.has(step.id) ? step.id : undefined;
}

/** Attribute only a session whose step identity was captured at explicit start. */
export function bankTaskStepSession(task: PSTask, sessionSeconds: number): PSTask {
  const elapsed = measuredSeconds(sessionSeconds);
  if (!elapsed || !task.timerStepId || !Array.isArray(task.stepList) || !uniqueStepIds(task).has(task.timerStepId)) return task;
  return { ...task, stepList: task.stepList.map(step => {
    if (step?.id !== task.timerStepId) return step;
    const next = { ...step };
    const total = measuredSeconds(step.timeSpentSeconds) + elapsed;
    if (Number.isSafeInteger(total)) next.timeSpentSeconds = total;
    else delete next.timeSpentSeconds;
    return next;
  }) };
}

/** A manually replaced task total cannot establish how that correction belongs to steps. */
export function discardTaskStepAttribution(task: PSTask): PSTask {
  const next = { ...task, ...(task.stepList ? { stepList: task.stepList.map(step => {
    const clean = { ...step }; delete clean.timeSpentSeconds; return clean;
  }) } : {}) };
  delete next.timerStepId;
  return next;
}

export function initialTaskPlanSeconds(task: Pick<PSTask, 'plannedDurationSeconds'>, explicitSeconds: number): number {
  return typeof task.plannedDurationSeconds === 'number' && Number.isFinite(task.plannedDurationSeconds) && task.plannedDurationSeconds >= 1 && task.plannedDurationSeconds <= Number.MAX_SAFE_INTEGER
    ? Math.floor(task.plannedDurationSeconds) : Math.floor(explicitSeconds);
}
