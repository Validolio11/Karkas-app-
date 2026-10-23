import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Archive, ChevronLeft, Search, Trash2, Undo2, X } from 'lucide-react';
import type { Language } from '../../utils/i18n';
import { useDialogKeyboard } from '../useDialogKeyboard';
import './archive.css';

export type ArchiveKind = 'task' | 'note' | 'skill' | 'measurement' | 'practice';
export interface ArchiveItem {
  id: string;
  kind: ArchiveKind;
  title: string;
  at: number;
  status: 'completed' | 'deleted' | 'archived';
  detail?: string;
  description?: string;
  undoUntil?: number;
  restoreLabel?: string;
  canRestore?: boolean;
  canDeletePermanently?: boolean;
  deleteImpact?: string;
  countsAsCompleted?: boolean;
}
export interface ArchiveViewProps {
  lang: Language;
  items: readonly ArchiveItem[];
  onBack: () => void;
  onRestore: (item: ArchiveItem) => boolean | Promise<boolean>;
  onDeletePermanently?: (item: ArchiveItem, options?: { accidental?: boolean }) => boolean | Promise<boolean>;
}
const KINDS: readonly ArchiveKind[] = ['task', 'note', 'skill', 'measurement', 'practice'];
const COPY = {
  uk: {
    title: 'Архів', back: 'До налаштувань', hint: 'Відновлений запис відкриється на його робочому екрані.',
    all: 'Усе', types: { task: 'Завдання', note: 'Нотатки', skill: 'Навички', measurement: 'Заміри', practice: 'Практики' },
    type: { task: 'Завдання', note: 'Нотатка', skill: 'Навичка', measurement: 'Замір', practice: 'Практика' },
    states: { completed: 'Завершено', deleted: 'Видалено', archived: 'В архіві' },
    status: 'Стан запису', allStates: 'Усі стани', search: 'Знайти в Архіві', clear: 'Очистити пошук', records: 'Записів',
    restore: 'Відновити', working: 'Зберігаємо…', remove: 'Видалити назавжди', retry: 'Повторити',
    restoreError: 'Не вдалося повернути запис. Він залишається в Архіві.', deleteError: 'Не вдалося видалити. Запис залишається в Архіві.', changed: 'Запис змінився. Перегляньте його поточний стан перед видаленням.',
    removed: 'Запис видалено назавжди.', restored: 'Запис повернуто.', empty: 'Архів поки порожній', emptyHint: 'Тут будуть завершені та видалені записи.',
    noMatches: 'Записів не знайдено', noMatchesHint: 'Змініть запит або приберіть фільтри.', reset: 'Скинути фільтри',
    limit: 'Зберігаються деталі останніх 50 виконаних завдань. Загальна кількість завершень залишається у статистиці акаунта.',
    confirm: 'Видалити запис назавжди?', irreversible: 'Відновити цей запис після очищення буде неможливо.',
    keepCredit: 'Прибрати деталі, залишити завершення', accidental: 'Додано помилково, не зараховувати', cancel: 'Скасувати', close: 'Закрити',
  },
  en: {
    title: 'Archive', back: 'Back to settings', hint: 'Restoring a record opens its working screen.',
    all: 'All', types: { task: 'Tasks', note: 'Notes', skill: 'Skills', measurement: 'Measurements', practice: 'Practices' },
    type: { task: 'Task', note: 'Note', skill: 'Skill', measurement: 'Measurement', practice: 'Practice' },
    states: { completed: 'Completed', deleted: 'Deleted', archived: 'Archived' },
    status: 'Record status', allStates: 'All statuses', search: 'Search Archive', clear: 'Clear search', records: 'Records',
    restore: 'Restore', working: 'Saving…', remove: 'Delete permanently', retry: 'Retry',
    restoreError: 'Could not return this record. It remains in Archive.', deleteError: 'Could not delete this record. It remains in Archive.', changed: 'This record changed. Review its current state before deleting it.',
    removed: 'Record permanently deleted.', restored: 'Record returned.', empty: 'Archive is empty', emptyHint: 'Completed and deleted records will appear here.',
    noMatches: 'No matching records', noMatchesHint: 'Change your search or clear the filters.', reset: 'Clear filters',
    limit: 'Details of your latest 50 completed tasks are retained. Account statistics keep the total completion count.',
    confirm: 'Permanently delete this record?', irreversible: 'This record cannot be restored after permanent deletion.',
    keepCredit: 'Remove details, keep completion credit', accidental: 'Added by mistake, exclude completion', cancel: 'Cancel', close: 'Close',
  },
};
export const archiveItemKey = (item: Pick<ArchiveItem, 'kind' | 'id'>) => `${item.kind}:${item.id}`;
/** Deletion deadlines are stored by the domain, not by a timer in this view. */
export const archiveItemAvailableAt = (item: ArchiveItem): number => item.status === 'deleted' ? item.undoUntil ?? item.at + 8000 : 0;

