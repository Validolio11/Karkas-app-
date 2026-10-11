import type { NotepadNote } from '../types';

type NoteStorage = Pick<Storage, 'getItem' | 'setItem'>;

const legacyNotesKey = 'karkas_notepad_notes_v1';
const notesMigrationKey = `${legacyNotesKey}:migration-owner`;
export const ownedNotesKey = (owner: string | null): string =>
  `${legacyNotesKey}:${encodeURIComponent(owner === null ? 'guest' : `account:${owner}`)}`;

export function loadOwnedNotepadNotes(storage: NoteStorage, owner: string | null, fallback: NotepadNote[]): NotepadLoadResult {
  const key = ownedNotesKey(owner);
  try {
    if (storage.getItem(notesMigrationKey) === null) {
      const legacy = storage.getItem(legacyNotesKey);
      if (legacy !== null && storage.getItem(key) === null) {
        storage.setItem(key, legacy);
        if (storage.getItem(key) !== legacy) throw new Error('Notes migration could not be verified');
      }
      const scope = owner === null ? 'guest' : `account:${owner}`;
      storage.setItem(notesMigrationKey, scope);
      if (storage.getItem(notesMigrationKey) !== scope) throw new Error('Notes migration owner could not be verified');
    }
    return loadNotepadNotes(storage, key, fallback);
  } catch {
    return { notes: [], canPersist: false, recovered: false };
  }
}

export interface NotepadLoadResult {
  notes: NotepadNote[];
  canPersist: boolean;
  recovered: boolean;
  error?: string;
}

const isTimestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 8.64e15;

const isNote = (value: unknown): value is NotepadNote => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const note = value as Record<string, unknown>;
  return typeof note.id === 'string' && note.id.trim().length > 0
    && typeof note.title === 'string' && typeof note.content === 'string'
    && isTimestamp(note.createdAt)
    && (note.updatedAt === undefined || isTimestamp(note.updatedAt))
    && (note.color === undefined || typeof note.color === 'string')
    && (note.pinned === undefined || typeof note.pinned === 'boolean');
};

// Keep each distinct damaged value, including across repeated recovery attempts.
const backupRawNotes = (storage: NoteStorage, key: string, raw: string): void => {
  const prefix = `${key}:recovery-backup`;
  let suffix = 0;
  while (true) {
    const backupKey = suffix === 0 ? prefix : `${prefix}:${suffix}`;
    const previous = storage.getItem(backupKey);
    if (previous === raw) return;
    if (previous === null) {
      storage.setItem(backupKey, raw);
      if (storage.getItem(backupKey) !== raw) throw new Error('Notes backup could not be verified');
      return;
    }
    suffix += 1;
  }
};

export const loadNotepadNotes = (
  storage: NoteStorage,
  key: string,
  fallback: NotepadNote[],
): NotepadLoadResult => {
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return { notes: [...fallback], canPersist: false, recovered: false, error: 'Notes storage could not be read.' };
  }
  if (raw === null) return { notes: [...fallback], canPersist: true, recovered: false };

  let notes = [...fallback];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const seen = new Set<string>();
      notes = parsed.filter((entry): entry is NotepadNote => {
        if (!isNote(entry) || seen.has(entry.id)) return false;
        seen.add(entry.id);
        return true;
      });
      if (notes.length === parsed.length) return { notes, canPersist: true, recovered: false };
    }
  } catch {
    // Preserve malformed JSON before allowing the caller to persist a fallback.
  }

  try {
    backupRawNotes(storage, key, raw);
    return { notes, canPersist: true, recovered: true };
  } catch {
    return {
      notes,
      canPersist: false,
      recovered: true,
      error: 'Damaged notes could not be backed up. Saving is disabled to preserve the original data.',
    };
  }
};

export const restoreNotepadNote = (notes: NotepadNote[], note: NotepadNote): NotepadNote[] =>
  notes.some((current) => current.id === note.id) ? notes : [note, ...notes];
