/** AI-proposed tab sets: prompt input bounds and validation of the model's answer. */

/** Colours that read well on the dark UI; the model must choose from these. */
export const TAB_SUGGESTION_PALETTE = ['#f43f5e', '#f97316', '#fbbf24', '#a3e635', '#34d399', '#2dd4bf', '#38bdf8', '#818cf8', '#a855f7', '#ec4899', '#a3a3a3'];
/** The prompt asks for 3-7 tabs; a smaller but valid answer is still worth showing. */
export const MIN_SUGGESTED_TABS = 3;
export const MAX_SUGGESTED_TABS = 7;
const MIN_ACCEPTED_TABS = 2;
const MAX_TAB_NAME = 24;

export interface SuggestedTab {
  name: string;
  color: string;
  /** Current tab ids whose tasks move into this tab. Each current id appears at most once. */
  fromTabIds: string[];
}

export interface TabSuggestion {
  tabs: SuggestedTab[];
  explanation: string;
}

export interface TabSuggestionInput {
  activity: string;
  goals: string[];
  facts: string[];
  taskTitles: string[];
  currentTabs: { id: string; name: string; taskCount: number }[];
}

const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max: number) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
const texts = (value: unknown, count: number, max: number) => Array.isArray(value)
  ? value.map(item => text(item, max)).filter(Boolean).slice(0, count) : [];

/** Bounded, typed request fields; anything malformed is dropped rather than echoed to the model. */
export function readTabSuggestionInput(body: Record<string, any>): TabSuggestionInput {
  const currentTabs = Array.isArray(body.currentTabs)
    ? body.currentTabs.filter(record).map(tab => ({
      id: text(tab.id, 80),
      name: text(tab.name, 40),
      taskCount: Number.isInteger(tab.taskCount) && tab.taskCount >= 0 ? tab.taskCount : 0,
    })).filter(tab => tab.id && tab.name).slice(0, 20)
    : [];
  return {
    activity: text(body.activity, 300),
    goals: texts(body.goals, 10, 160),
    facts: texts(body.facts, 12, 200),
    taskTitles: texts(body.taskTitles, 25, 120),
    currentTabs,
  };
}

export const hasTabSuggestionContext = (input: TabSuggestionInput) =>
  !!input.activity || input.goals.length > 0 || input.facts.length > 0 || input.taskTitles.length > 0;

/**
 * Keeps 2-7 distinct, short tab names, forces palette colours (distinct where possible)
 * and maps every known current tab id to at most one suggested tab. Returns null when the
 * answer cannot form a usable set.
 */
export function normalizeTabSuggestion(raw: unknown, currentTabIds: string[]): TabSuggestion | null {
  if (!record(raw) || !Array.isArray(raw.tabs)) return null;
  const known = new Set(currentTabIds);
  const claimed = new Set<string>();
  const names = new Set<string>();
  const usedColors = new Set<string>();
  const tabs: SuggestedTab[] = [];

  for (const item of raw.tabs) {
    if (tabs.length >= MAX_SUGGESTED_TABS) break;
    if (!record(item)) continue;
    const name = text(item.name, MAX_TAB_NAME).replace(/^[\d.)\-\s]+/, '').trim();
    if (!name || names.has(name.toLocaleLowerCase())) continue;
    names.add(name.toLocaleLowerCase());

    let color = typeof item.color === 'string' ? item.color.trim().toLowerCase() : '';
    if (!TAB_SUGGESTION_PALETTE.includes(color) || usedColors.has(color)) {
      color = TAB_SUGGESTION_PALETTE.find(candidate => !usedColors.has(candidate)) || TAB_SUGGESTION_PALETTE[tabs.length % TAB_SUGGESTION_PALETTE.length];
    }
    usedColors.add(color);

    const fromTabIds = (Array.isArray(item.fromTabIds) ? item.fromTabIds : [])
      .filter((id: unknown): id is string => typeof id === 'string' && known.has(id) && !claimed.has(id));
    fromTabIds.forEach((id: string) => claimed.add(id));
    tabs.push({ name, color, fromTabIds });
  }

  if (tabs.length < MIN_ACCEPTED_TABS) return null;
  return { tabs, explanation: text(raw.explanation, 240) };
}
