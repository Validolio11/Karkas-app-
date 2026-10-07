import type { PSTask, TaskStepItem } from '../types';
import { getTaskRemainingSeconds, getTaskTotalSeconds, pauseTaskTimer } from './taskTimer';

const MAX_RUNNING_SESSION_SECONDS = 2 * 60 * 60;

/** Repairs timers left running across a restart and caps the recovered session. */
export function sanitizeTasksTimerSafeguard(taskList: PSTask[], now = Date.now()): PSTask[] {
  return taskList.map((task) => {
    if (!task.timerRunning) return task;
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

/** Preserve progress saved before named substeps were introduced. */
export function materializeStepList(task: PSTask, stepLabel = 'Крок'): TaskStepItem[] {
  if (task.stepList?.length) return task.stepList.map((step) => ({ ...step }));
  const count = Math.max(1, nonnegativeInteger(task.steps));
  const completed = task.done ? count : Math.min(count, nonnegativeInteger(task.currentStep));
  return Array.from({ length: count }, (_, index) => ({
    id: `s-${task.id}-${index}`, title: `${stepLabel} ${index + 1}`, done: index < completed,
  }));
}

/** Completion banks the active stopwatch/countdown session once. */
export function setTaskSteps(task: PSTask, stepList: TaskStepItem[], now: number): PSTask {
  const list = stepList.map((step) => ({ ...step }));
  const completed = list.filter((step) => step.done).length;
  const done = list.length > 0 && completed === list.length;
  const base = done ? pauseTaskTimer(task, now) : task;
  return {
    ...base, stepList: list, steps: Math.max(1, list.length), currentStep: completed, done,
    completedAt: done ? (task.done && Number.isFinite(task.completedAt) ? task.completedAt : now) : undefined,
  };
}

export function toggleTaskDone(task: PSTask, now: number, stepLabel = 'Крок'): PSTask {
  const done = !task.done;
  return setTaskSteps(task, materializeStepList(task, stepLabel).map((step) => ({ ...step, done })), now);
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
