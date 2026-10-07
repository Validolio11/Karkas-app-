export const QUICK_ADD_DRAFT_KEY = 'karkas_quick_add_draft_v1';

export interface QuickAddDraft {
  title: string;
  note: string;
  phase: string;
  priority: 1 | 2 | 3;
  steps: number;
  customSteps: string[];
}

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function hasQuickAddDraftContent(draft: Pick<QuickAddDraft, 'title' | 'note' | 'customSteps'>) {
  return !!(draft.title.trim() || draft.note.trim() || draft.customSteps.some(step => step.trim()));
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
      steps: typeof input.steps === 'number' && Number.isSafeInteger(input.steps) && input.steps > 0 ? input.steps : 1,
      customSteps: Array.isArray(input.customSteps) ? input.customSteps.filter((step): step is string => typeof step === 'string') : [],
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
