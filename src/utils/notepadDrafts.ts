import type { NotepadNote } from '../types';

const NOTEPAD_DRAFT_KEY = 'karkas_notepad_drafts_v1';
type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface NoteComposerDraft {
  title: string;
  content: string;
  color: string;
}

export type NoteDraftBase = Pick<NotepadNote, 'id' | 'createdAt' | 'updatedAt' | 'title' | 'content' | 'color'>;

export interface NoteEditDraft extends NoteComposerDraft {
  base: NoteDraftBase | null;
}

export interface NotepadDrafts {
  composer: NoteComposerDraft | null;
  edit: NoteEditDraft | null;
}

export interface NotepadDraftLoadResult {
  drafts: NotepadDrafts;
  canPersist: boolean;
  recovered: boolean;
  cleanupPending?: boolean;
}

const emptyDrafts = (): NotepadDrafts => ({ composer: null, edit: null });
let sessionDrafts: NotepadDrafts | null = null;
let sessionStorageError = false;
let sessionCleanupPending = false;
let unloadGuardAttached = false;

const warnBeforeUnloading = (event: BeforeUnloadEvent): void => {
  event.preventDefault();
  event.returnValue = '';
};

// This guard belongs to the session, so leaving Notes does not remove it.
const refreshUnloadGuard = (): void => {
  if (typeof window === 'undefined') return;
  const needsGuard = sessionStorageError && Boolean(sessionDrafts?.composer || sessionDrafts?.edit || sessionCleanupPending);
  if (needsGuard && !unloadGuardAttached) {
    window.addEventListener('beforeunload', warnBeforeUnloading);
    unloadGuardAttached = true;
  } else if (!needsGuard && unloadGuardAttached) {
    window.removeEventListener('beforeunload', warnBeforeUnloading);
    unloadGuardAttached = false;
  }
};

export const markNotepadDraftCleanup = (): void => {
  sessionCleanupPending = true;
};

export const rememberNotepadDrafts = (drafts: NotepadDrafts): void => {
  sessionDrafts = {
    composer: drafts.composer ? { ...drafts.composer } : null,
    edit: drafts.edit ? { ...drafts.edit, base: drafts.edit.base ? { ...drafts.edit.base } : null } : null,
  };
};
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));
const isTimestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 8.64e15;

export const noteDraftBase = (note: NotepadNote): NoteDraftBase => ({
  id: note.id, createdAt: note.createdAt, updatedAt: note.updatedAt,
  title: note.title, content: note.content, color: note.color,
});

export const noteDraftMatches = (base: NoteDraftBase | null, note: NotepadNote | undefined): boolean =>
  Boolean(base && note && base.id === note.id && base.createdAt === note.createdAt
    && base.updatedAt === note.updatedAt && base.title === note.title
    && base.content === note.content && base.color === note.color);

const readBase = (value: unknown): NoteDraftBase | null => {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()
    || !isTimestamp(value.createdAt) || (value.updatedAt !== undefined && !isTimestamp(value.updatedAt))
    || typeof value.title !== 'string' || typeof value.content !== 'string'
    || (value.color !== undefined && typeof value.color !== 'string')) return null;
  return {
    id: value.id, createdAt: value.createdAt, updatedAt: value.updatedAt as number | undefined,
    title: value.title, content: value.content, color: value.color as string | undefined,
  };
};

const readTextDraft = (value: unknown, allowEmpty = false): NoteComposerDraft | null => {
  if (!isRecord(value)) return null;
  const title = typeof value.title === 'string' ? value.title : '';
  const content = typeof value.content === 'string' ? value.content : '';
  if (!allowEmpty && !title && !content) return null;
  return { title, content, color: typeof value.color === 'string' ? value.color : '#38bdf8' };
};

// A malformed draft is backed up before any repaired draft can replace it.
// This key is separate from the saved-notes key and never writes saved notes.
const backupDrafts = (storage: DraftStorage, raw: string): void => {
  const prefix = `${NOTEPAD_DRAFT_KEY}:recovery-backup`;
  let suffix = 0;
  while (true) {
    const key = suffix === 0 ? prefix : `${prefix}:${suffix}`;
    const previous = storage.getItem(key);
    if (previous === raw) return;
    if (previous === null) {
      storage.setItem(key, raw);
      return;
    }
    suffix += 1;
  }
};

const loadPersistentDrafts = (storage: DraftStorage): NotepadDraftLoadResult => {
  let raw: string | null;
  try { raw = storage.getItem(NOTEPAD_DRAFT_KEY); }
  catch { return { drafts: emptyDrafts(), canPersist: false, recovered: false }; }
  if (raw === null) return { drafts: emptyDrafts(), canPersist: true, recovered: false };

  let drafts = emptyDrafts();
  let valid = false;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isRecord(parsed)) {
      const composer = readTextDraft(parsed.composer);
      const editText = readTextDraft(parsed.edit, true);
      const base = isRecord(parsed.edit) ? readBase(parsed.edit.base) : null;
      drafts = { composer, edit: editText ? { ...editText, base } : null };
      const isTextDraft = (value: unknown) => isRecord(value)
        && typeof value.title === 'string' && typeof value.content === 'string'
        && typeof value.color === 'string';
      valid = parsed.version === 1
        && (parsed.composer === null || isTextDraft(parsed.composer))
        && (parsed.edit === null || (isTextDraft(parsed.edit)
          && isRecord(parsed.edit) && (parsed.edit.base === null || base !== null)));
    }
  } catch { /* Preserve the raw data even when no text can be recovered. */ }
  if (valid) return { drafts, canPersist: true, recovered: false };

  try {
    backupDrafts(storage, raw);
    return { drafts, canPersist: true, recovered: true };
  } catch {
    return { drafts, canPersist: false, recovered: true };
  }
};

export const loadNotepadDrafts = (storage?: DraftStorage): NotepadDraftLoadResult => {
  const loaded = storage ? loadPersistentDrafts(storage)
    : { drafts: emptyDrafts(), canPersist: false, recovered: false };
  // A failed write or clear must not resurrect an older disk draft on navigation.
  return { ...loaded, drafts: sessionDrafts || loaded.drafts, cleanupPending: sessionCleanupPending };
};

export const saveNotepadDrafts = (storage: DraftStorage | undefined, drafts: NotepadDrafts, canPersist = true): boolean => {
  rememberNotepadDrafts(drafts);
  if (!storage || !canPersist) {
    sessionStorageError = true;
    refreshUnloadGuard();
    return false;
  }
  try {
    if (drafts.composer || drafts.edit) {
      storage.setItem(NOTEPAD_DRAFT_KEY, JSON.stringify({ version: 1, ...drafts }));
    } else if (storage.getItem(NOTEPAD_DRAFT_KEY) !== null) {
      try { storage.removeItem(NOTEPAD_DRAFT_KEY); }
      catch {
        // Some storage providers allow a neutral replacement when deletion fails.
        storage.setItem(NOTEPAD_DRAFT_KEY, JSON.stringify({ version: 1, ...emptyDrafts() }));
      }
    }
    sessionStorageError = false;
    sessionCleanupPending = false;
    refreshUnloadGuard();
    return true;
  } catch {
    sessionStorageError = true;
    refreshUnloadGuard();
    return false;
  }
};
