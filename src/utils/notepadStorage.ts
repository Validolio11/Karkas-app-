import type { NotepadNote } from '../types';
import { canonical } from './canonical';
import { isNoteDoc } from './noteDoc';

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
    && (note.pinned === undefined || typeof note.pinned === 'boolean')
    && (note.kind === undefined || note.kind === 'lesson' || note.kind === 'idea')
    && (note.deletedAt === undefined || isTimestamp(note.deletedAt))
    && (note.undoUntil === undefined || isTimestamp(note.undoUntil) && isTimestamp(note.deletedAt) && note.undoUntil >= note.deletedAt)
    && (note.deletedPages === undefined || Array.isArray(note.deletedPages) && note.deletedPages.every(page =>
      !!page && typeof page === 'object' && typeof page.id === 'string' && page.id.trim()
      && Number.isSafeInteger(page.index) && page.index >= 0 && isTimestamp(page.deletedAt)
      && isTimestamp(page.undoUntil) && page.undoUntil >= page.deletedAt && isNoteDoc({ pages: [page.segments] })))
    && (note.doc === undefined || isNoteDoc(note.doc));
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

// Each tab appends its own atomic record instead of replacing a shared snapshot.
export type NoteChange = { noteId: string; before: NotepadNote | null; after: NotepadNote | null };
export type NoteOperation = { id: string; clock: number } & NoteChange;
export type NoteBatchOperation = { id: string; clock: number; changes: NoteChange[] };
export const isNotepadBatchOperation = (value: unknown): value is NoteBatchOperation => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const operation = value as NoteBatchOperation;
  return typeof operation.id === 'string' && !!operation.id && Number.isSafeInteger(operation.clock) && operation.clock >= 0
    && Array.isArray(operation.changes) && operation.changes.length > 0 && operation.changes.every(isNoteChange)
    && new Set(operation.changes.map(change => change.noteId)).size === operation.changes.length;
};
const isNoteChange = (change: NoteChange): boolean => !!change && typeof change.noteId === 'string' && !!change.noteId
  && (change.before === null || isNote(change.before) && change.before.id === change.noteId)
  && (change.after === null || isNote(change.after) && change.after.id === change.noteId);
export const notesOperationPrefix = (owner: string | null) => `${ownedNotesKey(owner)}:operation:`;
type JournalStorage = NoteStorage & Pick<Storage, 'key' | 'length'>;
const sameNote = (a: NotepadNote | null | undefined, b: NotepadNote | null | undefined) => canonical(a ?? null) === canonical(b ?? null);

export function loadNotepadJournal(storage: JournalStorage, owner: string | null, fallback: NotepadNote[]): NotepadLoadResult & { clock: number } {
  const base = loadOwnedNotepadNotes(storage, owner, fallback);
  const operations: (NoteOperation | NoteBatchOperation)[] = [];
  try {
    if (base.canPersist && storage.getItem(ownedNotesKey(owner)) === null) {
      const raw = JSON.stringify(base.notes);
      storage.setItem(ownedNotesKey(owner), raw);
      if (storage.getItem(ownedNotesKey(owner)) !== raw) throw new Error('Notes baseline could not be saved');
    }
    const prefix = notesOperationPrefix(owner);
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const raw = storage.getItem(key);
      if (raw === null) continue;
      const op = JSON.parse(raw) as NoteOperation | NoteBatchOperation;
      if (!op || typeof op.id !== 'string' || key !== prefix + op.id || !Number.isSafeInteger(op.clock)
        || op.clock < 0 || ('changes' in op
          ? !Array.isArray(op.changes) || !op.changes.length || !op.changes.every(isNoteChange)
            || new Set(op.changes.map(change => change.noteId)).size !== op.changes.length
          : !isNoteChange(op))) throw new Error('Invalid note operation');
      operations.push(op);
    }
    operations.sort((a, b) => a.clock - b.clock || a.id.localeCompare(b.id));
    const notes = new Map(base.notes.map(note => [note.id, note]));
    for (const operation of operations) {
      for (const op of 'changes' in operation ? operation.changes : [operation]) {
        const current = notes.get(op.noteId);
        if (sameNote(current, op.before)) {
          if (op.after) notes.set(op.noteId, op.after);
          else notes.delete(op.noteId);
        } else if (op.after && !sameNote(current, op.after)) {
          // Preserve both concurrent edits. Stale deletions leave the newer note intact.
          const conflictId = `${op.noteId}:conflict:${operation.id}`;
          notes.set(conflictId, { ...op.after, id: conflictId });
        }
      }
    }
    return { ...base, notes: [...notes.values()].sort((a, b) => b.createdAt - a.createdAt), clock: operations.length ? operations[operations.length - 1].clock : 0 };
  } catch {
    return { ...base, canPersist: false, error: 'Notes journal could not be read. Saving is disabled to preserve the data.', clock: 0 };
  }
}

