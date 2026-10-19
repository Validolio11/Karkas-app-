import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accountStorageKey, legacyAccountStorageKey } from './accountStorage';
import { deriveSteps, readOnboarding, shouldOfferOnboarding, writeOnboarding, type OnboardingState } from './onboarding';

function activeState(): OnboardingState {
  return { status: 'active', steps: { task: false, session: false, notify: 'pending', ai: 'pending' }, startedAt: 1234 };
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

const prefix = 'karkas_onboarding_v1';

test('onboarding round-trips per account and separates guests from an account named guest', () => {
  const storage = memoryStorage();
  const guest = activeState();
  const account = { ...activeState(), startedAt: 5678 };
  assert.equal(readOnboarding(storage, null), null);
  writeOnboarding(storage, null, guest);
  writeOnboarding(storage, 'guest', account);
  assert.deepEqual(readOnboarding(storage, undefined), guest);
  assert.deepEqual(readOnboarding(storage, 'guest'), account);
  assert.equal(readOnboarding(storage, 'another/account'), null);
  assert.equal(storage.values.has(accountStorageKey(prefix, null)), true);
  assert.equal(storage.values.has(accountStorageKey(prefix, 'guest')), true);
  writeOnboarding(storage, 'another/account', guest);
  assert.equal(storage.values.has(accountStorageKey(prefix, 'another/account')), true);
});

test('onboarding uses account storage legacy fallback and removes it on write', () => {
  const storage = memoryStorage();
  const state = activeState();
  const legacy = legacyAccountStorageKey(prefix, 'alice')!;
  storage.setItem(legacy, JSON.stringify(state));
  assert.deepEqual(readOnboarding(storage, 'alice'), state);
  writeOnboarding(storage, 'alice', { ...state, status: 'skipped' });
  assert.equal(storage.getItem(legacy), null);
  assert.equal(readOnboarding(storage, 'alice')?.status, 'skipped');
  storage.setItem(prefix + ':guest', JSON.stringify(state));
  assert.equal(readOnboarding(storage, 'guest'), null);
});

test('strict parsing rejects malformed JSON, missing fields, extra fields and incorrect value types', () => {
  const storage = memoryStorage();
  const state = activeState();
  const invalid: unknown[] = [
    null, false, [], {}, { ...state, status: 'new' }, { ...state, startedAt: '1234' },
    { ...state, startedAt: -1 }, { ...state, startedAt: null }, { ...state, extra: true },
    { status: 'active', steps: state.steps }, { ...state, steps: null }, { ...state, steps: [] },
    { ...state, steps: { ...state.steps, task: 1 } }, { ...state, steps: { ...state.steps, session: 'false' } },
    { ...state, steps: { ...state.steps, notify: 'denied' } }, { ...state, steps: { ...state.steps, ai: 'unavailable' } },
    { ...state, steps: { task: false, session: false, notify: 'pending' } },
    { ...state, steps: { ...state.steps, extra: true } },
  ];
  for (const value of invalid) {
    storage.setItem(accountStorageKey(prefix, null), JSON.stringify(value));
    assert.equal(readOnboarding(storage, null), null, JSON.stringify(value));
  }
  for (const raw of ['', '{', 'undefined', '{"status":"active","steps":{"task":false,"session":false,"notify":"pending","ai":"pending"},"startedAt":1e999}']) {
    storage.setItem(accountStorageKey(prefix, null), raw);
    assert.equal(readOnboarding(storage, null), null, raw);
  }
});

test('parsing accepts every declared enum and a zero start time', () => {
  const storage = memoryStorage();
  for (const status of ['active', 'done', 'skipped'] as const) {
    for (const notify of ['pending', 'ok', 'unavailable', 'skipped'] as const) {
      for (const ai of ['pending', 'ok', 'skipped'] as const) {
        const state: OnboardingState = { status, steps: { task: true, session: true, notify, ai }, startedAt: 0 };
        writeOnboarding(storage, null, state);
        assert.deepEqual(readOnboarding(storage, null), state);
      }
    }
  }
});

test('storage read failures return null', () => {
  const storage = { ...memoryStorage(), getItem: () => { throw new Error('unavailable'); } };
  assert.equal(readOnboarding(storage, null), null);
});

test('only an empty new workspace is offered onboarding', () => {
  assert.equal(shouldOfferOnboarding({ stored: null, tasks: [], deletedTasks: [] }), true);
  assert.equal(shouldOfferOnboarding({ stored: null, tasks: [{}], deletedTasks: [] }), false);
  assert.equal(shouldOfferOnboarding({ stored: null, tasks: [], deletedTasks: [{}] }), false);
  assert.equal(shouldOfferOnboarding({ stored: null, tasks: [{}], deletedTasks: [{}] }), false);
});

test('an active checklist survives workspace activity, while done and skipped stay hidden', () => {
  for (const tasks of [[], [{}]]) {
    for (const deletedTasks of [[], [{}]]) {
      assert.equal(shouldOfferOnboarding({ stored: activeState(), tasks, deletedTasks }), true);
      for (const status of ['done', 'skipped'] as const) {
        assert.equal(shouldOfferOnboarding({ stored: { ...activeState(), status }, tasks, deletedTasks }), false);
      }
    }
  }
});

test('task completion is automatic and remains recorded after the task is removed', () => {
  const initial = activeState();
  assert.equal(deriveSteps(initial, []), initial);
  const next = deriveSteps(initial, [{}]);
  assert.equal(next.steps.task, true);
  assert.equal(next.steps.session, false);
  assert.equal(initial.steps.task, false);
  assert.equal(deriveSteps(next, []).steps.task, true);
});

test('session completion requires at least sixty recorded seconds on one task', () => {
  assert.equal(deriveSteps(activeState(), [{ timeSpentSeconds: 59.99 }]).steps.session, false);
  assert.equal(deriveSteps(activeState(), [{ timeSpentSeconds: 60 }]).steps.session, true);
  assert.equal(deriveSteps(activeState(), [{ timeSpentSeconds: 120 }]).steps.session, true);
  assert.equal(deriveSteps(activeState(), [{ timeSpentSeconds: 30 }, { timeSpentSeconds: 30 }]).steps.session, false);
  const completed = deriveSteps(activeState(), [{ timeSpentSeconds: 60 }]);
  assert.equal(deriveSteps(completed, []).steps.session, true);
});

test('session records are aggregated per task without adding duplicate total work', () => {
  assert.equal(deriveSteps(activeState(), [{ timeSessions: { first: { seconds: 30 }, second: { seconds: 30, stepId: 'step' } } }]).steps.session, true);
  assert.equal(deriveSteps(activeState(), [{ timeSessions: { first: { seconds: 59 } } }]).steps.session, false);
  assert.equal(deriveSteps(activeState(), [{ timeSpentSeconds: 30, timeSessions: { first: { seconds: 30 } } }]).steps.session, false);
  assert.equal(deriveSteps(activeState(), [{ timeSpentSeconds: 10, timeSessions: { first: { seconds: 60 } } }]).steps.session, true);
  assert.equal(deriveSteps(activeState(), [{ timeSessions: { first: { seconds: 30 } } }, { timeSessions: { second: { seconds: 30 } } }]).steps.session, false);
});

test('invalid recorded durations cannot finish a session or subtract valid work', () => {
  for (const seconds of [-60, NaN, Infinity, -Infinity]) {
    assert.equal(deriveSteps(activeState(), [{ timeSpentSeconds: seconds }]).steps.session, false);
    assert.equal(deriveSteps(activeState(), [{ timeSessions: { invalid: { seconds } } }]).steps.session, false);
    assert.equal(deriveSteps(activeState(), [{ timeSessions: { valid: { seconds: 60 }, invalid: { seconds } } }]).steps.session, true);
  }
});

test('all four resolved steps finish active onboarding, including optional skips', () => {
  for (const notify of ['ok', 'unavailable', 'skipped'] as const) {
    for (const ai of ['ok', 'skipped'] as const) {
      const state: OnboardingState = { ...activeState(), steps: { task: false, session: false, notify, ai } };
      const next = deriveSteps(state, [{ timeSpentSeconds: 60 }]);
      assert.equal(next.status, 'done');
      assert.equal(next.startedAt, state.startedAt);
      assert.deepEqual(next.steps, { task: true, session: true, notify, ai });
      assert.equal(deriveSteps(next, []), next);
    }
  }
});

test('each pending step prevents completion and terminal states never reopen', () => {
  const complete: OnboardingState = { ...activeState(), steps: { task: true, session: true, notify: 'ok', ai: 'ok' } };
  for (const steps of [
    { ...complete.steps, task: false }, { ...complete.steps, session: false },
    { ...complete.steps, notify: 'pending' as const }, { ...complete.steps, ai: 'pending' as const },
  ]) assert.equal(deriveSteps({ ...complete, steps }, []).status, 'active');
  for (const status of ['done', 'skipped'] as const) {
    const state: OnboardingState = { ...activeState(), status };
    assert.equal(deriveSteps(state, []).status, status);
    assert.equal(deriveSteps({ ...complete, status }, [{ timeSpentSeconds: 60 }]).status, status);
  }
});
