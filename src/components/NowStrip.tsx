import React, { useEffect, useId, useState } from 'react';
import { ArrowRight, Pause, Play, X } from 'lucide-react';
import type { PSTask, TaskTab } from '../types';
import { formatDayFocus, type DaySummary, type morningRecap } from '../utils/dayRecap';
import { formatTaskDate, localTaskDate, taskDateEnd } from '../utils/taskDates';
import { getTaskRemainingSeconds, getTaskTotalSeconds } from '../utils/taskTimer';
import { rankNextStepCandidates, type NextStepCandidate } from './strategyViewModel';
import './pulse/QuickEntry.css';

interface NowStripProps {
  tasks: readonly PSTask[];
  tabs?: readonly TaskTab[];
  lang: 'uk' | 'en';
  now: number;
  todaySummary: DaySummary;
  offerDayClose: boolean;
  dayClosed?: boolean;
  recap: ReturnType<typeof morningRecap>;
  recapNote?: string;
  onOpenDayClose: () => void;
  onDismissRecap: () => void;
  onReveal: (id: string) => void;
  onStart: (id: string) => void;
  onPause?: (id: string) => void;
  onComplete?: (id: string) => void;
  onMoveDeadline: (task: PSTask, date: string) => void;
}

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

function timerLabel(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(value / 60);
  return (minutes >= 60 ? Math.floor(minutes / 60) + ':' + String(minutes % 60).padStart(2, '0') : String(minutes).padStart(2, '0')) + ':' + String(value % 60).padStart(2, '0');
}