export function appendNotepadOperation(storage: JournalStorage, owner: string | null, operation: NoteOperation | NoteBatchOperation): void {
  const key = notesOperationPrefix(owner) + operation.id;
  const raw = JSON.stringify(operation);
  storage.setItem(key, raw);
  if (storage.getItem(key) !== raw) throw new Error('Note operation could not be saved');
}

/** Capture the exact notes half of a paired task/category/notes commit before writing either half. */
export function prepareNotepadReplacement(storage: JournalStorage, owner: string | null, before: NotepadNote[], after: NotepadNote[],
  expectedRestores: Record<string, NotepadNote> = {}): NoteBatchOperation | null {
  const latest = loadNotepadJournal(storage, owner, []);
  if (!latest.canPersist) throw new Error('Notes cannot be safely saved');
  const previous = new Map(before.map(note => [note.id, note])), next = new Map(after.map(note => [note.id, note]));
  const changes = [...new Set([...previous.keys(), ...next.keys()])].flatMap(noteId => {
    const oldNote = previous.get(noteId) ?? (next.has(noteId) ? expectedRestores[noteId] : undefined) ?? null;
    const proposed = next.get(noteId) ?? null;
    const at = Math.max(Date.now(), (oldNote?.updatedAt ?? 0) + 1);
    const newNote = !proposed && oldNote ? { ...oldNote, deletedAt: at, undoUntil: at + 8000, updatedAt: at } : proposed;
    return sameNote(oldNote, newNote) ? [] : [{ noteId, before: oldNote, after: newNote }];
  });
  if (changes.some(change => !sameNote(latest.notes.find(note => note.id === change.noteId), change.before))) throw new Error('Notes changed');
  if (!changes.length) return null;
  const operation = { id: crypto.randomUUID(), clock: latest.clock + 1, changes };
  if (!isNotepadBatchOperation(operation)) throw new Error('Invalid notes replacement');
  return operation;
}

/** Replay a staged batch idempotently; a newer edit remains a conflict, never a replacement. */
export function applyNotepadBatch(storage: JournalStorage, owner: string | null, operation: NoteBatchOperation): boolean {
  try {
    if (!isNotepadBatchOperation(operation)) return false;
    const latest = loadNotepadJournal(storage, owner, []);
    if (!latest.canPersist || operation.changes.some(change => {
      const current = latest.notes.find(note => note.id === change.noteId);
      return !sameNote(current, change.before) && !sameNote(current, change.after);
    })) return false;
    const retained = storage.getItem(notesOperationPrefix(owner) + operation.id);
    if (retained !== null && canonical(JSON.parse(retained)) !== canonical(operation)) return false;
    if (retained === null) appendNotepadOperation(storage, owner, operation);
    const saved = loadNotepadJournal(storage, owner, []);
    return saved.canPersist && operation.changes.every(change => sameNote(saved.notes.find(note => note.id === change.noteId), change.after));
  } catch { return false; }
}
