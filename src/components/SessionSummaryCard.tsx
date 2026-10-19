import React, { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import type { PSTask } from '../types';
import { buildSessionSummary, type EndedSession } from '../utils/sessionSummary';
import { isTaskDate, localTaskDate } from '../utils/taskDates';
import { rankNextStepCandidates, taskStepProgress } from './strategyViewModel';

interface SessionSummaryCardProps {
  session: EndedSession;
  task: PSTask;
  allTasks: readonly PSTask[];
  now: number;
  lang: 'uk' | 'en';
  onDismiss: () => void;
  onStart: (id: string) => void;
  onResume: (id: string) => void;
  onPlanTomorrow: (id: string) => void;
  onFinishAfterExpiry: (id: string) => void;
  onContinueTenMinutes: (id: string) => void;
  onReopen: (id: string) => void;
}

const action = 'min-h-9 [@media(pointer:coarse)]:min-h-11 focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-2';

export const SessionSummaryCard: React.FC<SessionSummaryCardProps> = ({ session, task, allTasks, now, lang, onDismiss, onStart, onResume, onPlanTomorrow, onFinishAfterExpiry, onContinueTenMinutes, onReopen }) => {
  const reducedMotion = useReducedMotion();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const remaining = useRef(8000);
  const summary = buildSessionSummary(session, task, allTasks, now, lang);
  const next = task.done ? rankNextStepCandidates(allTasks.filter(item => item.id !== task.id), undefined, now)[0]?.task : undefined;
  const nextStep = taskStepProgress(task).nextTitle;
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const canPlanTomorrow = !task.done && (!task.deadlineDate || !isTaskDate(task.deadlineDate) || task.deadlineDate >= localTaskDate(tomorrow.getTime()));
  const squares = Math.max(1, Math.min(24, Math.ceil(session.seconds / 300)));
  const act = (callback: (id: string) => void, id = task.id) => { callback(id); onDismiss(); };

  useEffect(() => {
    // A countdown usually ends while the person looks elsewhere, so that card waits to be seen.
    if (hovered || focused || session.reason === 'countdownEnded') return;
    const started = Date.now();
    const timer = window.setTimeout(onDismiss, remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [hovered, focused, onDismiss, session.reason]);

  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onDismiss();
    };
    document.addEventListener('keydown', dismiss);
    return () => document.removeEventListener('keydown', dismiss);
  }, [onDismiss]);

  return <div className="fixed bottom-24 left-1/2 z-40 w-[calc(100%_-_2rem)] max-w-md -translate-x-1/2 app-no-drag">
    <motion.div role="status" aria-live="polite" aria-atomic="true"
      initial={reducedMotion ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)} onBlurCapture={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
      className="relative max-h-[calc(100dvh_-_7rem)] overflow-y-auto border border-neutral-800 bg-[#0c0c0d] p-4 text-white shadow-2xl">
      <button type="button" onClick={onDismiss} aria-label={lang === 'uk' ? 'Закрити підсумок сесії' : 'Dismiss session summary'} className={action + ' absolute right-2 top-2 px-3 text-xl text-neutral-400 hover:text-white'}>×</button>
      <p className="pr-10 text-[10px] uppercase tracking-widest text-neutral-400">{lang === 'uk' ? 'Сесію завершено' : 'Session complete'}</p>
      <p className="mt-1 truncate pr-10 text-sm text-neutral-300" title={summary.title}>{summary.title}</p>
      <p className="mt-3 text-2xl font-semibold leading-tight text-balance">{summary.minutesLabel}</p>
      <div aria-hidden="true" className="my-3 flex gap-1">
        {Array.from({ length: squares }, (_, index) => <span key={index} className="aspect-square min-w-0 max-w-2 flex-1 bg-neutral-800">
          <motion.span className="block h-full w-full bg-emerald-400" initial={reducedMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: reducedMotion ? 0 : 0.12, delay: reducedMotion ? 0 : index * 0.04 }} />
        </span>)}
      </div>
      {summary.lines.length > 0 && <div className="space-y-1 text-sm leading-relaxed text-neutral-300">{summary.lines.map((line, index) => <p key={index}>{line}</p>)}</div>}
      {session.reason === 'countdownEnded' ? <div className="mt-4">
        <p className="mb-2 text-sm text-neutral-300">{lang === 'uk' ? 'Як пройшло?' : 'How did it go?'}</p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={action + ' bg-white px-3 text-sm font-semibold text-black hover:bg-neutral-200'} onClick={() => act(onFinishAfterExpiry)}>{lang === 'uk' ? 'Завершити сесію' : 'Finish session'}</button>
          <button type="button" className={action + ' px-3 text-sm text-neutral-300 hover:text-white'} onClick={() => act(onContinueTenMinutes)}>{lang === 'uk' ? 'Ще 10 хв' : '10 more min'}</button>
        </div>
      </div> : <div className="mt-4 flex flex-wrap items-center gap-2">
        {(!task.done || next) && <button type="button" className={action + ' min-w-0 max-w-full bg-white px-3 py-2 text-left text-sm font-semibold text-black hover:bg-neutral-200'} onClick={() => next ? act(onStart, next.id) : act(onResume)}>
          <span className="block truncate">{next ? (lang === 'uk' ? 'Далі: ' : 'Next: ') + next.title : nextStep ? (lang === 'uk' ? 'Продовжити: ' : 'Resume: ') + nextStep : (lang === 'uk' ? 'Продовжити' : 'Resume')}</span>
        </button>}
        {canPlanTomorrow && <button type="button" className={action + ' px-3 text-sm text-neutral-400 hover:text-white'} onClick={() => act(onPlanTomorrow)}>{lang === 'uk' ? 'Завтра' : 'Tomorrow'}</button>}
        {task.done && <button type="button" className={action + ' px-2 text-xs text-neutral-400 hover:text-white'} onClick={() => act(onReopen)}>{lang === 'uk' ? 'Повернути' : 'Reopen'}</button>}
      </div>}
    </motion.div>
  </div>;
};
