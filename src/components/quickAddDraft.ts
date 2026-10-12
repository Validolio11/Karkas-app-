import { isSystemView } from '../utils/systemViews';
import { isTaskDate } from '../utils/taskDates';
export const QUICK_ADD_DRAFT_KEY = 'karkas_quick_add_draft_v1';
const LEGACY_MIGRATION_KEY = 'karkas_quick_add_draft_migration_v2';
export const quickAddDraftKey = (ownerId: string | null = null) =>
  `karkas_quick_add_draft_v2:${encodeURIComponent(ownerId === null ? 'guest' : `account:${ownerId}`)}`;

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
  plannedDate?: string;
  deadlineDate?: string;
  wizardStep?: number;
}

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & Partial<Pick<Storage, 'length' | 'key'>>;

export function hasQuickAddDraftContent(draft: Pick<QuickAddDraft, 'title' | 'note' | 'customSteps'> & Partial<QuickAddDraft>) {
  return !!(draft.title.trim() || draft.note.trim() || draft.customSteps.some(step => step.trim()) || (draft.steps ?? 0) > 0 || (draft.timerMode && draft.timerMode !== 'none') || draft.plannedDate || draft.deadlineDate);
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

function parseQuickAddDraft(raw: string | null): QuickAddDraft | null {
  try {
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const input = value as Record<string, unknown>;
    const draft: QuickAddDraft = {
      title: typeof input.title === 'string' ? input.title : '',
      note: typeof input.note === 'string' ? input.note : '',
      phase: typeof input.phase === 'string' && !isSystemView(input.phase) ? input.phase : '',
      priority: input.priority === 1 || input.priority === 3 ? input.priority : 2,
      steps: typeof input.steps === 'number' && Number.isSafeInteger(input.steps) && input.steps >= 0 ? Math.min(input.steps, 12) : 0,
      customSteps: Array.isArray(input.customSteps) ? input.customSteps.filter((step): step is string => typeof step === 'string') : [],
      ...(input.timerMode !== undefined ? { timerMode: input.timerMode === 'stopwatch' || input.timerMode === 'countdown' ? input.timerMode : 'none' as const } : {}),
      ...(input.countdownMinutes !== undefined ? { countdownMinutes: typeof input.countdownMinutes === 'number' && Number.isFinite(input.countdownMinutes) ? Math.max(1, Math.min(1440, Math.round(input.countdownMinutes))) : 25 } : {}),
      ...(typeof input.countdownInput === 'string' ? { countdownInput: input.countdownInput } : {}),
      ...(isTaskDate(input.plannedDate) ? { plannedDate: input.plannedDate } : {}),
      ...(isTaskDate(input.deadlineDate) ? { deadlineDate: input.deadlineDate } : {}),
      ...(typeof input.wizardStep === 'number' && Number.isInteger(input.wizardStep) && input.wizardStep >= 0 && input.wizardStep <= 5 ? { wizardStep: input.wizardStep } : {}),
    };
    return hasQuickAddDraftContent(draft) ? draft : null;
  } catch {
    return null;
  }
}

/** Old drafts had no account identity. Only a known guest workspace may claim one. */
export function readQuickAddDraft(storage: DraftStorage, ownerId: string | null = null): QuickAddDraft | null {
  try {
    const scoped = storage.getItem(quickAddDraftKey(ownerId));
    const legacy = storage.getItem(QUICK_ADD_DRAFT_KEY);
    if (scoped !== null) {
      // A scoped draft is authoritative, including malformed/empty records; never resurrect an older draft after clearing.
      if (legacy && !storage.getItem(LEGACY_MIGRATION_KEY)) storage.setItem(LEGACY_MIGRATION_KEY, 'quarantined');
      return parseQuickAddDraft(scoped);
    }
    if (!legacy) return null;
    const migration = storage.getItem(LEGACY_MIGRATION_KEY);
    if (migration === 'quarantined' || migration === 'migrated') return null;
    const workspaceOwner = storage.getItem('karkas_workspace_owner');
    let hasAccountWorkspace = false;
    if (typeof storage.length === 'number' && typeof storage.key === 'function') {
      for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index);
        if (key?.startsWith('karkas_workspace:') && key !== 'karkas_workspace:guest') { hasAccountWorkspace = true; break; }
      }
    }
    if (ownerId !== null || workspaceOwner !== null && workspaceOwner !== '' || hasAccountWorkspace) {
      // Preserve ambiguous legacy data on disk, but never show it to another account or a later guest session.
      storage.setItem(LEGACY_MIGRATION_KEY, 'quarantined');
      return null;
    }
    const recovered = parseQuickAddDraft(legacy);
    if (!recovered) return null;
    storage.setItem(quickAddDraftKey(null), JSON.stringify(recovered));
    storage.setItem(LEGACY_MIGRATION_KEY, 'migrated');
    storage.removeItem(QUICK_ADD_DRAFT_KEY);
    return recovered;
  } catch { return null; }
}

export function saveQuickAddDraft(storage: DraftStorage, draft: QuickAddDraft, ownerId: string | null = null): boolean {
  try {
    readQuickAddDraft(storage, ownerId);
    const key = quickAddDraftKey(ownerId);
    if (hasQuickAddDraftContent(draft)) {
      storage.setItem(key, JSON.stringify(draft));
    } else if (storage.getItem(key) !== null) {
      storage.removeItem(key);
    }
    return true;
  } catch {
    return false;
  }
}
