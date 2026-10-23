import type { NotepadNote } from '../types';
import { noteDisplayTitle, noteDoc, pageText } from './noteDoc';

export interface NotepadTaskCandidate {
  id: string;
  title: string;
  sourceKey: string;
  sourceText: string;
  /** Snapshot guard for local conversion; never persisted on the created task. */
  sourceContentHash: string;
  noteId: string;
  noteTitle: string;
  page: number;
}
export interface NotepadTaskResult { id: string; status: 'created' | 'existing' | 'error'; taskId?: string; error?: string }
export interface NotepadTaskConfig { phase: string; plannedDate?: string }
export function noteSourceHash(value: string): string {
  let a = 2166136261, b = 2246822507;
  for (let index = 0; index < value.length; index++) { const code = value.charCodeAt(index); a = Math.imul(a ^ code, 16777619); b = Math.imul(b ^ code, 3266489909); }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}
const lineTitle = (line: string) => line.replace(/^\s*(?:[-*+•]\s*(?:\[[ xX]\]\s*)?|\d+[.)]\s+)/u, '').trim();
const normalize = (title: string) => title.replace(/\s+/g, ' ').toLocaleLowerCase('uk-UA');

export function noteTaskCandidates(note: NotepadNote, scope: 'selection' | 'page' | 'note', page: number, selection: string, selectionStart?: number): NotepadTaskCandidate[] {
  const pages = noteDoc(note).pages;
  const sources = scope === 'note' ? pages.map((segments, index) => ({ page: index, text: pageText(segments) }))
    : [{ page, text: scope === 'selection' ? selection : pageText(pages[page] ?? []) }];
  return sources.flatMap(source => {
    const full = pageText(pages[source.page] ?? []), counts = new Map<string, number>();
    let fullOffset = 0;
    const fullLines = full.split('\n').map(line => {
      const normalized = normalize(lineTitle(line)), occurrence = counts.get(normalized) ?? 0;
      counts.set(normalized, occurrence + 1);
      const item = { start: fullOffset, end: fullOffset + line.length, normalized, occurrence }; fullOffset += line.length + 1; return item;
    });
    let offset = scope === 'selection' ? selectionStart ?? Math.max(0, full.indexOf(selection)) : 0;
    return source.text.split('\n').flatMap(line => {
    const lineStart = offset; offset += line.length + 1;
    const title = lineTitle(line);
    if (!title) return [];
    const normalized = normalize(title), origin = fullLines.find(item => item.start <= lineStart && item.end >= lineStart);
    const occurrence = origin?.normalized === normalized ? origin.occurrence : lineStart;
    return [{ id: `note-task-${crypto.randomUUID()}`, title, sourceKey: `${note.id}:${source.page}:${noteSourceHash(normalized)}:${occurrence}`, sourceText: line.trim(),
      noteId: note.id, noteTitle: noteDisplayTitle(note), page: source.page, sourceContentHash: noteSourceHash(note.content) }];
    });
  });
}
