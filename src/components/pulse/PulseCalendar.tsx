import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { localTaskDate } from '../../utils/taskDates';
import './calendar.css';

interface PulseCalendarProps {
  lang: 'uk' | 'en';
  /** «YYYY-MM-DD» or empty. */
  value: string;
  min?: string;
  anchor: HTMLElement;
  /** Grow down and left from this control, scrolling the page to reveal the panel. */
  revealFrom?: HTMLElement;
  onChange: (date: string) => void;
  onClose: () => void;
  onClear?: () => void;
}

const MONTHS = {
  uk: ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};
const WEEKDAYS = { uk: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'], en: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] };
const parse = (value: string) => { const [year, month, day] = value.split('-').map(Number); return new Date(year, month - 1, day, 12); };
const shift = (value: string, days: number) => { const date = parse(value); date.setDate(date.getDate() + days); return localTaskDate(date.getTime()); };
const WIDTH = 336;

/** Month grid in Pulse terms, weeks from Monday; arrows move by day, Page keys by month. */
export function PulseCalendar({ lang, value, min, anchor, revealFrom, onChange, onClose, onClear }: PulseCalendarProps) {
  const uk = lang === 'uk';
  const today = localTaskDate(Date.now());
  const [focus, setFocus] = useState(value || (min && min > today ? min : today));
  const [month, setMonth] = useState(() => { const date = parse(value || focus); return new Date(date.getFullYear(), date.getMonth(), 1, 12); });
  const panel = useRef<HTMLDivElement>(null);
  const scrollSpace = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;
    if (!revealFrom) {
      const rect = anchor.getBoundingClientRect();
      const height = element.offsetHeight;
      const below = rect.bottom + 8;
      const top = below + height > window.innerHeight - 12 ? Math.max(12, rect.top - height - 8) : below;
      element.style.left = Math.max(12, Math.min(rect.left, window.innerWidth - WIDTH - 12)) + 'px';
      element.style.top = top + 'px';
      return;
    }

    const oldMarginTop = revealFrom.style.scrollMarginTop;
    const oldMarginBottom = revealFrom.style.scrollMarginBottom;
    let frame = 0;
    let scrolling = false;
    const position = (reveal = false) => {
      // Web settings apply CSS zoom to <html>; DOM rects already include it.
      const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
      const viewport = window.visualViewport;
      const viewLeft = viewport?.offsetLeft ?? 0;
      const viewTop = viewport?.offsetTop ?? 0;
      const viewWidth = viewport?.width ?? document.documentElement.clientWidth;
      const viewHeight = viewport?.height ?? window.innerHeight;
      const rect = revealFrom.getBoundingClientRect();
      const width = Math.min(WIDTH, (viewWidth - 24) / zoom);
      element.style.width = width + 'px';
      element.style.maxHeight = Math.max(40, (viewHeight - 24) / zoom) + 'px';
      const height = element.offsetHeight * zoom;
      const left = Math.max(viewLeft + 12, Math.min(rect.right - width * zoom, viewLeft + viewWidth - width * zoom - 12));
      element.style.left = left / zoom + 'px';
      element.style.top = rect.top / zoom + 'px';
      element.style.setProperty('--calendar-from-x', (rect.right - left - width * zoom) / zoom + 'px');
      element.style.setProperty('--calendar-from-scale-x', String(rect.width / (width * zoom)));
      element.style.setProperty('--calendar-from-scale-y', String(rect.height / height));
      element.dataset.positioned = 'true';

      if (!reveal) return;
      // The portal is fixed. Reserve only the missing space at the document end.
      const space = scrollSpace.current;
      if (space) space.style.height = Math.max(0, (rect.top + height + 12 - space.getBoundingClientRect().top) / zoom) + 'px';
      if (rect.top >= viewTop + 12 && rect.top + height <= viewTop + viewHeight - 12) return;
      // Let native scrolling account for CSS zoom and scroll only as far as needed.
      revealFrom.style.scrollMarginTop = 12 / zoom + 'px';
      revealFrom.style.scrollMarginBottom = Math.max(0, (height - rect.height + 12) / zoom) + 'px';
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('karkas-reduce-motion');
      scrolling = !reduceMotion;
      revealFrom.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduceMotion ? 'instant' : 'smooth' });
    };
    const follow = () => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; position(); });
    };
    const resize = () => position(true);
    const finishScroll = () => { scrolling = false; };
    window.addEventListener('scroll', follow, true);
    window.addEventListener('scrollend', finishScroll);
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('scroll', follow);
    const observer = new ResizeObserver(follow);
    observer.observe(anchor);
    observer.observe(element);
    position(true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('scroll', follow, true);
      window.removeEventListener('scrollend', finishScroll);
      window.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('scroll', follow);
      if (scrolling) window.scrollTo({ left: window.scrollX, top: window.scrollY, behavior: 'instant' });
      revealFrom.style.scrollMarginTop = oldMarginTop;
      revealFrom.style.scrollMarginBottom = oldMarginBottom;
    };
  }, [anchor, revealFrom]);
  useEffect(() => {
    const onDown = (event: MouseEvent) => { if (!panel.current?.contains(event.target as Node) && !anchor.contains(event.target as Node)) onClose(); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); (revealFrom ?? anchor).focus({ preventScroll: true }); } };
    const onScroll = (event: Event) => { if (!revealFrom && !panel.current?.contains(event.target as Node)) onClose(); };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    return () => { document.removeEventListener('mousedown', onDown, true); document.removeEventListener('keydown', onKey, true); window.removeEventListener('scroll', onScroll, true); };
  }, [anchor, revealFrom, onClose]);
  useEffect(() => {
    const element = panel.current;
    const day = element?.querySelector<HTMLElement>('[data-focus="true"]');
    day?.focus({ preventScroll: true });
    if (!element || !day || !revealFrom) return;
    // On short windows, keep keyboard navigation visible within the calendar only.
    let top = day.offsetTop;
    let parent = day.offsetParent as HTMLElement | null;
    while (parent && parent !== element) { top += parent.offsetTop; parent = parent.offsetParent as HTMLElement | null; }
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + day.offsetHeight > element.scrollTop + element.clientHeight) element.scrollTop = top + day.offsetHeight - element.clientHeight;
  }, [focus, month, revealFrom]);

  const moveFocus = (next: string) => {
    if (min && next < min) next = min;
    setFocus(next);
    const date = parse(next);
    if (date.getMonth() !== month.getMonth() || date.getFullYear() !== month.getFullYear()) setMonth(new Date(date.getFullYear(), date.getMonth(), 1, 12));
  };
  const pick = (date: string) => { if (min && date < min) return; onChange(date); onClose(); (revealFrom ?? anchor).focus({ preventScroll: true }); };
  const changeMonth = (delta: number) => setMonth(current => new Date(current.getFullYear(), current.getMonth() + delta, 1, 12));
  const first = new Date(month);
  const lead = (first.getDay() + 6) % 7;
  const start = new Date(first); start.setDate(1 - lead);
  const days = Array.from({ length: 42 }, (_, index) => { const date = new Date(start); date.setDate(start.getDate() + index); return date; });
  const minMonth = min ? parse(min) : null;
  const canGoBack = !minMonth || month.getFullYear() > minMonth.getFullYear() || month.getFullYear() === minMonth.getFullYear() && month.getMonth() > minMonth.getMonth();

  return createPortal(<><div ref={panel} className="pulse-calendar app-no-drag" data-from-icon={!!revealFrom || undefined} role="dialog" aria-label={uk ? 'Вибір дати' : 'Choose a date'} style={{ left: -9999, top: -9999 }} onClick={event => event.stopPropagation()}>
    <div className="pulse-calendar-head">
      <span className="pulse-calendar-title" aria-live="polite">{MONTHS[lang][month.getMonth()]} <span>{month.getFullYear()}</span></span>
      <button type="button" aria-label={uk ? 'Попередній місяць' : 'Previous month'} disabled={!canGoBack} onClick={() => changeMonth(-1)}><ChevronLeft size={18} aria-hidden="true" /></button>
      <button type="button" aria-label={uk ? 'Наступний місяць' : 'Next month'} onClick={() => changeMonth(1)}><ChevronRight size={18} aria-hidden="true" /></button>
    </div>
    <div className="pulse-calendar-grid" role="grid" key={month.getFullYear() + '-' + month.getMonth()}
      onKeyDown={event => {
        const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
        if (event.key in moves) { event.preventDefault(); moveFocus(shift(focus, moves[event.key])); }
        else if (event.key === 'PageUp' || event.key === 'PageDown') {
          event.preventDefault();
          const date = parse(focus); date.setMonth(date.getMonth() + (event.key === 'PageUp' ? -1 : 1)); moveFocus(localTaskDate(date.getTime()));
        } else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pick(focus); }
      }}>
      {WEEKDAYS[lang].map(day => <span key={day} role="columnheader" className="pulse-calendar-weekday">{day}</span>)}
      {days.map(date => {
        const iso = localTaskDate(date.getTime());
        const outside = date.getMonth() !== month.getMonth();
        const disabled = !!min && iso < min;
        return <button key={iso} type="button" role="gridcell" tabIndex={iso === focus ? 0 : -1} data-focus={iso === focus}
          aria-selected={iso === value} aria-disabled={disabled || undefined} aria-label={date.toLocaleDateString(uk ? 'uk-UA' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          className="pulse-calendar-day" data-outside={outside || undefined} data-today={iso === today || undefined} data-weekend={date.getDay() === 0 || date.getDay() === 6 || undefined}
          onClick={() => pick(iso)}>{date.getDate()}</button>;
      })}
    </div>
    <div className="pulse-calendar-foot">
      {onClear && value ? <button type="button" className="pulse-calendar-clear" onClick={() => { onClear(); onClose(); (revealFrom ?? anchor).focus({ preventScroll: true }); }}>{uk ? 'Очистити' : 'Clear'}</button> : <span />}
      {(!min || today >= min) && <button type="button" className="pulse-calendar-today" onClick={() => pick(today)}>{uk ? 'Сьогодні' : 'Today'}</button>}
    </div>
  </div>{revealFrom && <div ref={scrollSpace} className="pulse-calendar-scroll-space" aria-hidden="true" />}</>, document.body);
}
