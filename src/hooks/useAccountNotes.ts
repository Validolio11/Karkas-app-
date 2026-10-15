import { useEffect, useRef, useState } from 'react';
import type { NotepadNote } from '../types';
import { canonical } from '../utils/canonical';
import { appendNotepadOperation, loadNotepadJournal, notesOperationPrefix, ownedNotesKey } from '../utils/notepadStorage';

const load = (owner: string | null, fallback: NotepadNote[]) => loadNotepadJournal(localStorage, owner, fallback);

export function useAccountNotes(initialOwner: string | null, fallback: NotepadNote[]) {
  const [state, setState] = useState(() => ({ owner: initialOwner, epoch: 0, ...load(initialOwner, fallback) }));
  const current = useRef(state);
  const [storageError, setStorageError] = useState(!state.canPersist);
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
  return {
    notes: state.notes, notesOwner: state.owner, storageError, switchOwner,
    addNote: (note: Omit<NotepadNote, 'id' | 'createdAt'>) => {
      const value = { ...note, id: `note-${crypto.randomUUID()}`, createdAt: Date.now() };
      return commit(value.id, null, value);
    },
    updateNote: (id: string, updates: Partial<NotepadNote>) => {
      const before = current.current.notes.find(note => note.id === id);
      return !!before && commit(id, before, { ...before, ...updates, id });
    },
    deleteNote: (id: string) => {
      const before = current.current.notes.find(note => note.id === id);
      return !!before && commit(id, before, null);
    },
    restoreNote: (note: NotepadNote) => {
      if (current.current.owner !== state.owner || current.current.epoch !== state.epoch) return false;
      const latest = load(state.owner, fallback);
      if (latest.canPersist && latest.notes.some(currentNote => currentNote.id === note.id)) {
        const next = { ...current.current, ...latest };
        current.current = next; setState(next); setStorageError(false);
        return true;
      }
      return commit(note.id, null, note);
    },
  };
}
