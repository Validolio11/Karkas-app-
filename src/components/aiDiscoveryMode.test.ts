import assert from 'node:assert/strict';
import test from 'node:test';
import { exitDiscoveryMode, nextDiscoveryMode, readDiscoveryMode, saveDiscoveryMode } from './aiDiscoveryMode';
import { createPersonalStrategyProfile } from '../utils/personalStrategy';
import { continueStrategyDiscovery, normalizeStrategyDiscovery } from '../utils/strategyDiscovery';
import { confirmedProfile } from '../utils/strategyDiscovery.testHelpers';

function storage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}

test('clearing personal memory exits an active discovery session', () => {
  assert.equal(nextDiscoveryMode({ active: true, continueId: 'old-question' }, createPersonalStrategyProfile()).active, false);
});

test('discovery mode starts only from a fresh «Поглибити знайомство» press and stays off after exit', () => {
  const now = 1_800_000_000_000;
  const fresh = { ...createPersonalStrategyProfile(), onboardingStatus: 'in_progress' as const };
  fresh.discovery = normalizeStrategyDiscovery(fresh);
  // An ordinary pending question never switches the chat into the interview.
  assert.deepEqual(nextDiscoveryMode({ active: false }, fresh, now), { active: false });
  const pressed = continueStrategyDiscovery(fresh, 'uk', now);
  assert.equal(pressed.discovery?.pendingQuestion?.topic, 'direction');
  const entered = nextDiscoveryMode({ active: false }, pressed, now + 1000);
  assert.equal(entered.active, true);
  const exited = exitDiscoveryMode(entered);
  assert.equal(nextDiscoveryMode(exited, pressed, now + 2000).active, false);
  // An old press (the chat opened much later) does not open the mode.
  assert.equal(nextDiscoveryMode({ active: false }, continueStrategyDiscovery(fresh, 'uk', now), now + 60 * 60_000).active, false);
  // A legacy continue id carries no press time.
  const legacy = { ...pressed, discovery: { ...pressed.discovery!, pendingQuestion: { ...pressed.discovery!.pendingQuestion!, id: 'continue:3:1' } } };
  assert.equal(nextDiscoveryMode({ active: false }, legacy, now).active, false);
});

test('a confirmed understanding summary ends discovery mode, and the mode is stored per account', () => {
  const ready = confirmedProfile();
  assert.deepEqual(nextDiscoveryMode({ active: true, continueId: 'continue:1-a:barriers' }, ready), { active: false, continueId: 'continue:1-a:barriers' });
  const reopened = continueStrategyDiscovery(ready, 'uk', 1_800_000_000_000);
  assert.equal(reopened.discovery?.pendingQuestion?.topic, 'barriers');
  assert.equal(nextDiscoveryMode({ active: false }, reopened, 1_800_000_000_500).active, true);
  const memory = storage();
  saveDiscoveryMode(memory, 'alice', { active: true, continueId: 'continue:1-a:direction' });
  assert.deepEqual(readDiscoveryMode(memory, 'alice'), { active: true, continueId: 'continue:1-a:direction' });
  assert.deepEqual(readDiscoveryMode(memory, 'bob'), { active: false });
  memory.values.set([...memory.values.keys()][0], '{broken');
  assert.deepEqual(readDiscoveryMode(memory, 'alice'), { active: false });
});
