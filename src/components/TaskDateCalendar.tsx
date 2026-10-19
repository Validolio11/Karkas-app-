import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, CalendarDays, Check } from 'lucide-react';
import type { Language } from '../utils/i18n';
import { isTaskDate, localTaskDate } from '../utils/taskDates';
import { pickTaskDate, type TaskDateField } from './quickAddDraft';

interface TaskDateCalendarProps {
  plannedDate: string;
  deadlineDate: string;
  onPlannedDateChange: (value: string) => void;
  onDeadlineDateChange: (value: string) => void;
  lang: Language;
  plannedInputRef?: React.RefObject<HTMLInputElement | null>;
  deadlineInputRef?: React.RefObject<HTMLInputElement | null>;
  invalid?: boolean;
  plannedOnly?: boolean;
  idPrefix?: string;
}

function calendarDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(12, 0, 0, 0);
  return date;
}

export function TaskDateCalendar({ plannedDate, deadlineDate, onPlannedDateChange, onDeadlineDateChange, lang, plannedInputRef, deadlineInputRef, invalid = false, plannedOnly = false, idPrefix = 'quick-add' }: TaskDateCalendarProps) {
  const uk = lang === 'uk';
  const locale = uk ? 'uk-UA' : 'en-GB';
  const today = localTaskDate();
  // Continue where the user left off: with a work day but no deadline, the next click sets the deadline.
  const [activeField, setActiveField] = useState<TaskDateField>(() => !plannedOnly && isTaskDate(plannedDate) && !isTaskDate(deadlineDate) ? 'deadline' : 'planned');
  const [hint, setHint] = useState('');
  const [month, setMonth] = useState(() => {
    const initial = calendarDate(isTaskDate(plannedDate) ? plannedDate : isTaskDate(deadlineDate) ? deadlineDate : today);
    initial.setDate(1);
    return initial;
  });
  const monthName = month.toLocaleDateString(locale, { month: 'long' });
  const monthYear = `${monthName.charAt(0).toUpperCase()}${monthName.slice(1)} ${month.getFullYear()}`;
  const daysInMonth = new Date(month.getTime());
  daysInMonth.setMonth(month.getMonth() + 1, 0);
  const offset = (month.getDay() + 6) % 7;
  const cellCount = Math.ceil((offset + daysInMonth.getDate()) / 7) * 7;
  const weekdays = uk ? ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'] : ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
  const plannedLabel = uk ? 'Заплановано на' : 'Planned for';
  const deadlineLabel = uk ? 'Завершити до' : 'Complete by';
  const shortDate = (value: string) => calendarDate(value).toLocaleDateString(locale, { day: 'numeric', month: 'long' });
  const choose = (value: string) => {
    if (plannedOnly) { setHint(''); onPlannedDateChange(value); return true; }
    const pick = pickTaskDate(activeField, value, plannedDate, deadlineDate);
    if ('rejected' in pick) {
      setHint(uk ? `Дедлайн не може бути раніше дня роботи (${shortDate(plannedDate)}). Оберіть пізніший день або змініть «${plannedLabel}».` : `The deadline cannot be before the work day (${shortDate(plannedDate)}). Choose a later day or change “${plannedLabel}”.`);
      return false;
    }
    setHint('');
    (pick.field === 'planned' ? onPlannedDateChange : onDeadlineDateChange)(pick.value);
    setActiveField(pick.nextActive);
    return true;
  };
  const shortcut = (days: number) => {
    const date = calendarDate(today);
    date.setDate(date.getDate() + days);
    if (!choose(localTaskDate(date.getTime()))) return;
    date.setDate(1);
    setMonth(date);
  };
  const moveMonth = (delta: number) => {
    const next = new Date(month.getTime());
    next.setMonth(next.getMonth() + delta);
    if (next.getFullYear() >= 1 && next.getFullYear() <= 9999) setMonth(next);
  };
  const setExactDate = (field: TaskDateField, value: string) => {
    setHint('');
    (field === 'planned' ? onPlannedDateChange : onDeadlineDateChange)(value);
    if (isTaskDate(value)) {
      const next = calendarDate(value);
      next.setDate(1);
      setMonth(next);
    }
  };
  const target = (field: TaskDateField, value: string, label: string) => (
    <button type="button" onClick={() => {
      setActiveField(field);
      setHint('');
      if (isTaskDate(value)) {
        const selected = calendarDate(value);
        selected.setDate(1);
        setMonth(selected);
      }
    }} aria-pressed={activeField === field} className={`w-full border-l-2 py-3 pl-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-white ${activeField === field ? 'border-white bg-white/[0.04]' : 'border-transparent hover:bg-white/[0.025]'}`}>
      <span className="block text-xs text-neutral-400">{label}</span>
      <span className={`mt-1.5 flex items-center gap-2 text-base sm:text-lg font-medium ${isTaskDate(value) ? 'text-white' : 'text-neutral-400'}`}>
        <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
        {isTaskDate(value) ? calendarDate(value).toLocaleDateString(locale, { day: 'numeric', month: 'long' }) : uk ? 'Не обрано' : 'Not selected'}
      </span>
      <span className="mt-1 block min-h-4 text-xs text-neutral-400">{isTaskDate(value) ? `${calendarDate(value).toLocaleDateString(locale, { weekday: 'long' })} · ${calendarDate(value).getFullYear()}` : uk ? 'Виберіть день у календарі' : 'Choose a day in the calendar'}</span>
    </button>
  );

  return (
    <div className="grid min-w-0 gap-5 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] md:gap-6">
      <section aria-label={uk ? 'Календар завдання' : 'Task calendar'} className="min-w-0">
        <div className="mb-3 grid grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2">
            <button type="button" onClick={() => moveMonth(-1)} disabled={month.getFullYear() === 1 && month.getMonth() === 0} aria-label={uk ? 'Попередній місяць' : 'Previous month'} className="flex h-11 w-11 items-center justify-center text-neutral-300 hover:bg-white/5 hover:text-white focus-visible:outline focus-visible:outline-white disabled:opacity-30"><ChevronLeft className="h-5 w-5" aria-hidden="true" /></button>
            <h3 className="text-center text-base sm:text-lg font-medium text-white">{monthYear}</h3>
            <button type="button" onClick={() => moveMonth(1)} disabled={month.getFullYear() === 9999 && month.getMonth() === 11} aria-label={uk ? 'Наступний місяць' : 'Next month'} className="flex h-11 w-11 items-center justify-center text-neutral-300 hover:bg-white/5 hover:text-white focus-visible:outline focus-visible:outline-white disabled:opacity-30"><ChevronRight className="h-5 w-5" aria-hidden="true" /></button>
        </div>
        <div className="mb-2 grid grid-cols-7 gap-1" aria-hidden="true">
          {weekdays.map(day => <span key={day} className="py-1 text-center text-xs text-neutral-400">{day}</span>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: cellCount }, (_, index) => {
            const day = index - offset + 1;
            if (day < 1 || day > daysInMonth.getDate()) return <span key={index} aria-hidden="true" />;
            const date = new Date(month.getTime());
            date.setDate(day);
            const value = localTaskDate(date.getTime());
            const planned = value === plannedDate;
            const deadline = !plannedOnly && value === deadlineDate;
            const current = value === today;
            const beforePlanned = activeField === 'deadline' && isTaskDate(plannedDate) && value < plannedDate;
            const annotations = [planned && plannedLabel, deadline && deadlineLabel, current && (uk ? 'Сьогодні' : 'Today'), beforePlanned && (uk ? 'раніше за день роботи' : 'before the work day')].filter(Boolean).join(', ');
            return (
              <button key={value} type="button" onClick={() => choose(value)} aria-pressed={activeField === 'planned' ? planned : deadline} aria-current={current ? 'date' : undefined} aria-label={`${date.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' })}${annotations ? ` — ${annotations}` : ''}`} className={`relative flex h-9 sm:h-10 items-center justify-center border text-sm transition-colors focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white ${planned ? 'border-white bg-white font-semibold text-black' : deadline ? 'border-neutral-400 text-white' : beforePlanned ? 'border-transparent text-neutral-600 hover:bg-white/[0.03]' : 'border-transparent text-neutral-300 hover:bg-white/[0.07]'} ${planned && deadline ? 'outline outline-1 outline-offset-[-4px] outline-black/40' : ''}`}>
                {day}
                {current && <span aria-hidden="true" className={`absolute bottom-1.5 h-px w-3 ${planned ? 'bg-black' : 'bg-white'}`} />}
              </button>
            );
          })}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/10 pt-3 text-[11px] text-neutral-400" aria-hidden="true">
          {([['planned', plannedDate, plannedLabel, 'bg-white'], ['deadline', deadlineDate, deadlineLabel, 'border border-neutral-400']] as const).filter(([field]) => !plannedOnly || field === 'planned').map(([field, value, label, swatch]) => {
            const set = isTaskDate(value);
            return <span key={field} className={`flex items-center gap-2 ${set ? 'text-neutral-200' : 'text-neutral-600'}`}><span className={`h-2.5 w-2.5 ${swatch} ${set ? '' : 'opacity-40'}`} />{label}{set ? <><Check className="h-3 w-3 text-white" />{shortDate(value)}</> : <span>—</span>}</span>;
          })}
        </div>
      </section>
      <aside className="min-w-0 border-t border-white/10 pt-4 md:border-l md:border-t-0 md:pl-4 md:pt-0" aria-label={uk ? 'Вибрані дати' : 'Selected dates'}>
        <p className="mb-3 text-[11px] uppercase tracking-[0.13em] text-neutral-500">{uk ? 'Ваші дати' : 'Your dates'}</p>
        <div className="space-y-1">{target('planned', plannedDate, plannedLabel)}{!plannedOnly && target('deadline', deadlineDate, deadlineLabel)}</div>
        <p aria-live="polite" className="mt-3 text-xs leading-relaxed text-neutral-400">{uk ? `Зараз обираєте: ${activeField === 'planned' ? 'день роботи' : 'дедлайн'}.` : `Selecting: ${activeField === 'planned' ? 'work day' : 'deadline'}.`}</p>
        {hint && <p role="status" className="mt-2 text-xs leading-relaxed text-amber-300">{hint}</p>}
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-3 text-xs">
          <button type="button" onClick={() => shortcut(0)} className="text-neutral-300 underline-offset-4 hover:text-white hover:underline focus-visible:outline focus-visible:outline-white">{uk ? 'Сьогодні' : 'Today'}</button>
          <button type="button" onClick={() => shortcut(1)} className="text-neutral-300 underline-offset-4 hover:text-white hover:underline focus-visible:outline focus-visible:outline-white">{uk ? 'Завтра' : 'Tomorrow'}</button>
          <button type="button" onClick={() => choose('')} className="text-neutral-500 underline-offset-4 hover:text-white hover:underline focus-visible:outline focus-visible:outline-white">{uk ? 'Без дати' : 'No date'}</button>
        </div>
        <div className="mt-4 space-y-2 border-t border-white/10 pt-3">
          <p className="text-[11px] uppercase tracking-[0.1em] text-neutral-600">{uk ? 'Точна дата' : 'Exact date'}</p>
          <label className="block text-[11px] text-neutral-500">{plannedLabel}<input id={`${idPrefix}-planned-date`} ref={plannedInputRef} type="date" min="0001-01-01" max="9999-12-31" value={plannedDate} onFocus={() => setActiveField('planned')} onChange={event => setExactDate('planned', event.target.value)} aria-invalid={invalid || undefined} aria-describedby={invalid ? 'quick-add-dates-warning' : undefined} className="mt-1 block w-full min-w-0 border-0 border-b border-white/15 bg-transparent py-2 text-sm text-neutral-300 [color-scheme:dark] focus:border-white focus:outline-none" /></label>
          {!plannedOnly && <label className="block text-[11px] text-neutral-500">{deadlineLabel}<input id={`${idPrefix}-deadline-date`} ref={deadlineInputRef} type="date" min="0001-01-01" max="9999-12-31" value={deadlineDate} onFocus={() => setActiveField('deadline')} onChange={event => setExactDate('deadline', event.target.value)} aria-invalid={invalid || undefined} aria-describedby={invalid ? 'quick-add-dates-warning' : undefined} className="mt-1 block w-full min-w-0 border-0 border-b border-white/15 bg-transparent py-2 text-sm text-neutral-300 [color-scheme:dark] focus:border-white focus:outline-none" /></label>}
        </div>
      </aside>
    </div>
  );
}

export default TaskDateCalendar;
