import React, { useMemo, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { NewTaskInput, TaskTab } from '../types';
import type { Language } from '../utils/i18n';
import { parseQuickAdd } from '../utils/quickAddParse';
import { describePlannedDate } from '../utils/taskDates';
import { DEFAULT_QUICK_ADD_PRIORITY } from './quickAddDraft';
import type { QuickAddPrefill } from './QuickAddDrawer';

interface QuickAddLineProps {
  tabs: TaskTab[];
  selectedPhase?: string;
  lang: Language;
  now: number;
  inputRef?: React.Ref<HTMLInputElement>;
  onAdd: (task: NewTaskInput) => void | boolean;
  onMoreOptions: (prefill: Omit<QuickAddPrefill, 'key'>) => void;
}

export const QuickAddLine: React.FC<QuickAddLineProps> = ({ tabs, selectedPhase, lang, now, inputRef, onAdd, onMoreOptions }) => {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const localInputRef = useRef<HTMLInputElement | null>(null);
  const composing = useRef(false);
  const parsed = useMemo(() => parseQuickAdd(text, tabs, now), [text, tabs, now]);
  const defaultPhase = tabs.some(tab => tab.id === selectedPhase) ? selectedPhase! : tabs[0]?.id || 'focus';
  const canAdd = !!parsed.title.trim();
  const focusClass = ' focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';
  const prefill = (): Omit<QuickAddPrefill, 'key'> => ({
    title: parsed.title,
    phase: parsed.phase || defaultPhase,
    priority: parsed.priority || DEFAULT_QUICK_ADD_PRIORITY,
    plannedDate: parsed.plannedDate,
    deadlineDate: parsed.deadlineDate,
  });
  const addTask = () => {
    if (!canAdd || composing.current) return;
    try {
      const accepted = onAdd({ ...prefill(), phase: parsed.phase || defaultPhase, priority: parsed.priority || DEFAULT_QUICK_ADD_PRIORITY, steps: 0, timerMode: 'stopwatch' });
      if (accepted === false) {
        setError(lang === 'uk' ? 'Не вдалося додати завдання. Спробуйте ще раз.' : 'Could not add the task. Try again.');
        return;
      }
      setText('');
      setError('');
      localInputRef.current?.focus({ preventScroll: true });
    } catch {
      setError(lang === 'uk' ? 'Не вдалося додати завдання. Спробуйте ще раз.' : 'Could not add the task. Try again.');
    }
  };
  // The wizard takes over the entry, so the line is cleared to avoid creating the task twice.
  const openWizard = () => { if (composing.current) return; onMoreOptions(prefill()); setText(''); setError(''); };
  const removeToken = (tokenIndex: number) => {
    // Walk recognized phrases in order so repeated words keep their meaning.
    let cursor = 0;
    let start = -1;
    let end = -1;
    for (const token of parsed.tokens.slice(0, tokenIndex + 1)) {
      start = text.indexOf(token.raw, cursor);
      while (start >= 0 && ((start > 0 && !/\s/.test(text[start - 1])) || (start + token.raw.length < text.length && !/\s/.test(text[start + token.raw.length])))) {
        start = text.indexOf(token.raw, start + 1);
      }
      if (start < 0) return;
      end = start + token.raw.length;
      cursor = end;
    }
    if (start >= 0) setText((text.slice(0, start) + text.slice(end)).replace(/\s+/g, ' ').trim());
    setError('');
    localInputRef.current?.focus({ preventScroll: true });
  };
  const chips = parsed.tokens.filter(token => token.kind !== 'planned' || !!parsed.plannedDate);

  return <div className="mb-4 border border-neutral-700 bg-[#0c0c0d]">
    <div className="flex min-h-12 flex-wrap items-center gap-x-2 px-2 sm:flex-nowrap sm:gap-3 sm:px-3">
      <Plus size={17} className="shrink-0 text-neutral-400" aria-hidden="true" />
      <input
        ref={node => { localInputRef.current = node; if (typeof inputRef === 'function') inputRef(node); else if (inputRef) inputRef.current = node; }}
        type="text"
        value={text}
        aria-label={lang === 'uk' ? 'Нове завдання' : 'New task'}
        placeholder={lang === 'uk' ? 'Нове завдання… напр. «Звіт завтра !1 #Робота»' : 'New task… e.g. “Report tomorrow !1 #Work”'}
        onChange={event => { setText(event.target.value); setError(''); }}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={event => {
          if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === 'Enter') {
            event.preventDefault(); event.stopPropagation();
            if (event.shiftKey) openWizard(); else addTask();
          } else if (event.key === 'Escape') {
            event.preventDefault(); event.stopPropagation(); setText(''); setError('');
          }
        }}
        className={'min-h-12 min-w-0 flex-1 basis-[calc(100%-2rem)] sm:basis-auto bg-transparent py-2 text-sm text-white placeholder:text-neutral-500' + focusClass}
      />
      <button type="button" onClick={openWizard} className={(text ? 'ml-auto ' : 'hidden sm:inline-flex ') + 'min-h-11 shrink-0 items-center px-1 text-xs text-neutral-400 hover:text-white sm:px-2' + focusClass}>{lang === 'uk' ? 'Детальніше' : 'More options'}</button>
      <button type="button" onClick={addTask} disabled={!canAdd} className={(text ? 'mb-2 sm:mb-0 ' : 'hidden sm:block ') + 'min-h-11 shrink-0 bg-white px-3 text-sm font-semibold text-black hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-40 sm:px-4' + focusClass}>{lang === 'uk' ? 'Додати' : 'Add'}</button>
    </div>
    {chips.length > 0 && <div className="flex flex-wrap gap-1.5 border-t border-neutral-800 px-3 py-1.5">
      {chips.map((token, index) => {
        const tab = token.kind === 'phase' ? tabs.find(item => item.id === token.value) : undefined;
        const label = token.kind === 'phase' ? tab?.name || token.value
          : token.kind === 'priority' ? 'P' + token.value
          : (token.kind === 'deadline' ? (lang === 'uk' ? 'Дедлайн' : 'Due') : (lang === 'uk' ? 'На' : 'For')) + ' ' + describePlannedDate(token.value, lang, now).label.toLowerCase();
        return <span key={token.kind + '-' + index} className="inline-flex items-center gap-1.5 border border-neutral-800 pl-2 text-[11px] text-neutral-300">
          {tab && <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 bg-neutral-400" style={tab.color ? { backgroundColor: tab.color } : undefined} />}
          <span>{label}</span>
          <button type="button" onClick={() => removeToken(parsed.tokens.indexOf(token))} aria-label={(lang === 'uk' ? 'Прибрати: ' : 'Remove: ') + label} className={'flex min-h-9 min-w-9 items-center justify-center text-neutral-500 hover:text-white [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11' + focusClass}><X size={12} aria-hidden="true" /></button>
        </span>;
      })}
    </div>}
    {error && <p role="alert" className="border-t border-neutral-800 px-3 py-2 text-xs text-red-400">{error}</p>}
  </div>;
};
