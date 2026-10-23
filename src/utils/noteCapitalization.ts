const ABBREVIATIONS = new Set(['ім', 'вул', 'просп', 'обл', 'р', 'рр', 'м', 'див', 'напр', 'т.д', 'т.п', 'e.g', 'i.e', 'mr', 'mrs', 'ms', 'dr', 'prof', 'etc']);

const startsSentence = (prefix: string): boolean => {
  const line = prefix.slice(prefix.lastIndexOf('\n') + 1);
  if (/^\s*(?:(?:[-+*•‣–—]|\d+[.)])\s+)?[\s"'“”‘’«»()\[\]{}]*$/u.test(line)) return true;
  const boundary = /([.!?…])([\s"'“”‘’«»()\[\]{}]*)$/u.exec(prefix);
  if (!boundary || !/\s/u.test(boundary[2])) return false;
  if (boundary[1] === '.') {
    const stem = prefix.slice(0, boundary.index);
    const word = stem.match(/[\p{L}.]+$/u)?.[0].toLocaleLowerCase('uk-UA');
    if (word && ABBREVIATIONS.has(word) || /(?:^|\s)т\.\s*[дп]$/iu.test(stem)) return false;
  }
  return true;
};

const technicalText = (text: string, at: number): boolean => {
  const prefix = text.slice(0, at);
  if ((prefix.replace(/\\`/g, '').match(/`/g)?.length ?? 0) % 2) return true;
  const token = (prefix.match(/\S*$/u)?.[0] ?? '') + (text.slice(at).match(/^\S*/u)?.[0] ?? '');
  return /(?:[a-z][a-z\d+.-]*:\/\/|www\.|[^\s@]+@)/iu.test(token);
};

/** Only the newly typed range can change; existing text and pasted input stay intact. */
export function capitalizeNoteTyping(text: string, start: number, end: number, selectionStart: number, selectionEnd: number) {
  start = Math.max(0, Math.min(text.length, start));
  end = Math.max(start, Math.min(text.length, end));
  let next = text.slice(0, start), at = start;
  const expansions: { end: number; length: number }[] = [];
  for (const character of text.slice(start, end)) {
    const replacement = /\p{Ll}/u.test(character) && startsSentence(next) && !technicalText(text, at)
      ? character.toLocaleUpperCase('uk-UA') : character;
    next += replacement;
    at += character.length;
    if (replacement.length !== character.length) expansions.push({ end: at, length: replacement.length - character.length });
  }
  next += text.slice(end);
  const move = (offset: number) => Math.max(0, Math.min(next.length,
    offset + expansions.reduce((sum, change) => sum + (change.end <= offset ? change.length : 0), 0)));
  return { text: next, selectionStart: move(selectionStart), selectionEnd: move(selectionEnd) };
}
