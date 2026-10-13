import type { PersonalStrategyProfile, PSTask, StrategyDiscoveryTopicState, StrategyGoal } from '../types';
import { taskDateEnd } from '../utils/taskDates';
import { recordedTaskSeconds } from '../utils/taskTimeStats';
import { isPersonalStrategyReady, normalizeStrategyDiscovery, STRATEGY_DISCOVERY_TOPICS } from '../utils/strategyDiscovery';

/** Why a task is proposed as the next step; shown as a small badge. */
export type NextStepReason = 'focus' | 'running' | 'inProgress' | 'pinned' | 'deadline' | 'priority';
export interface NextStepCandidate { task: PSTask; reason: NextStepReason }

const DAY = 24 * 60 * 60 * 1000;
const isActive = (task: PSTask) => !task.done && !task.scheduledPending;
const deadlineEnd = (task: PSTask) => task.deadlineDate ? taskDateEnd(task.deadlineDate) : null;
const isStarted = (task: PSTask) => Number.isFinite(task.startedAt) || (task.timeSpentSeconds || 0) > 0;

/**
 * Active tasks ordered for «Наступний крок»: the strategy focus task, a running timer,
 * then pinned, already started, overdue, priority, nearest deadline and oldest.
 */
export function rankNextStepCandidates(tasks: readonly PSTask[], focusTaskId?: string, now = Date.now()): NextStepCandidate[] {
  const active = tasks.filter(isActive);
  const focus = focusTaskId ? active.find(task => task.id === focusTaskId || task.schedulePlanId === focusTaskId) : undefined;
  const overdue = (task: PSTask) => { const end = deadlineEnd(task); return end !== null && end < now; };
  const rest = active.filter(task => task !== focus).sort((a, b) => {
    if (!!a.timerRunning !== !!b.timerRunning) return a.timerRunning ? -1 : 1;
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (isStarted(a) !== isStarted(b)) return isStarted(a) ? -1 : 1;
    if (overdue(a) !== overdue(b)) return overdue(a) ? -1 : 1;
    if (a.priority !== b.priority) return a.priority - b.priority;
    const endA = deadlineEnd(a) ?? Infinity, endB = deadlineEnd(b) ?? Infinity;
    if (endA !== endB) return endA - endB;
    return a.createdAt - b.createdAt;
  });
  const reason = (task: PSTask): NextStepReason => {
    if (task.timerRunning) return 'running';
    if (task.pinned) return 'pinned';
    if (isStarted(task)) return 'inProgress';
    const end = deadlineEnd(task);
    if (end !== null && end - now <= 2 * DAY) return 'deadline';
    return 'priority';
  };
  return [...(focus ? [{ task: focus, reason: 'focus' as const }] : []), ...rest.map(task => ({ task, reason: reason(task) }))];
}

export interface TaskStepProgress { total: number; done: number; nextIndex: number; nextTitle?: string; percent: number }

/** Subtask progress; nextIndex is the first unfinished step or -1. Legacy counters have no titles. */
export function taskStepProgress(task: Pick<PSTask, 'steps' | 'currentStep' | 'stepList'>): TaskStepProgress {
  if (task.stepList?.length) {
    const total = task.stepList.length;
    const done = task.stepList.filter(step => step.done).length;
    const nextIndex = task.stepList.findIndex(step => !step.done);
    return { total, done, nextIndex, nextTitle: nextIndex >= 0 ? task.stepList[nextIndex].title : undefined, percent: Math.round(done / total * 100) };
  }
  const total = Number.isFinite(task.steps) ? Math.max(0, Math.floor(task.steps)) : 0;
  const done = Math.min(total, Number.isFinite(task.currentStep) ? Math.max(0, Math.floor(task.currentStep)) : 0);
  return { total, done, nextIndex: done < total ? done : -1, percent: total ? Math.round(done / total * 100) : 0 };
}

export interface GoalTaskStats { active: PSTask[]; done: number; total: number; percent: number }

/** Tasks linked to a goal directly or through one of its categories. */
export function goalTaskStats(goal: Pick<StrategyGoal, 'taskIds' | 'categoryIds'>, tasks: readonly PSTask[]): GoalTaskStats {
  const ids = new Set(goal.taskIds), categories = new Set(goal.categoryIds);
  const linked = tasks.filter(task => !task.scheduledPending && (ids.has(task.id) || categories.has(task.phase)));
  const done = linked.filter(task => task.done).length;
  return { active: linked.filter(task => !task.done), done, total: linked.length, percent: linked.length ? Math.round(done / linked.length * 100) : 0 };
}

export interface PeriodAuditStats { completed: number; active: number; overdue: number; trackedSeconds: number | null; completionPercent: number }

export function periodAuditStats(selected: { activeInPeriod: PSTask[]; completedInPeriod: PSTask[]; deletedCompleted: PSTask[] }, now = Date.now()): PeriodAuditStats {
  const completedTasks = [...selected.completedInPeriod, ...selected.deletedCompleted];
  const completed = completedTasks.length, active = selected.activeInPeriod.length;
  const overdue = selected.activeInPeriod.filter(task => { const end = deadlineEnd(task); return end !== null && end < now; }).length;
  const readings = [...completedTasks, ...selected.activeInPeriod].map(recordedTaskSeconds).filter((value): value is number => value !== null);
  return { completed, active, overdue, trackedSeconds: readings.length ? readings.reduce((sum, value) => sum + value, 0) : null,
    completionPercent: completed + active ? Math.round(completed / (completed + active) * 100) : 0 };
}

export type DiscoveryTopicStatus = StrategyDiscoveryTopicState['status'];
/** Interview topics as the app trusts them: a status without the person's own quote counts as unknown. */
export function discoveryProgress(profile: PersonalStrategyProfile): { statuses: DiscoveryTopicStatus[]; answered: number; total: number } {
  const topics = normalizeStrategyDiscovery(profile).topics;
  const statuses = STRATEGY_DISCOVERY_TOPICS.map(topic => topics[topic].status);
  return { statuses, answered: statuses.filter(status => status !== 'unknown').length, total: statuses.length };
}

/** One discovery button: continue only an unfinished interview that is still open in the chat. */
export function discoveryCta(profile: PersonalStrategyProfile, interviewModeActive: boolean): 'continue' | 'deepen' {
  return interviewModeActive && !isPersonalStrategyReady(profile) ? 'continue' : 'deepen';
}

/** No strategy and no goals yet: the page shows a single onboarding card instead of empty sections. */
export const needsStrategyOnboarding = (profile: Pick<PersonalStrategyProfile, 'latestStrategy' | 'goals'>) =>
  !profile.latestStrategy?.narrative && !profile.goals.length;

export function memoryEntryCount(profile: PersonalStrategyProfile): number {
  const answers = STRATEGY_DISCOVERY_TOPICS.filter(topic => profile.discovery?.topics?.[topic]?.evidence?.length).length;
  return answers + profile.facts.length + profile.barriers.length + profile.preferences.length;
}
