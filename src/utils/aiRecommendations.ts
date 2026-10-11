import type { AIRecommendation } from '../types';

/** Treat provider responses and persisted caches as equally untrusted input. */
export function parseAIRecommendation(value: unknown): AIRecommendation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid recommendations');
  const input = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of ['focusAdvice', 'optimizationTip', 'workloadStatus', 'periodRetrospective', 'dropoffAnalysis', 'futureStrategy', 'productivityGrade']) {
    const field = input[key];
    if (field === undefined && !['focusAdvice', 'optimizationTip', 'workloadStatus'].includes(key)) continue;
    if (typeof field !== 'string' || field.length > 12000) throw new Error('Invalid recommendation text');
    result[key] = field;
  }
  if (!Array.isArray(input.suggestedTasks) || input.suggestedTasks.length > 20) throw new Error('Invalid suggested tasks');
  result.suggestedTasks = input.suggestedTasks.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid suggested task');
    const task = item as Record<string, unknown>;
    if (typeof task.title !== 'string' || !task.title.trim() || task.title.length > 2000
      || typeof task.phase !== 'string' || !task.phase.trim() || ![1, 2, 3].includes(task.priority as number)
      || !Number.isSafeInteger(task.steps) || (task.steps as number) < 0 || (task.steps as number) > 50
      || task.note !== undefined && (typeof task.note !== 'string' || task.note.length > 12000)
      || task.reason !== undefined && (typeof task.reason !== 'string' || task.reason.length > 12000)) throw new Error('Invalid suggested task fields');
    return { title: task.title, phase: task.phase, priority: task.priority, steps: task.steps,
      note: task.note ?? '', ...(task.reason !== undefined ? { reason: task.reason } : {}) };
  });
  if (input.source !== undefined) {
    if (!['gemini', 'engine'].includes(input.source as string)) throw new Error('Invalid recommendation source');
    result.source = input.source;
  }
  return result as unknown as AIRecommendation;
}
