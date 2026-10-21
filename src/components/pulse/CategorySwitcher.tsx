import React, { useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
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
  onAdd: (name: string) => void;
  /** Renaming, colours and deleting stay in the full category manager. */
  onManage: () => void;
}

/** «Усі · Робота · …» with the new category typed in place, as in Today.dc.html. */
export function CategorySwitcher({ tabs, lang, selected, total, counts, labelOf, onSelect, onAdd, onManage }: CategorySwitcherProps) {
  const uk = lang === 'uk';
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (adding) input.current?.focus({ preventScroll: true }); }, [adding]);
  const close = () => { setAdding(false); setName(''); };
  const create = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const existing = tabs.find(tab => labelOf(tab).toLowerCase() === trimmed.toLowerCase());
    if (existing) onSelect(existing.id); else onAdd(trimmed);
    close();
  };
  return <div className="pulse-category-switcher" role="group" aria-label={uk ? 'Категорії' : 'Categories'}>
    <button type="button" aria-pressed={selected === 'ALL'} onClick={() => onSelect('ALL')}>{uk ? 'Усі' : 'All'} {total}</button>
    {tabs.map(tab => <button key={tab.id} type="button" aria-pressed={selected === tab.id} onClick={() => onSelect(tab.id)}
      onContextMenu={event => { event.preventDefault(); onManage(); }}>{labelOf(tab)} {counts[tab.id] || 0}</button>)}
    {adding ? <span className="pulse-category-new">
      <input ref={input} type="text" aria-label={uk ? 'Назва категорії' : 'Category name'} placeholder={uk ? 'Назва категорії' : 'Category name'} maxLength={40} value={name}
        onChange={event => setName(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); create(); } else if (event.key === 'Escape') { event.preventDefault(); close(); } }}
        onBlur={event => { if (!name.trim() && !event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null)) close(); }} />
      <button type="button" className="pulse-category-create" data-ready={!!name.trim()} disabled={!name.trim()} onClick={create}>{uk ? 'Створити' : 'Create'}</button>
      <button type="button" className="pulse-category-cancel" aria-label={uk ? 'Скасувати' : 'Cancel'} onClick={close}><X size={14} strokeWidth={2.4} aria-hidden="true" /></button>
    </span> : <button type="button" className="pulse-category-add" aria-label={uk ? 'Нова категорія' : 'New category'} data-tip={uk ? 'Нова категорія' : 'New category'}
      onClick={() => setAdding(true)} onContextMenu={event => { event.preventDefault(); onManage(); }}><Plus size={18} aria-hidden="true" /></button>}
  </div>;
}
