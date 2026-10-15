/** Local observations of provider calls, shared by chat, task steps, tab generation, audits and transcription. */
export const AI_USAGE_CHANGED = 'karkas-ai-usage-changed';
const key = 'karkas_ai_usage_v1';
export type AIUsageDay = { date: string; models: Record<string, number>; sessions: Record<string, number>; operations: Record<string, number>; unresolved: number };
const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};
export function readAIUsage(): AIUsageDay {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    const counts = (entries: unknown) => entries && typeof entries === 'object' && !Array.isArray(entries)
      && Object.keys(entries).length <= 200 && Object.values(entries).every(count => typeof count === 'number' && Number.isSafeInteger(count) && count >= 0);
    if (value?.date === today() && counts(value.models) && counts(value.operations) && Number.isSafeInteger(value.unresolved) && value.unresolved >= 0) return { ...value, sessions: counts(value.sessions) ? value.sessions : {} };
  } catch { /* Usage never blocks the requested action. */ }
  return { date: today(), models: {}, sessions: {}, operations: {}, unresolved: 0 };
}
const save = (value: AIUsageDay) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Session behavior remains available. */ }
  try { if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') window.dispatchEvent(new Event(AI_USAGE_CHANGED)); } catch { /* Observation cannot interrupt an AI action. */ }
};
export function beginAIUsage(operation: string): (response?: unknown) => void {
  const before = readAIUsage();
  before.operations[operation] = (before.operations[operation] || 0) + 1;
  before.unresolved += 1;
  save(before);
  let finished = false;
  return response => {
    if (finished) return;
    finished = true;
    const data = response && typeof response === 'object' ? response as Record<string, any> : undefined;
    const metrics = data?.aiMetrics;
    const models: unknown[] = Array.isArray(metrics?.attemptModels) ? metrics.attemptModels
      : Array.isArray(data?.diagnostics?.attempts) ? data.diagnostics.attempts.map((attempt: any) => attempt?.model)
      : typeof metrics?.model === 'string' ? Array.from({ length: Math.min(16, Math.max(1, metrics.attempts || 1)) }, () => metrics.model) : [];
    const usage = readAIUsage();
    // A cancelled/network-lost request may still have reached Google. Keep it explicitly unresolved.
    if (data && usage.date === before.date) usage.unresolved = Math.max(0, usage.unresolved - 1);
    for (const model of models.slice(0, 16)) if (typeof model === 'string' && /^gemini-[a-z0-9.-]{1,100}$/iu.test(model)) {
      usage.models[model] = (usage.models[model] || 0) + 1;
    }
    if (typeof data?.liveSessionModel === 'string' && /^gemini-[a-z0-9.-]{1,100}$/iu.test(data.liveSessionModel)) {
      usage.sessions[data.liveSessionModel] = (usage.sessions[data.liveSessionModel] || 0) + 1;
    }
    save(usage);
  };
}
