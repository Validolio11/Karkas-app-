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
export const noteDisplayTitle = (note: Pick<NotepadNote, 'title' | 'content'>, fallback = 'Без назви') =>
  note.title.trim() || note.content.split(/[\n\f]/).find(line => line.trim())?.trim().slice(0, 120) || fallback;

/** Exact range replacement/formatting, including runs, repeated words and paragraphs. */
export function transformNoteRange(segs: readonly NoteSeg[], start: number, end: number,
  transform: (selected: NoteSeg[]) => NoteSeg[]): NoteSeg[] {
  const labels = numberLabels(segs);
  const before: NoteSeg[] = [], selected: NoteSeg[] = [], after: NoteSeg[] = [];
  let offset = 0;
  const push = (target: NoteSeg[], seg: NoteSeg, left: number, right: number, value: string) => {
    if (left >= right) return;
    target.push(left === 0 && right === value.length ? seg : { t: 'text', v: value.slice(left, right), s: seg.s });
  };
  segs.forEach((seg, index) => {
    const value = seg.t === 'br' ? '\n' : seg.t === 'num' ? (labels.get(index) ?? '') + ' ' : seg.v;
    const a = Math.max(0, Math.min(value.length, start - offset)), b = Math.max(a, Math.min(value.length, end - offset));
    push(before, seg, 0, a, value); push(selected, seg, a, b, value); push(after, seg, b, value.length, value);
    offset += value.length;
  });
  return tidySegs([...before, ...transform(selected), ...after]);
}

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

/** Apply a plain-text edit without discarding formatting outside the changed range. */
export function editPageText(segs: readonly NoteSeg[], text: string): NoteSeg[] {
  const before = pageText(segs);
  if (before === text) return [...segs];
  let start = 0;
  while (start < before.length && start < text.length && before[start] === text[start]) start++;
  if (start && /[\uDC00-\uDFFF]/.test(before[start] ?? '')) start--;
  let end = before.length, nextEnd = text.length;
  while (end > start && nextEnd > start && before[end - 1] === text[nextEnd - 1]) { end--; nextEnd--; }
  if (/[\uDC00-\uDFFF]/.test(before[end] ?? '')) { end++; nextEnd++; }
  const labels = numberLabels(segs);
  const originalNumbers = new Map(segs.flatMap((seg, index) => seg.t === 'num' ? [[seg, labels.get(index) + ' '] as const] : []));
  const slice = (from: number, to: number): NoteSeg[] => {
    let offset = 0;
    return segs.flatMap((seg, index) => {
      const value = seg.t === 'br' ? '\n' : seg.t === 'num' ? labels.get(index) + ' ' : seg.v;
      const left = Math.max(from - offset, 0), right = Math.min(to - offset, value.length);
      offset += value.length;
      if (left >= right) return [];
      return left === 0 && right === value.length ? [seg] : [{ t: 'text' as const, v: value.slice(left, right), s: seg.s }];
    });
  };
  const prefix = slice(0, start), suffix = slice(end, before.length);
  const inheritedStyle = [...prefix].reverse().find(seg => seg.t === 'text')?.s
    ?? suffix.find(seg => seg.t === 'text')?.s;
  const inserted: NoteSeg[] = [];
  text.slice(start, nextEnd).split('\n').forEach((line, index) => {
    if (index) inserted.push({ t: 'br', v: '' });
    if (line) inserted.push({ t: 'text', v: line, s: inheritedStyle });
  });
  const next = tidySegs([...prefix, ...inserted, ...suffix]);
  // Removing a list item must keep the literal text the user is editing, even if
  // the remaining automatic markers would otherwise renumber themselves.
  return pageText(next) === text ? next : tidySegs([...prefix, ...inserted, ...suffix].map<NoteSeg>(seg =>
    seg.t === 'num' ? { t: 'text', v: originalNumbers.get(seg) ?? '', s: seg.s } : seg));
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
