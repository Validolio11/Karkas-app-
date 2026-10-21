import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';
import type { GrowthSkill, NewTaskInput, TaskTab } from '../../types';
import type { Language } from '../../utils/i18n';
import { describePlannedDate } from '../../utils/taskDates';
import { QuickAddLine } from '../QuickAddLine';
import type { QuickAddPrefill } from '../QuickAddDrawer';
import { useDialogKeyboard } from '../useDialogKeyboard';
import './QuickEntry.css';

interface QuickAddDialogProps {
  tabs: TaskTab[];
  skills?: GrowthSkill[];
  selectedPhase?: string;
  lang: Language;
  now: number;
  onAdd: (task: NewTaskInput, proposedCategoryName?: string) => void | boolean;
  onMoreOptions: (prefill: Omit<QuickAddPrefill, 'key'>) => void;
  onClose: () => void;
}

/** «+ Додати» from any screen: one line over the dimmed page, as in QuickAdd.dc.html. */
export function QuickAddDialog({ tabs, skills, selectedPhase, lang, now, onAdd, onMoreOptions, onClose }: QuickAddDialogProps) {
  const uk = lang === 'uk';
  const [added, setAdded] = useState<{ id: number; title: string; meta: string }[]>([]);
  useDialogKeyboard(true, onClose, 'pulse-quick-dialog');
  const add = (task: NewTaskInput, proposedCategoryName?: string) => {
    const accepted = onAdd(task, proposedCategoryName);
    if (accepted === false) return false;
    const time = task.schedule ? new Date(task.schedule.startAt).toLocaleTimeString(uk ? 'uk-UA' : 'en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
    const meta = [task.plannedDate ? describePlannedDate(task.plannedDate, lang, now).label.toLowerCase() : '', time,
      proposedCategoryName || tabs.find(tab => tab.id === task.phase)?.name || ''].filter(Boolean).join(' · ');
    setAdded(previous => [{ id: Date.now(), title: task.title, meta }, ...previous].slice(0, 4));
    return accepted;
  };
  return createPortal(<div className="pulse-quick-overlay app-no-drag" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section id="pulse-quick-dialog" className="pulse-quick-panel" role="dialog" aria-modal="true" aria-label={uk ? 'Швидке додавання задачі' : 'Quick add task'}>
      <QuickAddLine dialog tabs={tabs} skills={skills} selectedPhase={selectedPhase} lang={lang} now={now} onAdd={add} onDismiss={onClose}
        onMoreOptions={prefill => { onClose(); onMoreOptions(prefill); }} />
      {added.length > 0 && <div className="pulse-quick-added">
        {added.map(item => <div key={item.id} className="pulse-quick-added-row">
          <span aria-hidden="true"><Check size={14} strokeWidth={3} /></span>
          <span className="pulse-quick-added-title">{item.title}</span>
          {item.meta && <span className="pulse-quick-added-meta">{item.meta}</span>}
        </div>)}
      </div>}
      <div className="pulse-quick-footer">
        <button type="button" className="pulse-quick-done" onClick={onClose}><Check size={18} strokeWidth={2.8} aria-hidden="true" />{uk ? 'Готово' : 'Done'}</button>
      </div>
    </section>
  </div>, document.body);
}
