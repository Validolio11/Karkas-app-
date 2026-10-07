import type { PSTask } from '../types';

/** Ignore timer ticks, but reject generated steps after edits, progress or completion. */
export function taskBreakdownContext(task: PSTask): string {
  return JSON.stringify({
    title: task.title, note: task.note, phase: task.phase, priority: task.priority,
    steps: task.steps, stepList: task.stepList, currentStep: task.currentStep, done: task.done,
  });
}
