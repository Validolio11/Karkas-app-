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

/**
 * The stored priority is a bare 1|2|3 where 1 is the most urgent. Models misread the
 * number (3 as "high", 2 as "low"), so every task record carries its meaning as data;
 * the static system prompts stay byte-identical.
 */
export function priorityLabel(priority: unknown): 'high' | 'normal' | 'low' | undefined {
  return priority === 1 ? 'high' : priority === 2 ? 'normal' : priority === 3 ? 'low' : undefined;
}

/** Keep all target identities and current settings without duplicating sync/timer journals. */
export function compactTaskPromptContext(tasks: readonly PromptTask[], options: { detailTaskIds?: readonly string[] } = {}) {
  const detailed = new Set(options.detailTaskIds || []);
  return tasks.map(task => ({
    id: task.id, title: task.title, phase: task.phase, priority: task.priority,
    ...(priorityLabel(task.priority) ? { priorityLabel: priorityLabel(task.priority) } : {}),
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

/**
 * One shared persona for every Karkas model call. Keep it byte-identical: it
 * opens each systemInstruction, so it is part of the implicitly cached prefix.
 */
export const KARKAS_ASSISTANT_PERSONA = `ROLE AND STYLE:
You are the Karkas assistant inside the person's task workspace: warm, direct and concise, like a smart colleague.
- In Ukrainian write natural, modern literary Ukrainian in current orthography ("проєкт", not "проект"): no russianisms, surzhyk, bureaucratic or calqued phrasing, no odd word-for-word translations (not "зосередьтеся на цій ємності") and no "Шановний"; use Ukrainian professional terms (розкадровка, таймлайн, ключові кадри, композиція). Use "ти" only if the person writes with "ти", otherwise "ви"; never mix them in one reply. When the request context has an ADDRESS FORM line, follow it.
- Answer first, then give brief reasoning. No filler, canned praise or generic productivity lectures.
- Use markdown lists or short headings only when they help scanning; use **bold** only for key facts. Keep task titles and structured fields plain.
- Ask at most one clarifying question, and only when it is needed.
- Describe behaviour, not conditions: no medical or psychological diagnoses or labels (depression, ADHD/СДУГ, burnout, "симптом виснаження"). Suggest a professional only if the person mentions serious distress.
- Never claim that tasks, dates, timers or settings were changed, saved or applied unless the application confirmed it; an unapplied proposal changed nothing.`;

type TemporalPromptRecord = {
  id?: string;
  statuses?: string[];
  created?: { local: string } | null;
  lastEdited?: { local: string } | null;
  started?: { local: string } | null;
  completed?: { local: string } | null;
  archivedAt?: { local: string } | null;
  plannedDay?: unknown;
  deadlineDay?: unknown;
  scheduledStart?: { local: string; future: boolean } | null;
  nextOccurrence?: { local: string } | null;
  timerSessionStarted?: { local: string } | null;
  recentActivity?: unknown[];
  omittedActivityCount?: number;
};
const RAW_TIME_FIELDS = ['createdAt', 'updatedAt', 'startedAt', 'completedAt', 'plannedDate', 'deadlineDate', 'scheduledFor', 'scheduleNextStartAt', 'timerStartedAt', 'deletedAt'];

/**
 * A single task representation for chat: compact settings plus temporal fields
 * from the client-zone temporal context, instead of sending every task twice.
 * Raw epoch timestamps are replaced by client-local times; absent fields are unknown.
 * Recorded activity is attached only for tasks in detailed scope.
 */
export function mergeTemporalTaskContext(tasks: ReturnType<typeof compactTaskPromptContext>, temporalTasks: readonly TemporalPromptRecord[], options: { detailTaskIds?: readonly string[] } = {}) {
  const byId = new Map(temporalTasks.filter(task => task.id).map(task => [task.id!, task]));
  const detailed = new Set(options.detailTaskIds || []);
  return tasks.map(task => {
    const temporal = byId.get(task.id || '');
    // Without a temporal record (e.g. beyond its bound) keep the raw values rather than losing them.
    if (!temporal) return { ...task } as Record<string, unknown>;
    const merged: Record<string, unknown> = Object.fromEntries(Object.entries(task).filter(([key]) => !RAW_TIME_FIELDS.includes(key)));
    const local = (value: { local: string } | null | undefined) => value ? value.local : undefined;
    const fields: Record<string, unknown> = {
      statuses: temporal.statuses?.length ? temporal.statuses : undefined,
      created: local(temporal.created), lastEdited: local(temporal.lastEdited), started: local(temporal.started),
      completed: local(temporal.completed), archivedAt: local(temporal.archivedAt),
      plannedDay: temporal.plannedDay ?? undefined, deadlineDay: temporal.deadlineDay ?? undefined,
      scheduledStart: temporal.scheduledStart ? { local: temporal.scheduledStart.local, future: temporal.scheduledStart.future } : undefined,
      nextOccurrence: local(temporal.nextOccurrence), timerSessionStarted: local(temporal.timerSessionStarted),
      ...(detailed.has(task.id || '') && temporal.recentActivity ? { recentActivity: temporal.recentActivity, omittedActivityCount: temporal.omittedActivityCount } : {}),
    };
    for (const [key, value] of Object.entries(fields)) if (value !== undefined) merged[key] = value;
    return merged;
  });
}

type ChatTurn = { role: 'user' | 'model'; parts: { text: string }[] };

/**
 * The client's record of what happened to a proposal in an earlier assistant reply.
 * The reply text alone reads as if its changes were made, so the model gets the real status.
 */
export const PROPOSAL_STATUS_NOTES: Record<'applied' | 'partial' | 'not_applied', string> = {
  applied: '[App note: the person applied the proposal in the previous assistant reply.]',
  partial: '[App note: the proposal in the previous assistant reply was only PARTLY applied; some of its changes did not happen. WORKSPACE CONTEXT shows what is real.]',
  not_applied: '[App note: the proposal in the previous assistant reply was NOT applied; none of its changes happened.]',
};

/**
 * Gemini multi-turn contents: alternating roles that start with 'user' and end
 * with the current user turn. Consecutive same-role messages become one turn
 * with several parts; a leading model message gets a short user prefix so the
 * assistant's earlier question is not lost. History stays data (see system rules).
 * A reply that carried a proposal is followed by an app note in the user role with
 * its real status, so the model's own turns stay clean and are not imitated.
 */
export function chatHistoryContents(history: unknown, finalUserText: string): ChatTurn[] {
  const turns: ChatTurn[] = [];
  const push = (role: ChatTurn['role'], text: string) => {
    const last = turns[turns.length - 1];
    if (last?.role === role) last.parts.push({ text });
    else turns.push({ role, parts: [{ text }] });
  };
  for (const message of Array.isArray(history) ? history as any[] : []) {
    if (!message || typeof message !== 'object' || typeof message.content !== 'string' || !message.content.trim()) continue;
    const role = message.role === 'user' ? 'user' : message.role === 'assistant' || message.role === 'model' ? 'model' : undefined;
    if (!role) continue;
    push(role, message.content);
    const status = role === 'model' && ['applied', 'partial', 'not_applied'].includes(message.proposalStatus) ? message.proposalStatus as keyof typeof PROPOSAL_STATUS_NOTES : undefined;
    if (status) push('user', PROPOSAL_STATUS_NOTES[status]);
  }
  if (turns[0]?.role === 'model') turns.unshift({ role: 'user', parts: [{ text: '[Earlier conversation follows.]' }] });
  push('user', finalUserText);
  return turns;
}
