import type { PSTask } from '../types';
import { readAccountStorage, writeAccountStorage } from './accountStorage';

export interface OnboardingState {
  status: 'active' | 'done' | 'skipped';
  steps: {
    task: boolean;
    session: boolean;
    notify: 'pending' | 'ok' | 'unavailable' | 'skipped';
    ai: 'pending' | 'ok' | 'skipped';
  };
  startedAt: number;
}

type OnboardingStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type TimedTask = Pick<PSTask, 'timeSpentSeconds' | 'timeSessions'>;
const STORAGE_PREFIX = 'karkas_onboarding_v1';

function hasExactKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function isOnboardingState(value: unknown): value is OnboardingState {
  if (!hasExactKeys(value, ['status', 'steps', 'startedAt'])) return false;
  if (value.status !== 'active' && value.status !== 'done' && value.status !== 'skipped') return false;
  if (typeof value.startedAt !== 'number' || !Number.isFinite(value.startedAt) || value.startedAt < 0) return false;
  if (!hasExactKeys(value.steps, ['task', 'session', 'notify', 'ai'])) return false;
  const { task, session, notify, ai } = value.steps;
  return typeof task === 'boolean' && typeof session === 'boolean'
    && (notify === 'pending' || notify === 'ok' || notify === 'unavailable' || notify === 'skipped')
    && (ai === 'pending' || ai === 'ok' || ai === 'skipped');
}

export function readOnboarding(storage: OnboardingStorage, owner?: string | null): OnboardingState | null {
  try {
    const raw = readAccountStorage(storage, STORAGE_PREFIX, owner);
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    return isOnboardingState(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeOnboarding(storage: OnboardingStorage, owner: string | null | undefined, state: OnboardingState): void {
  writeAccountStorage(storage, STORAGE_PREFIX, owner, JSON.stringify(state));
}

export function shouldOfferOnboarding({ stored, tasks, deletedTasks }: {
  stored: OnboardingState | null;
  tasks: readonly unknown[];
  deletedTasks: readonly unknown[];
}): boolean {
  return stored ? stored.status === 'active' : tasks.length === 0 && deletedTasks.length === 0;
}

function recordedSeconds(task: TimedTask): number {
  const validSeconds = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
  const sessions = task.timeSessions && typeof task.timeSessions === 'object' && !Array.isArray(task.timeSessions)
    ? Object.values(task.timeSessions).reduce((total, session) => total + validSeconds(session?.seconds), 0) : 0;
  // Totals and session records describe the same work.
  return Math.max(validSeconds(task.timeSpentSeconds), sessions);
}

export function deriveSteps(state: OnboardingState, tasks: readonly TimedTask[]): OnboardingState {
  const task = state.steps.task || tasks.length > 0;
  const session = state.steps.session || tasks.some(item => recordedSeconds(item) >= 60);
  const complete = task && session && state.steps.notify !== 'pending' && state.steps.ai !== 'pending';
  const status = state.status === 'active' && complete ? 'done' : state.status;
  if (task === state.steps.task && session === state.steps.session && status === state.status) return state;
  return { ...state, status, steps: { ...state.steps, task, session } };
}
