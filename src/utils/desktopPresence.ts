import type { PSTask } from '../types';
import { rankNextStepCandidates } from '../components/strategyViewModel';
import { getTaskRemainingSeconds, getTaskTimerMode, getTaskTotalSeconds } from './taskTimer';

export type DesktopPresence = {
  lang: 'uk' | 'en';
  active?: {
    taskId: string;
    title: string;
    state: 'running' | 'paused' | 'expired';
    mode: 'countdown' | 'stopwatch';
    elapsedSeconds: number;
    totalSeconds?: number;
    remainingSeconds?: number;
  };
  next?: { taskId: string; title: string };
};

const PAUSE_WINDOW_MS = 30 * 60 * 1000;
const titleFor = (title: string) => title.length > 60 ? title.slice(0, 59) + '…' : title;
const seconds = (value: number | undefined) => Number.isFinite(value) ? Math.max(0, Math.floor(value!)) : 0;

/** Only an explicit pause with a partly used budget identifies a paused session. */
function recentPauseAt(task: PSTask, now: number): number | undefined {
  if (getTaskTimerMode(task) !== 'countdown' || task.timerRunning || task.countdownExpiredAt !== undefined) return undefined;
  const remaining = getTaskRemainingSeconds(task, now);
  const total = seconds(task.countdownDurationSeconds);
  if (remaining === undefined || remaining <= 0 || remaining >= total) return undefined;
  const event = task.activityTrail?.filter(item => Number.isFinite(item.at) &&
    ['started', 'paused', 'completed', 'reopened'].includes(item.kind))
    .reduce<(NonNullable<PSTask['activityTrail']>)[number] | undefined>((latest, item) =>
      !latest || item.at >= latest.at ? item : latest, undefined);
  if (event?.kind !== 'paused' || event.at > now || now - event.at > PAUSE_WINDOW_MS ||
    (Number.isFinite(task.timeResetAt) && event.at <= task.timeResetAt!)) return undefined;
  return event.at;
}

/** A small, deterministic snapshot for native Windows surfaces. */
export function buildDesktopPresence(tasks: PSTask[], now: number, lang: 'uk' | 'en'): DesktopPresence {
  const eligible = tasks.filter(task => !task.done && !task.scheduledPending);
  const running = eligible.find(task => task.timerRunning && getTaskTimerMode(task) !== 'none');
  const expired = eligible.find(task => getTaskTimerMode(task) === 'countdown' &&
    Number.isFinite(task.countdownExpiredAt) && task.countdownExpiredAt! >= 0);
  const paused = !running && !expired ? eligible.reduce<{ task: PSTask; at: number } | undefined>((latest, task) => {
    const at = recentPauseAt(task, now);
    return at !== undefined && (!latest || at > latest.at) ? { task, at } : latest;
  }, undefined)?.task : undefined;
  const task = running ?? expired ?? paused;
  const presence: DesktopPresence = { lang };
  if (task) {
    const mode = getTaskTimerMode(task) === 'countdown' ? 'countdown' : 'stopwatch';
    const state = task === running ? 'running' : task === expired ? 'expired' : 'paused';
    const active: NonNullable<DesktopPresence['active']> = {
      taskId: task.id, title: titleFor(task.title), state, mode,
      elapsedSeconds: getTaskTotalSeconds(task, now),
    };
    if (mode === 'countdown') {
      const total = seconds(task.countdownDurationSeconds);
      const remaining = state === 'expired' ? 0 : getTaskRemainingSeconds(task, now);
      active.totalSeconds = total;
      active.remainingSeconds = remaining ?? total;
      active.elapsedSeconds = Math.max(0, total - active.remainingSeconds);
    }
    presence.active = active;
  }
  const next = rankNextStepCandidates(eligible.filter(candidate => candidate.id !== task?.id), undefined, now)[0]?.task;
  if (next) presence.next = { taskId: next.id, title: titleFor(next.title) };
  return presence;
}
