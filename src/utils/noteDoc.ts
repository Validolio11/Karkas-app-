import type { NoteDoc, NoteSeg, NoteSegStyle, NotepadNote } from '../types';

/** Pages are kept in the plain-text content too, split by a form feed on its own line. */
export const PAGE_BREAK = '\n\f\n';
const NUMBERED = /^(\d+)\.\s+/;

const sameStyle = (a?: NoteSegStyle, b?: NoteSegStyle) => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});

/** Drops empty text and merges neighbouring text with the same style. */
export function tidySegs(segs: readonly NoteSeg[]): NoteSeg[] {
  const out: NoteSeg[] = [];
  for (const seg of segs) {
    if (seg.t === 'text' && !seg.v) continue;
    const last = out[out.length - 1];
    if (seg.t === 'text' && last?.t === 'text' && sameStyle(last.s, seg.s)) out[out.length - 1] = { ...last, v: last.v + seg.v };
    else out.push(seg.s && Object.keys(seg.s).length ? { t: seg.t, v: seg.v, s: { ...seg.s } } : { t: seg.t, v: seg.v });
  }
  return out;
}

/** Numbers continue while consecutive paragraphs start with a marker. */
export function numberLabels(segs: readonly NoteSeg[]): Map<number, string> {
  const labels = new Map<number, string>();
  let number = 0, previous = false, current = false;
  segs.forEach((seg, index) => {
    if (seg.t === 'num') { number = previous ? number + 1 : 1; labels.set(index, number + '.'); current = true; }
    if (seg.t === 'br') { previous = current; current = false; }
  });
  return labels;
}

export function pageText(segs: readonly NoteSeg[]): string {
  const labels = numberLabels(segs);
  return segs.map((seg, index) => seg.t === 'br' ? '\n' : seg.t === 'num' ? labels.get(index) + ' ' : seg.v).join('');
}

export const docText = (doc: NoteDoc) => doc.pages.map(pageText).join(PAGE_BREAK);

export function pageFromText(text: string): NoteSeg[] {
  const segs: NoteSeg[] = [];
  text.split('\n').forEach((line, index) => {
    if (index) segs.push({ t: 'br', v: '' });
    const numbered = NUMBERED.exec(line);
    if (numbered) { segs.push({ t: 'num', v: '' }); line = line.slice(numbered[0].length); }
    if (line) segs.push({ t: 'text', v: line });
  });
  return segs;
}

export const docFromContent = (content: string): NoteDoc => ({ pages: (content ? content.split(PAGE_BREAK) : ['']).map(pageFromText) });

/** The rich document is trusted only while it still matches the plain text; other editors (the AI) change the text. */
export const noteDoc = (note: Pick<NotepadNote, 'content' | 'doc'>): NoteDoc =>
  note.doc && note.doc.pages.length && docText(note.doc) === note.content ? note.doc : docFromContent(note.content);

const isStyle = (value: unknown): value is NoteSegStyle => {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const style = value as Record<string, unknown>;
  return (style.font === undefined || typeof style.font === 'string' && style.font.length <= 120)
    && (style.size === undefined || typeof style.size === 'number' && style.size >= 8 && style.size <= 96)
    && (style.weight === undefined || typeof style.weight === 'number' && style.weight >= 100 && style.weight <= 900);
};

export const isNoteDoc = (value: unknown): value is NoteDoc => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const pages = (value as Record<string, unknown>).pages;
  return Array.isArray(pages) && pages.length > 0 && pages.length <= 200 && pages.every(page => Array.isArray(page) && page.every(seg =>
    !!seg && typeof seg === 'object' && ['text', 'br', 'num', 'chip'].includes((seg as NoteSeg).t)
    && typeof (seg as NoteSeg).v === 'string' && isStyle((seg as NoteSeg).s)));
};
