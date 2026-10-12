import type { PersonalStrategyProfile, PSTask } from '../src/types';
import { normalizeStrategyDiscovery, STRATEGY_DISCOVERY_TOPICS } from '../src/utils/strategyDiscovery';
import { recordedTaskSeconds } from '../src/utils/taskTimeStats';

/** Choose complete recent observations; cutting a quote can remove its negation or context. */
function recentWholeItems<T>(items: readonly T[], count: number, characterBudget: number) {
  const selected: T[] = [];
  let remaining = characterBudget;
  for (let index = items.length - 1; index >= 0 && selected.length < count; index -= 1) {
    const item = items[index];
    const serialized = JSON.stringify(item);
    if (typeof serialized !== 'string') continue;
    const size = serialized.length;
    if (size > remaining) continue;
    remaining -= size;
    selected.push(item);
  }
  selected.reverse();
  return { items: selected, omittedCount: items.length - selected.length };
}

/**
 * Provider-only projection. Readiness, consent and memory updates still use the
 * complete account profile in the application; this must never be persisted.
 */
export function boundedPersonalPromptContext(profile: PersonalStrategyProfile) {
  const state = normalizeStrategyDiscovery(profile);
  const topics = Object.fromEntries(STRATEGY_DISCOVERY_TOPICS.map(topic => {
    const answer = state.topics[topic];
    const evidence = recentWholeItems(answer.evidence, 3, 2800);
    return [topic, { status: answer.status, evidence: evidence.items, omittedEvidenceCount: evidence.omittedCount }];
  }));
  const facts = recentWholeItems(profile.facts, 8, 4000);
  const barriers = recentWholeItems(profile.barriers, 8, 4000);
  const preferences = recentWholeItems(profile.preferences, 8, 4000);
  const feedback = recentWholeItems(profile.feedback, 4, 2000);
  const summary = state.pendingSummary;
  const latest = profile.latestStrategy;
  return {
    onboardingStatus: profile.onboardingStatus,
    phase: state.phase,
    // Keep every goal's exact scope. A compact prompt cannot manufacture consent
    // by removing linked task IDs or changing an agreed goal's content.
    goals: profile.goals.map(goal => ({ id: goal.id, title: goal.title, motive: goal.motive,
      agreed: goal.agreed, taskIds: goal.taskIds, categoryIds: goal.categoryIds })),
    facts: facts.items,
    barriers: barriers.items,
    preferences: preferences.items,
    discovery: {
      version: state.version, phase: state.phase, topics, selectedGoalIds: state.selectedGoalIds,
      ...(state.pendingQuestion ? { pendingQuestion: state.pendingQuestion } : {}),
      ...(summary ? { pendingSummary: { id: summary.id, text: summary.text, goalIds: summary.goalIds, confirmed: summary.confirmed } } : {}),
    },
    feedback: feedback.items,
    ...(latest ? { latestStrategy: {
      updatedAt: latest.updatedAt,
      ...(typeof latest.narrative === 'string' && latest.narrative.length <= 4000 ? { narrative: latest.narrative } : {}),
      ...(typeof latest.nextAction === 'string' && latest.nextAction.length <= 2000 ? { nextAction: latest.nextAction } : {}),
      ...(latest.focusTaskId ? { focusTaskId: latest.focusTaskId } : {}),
    } } : {}),
    omittedMemoryCounts: { facts: facts.omittedCount, barriers: barriers.omittedCount,
      preferences: preferences.omittedCount, feedback: feedback.omittedCount },
    evidenceLimits: 'This is a bounded projection of complete local memory. Omitted observations remain stored; absence here does not contradict them. Topic status and readiness are app-derived from the full profile. Ask when needed; do not replace unknown context with assumptions or rewrite unchanged goals.',
  };
}

type PromptTask = Partial<PSTask> & { deletedAt?: number; deletionReason?: string };

/** Keep all target identities and current settings without duplicating sync/timer journals. */
export function compactTaskPromptContext(tasks: readonly PromptTask[], options: { detailTaskIds?: readonly string[] } = {}) {
  const detailed = new Set(options.detailTaskIds || []);
  return tasks.map(task => ({
    id: task.id, title: task.title, phase: task.phase, priority: task.priority,
    done: task.done === true,
    progress: { completedSteps: task.currentStep ?? 0, totalSteps: task.steps ?? 0 },
    ...(task.createdAt !== undefined ? { createdAt: task.createdAt } : {}),
    ...(task.updatedAt !== undefined ? { updatedAt: task.updatedAt } : {}),
    ...(task.startedAt !== undefined ? { startedAt: task.startedAt } : {}),
    ...(task.completedAt !== undefined ? { completedAt: task.completedAt } : {}),
    ...(task.plannedDate ? { plannedDate: task.plannedDate } : {}),
    ...(task.deadlineDate ? { deadlineDate: task.deadlineDate } : {}),
    ...(task.schedule ? { schedule: { startAt: task.schedule.startAt, timeZone: task.schedule.timeZone,
      recurrence: task.schedule.recurrence, leadMinutes: task.schedule.leadMinutes } } : {}),
    ...(task.scheduledPending ? { scheduledPending: true } : {}),
    ...(task.scheduledFor !== undefined ? { scheduledFor: task.scheduledFor } : {}),
    ...(task.scheduleNextStartAt ? { scheduleNextStartAt: task.scheduleNextStartAt } : {}),
    timerRunning: task.timerRunning === true,
    ...(task.timerStartedAt !== undefined ? { timerStartedAt: task.timerStartedAt } : {}),
    timerMode: task.timerMode ?? ((task.countdownDurationSeconds ?? 0) > 0 ? 'countdown' : 'stopwatch'),
    ...(task.countdownDurationSeconds !== undefined ? { countdownDurationSeconds: task.countdownDurationSeconds } : {}),
    ...(task.countdownRemainingSeconds !== undefined ? { countdownRemainingSeconds: task.countdownRemainingSeconds } : {}),
    ...(task.plannedDurationSeconds !== undefined ? { plannedDurationSeconds: task.plannedDurationSeconds } : {}),
    recordedWorkSeconds: recordedTaskSeconds(task),
    ...(task.deletedAt !== undefined ? { deletedAt: task.deletedAt, deletionReason: task.deletionReason } : {}),
    ...(detailed.has(task.id || '') ? {
      stepList: (Array.isArray(task.stepList) ? task.stepList : []).filter(step => step && typeof step === 'object' && typeof step.title === 'string').map(step => ({ id: step.id, title: step.title, done: step.done,
        ...(step.timeSpentSeconds !== undefined ? { timeSpentSeconds: step.timeSpentSeconds } : {}),
        ...(step.estimatedDurationSeconds !== undefined ? { estimatedDurationSeconds: step.estimatedDurationSeconds } : {}) })),
      ...(typeof task.note === 'string' && task.note.length <= 2000 ? { note: task.note } : {}),
      ...(typeof task.note === 'string' && task.note.length > 2000 ? { noteOmitted: true } : {}),
    } : {}),
  }));
}
