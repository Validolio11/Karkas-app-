import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { NoteDoc, NoteSeg, NoteSegStyle, NotepadNote } from '../types';
import type { Language } from '../utils/i18n';
import { docText, noteDoc, numberLabels, tidySegs } from '../utils/noteDoc';
import { KarkasLogo } from './pulse/KarkasLogo';
import './notepad.css';

interface NotepadViewProps {
  ownerId?: string | null;
  lang: Language;
  notes: NotepadNote[];
  onAddNote: (note: Omit<NotepadNote, 'id' | 'createdAt'> & { id?: string }) => boolean;
  onUpdateNote: (id: string, updates: Partial<NotepadNote>) => boolean;
  onDeleteNote: (id: string) => boolean;
  onRestoreNote: (note: NotepadNote) => boolean;
  onMakeTasks?: (note: NotepadNote) => void;
  storageError?: boolean;
}

type Kind = 'lesson' | 'idea';
type Filter = 'all' | Kind;
interface Menu { text: string; seg: number; x: number; y: number; chip?: number; fseg?: number }
interface Toast { text: string; undo?: () => void }

const COPY = {
  uk: {
    title: ['Мій', 'блокнот'], filter: 'Фільтр', filters: { all: 'Усі', lesson: 'Висновки', idea: 'Ідеї' } as Record<Filter, string>,
    search: 'Пошук', searchLabel: 'Пошук нотаток', newNote: 'Нова нотатка', untitled: 'Без назви', pinned: 'Закріплено', note: 'Нотатка',
    kinds: { lesson: 'Висновок', idea: 'Ідея' } as Record<Kind, string>, kindLabel: 'Тип нотатки', append: 'Дописати', titleLabel: 'Назва нотатки',
    appendLabel: 'Дописати текст', appendPlaceholder: 'Пишіть тут…', emptyPage: 'Порожня сторінка', makeTasks: 'Зробити задачі',
    pages: 'Сторінки', page: 'Сторінка', addPage: 'Нова сторінка', pin: 'Закріпити', unpin: 'Відкріпити', remove: 'Видалити',
    menu: 'Дії з виділеним', font: 'Шрифт', fontSearch: 'Пошук шрифту', fonts: 'Шрифти', size: 'Розмір шрифту', smaller: 'Менше', bigger: 'Більше',
    weight: 'Товщина', weights: ['Тонкий', 'Звичайний', 'Жирний'], numbering: 'Нумерація', copy: 'Копіювати', paste: 'Вставити',
    chip: 'Кнопка копіювання', plain: 'Звичайний текст', undo: 'Скасувати',
    copied: 'Скопійовано', pasted: 'Вставлено', chipAdded: 'Кнопку додано', chipRemoved: 'Кнопку прибрано', deleted: 'Видалено',
    numbersOn: 'Нумерацію додано', numbersOff: 'Нумерацію прибрано', pinnedTop: 'Закріплено вгорі', unpinned: 'Відкріплено', noteDeleted: 'Нотатку видалено',
    now: 'Щойно', today: 'Сьогодні', yesterday: 'Вчора', empty: 'Тут поки порожньо', saveFailed: 'Не вдалося зберегти нотатку',
    storage: 'Нотатки не зберігаються на цьому пристрої. Перевір місце у сховищі.',
  },
  en: {
    title: ['My', 'notebook'], filter: 'Filter', filters: { all: 'All', lesson: 'Lessons', idea: 'Ideas' } as Record<Filter, string>,
    search: 'Search', searchLabel: 'Search notes', newNote: 'New note', untitled: 'Untitled', pinned: 'Pinned', note: 'Note',
    kinds: { lesson: 'Lesson', idea: 'Idea' } as Record<Kind, string>, kindLabel: 'Note type', append: 'Write more', titleLabel: 'Note title',
    appendLabel: 'Write more text', appendPlaceholder: 'Write here…', emptyPage: 'Empty page', makeTasks: 'Make tasks',
    pages: 'Pages', page: 'Page', addPage: 'New page', pin: 'Pin', unpin: 'Unpin', remove: 'Delete',
    menu: 'Selection actions', font: 'Font', fontSearch: 'Search fonts', fonts: 'Fonts', size: 'Font size', smaller: 'Smaller', bigger: 'Bigger',
    weight: 'Weight', weights: ['Light', 'Regular', 'Bold'], numbering: 'Numbering', copy: 'Copy', paste: 'Paste',
    chip: 'Copy button', plain: 'Plain text', undo: 'Undo',
    copied: 'Copied', pasted: 'Pasted', chipAdded: 'Button added', chipRemoved: 'Button removed', deleted: 'Deleted',
    numbersOn: 'Numbering added', numbersOff: 'Numbering removed', pinnedTop: 'Pinned to top', unpinned: 'Unpinned', noteDeleted: 'Note deleted',
    now: 'Just now', today: 'Today', yesterday: 'Yesterday', empty: 'Nothing here yet', saveFailed: 'Could not save the note',
    storage: 'Notes are not being saved on this device. Check the available storage.',
  },
};

