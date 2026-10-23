import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { NoteDoc, NoteSeg, NoteSegStyle, NotepadNote } from '../types';
import type { Language } from '../utils/i18n';
import { docText, editPageText, noteDisplayTitle, noteDoc, numberLabels, pageText, transformNoteRange } from '../utils/noteDoc';
import { capitalizeNoteTyping } from '../utils/noteCapitalization';
import { readEditorDrafts, readLastNoteId, readNoteCursor, writeEditorDraft, writeNoteCursor, type NoteEditorDraft } from '../utils/noteEditorState';
import { noteSourceHash, noteTaskCandidates, type NotepadTaskCandidate, type NotepadTaskConfig, type NotepadTaskResult } from '../utils/noteTaskConversion';
import { BASE_FONTS, COPY, ICONS, PIN_PATH, Path, WEIGHTS, fontFamily, kindOf, noteDate } from './notebookUi';
import './notepad.css';

export type { NotepadTaskCandidate, NotepadTaskConfig, NotepadTaskResult } from '../utils/noteTaskConversion';
export interface NotepadViewProps {
  ownerId?: string | null; lang: Language; notes: NotepadNote[];
  deletedNotes?: NotepadNote[]; revealNoteId?: string | null;
  searchQuery?: string; onSearchQueryChange?: (value: string) => void;
  onAddNote: (note: Omit<NotepadNote, 'id' | 'createdAt'> & { id?: string }) => boolean;
  onUpdateNote: (id: string, updates: Partial<NotepadNote>, expected?: Pick<NotepadNote, 'title' | 'content' | 'doc'>) => boolean;
  onDeleteNote: (id: string) => boolean; onRestoreNote: (note: NotepadNote | string) => boolean;
  onMakeTasks?: (note: NotepadNote) => void; storageError?: boolean;
  taskCategories?: { id: string; name: string }[]; existingTaskSources?: string[];
  onCreateTasks?: (items: NotepadTaskCandidate[], config: NotepadTaskConfig) => NotepadTaskResult[] | Promise<NotepadTaskResult[]>;
  onOpenTasks?: (ids: string[]) => void;
}
type Range = { id: string; page: number; start: number; end: number; text: string };
type PreviewRow = NotepadTaskCandidate & { selected: boolean; status: 'ready' | 'created' | 'existing' | 'error'; error?: string; taskId?: string };
type Preview = { source: NotepadNote; scope: 'selection' | 'page' | 'note'; page: number; selectionStart?: number; selection: string; rows: PreviewRow[]; phase: string; date: string };
type Toast = { text: string; until: number; undo?: () => boolean | 'stale' };

async function copyToClipboard(text: string): Promise<boolean> {
  try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; } } catch { /* Use the native fallback below. */ }
  const active = document.activeElement;
  const saved = active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement
    ? { start: active.selectionStart, end: active.selectionEnd, direction: active.selectionDirection } : null;
  const field = document.createElement('textarea'); field.value = text; field.readOnly = true;
  field.style.position = 'fixed'; field.style.left = '-9999px'; field.tabIndex = -1; document.body.appendChild(field);
  try { field.select(); return document.execCommand('copy'); } catch { return false; }
  finally {
    field.remove();
    if (active instanceof HTMLElement && active.isConnected) active.focus({ preventScroll: true });
    if (saved && (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) && active.isConnected && saved.start !== null && saved.end !== null) {
      active.setSelectionRange(saved.start, saved.end, saved.direction ?? undefined);
    }
  }
}

