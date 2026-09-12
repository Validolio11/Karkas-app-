import type { AITaskUpdate, PSTask, TaskStepItem } from '../types';

/** Apply only supported AI fields; stepList is the complete replacement checklist. */
export function applyAITaskUpdate(
  task: PSTask,
  update: AITaskUpdate,
  availableTabIds: ReadonlySet<string>,
  now = Date.now(),
): PSTask {
  if (!update || update.id !== task.id) return task;
  const next = { ...task };
  if (typeof update.title === 'string' && update.title.trim()) next.title = update.title.trim();
  if (typeof update.note === 'string') next.note = update.note;
  if (typeof update.phase === 'string' && availableTabIds.has(update.phase)) next.phase = update.phase;
  if (update.priority === 1 || update.priority === 2 || update.priority === 3) next.priority = update.priority;

  const replacement = Array.isArray(update.stepList) && update.stepList.every(
    (step) => step && typeof step.title === 'string' && step.title.trim(),
  ) ? update.stepList : undefined;
  const hasStepCount = typeof update.steps === 'number' && Number.isFinite(update.steps) && update.steps >= 1;
  const hasDone = typeof update.done === 'boolean';
  if (replacement) {
    const existing = task.stepList || [];
    const used = new Set<string>();
    const reserved = new Set(existing.map((step) => step.id));
    next.stepList = replacement.map((step, index): TaskStepItem => {
      const title = step.title.trim();
      const explicitId = typeof step.id === 'string' ? step.id.trim() : '';
      const previous = explicitId
        ? existing.find((item) => item.id === explicitId && !used.has(item.id))
        : existing.find((item) => item.title.trim() === title && !used.has(item.id));
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
    next.steps = Math.max(1, next.stepList.length);
  } else if (hasStepCount && !next.stepList?.length) {
    next.steps = Math.max(1, Math.floor(update.steps!));
  }

  if (replacement || hasStepCount || hasDone) {
    if (next.stepList?.length) {
      if (hasDone) next.stepList = next.stepList.map((step) => ({ ...step, done: update.done! }));
      next.steps = next.stepList.length;
      next.currentStep = next.stepList.filter((step) => step.done).length;
      next.done = next.currentStep === next.steps;
    } else {
      next.steps = Math.max(1, next.steps);
      next.currentStep = replacement ? 0 : Math.min(next.steps, Math.max(0, next.currentStep));
      if (hasDone) next.currentStep = update.done ? next.steps : 0;
      next.done = next.currentStep === next.steps;
    }
    next.completedAt = next.done ? (task.completedAt ?? now) : undefined;
    if (next.done) {
      if (task.timerRunning && typeof task.timerStartedAt === 'number') {
        next.timeSpentSeconds = (task.timeSpentSeconds || 0) + Math.max(0, Math.floor((now - task.timerStartedAt) / 1000));
      }
      next.timerRunning = false;
      next.timerStartedAt = undefined;
    }
  }
  return next;
}
