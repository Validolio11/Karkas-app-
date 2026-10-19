import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { PSTask } from '../types';
import type { Language } from '../utils/i18n';
import type { AgentAction } from '../utils/aiAgentActions';
import { calendarDateKey, taskScheduledEnd } from '../utils/schedulePresentation';
import { isTaskDate } from '../utils/taskDates';
import { TaskDateCalendar } from './TaskDateCalendar';
import { useDialogKeyboard } from './useDialogKeyboard';

interface Props {
  task: PSTask;
  lang: Language;
  timeZone: string;
  triggerRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  onApply: (actions: AgentAction[]) => void | Promise<void>;
  onExtend?: () => void;
}

const clockMinutes = (value: string, end = false): number | undefined => {
  if (end && value === '24:00') return 1440;
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return undefined;
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
};
const minuteClock = (minutes: number) => String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');

/** A block must finish later on the same day; midnight is a valid end. */
export function scheduleDurationMinutes(start: string, end: string): number | undefined {
  const from = clockMinutes(start), to = clockMinutes(end, true);
  return from !== undefined && to !== undefined && to > from ? to - from : undefined;
}

export function TaskScheduleDialog({ task, lang, timeZone, triggerRef, onClose, onApply, onExtend }: Props) {
  const uk = lang === 'uk';
  const [openedAt] = useState(Date.now);
  const clock = (at: number) => new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
  const today = calendarDateKey(openedAt, timeZone);
  const tomorrowDate = new Date(today + 'T12:00:00Z');
  tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
  const tomorrow = tomorrowDate.toISOString().slice(0, 10);
  const scheduled = Number.isFinite(task.scheduledFor);
  const initialStart = scheduled ? task.scheduledFor! : Math.ceil(openedAt / 300000) * 300000;
  const initialDuration = Math.max(1, Math.round((task.scheduledDurationSeconds ?? task.countdownDurationSeconds ?? 1800) / 60));
  const initialEnd = taskScheduledEnd(task);
  const [date, setDate] = useState(calendarDateKey(initialStart, timeZone));
  const [start, setStart] = useState(clock(initialStart));
  const [mode, setMode] = useState<'end' | 'duration'>('end');
  const [end, setEnd] = useState(() => {
    const total = clockMinutes(clock(initialStart))! + initialDuration;
    return total === 1440 ? '24:00' : initialEnd !== undefined ? clock(initialEnd) : total < 1440 ? minuteClock(total) : '';
  });
  const [duration, setDuration] = useState(String(initialDuration));
  const [calendarOpen, setCalendarOpen] = useState(![today, tomorrow].includes(date));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submitted = useRef(false);
  const minutes = mode === 'end' ? scheduleDurationMinutes(start, end) : /^\d+$/.test(duration) && Number(duration) >= 1 && Number(duration) <= 1440 ? Number(duration) : undefined;
  const startMinutes = clockMinutes(start);
  const sameDay = minutes !== undefined && startMinutes !== undefined && startMinutes + minutes <= 1440;
  const blocked = !!task.timerRunning || task.done;
  const valid = !blocked && isTaskDate(date) && sameDay;
  const apply = async (action: AgentAction) => {
    if (submitted.current) return;
    submitted.current = true;
    setSaving(true);
    setError('');
    try { await onApply([action]); onClose(); }
    catch (error) { submitted.current = false; setSaving(false); setError(error instanceof Error ? error.message : uk ? 'Не вдалося змінити час. Спробуйте ще раз.' : 'Could not update the time. Try again.'); }
  };
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (valid) void apply({ type: 'update_task', taskId: task.id, date, startTime: start, durationMinutes: minutes! });
  };
  const id = 'task-schedule-dialog-' + task.id;
  const titleId = 'task-schedule-title-' + task.id;
  const blockedId = 'task-schedule-blocked-' + task.id;
  useDialogKeyboard(true, onClose, id, triggerRef);
  const inputClass = 'mt-2 block min-h-11 w-full min-w-0 border border-neutral-700 bg-neutral-950 px-3 py-2 text-base text-white [color-scheme:dark] focus:border-white focus:outline-none disabled:opacity-40';
  const dateButton = (selected: boolean) => 'min-h-11 border px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-white disabled:opacity-40 ' + (selected ? 'border-white bg-white text-black' : 'border-neutral-700 text-neutral-300 hover:border-neutral-400 hover:text-white');
  return createPortal(
    <div className="task-time-overlay" onClick={event => event.stopPropagation()}>
      <form onSubmit={submit} id={id} role="dialog" aria-modal="true" aria-labelledby={titleId} className="max-h-[90dvh] w-full max-w-xl overflow-y-auto border border-neutral-700 bg-[#0c0c0e] p-5 text-neutral-100 shadow-2xl">
        <header className="flex items-start justify-between gap-3"><div className="min-w-0"><h4 id={titleId} className="text-lg font-extrabold">{uk ? 'Змінити час' : 'Change time'}</h4><p className="mt-1 break-words text-xs leading-relaxed text-neutral-400">{task.title}</p></div><button type="button" onClick={onClose} aria-label={uk ? 'Закрити' : 'Close'} className="flex h-11 w-11 shrink-0 items-center justify-center text-neutral-400 hover:text-white focus-visible:outline-2 focus-visible:outline-white"><X className="h-5 w-5" /></button></header>
        {blocked && <div className="mt-4 space-y-3"><p id={blockedId} className="text-sm leading-relaxed text-neutral-400">{task.timerRunning ? uk ? 'Таймер іде — змінювати початок і дату не можна. Щоб змінити тривалість, продовжіть відлік.' : 'The timer is running, so its start and date cannot change. Extend the countdown to change its duration.' : uk ? 'Спершу поверніть завершене завдання в роботу.' : 'Reopen the completed task before changing its time.'}</p>{task.timerRunning && onExtend && <button type="button" className={dateButton(false)} onClick={onExtend}>{uk ? 'Продовжити відлік' : 'Extend countdown'}</button>}</div>}
        <fieldset disabled={blocked || saving} aria-describedby={blocked ? blockedId : undefined} className="mt-5 min-w-0 space-y-5">
          <div className="grid min-w-0 grid-cols-2 gap-3">
            <label className="min-w-0 text-sm text-neutral-400">{uk ? 'Початок' : 'Start'}<input type="time" step="60" value={start} onChange={event => setStart(event.target.value)} className={inputClass} required /></label>
            {mode === 'end' ? <label className="min-w-0 text-sm text-neutral-400">{uk ? 'Кінець' : 'End'}<input type="text" placeholder="HH:MM" value={end} onChange={event => setEnd(event.target.value)} aria-invalid={!sameDay || undefined} className={inputClass} required /></label> : <label className="min-w-0 text-sm text-neutral-400">{uk ? 'Тривалість, хв' : 'Duration, min'}<input type="number" min="1" max="1440" step="1" value={duration} onChange={event => setDuration(event.target.value)} aria-invalid={!sameDay || undefined} className={inputClass} required /></label>}
          </div>
          <div role="group" aria-label={uk ? 'Задати тривалість' : 'Set duration'} className="flex flex-wrap gap-2"><button type="button" aria-pressed={mode === 'end'} onClick={() => { if (minutes !== undefined && startMinutes !== undefined) setEnd(minuteClock(startMinutes + minutes)); setMode('end'); }} className={dateButton(mode === 'end')}>{uk ? 'Кінець' : 'End'}</button><button type="button" aria-pressed={mode === 'duration'} onClick={() => { if (minutes !== undefined) setDuration(String(minutes)); setMode('duration'); }} className={dateButton(mode === 'duration')}>{uk ? 'Тривалість' : 'Duration'}</button></div>
          <div role="group" aria-label={uk ? 'День роботи' : 'Work day'} className="flex flex-wrap gap-2"><button type="button" aria-pressed={date === today && !calendarOpen} className={dateButton(date === today && !calendarOpen)} onClick={() => { setDate(today); setCalendarOpen(false); }}>{uk ? 'Сьогодні' : 'Today'}</button><button type="button" aria-pressed={date === tomorrow && !calendarOpen} className={dateButton(date === tomorrow && !calendarOpen)} onClick={() => { setDate(tomorrow); setCalendarOpen(false); }}>{uk ? 'Завтра' : 'Tomorrow'}</button><button type="button" aria-expanded={calendarOpen} className={dateButton(calendarOpen)} onClick={() => setCalendarOpen(!calendarOpen)}>{uk ? 'Інша дата' : 'Other date'}</button></div>
          {calendarOpen && <TaskDateCalendar plannedOnly idPrefix={'schedule-' + task.id} plannedDate={date} deadlineDate="" onPlannedDateChange={setDate} onDeadlineDateChange={() => {}} lang={lang} />}
        </fieldset>
        {!blocked && !valid && <p role="alert" className="task-time-error">{!isTaskDate(date) ? uk ? 'Виберіть дату.' : 'Choose a date.' : uk ? 'Кінець має бути пізніше початку й не пізніше 24:00. Вкажіть час у форматі HH:MM або тривалість у цілих хвилинах.' : 'The end must be after the start and no later than 24:00. Enter HH:MM or a duration in whole minutes.'}</p>}
        {error && <p role="alert" className="task-time-error">{error}</p>}
        <footer className="mt-5 flex flex-wrap justify-end gap-2 border-t border-neutral-800 pt-4"><button type="button" onClick={onClose} disabled={saving} className={dateButton(false)}>{uk ? 'Скасувати' : 'Cancel'}</button>{scheduled && <button type="button" className={dateButton(false)} disabled={!!task.timerRunning || saving} onClick={() => void apply({ type: 'update_task', taskId: task.id, clearTime: true })}>{uk ? 'Прибрати час' : 'Remove time'}</button>}<button type="submit" disabled={!valid || saving} className="min-h-11 border border-white bg-white px-4 py-2 text-sm font-bold text-black hover:bg-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-40">{uk ? 'Зберегти' : 'Save'}</button></footer>
      </form>
    </div>, document.body,
  );
}
