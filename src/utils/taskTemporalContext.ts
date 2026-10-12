import type { PSTask } from '../types';
import { isTaskDate } from './taskDates';
import { recordedTaskSeconds } from './taskTimeStats';

export interface TemporalClientClock { now: string; timeZone: string; }
type TemporalTask = Partial<PSTask> & { deletedAt?: number };

/** Interpret calendar days in the supplied client zone, never in the server's zone. */
export function buildTaskTemporalContext(tasks: TemporalTask[], clock: TemporalClientClock, options: { archivedTasks?: TemporalTask[]; limit?: number } = {}) {
  const now = Date.parse(clock.now);
  if (!Number.isFinite(now)) throw new Error('Invalid temporal clock');
  const formatter = new Intl.DateTimeFormat('sv-SE', { timeZone: clock.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const localDateTime = formatter.format(new Date(now));
  const today = localDateTime.slice(0, 10);
  const shiftDay = (offset: number) => {
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  };
  const relative = (date: string) => date === today ? 'today' : date === shiftDay(-1) ? 'yesterday' : date === shiftDay(1) ? 'tomorrow' : date < today ? 'past' : 'future';
  const timestamp = (value: unknown) => {
    const epoch = typeof value === 'number' ? value : typeof value === 'string' && /T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
    if (!Number.isFinite(epoch) || epoch <= 0 || Math.abs(epoch) > 8.64e15) return null;
    const local = formatter.format(new Date(epoch));
    return { utc: new Date(epoch).toISOString(), local, dayRelation: relative(local.slice(0, 10)), future: epoch > now };
  };
  const seen = new Set<string>();
  const records = [...tasks.map(task => ({ task, archived: false })), ...(options.archivedTasks || []).map(task => ({ task, archived: true }))]
    .filter(({ task }) => { if (!task.id || seen.has(task.id)) return false; seen.add(task.id); return true; })
    .map(({ task, archived }) => {
      const plannedDate = isTaskDate(task.plannedDate) ? task.plannedDate : null;
      const deadlineDate = isTaskDate(task.deadlineDate) ? task.deadlineDate : null;
      const storedStart = timestamp(task.scheduledFor) ?? timestamp(task.scheduleNextStartAt)
        ?? (task.scheduledPending && task.schedule?.recurrence === 'daily' ? null : timestamp(task.schedule?.startAt));
      const plannedStartEpoch = storedStart ? Date.parse(storedStart.utc) : NaN;
      const measuredSeconds = recordedTaskSeconds(task);
      const started = timestamp(task.startedAt);
      const timerSessionStarted = timestamp(task.timerStartedAt);
      const hasRecordedStart = Boolean(started && !started.future || timerSessionStarted && !timerSessionStarted.future);
      const statuses: string[] = [];
      if (task.done) statuses.push('completed');
      else if (!archived) {
        if (plannedDate) statuses.push(plannedDate === today ? 'planned_today_unfinished' : plannedDate < today ? 'planned_day_passed_unfinished' : 'planned_future');
        if (deadlineDate) statuses.push(deadlineDate < today ? 'deadline_overdue' : deadlineDate === today ? 'deadline_today_until_local_day_end' : 'deadline_future');
        if (Number.isFinite(plannedStartEpoch)) statuses.push(plannedStartEpoch > now ? 'timed_start_future'
          : hasRecordedStart ? 'timed_start_passed_with_recorded_start' : measuredSeconds !== null ? 'timed_start_passed_with_recorded_work' : 'timed_start_passed_no_recorded_start');
      }
      const trail = Array.isArray(task.activityTrail) ? task.activityTrail : [];
      const events = trail.slice(-8).filter(event => event && typeof event === 'object')
        .map(event => ({ ...event, at: timestamp(event.at) })).filter(event => event.at !== null);
      return {
        id: task.id, title: task.title, archived, done: Boolean(task.done), scheduledPending: Boolean(task.scheduledPending),
        created: timestamp(task.createdAt), lastEdited: timestamp(task.updatedAt), started, completed: timestamp(task.completedAt),
        ...(archived ? { archivedAt: timestamp(task.deletedAt) } : {}),
        plannedDay: plannedDate ? { date: plannedDate, relation: relative(plannedDate) } : null,
        deadlineDay: deadlineDate ? { date: deadlineDate, relation: relative(deadlineDate), inclusive: true } : null,
        scheduledStart: timestamp(plannedStartEpoch),
        ...(task.schedule ? { recurrence: task.schedule.recurrence, scheduleTimeZone: task.schedule.timeZone, scheduleAnchor: timestamp(task.schedule.startAt), nextOccurrence: timestamp(task.scheduleNextStartAt) } : {}),
        statuses, recordedWorkSeconds: measuredSeconds, timerRunning: Boolean(task.timerRunning), timerSessionStarted,
        progress: { completedSteps: task.currentStep ?? 0, totalSteps: task.steps ?? 0 },
        ...(events.length ? { recentActivity: events, omittedActivityCount: Math.max(0, trail.length - events.length) } : {}),
      };
    });
  const limit = Math.max(1, Math.min(200, options.limit ?? 80));
  // Unfinished temporal commitments take precedence over undated history in a bounded prompt.
  const importance = (record: typeof records[number]) => record.archived || record.done ? 2 : record.statuses.length ? 0 : 1;
  records.sort((a, b) => importance(a) - importance(b));
  return {
    clock: { utc: new Date(now).toISOString(), timeZone: clock.timeZone, localDateTime, localDate: today,
      weekday: new Intl.DateTimeFormat('en-GB', { timeZone: clock.timeZone, weekday: 'long' }).format(new Date(now)), yesterday: shiftDay(-1), tomorrow: shiftDay(1) },
    counts: { total: records.length, plannedTodayUnfinished: records.filter(task => task.statuses.includes('planned_today_unfinished')).length,
      plannedDayPassedUnfinished: records.filter(task => task.statuses.includes('planned_day_passed_unfinished')).length,
      overdueDeadlines: records.filter(task => task.statuses.includes('deadline_overdue')).length },
    tasks: records.slice(0, limit), omittedTaskCount: Math.max(0, records.length - limit),
    evidenceLimits: 'Unknown timestamps and missing measurements remain unknown. Activity is a bounded recorded journal, not a complete history. Calendar dates have no implied start hour. A passed start or unfinished day is not proof that no work happened.',
  };
}

export const temporalAwarenessSystemPolicy = `TEMPORAL GROUNDING:
Before answering, inspect authoritative TASK TEMPORAL CONTEXT and current client local clock. Resolve the current request's today, tomorrow and yesterday using that clock/time zone, never server time. For historical messages with a recorded timestamp, resolve their relative dates against that message's instant in the client zone; a historical 'tomorrow' does not move forward on every new day. Undated old messages cannot establish an exact date. Distinguish creation, edits, scheduled work day, exact scheduled start, deadline (inclusive through the end of its local day), recorded starts, completed time and journal events. A task planned today remains planned today until its date is changed; do not silently treat it as tomorrow. Unknown creation/completion/edit timestamps must not be reconstructed. Creation-to-completion elapsed time is not measured effort.
For an unfinished task with a passed planned day or timed start, first ask what happened if the reason is unknown. Missing timer readings do not prove the person did nothing. Do not automatically move missed commitments to tomorrow. Respect an explicit user request to change a named task's date without forcing a personal interview; if target/date is ambiguous, clarify. Time-based observations must not bypass personal discovery readiness or agreed-goal boundaries.
Actions in an AI response are proposals until the application confirms them. Say 'I propose moving...' rather than 'I updated...', 'scheduled' or 'saved' when referring to unapplied changes. An intention or a chat claim is not a stored task mutation. Do not invent an hour for a calendar-only date or treat an obsolete recurring template start as a missed daily occurrence. Use supplied task IDs and latest recorded dates, and disclose missing context.`;
