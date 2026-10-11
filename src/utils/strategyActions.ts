import type { PersonalStrategyProfile, PSTask, StrategyAction, StrategyActionRecord, TaskTab } from '../types';
import { normalizeTaskSchedule } from './taskScheduling';
import { strategyOwnerKey } from './personalStrategy';
import { isPersonalStrategyReady, normalizeStrategyDiscovery } from './strategyDiscovery';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter(key => (value as any)[key] !== undefined).map(key => `${JSON.stringify(key)}:${stable((value as any)[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const same = (a: unknown, b: unknown) => stable(a) === stable(b);
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
  const now = options.now ?? Date.now();
  for (const action of (Array.isArray(options.actions) ? options.actions : []).slice(0, 20)) {
    const fail = (reason: string) => rejected.push({ id: action?.id || '', reason });
    const id = `${turnId}:${action?.id}`;
    if (updated.actionHistory.some(entry => entry.id === id)) continue;
    if (!action || typeof action.id !== 'string' || !action.id.trim() || typeof action.reason !== 'string' || !action.reason.trim() || !['create', 'update'].includes(action.type)) { fail('Invalid action'); continue; }
    const goal = updated.goals.find(item => item.id === action.goalId && item.agreed && normalizeStrategyDiscovery(updated).selectedGoalIds.includes(item.id));
    if (!goal) { fail('Goal is not agreed'); continue; }
    const changes = action.changes;
    if (!changes || typeof changes !== 'object' || Object.keys(changes).some(key => !['title', 'phase', 'priority', 'note', 'schedule', 'stepTitles'].includes(key))) { fail('Forbidden task field'); continue; }
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
    const { stepTitles, schedule: ignoredSchedule, ...fields } = changes;
    after = { ...after, ...fields };
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
  return { tasks: journal.before ? tasks.map(task => task.id === journal.taskId ? clone(journal.before!) : task) : tasks.filter(task => task.id !== journal.taskId),
    profile: { ...profile, actionHistory: profile.actionHistory.map(item => item.id === actionId ? { ...item, undoneAt: options.now ?? Date.now() } : item),
      goals: journal.before ? profile.goals : profile.goals.map(goal => ({ ...goal, taskIds: goal.taskIds.filter(id => id !== journal.taskId) })) }, undone: true };
}
