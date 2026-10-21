import React, { useEffect, useRef, useState } from 'react';
import { CalendarDays, Check, ChevronDown, Pencil, Play, Trash2 } from 'lucide-react';
import type { PSTask, TaskTab } from '../../types';
import { formatTaskDate, localTaskDate } from '../../utils/taskDates';
import { PulseCalendar } from './PulseCalendar';
import './today.css';

interface TodayTaskRowProps {
  task: PSTask;
  tabs: readonly TaskTab[];
  skillName?: string;
  lang: 'uk' | 'en';
  now: number;
  onToggleDone: (id: string) => void;
  onStart: (id: string) => void;
  /** Returns false when the title changed elsewhere meanwhile. */
  onRename?: (id: string, title: string) => boolean;
  onDelete?: (id: string) => void;
  onMove?: (task: PSTask, date: string) => void;
}

function minutesLabel(seconds: number | undefined, lang: 'uk' | 'en') {
  if (!seconds) return '';
  const minutes = Math.round(seconds / 60);
  if (minutes >= 60 && minutes % 60 === 0) return minutes / 60 + (lang === 'uk' ? ' год' : ' h');
  return minutes + (lang === 'uk' ? ' хв' : ' min');
}
const dayAfter = (now: number, days: number) => { const date = new Date(now); date.setDate(date.getDate() + days); return localTaskDate(date.getTime()); };

