import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { Plus, SlidersHorizontal, X } from 'lucide-react';
import type { TaskTab } from '../../types';
import './today.css';

interface CategorySwitcherProps {
  tabs: readonly TaskTab[];
  lang: 'uk' | 'en';
  selected: string;
  total: number;
  counts: Record<string, number>;
  labelOf: (tab: TaskTab) => string;
  onSelect: (id: string) => void;
  onAdd: (name: string) => void | boolean;
  /** Renaming, colours and deleting stay in the full category manager. */
  onManage: () => void;
}

/** «Усі · Робота · …» with the new category typed in place, as in Today.dc.html. */
export function CategorySwitcher({ tabs, lang, selected, total, counts, labelOf, onSelect, onAdd, onManage }: CategorySwitcherProps) {
  const uk = lang === 'uk';
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const entry = useRef<HTMLSpanElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const formId = useId();
  useLayoutEffect(() => {
    if (!adding) return;
    input.current?.focus({ preventScroll: true });
  }, [adding]);
  const close = (restoreFocus = false) => {
    setAdding(false); setName(''); setError(false);
    if (restoreFocus) requestAnimationFrame(() => addButton.current?.focus({ preventScroll: true }));
  };
  const create = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const existing = tabs.find(tab => labelOf(tab).toLowerCase() === trimmed.toLowerCase());
    if (existing) onSelect(existing.id);
    else {
      try { if (onAdd(trimmed) === false) { setError(true); input.current?.focus({ preventScroll: true }); return; } }
      catch { setError(true); input.current?.focus({ preventScroll: true }); return; }
    }
    close(true);
  };
  return <div className="pulse-category-switcher" role="group" aria-label={uk ? 'Категорії' : 'Categories'}>
    <button type="button" aria-pressed={selected === 'ALL'} onClick={() => onSelect('ALL')}>{uk ? 'Усі' : 'All'} {total}</button>
    {tabs.map(tab => <button key={tab.id} type="button" aria-pressed={selected === tab.id} onClick={() => onSelect(tab.id)}
      onContextMenu={event => { event.preventDefault(); onManage(); }}>{labelOf(tab)} {counts[tab.id] || 0}</button>)}
    <span ref={entry} className="pulse-category-entry" data-open={adding} style={{ transition: adding ? 'none' : undefined }} onKeyDown={event => {
      if (adding && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    }}>
    <span id={formId} className="pulse-category-new" inert={!adding}>
      <input ref={input} type="text" aria-label={uk ? 'Назва категорії' : 'Category name'} aria-invalid={error || undefined} aria-describedby={error ? formId + '-error' : undefined} placeholder={uk ? 'Назва категорії' : 'Category name'} maxLength={40} value={name}
        onChange={event => { setName(event.target.value); setError(false); }}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); create(); } else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); } }}
        onBlur={event => { if (!name.trim() && !event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null)) close(); }} />
      <button type="button" className="pulse-category-create" data-ready={!!name.trim()} disabled={!name.trim()} onClick={create}>{uk ? 'Створити' : 'Create'}</button>
      <button type="button" className="pulse-category-cancel" aria-label={uk ? 'Скасувати' : 'Cancel'} onClick={() => close(true)}><X size={14} strokeWidth={2.4} aria-hidden="true" /></button>
    </span>
    <button ref={addButton} type="button" className="pulse-category-add" aria-label={uk ? 'Нова категорія' : 'New category'} data-tip={uk ? 'Нова категорія' : 'New category'}
      aria-expanded={adding} aria-controls={formId} inert={adding} tabIndex={adding ? -1 : undefined}
      onClick={() => setAdding(true)} onContextMenu={event => { event.preventDefault(); onManage(); }}><Plus size={18} aria-hidden="true" /></button>
    </span>
    <button type="button" aria-label={uk ? 'Керувати категоріями' : 'Manage categories'} data-tip={uk ? 'Керувати категоріями' : 'Manage categories'} onClick={onManage}><SlidersHorizontal size={17} aria-hidden="true" /></button>
    {error && <span id={formId + '-error'} role="alert" style={{ flexBasis: '100%', padding: '6px 12px', color: '#ff9a9b', fontSize: 12 }}>{uk ? 'Не вдалося створити категорію. Назва збережена — спробуйте ще раз.' : 'Could not create this category. Your name is retained; try again.'}</span>}
  </div>;
}