function DeleteDialog({ item, lang, busy, error, onClose, onDelete }: {
  item: ArchiveItem; lang: Language; busy: boolean; error: boolean; onClose: () => void; onDelete: (accidental?: boolean) => void;
}) {
  const copy = COPY[lang], id = 'archive-confirm-' + useId().replace(/:/g, '');
  useDialogKeyboard(true, onClose, id);
  return createPortal(<div className="ar-confirm-overlay app-no-drag" onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section id={id} className="ar-confirm" role="alertdialog" aria-modal="true" aria-labelledby={id + '-title'} aria-describedby={id + '-impact'} aria-busy={busy}>
      <header><h2 id={id + '-title'}>{copy.confirm}</h2><button type="button" className="ar-icon-button" aria-label={copy.close} disabled={busy} onClick={onClose}><X size={20} aria-hidden="true" /></button></header>
      <p className="ar-confirm-name">{item.title}</p><p id={id + '-impact'}>{item.deleteImpact || copy.irreversible}</p>
      {item.deleteImpact && <p>{copy.irreversible}</p>}
      {item.countsAsCompleted ? <div className="ar-confirm-choices">
        <button type="button" disabled={busy} onClick={() => onDelete(false)}>{copy.keepCredit}</button>
        <button type="button" disabled={busy} onClick={() => onDelete(true)}>{copy.accidental}</button>
      </div> : <button type="button" className="ar-delete-confirm" disabled={busy} onClick={() => onDelete()}>{busy ? copy.working : copy.remove}</button>}
      {error && <p className="ar-error" role="alert">{copy.deleteError}</p>}
      <button type="button" className="ar-cancel" disabled={busy} onClick={onClose}>{copy.cancel}</button>
    </section>
  </div>, document.body);
}

