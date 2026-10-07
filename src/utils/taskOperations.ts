import type { NewTaskInput, PSTask, TaskStepItem } from '../types';
import { getTaskRemainingSeconds, getTaskTimerMode, getTaskTotalSeconds, pauseTaskTimer, startTaskTimer } from './taskTimer';

const MAX_RUNNING_SESSION_SECONDS = 2 * 60 * 60;

/** Repairs timers left running across a restart and caps the recovered session. */
export function sanitizeTasksTimerSafeguard(taskList: PSTask[], now = Date.now()): PSTask[] {
  return taskList.map((task) => {
    if (!task.timerRunning) return task;
    if (getTaskTimerMode(task) === 'none' || task.done) return pauseTaskTimer(task, now);
    if (!Number.isFinite(task.timerStartedAt) || task.timerStartedAt! > now) {
      return { ...pauseTaskTimer(task, now), autoPausedOverdue: true };
    }
    const remaining = getTaskRemainingSeconds(task, now);
    if (remaining !== undefined) return remaining === 0 ? pauseTaskTimer(task, now) : task;
    const elapsedSeconds = Math.floor((now - task.timerStartedAt) / 1000);
    if (elapsedSeconds <= MAX_RUNNING_SESSION_SECONDS) return task;
    return {
      ...task,
      timeSpentSeconds: getTaskTotalSeconds({ ...task, timerRunning: false }, now) + MAX_RUNNING_SESSION_SECONDS,
      timerRunning: false,
      timerStartedAt: undefined,
      autoPausedOverdue: true,
    };
  });
}

function nonnegativeInteger(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value!)) : 0;
}

/** New tasks stay paused until the user explicitly starts work. */
export function createTask(input: NewTaskInput, id: string, now = Date.now()): PSTask | null {
  if (!input || typeof input !== 'object' || typeof input.title !== 'string' || !input.title.trim() ||
    typeof input.phase !== 'string' || !input.phase.trim() || typeof id !== 'string' || !id.trim() ||
    !Number.isFinite(now) || now < 0 || !Number.isInteger(input.steps) || input.steps < 0 ||
    ![1, 2, 3].includes(input.priority)) return null;
  const mode = input.timerMode ?? 'none';
  if (!['none', 'stopwatch', 'countdown'].includes(mode)) return null;
  if (mode === 'countdown' && (!Number.isInteger(input.countdownDurationSeconds) ||
    input.countdownDurationSeconds! < 60 || input.countdownDurationSeconds! > 86400)) return null;
  if (input.note !== undefined && typeof input.note !== 'string') return null;
  if (input.stepList !== undefined && (!Array.isArray(input.stepList) ||
    input.stepList.some(step => !step || typeof step.title !== 'string' || !step.title.trim()))) return null;
  const used = new Set<string>();
  const list = input.stepList?.map((step, index) => {
    let stepId = typeof step.id === 'string' && step.id.trim() ? step.id.trim() : `s-${id}-${index}`;
    const base = stepId;
    let suffix = 1;
    while (used.has(stepId)) stepId = `${base}-${suffix++}`;
    used.add(stepId);
    return { id: stepId, title: step.title.trim(), done: false };
  });
  return {
    id: id.trim(), title: input.title.trim(), phase: input.phase.trim(), priority: input.priority,
    steps: list?.length ? list.length : input.steps, currentStep: 0,
    ...(list ? { stepList: list } : {}),
    ...(input.note !== undefined ? { note: input.note.trim() } : {}),
    done: false, pinned: false, createdAt: now, timerMode: mode, timerRunning: false, timeSpentSeconds: 0,
    ...(mode === 'countdown' ? {
      countdownDurationSeconds: input.countdownDurationSeconds,
      countdownRemainingSeconds: input.countdownDurationSeconds,
    } : {}),
  };
}