export function NotebookEditor({ ownerId = null, lang, notes, deletedNotes = [], revealNoteId, searchQuery, onSearchQueryChange,
  onAddNote, onUpdateNote, onDeleteNote, onRestoreNote, onMakeTasks, storageError = false,
  taskCategories = [], existingTaskSources = [], onCreateTasks, onOpenTasks }: NotepadViewProps) {
  const copy = COPY[lang], uk = lang === 'uk';
  const [localQuery, setLocalQuery] = useState(''), [filter, setFilter] = useState<'all' | 'lesson' | 'idea'>('all');
  const query = searchQuery ?? localQuery;
  const setQuery = (value: string) => { setLocalQuery(value); onSearchQueryChange?.(value); };
  const initialId = useRef(revealNoteId ?? readLastNoteId(ownerId) ?? notes[0]?.id).current;
  const [selectedId, setSelectedId] = useState<string | undefined>(initialId);
  const [pages, setPages] = useState<Record<string, number>>({});
  const [drafts, setDrafts] = useState(() => ({ ...readEditorDrafts(ownerId) }));
  const draftRef = useRef(drafts); draftRef.current = drafts;
  const notesRef = useRef(notes); notesRef.current = notes;
  const updateRef = useRef(onUpdateNote); updateRef.current = onUpdateNote;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [range, setRange] = useState<Range | null>(null), [menuOpen, setMenuOpen] = useState(false), [showStyled, setShowStyled] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null), [creating, setCreating] = useState(false);
  const previewRef = useRef(preview); previewRef.current = preview;
  const [toast, setToast] = useState<Toast | null>(null), [now, setNow] = useState(Date.now());
  const boxRef = useRef<HTMLTextAreaElement>(null), mounted = useRef(true), timers = useRef(new Map<string, number>());
  const initialPosition = initialId ? readNoteCursor(ownerId, initialId) : null;
  const focusRequest = useRef<{ id: string; page: number; start: number; end: number; scroll?: number } | null>(initialId && !query ? { id: initialId, page: initialPosition?.page ?? 0, start: initialPosition?.start ?? 0, end: initialPosition?.end ?? 0, scroll: initialPosition?.scroll } : null);
  const cursorSave = useRef<(() => void) | null>(null);
  const composing = useRef<string | null>(null);
  const appliedReveal = useRef<string | null>(null);
  const previousQuery = useRef(query);
  const activeRef = useRef<{ id?: string; page: number; text: string }>({ page: 0, text: '' });
  const words = (a: string, b: string) => uk ? a : b;
  const flash = (text: string, undo?: () => boolean | 'stale') => { if (mounted.current) setToast({ text, undo, until: Date.now() + (undo ? 8000 : 3500) }); };
  const shown = useMemo(() => notes.filter(note => (filter === 'all' || kindOf(note) === filter)
    && (!query.trim() || `${note.title}\n${note.content}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())))
    .slice().sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt)), [notes, filter, query]);
  const current = notes.find(note => note.id === selectedId) ?? shown[0];
  const draft = current ? drafts[current.id] : undefined;
  const doc = draft?.doc ?? (current ? noteDoc(current) : { pages: [[]] });
  const page = current ? Math.min(pages[current.id] ?? readNoteCursor(ownerId, current.id)?.page ?? 0, doc.pages.length - 1) : 0;
  const segments = doc.pages[page] ?? [], text = pageText(segments);
  const title = draft?.title ?? current?.title ?? '';
  const workingNote = current ? { ...current, ...draft?.metadata, title, doc, content: docText(doc) } : null;
  const docRef = useRef(doc); docRef.current = doc;
  activeRef.current = { id: current?.id, page, text };
  const isCurrent = (id: string, atPage: number, source: string) => mounted.current && activeRef.current.id === id && activeRef.current.page === atPage && activeRef.current.text === source;
  const clearDraft = (id: string) => {
    const next = { ...draftRef.current }; delete next[id]; draftRef.current = next;
    writeEditorDraft(ownerId, id, null); if (mounted.current) setDrafts(next);
  };
  const flush = (id = current?.id, overwrite = false): boolean => {
    if (!id) return true;
    window.clearTimeout(timers.current.get(id)); timers.current.delete(id);
    const pending = draftRef.current[id]; if (!pending) return true;
    const saved = notesRef.current.find(note => note.id === id);
    if (!saved) { if (mounted.current) setErrors(previous => ({ ...previous, [id]: words('Нотатку прибрано. Чернетку збережено окремо.', 'The note was removed. Your draft is retained separately.') })); return false; }
    const content = docText(pending.doc);
    const metadataMatches = Object.entries(pending.metadata ?? {}).every(([field, value]) => JSON.stringify(saved[field as keyof NotepadNote]) === JSON.stringify(value));
    const sameDocument = (note: NotepadNote, document: NoteDoc) => JSON.stringify(noteDoc(note)) === JSON.stringify(document);
    if (saved.title === pending.title && saved.content === content && sameDocument(saved, pending.doc) && metadataMatches) {
      clearDraft(id); if (mounted.current) setErrors(previous => { const next = { ...previous }; delete next[id]; return next; }); return true;
    }
    if (!overwrite && (saved.title !== pending.base.title || saved.content !== pending.base.content || !sameDocument(saved, noteDoc(pending.base)))) {
      if (mounted.current) setErrors(previous => ({ ...previous, [id]: words('Є новіша версія. Чернетку збережено; скопіюй її або явно збережи свою версію.', 'A newer version exists. Copy your retained draft or explicitly save your version.') }));
      return false;
    }
    const patch = { ...pending.metadata, title: pending.title, doc: pending.doc, content };
    const ok = updateRef.current(id, { ...patch, updatedAt: Date.now() }, overwrite ? undefined : { title: pending.base.title, content: pending.base.content, doc: pending.base.doc });
    if (!ok) { if (mounted.current) setErrors(previous => ({ ...previous, [id]: copy.saveFailed })); return false; }
    clearDraft(id);
    if (mounted.current) setErrors(previous => { const next = { ...previous }; delete next[id]; return next; });
    const changed = (Object.keys(patch) as (keyof typeof patch)[]).filter(field => JSON.stringify(field === 'doc' ? noteDoc(saved) : saved[field]) !== JSON.stringify(patch[field]));
    const previous = Object.fromEntries(changed.map(field => [field, field === 'doc' ? noteDoc(saved) : saved[field]])) as Partial<NotepadNote>;
    flash(words('Зміни збережено на пристрої', 'Changes saved on this device'), () => {
      const actual = notesRef.current.find(note => note.id === id);
      if (!actual || draftRef.current[id] || changed.some(field => JSON.stringify(field === 'doc' ? noteDoc(actual) : actual[field]) !== JSON.stringify(patch[field]))) return 'stale';
      return updateRef.current(id, { ...previous, updatedAt: Date.now() }, { title: actual.title, content: actual.content, doc: actual.doc });
    });
    return true;
  };
  const queueDraft = (note: NotepadNote, patch: { title?: string; doc?: NoteDoc; metadata?: NoteEditorDraft['metadata'] }) => {
    const previous = draftRef.current[note.id];
    const next: NoteEditorDraft = { base: previous?.base ?? note, title: patch.title ?? previous?.title ?? note.title,
      doc: patch.doc ?? previous?.doc ?? noteDoc(note), metadata: { ...previous?.metadata, ...patch.metadata }, at: Date.now() };
    const values = { ...draftRef.current, [note.id]: next }; draftRef.current = values; setDrafts(values);
    writeEditorDraft(ownerId, note.id, next);
    window.clearTimeout(timers.current.get(note.id));
    timers.current.set(note.id, window.setTimeout(() => flush(note.id), 700));
  };
  const stage = (patch: { title?: string; doc?: NoteDoc; metadata?: NoteEditorDraft['metadata'] }) => {
    if (!current) return;
    setSelectedId(current.id); queueDraft(current, patch);
  };
  const stageText = (value: string, selection?: { start: number; end: number }) => {
    const base = current ? draftRef.current[current.id]?.doc ?? doc : doc;
    stage({ doc: { pages: base.pages.map((item, index) => index === page ? editPageText(item, value) : item) } });
    if (current && selection) focusRequest.current = { id: current.id, page, ...selection };
  };
  const rememberCursor = () => {
    const box = boxRef.current;
    if (current && box) writeNoteCursor(ownerId, current.id, { page, start: box.selectionStart, end: box.selectionEnd, scroll: box.scrollTop });
  };
  cursorSave.current = rememberCursor;
  const choose = (id: string) => {
    rememberCursor(); if (!flush()) return;
    const cursor = readNoteCursor(ownerId, id); setSelectedId(id); setMenuOpen(false); setRange(null); setPreview(null);
    setPages(previous => ({ ...previous, [id]: cursor?.page ?? 0 }));
    focusRequest.current = { id, page: cursor?.page ?? 0, start: cursor?.start ?? 0, end: cursor?.end ?? 0, scroll: cursor?.scroll };
  };
  useEffect(() => {
    mounted.current = true;
    const flushAll = () => { cursorSave.current?.(); for (const id of Object.keys(draftRef.current)) flush(id); };
    const beforeUnload = (event: BeforeUnloadEvent) => { flushAll(); if (Object.keys(draftRef.current).length) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('karkas:flush-notepad', flushAll); window.addEventListener('pagehide', flushAll); window.addEventListener('blur', flushAll); window.addEventListener('beforeunload', beforeUnload);
    for (const id of Object.keys(draftRef.current)) timers.current.set(id, window.setTimeout(() => flush(id), 700));
    return () => {
      mounted.current = false; flushAll(); timers.current.forEach(timer => window.clearTimeout(timer));
      window.removeEventListener('karkas:flush-notepad', flushAll); window.removeEventListener('pagehide', flushAll); window.removeEventListener('blur', flushAll); window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [ownerId]);
  const hasPendingRemoval = deletedNotes.some(note => (note.undoUntil ?? 0) > now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), hasPendingRemoval ? 250 : 30000); return () => window.clearInterval(timer); }, [hasPendingRemoval]);
  useEffect(() => {
    if (!toast || !Number.isFinite(toast.until)) return;
    const timer = window.setTimeout(() => setToast(previous => previous === toast ? null : previous), Math.max(0, toast.until - Date.now()));
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!revealNoteId) { appliedReveal.current = null; return; }
    if (revealNoteId !== appliedReveal.current && notes.some(note => note.id === revealNoteId)) {
      if (!flush()) return; appliedReveal.current = revealNoteId; setFilter('all'); setQuery(''); choose(revealNoteId);
    }
  }, [revealNoteId, notes]);
  useEffect(() => {
    if (previousQuery.current === query) return;
    previousQuery.current = query;
    if (flush()) { setSelectedId(undefined); setMenuOpen(false); setRange(null); }
  }, [query]);
  useLayoutEffect(() => {
    const request = focusRequest.current, box = boxRef.current;
    if (!request || !box || request.id !== current?.id || Math.min(request.page, doc.pages.length - 1) !== page) return;
    focusRequest.current = null;
    box.focus({ preventScroll: true }); box.setSelectionRange(Math.min(request.start, box.value.length), Math.min(request.end, box.value.length));
    if (request.scroll !== undefined) box.scrollTop = request.scroll;
  }, [current?.id, page, drafts]);
  useLayoutEffect(() => { const box = boxRef.current; if (box) { box.style.height = 'auto'; box.style.height = Math.max(180, box.scrollHeight) + 'px'; } }, [current?.id, page, text]);
  useLayoutEffect(() => { composing.current = null; }, [current?.id, page]);
  const newNote = () => {
    if (!flush()) return;
    const id = `note-${crypto.randomUUID()}`;
    if (!onAddNote({ id, title: '', content: '', kind: 'idea', doc: { pages: [[]] }, updatedAt: Date.now() })) { flash(copy.saveFailed); return; }
    setFilter('all'); setQuery(''); setSelectedId(id); setPages(previous => ({ ...previous, [id]: 0 })); setPreview(null); setMenuOpen(false);
    focusRequest.current = { id, page: 0, start: 0, end: 0 };
  };
  const saveMetadata = (patch: Partial<NotepadNote>, message?: string) => {
    if (!current) return false;
    const note = notesRef.current.find(item => item.id === current.id); if (!note) return false;
    queueDraft(note, { title: patch.title, doc: patch.doc, metadata: {
      ...(patch.kind !== undefined ? { kind: patch.kind } : {}), ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
      ...(patch.deletedPages !== undefined ? { deletedPages: patch.deletedPages } : {}),
    } });
    if (!flush(current.id)) return false;
    if (message) flash(message); return true;
  };
  const changePage = (next: number) => {
    rememberCursor(); if (!current || !flush()) return;
    setPages(previous => ({ ...previous, [current.id]: next })); setMenuOpen(false); setRange(null);
    focusRequest.current = { id: current.id, page: next, start: 0, end: 0 };
  };
  const addPage = () => {
    if (!current) return;
    if (doc.pages.length >= 200) { flash(words('У нотатці вже 200 сторінок. Створи нову нотатку.', 'This note already has 200 pages. Create another note.')); return; }
    const next = { pages: [...doc.pages, []] }; stage({ doc: next }); if (!flush(current.id)) return;
    setPages(previous => ({ ...previous, [current.id]: next.pages.length - 1 }));
    focusRequest.current = { id: current.id, page: next.pages.length - 1, start: 0, end: 0 }; setMenuOpen(false);
  };
  const restorePage = (id: string) => {
    if (!current) return false;
    const saved = notesRef.current.find(item => item.id === current.id); if (!saved) return false;
    const pending = draftRef.current[saved.id];
    const latest = pending ? { ...saved, ...pending.metadata, title: pending.title, doc: pending.doc, content: docText(pending.doc) } : saved;
    const removed = latest.deletedPages?.find(item => item.id === id); if (!removed) return true;
    const nextPages = [...noteDoc(latest).pages];
    const index = Math.min(removed.index, nextPages.length);
    if (nextPages.length >= 200 && !(nextPages.length === 1 && !pageText(nextPages[0]) && removed.index === 0)) {
      flash(words('Спочатку прибери одну зі сторінок або скопіюй текст в іншу нотатку.', 'Remove a page first or copy the text to another note.')); return false;
    }
    if (nextPages.length === 1 && !pageText(nextPages[0]) && removed.index === 0) nextPages[0] = removed.segments;
    else nextPages.splice(index, 0, removed.segments);
    const next = { pages: nextPages };
    if (!saveMetadata({ doc: next, content: docText(next), deletedPages: latest.deletedPages?.filter(item => item.id !== id) })) return false;
    setFilter('all'); setQuery(''); setSelectedId(current.id); setPages(previous => ({ ...previous, [current.id]: index })); return true;
  };
  const deletePage = () => {
    if (!current) return;
    const deletedAt = Date.now(), id = `page-${crypto.randomUUID()}`;
    const remaining = doc.pages.filter((_, index) => index !== page), next = { pages: remaining.length ? remaining : [[]] };
    const removed = { id, index: page, segments, deletedAt, undoUntil: deletedAt + 8000 };
    if (saveMetadata({ doc: next, content: docText(next), deletedPages: [...(workingNote?.deletedPages ?? []), removed] })) {
      setPages(previous => ({ ...previous, [current.id]: Math.max(0, page - 1) })); flash(words('Сторінку прибрано. Її можна відновити нижче.', 'Page removed. You can restore it below.'), () => restorePage(id));
    }
  };
  const removeNote = () => {
    if (!current || !flush()) return;
    const note = notesRef.current.find(item => item.id === current.id) ?? workingNote!;
    if (!onDeleteNote(note.id)) { flash(copy.saveFailed); return; }
    clearDraft(note.id); setPreview(null); setMenuOpen(false);
    flash(words('Нотатку прибрано. Після 8 секунд вона буде в Архіві.', 'Note removed. After 8 seconds it is available in Archive.'), () => {
      if (!onRestoreNote(note)) return false;
      setFilter('all'); setQuery(''); setSelectedId(note.id); return true;
    });
  };
  const captureRange = () => {
    const box = boxRef.current; if (!box || !current) return;
    setRange({ id: current.id, page, start: box.selectionStart, end: box.selectionEnd, text: box.value });
    if (box.selectionStart === box.selectionEnd) setMenuOpen(false);
  };
  const selectedRange = (): Range | null => {
    const box = boxRef.current;
    if (current && box && document.activeElement === box && box.selectionStart !== box.selectionEnd) return { id: current.id, page, start: box.selectionStart, end: box.selectionEnd, text: box.value };
    return range && range.id === current?.id && range.page === page && range.text === text && range.end > range.start ? range : null;
  };
  const replaceRange = (transform: (items: NoteSeg[]) => NoteSeg[], message?: string, captured?: Range) => {
    const selected = captured ?? selectedRange(); if (!current || !selected || selected.id !== current.id || selected.page !== page || selected.text !== text) { flash(words('Спочатку виділи потрібний текст.', 'Select the text first.')); return; }
    const nextSegments = transformNoteRange(segments, selected.start, selected.end, transform);
    const nextText = pageText(nextSegments);
    stage({ doc: { pages: doc.pages.map((items, index) => index === page ? nextSegments : items) } });
    const end = Math.max(selected.start, selected.end + nextText.length - text.length);
    setRange({ id: current.id, page, start: selected.start, end, text: nextText }); focusRequest.current = { id: current.id, page, start: selected.start, end };
    if (flush(current.id) && message) flash(message);
  };
  const format = (patch: NoteSegStyle) => replaceRange(items => items.map(item => item.t === 'text' || item.t === 'chip' ? { ...item, s: { ...item.s, ...patch } } : item));
  const copySelected = async (whole = false) => {
    const selection = selectedRange(); const value = whole ? workingNote?.content ?? '' : selection ? selection.text.slice(selection.start, selection.end) : '';
    if (!whole && !selection) return;
    const ok = await copyToClipboard(value); if (mounted.current) flash(ok ? copy.copied : copy.copyFailed);
  };
  const download = () => {
    if (!workingNote) return;
    const blob = new Blob([`${noteDisplayTitle(workingNote, copy.untitled)}\n\n${workingNote.content}`], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url;
    link.download = `${noteDisplayTitle(workingNote, copy.untitled).replace(/[<>:"/\\|?*]/g, '_')}.txt`; document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const paste = async () => {
    const selection = selectedRange(); if (!selection || !current) return;
    const id = current.id, atPage = page, source = text, sourceDocument = JSON.stringify(doc);
    try {
      const value = await navigator.clipboard.readText(); if (!isCurrent(id, atPage, source) || JSON.stringify(docRef.current) !== sourceDocument) return;
      replaceRange(() => editPageText([], value), copy.pasted, selection);
    } catch { if (!isCurrent(id, atPage, source)) return; flash(copy.pasteFailed); focusRequest.current = { id, page: atPage, start: selection.start, end: selection.end }; boxRef.current?.focus({ preventScroll: true }); boxRef.current?.setSelectionRange(selection.start, selection.end); }
  };
  const toggleNumbering = () => {
    const selection = selectedRange(); if (!selection) return;
    let offset = 0, from = 0, paragraphStart = 0;
    const paragraphs: { from: number; to: number; a: number; b: number }[] = [];
    const numbers = numberLabels(segments);
    segments.forEach((item, index) => { if (item.t === 'br') { paragraphs.push({ from, to: index, a: paragraphStart, b: offset }); from = index + 1; paragraphStart = offset + 1; } offset += item.t === 'br' ? 1 : item.t === 'num' ? (numbers.get(index)?.length ?? 0) + 1 : item.v.length; });
    paragraphs.push({ from, to: segments.length, a: paragraphStart, b: offset });
    const chosen = paragraphs.filter(item => item.b >= selection.start && item.a < selection.end), allOn = chosen.every(item => segments[item.from]?.t === 'num');
    const starts = new Set(chosen.map(item => item.from));
    const next = segments.flatMap((item, index): NoteSeg[] => starts.has(index) ? allOn && item.t === 'num' ? [] : !allOn && item.t !== 'num' ? [{ t: 'num', v: '' }, item] : [item] : [item]);
    stage({ doc: { pages: doc.pages.map((items, index) => index === page ? next : items) } }); flush(); setMenuOpen(false);
  };
  const buildPreview = (scope: Preview['scope'], source: NotepadNote | null = workingNote, selected?: string, sourcePage = page, selectionStart?: number) => {
    if (!source) return;
    const selectedRangeValue = selectedRange();
    selected ??= selectedRangeValue ? selectedRangeValue.text.slice(selectedRangeValue.start, selectedRangeValue.end) : '';
    const existing = new Set(existingTaskSources);
    selectionStart ??= selectedRangeValue?.start;
    for (const row of previewRef.current?.rows ?? []) if (row.status === 'created' || row.status === 'existing') existing.add(row.sourceKey);
    const rows = noteTaskCandidates(source, scope, sourcePage, selected, selectionStart).map(item => ({ ...item, selected: !existing.has(item.sourceKey), status: existing.has(item.sourceKey) ? 'existing' as const : 'ready' as const }));
    setPreview({ source, scope, page: sourcePage, selectionStart, selection: selected, rows, phase: previewRef.current?.source.id === source.id ? previewRef.current.phase : taskCategories[0]?.id ?? '', date: previewRef.current?.source.id === source.id ? previewRef.current.date : '' });
  };
  const openPreview = () => { if (!workingNote || !flush()) return; buildPreview(selectedRange() ? 'selection' : 'page'); setMenuOpen(false); };
  const refreshPreview = () => {
    const before = previewRef.current;
    if (!before || !flush(before.source.id)) return;
    const source = current?.id === before.source.id ? workingNote : notesRef.current.find(note => note.id === before.source.id);
    if (!source) { flash(words('Нотатка недоступна. Відновіть її з Архіву.', 'The note is unavailable. Restore it from Archive.')); return; }
    const sourcePage = Math.min(before.page, noteDoc(source).pages.length - 1);
    const fullText = pageText(noteDoc(source).pages[sourcePage] ?? []);
    const exactSelection = before.selectionStart !== undefined && fullText.slice(before.selectionStart, before.selectionStart + before.selection.length) === before.selection;
    const scope = before.scope === 'selection' && !exactSelection ? 'page' : before.scope;
    const existing = new Set(existingTaskSources);
    const rows = noteTaskCandidates(source, scope, sourcePage, scope === 'selection' ? before.selection : '', scope === 'selection' ? before.selectionStart : undefined).map(item => {
      const old = before.rows.find(row => row.sourceKey === item.sourceKey);
      const done = existing.has(item.sourceKey) || old?.status === 'created' || old?.status === 'existing';
      return { ...item, title: old?.title ?? item.title, selected: done ? false : old?.selected ?? true,
        status: done ? 'existing' as const : 'ready' as const, taskId: old?.taskId };
    });
    setPreview({ ...before, source, scope, page: sourcePage, rows, selection: scope === 'selection' ? before.selection : '' });
  };
  const updateRow = (id: string, patch: Partial<PreviewRow>) => setPreview(previous => previous ? { ...previous, rows: previous.rows.map(row => row.id === id ? { ...row, ...patch } : row) } : null);
  const submitTasks = async (onlyIds?: string[]) => {
    const before = previewRef.current; if (!before || creating || !onCreateTasks) return;
    const selected = before.rows.filter(row => (onlyIds ? onlyIds.includes(row.id) : row.selected) && row.status !== 'created' && row.status !== 'existing' && row.title.trim()); if (!selected.length) return;
    setCreating(true);
    let results: NotepadTaskResult[];
    try { results = await onCreateTasks(selected.map(({ selected: _selected, status: _status, error: _error, taskId: _taskId, ...item }) => ({ ...item, title: item.title.trim() })), { phase: before.phase, ...(before.date ? { plannedDate: before.date } : {}) }); }
    catch { results = selected.map(row => ({ id: row.id, status: 'error', error: copy.saveFailed })); }
    if (!mounted.current) return;
    setCreating(false);
    setPreview(previous => previous?.source.id === before.source.id ? { ...previous, rows: previous.rows.map(row => {
      if (!selected.some(item => item.id === row.id)) return row;
      const result = results.find(item => item.id === row.id);
      return { ...row, status: result?.status ?? 'error', taskId: result?.taskId, error: result?.status === 'error' ? result.error ?? copy.saveFailed : !result ? copy.saveFailed : undefined };
    }) } : previous);
  };
  const mergeRows = () => {
    if (!preview) return;
    const picked = preview.rows.filter(row => row.selected && (row.status === 'ready' || row.status === 'error')); if (picked.length < 2) return;
    const merged = { ...picked[0], id: `note-task-${crypto.randomUUID()}`, title: picked.map(row => row.title).join('; '), sourceText: picked.map(row => row.sourceText).join('\n'), sourceKey: `${picked[0].noteId}:group:${noteSourceHash(picked.map(row => row.sourceKey).sort().join('|'))}`, status: 'ready' as const, error: undefined };
    setPreview({ ...preview, rows: preview.rows.flatMap(row => row.id === picked[0].id ? [merged] : picked.some(item => item.id === row.id) ? [] : [row]) });
  };
  const labels = numberLabels(segments), selection = selectedRange();
  const deletedPending = deletedNotes.filter(note => (note.undoUntil ?? 0) > now);
  const archivedPages = workingNote?.deletedPages ?? [];
  const orphanDrafts = Object.entries(drafts).filter(([id]) => !notes.some(note => note.id === id));
  const selectedDraftError = current ? errors[current.id] : '';
  const createdIds = preview?.rows.flatMap(row => row.taskId ? [row.taskId] : []) ?? [];
  return <div className="pulse-page-shell notes-view">
    <div className="pulse-page-head"><div className="pulse-page-head-copy"><h1 className="pulse-page-title"><span className="pulse-page-title-light">{copy.title[0]}</span><span className="pulse-page-title-heavy">{copy.title[1]}</span></h1>
      <div className="nv-switch" role="group" aria-label={copy.filter}>{(['all', 'lesson', 'idea'] as const).map(value => <button key={value} type="button" aria-pressed={filter === value} onClick={() => { if (flush()) { setFilter(value); setSelectedId(undefined); setMenuOpen(false); } }}>{copy.filters[value]}</button>)}</div></div></div>
    {storageError && <p role="alert" className="nv-alert">{copy.storage}</p>}
    {deletedPending.map(note => <div key={note.id} className="nv-pending-delete" role="status"><span>{words('Нотатку прибрано', 'Note removed')}: {noteDisplayTitle(note, copy.untitled)} · {Math.max(1, Math.ceil(((note.undoUntil ?? now) - now) / 1000))}</span><button type="button" onClick={() => { if (onRestoreNote(note.id)) { setFilter('all'); setQuery(''); choose(note.id); } else flash(copy.saveFailed); }}>{copy.undo}</button></div>)}
    <div className="pulse-page-grid nv-grid"><aside className="pulse-page-sidebar"><label className="nv-search"><Path d="m21 21-4.34-4.34M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0" /><input type="text" aria-label={copy.searchLabel} placeholder={copy.search} value={query} onChange={event => { if (flush()) setQuery(event.target.value); }} /><button type="button" aria-label={copy.newNote} onClick={newNote}><Path d="M12 5v14M5 12h14" /></button></label>
      {!shown.length && (query || filter !== 'all') && <div className="nv-search-empty"><span>{words('Нотаток не знайдено', 'No matching notes')}</span><button type="button" onClick={() => { setQuery(''); setFilter('all'); }}>{words('Очистити пошук і фільтр', 'Clear search and filter')}</button></div>}
      {shown.map(note => <button key={note.id} type="button" className="nv-item" aria-pressed={note.id === current?.id} onClick={() => choose(note.id)}><span className="nv-item-copy"><span className="nv-item-title">{noteDisplayTitle(drafts[note.id] ? { title: drafts[note.id].title, content: docText(drafts[note.id].doc) } : note, copy.untitled)}</span><span className="nv-item-date">{noteDate(note.updatedAt ?? note.createdAt, now, lang)}</span></span>{note.pinned && <span className="nv-item-pin" aria-label={copy.pinned}><Path d={PIN_PATH} size={13} /></span>}<span className="nv-item-dot" style={{ background: kindOf(note) === 'idea' ? '#13f287' : '#8442ff' }} /></button>)}
      {orphanDrafts.length > 0 && <details className="nv-orphan-drafts"><summary>{words('Збережені чернетки поза списком', 'Retained drafts outside this list')} ({orphanDrafts.length})</summary>{orphanDrafts.map(([id, retained]) => <div key={id}><span>{noteDisplayTitle({ title: retained.title, content: docText(retained.doc) }, copy.untitled)}</span><button type="button" onClick={async () => flash(await copyToClipboard(`${retained.title}\n${docText(retained.doc)}`) ? copy.copied : copy.copyFailed)}>{copy.copy}</button><button type="button" onClick={() => { const copyId = `note-${crypto.randomUUID()}`; if (onAddNote({ id: copyId, title: retained.title, content: docText(retained.doc), doc: retained.doc, kind: retained.base.kind ?? 'idea', updatedAt: Date.now() })) { clearDraft(id); setFilter('all'); setQuery(''); setSelectedId(copyId); } else flash(copy.saveFailed); }}>{words('Створити окрему копію', 'Create a separate copy')}</button></div>)}</details>}
    </aside><div className="pulse-page-main"><section className="nv-paper" aria-label={copy.note} data-revealed={current?.id === revealNoteId || undefined}>{current && workingNote ? <>
      <div className="nv-swap"><div className="nv-meta"><div role="radiogroup" aria-label={copy.kindLabel} className="nv-kinds">{(['lesson', 'idea'] as const).map(value => <button key={value} type="button" role="radio" aria-checked={kindOf(workingNote) === value} data-kind={value} onClick={() => saveMetadata({ kind: value })}>{copy.kinds[value]}</button>)}</div><span className="nv-save-state" data-state={selectedDraftError ? 'error' : draft ? 'pending' : 'saved'} role="status">{selectedDraftError ? words('Не збережено', 'Not saved') : draft ? words('Зберігаємо…', 'Saving…') : words('Збережено на пристрої', 'Saved on this device')}</span></div>
        <input className="nv-title-input" aria-label={copy.titleLabel} placeholder={noteDisplayTitle({ title: '', content: workingNote.content }, words('Назва необов’язкова', 'Optional title'))} value={title} maxLength={300} autoCapitalize="sentences" onChange={event => stage({ title: event.target.value })} onBlur={() => flush()} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); boxRef.current?.focus(); } }} />
        <textarea ref={boxRef} key={`${current.id}:${page}`} className="nv-append" rows={6} aria-label={copy.appendLabel} placeholder={copy.appendPlaceholder} value={text} autoCapitalize="sentences"
          onChange={event => { const box = event.currentTarget, input = event.nativeEvent as InputEvent; if (composing.current === null && !input.isComposing && input.inputType === 'insertText' && input.data) { const next = capitalizeNoteTyping(box.value, box.selectionStart - input.data.length, box.selectionStart, box.selectionStart, box.selectionEnd); stageText(next.text, { start: next.selectionStart, end: next.selectionEnd }); } else stageText(box.value); setMenuOpen(false); }}
          onSelect={captureRange} onMouseUp={event => { captureRange(); if (event.button === 0 && event.currentTarget.selectionStart !== event.currentTarget.selectionEnd) setMenuOpen(true); }}
          onBlur={() => { rememberCursor(); flush(); }} onCompositionStart={event => { composing.current = event.currentTarget.value; }}
          onCompositionEnd={event => { const before = composing.current, box = event.currentTarget, value = box.value, id = current.id; composing.current = null; requestAnimationFrame(() => { if (before === null || !box.isConnected || composing.current !== null || !isCurrent(id, page, value)) return; let start = 0, end = value.length, oldEnd = before.length; while (start < end && start < oldEnd && value[start] === before[start]) start++; while (end > start && oldEnd > start && value[end - 1] === before[oldEnd - 1]) { end--; oldEnd--; } const next = capitalizeNoteTyping(value, start, end, box.selectionStart, box.selectionEnd); stageText(next.text, { start: next.selectionStart, end: next.selectionEnd }); }); }} />
        {selectedDraftError && <div className="nv-save-error" role="alert"><p>{selectedDraftError}</p><div className="nv-text-actions"><button type="button" onClick={() => flush()}>{words('Повторити', 'Retry')}</button><button type="button" onClick={() => flush(current.id, true)}>{words('Зберегти мою версію', 'Save my version')}</button><button type="button" onClick={() => void copySelected(true)}>{copy.copy}</button><button type="button" onClick={download}>{words('Зберегти копію', 'Download a copy')}</button></div></div>}
        <div className="nv-text-actions"><button type="button" aria-expanded={menuOpen} disabled={!selection} onMouseDown={event => event.preventDefault()} onClick={() => { captureRange(); setMenuOpen(value => !value); }}>{words('Дії з виділеним', 'Selection actions')}</button><button type="button" aria-pressed={showStyled} onClick={() => setShowStyled(value => !value)}>{words('Оформлений вигляд', 'Formatted preview')}</button><button type="button" onClick={download}>{words('Зберегти копію', 'Download a copy')}</button></div>
        {menuOpen && selection && <div className="nv-menu nv-selection-menu" role="group" aria-label={copy.menu} onMouseDown={event => { if ((event.target as HTMLElement).tagName === 'BUTTON') event.preventDefault(); }}>
          <select aria-label={copy.font} onChange={event => format({ font: event.target.value })} defaultValue=""><option value="" disabled>{copy.font}</option>{BASE_FONTS.map(font => <option key={font} value={font}>{font}</option>)}</select>
          <div className="nv-format-row"><label>{copy.size}<input type="number" min="8" max="96" defaultValue="18" onChange={event => { const size = Number(event.target.value); if (size >= 8 && size <= 96) format({ size }); }} /></label>{WEIGHTS.map((weight, index) => <button type="button" key={weight} aria-label={copy.weights[index]} style={{ fontWeight: weight }} onClick={() => format({ weight })}>Аа</button>)}</div>
          <button type="button" onClick={() => { boxRef.current?.focus(); boxRef.current?.setSelectionRange(selection.start, selection.end); }}>{copy.append}</button><button type="button" onClick={() => void copySelected()}>{copy.copy}</button><button type="button" onClick={() => void paste()}>{copy.paste}</button><button type="button" onClick={toggleNumbering}>{copy.numbering}</button><button type="button" onClick={() => replaceRange(() => [{ t: 'chip', v: selection.text.slice(selection.start, selection.end) }], copy.chipAdded)}>{copy.chip}</button><button type="button" onClick={() => replaceRange(items => items.map(item => item.t === 'chip' ? { ...item, t: 'text' } : item), copy.chipRemoved)}>{copy.plain}</button><button type="button" onClick={() => replaceRange(() => [], copy.deleted)}>{copy.remove}</button>
        </div>}
        {showStyled && <div className="nv-editor nv-formatted-preview" aria-label={words('Оформлений вигляд сторінки', 'Formatted page preview')}>{segments.map((item, index) => item.t === 'br' ? <br key={index} /> : item.t === 'num' ? <span key={index} className="nv-num">{labels.get(index)} </span> : item.t === 'chip' ? <span className="nv-chip" key={index}>{item.v}<button type="button" aria-label={copy.copy} onClick={async () => flash(await copyToClipboard(item.v) ? copy.copied : copy.copyFailed)}><Path d={ICONS.copy} size={15} /></button></span> : <span key={index} style={{ fontFamily: fontFamily(item.s?.font), fontSize: item.s?.size, fontWeight: item.s?.weight }}>{item.v}</span>)}</div>}
      </div>
      <div className="nv-footer"><button type="button" className="nv-make" onMouseDown={event => event.preventDefault()} onClick={openPreview}>{words('У завдання', 'Create tasks')}</button><div role="tablist" aria-label={copy.pages} className="nv-pages">{doc.pages.map((_, index) => <button key={index} type="button" role="tab" aria-selected={index === page} aria-label={`${copy.page} ${index + 1}`} onClick={() => changePage(index)}>{index + 1}</button>)}<button type="button" aria-label={copy.addPage} onClick={addPage}>+</button></div><div className="nv-actions"><button type="button" className="nv-pin" aria-label={workingNote.pinned ? copy.unpin : copy.pin} aria-pressed={!!workingNote.pinned} onClick={() => saveMetadata({ pinned: !workingNote.pinned })}><Path d={PIN_PATH} /></button><button type="button" className="nv-delete" aria-label={copy.remove} onClick={removeNote}><Path d={ICONS.trash} /></button></div></div>
      <details className="nv-page-options"><summary>{words('Дії зі сторінкою', 'Page actions')}</summary><button type="button" onClick={deletePage}>{words('Видалити цю сторінку', 'Delete this page')}</button>{archivedPages.map(item => <div key={item.id}><span>{words('Прибрана сторінка', 'Removed page')} {item.index + 1}: {pageText(item.segments).slice(0, 70) || copy.emptyPage}</span><button type="button" onClick={() => restorePage(item.id)}>{words('Відновити', 'Restore')}</button></div>)}</details>
    </> : <div className="nv-none"><span>{query || filter !== 'all' ? words('Нотаток не знайдено', 'No matching notes') : copy.empty}</span>{(query || filter !== 'all') && <button type="button" onClick={() => { setQuery(''); setFilter('all'); }}>{words('Очистити пошук і фільтр', 'Clear search and filter')}</button>}<button type="button" className="nv-make" onClick={newNote}>{copy.newNote}</button></div>}
    {toast && <div className="nv-toast-wrap"><span className="nv-toast" role="status">{toast.text}{toast.undo && <button type="button" onClick={() => { const result = toast.undo?.(); if (result === 'stale') flash(words('Є новіші зміни. Потрібні поля можна виправити в нотатці.', 'Newer edits exist. You can edit the fields directly.')); else if (result) setToast(null); else setToast({ ...toast, text: copy.saveFailed, until: Number.POSITIVE_INFINITY }); }}>{words('Скасувати', 'Undo')}</button>}</span></div>}
    </section>
    {preview && <section className="nv-task-preview" aria-label={words('Перегляд завдань із нотатки', 'Tasks from note preview')}><div className="nv-preview-head"><h2>{words('Із нотатки в завдання', 'From note to tasks')}</h2><button type="button" disabled={creating} onClick={() => setPreview(null)}>{words('Закрити', 'Close')}</button></div><p>{words('Джерело збережеться в нотатці; завдання отримають посилання й копію контексту.', 'Your note stays intact. Tasks include a source link and context copy.')}</p>
      <label>{words('Джерело', 'Source')}<select disabled={creating} value={preview.scope} onChange={event => buildPreview(event.target.value as Preview['scope'], preview.source, preview.selection, preview.page, preview.selectionStart)}>{preview.selection && <option value="selection">{words('Виділення', 'Selection')}</option>}<option value="page">{words('Поточна сторінка', 'Current page')}</option><option value="note">{words('Уся нотатка', 'Entire note')}</option></select></label>
      <button type="button" disabled={creating} onClick={refreshPreview}>{words('Оновити рядки з нотатки', 'Refresh rows from note')}</button>
      <div className="nv-preview-common"><label>{words('Категорія', 'Category')}<select disabled={creating} value={preview.phase} onChange={event => setPreview({ ...preview, phase: event.target.value })}>{!taskCategories.length && <option value="">{words('Поточна категорія', 'Current category')}</option>}{taskCategories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>{words('День роботи', 'Work date')}<input type="date" disabled={creating} value={preview.date} onChange={event => setPreview({ ...preview, date: event.target.value })} /></label></div>
      {!preview.rows.length && <p>{words('Немає непорожніх рядків. Додай текст у нотатку.', 'No nonempty lines. Add some text to the note.')}</p>}
      {preview.rows.map(row => <div key={row.id} className="nv-preview-row" data-state={row.status}><input type="checkbox" aria-label={words('Вибрати завдання', 'Select task')} checked={row.selected} disabled={creating || row.status === 'created' || row.status === 'existing'} onChange={event => updateRow(row.id, { selected: event.target.checked })} /><input aria-label={words('Назва завдання', 'Task title')} value={row.title} disabled={creating || row.status === 'created' || row.status === 'existing'} onChange={event => updateRow(row.id, { title: event.target.value, status: 'ready', error: undefined })} /><span role="status">{row.status === 'created' ? words('Створено', 'Created') : row.status === 'existing' ? words('Уже додано', 'Already added') : row.error ?? ''}</span>{row.status === 'error' && <button type="button" disabled={creating || !onCreateTasks || !row.title.trim()} onClick={() => void submitTasks([row.id])}>{words('Повторити цей пункт', 'Retry this item')}</button>}{row.status === 'existing' && <button type="button" disabled={creating} onClick={() => updateRow(row.id, { sourceKey: `${row.sourceKey}:copy:${crypto.randomUUID()}`, status: 'ready', selected: true, taskId: undefined })}>{words('Створити ще одне', 'Create another')}</button>}</div>)}
      <div className="nv-text-actions"><button type="button" disabled={creating || preview.rows.filter(row => row.selected && (row.status === 'ready' || row.status === 'error')).length < 2} onClick={mergeRows}>{words('Об’єднати вибрані', 'Merge selected')}</button><button type="button" disabled={creating || !onCreateTasks || !preview.rows.some(row => row.selected && row.title.trim() && (row.status === 'ready' || row.status === 'error'))} onClick={() => void submitTasks()}>{creating ? words('Створюємо…', 'Creating…') : preview.rows.some(row => row.status === 'error') ? words('Повторити невдалі', 'Retry failed') : words('Створити вибрані завдання', 'Create selected tasks')}</button>{createdIds.length > 0 && onOpenTasks && <button type="button" onClick={() => onOpenTasks(createdIds)}>{words('Відкрити завдання', 'Open tasks')}</button>}</div>
      {!onCreateTasks && <p role="alert">{words('Створення завдань зараз недоступне. Текст лишається в нотатці.', 'Task creation is currently unavailable. Your note is intact.')}</p>}
      {onMakeTasks && <details className="nv-ai-optional"><summary>{words('Необов’язково: сформулювати з AI', 'Optional: refine with AI')}</summary><p>{words('До AI піде лише показаний нижче текст. Відкриється чернетка; зовнішнє надсилання — лише кнопкою «Надіслати» в чаті. Локальний перегляд лишиться доступним.', 'Only the text below is used. This opens a draft; external sending requires Send in the chat. Your local preview stays available.')}</p><pre>{preview.rows.filter(row => row.selected).map(row => row.sourceText).join('\n')}</pre><button type="button" onClick={() => onMakeTasks({ ...preview.source, title: noteDisplayTitle(preview.source, copy.untitled), content: preview.rows.filter(row => row.selected).map(row => row.sourceText).join('\n'), doc: undefined })}>{words('Відкрити цей запит у AI', 'Open this draft in AI')}</button></details>}
    </section>}
    </div></div>
  </div>;
}
