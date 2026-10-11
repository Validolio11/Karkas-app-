import { useRef, useState } from 'react';
import type { NotepadNote } from '../types';
import { loadOwnedNotepadNotes, ownedNotesKey, restoreNotepadNote } from '../utils/notepadStorage';

const load = (owner: string | null, fallback: NotepadNote[]) => loadOwnedNotepadNotes(localStorage, owner, fallback);

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
  const commit = (notes: NotepadNote[]): boolean => {
    // A callback from an unmounted previous account cannot write the current account.
    if (current.current.owner !== state.owner || current.current.epoch !== state.epoch || !current.current.canPersist) return false;
    try {
      const serialized = JSON.stringify(notes);
      localStorage.setItem(ownedNotesKey(state.owner), serialized);
      if (localStorage.getItem(ownedNotesKey(state.owner)) !== serialized) throw new Error('Notes could not be saved');
    } catch {
      setStorageError(true);
      return false;
    }
    const next = { ...current.current, notes };
    current.current = next;
    setState(next);
    setStorageError(false);
    return true;
  };
  return {
    notes: state.notes, notesOwner: state.owner, storageError, switchOwner,
    addNote: (note: Omit<NotepadNote, 'id' | 'createdAt'>) => commit([
      { ...note, id: `note-${crypto.randomUUID()}`, createdAt: Date.now() }, ...current.current.notes,
    ]),
    updateNote: (id: string, updates: Partial<NotepadNote>) => current.current.notes.some(note => note.id === id)
      && commit(current.current.notes.map(note => note.id === id ? { ...note, ...updates, id: note.id } : note)),
    deleteNote: (id: string) => commit(current.current.notes.filter(note => note.id !== id)),
    restoreNote: (note: NotepadNote) => commit(restoreNotepadNote(current.current.notes, note)),
  };
}
