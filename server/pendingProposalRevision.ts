/** Draft identities are local to this request; they must never become persisted task ids. */
export interface PendingRevisionTarget {
  id: string;
  kind: 'create' | 'update';
  index: number;
  task: Record<string, any>;
}

export interface PendingProposalRevision {
  targets: PendingRevisionTarget[];
  allowedIds: string[];
  /** Only an explicit “add another task to this draft” may append new operations. */
  allowCreate?: boolean;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

export function pendingRevisionTargets(pending: Record<string, any>, live: Record<string, any>[]): PendingRevisionTarget[] {
  let prefix = 'pending-task:';
  while (live.some(task => typeof task.id === 'string' && task.id.startsWith(prefix))) prefix = `_${prefix}`;
  const created = (Array.isArray(pending.tasks) ? pending.tasks : []).flatMap((task: any, index: number) =>
    task && typeof task.title === 'string' ? [{ id: `${prefix}${index}`, kind: 'create' as const, index,
      task: { ...clone(task), id: `${prefix}${index}` } }] : []);
  const updated = (Array.isArray(pending.taskUpdates) ? pending.taskUpdates : []).flatMap((patch: any, index: number) => {
    const existing = live.find(task => task.id === patch?.id);
    return existing ? [{ id: existing.id as string, kind: 'update' as const, index, task: { ...clone(existing), ...clone(patch) } }] : [];
  });
  return [...created, ...updated];
}

/** Only an explicit, scoped revision enters here. Empty/filtered replies never re-emit the draft. */
export function reconcilePendingProposal(parsed: Record<string, any>, pending: Record<string, any>, revision: PendingProposalRevision): Record<string, any> {
  const patches = Array.isArray(parsed.taskUpdates) ? parsed.taskUpdates.filter((patch: any) => revision.allowedIds.includes(patch?.id) && Object.keys(patch).some(key => key !== 'id' && patch[key] !== undefined)) : [];
  const additions = revision.allowCreate && Array.isArray(parsed.tasks) ? parsed.tasks : [];
  if (!patches.length && !additions.length) return { ...parsed, tasks: [], tabs: [], taskUpdates: [], taskDeletions: [] };
  const result = { ...parsed, tasks: clone(pending.tasks ?? []), tabs: clone(pending.tabs ?? []),
    taskUpdates: clone(pending.taskUpdates ?? []), taskDeletions: clone(pending.taskDeletions ?? []) };
  for (const patch of patches) {
    const target = revision.targets.find(item => item.id === patch.id);
    if (!target) throw new Error('Unknown pending revision target');
    const { id: _requestLocalId, ...changes } = patch;
    if (target.kind === 'create') {
      // New-task subtasks have no persisted identity and cannot carry completion state.
      if (changes.done !== undefined || changes.stepList?.some((step: any) => step.done === true)) throw new Error('Cannot complete an unapplied new task');
      result.tasks[target.index] = { ...result.tasks[target.index], ...changes };
    } else result.taskUpdates[target.index] = { ...result.taskUpdates[target.index], ...changes };
  }
  result.tasks.push(...clone(additions));
  return result;
}

/** A range is a start time plus a budget, not merely a countdown detached from the clock. */
export function hasExplicitTimeRange(prompt: string): boolean {
  return !!requestedTimeWindow(prompt);
}

export function requestedTimeWindow(prompt: string) {
  const match = /(?:з|із|від|from)\s*(\d{1,2}):(\d{2})\s*(?:до|по|to|until|[-–—])\s*(\d{1,2}):(\d{2})/iu.exec(prompt)
    ?? /(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})/u.exec(prompt);
  if (!match) return undefined;
  const [startHour, startMinute, endHour, endMinute] = match.slice(1).map(Number);
  if (startHour > 23 || endHour > 23 || startMinute > 59 || endMinute > 59) return { ambiguous: true as const };
  let minutes = endHour * 60 + endMinute - startHour * 60 - startMinute;
  if (minutes <= 0) {
    if (!/(?:наступного\s+дня|через\s+північ|ночі\s+до|overnight|next\s+day|across\s+midnight)/iu.test(prompt)) return { ambiguous: true as const };
    minutes += 24 * 60;
  }
  return { ambiguous: false as const, start: `${String(startHour).padStart(2, '0')}:${String(startMinute).padStart(2, '0')}`, durationSeconds: minutes * 60 };
}

/** Reject incomplete windows instead of silently dropping the clock start or the end-derived budget. */
export function assertRequestedTimeWindow(prompt: string, candidates: Record<string, any>[], timeZone: string) {
  const window = requestedTimeWindow(prompt);
  if (!window || !candidates.length) return;
  if (window.ambiguous) throw new Error('Requested time window needs clarification');
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  if (!candidates.some(task => task.timerMode === 'countdown' && task.countdownDurationSeconds === window.durationSeconds
    && typeof task.schedule?.startAt === 'string' && Number.isFinite(Date.parse(task.schedule.startAt))
    && formatter.format(new Date(task.schedule.startAt)) === window.start)) throw new Error('Requested time window is incomplete or changed');
}