export function ArchiveView({ lang, items, onBack, onRestore, onDeletePermanently }: ArchiveViewProps) {
  const copy = COPY[lang], id = 'archive-' + useId().replace(/:/g, '');
  const [query, setQuery] = useState(''), [kind, setKind] = useState<ArchiveKind | 'all'>('all');
  const [status, setStatus] = useState<ArchiveItem['status'] | 'all'>('all');
  const [clock, setClock] = useState(Date.now);
  const [pending, setPending] = useState<{ key: string; action: 'restore' | 'delete' } | null>(null);
  const [restoreErrors, setRestoreErrors] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<ArchiveItem | null>(null), [deleteError, setDeleteError] = useState(false), [notice, setNotice] = useState('');
  const searchRef = useRef<HTMLInputElement>(null), busyRef = useRef(false), aliveRef = useRef(true);
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, []);
  const nextRevealAt = items.reduce((nearest, item) => { const at = archiveItemAvailableAt(item); return at > clock ? Math.min(nearest, at) : nearest; }, Infinity);
  useEffect(() => {
    if (!Number.isFinite(nextRevealAt)) return;
    const timer = window.setTimeout(() => setClock(Date.now()), Math.min(2147483647, Math.max(0, nextRevealAt - Date.now() + 20)));
    return () => window.clearTimeout(timer);
  }, [nextRevealAt]);
  const available = useMemo(() => {
    const unique = new Map<string, ArchiveItem>();
    for (const item of items) {
      const key = archiveItemKey(item), before = unique.get(key);
      if (!before || item.at > before.at || item.at === before.at && item.status === 'deleted') unique.set(key, item);
    }
    // A pending tombstone must also hide an older completed copy with the same identity.
    return [...unique.values()].filter(item => archiveItemAvailableAt(item) <= clock)
      .sort((a, b) => b.at - a.at || archiveItemKey(a).localeCompare(archiveItemKey(b)));
  }, [items, clock]);
  const term = query.trim().toLocaleLowerCase(lang);
  const filtered = available.filter(item => (kind === 'all' || kind === item.kind) && (status === 'all' || status === item.status)
    && (!term || [item.title, item.description ?? '', item.detail ?? '', copy.type[item.kind], copy.states[item.status]].some(text => text.toLocaleLowerCase(lang).includes(term))));
  const filteredActive = !!term || kind !== 'all' || status !== 'all';
  const restore = async (item: ArchiveItem) => {
    if (busyRef.current) return;
    busyRef.current = true;
    const key = archiveItemKey(item);
    setPending({ key, action: 'restore' }); setNotice('');
    let success = false;
    try { success = await onRestore(item); } catch { /* Keep the record available for retry. */ }
    busyRef.current = false;
    if (!aliveRef.current) return;
    setPending(null);
    setRestoreErrors(previous => { const next = new Set(previous); if (success) next.delete(key); else next.add(key); return next; });
    if (success) setNotice(copy.restored);
  };
  const remove = async (accidental?: boolean) => {
    if (!confirm || !onDeletePermanently || busyRef.current) return;
    const current = available.find(item => archiveItemKey(item) === archiveItemKey(confirm));
    if (!current || current.at !== confirm.at || current.status !== confirm.status || current.title !== confirm.title
      || current.canDeletePermanently !== confirm.canDeletePermanently || current.countsAsCompleted !== confirm.countsAsCompleted) {
      setConfirm(null); setDeleteError(false); setNotice(copy.changed); searchRef.current?.focus(); return;
    }
    busyRef.current = true; setPending({ key: archiveItemKey(confirm), action: 'delete' }); setDeleteError(false); setNotice('');
    let success = false;
    try { success = await onDeletePermanently(confirm, { accidental }); } catch { /* Never hide an unsaved removal. */ }
    busyRef.current = false;
    if (!aliveRef.current) return;
    setPending(null);
    if (success) { setConfirm(null); setNotice(copy.removed); requestAnimationFrame(() => searchRef.current?.focus()); } else setDeleteError(true);
  };
  const reset = () => { setQuery(''); setKind('all'); setStatus('all'); searchRef.current?.focus(); };
  return <div className="pulse-page-shell ar-view" aria-labelledby={id + '-title'}>
    <div className="pulse-page-head"><div className="pulse-page-head-copy"><h1 id={id + '-title'} className="pulse-page-title"><span className="pulse-page-title-heavy">{copy.title}</span></h1><p className="ar-intro">{copy.hint}</p></div><button type="button" className="ar-back ar-icon-button" aria-label={copy.back} onClick={onBack}><ChevronLeft size={21} aria-hidden="true" /></button></div>
    <section className="ar-content" aria-label={copy.title}>
      <div className="ar-toolbar"><label className="ar-search"><Search size={19} aria-hidden="true" /><span className="ar-sr-only">{copy.search}</span><input ref={searchRef} type="search" value={query} placeholder={copy.search} onChange={event => setQuery(event.target.value)} />{query && <button type="button" className="ar-icon-button" aria-label={copy.clear} onClick={() => { setQuery(''); searchRef.current?.focus(); }}><X size={17} aria-hidden="true" /></button>}</label>
        <label className="ar-status-filter"><span className="ar-sr-only">{copy.status}</span><select value={status} onChange={event => setStatus(event.target.value as typeof status)}><option value="all">{copy.allStates}</option>{(['completed', 'deleted', 'archived'] as const).map(value => <option key={value} value={value}>{copy.states[value]}</option>)}</select></label></div>
      <div className="ar-filters" role="group" aria-label={copy.title}><button type="button" aria-pressed={kind === 'all'} onClick={() => setKind('all')}>{copy.all}<span>{available.length}</span></button>{KINDS.map(value => <button key={value} type="button" aria-pressed={kind === value} onClick={() => setKind(value)}>{copy.types[value]}<span>{available.filter(item => item.kind === value).length}</span></button>)}</div>
      <div className="ar-list-head"><span>{copy.records}: {filtered.length}</span><span role="status">{notice}</span></div>
      {filtered.length ? <ul className="ar-list">{filtered.map(item => {
        const key = archiveItemKey(item), failed = restoreErrors.has(key), date = new Date(item.at), validDate = Number.isFinite(date.getTime());
        return <li key={key} className="ar-record" data-archive-kind={item.kind} data-archive-id={item.id}><div className="ar-record-copy"><div className="ar-record-markers"><span>{copy.type[item.kind]}</span><span data-state={item.status}>{copy.states[item.status]}</span><time dateTime={validDate ? date.toISOString() : undefined}>{validDate ? date.toLocaleString(lang === 'uk' ? 'uk-UA' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</time></div><h2>{item.title}</h2>{item.detail && <p className="ar-detail">{item.detail}</p>}{item.description && <p className="ar-description">{item.description}</p>}{failed && <p className="ar-error" role="alert">{copy.restoreError}</p>}</div>
          <div className="ar-record-actions">{item.canRestore !== false && <button type="button" className="ar-restore" disabled={!!pending} aria-label={`${failed ? copy.retry : item.restoreLabel || copy.restore}: ${item.title}`} onClick={() => void restore(item)}><Undo2 size={17} aria-hidden="true" />{pending?.key === key && pending.action === 'restore' ? copy.working : failed ? copy.retry : item.restoreLabel || copy.restore}</button>}{onDeletePermanently && item.canDeletePermanently && <button type="button" className="ar-icon-button ar-purge" disabled={!!pending} aria-label={`${copy.remove}: ${item.title}`} onClick={() => { setDeleteError(false); setConfirm(item); }}><Trash2 size={18} aria-hidden="true" /></button>}</div></li>;
      })}</ul> : <div className="ar-empty" role="status"><Archive size={30} aria-hidden="true" /><h2>{filteredActive ? copy.noMatches : copy.empty}</h2><p>{filteredActive ? copy.noMatchesHint : copy.emptyHint}</p>{filteredActive && <button type="button" className="ar-restore" onClick={reset}>{copy.reset}</button>}</div>}
      <p className="ar-limit">{copy.limit}</p>
    </section>
    {confirm && <DeleteDialog item={confirm} lang={lang} busy={!!pending} error={deleteError} onClose={() => { if (!busyRef.current) setConfirm(null); }} onDelete={accidental => void remove(accidental)} />}
  </div>;
}