const UK_MONTHS = ['січ', 'лют', 'бер', 'квіт', 'трав', 'черв', 'лип', 'сер', 'вер', 'жовт', 'лист', 'груд'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const BASE_FONTS = ['Inter', 'Segoe UI', 'Segoe UI Variable', 'Arial', 'Bahnschrift', 'Calibri', 'Cambria', 'Candara', 'Comic Sans MS', 'Consolas',
  'Constantia', 'Corbel', 'Courier New', 'Franklin Gothic Medium', 'Gabriola', 'Georgia', 'Impact', 'Lucida Console', 'Lucida Sans Unicode',
  'Palatino Linotype', 'Segoe Print', 'Segoe Script', 'Sitka Text', 'Sylfaen', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'];
const WEIGHTS = [300, 500, 800];
const ICONS = {
  copy: 'M8 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2zM16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2',
  check: 'M20 6 9 17l-5-5',
  trash: 'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
  paste: 'M9 3h6a1 1 0 0 1 1 1v2H8V4a1 1 0 0 1 1-1zM8 5H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2',
  text: 'M4 7V5h16v2M9 19h6M12 5v14',
  list: 'M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1',
};
const CHIP_ICON = ICONS.copy + 'M14 11v6M11 14h6';
const PIN_PATH = 'M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z';

const fontFamily = (name?: string) => !name || name === 'Inter' ? "'SF Pro Display', Inter, sans-serif" : "'" + name.replace(/'/g, '') + "', 'Segoe UI', sans-serif";
const kindOf = (note: NotepadNote): Kind => note.kind ?? 'idea';
const Path = ({ d, size = 18, width = 2 }: { d: string; size?: number; width?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;

function noteDate(at: number, now: number, lang: Language) {
  const copy = COPY[lang];
  const date = new Date(at), today = new Date(now);
  const day = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  if (now - at < 60_000) return copy.now;
  const diff = Math.round((day(today) - day(date)) / 864e5);
  if (diff === 0) return copy.today + ', ' + date.toLocaleTimeString(lang === 'uk' ? 'uk-UA' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
  if (diff === 1) return copy.yesterday;
  return lang === 'uk' ? date.getDate() + ' ' + UK_MONTHS[date.getMonth()] : EN_MONTHS[date.getMonth()] + ' ' + date.getDate();
}

export const NotepadView: React.FC<NotepadViewProps> = ({ lang, notes, onAddNote, onUpdateNote, onDeleteNote, onRestoreNote, onMakeTasks, storageError = false }: NotepadViewProps) => {
  const copy = COPY[lang];
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string>();
  const [freshId, setFreshId] = useState<string>();
  const [justAdded, setJustAdded] = useState<string>();
  const [pageOf, setPageOf] = useState<Record<string, number>>({});
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [menu, setMenu] = useState<Menu | null>(null);
  const [fontsOpen, setFontsOpen] = useState(false);
  const [fontQuery, setFontQuery] = useState('');
  const [fontNames, setFontNames] = useState<string[]>();
  const [copiedSeg, setCopiedSeg] = useState(-1);
  const [toast, setToast] = useState<Toast | null>(null);
  const [now, setNow] = useState(Date.now());
  const sectionRef = useRef<HTMLElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const appendRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const history = useRef<{ id: string; doc: NoteDoc }[]>([]);
  const toastTimer = useRef<number>();
  const copyTimer = useRef<number>();
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);
  useEffect(() => () => { window.clearTimeout(toastTimer.current); window.clearTimeout(copyTimer.current); }, []);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return notes.filter(note => (filter === 'all' || kindOf(note) === filter)
      && (!needle || note.title.toLowerCase().includes(needle) || note.content.toLowerCase().includes(needle)))
      .slice().sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
  }, [notes, filter, query]);
  const current = shown.find(note => note.id === selectedId) ?? shown[0];
  const doc = current ? noteDoc(current) : { pages: [[]] };
  const page = current ? Math.min(pageOf[current.id] ?? 0, doc.pages.length - 1) : 0;
  const segs = doc.pages[page] ?? [];

  const flash = (next: Toast | null, long = false) => {
    window.clearTimeout(toastTimer.current);
    setToast(next);
    if (next) toastTimer.current = window.setTimeout(() => setToast(null), long ? 4000 : 1600);
  };
  const saveDoc = (note: NotepadNote, next: NoteDoc, remember = true) => {
    if (remember) history.current = [...history.current, { id: note.id, doc: noteDoc(note) }].slice(-20);
    const ok = onUpdateNote(note.id, { doc: next, content: docText(next), updatedAt: Date.now() });
    if (!ok) flash({ text: copy.saveFailed });
    return ok;
  };
  const savePage = (nextSegs: NoteSeg[], message?: string) => {
    if (!current) return;
    const pages = doc.pages.map((value, index) => index === page ? tidySegs(nextSegs) : value);
    if (saveDoc(current, { pages }) && message) flash({ text: message, undo }, true);
  };
  const undo = () => {
    const last = history.current.pop();
    const note = last && notes.find(item => item.id === last.id);
    if (!last || !note) return;
    saveDoc(note, last.doc, false);
    setMenu(null); flash(null);
  };
  const dropEmptyFresh = () => {
    const fresh = freshId && notes.find(note => note.id === freshId);
    if (fresh && !fresh.title.trim() && !fresh.content.trim()) onDeleteNote(fresh.id);
    setFreshId(undefined);
  };
  const commitTitle = () => {
    if (current && editing && titleDraft !== current.title) onUpdateNote(current.id, { title: titleDraft, updatedAt: Date.now() });
  };
  const appendText = (keepFocus: boolean) => {
    const box = appendRef.current;
    if (!box || !current) return;
    const text = box.value.replace(/\s+$/, '');
    if (!text.trim()) return;
    const lines = text.split('\n').flatMap((line, index) => index ? [{ t: 'br', v: '' } as NoteSeg, { t: 'text', v: line } as NoteSeg] : [{ t: 'text', v: line } as NoteSeg]);
    savePage([...segs, ...(segs.length ? [{ t: 'br', v: '' } as NoteSeg] : []), ...lines]);
    box.value = ''; box.style.height = 'auto';
    if (keepFocus) box.focus();
  };
  const stopEditing = () => { appendText(false); commitTitle(); setEditing(false); };
  const select = (id: string) => {
    if (editing) stopEditing();
    if (freshId && freshId !== id) dropEmptyFresh();
    setSelectedId(id); setEditing(false); setMenu(null);
  };
  const startEditing = (focusTitle = false) => {
    if (!current) return;
    setTitleDraft(current.title); setEditing(true); setMenu(null);
    window.setTimeout(() => (focusTitle ? titleRef.current : appendRef.current)?.focus({ preventScroll: true }), 60);
  };
  const newNote = () => {
    if (editing) stopEditing();
    dropEmptyFresh();
    const id = 'note-' + crypto.randomUUID();
    if (!onAddNote({ id, title: '', content: '', kind: 'idea', doc: { pages: [[]] }, updatedAt: Date.now() })) { flash({ text: copy.saveFailed }); return; }
    setFilter('all'); setQuery(''); setSelectedId(id); setFreshId(id); setJustAdded(id); setTitleDraft(''); setEditing(true); setMenu(null);
    window.setTimeout(() => titleRef.current?.focus({ preventScroll: true }), 60);
  };
  const addPage = () => {
    if (!current) return;
    if (editing) appendText(false);
    if (!saveDoc(current, { pages: [...doc.pages, []] })) return;
    setPageOf(previous => ({ ...previous, [current.id]: doc.pages.length }));
    setTitleDraft(current.title); setEditing(true); setMenu(null);
    window.setTimeout(() => appendRef.current?.focus({ preventScroll: true }), 60);
  };
  const togglePin = () => {
    if (!current) return;
    const was = !!current.pinned;
    if (onUpdateNote(current.id, { pinned: !was })) flash({ text: was ? copy.unpinned : copy.pinnedTop });
  };
  const removeNote = () => {
    if (!current) return;
    const note = current;
    setEditing(false); setMenu(null); setFreshId(undefined);
    if (onDeleteNote(note.id)) flash({ text: copy.noteDeleted, undo: () => { onRestoreNote(note); setSelectedId(note.id); flash(null); } }, true);
  };

  // Ctrl+Z undoes the last edit made through the selection menu.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && (event.code === 'KeyZ') && tag !== 'INPUT' && tag !== 'TEXTAREA' && history.current.length) {
        event.preventDefault(); undo();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  });

  // The selection menu opens under the selected text; a chip opens its own menu.
  const openMenu = (event: React.MouseEvent) => {
    const section = sectionRef.current;
    if (!section || (event.target as HTMLElement).closest('[data-copy]')) return;
    const box = section.getBoundingClientRect();
    const chip = (event.target as HTMLElement).closest('[data-chip]');
    if (chip) {
      const rect = chip.getBoundingClientRect();
      setMenu({ chip: Number(chip.getAttribute('data-chip')), seg: -1, text: segs[Number(chip.getAttribute('data-chip'))]?.v ?? '',
        x: Math.max(16, Math.min(rect.left - box.left, section.offsetWidth - 256)), y: rect.bottom - box.top + 10 });
      return;
    }
    window.setTimeout(() => {
      const selection = window.getSelection();
      const text = selection ? String(selection).trim() : '';
      if (!text || !selection?.rangeCount) { setMenu(null); return; }
      const anchor = selection.anchorNode && (selection.anchorNode.nodeType === 3 ? selection.anchorNode.parentElement : selection.anchorNode as HTMLElement);
      const segEl = anchor?.closest?.('[data-seg]');
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      let y = rect.bottom - box.top + 10;
      if (y + 380 > section.offsetHeight) y = Math.max(16, rect.top - box.top - 390);
      setMenu({ text, seg: segEl ? Number(segEl.getAttribute('data-seg')) : -1, x: Math.max(16, Math.min(rect.left - box.left, section.offsetWidth - 256)), y });
      setFontsOpen(false);
    }, 0);
  };
  useEffect(() => {
    if (!menu) return;
    const onDown = (event: MouseEvent) => { if (!(event.target as HTMLElement).closest('[data-menu]')) { setMenu(null); setFontsOpen(false); setFontQuery(''); } };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenu(null); setFontsOpen(false); } };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('mousedown', onDown, true); document.removeEventListener('keydown', onKey, true); };
  }, [menu]);

  const findSeg = (target: Menu) => {
    const has = (seg?: NoteSeg) => seg?.t === 'text' && seg.v.includes(target.text);
    return has(segs[target.seg]) ? target.seg : segs.findIndex(seg => has(seg));
  };
  /** Splits the run holding the selection into before / selected / after. */
  const splitAt = (target: Menu): (NoteSeg & { sel?: boolean })[] | null => {
    const index = findSeg(target);
    if (index < 0) return null;
    const seg = segs[index], at = seg.v.indexOf(target.text);
    return [...segs.slice(0, index), { t: 'text', v: seg.v.slice(0, at), s: seg.s }, { t: 'text', v: target.text, s: seg.s, sel: true },
      { t: 'text', v: seg.v.slice(at + target.text.length), s: seg.s }, ...segs.slice(index + 1)];
  };
  const done = (nextSegs: NoteSeg[] | null, message: string) => {
    window.getSelection()?.removeAllRanges();
    setMenu(null); setFontsOpen(false);
    if (nextSegs) savePage(nextSegs, message); else if (message) flash({ text: message });
  };
  const writeClipboard = (text: string) => { navigator.clipboard?.writeText(text).catch(() => undefined); };
  const chipMenu = !!menu && menu.chip !== undefined && segs[menu.chip]?.t === 'chip';
  const single = !!menu && !chipMenu && !menu.text.includes('\n');
  const target = single && menu!.fseg !== undefined && segs[menu!.fseg]?.v === menu!.text ? menu!.fseg : -1;
  const style: NoteSegStyle = target >= 0 ? segs[target].s ?? {} : single && findSeg(menu!) >= 0 ? segs[findSeg(menu!)].s ?? {} : {};
  const size = style.size ?? 18, weight = style.weight ?? 400, font = style.font ?? 'Inter';
  const applyStyle = (patch: NoteSegStyle) => {
    if (!menu || !current) return;
    let next: (NoteSeg & { sel?: boolean })[] | null;
    if (target >= 0) next = segs.map((seg, index) => index === target ? { ...seg, s: { ...seg.s, ...patch }, sel: true } : seg);
    else next = splitAt(menu)?.map(seg => seg.sel ? { ...seg, s: { ...seg.s, ...patch } } : seg) ?? null;
    if (!next) return;
    // Keep the styled run apart so the next change applies to the same text.
    const kept = next.filter(seg => !(seg.t === 'text' && !seg.v));
    const markIndex = kept.findIndex(seg => seg.sel);
    const before = tidySegs(kept.slice(0, markIndex)), after = tidySegs(kept.slice(markIndex + 1));
    const { sel: _sel, ...marked } = kept[markIndex];
    savePage([...before, marked, ...after]);
    setMenu({ ...menu, fseg: before.length });
  };
  const toggleNumbers = () => {
    if (!menu) return;
    const pieces = menu.text.split(/\n+/).map(piece => piece.trim()).filter(Boolean);
    const starts: number[] = [];
    let from = 0;
    for (const piece of pieces) for (let i = from; i < segs.length; i++) {
      if (segs[i].t === 'text' && segs[i].v.includes(piece)) {
        let start = i;
        while (start > 0 && segs[start - 1].t !== 'br') start--;
        if (!starts.includes(start)) starts.push(start);
        from = i; break;
      }
    }
    if (!starts.length) { done(null, ''); return; }
    const allOn = starts.every(start => segs[start].t === 'num');
    const next: NoteSeg[] = [];
    segs.forEach((seg, index) => {
      if (starts.includes(index)) { if (allOn && seg.t === 'num') return; if (!allOn && seg.t !== 'num') next.push({ t: 'num', v: '' }); }
      next.push(seg);
    });
    done(next, allOn ? copy.numbersOff : copy.numbersOn);
  };
  const menuItems = !menu ? [] : chipMenu ? [
    { label: copy.copy, icon: ICONS.copy, danger: false, act: () => { writeClipboard(segs[menu.chip!].v); done(null, copy.copied); } },
    { label: copy.plain, icon: ICONS.text, danger: false, act: () => done(segs.map((seg, index) => index === menu.chip ? { t: 'text', v: seg.v } : seg), copy.chipRemoved) },
    { label: copy.remove, icon: ICONS.trash, danger: true, act: () => done(segs.filter((_, index) => index !== menu.chip), copy.deleted) },
  ] : [
    { label: copy.numbering, icon: ICONS.list, danger: false, act: toggleNumbers },
    { label: copy.copy, icon: ICONS.copy, danger: false, act: () => { writeClipboard(menu.text); done(null, copy.copied); } },
    { label: copy.paste, icon: ICONS.paste, danger: false, act: () => {
      const put = (text: string) => { const split = text ? splitAt(menu) : null; done(split ? split.map(seg => seg.sel ? { t: 'text', v: text, s: seg.s } : seg) : null, split ? copy.pasted : ''); };
      navigator.clipboard?.readText().then(put, () => put('')) ?? put('');
    } },
    { label: copy.chip, icon: CHIP_ICON, accent: true, danger: false, act: () => { const split = splitAt(menu); done(split ? split.map(seg => seg.sel ? { t: 'chip', v: seg.v.trim() } : seg) : null, split ? copy.chipAdded : ''); } },
    { label: copy.remove, icon: ICONS.trash, danger: true, act: () => { const split = splitAt(menu); done(split ? split.filter(seg => !seg.sel) : null, split ? copy.deleted : ''); } },
  ];
  const loadFonts = () => {
    if (fontNames) return;
    setFontNames(BASE_FONTS);
    const query = (window as Window & { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts;
    query?.().then(list => {
      const families = Array.from(new Set(list.map(item => item.family).filter(name => name && name !== 'Inter'))).sort((a, b) => a.localeCompare(b));
      if (families.length) setFontNames(['Inter', ...families]);
    }, () => undefined);
  };
  const labels = numberLabels(segs);
  const copyChip = (index: number, value: string) => {
    writeClipboard(value);
    window.clearTimeout(copyTimer.current);
    setCopiedSeg(index);
    copyTimer.current = window.setTimeout(() => setCopiedSeg(-1), 1400);
  };
  useLayoutEffect(() => { setCopiedSeg(-1); }, [current?.id, page]);

  const isFresh = !!current && current.id === freshId && editing;
  const kind = current ? kindOf(current) : 'idea';
  return <div className="pulse-page-shell notes-view">
    <div className="pulse-page-head">
      <div className="pulse-page-head-copy">
        <h1 className="pulse-page-title"><span className="pulse-page-title-light">{copy.title[0]}</span><span className="pulse-page-title-heavy">{copy.title[1]}</span></h1>
        <div className="nv-switch" role="group" aria-label={copy.filter}>
          {(['all', 'lesson', 'idea'] as Filter[]).map(value => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{copy.filters[value]}</button>)}
        </div>
      </div>
    </div>
    {storageError && <p role="alert" className="nv-alert">{copy.storage}</p>}
    <div className="pulse-page-grid nv-grid">
      <aside className="pulse-page-sidebar">
        <label className="nv-search">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a1a1a6" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m21 21-4.34-4.34" /><circle cx="11" cy="11" r="8" /></svg>
          <input type="text" aria-label={copy.searchLabel} placeholder={copy.search} value={query} onChange={event => setQuery(event.target.value)} />
          <button type="button" aria-label={copy.newNote} data-tip={copy.newNote} onClick={newNote}><Path d="M12 5v14M5 12h14" width={2.4} /></button>
        </label>
        {shown.map(note => <button key={note.id} type="button" className={'nv-item' + (note.id === justAdded ? ' nv-item--new' : '')} aria-pressed={note.id === current?.id} onClick={() => select(note.id)}>
          <span className="nv-item-copy"><span className="nv-item-title">{note.title || copy.untitled}</span><span className="nv-item-date">{noteDate(note.updatedAt ?? note.createdAt, now, lang)}</span></span>
          {note.pinned && <span className="nv-item-pin" aria-label={copy.pinned}><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 17v5" /><path d={PIN_PATH} /></svg></span>}
          <span className="nv-item-dot" style={{ background: kindOf(note) === 'lesson' ? '#8442ff' : '#13f287' }} />
        </button>)}
      </aside>
      <div className="pulse-page-main">
        <section ref={sectionRef} className="nv-paper" aria-label={copy.note}>
          {current ? <>
            <div className="nv-swap" key={current.id}>
              <div className="nv-meta">
                {isFresh ? <div role="radiogroup" aria-label={copy.kindLabel} className="nv-kinds">
                  {(['lesson', 'idea'] as Kind[]).map(value => <button key={value} type="button" role="radio" aria-checked={kind === value} data-kind={value} onClick={() => onUpdateNote(current.id, { kind: value })}>{copy.kinds[value]}</button>)}
                </div> : <span className="nv-tag" data-kind={kind}>{copy.kinds[kind]}</span>}
                <span className="nv-date">{noteDate(current.updatedAt ?? current.createdAt, now, lang)}</span>
                <span className="nv-spacer" />
                <button type="button" className="nv-pen" aria-label={copy.append} aria-pressed={editing} data-tip={copy.append} onClick={() => editing ? stopEditing() : startEditing()}><Path d="M21.17 6.81a1 1 0 0 0-3.98-3.98L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5zM15 5l4 4" width={2.2} /></button>
              </div>
              {editing
                ? <input ref={titleRef} type="text" className="nv-title-input" aria-label={copy.titleLabel} placeholder={copy.titleLabel} value={titleDraft} maxLength={300}
                    onChange={event => setTitleDraft(event.target.value)} onBlur={commitTitle}
                    onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commitTitle(); appendRef.current?.focus({ preventScroll: true }); } }} />
                : <h2 className="nv-title" style={{ color: current.title ? '#090a0a' : '#aeaeb2' }}>{current.title || copy.untitled}</h2>}
              <div ref={editorRef} className="nv-editor" key={current.id + '#' + page} onMouseUp={openMenu}>
                {segs.map((seg, index) => {
                  if (seg.t === 'br') return <span key={index} className="nv-br" />;
                  if (seg.t === 'num') return <span key={index} className="nv-num">{labels.get(index)}</span>;
                  if (seg.t === 'chip') {
                    const on = copiedSeg === index;
                    return <span key={index} className="nv-chip" data-chip={index} data-on={on}>{seg.v}<button type="button" data-copy="1" aria-label={copy.copy} onClick={() => copyChip(index, seg.v)}><Path d={on ? ICONS.check : ICONS.copy} size={15} width={2.2} /></button></span>;
                  }
                  const s = seg.s ?? {};
                  return <span key={index} data-seg={index} style={{ fontSize: s.size, lineHeight: s.size ? 1.3 : undefined, fontWeight: s.weight,
                    fontFamily: s.font && s.font !== 'Inter' ? fontFamily(s.font) : undefined, color: (s.weight ?? 0) >= 700 || (s.size ?? 0) > 22 ? '#090a0a' : undefined }}>{seg.v}</span>;
                })}
              </div>
              {!segs.length && !editing && <span className="nv-empty-page">{copy.emptyPage}</span>}
              {editing && <textarea ref={appendRef} rows={1} className="nv-append" aria-label={copy.appendLabel} placeholder={copy.appendPlaceholder} style={{ marginTop: segs.length ? -8 : -18 }}
                onInput={event => { const box = event.currentTarget; box.style.height = 'auto'; box.style.height = box.scrollHeight + 'px'; }}
                onBlur={() => appendText(false)}
                onKeyDown={event => {
                  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); appendText(true); }
                  else if (event.key === 'Escape') { event.preventDefault(); stopEditing(); }
                }} />}
            </div>
            {menu && <div data-menu="1" role="menu" aria-label={copy.menu} className="nv-menu" style={{ left: Math.round(menu.x), top: Math.round(menu.y) }}>
              {single && <div className="nv-format">
                <button type="button" className="nv-font" aria-expanded={fontsOpen} aria-label={copy.font} style={{ fontFamily: fontFamily(font) }} onClick={() => { if (!fontsOpen) loadFonts(); setFontsOpen(!fontsOpen); setFontQuery(''); }}>
                  <span>{font}</span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: fontsOpen ? 'rotate(180deg)' : undefined }}><path d="m6 9 6 6 6-6" /></svg>
                </button>
                {fontsOpen && <div className="nv-fonts">
                  <input type="text" aria-label={copy.fontSearch} placeholder={copy.fontSearch} value={fontQuery} autoFocus onChange={event => setFontQuery(event.target.value)} />
                  <div role="listbox" aria-label={copy.fonts}>
                    {(fontNames ?? ['Inter']).filter(name => !fontQuery || name.toLowerCase().includes(fontQuery.toLowerCase())).slice(0, 80).map(name =>
                      <button key={name} type="button" role="option" aria-selected={font === name} style={{ fontFamily: fontFamily(name) }} onClick={() => { applyStyle({ font: name }); setFontsOpen(false); setFontQuery(''); }}>{name}</button>)}
                  </div>
                </div>}
                <div className="nv-format-row">
                  <div role="group" aria-label={copy.size} className="nv-size">
                    <button type="button" aria-label={copy.smaller} onClick={() => applyStyle({ size: Math.max(12, size - 2) })}>−</button>
                    <span aria-live="polite">{size}</span>
                    <button type="button" aria-label={copy.bigger} onClick={() => applyStyle({ size: Math.min(48, size + 2) })}>+</button>
                  </div>
                  <div role="group" aria-label={copy.weight} className="nv-weights">
                    {WEIGHTS.map((value, index) => <button key={value} type="button" aria-pressed={weight === value || value === 500 && weight === 400} aria-label={copy.weights[index]} style={{ fontWeight: value }} onClick={() => applyStyle({ weight: value })}>Аа</button>)}
                  </div>
                </div>
              </div>}
              {menuItems.map(item => <button key={item.label} type="button" role="menuitem" style={{ color: item.danger ? '#ff6b6d' : 'accent' in item && item.accent ? '#13f287' : '#ffffff' }} onClick={item.act}><Path d={item.icon} />{item.label}</button>)}
            </div>}
            <div className="nv-footer">
              <div>{onMakeTasks && <button type="button" className="nv-make" onClick={() => onMakeTasks(current)}><KarkasLogo compact width={15} height={16} />{copy.makeTasks}</button>}</div>
              <div role="tablist" aria-label={copy.pages} className="nv-pages">
                {doc.pages.map((_, index) => <button key={index} type="button" role="tab" aria-selected={index === page} aria-label={copy.page + ' ' + (index + 1)} onClick={() => { if (editing) appendText(false); setPageOf(previous => ({ ...previous, [current.id]: index })); setMenu(null); }}>{index + 1}</button>)}
                <button type="button" className="nv-page-add" aria-label={copy.addPage} data-tip={copy.addPage} onClick={addPage}><Path d="M12 5v14M5 12h14" size={15} width={2.6} /></button>
              </div>
              <div className="nv-actions">
                <button type="button" className="nv-pin" aria-label={current.pinned ? copy.unpin : copy.pin} aria-pressed={!!current.pinned} data-tip={current.pinned ? copy.unpin : copy.pin} onClick={togglePin}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill={current.pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 17v5" /><path d={PIN_PATH} /></svg>
                </button>
                <button type="button" className="nv-delete" aria-label={copy.remove} data-tip={copy.remove} onClick={removeNote}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></svg></button>
              </div>
            </div>
          </> : <div className="nv-none">
            <span>{copy.empty}</span>
            <button type="button" className="nv-make" onClick={newNote}><Path d="M12 5v14M5 12h14" size={16} width={2.4} />{copy.newNote}</button>
          </div>}
          {toast && <div className="nv-toast-wrap"><span className="nv-toast" role="status">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#13f287" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
            {toast.text}{toast.undo ? <button type="button" data-menu="1" onClick={toast.undo}>{copy.undo}</button> : <span style={{ width: 10 }} />}
          </span></div>}
        </section>
      </div>
    </div>
  </div>;
};