/** The row the mockup shows; right click (or the menu key) opens edit, move and delete. */
export function TodayTaskRow({ task, tabs, skillName, lang, now, onToggleDone, onStart, onRename, onDelete, onMove }: TodayTaskRowProps) {
  const uk = lang === 'uk';
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.title);
  const [conflict, setConflict] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const hasMenu = !!(onRename || onDelete || onMove);

  const close = (focusRow = false) => { setMenu(null); setMoveOpen(false); if (focusRow) rowRef.current?.querySelector<HTMLElement>('button')?.focus(); };
  useEffect(() => {
    if (!menu) return;
    const onDown = (event: MouseEvent) => { if (!menuRef.current?.contains(event.target as Node)) close(); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); } };
    const onScroll = () => close();
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    requestAnimationFrame(() => menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
    return () => { document.removeEventListener('mousedown', onDown, true); document.removeEventListener('keydown', onKey, true); window.removeEventListener('scroll', onScroll, true); };
  }, [menu]);
  // Keep the menu inside the window.
  const open = (x: number, y: number) => setMenu({ x: Math.min(x, window.innerWidth - 256), y: Math.min(y, window.innerHeight - 300) });
  const onContextMenu = (event: React.MouseEvent) => { if (!hasMenu || editing) return; event.preventDefault(); open(event.clientX, event.clientY); };
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!hasMenu || editing || !(event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10')) return;
    event.preventDefault();
    const rect = rowRef.current!.getBoundingClientRect();
    open(rect.left + 24, rect.bottom + 6);
  };
  const startEdit = () => { close(); setDraft(task.title); setConflict(false); setEditing(true); };
  const saveEdit = () => {
    const title = draft.trim();
    if (!title || title === task.title) { setEditing(false); return; }
    if (onRename?.(task.id, title) === false) { setConflict(true); return; }
    setEditing(false);
  };
  const move = (date: string) => { close(true); onMove?.(task, date); };
  const today = localTaskDate(now);
  const nextMonday = dayAfter(now, ((8 - new Date(now).getDay()) % 7) || 7);
  const moveChoices = [
    ...(task.plannedDate && task.plannedDate !== today ? [{ label: uk ? 'Сьогодні' : 'Today', date: today }] : []),
    { label: uk ? 'Завтра' : 'Tomorrow', date: dayAfter(now, 1) },
    { label: uk ? 'Післязавтра' : 'In 2 days', date: dayAfter(now, 2) },
    { label: uk ? 'Наступний пн' : 'Next Mon', date: nextMonday },
  ].filter(choice => choice.date !== task.plannedDate);

  const title = editing
    ? <input autoFocus className="pulse-row-edit" aria-label={uk ? 'Назва задачі' : 'Task title'} aria-invalid={conflict || undefined} value={draft} maxLength={500}
        onChange={event => { setDraft(event.target.value); setConflict(false); }} onBlur={saveEdit}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); saveEdit(); } else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setEditing(false); } }} />
    : null;
  const duration = minutesLabel(task.plannedDurationSeconds ?? task.countdownDurationSeconds ?? task.scheduledDurationSeconds, lang);
  const time = task.scheduledFor ? new Date(task.scheduledFor).toLocaleTimeString(uk ? 'uk-UA' : 'en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
  const deadline = task.deadlineDate && task.deadlineDate !== localTaskDate(now) ? (uk ? 'до ' : 'by ') + formatTaskDate(task.deadlineDate, lang, now).toLowerCase() : '';
  const meta = task.done ? '' : time || deadline || duration || (tabs.find(tab => tab.id === task.phase)?.name ?? '');

  return <div className="pulse-row-wrap" ref={rowRef} onContextMenu={onContextMenu} onKeyDown={onKeyDown} data-menu-open={!!menu || calendarOpen || undefined}>
    {task.skillId ? <div className="pulse-practice-row">
      <span className="pulse-row-open">
        {title ?? <span className="pulse-practice-title">{task.title}</span>}
        {skillName && <span className="pulse-practice-skill">{skillName}</span>}
      </span>
      {duration && <span className="pulse-practice-time">{duration}</span>}
      <button type="button" className="pulse-practice-play" aria-label={(uk ? 'Почати: ' : 'Start: ') + task.title} data-tip={uk ? 'Почати' : 'Start'} onClick={() => onStart(task.id)}><Play size={18} fill="currentColor" aria-hidden="true" /></button>
    </div> : <div className="pulse-chore-row" data-done={task.done}>
      <button type="button" role="checkbox" aria-checked={task.done} aria-label={(uk ? 'Виконано: ' : 'Done: ') + task.title} className="pulse-chore-check" onClick={() => onToggleDone(task.id)}>{task.done && <Check size={14} strokeWidth={3} aria-hidden="true" />}</button>
      {title ?? <span className="pulse-row-open pulse-chore-title">{task.title}</span>}
      {meta && !editing && <span className="pulse-chore-meta">{meta}</span>}
    </div>}
    {calendarOpen && rowRef.current && <PulseCalendar lang={lang} value={task.plannedDate ?? ''} min={today} anchor={rowRef.current}
      onChange={date => { if (date !== task.plannedDate) onMove?.(task, date); }} onClose={() => setCalendarOpen(false)} />}
    {conflict && <p role="alert" className="pulse-row-conflict">{uk ? 'Назву вже змінено в іншому місці. Скасуйте й спробуйте ще раз.' : 'The title changed elsewhere. Cancel and try again.'}</p>}

    {menu && <div ref={menuRef} className="pulse-row-menu" role="menu" aria-label={uk ? 'Дії із задачею' : 'Task actions'} style={{ left: menu.x, top: menu.y }}>
      {onRename && <button type="button" role="menuitem" onClick={startEdit}><Pencil size={18} aria-hidden="true" />{uk ? 'Редагувати' : 'Edit'}</button>}
      {onMove && <button type="button" role="menuitem" aria-expanded={moveOpen} onClick={() => setMoveOpen(value => !value)}>
        <CalendarDays size={18} aria-hidden="true" />{uk ? 'Перенести' : 'Move'}<ChevronDown size={14} aria-hidden="true" className="pulse-row-menu-chevron" />
      </button>}
      {onMove && moveOpen && <div className="pulse-row-move">
        {moveChoices.map(choice => <button key={choice.date} type="button" onClick={() => move(choice.date)}>{choice.label}</button>)}
        <button type="button" onClick={() => { close(); setCalendarOpen(true); }}>{uk ? 'Дата…' : 'Date…'}</button>
      </div>}
      {onDelete && <button type="button" role="menuitem" className="pulse-row-menu-danger" onClick={() => { close(); onDelete(task.id); }}><Trash2 size={18} aria-hidden="true" />{uk ? 'Видалити' : 'Delete'}</button>}
    </div>}
  </div>;
}