export const NowStrip: React.FC<NowStripProps> = ({ tasks, tabs, lang, now, todaySummary, offerDayClose, dayClosed = false, recap, recapNote, onOpenDayClose, onDismissRecap, onReveal, onStart, onPause, onComplete, onMoveDeadline }) => {
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [overdueOpen, setOverdueOpen] = useState(false);
  const overdueId = useId();
  const uk = lang === 'uk';
  const activeTasks = tasks.filter(task => !task.done && !task.scheduledPending);
  const candidates = rankNextStepCandidates(activeTasks, undefined, now);
  const index = candidates.length ? candidateIndex % candidates.length : 0;
  const runningTask = activeTasks.find(task => task.timerRunning);
  const [liveClock, setLiveClock] = useState(() => Date.now());
  const hasRunningTimer = !!runningTask;
  useEffect(() => {
    if (!hasRunningTimer) return;
    setLiveClock(Date.now());
    const timer = window.setInterval(() => setLiveClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasRunningTimer]);
  // Summary/ranking dates keep the parent snapshot; only a live timer needs a second hand.
  const timerNow = runningTask ? Math.max(now, liveClock) : now;
  const candidate = candidates[index];
  const current = runningTask || candidate?.task;
  const today = localTaskDate(now);
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowDate = localTaskDate(tomorrow.getTime());
  const doneToday = tasks.filter(task => task.done && Number.isFinite(task.completedAt) && localTaskDate(task.completedAt!) === today).length;
  const plannedToday = activeTasks.filter(task => task.plannedDate === today || task.deadlineDate === today).length;
  const overdue = activeTasks.filter(task => { const end = task.deadlineDate ? taskDateEnd(task.deadlineDate) : null; return end !== null && end < now; }).sort((a, b) => a.deadlineDate!.localeCompare(b.deadlineDate!));
  const category = current && tabs?.find(tab => tab.id === current.phase)?.name;
  const showRecap = !runningTask && !offerDayClose && !!recap;
  const showClose = !runningTask && offerDayClose;

  return <section aria-label={uk ? 'Зараз' : 'Now'} className="pulse-now">
    {!runningTask && dayClosed ? <div className="pulse-day-state pulse-day-state--closed">
      <span className="pulse-now-eyebrow">{uk ? 'День закрито' : 'Day closed'}</span>
      <h2>{uk ? 'До завтра' : 'See you tomorrow'}</h2>
      <p>{formatDayFocus(todaySummary.focusSeconds, lang)} · {uk ? 'Завершено задач: ' : 'Tasks completed: '}{todaySummary.completed.length}</p>
    </div> : showClose ? <div className="pulse-day-state">
      <span className="pulse-now-eyebrow">{uk ? 'Підсумок сьогодні' : 'Today’s recap'}</span>
      <h2>{uk ? 'Закрити день' : 'Close the day'}</h2>
      <p>{formatDayFocus(todaySummary.focusSeconds, lang)} · {uk ? 'Завершено задач: ' : 'Tasks completed: '}{todaySummary.completed.length}</p>
      <button type="button" className="pulse-now-primary" onClick={onOpenDayClose} aria-label={uk ? 'Закрити день' : 'Close the day'}>{uk ? 'Закрити день' : 'Close the day'}<ArrowRight size={17} aria-hidden="true" /></button>
    </div> : showRecap ? <div className="pulse-day-state pulse-day-state--morning">
      <div className="pulse-day-state-top"><span className="pulse-now-eyebrow">{recapNote ? (uk ? 'Вчора ви вирішили' : 'Yesterday you decided') : (uk ? 'Новий день' : 'A new day')}</span><button type="button" className="pulse-now-icon" aria-label={uk ? 'Приховати підсумок учора' : 'Dismiss yesterday’s recap'} onClick={onDismissRecap}><X size={18} aria-hidden="true" /></button></div>
      <h2>{recapNote || (uk ? 'Продовжуємо рости' : 'Keep growing')}</h2>
      <p>{uk ? 'Вчора: ' : 'Yesterday: '}{formatDayFocus(recap!.focusSeconds, lang)}{recap!.completedTitle && <> · {uk ? 'завершено «' : 'completed “'}{recap!.completedTitle}{uk ? '»' : '”'}{recap!.remainingCompleted > 0 && (uk ? ' і ще ' : ' and ') + recap!.remainingCompleted + (uk ? '' : ' more')}</>}</p>
      {current && <button type="button" className="pulse-now-primary" aria-label={(uk ? 'Почати: ' : 'Start: ') + current.title} onClick={() => onStart(current.id)}>{uk ? 'Почати день' : 'Start the day'}<ArrowRight size={17} aria-hidden="true" /></button>}
    </div> : current ? <div className="pulse-now-card">
      <div className="pulse-now-copy">
        <span className="pulse-now-eyebrow">{runningTask ? (uk ? 'Зараз' : 'Now') : (uk ? 'Наступний крок' : 'Next step')}</span>
        <button type="button" className="pulse-now-title" aria-label={(uk ? 'Відкрити задачу: ' : 'Open task: ') + current.title} onClick={() => onReveal(current.id)}>{current.title}</button>
        {category && <span className="pulse-now-category">{category}</span>}
      </div>
      <div className="pulse-now-clock">
        <span className="pulse-now-time" aria-label={(uk ? 'Таймер: ' : 'Timer: ') + timerLabel(getTaskRemainingSeconds(current, timerNow) ?? getTaskTotalSeconds(current, timerNow))}>{timerLabel(getTaskRemainingSeconds(current, timerNow) ?? getTaskTotalSeconds(current, timerNow))}</span>
        <div className="pulse-now-actions">
          {runningTask && onPause ? <button type="button" className="pulse-now-icon" aria-label={uk ? 'Пауза' : 'Pause'} data-tip={uk ? 'Пауза' : 'Pause'} onClick={() => onPause(current.id)}><Pause size={19} fill="currentColor" aria-hidden="true" /></button> : <button type="button" className="pulse-now-icon" aria-label={uk ? 'Почати задачу' : 'Start task'} data-tip={uk ? 'Почати задачу' : 'Start task'} onClick={() => onStart(current.id)}><Play size={19} fill="currentColor" aria-hidden="true" /></button>}
          {runningTask && onComplete ? <button type="button" className="pulse-now-primary" aria-label={(uk ? 'Завершити: ' : 'Complete: ') + current.title} onClick={() => onComplete(current.id)}>{uk ? 'Завершити' : 'Complete'}</button> : <button type="button" className="pulse-now-primary" aria-label={(uk ? 'Почати: ' : 'Start: ') + current.title} onClick={() => onStart(current.id)}>{Number.isFinite(current.startedAt) || (current.timeSpentSeconds || 0) > 0 ? (uk ? 'Продовжити' : 'Resume') : (uk ? 'Почати' : 'Start')}</button>}
          {!runningTask && candidates.length > 1 && <button type="button" className="pulse-now-other" aria-label={uk ? 'Інша наступна задача' : 'Another next task'} onClick={() => setCandidateIndex((index + 1) % candidates.length)}>{uk ? 'Інше' : 'Other'}<span>{index + 1}/{candidates.length}</span></button>}
        </div>
      </div>
    </div> : <div className="pulse-now-card pulse-now-card--empty"><div className="pulse-now-copy"><span className="pulse-now-eyebrow">{uk ? 'Почнімо' : 'Let’s begin'}</span><h2>{uk ? 'Що зробите сьогодні?' : 'What will you do today?'}</h2></div></div>}
    <div className="pulse-now-footer">
      <span>{doneToday + plannedToday > 0 ? (uk ? 'Сьогодні: ' : 'Today: ') + doneToday + (uk ? ' з ' : ' of ') + (doneToday + plannedToday) : (uk ? 'Додайте задачу та зробіть перший крок' : 'Add a task and take the first step')}</span>
      {runningTask && offerDayClose && <button type="button" onClick={onOpenDayClose} aria-label={uk ? 'Закрити день' : 'Close the day'}>{uk ? 'Закрити день' : 'Close the day'}</button>}
      {overdue.length > 0 && <button type="button" className="pulse-now-overdue" aria-label={uk ? 'Показати прострочені задачі' : 'Show overdue tasks'} aria-expanded={overdueOpen} aria-controls={overdueId} onClick={() => setOverdueOpen(value => !value)}>{uk ? overdue.length + ' прострочено' : overdue.length + ' overdue'}</button>}
    </div>
    {overdueOpen && overdue.length > 0 && <ul id={overdueId} className="pulse-now-overdue-list">{overdue.slice(0, 5).map(task => <li key={task.id}><div><button type="button" aria-label={(uk ? 'Відкрити: ' : 'Open: ') + task.title} onClick={() => onReveal(task.id)}>{task.title}</button><span>{overdueLabel(task.deadlineDate!, today, lang)}</span></div><div className="pulse-overdue-actions"><button type="button" aria-label={task.title + ': ' + (uk ? 'дедлайн сьогодні' : 'deadline today')} onClick={() => onMoveDeadline(task, today)}>{uk ? 'Дедлайн → сьогодні' : 'Deadline → today'}</button><button type="button" aria-label={task.title + ': ' + (uk ? 'дедлайн завтра' : 'deadline tomorrow')} onClick={() => onMoveDeadline(task, tomorrowDate)}>{uk ? '→ завтра' : '→ tomorrow'}</button></div></li>)}</ul>}
  </section>;
};
