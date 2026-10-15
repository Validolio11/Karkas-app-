import type { PersonalStrategyProfile } from '../types';
import { readAccountStorage, writeAccountStorage } from '../utils/accountStorage';
import { DISCOVERY_MODE_QUESTION_ID } from '../utils/strategyDiscovery';

/**
 * The explicit «Поглибити знайомство» mode of the AI chat. Only this mode sends discovery
 * answers to the interview; ordinary chat never shows interview questions by itself.
 * continueId remembers the button press that opened the mode, so it is not reopened after exit.
 */
export interface DiscoveryModeState { active: boolean; continueId?: string }
type ModeStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const STORAGE_PREFIX = 'karkas_ai_discovery_mode';
/** A press older than this (e.g. the chat was never opened) does not switch the mode on later. */
const ENTRY_WINDOW_MS = 10 * 60_000;

export function readDiscoveryMode(storage: ModeStorage, accountId?: string | null): DiscoveryModeState {
  try {
    const raw: unknown = JSON.parse(readAccountStorage(storage, STORAGE_PREFIX, accountId) || 'null');
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const value = raw as Record<string, unknown>;
      return { active: value.active === true, ...(typeof value.continueId === 'string' && value.continueId ? { continueId: value.continueId.slice(0, 200) } : {}) };
    }
  } catch { /* Damaged or unavailable storage starts in ordinary chat. */ }
  return { active: false };
}

export function saveDiscoveryMode(storage: ModeStorage, accountId: string | null | undefined, state: DiscoveryModeState): void {
  try { writeAccountStorage(storage, STORAGE_PREFIX, accountId, JSON.stringify(state)); } catch { /* The mode still applies in this session. */ }
}

/** Enter on a fresh «Поглибити знайомство» question; leave once the understanding summary is confirmed. */
export function nextDiscoveryMode(state: DiscoveryModeState, profile: PersonalStrategyProfile | undefined, now = Date.now()): DiscoveryModeState {
  if (profile?.onboardingStatus === 'new' && !profile.goals.length) return exitDiscoveryMode(state);
  const discovery = profile?.discovery;
  const id = discovery?.pendingQuestion?.id;
  const pressed = id ? DISCOVERY_MODE_QUESTION_ID.exec(id) : null;
  if (pressed && id !== state.continueId) {
    const at = Number(pressed[1]);
    if (now - at <= ENTRY_WINDOW_MS && at <= now + 60_000) return { active: true, continueId: id };
  }
  if (state.active && discovery?.phase === 'ready') return { active: false, ...(state.continueId ? { continueId: state.continueId } : {}) };
  return state;
}

export const exitDiscoveryMode = (state: DiscoveryModeState): DiscoveryModeState => ({ active: false, ...(state.continueId ? { continueId: state.continueId } : {}) });
