/** Keeps cumulative recognition separate from the text the user can edit. */
export function createVoiceDraft(base: string) {
  let current = base;
  let spoken = '';
  let edited = false;
  const append = (addition: string) => {
    if (addition) current += `${current && !/\s$/.test(current) && !/^\s/.test(addition) ? ' ' : ''}${addition}`;
  };
  return {
    edit(value: string) { current = value; edited = true; },
    receive(value: string): { text: string; needsReview: boolean } {
      if (!value.trim() || value === spoken) return { text: current, needsReview: false };
      if (!edited) {
        current = base;
        append(value);
        spoken = value;
        return { text: current, needsReview: false };
      }
      // A late rewrite/fallback must never put deleted words back into the draft.
      const extendsPrevious = value.startsWith(spoken);
      let addition = extendsPrevious ? value.slice(spoken.length) : '';
      // Recognition may finish an interim word after the user deleted it.
      // Never reinsert that word's trailing fragment as a new word.
      const partialContinuation = addition && /\S$/.test(spoken) && /^\S/.test(addition);
      if (partialContinuation) addition = addition.replace(/^\S*/, '');
      if (extendsPrevious) append(addition);
      spoken = value;
      return { text: current, needsReview: !extendsPrevious || Boolean(partialContinuation) };
    },
  };
}
