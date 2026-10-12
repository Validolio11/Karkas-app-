import type { PersonalStrategyProfile, PSTask, StrategyAction, StrategyActionRecord, TaskTab } from '../types';
import { normalizeTaskSchedule } from './taskScheduling';
import { isTaskDate } from './taskDates';
import { strategyOwnerKey } from './personalStrategy';
import { isPersonalStrategyReady, normalizeStrategyDiscovery } from './strategyDiscovery';
import { canonical } from './canonical';
import { MAX_AUTONOMOUS_STRATEGY_ACTIONS } from './strategyLimits';
import { annotateTaskChanges } from './taskActivity';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
export interface ApplyStrategyOptions {
  tasks: PSTask[]; profile: PersonalStrategyProfile; actions: StrategyAction[];
  ownerId: string | null; currentOwnerId: string | null; turnId: string; tabs: TaskTab[]; now?: number;
}
export function applyStrategyActions(options: ApplyStrategyOptions) {
  const { profile, ownerId, currentOwnerId, turnId, tabs } = options;
  let tasks = options.tasks;
  let updated = profile;
  const applied: StrategyActionRecord[] = [];
  const rejected: { id: string; reason: string }[] = [];
  if (ownerId !== currentOwnerId || !turnId) return { tasks, profile, applied, rejected: [{ id: turnId, reason: 'Account changed or turn is missing' }] };
  if (!isPersonalStrategyReady(profile)) return { tasks, profile, applied, rejected: [{ id: turnId, reason: 'Personal discovery is not confirmed' }] };
  if (profile.processedTurnIds.includes(turnId)) return { tasks, profile, applied, rejected };
  if (!Array.isArray(options.actions) || options.actions.length > MAX_AUTONOMOUS_STRATEGY_ACTIONS) {
    return { tasks, profile, applied, rejected: [{ id: turnId, reason: 'Autonomous action limit exceeded or invalid action list' }] };
  }
  const now = options.now ?? Date.now();
  for (const action of options.actions) {
    const fail = (reason: string) => rejected.push({ id: action?.id || '', reason });
    const id = `${turnId}:${action?.id}`;
    if (updated.actionHistory.some(entry => entry.id === id)) continue;
    if (!action || typeof action.id !== 'string' || !action.id.trim() || typeof action.reason !== 'string' || !action.reason.trim() || !['create', 'update'].includes(action.type)) { fail('Invalid action'); continue; }
    const goal = updated.goals.find(item => item.id === action.goalId && item.agreed && normalizeStrategyDiscovery(updated).selectedGoalIds.includes(item.id));
    if (!goal) { fail('Goal is not agreed'); continue; }
    const changes = action.changes;
    if (!changes || typeof changes !== 'object' || Object.keys(changes).some(key => !['title', 'phase', 'priority', 'note', 'schedule', 'stepTitles', 'plannedDate', 'deadlineDate'].includes(key))) { fail('Forbidden task field'); continue; }
    if (['plannedDate', 'deadlineDate'].some(key => { const value = changes[key as 'plannedDate' | 'deadlineDate']; return value !== undefined && value !== null && !isTaskDate(value); })) { fail('Invalid task date'); continue; }
    if (changes.title !== undefined && (typeof changes.title !== 'string' || !changes.title.trim()) || changes.note !== undefined && typeof changes.note !== 'string' || changes.priority !== undefined && ![1, 2, 3].includes(changes.priority)) { fail('Invalid task fields'); continue; }
    if (changes.phase !== undefined && (!tabs.some(tab => tab.id === changes.phase) || !goal.categoryIds.includes(changes.phase))) { fail('Category is outside agreed goal'); continue; }
    if (changes.stepTitles !== undefined && (!Array.isArray(changes.stepTitles) || changes.stepTitles.length > 50 || changes.stepTitles.some(title => typeof title !== 'string' || !title.trim()))) { fail('Invalid steps'); continue; }
    const schedule = changes.schedule === undefined ? undefined : normalizeTaskSchedule(changes.schedule);
    if (schedule === null) { fail('Invalid schedule'); continue; }
    let before: PSTask | null = null;
    let after: PSTask;
    const taskId = action.type === 'create' ? `strategy:${id}` : action.taskId || '';
    if (action.type === 'create') {
      if (tasks.some(task => task.id === taskId)) continue;
      const phase = changes.phase || goal.categoryIds.find(id => tabs.some(tab => tab.id === id));
      if (!phase || !changes.title?.trim()) { fail('Creation needs title and agreed category'); continue; }
      // Reuse existing work rather than inflate the queue after every refusal.
      if (tasks.some(task => !task.done && task.phase === phase && task.title.trim().toLocaleLowerCase() === changes.title!.trim().toLocaleLowerCase())) { fail('Task already exists'); continue; }
      after = { id: taskId, title: changes.title.trim(), phase, priority: changes.priority || 2, note: changes.note,
        steps: 0, currentStep: 0, done: false, pinned: false, createdAt: now };
    } else {
      const existing = tasks.find(task => task.id === taskId);
      if (!existing || existing.done || !(goal.taskIds.includes(taskId) || existing.schedulePlanId && goal.taskIds.includes(existing.schedulePlanId))) { fail('Task is outside agreed goal'); continue; }
      if (!action.expectedTask || !same(existing, action.expectedTask)) { fail('Task changed since analysis'); continue; }
      before = clone(existing);
      after = { ...existing };
    }
    const { stepTitles, schedule: ignoredSchedule, plannedDate, deadlineDate, ...fields } = changes;
    after = { ...after, ...fields };
    for (const [key, value] of [['plannedDate', plannedDate], ['deadlineDate', deadlineDate]] as const) {
      if (value === null) delete after[key];
      else if (value !== undefined) after[key] = value;
    }
    if (after.plannedDate && after.deadlineDate && after.plannedDate > after.deadlineDate) { fail('Planned date is after deadline'); continue; }
    if (stepTitles) {
      const completed = after.stepList?.filter(step => step.done || (step.timeSpentSeconds ?? 0) > 0 || step.id === after.timerStepId) || [];
      if (after.currentStep > 0 && !after.stepList?.length) { fail('Legacy step progress must be preserved'); continue; }
      const reusedIds = new Set(completed.map(step => step.id));
      const remaining = stepTitles.map(title => title.trim()).filter(title => !completed.some(step => step.title === title)).map((title, index) => {
        const unchanged = after.stepList?.find(step => !reusedIds.has(step.id) && step.title.trim() === title);
        if (unchanged) { reusedIds.add(unchanged.id); return { ...unchanged }; }
        return { id: `strategy-step:${id}:${index}`, title, done: false };
      });
      after.stepList = [...completed, ...remaining];
      after.steps = after.stepList.length;
      after.currentStep = after.stepList.filter(step => step.done).length;
    }
    if (schedule) {
      if (after.timerRunning) { fail('Cannot reschedule a running timer'); continue; }
      if (before && !before.scheduledPending && schedule.recurrence === 'daily') { fail('Recurring work needs a separate new template'); continue; }
      after.schedule = schedule;
      if (before && !before.scheduledPending) {
        // Moving existing work must retain its identity, recorded time and completed steps.
        after.scheduledPending = false;
        after.scheduledFor = Date.parse(schedule.startAt);
      } else {
        after.scheduledPending = true;
        after.scheduleNextStartAt = schedule.startAt;
        after.scheduledFor = undefined;
      }
    }
    if (before && same(before, after)) continue;
    // The action journal and the paired transaction must store the same fully
    // annotated snapshot; stamping metadata later would make safe undo fail.
    after = annotateTaskChanges(before ? [before] : [], [after], now)[0];
    const journal: StrategyActionRecord = { id, turnId, ownerId: strategyOwnerKey(ownerId), goalId: goal.id,
      reason: action.reason.trim(), taskId, before, after: clone(after), appliedAt: now };
    tasks = before ? tasks.map(task => task.id === taskId ? after : task) : [...tasks, after];
    applied.push(journal);
    updated = { ...updated, goals: updated.goals.map(item => item.id === goal.id ? { ...item, taskIds: [...new Set([...item.taskIds, taskId])] } : item), actionHistory: [...updated.actionHistory, journal] };
  }
  updated = { ...updated, processedTurnIds: [...new Set([...updated.processedTurnIds, turnId])] };
  return { tasks, profile: updated, applied, rejected };
}
export function undoStrategyAction(options: { tasks: PSTask[]; profile: PersonalStrategyProfile; actionId: string; ownerId: string | null; currentOwnerId: string | null; now?: number }) {
  const { tasks, profile, actionId, ownerId, currentOwnerId } = options;
  const journal = profile.actionHistory.find(item => item.id === actionId);
  const current = journal && tasks.find(task => task.id === journal.taskId);
  if (ownerId !== currentOwnerId || !journal || journal.ownerId !== strategyOwnerKey(ownerId) || journal.undoneAt || !current || !same(current, journal.after)) {
    return { tasks, profile, undone: false, reason: 'Task changed after the strategy action or account differs' };
  }
  const now = options.now ?? Date.now();
  const restored = journal.before ? {
    ...clone(journal.before), updatedAt: current.updatedAt, activityTrail: clone(current.activityTrail ?? []),
  } : null;
  const nextTasks = restored ? annotateTaskChanges(tasks, tasks.map(task => task.id === journal.taskId ? restored : task), now)
    : tasks.filter(task => task.id !== journal.taskId);
  const restoredSnapshot = restored && nextTasks.find(task => task.id === journal.taskId);
  const journalIndex = profile.actionHistory.indexOf(journal);
  let previousActionIndex = -1;
  if (restoredSnapshot && journal.before) {
    // Only a confirmed undo returning to an exact previous action snapshot may
    // rebase its audit metadata. Other edits still fail the full equality check.
    for (let index = journalIndex - 1; index >= 0; index--) {
      const previousAction = profile.actionHistory[index];
      if (!previousAction.undoneAt && previousAction.taskId === journal.taskId && previousAction.ownerId === journal.ownerId
        && same(previousAction.after, journal.before)) { previousActionIndex = index; break; }
    }
  }
  return { tasks: nextTasks,
    profile: { ...profile, actionHistory: profile.actionHistory.map((item, index) => item.id === actionId ? { ...item, undoneAt: now }
      : index === previousActionIndex && restoredSnapshot ? { ...item, after: clone(restoredSnapshot) } : item),
      goals: journal.before ? profile.goals : profile.goals.map(goal => ({ ...goal, taskIds: goal.taskIds.filter(id => id !== journal.taskId) })) }, undone: true };
}
