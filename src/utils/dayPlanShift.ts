import type { PSTask } from '../types';
import type { AgentWorkspace } from './aiAgentActions';
import { calendarDateKey, isTimedForToday, taskScheduledEnd } from './schedulePresentation';
import { getTaskRemainingSeconds, getTaskTotalSeconds } from './taskTimer';

export interface DayPlanDelay {
  minutes: number;
  currentTask?: PSTask;
  tasks: PSTask[];
  fromTime?: number;
  missedTasks?: PSTask[];
}
export interface DayPlanShiftResult {
  workspace: AgentWorkspace;
  shiftedTaskIds: string[];
  overflowTaskIds: string[];
}
export interface MissedBlock { since: number; start: number; end?: number; paused: boolean; }
export interface DayPlanReplanResult extends DayPlanShiftResult { overflow: PSTask[]; }

const validInstant = (at: number): boolean => Number.isFinite(at) && Math.abs(at) <= 8.64e15;
const hasExpiry = (task: PSTask): boolean => typeof task.countdownExpiredAt === 'number' && validInstant(task.countdownExpiredAt);
const notStarted = (task: PSTask, now: number): boolean => !task.timerRunning && !hasExpiry(task) &&
  !Number.isFinite(task.startedAt) && getTaskTotalSeconds(task, now) === 0 && !task.currentStep && !task.stepList?.some(step => step.done);
const pendingBlocks = (tasks: PSTask[], now: number, timeZone: string): PSTask[] => tasks
  .filter(task => !task.scheduledPending && !task.timerRunning && isTimedForToday(task, now, timeZone))
  .sort((a, b) => a.scheduledFor! - b.scheduledFor!);

/** An unstarted block is missed after its start; a paused block only after its end. */
export function missedBlock(task: PSTask, now: number, timeZone: string): MissedBlock | undefined {
  const start = task.scheduledFor;
  if (!validInstant(now) || task.done || task.scheduledPending || task.timerRunning || typeof start !== 'number' || !validInstant(start)) return undefined;
  if (calendarDateKey(start, timeZone) > calendarDateKey(now, timeZone)) return undefined;
  const paused = !notStarted(task, now), end = taskScheduledEnd(task);
  const since = paused ? end : start;
  return since !== undefined && validInstant(since) && since < now ? { since, start, end, paused } : undefined;
}

export function planDelay(tasks: PSTask[], now: number, timeZone: string): DayPlanDelay {
  if (!validInstant(now)) return { minutes: 0, tasks: [] };
  const today = tasks.filter(task => !task.scheduledPending && isTimedForToday(task, now, timeZone));
  const missedTasks = today.filter(task => missedBlock(task, now, timeZone));
  const overdue = today.flatMap(task => {
    const missed = missedBlock(task, now, timeZone);
    const since = missed?.since ?? ((task.timerRunning || hasExpiry(task)) ? taskScheduledEnd(task) : undefined);
    return since !== undefined && since < now ? [{ task, since }] : [];
  }).sort((a, b) => a.since - b.since);
  if (!overdue.length) return { minutes: 0, tasks: [] };
  const currentTask = overdue.find(item => item.task.timerRunning)?.task ?? overdue[0].task;
  const minutes = Math.ceil((now - overdue[0].since) / 300000) * 5;
  return { currentTask, minutes, missedTasks, fromTime: Math.min(...overdue.map(item => item.task.scheduledFor!)),
    tasks: pendingBlocks(tasks, now, timeZone).filter(task => task.scheduledFor! + minutes * 60000 >= now) };
}

