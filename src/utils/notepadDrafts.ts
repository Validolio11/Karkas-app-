import type { NotepadNote } from '../types';

const NOTEPAD_DRAFT_KEY = 'karkas_notepad_drafts_v1';
const migrationKey = `${NOTEPAD_DRAFT_KEY}:migration-owner`;
const ownerScope = (ownerId: string | null) => ownerId === null ? 'guest' : `account:${ownerId}`;
const draftKey = (ownerId: string | null) => `${NOTEPAD_DRAFT_KEY}:${encodeURIComponent(ownerScope(ownerId))}`;
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
type DraftSession = { drafts: NotepadDrafts | null; storageError: boolean; cleanupPending: boolean };
const sessions = new Map<string, DraftSession>();
const getSession = (ownerId: string | null): DraftSession => {
  const key = ownerScope(ownerId);
  let session = sessions.get(key);
  if (!session) { session = { drafts: null, storageError: false, cleanupPending: false }; sessions.set(key, session); }
  return session;
};
let unloadGuardAttached = false;

const warnBeforeUnloading = (event: BeforeUnloadEvent): void => {
  event.preventDefault();
  event.returnValue = '';
};

// This guard belongs to the session, so leaving Notes does not remove it.
const refreshUnloadGuard = (): void => {
  if (typeof window === 'undefined') return;
  const needsGuard = [...sessions.values()].some(session => session.storageError
    && Boolean(session.drafts?.composer || session.drafts?.edit || session.cleanupPending));
  if (needsGuard && !unloadGuardAttached) {
    window.addEventListener('beforeunload', warnBeforeUnloading);
    unloadGuardAttached = true;
  } else if (!needsGuard && unloadGuardAttached) {
    window.removeEventListener('beforeunload', warnBeforeUnloading);
    unloadGuardAttached = false;
  }
};

export const markNotepadDraftCleanup = (ownerId: string | null = null): void => {
  getSession(ownerId).cleanupPending = true;
  refreshUnloadGuard();
};

export const rememberNotepadDrafts = (drafts: NotepadDrafts, ownerId: string | null = null): void => {
  getSession(ownerId).drafts = {
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
const backupDrafts = (storage: DraftStorage, raw: string, storageKey: string): void => {
  const prefix = `${storageKey}:recovery-backup`;
  let suffix = 0;
  while (true) {
    const key = suffix === 0 ? prefix : `${prefix}:${suffix}`;
    const previous = storage.getItem(key);
    if (previous === raw) return;
    if (previous === null) {
      storage.setItem(key, raw);
      if (storage.getItem(key) !== raw) throw new Error('Draft backup could not be verified');
      return;
    }
    suffix += 1;
  }
};

const migrateLegacyDrafts = (storage: DraftStorage): void => {
  if (storage.getItem(migrationKey) !== null) return;
  // Saved notes remember the original device workspace owner before account switching.
  const scope = storage.getItem('karkas_notepad_notes_v1:migration-owner')
    ?? ownerScope(storage.getItem('karkas_workspace_owner'));
  if (scope !== 'guest' && !scope.startsWith('account:')) throw new Error('Unknown legacy notes owner');
  const target = `${NOTEPAD_DRAFT_KEY}:${encodeURIComponent(scope)}`;
  const legacy = storage.getItem(NOTEPAD_DRAFT_KEY);
  if (legacy !== null && storage.getItem(target) === null) {
    storage.setItem(target, legacy);
    if (storage.getItem(target) !== legacy) throw new Error('Draft migration could not be verified');
  }
  storage.setItem(migrationKey, scope);
  if (storage.getItem(migrationKey) !== scope) throw new Error('Draft migration owner could not be saved');
  // Retain the legacy value as recovery data; subsequent accounts never read it.
};

const loadPersistentDrafts = (storage: DraftStorage, ownerId: string | null): NotepadDraftLoadResult => {
  const key = draftKey(ownerId);
  let raw: string | null;
  try { migrateLegacyDrafts(storage); raw = storage.getItem(key); }
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
    backupDrafts(storage, raw, key);
    return { drafts, canPersist: true, recovered: true };
  } catch {
    return { drafts, canPersist: false, recovered: true };
  }
};

export const loadNotepadDrafts = (storage?: DraftStorage, ownerId: string | null = null): NotepadDraftLoadResult => {
  const session = getSession(ownerId);
  const loaded = storage ? loadPersistentDrafts(storage, ownerId)
    : { drafts: emptyDrafts(), canPersist: false, recovered: false };
  // A failed write or clear must not resurrect an older disk draft on navigation.
  return { ...loaded, drafts: session.drafts || loaded.drafts, cleanupPending: session.cleanupPending };
};

export const saveNotepadDrafts = (storage: DraftStorage | undefined, drafts: NotepadDrafts, canPersist = true, ownerId: string | null = null): boolean => {
  const key = draftKey(ownerId);
  const session = getSession(ownerId);
  rememberNotepadDrafts(drafts, ownerId);
  if (!storage || !canPersist) {
    session.storageError = true;
    refreshUnloadGuard();
    return false;
  }
  try {
    if (drafts.composer || drafts.edit) {
      storage.setItem(key, JSON.stringify({ version: 1, ...drafts }));
    } else if (storage.getItem(key) !== null) {
      try { storage.removeItem(key); }
      catch {
        // Some storage providers allow a neutral replacement when deletion fails.
        storage.setItem(key, JSON.stringify({ version: 1, ...emptyDrafts() }));
      }
    }
    session.storageError = false;
    session.cleanupPending = false;
    refreshUnloadGuard();
    return true;
  } catch {
    session.storageError = true;
    refreshUnloadGuard();
    return false;
  }
};