export function startTaskWork(task: PSTask, now = Date.now()): PSTask {
  if (task.done) return task;
  const started = Number.isFinite(task.startedAt) ? task : { ...task, startedAt: now };
  return startTaskTimer(started, now);
}

/** Task completion is independent of its actual checklist progress. */
export function completeTask(task: PSTask, now = Date.now()): PSTask {
  return {
    ...pauseTaskTimer(task, now), done: true,
    completedAt: task.done && Number.isFinite(task.completedAt) ? task.completedAt : now,
  };
}

export function reopenTask(task: PSTask, now = Date.now()): PSTask {
  if (!task.done) return task;
  return { ...pauseTaskTimer(task, now), done: false, completedAt: undefined };
}

/** Preserve progress saved before named substeps were introduced. */
export function materializeStepList(task: PSTask, stepLabel = 'Крок'): TaskStepItem[] {
  if (task.stepList?.length) return task.stepList.map((step) => ({ ...step }));
  const count = nonnegativeInteger(task.steps);
  const completed = Math.min(count, nonnegativeInteger(task.currentStep));
  return Array.from({ length: count }, (_, index) => ({
    id: `s-${task.id}-${index}`, title: `${stepLabel} ${index + 1}`, done: index < completed,
  }));
}

/** Editing a checklist does not change the parent's explicit completion state. */
export function setTaskSteps(task: PSTask, stepList: TaskStepItem[], now: number): PSTask {
  const list = stepList.map((step) => ({ ...step }));
  const completed = list.filter((step) => step.done).length;
  const base = task.done ? pauseTaskTimer(task, now) : task;
  return {
    ...base, stepList: list, steps: list.length, currentStep: completed,
  };
}

export function toggleTaskDone(task: PSTask, now: number, _stepLabel = 'Крок'): PSTask {
  return task.done ? reopenTask(task, now) : completeTask(task, now);
}

export function setTaskProgress(task: PSTask, progress: number, now: number, stepLabel = 'Крок'): PSTask {
  if (!Number.isFinite(progress)) return task;
  const list = materializeStepList(task, stepLabel);
  const bounded = Math.min(list.length, nonnegativeInteger(progress));
  return setTaskSteps(task, list.map((step, index) => ({ ...step, done: index < bounded })), now);
}

export function toggleTaskStep(task: PSTask, index: number, now: number, stepLabel = 'Крок'): PSTask {
  const list = materializeStepList(task, stepLabel);
  if (!Number.isInteger(index) || index < 0 || index >= list.length) return task;
  return setTaskSteps(task, list.map((step, i) => i === index ? { ...step, done: !step.done } : step), now);
}

export function addTaskStep(task: PSTask, step: TaskStepItem, now: number, stepLabel = 'Крок'): PSTask {
  if (!step.title.trim()) return task;
  const list = task.stepList ? task.stepList.map((existing) => ({ ...existing })) : materializeStepList(task, stepLabel);
  if (list.some((existing) => existing.id === step.id)) return task;
  return setTaskSteps(task, [...list, { ...step, title: step.title.trim(), done: false }], now);
}

export function deleteTaskStep(task: PSTask, index: number, now: number, stepLabel = 'Крок'): PSTask {
  const list = materializeStepList(task, stepLabel);
  if (!Number.isInteger(index) || index < 0 || index >= list.length) return task;
  return setTaskSteps(task, list.filter((_, i) => i !== index), now);
}

/** Manual totals include live elapsed time without resetting a countdown budget. */
export function setTaskTimeSpent(task: PSTask, value: number, now: number): PSTask {
  if (!Number.isFinite(value)) return task;
  const remaining = getTaskRemainingSeconds(task, now);
  return {
    ...task, timeSpentSeconds: nonnegativeInteger(value),
    timerStartedAt: task.timerRunning ? now : undefined, autoPausedOverdue: false,
    ...(remaining === undefined ? {} : { countdownRemainingSeconds: remaining }),
  };
}
