import type { PSTask } from '../types';

/** Timer ticks may continue; edits and checklist progress invalidate an older proposal. */
export function proposalTargetsUnchanged(before: PSTask[], current: PSTask[], targetIds: string[]): boolean {
  const revision = (task: PSTask) => JSON.stringify({
    title: task.title, phase: task.phase, priority: task.priority, note: task.note,
    stepList: task.stepList, currentStep: task.currentStep, steps: task.steps, done: task.done,
    schedule: task.schedule, timerMode: task.timerMode, countdownDurationSeconds: task.countdownDurationSeconds,
  });
  return targetIds.every(id => {
    const expected = before.find(task => task.id === id);
    const actual = current.find(task => task.id === id);
    return !!expected && !!actual && revision(expected) === revision(actual);
  });
}
