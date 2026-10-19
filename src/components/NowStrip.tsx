import React, { useId, useState } from 'react';
import type { PSTask } from '../types';
import { formatTaskDate, localTaskDate, taskDateEnd } from '../utils/taskDates';
import { rankNextStepCandidates, type NextStepCandidate } from './strategyViewModel';

interface NowStripProps {
  tasks: readonly PSTask[];
  lang: 'uk' | 'en';
  now: number;
  onReveal: (id: string) => void;
  onStart: (id: string) => void;
  onMoveDeadline: (task: PSTask, date: string) => void;
}

const action = 'min-h-9 [@media(pointer:coarse)]:min-h-11 focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-2';

function reasonLabel(candidate: NextStepCandidate, lang: 'uk' | 'en', now: number): string {
  const { task, reason } = candidate;
  if (reason === 'inProgress' || reason === 'running') return lang === 'uk' ? 'розпочато' : 'in progress';
  if (reason === 'pinned') return lang === 'uk' ? 'закріплено' : 'pinned';
  if (reason === 'focus') return lang === 'uk' ? 'фокус' : 'focus';
  if (reason === 'deadline' && task.deadlineDate) {
    const today = localTaskDate(now);
    if (task.deadlineDate < today) return lang === 'uk' ? 'прострочено' : 'overdue';
    if (task.deadlineDate === today) return lang === 'uk' ? 'дедлайн сьогодні' : 'due today';
    return lang === 'uk' ? `дедлайн ${formatTaskDate(task.deadlineDate, lang, now).toLowerCase()}` : `due ${formatTaskDate(task.deadlineDate, lang, now).toLowerCase()}`;
  }
  return `P${task.priority}`;
}

function overdueLabel(deadline: string, today: string, lang: 'uk' | 'en'): string {
  // Count calendar days, including days that cross a DST boundary.
  const calendarDay = (value: string) => {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    return date.getTime();
  };
  const days = Math.max(1, Math.round((calendarDay(today) - calendarDay(deadline)) / 86_400_000));
  if (lang !== 'uk') return `Overdue by ${days} ${days === 1 ? 'day' : 'days'}`;
  const last = days % 10, lastTwo = days % 100;
  const unit = last === 1 && lastTwo !== 11 ? 'день' : last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? 'дні' : 'днів';
  return `Прострочено на ${days} ${unit}`;
}

export const NowStrip: React.FC<NowStripProps> = ({ tasks, lang, now, onReveal, onStart, onMoveDeadline }) => {
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [overdueOpen, setOverdueOpen] = useState(false);
  const overdueId = useId();
  const activeTasks = tasks.filter(task => !task.done && !task.scheduledPending);
  const candidates = rankNextStepCandidates(activeTasks, undefined, now);
  const index = candidates.length ? candidateIndex % candidates.length : 0;
  const candidate = candidates[index];
  const running = activeTasks.some(task => task.timerRunning);
  const today = localTaskDate(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowDate = localTaskDate(tomorrow.getTime());
  const doneToday = tasks.filter(task => task.done && Number.isFinite(task.completedAt) && localTaskDate(task.completedAt!) === today).length;
  const plannedToday = activeTasks.filter(task => task.plannedDate === today || task.deadlineDate === today).length;
  const overdue = activeTasks.filter(task => {
    const end = task.deadlineDate ? taskDateEnd(task.deadlineDate) : null;
    return end !== null && end < now;
  }).sort((a, b) => a.deadlineDate!.localeCompare(b.deadlineDate!));

  if (!activeTasks.length) return null;

  return <section aria-label={lang === 'uk' ? 'Зараз' : 'Now'} className="mb-3 border border-neutral-800 bg-[#0c0c0d] px-3 py-1 text-sm">
    {!running && candidate && <div className="flex min-w-0 flex-wrap items-center gap-x-2 sm:flex-nowrap">
      <div className="flex min-w-0 basis-full items-center gap-2 sm:basis-auto sm:flex-1">
        <span className="shrink-0 text-[11px] uppercase text-neutral-500">{lang === 'uk' ? 'Далі' : 'Next'}</span>
        <button type="button" className={`${action} min-w-0 flex-1 truncate text-left text-neutral-200 hover:text-white`} title={candidate.task.title} onClick={() => onReveal(candidate.task.id)}>{candidate.task.title}</button>
      </div>
      <span className="max-w-[45%] shrink-0 truncate border border-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-400" title={reasonLabel(candidate, lang, now)}>{reasonLabel(candidate, lang, now)}</span>
      <button type="button" className={`${action} ml-auto shrink-0 bg-white px-2 sm:ml-0 text-xs font-bold text-black hover:bg-neutral-200`} onClick={() => onStart(candidate.task.id)}>{Number.isFinite(candidate.task.startedAt) || (candidate.task.timeSpentSeconds || 0) > 0 ? (lang === 'uk' ? 'Продовжити' : 'Resume') : (lang === 'uk' ? 'Почати' : 'Start')}</button>
      {candidates.length > 1 && <button type="button" className={`${action} shrink-0 px-1 text-xs text-neutral-400 hover:text-white`} onClick={() => setCandidateIndex((index + 1) % candidates.length)}>
        {lang === 'uk' ? 'Інше' : 'Other'} <span className="text-[10px] tabular-nums text-neutral-500">{index + 1}/{candidates.length}</span>
      </button>}
    </div>}
    <div className="flex min-h-9 flex-wrap items-center gap-x-3 text-xs text-neutral-400">
      {doneToday + plannedToday === 0 && overdue.length === 0
        ? <span className="text-neutral-500">{lang === 'uk' ? 'На сьогодні нічого не заплановано' : 'Nothing planned for today'}</span>
        : <span>{lang === 'uk' ? `Сьогодні: ${doneToday} з ${doneToday + plannedToday}` : `Today: ${doneToday} of ${doneToday + plannedToday}`}</span>}
      {overdue.length > 0 && <button type="button" className={`${action} text-red-400 hover:text-red-300`} aria-expanded={overdueOpen} aria-controls={overdueId} onClick={() => setOverdueOpen(value => !value)}>
        {lang === 'uk' ? `${overdue.length} прострочено` : `${overdue.length} overdue`}
      </button>}
    </div>
    {overdueOpen && overdue.length > 0 && <ul id={overdueId} className="border-t border-neutral-800 py-1">
      {overdue.slice(0, 5).map(task => <li key={task.id} className="flex flex-wrap items-center gap-x-3 text-xs">
        <div className="flex min-w-0 flex-1 basis-48 items-center gap-2">
          <button type="button" className={`${action} min-w-0 flex-1 truncate text-left text-neutral-300 hover:text-white`} title={task.title} onClick={() => onReveal(task.id)}>{task.title}</button>
          <span className="shrink-0 text-[10px] text-neutral-500">{overdueLabel(task.deadlineDate!, today, lang)}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" className={`${action} px-1 text-neutral-400 hover:text-white`} aria-label={`${task.title}: ${lang === 'uk' ? 'дедлайн сьогодні' : 'deadline today'}`} onClick={() => onMoveDeadline(task, today)}>{lang === 'uk' ? 'Дедлайн → сьогодні' : 'Deadline → today'}</button>
          <button type="button" className={`${action} px-1 text-neutral-400 hover:text-white`} aria-label={`${task.title}: ${lang === 'uk' ? 'дедлайн завтра' : 'deadline tomorrow'}`} onClick={() => onMoveDeadline(task, tomorrowDate)}>{lang === 'uk' ? '→ завтра' : '→ tomorrow'}</button>
        </div>
      </li>)}
    </ul>}
  </section>;
};
