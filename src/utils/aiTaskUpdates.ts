import { completeTask, materializeStepList, reopenTask, setTaskSteps } from './taskOperations';
import type { AITaskUpdate, PSTask, TaskStepItem } from '../types';
import { applyAITimerSettings } from './aiTaskTimer';
import { normalizeTaskSchedule } from './taskScheduling';

/** Apply only supported AI fields; stepList is the complete replacement checklist. */
export function applyAITaskUpdate(
  task: PSTask,
  update: AITaskUpdate,
  availableTabIds: ReadonlySet<string>,
  now = Date.now(),
): PSTask {
  if (!update || update.id !== task.id) return task;
  if (task.scheduledPending && (update.done === true || update.timerAction === 'start')) return task;
  const next = { ...task };
  if (update.schedule !== undefined) {
    const schedule = normalizeTaskSchedule(update.schedule);
    if (!schedule) return task;
    if (task.done || task.timerRunning || task.startedAt || (task.timeSpentSeconds ?? 0) > 0) return task;
    next.schedule = schedule;
    next.scheduleNextStartAt = schedule.startAt;
    next.scheduledPending = true;
    next.timerRunning = false;
  }
  if (typeof update.title === 'string' && update.title.trim()) next.title = update.title.trim();
  if (typeof update.note === 'string') next.note = update.note;
  if (typeof update.phase === 'string' && availableTabIds.has(update.phase)) next.phase = update.phase;
  if (update.priority === 1 || update.priority === 2 || update.priority === 3) next.priority = update.priority;

  const replacement = Array.isArray(update.stepList) && update.stepList.every(
    (step) => step && typeof step.title === 'string' && step.title.trim(),
  ) ? update.stepList : undefined;
  const hasStepCount = typeof update.steps === 'number' && Number.isInteger(update.steps) && update.steps >= 0;
  const hasDone = typeof update.done === 'boolean';
  if (replacement) {
    const hadNamedSteps = Boolean(task.stepList?.length);
    const existing = hadNamedSteps ? task.stepList! : materializeStepList(task);
    const used = new Set<string>();
    const reserved = new Set(existing.map((step) => step.id));
    next.stepList = replacement.map((step, index): TaskStepItem => {
      const title = step.title.trim();
      const explicitId = typeof step.id === 'string' ? step.id.trim() : '';
      const matched = explicitId
        ? existing.find((item) => item.id === explicitId && !used.has(item.id))
        : existing.find((item) => item.title.trim() === title && !used.has(item.id));
      // Legacy progress has only ordered numeric rows. Naming those rows must
      // retain their checks and stable generated identities rather than start over.
      const indexedRow = existing[index];
      const legacyRow = !hadNamedSteps
        ? (indexedRow && !used.has(indexedRow.id) ? indexedRow : existing.find(item => !used.has(item.id)))
        : undefined;
      const previous = matched || (legacyRow && !used.has(legacyRow.id) ? legacyRow : undefined);
      let id = previous?.id || explicitId;
      if (!id || used.has(id) || (!previous && reserved.has(id))) {
        const base = `s-ai-${task.id}-${now}-${index}`;
        id = base;
        let suffix = 1;
        while (used.has(id) || reserved.has(id)) id = `${base}-${suffix++}`;
      }
      used.add(id);
      return { id, title, done: typeof step.done === 'boolean' ? step.done : previous?.done || false };
    });
    next.steps = next.stepList.length;
  } else if (hasStepCount && !next.stepList?.length) {
    next.steps = update.steps!;
  }

  if (replacement || hasStepCount) {
    if (next.stepList?.length) {
      next.steps = next.stepList.length;
      next.currentStep = next.stepList.filter((step) => step.done).length;
    } else {
      next.steps = Math.max(0, next.steps);
      next.currentStep = replacement ? 0 : Math.min(next.steps, Math.max(0, next.currentStep));
    }
  }
  const edited = replacement ? setTaskSteps(next, next.stepList!, now) : next;
  const completed = hasDone ? (update.done ? completeTask(edited, now) : reopenTask(edited, now)) : edited;
  return applyAITimerSettings(completed, update, now);
}
