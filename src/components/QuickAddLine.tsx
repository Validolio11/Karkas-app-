import React, { useId, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronDown, Clock3, Plus, SlidersHorizontal, Tag, X } from 'lucide-react';
import type { GrowthSkill, NewTaskInput, TaskTab } from '../types';
import type { Language } from '../utils/i18n';
import { normalizeQuickAddCategory, parseQuickAdd } from '../utils/quickAddParse';
import { isConfiguredSkill } from '../utils/growth';
import { describePlannedDate, localTaskDate } from '../utils/taskDates';
import { DEFAULT_QUICK_ADD_PRIORITY } from './quickAddDraft';
import type { QuickAddPrefill } from './QuickAddDrawer';
import { QuickAddPicker, type QuickAddChoice } from './pulse/QuickAddPicker';
import { KarkasLogo } from './pulse/KarkasLogo';
import './pulse/QuickEntry.css';

interface QuickAddLineProps {
  tabs: TaskTab[];
  skills?: GrowthSkill[];
  selectedPhase?: string;
  lang: Language;
  now: number;
  inputRef?: React.Ref<HTMLInputElement>;
  onAdd: (task: NewTaskInput, proposedCategoryName?: string) => void | boolean;
  onMoreOptions: (prefill: Omit<QuickAddPrefill, 'key'>) => void;
  /** The header dialog: brand mark in the line and a preview of the parsed title. */
  dialog?: boolean;
  /** Escape on an empty line with no open picker. */
  onDismiss?: () => void;
}

type Picker = 'date' | 'time' | 'category';

// Time is represented through the existing once-only task schedule, never a new task field.
function parseInlineTime(text: string) {
  const match = /(?:^|\s)(?:(?:о|об|at)\s+(\d{1,2})(?::([0-5]\d))?|(\d{1,2}):([0-5]\d))(?=\s|$)/i.exec(text);
  if (!match || Number(match[1] ?? match[3]) > 23) return { text, time: undefined };
  const time = String(Number(match[1] ?? match[3])).padStart(2, '0') + ':' + (match[2] ?? match[4] ?? '00');
  return { text: (text.slice(0, match.index) + ' ' + text.slice(match.index + match[0].length)).trim(), time };
}

