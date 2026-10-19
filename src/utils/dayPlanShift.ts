import type { PSTask } from '../types';
import type { AgentWorkspace } from './aiAgentActions';
import { calendarDateKey, isTimedForToday, taskScheduledEnd } from './schedulePresentation';
import { getTaskTotalSeconds } from './taskTimer';

export interface DayPlanDelay {
  minutes: number;
  currentTask?: PSTask;
  tasks: PSTask[];
  fromTime?: number;
}
export interface DayPlanShiftResult {
  workspace: AgentWorkspace;
  shiftedTaskIds: string[];
  overflowTaskIds: string[];
}

const validInstant = (at: number): boolean => Number.isFinite(at) && Math.abs(at) <= 8.64e15;
const hasExpiry = (task: PSTask): boolean => typeof task.countdownExpiredAt === 'number' && validInstant(task.countdownExpiredAt);
const notStarted = (task: PSTask, now: number): boolean => !task.timerRunning && !hasExpiry(task) &&
  !Number.isFinite(task.startedAt) && getTaskTotalSeconds(task, now) === 0 && !task.currentStep && !task.stepList?.some(step => step.done);
const pendingBlocks = (tasks: PSTask[], fromTime: number, now: number, timeZone: string): PSTask[] => tasks
  .filter(task => !task.scheduledPending && isTimedForToday(task, now, timeZone) && task.scheduledFor! >= fromTime && notStarted(task, now))
  .sort((a, b) => a.scheduledFor! - b.scheduledFor!);

export function planDelay(tasks: PSTask[], now: number, timeZone: string): DayPlanDelay {
  if (!validInstant(now)) return { minutes: 0, tasks: [] };
  const currentTask = tasks.filter(task => !task.scheduledPending && isTimedForToday(task, now, timeZone) &&
    (task.timerRunning || hasExpiry(task)) && (taskScheduledEnd(task) ?? Infinity) < now)
    .sort((a, b) => b.scheduledFor! - a.scheduledFor!)[0];
  if (!currentTask) return { minutes: 0, tasks: [] };
  return { currentTask, minutes: Math.ceil((now - taskScheduledEnd(currentTask)!) / 300000) * 5,
    fromTime: currentTask.scheduledFor, tasks: pendingBlocks(tasks, currentTask.scheduledFor!, now, timeZone)
      .filter(task => task.scheduledFor! > currentTask.scheduledFor!) };
}

/** Move only unstarted blocks on this calendar day; a block past midnight stays for a manual decision. */
export function shiftDay(workspace: AgentWorkspace, minutes: number, fromTime: number | undefined, now: number, timeZone: string): DayPlanShiftResult {
  const unchanged = { workspace, shiftedTaskIds: [], overflowTaskIds: [] };
  if (!validInstant(now) || !Number.isFinite(minutes) || minutes <= 0 || minutes > 1440 || !Number.isSafeInteger(minutes * 60)) return unchanged;
  const delay = fromTime === undefined ? planDelay(workspace.tasks, now, timeZone) : undefined;
  const boundary = fromTime ?? (delay?.fromTime === undefined ? now : delay.fromTime + 1);
  if (!validInstant(boundary)) return unchanged;
  const today = calendarDateKey(now, timeZone);
  const shiftedTaskIds: string[] = [], overflowTaskIds: string[] = [];
  const starts = new Map<string, number>();
  let retainedStart = Infinity;
  for (const task of pendingBlocks(workspace.tasks, boundary, now, timeZone).reverse()) {
    const start = task.scheduledFor! + minutes * 60000;
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
    { ...task, scheduledFor: starts.get(task.id), updatedAt: now } : task) } : workspace, shiftedTaskIds, overflowTaskIds };
}
