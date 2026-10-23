import type { NoteDoc, NotepadNote } from '../types';
import { isNoteDoc } from './noteDoc';

export interface NoteEditorDraft {
  base: NotepadNote;
  title: string;
  doc: NoteDoc;
  metadata?: Pick<Partial<NotepadNote>, 'kind' | 'pinned' | 'deletedPages'>;
  at: number;
}
export interface NoteCursor { page: number; start: number; end: number; scroll: number }
const sessions = new Map<string, Record<string, NoteEditorDraft>>();
const blocked = new Set<string>();
const unpersisted = new Set<string>();
let unloadGuard = false;
const scope = (owner: string | null) => encodeURIComponent(owner === null ? 'guest' : `account:${owner}`);
const key = (owner: string | null) => `karkas_notes_editor_v2:${scope(owner)}`;
const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
const updateGuard = () => {
  if (typeof window === 'undefined') return;
  const needed = [...unpersisted].some(owner => Object.keys(sessions.get(owner) ?? {}).length > 0);
  if (needed && !unloadGuard) { window.addEventListener('beforeunload', warn); unloadGuard = true; }
  else if (!needed && unloadGuard) { window.removeEventListener('beforeunload', warn); unloadGuard = false; }
};

export function readEditorDrafts(owner: string | null): Record<string, NoteEditorDraft> {
  const cached = sessions.get(scope(owner));
  if (cached) return cached;
  const drafts: Record<string, NoteEditorDraft> = {};
  let original: string | null = null, malformed = false;
  try {
    original = localStorage.getItem(key(owner));
    const raw = JSON.parse(original ?? '{}');
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) for (const [id, value] of Object.entries(raw)) {
      const draft = value as NoteEditorDraft;
      if (draft && draft.base?.id === id && typeof draft.base.title === 'string' && typeof draft.base.content === 'string'
        && (draft.base.doc === undefined || isNoteDoc(draft.base.doc))
        && typeof draft.title === 'string' && isNoteDoc(draft.doc) && Number.isFinite(draft.at)) {
        drafts[id] = { ...draft, metadata: draft.metadata && typeof draft.metadata === 'object' ? {
          ...(draft.metadata.kind === 'idea' || draft.metadata.kind === 'lesson' ? { kind: draft.metadata.kind } : {}),
          ...(typeof draft.metadata.pinned === 'boolean' ? { pinned: draft.metadata.pinned } : {}),
          ...(Array.isArray(draft.metadata.deletedPages) && draft.metadata.deletedPages.every(page => typeof page.id === 'string'
            && Number.isSafeInteger(page.index) && page.index >= 0 && Number.isFinite(page.deletedAt) && Number.isFinite(page.undoUntil)
            && isNoteDoc({ pages: [page.segments] })) ? { deletedPages: draft.metadata.deletedPages } : {}),
        } : undefined };
      } else malformed = true;
    }
    else malformed = true;
  } catch { malformed = true; }
  if (malformed && original !== null) {
    try {
      const backup = `${key(owner)}:recovery:${Date.now()}:${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(backup, original);
      if (localStorage.getItem(backup) !== original) blocked.add(scope(owner));
    } catch { blocked.add(scope(owner)); }
  }
  sessions.set(scope(owner), drafts);
  return drafts;
}

export function writeEditorDraft(owner: string | null, id: string, draft: NoteEditorDraft | null): boolean {
  const drafts = { ...readEditorDrafts(owner) };
  if (draft) drafts[id] = draft; else delete drafts[id];
  sessions.set(scope(owner), drafts);
  if (blocked.has(scope(owner))) { unpersisted.add(scope(owner)); updateGuard(); return false; }
  try {
    const raw = JSON.stringify(drafts);
    localStorage.setItem(key(owner), raw);
    const ok = localStorage.getItem(key(owner)) === raw;
    if (ok) unpersisted.delete(scope(owner)); else unpersisted.add(scope(owner));
    updateGuard(); return ok;
  } catch { unpersisted.add(scope(owner)); updateGuard(); return false; }
}

export function readNoteCursor(owner: string | null, id: string): NoteCursor | null {
  try {
    const value = JSON.parse(localStorage.getItem(`${key(owner)}:cursor:${encodeURIComponent(id)}`) ?? 'null') as NoteCursor | null;
    return value && [value.page, value.start, value.end, value.scroll].every(number => Number.isFinite(number) && number >= 0)
      && Number.isInteger(value.page) && Number.isInteger(value.start) && Number.isInteger(value.end) ? value : null;
  } catch { return null; }
}
export function readLastNoteId(owner: string | null): string | null {
  try { return localStorage.getItem(`${key(owner)}:last`); } catch { return null; }
}

export function writeNoteCursor(owner: string | null, id: string, value: NoteCursor): void {
  try { localStorage.setItem(`${key(owner)}:cursor:${encodeURIComponent(id)}`, JSON.stringify(value)); localStorage.setItem(`${key(owner)}:last`, id); } catch { /* Cursor persistence is optional. */ }
}