export const QuickAddLine: React.FC<QuickAddLineProps> = ({ tabs, skills = [], selectedPhase, lang, now, inputRef, onAdd, onMoreOptions, dialog = false, onDismiss }) => {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [picker, setPicker] = useState<Picker | null>(null);
  const [pickedDate, setPickedDate] = useState<string>();
  const [pickedTime, setPickedTime] = useState<string | null>();
  const [pickedPhase, setPickedPhase] = useState<string>();
  const localInputRef = useRef<HTMLInputElement | null>(null);
  const composing = useRef(false);
  const adding = useRef(false);
  const pickerId = useId();
  const uk = lang === 'uk';
  const locale = uk ? 'uk-UA' : 'en-GB';
  const timed = useMemo(() => parseInlineTime(text), [text]);
  const skillTag = useMemo(() => {
    let skill: GrowthSkill | undefined;
    const remaining = timed.text.replace(/(?:^|\s)(#[^\s]+)/gu, (match, tag: string) => {
      const name = normalizeQuickAddCategory(tag.slice(1));
      const candidate = skills.find(item => item.deletedAt === undefined && item.archivedAt === undefined
        && normalizeQuickAddCategory(item.title) === name);
      if (!candidate) return match;
      skill = candidate;
      return ' ';
    }).trim();
    return { skill, text: remaining };
  }, [timed.text, skills]);
  const parsed = useMemo(() => parseQuickAdd(skillTag.text, tabs, now), [skillTag.text, tabs, now]);
  const defaultPhase = tabs.some(tab => tab.id === selectedPhase) ? selectedPhase! : tabs[0]?.id || 'focus';
  const phase = tabs.some(tab => tab.id === pickedPhase) ? pickedPhase! : parsed.phase || defaultPhase;
  const proposedCategoryName = pickedPhase ? undefined : parsed.proposedCategoryName;
  const plannedDate = pickedDate ?? parsed.plannedDate;
  const time = pickedTime === undefined ? timed.time : pickedTime || undefined;
  const canAdd = !!parsed.title.trim();
  const focusInput = () => localInputRef.current?.focus({ preventScroll: true });
  const reset = () => { setText(''); setError(''); setPickedDate(undefined); setPickedTime(undefined); setPickedPhase(undefined); setPicker(null); };
  const schedule = (): NewTaskInput['schedule'] => {
    if (!time) return undefined;
    const date = new Date((plannedDate || localTaskDate(now)) + 'T' + time + ':00');
    return { startAt: date.toISOString(), recurrence: 'once', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, leadMinutes: 5 };
  };
  const prefill = (): Omit<QuickAddPrefill, 'key'> => ({
    title: parsed.title,
    ...(skillTag.skill ? { skillId: skillTag.skill.id } : {}),
    phase,
    priority: parsed.priority || DEFAULT_QUICK_ADD_PRIORITY,
    plannedDate,
    deadlineDate: parsed.deadlineDate,
    ...(time ? { schedule: schedule() } : {}),
  });
  const addTask = () => {
    if (!canAdd || composing.current || adding.current) { focusInput(); return; }
    if (plannedDate && parsed.deadlineDate && plannedDate > parsed.deadlineDate) { setError(uk ? 'Дедлайн не може бути раніше дня роботи.' : 'The deadline cannot be before the planned day.'); setPicker('date'); return; }
    try {
      adding.current = true;
      const accepted = onAdd({ ...prefill(), phase, priority: parsed.priority || DEFAULT_QUICK_ADD_PRIORITY, steps: 0, timerMode: 'stopwatch' }, proposedCategoryName);
      if (accepted === false) { setError(uk ? 'Не вдалося додати завдання. Спробуйте ще раз.' : 'Could not add the task. Try again.'); return; }
      reset(); focusInput();
    } catch { setError(uk ? 'Не вдалося додати завдання. Спробуйте ще раз.' : 'Could not add the task. Try again.'); }
    finally { queueMicrotask(() => { adding.current = false; }); }
  };
  // The existing detailed drawer takes over this entry, including a chosen timed schedule.
  const openWizard = () => {
    if (composing.current) return;
    try { onMoreOptions({ ...prefill(), proposedCategoryName }); reset(); }
    catch { setError(uk ? 'Не вдалося відкрити параметри. Ваші дані залишилися в рядку.' : 'Could not open options. Your entry is still here.'); }
  };
  const removeToken = (tokenIndex: number) => {
    let cursor = 0, start = -1, end = -1;
    for (const token of parsed.tokens.slice(0, tokenIndex + 1)) {
      start = text.indexOf(token.raw, cursor);
      while (start >= 0 && ((start > 0 && !/\s/.test(text[start - 1])) || (start + token.raw.length < text.length && !/\s/.test(text[start + token.raw.length])))) start = text.indexOf(token.raw, start + 1);
      if (start < 0) return;
      end = start + token.raw.length; cursor = end;
    }
    if (start >= 0) setText((text.slice(0, start) + text.slice(end)).replace(/\s+/g, ' ').trim());
    setError(''); focusInput();
  };
  const dateChoices: QuickAddChoice[] = Array.from({ length: 14 }, (_, offset) => {
    const date = new Date(now); date.setDate(date.getDate() + offset);
    const value = localTaskDate(date.getTime());
    return { value, top: offset === 0 ? (uk ? 'сьогодні' : 'today') : offset === 1 ? (uk ? 'завтра' : 'tomorrow') : date.toLocaleDateString(locale, { weekday: 'short' }), main: String(date.getDate()), bottom: date.toLocaleDateString(locale, { month: 'short' }), label: date.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' }) };
  });
  const timeChoices: QuickAddChoice[] = Array.from({ length: 14 }, (_, index) => {
    const hour = index + 8, value = String(hour).padStart(2, '0') + ':00';
    return { value, top: hour < 12 ? (uk ? 'ранок' : 'morning') : hour < 17 ? (uk ? 'день' : 'afternoon') : (uk ? 'вечір' : 'evening'), main: String(hour), bottom: ':00', label: value };
  });
  const categoryChoices: QuickAddChoice[] = tabs.map(tab => ({ value: tab.id, top: uk ? 'категорія' : 'category', main: tab.name, label: tab.name }));
  if (parsed.proposedCategoryName) categoryChoices.unshift({ value: '__proposal__', top: uk ? 'створити категорію' : 'create category', main: '+ ' + parsed.proposedCategoryName, label: (uk ? 'Створити категорію: ' : 'Create category: ') + parsed.proposedCategoryName });
  const pickerLabel = picker === 'date' ? (uk ? 'Дата' : 'Date') : picker === 'time' ? (uk ? 'Час' : 'Time') : (uk ? 'Категорія' : 'Category');
  const chips = [
    { kind: 'date' as const, icon: CalendarDays, label: plannedDate ? describePlannedDate(plannedDate, lang, now).label : (uk ? 'Дата' : 'Date'), set: !!plannedDate },
    { kind: 'time' as const, icon: Clock3, label: time || (uk ? 'Час' : 'Time'), set: !!time },
    { kind: 'category' as const, icon: Tag, label: proposedCategoryName ? '+ ' + proposedCategoryName : tabs.find(tab => tab.id === (pickedPhase || parsed.phase))?.name || (uk ? 'Категорія' : 'Category'), set: !!(pickedPhase || parsed.phase || proposedCategoryName) },
  ];
  return <div className={'pulse-quick-add' + (dialog ? ' pulse-quick-add--dialog' : '')} onKeyDown={event => { if (event.key === 'Escape' && picker) { event.preventDefault(); event.stopPropagation(); setPicker(null); focusInput(); } }}>
    <div className="pulse-quick-add-line">
      {dialog && <span className="pulse-quick-add-mark" aria-hidden="true"><KarkasLogo compact width={22} height={23} /></span>}
      <input ref={node => { localInputRef.current = node; if (typeof inputRef === 'function') inputRef(node); else if (inputRef) inputRef.current = node; }} autoFocus type="text" value={text} aria-invalid={!!error} aria-describedby={error ? pickerId + '-error' : undefined} aria-label={uk ? 'Нова задача' : 'New task'} placeholder={uk ? 'Нова задача · завтра о 10 #робота' : 'New task · tomorrow at 10 #work'}
        onChange={event => { setText(event.target.value); setError(''); }} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={event => {
          if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); if (event.repeat) return; if (event.shiftKey) openWizard(); else addTask(); }
          else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (picker) setPicker(null); else if (!text && onDismiss) onDismiss(); else reset(); }
        }} />
      <button type="button" aria-label={uk ? 'Додати задачу' : 'Add task'} data-tip={uk ? 'Додати задачу' : 'Add task'} className="pulse-quick-add-submit" onClick={addTask} disabled={!canAdd}><Plus size={22} aria-hidden="true" /></button>
    </div>
    {dialog && parsed.title.trim() && <span className="pulse-quick-add-title">{parsed.title}</span>}
    {text.trim() && <div className="pulse-quick-add-meta">
      {skillTag.skill && <span className="pulse-quick-skill">{skillTag.skill.title}</span>}
      {chips.map(chip => <button key={chip.kind} type="button" className={'pulse-quick-chip pulse-quick-chip--' + chip.kind} data-set={chip.set} aria-label={(uk ? 'Вибрати: ' : 'Choose: ') + chip.label} aria-expanded={picker === chip.kind} aria-controls={picker === chip.kind ? pickerId : undefined} onClick={() => setPicker(value => value === chip.kind ? null : chip.kind)}><chip.icon size={15} aria-hidden="true" />{chip.label}<ChevronDown size={12} aria-hidden="true" className={picker === chip.kind ? 'is-open' : ''} /></button>)}
      <button type="button" className="pulse-quick-more" aria-label={uk ? 'Більше параметрів задачі' : 'More task options'} data-tip={uk ? 'Більше параметрів · Shift Enter' : 'More options · Shift Enter'} onClick={openWizard}><SlidersHorizontal size={16} aria-hidden="true" /></button>
      {time && <button type="button" className="pulse-quick-more" aria-label={uk ? 'Прибрати час' : 'Remove time'} data-tip={uk ? 'Прибрати час' : 'Remove time'} onClick={() => { setPickedTime(null); focusInput(); }}><X size={14} aria-hidden="true" /></button>}
      {parsed.tokens.map((token, index) => token.kind === 'priority' || token.kind === 'deadline' ? <button key={token.kind + index} type="button" className="pulse-quick-token" onClick={() => removeToken(index)} aria-label={(uk ? 'Прибрати: ' : 'Remove: ') + token.raw}>{token.kind === 'priority' ? 'P' + token.value : (uk ? 'Дедлайн ' : 'Due ') + describePlannedDate(token.value, lang, now).label}<X size={12} aria-hidden="true" /></button> : null)}
    </div>}
    {picker && <QuickAddPicker key={picker} id={pickerId} label={pickerLabel} kind={picker} choices={picker === 'date' ? dateChoices : picker === 'time' ? timeChoices : categoryChoices} selected={picker === 'date' ? plannedDate : picker === 'time' ? time : proposedCategoryName ? '__proposal__' : phase} onClose={() => { setPicker(null); focusInput(); }} onSelect={value => { if (picker === 'date') setPickedDate(value); else if (picker === 'time') setPickedTime(value); else setPickedPhase(value === '__proposal__' ? undefined : value); setPicker(null); setError(''); focusInput(); }} />}
    {error && <p id={pickerId + '-error'} role="alert" className="pulse-quick-error">{error}</p>}
  </div>;
};
