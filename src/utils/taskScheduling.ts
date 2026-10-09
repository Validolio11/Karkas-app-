import type { NewTaskInput, PSTask } from '../types';

export interface TaskSchedule {
  startAt: string;
  recurrence: 'once' | 'daily';
  timeZone: string;
  leadMinutes: number;
}

export interface ScheduledTaskPlan {
  id: string;
  task: NewTaskInput;
  schedule: TaskSchedule;
  nextStartAt: string;
}

type WallTime = { year: number; month: number; day: number; hour: number; minute: number; second: number };
const DAY = 86400000;
const formatters = new Map<string, Intl.DateTimeFormat>();
function wallTime(at: number, zone: string): WallTime {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    formatters.set(zone, formatter);
  }
  const parts = formatter.formatToParts(at);
  return Object.fromEntries(parts.filter(p => ['year', 'month', 'day', 'hour', 'minute', 'second'].includes(p.type)).map(p => [p.type, Number(p.value)])) as WallTime;
}
function wallStamp(w: WallTime): number { return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second); }
function moveDay(w: WallTime, amount: number): WallTime {
  const d = new Date(Date.UTC(w.year, w.month - 1, w.day + amount));
  return { ...w, year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

// Offset candidates on either side of a transition preserve the local daily hour.
// A repeated hour uses its first occurrence; a missing hour shifts forward by the gap.
function resolveWall(w: WallTime, zone: string): number {
  const target = wallStamp(w);
  const offsets = new Set<number>();
  for (const delta of [-2 * DAY, -DAY, 0, DAY, 2 * DAY]) {
    const probe = target + delta;
    offsets.add(wallStamp(wallTime(probe, zone)) - probe);
  }
  const candidates = [...offsets].map(offset => target - offset).sort((a, b) => a - b);
  const exact = candidates.find(candidate => wallStamp(wallTime(candidate, zone)) === target);
  if (exact !== undefined) return exact;
  const after = candidates.filter(candidate => wallStamp(wallTime(candidate, zone)) > target);
  return after.sort((a, b) => wallStamp(wallTime(a, zone)) - wallStamp(wallTime(b, zone)))[0] ?? candidates[0];
}

export function normalizeTaskSchedule(input: unknown): TaskSchedule | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Record<string, unknown>;
  if (typeof value.startAt !== 'string' || !Number.isFinite(Date.parse(value.startAt))) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value.startAt);
  if (!iso) return null;
  const [, year, month, day, hour, minute, second, offset] = iso;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (Number(year) < 2000 || Number(year) > 2100 || date.getUTCFullYear() !== Number(year) || date.getUTCMonth() + 1 !== Number(month) || date.getUTCDate() !== Number(day) || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null;
  if (offset !== 'Z' && (Number(offset.slice(1, 3)) > 14 || Number(offset.slice(4)) > 59 || (Number(offset.slice(1, 3)) === 14 && Number(offset.slice(4)) !== 0))) return null;
  if (value.recurrence !== 'once' && value.recurrence !== 'daily') return null;
  if (Object.keys(value).some(key => !['startAt', 'recurrence', 'timeZone', 'leadMinutes'].includes(key))) return null;
  if (typeof value.timeZone !== 'string' || value.timeZone.length > 100) return null;
  try { wallTime(Date.parse(value.startAt), value.timeZone); } catch { return null; }
  const leadMinutes = value.leadMinutes === undefined ? 5 : value.leadMinutes;
  if (typeof leadMinutes !== 'number' || !Number.isInteger(leadMinutes) || leadMinutes < 0 || leadMinutes > 1440) return null;
  return { startAt: value.startAt, recurrence: value.recurrence, timeZone: value.timeZone, leadMinutes };
}

export function createScheduledTaskPlan(id: string, task: NewTaskInput, schedule: TaskSchedule): ScheduledTaskPlan {
  const valid = normalizeTaskSchedule(schedule);
  if (!valid) throw new Error('Invalid task schedule');
  return { id, task: { ...task }, schedule: valid, nextStartAt: new Date(valid.startAt).toISOString() };
}

export function getDueScheduledOccurrences(plans: ScheduledTaskPlan[], now = Date.now(), existingTaskIds: Iterable<string> = []) {
  const tasks: PSTask[] = [];
  const remainingPlans: ScheduledTaskPlan[] = [];
  const notifications: { taskId: string; title: string; scheduledFor: number; planId: string }[] = [];
  const known = new Set(existingTaskIds);
  for (const plan of plans) {
    const schedule = normalizeTaskSchedule(plan.schedule);
    const next = Date.parse(plan.nextStartAt);
    if (!schedule || !Number.isFinite(next) || !Number.isFinite(now)) { remainingPlans.push(plan); continue; }
    const lead = schedule.leadMinutes * 60000;
    if (next - lead > now) { remainingPlans.push(plan); continue; }
    let occurrence = next;
    if (schedule.recurrence === 'daily') {
      const anchor = wallTime(Date.parse(schedule.startAt), schedule.timeZone);
      const today = wallTime(now + lead, schedule.timeZone);
      let day = { ...today, hour: anchor.hour, minute: anchor.minute, second: anchor.second };
      occurrence = resolveWall(day, schedule.timeZone);
      if (occurrence - lead > now) { day = moveDay(day, -1); occurrence = resolveWall(day, schedule.timeZone); }
      occurrence = Math.max(next, occurrence);
      // Only the latest missed occurrence is created after an offline interval.
      let futureDay = moveDay(day, 1);
      let future = resolveWall(futureDay, schedule.timeZone);
      while (future - lead <= now || future <= occurrence) {
        futureDay = moveDay(futureDay, 1);
        future = resolveWall(futureDay, schedule.timeZone);
      }
      remainingPlans.push({ ...plan, schedule, nextStartAt: new Date(future).toISOString() });
    }
    const id = `schedule-${plan.id}-${occurrence}`;
    if (known.has(id)) continue;
    known.add(id);
    const task = {
      ...plan.task, stepList: plan.task.stepList?.map(step => { const fresh = { ...step, done: false }; delete fresh.timeSpentSeconds; return fresh; }), id, done: false, pinned: false, currentStep: 0, createdAt: now,
      timerRunning: false, timeSpentSeconds: 0,
      timerStartedAt: undefined, timerStepId: undefined,
      ...(plan.task.timerMode === 'countdown' && plan.task.countdownDurationSeconds ? { plannedDurationSeconds: plan.task.plannedDurationSeconds ?? plan.task.countdownDurationSeconds } : {}),
      ...(plan.task.timerMode === 'countdown' && plan.task.countdownDurationSeconds ? { countdownRemainingSeconds: plan.task.countdownDurationSeconds } : {}),
      schedulePlanId: plan.id, scheduledFor: occurrence,
    } as PSTask;
    tasks.push(task);
    notifications.push({ taskId: id, title: task.title, scheduledFor: occurrence, planId: plan.id });
  }
  return { tasks, plans: remainingPlans, notifications };
}

/** Converts durable workspace plan templates to occurrences in a single atomic snapshot. */
export function materializeScheduledWorkspace(records: PSTask[], deletedIds: Iterable<string> = [], now = Date.now()) {
  const plans: ScheduledTaskPlan[] = [];
  for (const record of records) {
    if (!record.scheduledPending) continue;
    const schedule = normalizeTaskSchedule(record.schedule);
    if (!schedule) continue;
    const nextStartAt = record.scheduleNextStartAt ?? schedule.startAt;
    if (!Number.isFinite(Date.parse(nextStartAt))) continue;
    const task: NewTaskInput = {
      title: record.title, phase: record.phase, priority: record.priority, steps: record.steps,
      ...(record.stepList ? { stepList: record.stepList.map(step => ({ ...step, done: false })) } : {}),
      ...(record.note !== undefined ? { note: record.note } : {}),
      ...(record.timerMode !== undefined ? { timerMode: record.timerMode } : {}),
      ...(record.countdownDurationSeconds !== undefined ? { countdownDurationSeconds: record.countdownDurationSeconds } : {}),
      ...(record.plannedDurationSeconds !== undefined ? { plannedDurationSeconds: record.plannedDurationSeconds } : {}),
    };
    plans.push({ id: record.id, task, schedule, nextStartAt });
  }
  const result = getDueScheduledOccurrences(plans, now, [...records.map(record => record.id), ...deletedIds]);
  const nextPlans = new Map(result.plans.map(plan => [plan.id, plan]));
  const handledIds = new Set(plans.map(plan => plan.id));
  let changed = result.tasks.length > 0;
  const updated: PSTask[] = [];
  for (const record of records) {
    if (!handledIds.has(record.id)) { updated.push(record); continue; }
    const nextPlan = nextPlans.get(record.id);
    if (!nextPlan) { changed = true; continue; }
    // Untouched plans retain their original reference and existing serialization.
    const before = record.scheduleNextStartAt ?? record.schedule?.startAt;
    if (nextPlan.nextStartAt === before) { updated.push(record); continue; }
    changed = true;
    updated.push({ ...record, scheduleNextStartAt: nextPlan.nextStartAt });
  }
  return { records: changed ? [...result.tasks, ...updated] : records, notifications: result.notifications };
}
