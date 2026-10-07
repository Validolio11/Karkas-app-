export const QUICK_ADD_DRAFT_KEY = 'karkas_quick_add_draft_v1';

export interface QuickAddDraft {
  title: string;
  note: string;
  phase: string;
  priority: 1 | 2 | 3;
  steps: number;
  customSteps: string[];
  timerMode?: 'none' | 'stopwatch' | 'countdown';
  countdownMinutes?: number;
  countdownInput?: string;
}

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function hasQuickAddDraftContent(draft: Pick<QuickAddDraft, 'title' | 'note' | 'customSteps'> & Partial<QuickAddDraft>) {
  return !!(draft.title.trim() || draft.note.trim() || draft.customSteps.some(step => step.trim()) || (draft.steps ?? 0) > 0 || (draft.timerMode && draft.timerMode !== 'none'));
}

export function buildQuickAddSteps(count: number, names: string[], lang: 'uk' | 'en', idPrefix = 's') {
  return Array.from({ length: Math.max(0, Math.min(12, Math.floor(count))) }, (_, index) => ({
    id: `${idPrefix}-${index}`, title: names[index]?.trim() || `${lang === 'uk' ? 'Крок' : 'Step'} ${index + 1}`, done: false,
  }));
}

// Keep manual names, including temporarily hidden rows, when adding AI suggestions.
export function mergeQuickAddSuggestions(names: string[], suggestions: string[]) {
  const merged = [...names];
  const seen = new Set(names.map(name => name.trim().toLocaleLowerCase()).filter(Boolean));
  for (const suggestion of suggestions) {
    const title = suggestion.trim();
    if (!title || seen.has(title.toLocaleLowerCase())) continue;
    const emptyIndex = merged.findIndex(name => !name.trim());
    if (emptyIndex >= 0) merged[emptyIndex] = title;
    else if (merged.length < 12) merged.push(title);
    else break;
    seen.add(title.toLocaleLowerCase());
  }
  return merged;
}

export function readQuickAddDraft(storage: DraftStorage): QuickAddDraft | null {
  try {
    const raw = storage.getItem(QUICK_ADD_DRAFT_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const input = value as Record<string, unknown>;
    const draft: QuickAddDraft = {
      title: typeof input.title === 'string' ? input.title : '',
      note: typeof input.note === 'string' ? input.note : '',
      phase: typeof input.phase === 'string' && input.phase !== 'ALL' && input.phase !== 'DASHBOARD' ? input.phase : '',
      priority: input.priority === 1 || input.priority === 3 ? input.priority : 2,
      steps: typeof input.steps === 'number' && Number.isSafeInteger(input.steps) && input.steps >= 0 ? Math.min(input.steps, 12) : 0,
      customSteps: Array.isArray(input.customSteps) ? input.customSteps.filter((step): step is string => typeof step === 'string') : [],
      ...(input.timerMode !== undefined ? { timerMode: input.timerMode === 'stopwatch' || input.timerMode === 'countdown' ? input.timerMode : 'none' as const } : {}),
      ...(input.countdownMinutes !== undefined ? { countdownMinutes: typeof input.countdownMinutes === 'number' && Number.isFinite(input.countdownMinutes) ? Math.max(1, Math.min(1440, Math.round(input.countdownMinutes))) : 25 } : {}),
      ...(typeof input.countdownInput === 'string' ? { countdownInput: input.countdownInput } : {}),
    };
    return hasQuickAddDraftContent(draft) ? draft : null;
  } catch {
    return null;
  }
}

export function saveQuickAddDraft(storage: DraftStorage, draft: QuickAddDraft): boolean {
  try {
    if (hasQuickAddDraftContent(draft)) {
      storage.setItem(QUICK_ADD_DRAFT_KEY, JSON.stringify(draft));
    } else if (storage.getItem(QUICK_ADD_DRAFT_KEY) !== null) {
      storage.removeItem(QUICK_ADD_DRAFT_KEY);
    }
    return true;
  } catch {
    return false;
  }
}
