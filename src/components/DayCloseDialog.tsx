import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PSTask } from '../types';
import { formatDayFocus, formatDaySessions, type DaySummary } from '../utils/dayRecap';
import { isTaskDate, localTaskDate } from '../utils/taskDates';
import { useDialogKeyboard } from './useDialogKeyboard';

interface Props {
  summary: DaySummary;
  candidates: readonly PSTask[];
  lang: 'uk' | 'en';
  onClose: () => void;
  onConfirm: (result: { moveTaskIds: string[]; note: string }) => boolean | void;
}

const action = 'min-h-9 [@media(pointer:coarse)]:min-h-11 focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-2';

export const DayCloseDialog: React.FC<Props> = ({ summary, candidates, lang, onClose, onConfirm }) => {
  const date = new Date(summary.date + 'T12:00:00');
  const tomorrowDate = new Date(date);
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = localTaskDate(tomorrowDate.getTime());
  const blocked = (task: PSTask) => !!task.deadlineDate && isTaskDate(task.deadlineDate) && task.deadlineDate < tomorrow;
  const [selected, setSelected] = useState(() => new Set(candidates.filter(task => !blocked(task) && task.deadlineDate !== summary.date && !!task.plannedDate && task.plannedDate <= summary.date).map(task => task.id)));
  const [note, setNote] = useState('');
  const [saveFailed, setSaveFailed] = useState(false);
  const submitted = useRef(false);
  const squares = Math.min(32, Math.ceil(Math.max(0, summary.focusSeconds) / 900));
  const dateLabel = date.toLocaleDateString(lang === 'uk' ? 'uk-UA' : 'en-US', { day: 'numeric', month: 'long' });
  useDialogKeyboard(true, onClose, 'day-close-dialog');

  return createPortal(<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 app-no-drag" onClick={event => event.stopPropagation()}>
    <form id="day-close-dialog" role="dialog" aria-modal="true" aria-labelledby="day-close-title" aria-describedby="day-close-date"
      className="max-h-[calc(100dvh_-_2rem)] w-full max-w-md overflow-y-auto overscroll-contain border border-neutral-800 bg-[#0c0c0d] p-4 text-white shadow-2xl"
      onSubmit={event => {
        event.preventDefault();
        if (submitted.current) return;
        submitted.current = true;
        if (onConfirm({ moveTaskIds: candidates.filter(task => selected.has(task.id) && !blocked(task)).map(task => task.id), note: note.trim() }) === false) { submitted.current = false; setSaveFailed(true); }
      }}>
      <header className="flex items-start justify-between gap-3">
        <div><h2 id="day-close-title" className="text-lg font-semibold">{lang === 'uk' ? 'Закрити день' : 'Close the day'}</h2>
          <p id="day-close-date" className="mt-1 text-xs text-neutral-400">{summary.date === localTaskDate() ? (lang === 'uk' ? 'Сьогодні, ' : 'Today, ') : ''}{dateLabel}</p></div>
        <button type="button" onClick={onClose} aria-label={lang === 'uk' ? 'Закрити' : 'Close'} className={action + ' -mr-2 -mt-2 px-3 text-xl text-neutral-400 hover:text-white'}>×</button>
      </header>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm tabular-nums">
        <span>{formatDayFocus(summary.focusSeconds, lang)}</span><span className="text-neutral-300">{formatDaySessions(summary.sessions, lang)}</span>
        <span className="text-neutral-300">{lang === 'uk' ? 'Закрито' : 'Completed'} {summary.completed.length}</span>
      </div>
      {squares > 0 && <div aria-hidden="true" className="my-3 flex gap-1">{Array.from({ length: squares }, (_, index) => <span key={index} className="aspect-square min-w-0 max-w-2 flex-1 bg-emerald-400" />)}</div>}
      {summary.completed.length > 0 && <ul className="mt-3 space-y-1 text-sm text-neutral-300">{summary.completed.slice(0, 5).map(task => <li key={task.id} className="flex items-start gap-2"><span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 bg-emerald-400" /><span className="min-w-0 break-words">{task.title}</span></li>)}
        {summary.completed.length > 5 && <li className="pl-3.5 text-xs text-neutral-500">+{summary.completed.length - 5}</li>}
      </ul>}
      <section className="mt-4 border-t border-neutral-800 pt-4" aria-labelledby="day-close-carry-title">
        <h3 id="day-close-carry-title" className="text-sm font-medium">{lang === 'uk' ? 'Що перенести на завтра?' : 'What should move to tomorrow?'}</h3>
        {candidates.length === 0 ? <p className="mt-2 text-xs text-neutral-500">{lang === 'uk' ? 'Немає завдань для перенесення.' : 'No tasks to carry over.'}</p> : <div className="mt-2 max-h-48 overflow-y-auto divide-y divide-neutral-800">
          {candidates.map(task => {
            const cannotMove = blocked(task);
            const content = <span className="min-w-0 flex-1"><span className="block break-words text-sm text-neutral-300">{task.title}</span>
              {task.deadlineDate === summary.date && <span className="mt-0.5 block text-[11px] text-neutral-500">{lang === 'uk' ? 'дедлайн сьогодні' : 'due today'}</span>}
              {cannotMove && <span className="mt-0.5 block text-[11px] text-neutral-500">{lang === 'uk' ? 'дедлайн не дозволяє перенести' : 'deadline prevents moving this task'}</span>}
            </span>;
            return cannotMove ? <div key={task.id} className="py-2">{content}</div> : <label key={task.id} className="flex min-h-11 cursor-pointer items-start gap-2 py-2">
              <input type="checkbox" checked={selected.has(task.id)} className="mt-0.5 h-4 w-4 shrink-0 accent-white focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-2" onChange={event => {
                const checked = event.target.checked;
                setSelected(previous => { const next = new Set(previous); if (checked) next.add(task.id); else next.delete(task.id); return next; });
              }} />{content}
            </label>;
          })}
        </div>}
      </section>
      <label htmlFor="day-close-note" className="mt-4 block text-xs text-neutral-400">{lang === 'uk' ? 'Одне речення про день (необов’язково)' : 'One sentence about the day (optional)'}</label>
      <input id="day-close-note" type="text" value={note} maxLength={240} onChange={event => setNote(event.target.value)} className="mt-2 min-h-10 w-full border border-neutral-800 bg-transparent px-3 text-sm text-white placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none" />
      {saveFailed && <p role="alert" className="mt-2 text-xs text-red-400">{lang === 'uk' ? 'Не вдалося закрити день. Спробуйте ще раз.' : 'Could not close the day. Try again.'}</p>}
      <footer className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className={action + ' px-3 text-sm text-neutral-400 hover:text-white'}>{lang === 'uk' ? 'Пізніше' : 'Later'}</button>
        <button type="submit" className={action + ' bg-white px-4 text-sm font-semibold text-black hover:bg-neutral-200'}>{lang === 'uk' ? 'Закрити день' : 'Close the day'}</button>
      </footer>
    </form>
  </div>, document.body);
};
