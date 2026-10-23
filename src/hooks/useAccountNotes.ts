import { useEffect, useRef, useState } from 'react';
import type { NotepadNote } from '../types';
import { canonical } from '../utils/canonical';
import { noteDoc } from '../utils/noteDoc';
import { appendNotepadOperation, loadNotepadJournal, notesOperationPrefix, ownedNotesKey } from '../utils/notepadStorage';

const load = (owner: string | null, fallback: NotepadNote[]) => loadNotepadJournal(localStorage, owner, fallback);

export function useAccountNotes(initialOwner: string | null, fallback: NotepadNote[]) {
  const [state, setState] = useState(() => ({ owner: initialOwner, epoch: 0, ...load(initialOwner, fallback) }));
  const current = useRef(state);
  const [storageError, setStorageError] = useState(!state.canPersist);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!state.notes.some(note => note.deletedAt !== undefined && (note.undoUntil ?? 0) > Date.now())) return;
    const timer = window.setInterval(() => {
      const at = Date.now(); setNow(at);
      if (!current.current.notes.some(note => note.deletedAt !== undefined && (note.undoUntil ?? 0) > at)) window.clearInterval(timer);
    }, 250);
    return () => window.clearInterval(timer);
  }, [state.notes]);
  const switchOwner = (owner: string | null) => {
    if (current.current.owner === owner) return;
    const next = { owner, epoch: current.current.epoch + 1, ...load(owner, fallback) };
    current.current = next;
    setState(next);
    setStorageError(!next.canPersist);
  };
  useEffect(() => {
    const refresh = (event: StorageEvent) => {
      const owner = current.current.owner;
      if (event.storageArea !== localStorage || (event.key !== null && event.key !== ownedNotesKey(owner)
        && !event.key.startsWith(notesOperationPrefix(owner)))) return;
      const next = { owner, epoch: current.current.epoch, ...load(owner, fallback) };
      current.current = next;
      setState(next);
      setStorageError(!next.canPersist);
    };
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, [fallback]);
  const commit = (id: string, before: NotepadNote | null, after: NotepadNote | null): boolean => {
    // A callback from an unmounted previous account cannot write the current account.
    if (current.current.owner !== state.owner || current.current.epoch !== state.epoch) return false;
    try {
      const latest = load(state.owner, fallback);
      if (!latest.canPersist) throw new Error('Notes cannot be safely saved');
      const actual = latest.notes.find(note => note.id === id) ?? null;
      if (canonical(actual) !== canonical(before)) {
        const next = { ...current.current, ...latest };
        current.current = next; setState(next);
        setStorageError(true);
        return false;
      }
      appendNotepadOperation(localStorage, state.owner, {
        id: crypto.randomUUID(), clock: latest.clock + 1, noteId: id, before, after,
      });
      const next = { ...current.current, ...load(state.owner, fallback) };
      current.current = next;
      setState(next);
      setStorageError(!next.canPersist);
      return next.canPersist;
    } catch {
      setStorageError(true);
      return false;
    }
  };
  const getNotes = (): NotepadNote[] | null => {
    if (current.current.owner !== state.owner || current.current.epoch !== state.epoch) return null;
    const latest = load(state.owner, fallback);
    if (!latest.canPersist) { setStorageError(true); return null; }
    const next = { ...current.current, ...latest };
    current.current = next;
    if (canonical(next.notes) !== canonical(state.notes)) setState(next);
    return latest.notes.filter(note => note.deletedAt === undefined);
  };
  const getDeletedNotes = (): NotepadNote[] | null => {
    if (current.current.owner !== state.owner || current.current.epoch !== state.epoch) return null;
    const latest = load(state.owner, fallback);
    return latest.canPersist ? latest.notes.filter(note => note.deletedAt !== undefined) : null;
  };
  const replaceNotes = (before: NotepadNote[], after: NotepadNote[], expectedRestores: Record<string, NotepadNote> = {}): boolean => {
    if (current.current.owner !== state.owner || current.current.epoch !== state.epoch) return false;
    try {
      const latest = load(state.owner, fallback);
      if (!latest.canPersist) throw new Error('Notes cannot be safely saved');
      const previous = new Map(before.map(note => [note.id, note]));
      const nextNotes = new Map(after.map(note => [note.id, note]));
      const changes = [...new Set([...previous.keys(), ...nextNotes.keys()])].flatMap(noteId => {
        const oldNote = previous.get(noteId) ?? (nextNotes.has(noteId) ? expectedRestores[noteId] : undefined) ?? null;
        const proposed = nextNotes.get(noteId) ?? null;
        const at = Date.now();
        const newNote = !proposed && oldNote ? { ...oldNote, deletedAt: at, undoUntil: at + 8000, updatedAt: at } : proposed;
        return canonical(oldNote) === canonical(newNote) ? [] : [{ noteId, before: oldNote, after: newNote }];
      });
      if (changes.some(change => canonical(latest.notes.find(note => note.id === change.noteId) ?? null) !== canonical(change.before))) {
        const next = { ...current.current, ...latest };
        current.current = next; setState(next); setStorageError(true);
        return false;
      }
      if (changes.length) appendNotepadOperation(localStorage, state.owner, {
        id: crypto.randomUUID(), clock: latest.clock + 1, changes,
      });
      const next = { ...current.current, ...load(state.owner, fallback) };
      current.current = next; setState(next); setStorageError(!next.canPersist);
      return next.canPersist;
    } catch {
      setStorageError(true);
      return false;
    }
  };
  return {
    getNotes, getDeletedNotes, replaceNotes,
    refreshNotes: (owner: string | null) => {
      if (current.current.owner !== owner) return;
      const next = { ...current.current, ...load(owner, fallback) };
      current.current = next; setState(next); setStorageError(!next.canPersist);
    },
    notes: state.notes.filter(note => note.deletedAt === undefined),
    deletedNotes: state.notes.filter(note => note.deletedAt !== undefined),
    archivedNotes: state.notes.filter(note => note.deletedAt !== undefined && (note.undoUntil ?? 0) <= now),
    notesOwner: state.owner, storageError, switchOwner,
    addNote: (note: Omit<NotepadNote, 'id' | 'createdAt'> & { id?: string }) => {
      const value = { ...note, id: note.id ?? `note-${crypto.randomUUID()}`, createdAt: Date.now() };
      return commit(value.id, null, value);
    },
    updateNote: (id: string, updates: Partial<NotepadNote>, expected?: Pick<NotepadNote, 'title' | 'content' | 'doc'>) => {
      const before = current.current.notes.find(note => note.id === id);
      if (expected && (!before || before.title !== expected.title || before.content !== expected.content || canonical(noteDoc(before)) !== canonical(noteDoc(expected)))) { setStorageError(true); return false; }
      return !!before && before.deletedAt === undefined && commit(id, before, { ...before, ...updates, id });
    },
    deleteNote: (id: string) => {
      const before = current.current.notes.find(note => note.id === id);
      if (!before || before.deletedAt !== undefined) return false;
      const deletedAt = Date.now();
      return commit(id, before, { ...before, deletedAt, undoUntil: deletedAt + 8000, updatedAt: deletedAt });
    },
    restoreNote: (noteOrId: NotepadNote | string) => {
      if (current.current.owner !== state.owner || current.current.epoch !== state.epoch) return false;
      const id = typeof noteOrId === 'string' ? noteOrId : noteOrId.id;
      const latest = load(state.owner, fallback);
      const before = latest.notes.find(note => note.id === id);
      if (latest.canPersist && before && before.deletedAt === undefined) {
        const next = { ...current.current, ...latest };
        current.current = next; setState(next); setStorageError(false);
        return true;
      }
      // A stale Undo must not resurrect a record that was explicitly purged.
      const retained = before ?? null;
      if (!retained || !latest.canPersist) { setStorageError(true); return false; }
      const { deletedAt: _deletedAt, undoUntil: _undoUntil, ...restored } = retained;
      return commit(id, before ?? null, { ...restored, updatedAt: Date.now() });
    },
    purgeNote: (id: string, expectedDeletedAt?: number) => {
      const before = current.current.notes.find(note => note.id === id);
      return !!before && before.deletedAt !== undefined && (expectedDeletedAt === undefined || before.deletedAt === expectedDeletedAt) && commit(id, before, null);
    },
  };
}
