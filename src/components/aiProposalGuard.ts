import type { AIResponse, PSTask } from '../types';

/** A read-only answer keeps a draft; an incomplete correction keeps it suspended. */
export function proposalTransition(response: AIResponse, hasCurrentDraft: boolean, draftWasReady: boolean): 'replace' | 'retain' | 'suspend' | 'cancel' | 'none' {
  if (response.proposalDisposition === 'cancelled') return 'cancel';
  if ([response.tasks, response.tabs, response.taskUpdates, response.taskDeletions].some(items => items?.length)) return 'replace';
  if (!hasCurrentDraft) return 'none';
  return response.proposalDisposition === 'clarification' || !draftWasReady ? 'suspend' : 'retain';
}

/** Timer ticks may continue; edits, date changes and checklist progress invalidate an older proposal. */
export function proposalTargetsUnchanged(before: PSTask[], current: PSTask[], targetIds: string[]): boolean {
  const revision = (task: PSTask) => JSON.stringify({
    title: task.title, phase: task.phase, priority: task.priority, note: task.note,
    stepList: task.stepList, currentStep: task.currentStep, steps: task.steps, done: task.done,
    plannedDate: task.plannedDate, deadlineDate: task.deadlineDate,
    scheduledPending: task.scheduledPending, scheduledFor: task.scheduledFor,
    schedulePlanId: task.schedulePlanId, scheduleNextStartAt: task.scheduleNextStartAt,
    schedule: task.schedule, timerMode: task.timerMode, countdownDurationSeconds: task.countdownDurationSeconds,
    timeResetAt: task.timeResetAt,
  });
  return targetIds.every(id => {
    const expected = before.find(task => task.id === id);
    const actual = current.find(task => task.id === id);
    return !!expected && !!actual && revision(expected) === revision(actual);
  });
}