/** Shift unfinished blocks, including paused/missed ones that can land at or after now. */
export function shiftDay(workspace: AgentWorkspace, minutes: number, fromTime: number | undefined, now: number, timeZone: string): DayPlanShiftResult {
  const unchanged = { workspace, shiftedTaskIds: [], overflowTaskIds: [] };
  if (!validInstant(now) || !Number.isFinite(minutes) || minutes <= 0 || minutes > 1440 || !Number.isSafeInteger(minutes * 60) ||
    (fromTime !== undefined && !validInstant(fromTime))) return unchanged;
  const today = calendarDateKey(now, timeZone);
  const shiftedTaskIds: string[] = [], overflowTaskIds: string[] = [];
  const starts = new Map<string, number>();
  let retainedStart = Infinity;
  for (const task of pendingBlocks(workspace.tasks, now, timeZone).filter(task => fromTime === undefined || task.scheduledFor! >= fromTime).reverse()) {
    const start = task.scheduledFor! + minutes * 60000;
    if (start < now) continue;
    const end = taskScheduledEnd(task);
    const shiftedEnd = end === undefined ? start : end + minutes * 60000;
    // Midnight fits; retained overflow blocks must not be overtaken by preceding ones.
    if (!validInstant(start) || !validInstant(shiftedEnd) || calendarDateKey(start, timeZone) !== today ||
      calendarDateKey(Math.max(start, shiftedEnd - 1), timeZone) !== today || shiftedEnd > retainedStart) {
      overflowTaskIds.push(task.id); retainedStart = Math.min(retainedStart, task.scheduledFor!); continue;
    }
    starts.set(task.id, start);
    shiftedTaskIds.push(task.id);
  }
  shiftedTaskIds.reverse(); overflowTaskIds.reverse();
  return { workspace: starts.size ? { ...workspace, tasks: workspace.tasks.map(task => starts.has(task.id) ?
    { ...task, scheduledFor: starts.get(task.id), plannedDate: today, updatedAt: now } : task) } : workspace, shiftedTaskIds, overflowTaskIds };
}

/** Pack remaining work from now, preserving all timer/work state and leaving overflow for a decision. */
export function replanRestOfDay(workspace: AgentWorkspace, now: number, timeZone: string,
  { from, order }: { from?: number; order?: string[] } = {}): DayPlanReplanResult {
  const unchanged = { workspace, shiftedTaskIds: [], overflowTaskIds: [], overflow: [] };
  if (!validInstant(now) || (from !== undefined && !validInstant(from))) return unchanged;
  const today = calendarDateKey(now, timeZone);
  let cursor = from ?? now;
  for (const task of workspace.tasks) {
    if (task.done || task.scheduledPending || !task.timerRunning) continue;
    cursor = Math.max(cursor, now, taskScheduledEnd(task) ?? now);
  }
  cursor = Math.ceil(cursor / 300000) * 300000;
  const blocks = pendingBlocks(workspace.tasks, now, timeZone);
  if (order?.length) {
    const indices = new Map(order.map((id, index) => [id, index]));
    blocks.sort((a, b) => (indices.get(a.id) ?? Infinity) - (indices.get(b.id) ?? Infinity) || a.scheduledFor! - b.scheduledFor!);
  }
  const shiftedTaskIds: string[] = [], overflowTaskIds: string[] = [], overflow: PSTask[] = [];
  const updates = new Map<string, { scheduledFor: number; scheduledDurationSeconds: number }>();
  let full = false;
  for (const task of blocks) {
    const configured = task.scheduledDurationSeconds ?? task.countdownDurationSeconds;
    const remaining = getTaskRemainingSeconds(task, now);
    const seconds = notStarted(task, now) ? configured : Math.max(300, remaining ?? configured ?? 300);
    const duration = typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 300;
    const end = cursor + duration * 1000;
    if (full || !validInstant(cursor) || !validInstant(end) || calendarDateKey(cursor, timeZone) !== today || calendarDateKey(end - 1, timeZone) !== today) {
      full = true; overflowTaskIds.push(task.id); overflow.push(task); continue;
    }
    updates.set(task.id, { scheduledFor: cursor, scheduledDurationSeconds: duration });
    shiftedTaskIds.push(task.id);
    cursor = end;
  }
  return { workspace: updates.size ? { ...workspace, tasks: workspace.tasks.map(task => updates.has(task.id) ?
    { ...task, ...updates.get(task.id), plannedDate: today, updatedAt: now } : task) } : workspace, shiftedTaskIds, overflowTaskIds, overflow };
}
