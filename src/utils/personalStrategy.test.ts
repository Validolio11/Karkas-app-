import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyStrategyMemory, createPersonalStrategyProfile, readPersonalStrategy, savePersonalStrategy, clearPersonalStrategy } from './personalStrategy';

const storage = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
};
const goal = { id: 'g', title: 'Build a better life', motive: 'Freedom', agreed: true, taskIds: [], categoryIds: ['work'] };
test('personal memory isolates guest, an account literally named guest, and other accounts', () => {
  const store = storage();
  savePersonalStrategy(store, null, { ...createPersonalStrategyProfile(), phase: 'guest-phase' });
  savePersonalStrategy(store, 'guest', { ...createPersonalStrategyProfile(), phase: 'account-phase' });
  assert.equal(readPersonalStrategy(store, null).phase, 'guest-phase');
  assert.equal(readPersonalStrategy(store, 'guest').phase, 'account-phase');
  assert.equal(readPersonalStrategy(store, 'other').onboardingStatus, 'new');
  clearPersonalStrategy(store, 'guest');
  assert.equal(readPersonalStrategy(store, null).phase, 'guest-phase');
  assert.equal(readPersonalStrategy(store, 'guest').phase, 'goals');
});
test('new AI goals cannot grant autonomy, a previously discussed goal needs affirmative confirmation', () => {
  let profile = applyStrategyMemory(createPersonalStrategyProfile(), { goals: [goal], onboardingStatus: 'complete' }, 'I want more freedom', 'turn1');
  assert.equal(profile.goals[0].agreed, false);
  assert.equal(profile.onboardingStatus, 'in_progress');
  profile = applyStrategyMemory(profile, { goals: [goal] }, 'Я не погоджуюся', 'turn2');
  assert.equal(profile.goals[0].agreed, false);
  profile = applyStrategyMemory(profile, { goals: [goal], onboardingStatus: 'complete' }, 'Так, підтверджую цю ціль', 'turn3');
  assert.equal(profile.goals[0].agreed, true);
  assert.equal(profile.onboardingStatus, 'complete');
});
test('AI interpretations cannot masquerade as statements from the person and each observation keeps its source turn', () => {
  const profile = applyStrategyMemory(createPersonalStrategyProfile(), { barriers: [
    { id: 'a', text: 'Втомився', source: 'user' }, { id: 'b', text: 'Fear of failure', source: 'user' },
  ] }, 'Втомився після роботи', 'turn-source');
  assert.equal(profile.barriers[0].source, 'user');
  assert.equal(profile.barriers[1].source, 'hypothesis');
  assert.ok(profile.barriers.every(entry => entry.messageId === 'turn-source'));
});
test('changing the meaning or scope of an agreed goal requires a new confirmation', () => {
  const initial = { ...createPersonalStrategyProfile(), goals: [goal] };
  for (const changed of [{ ...goal, title: 'A different life' }, { ...goal, motive: 'A different reason' }, { ...goal, categoryIds: ['other'] }, { ...goal, taskIds: ['unrelated-task'] }]) {
    const proposed = applyStrategyMemory(initial, { goals: [changed] }, 'Yes, continue with my goal', 'turn1');
    assert.equal(proposed.goals[0].agreed, false);
    const confirmed = applyStrategyMemory(proposed, { goals: [changed] }, 'Yes, I agree with this revised goal', 'turn2');
    assert.equal(confirmed.goals[0].agreed, true);
  }
});
test('partial memory updates keep existing goal title, motive and linked scope', () => {
  const initial = { ...createPersonalStrategyProfile(), goals: [{ ...goal, taskIds: ['task1'] }] };
  const patched = applyStrategyMemory(initial, { goals: [{ id: goal.id } as any] }, 'Continue', 'turn');
  assert.deepEqual(patched.goals, initial.goals);
});
test('damaged storage safely resets and reminder settings have bounded valid local times', () => {
  const store = { getItem: () => '{bad', setItem: () => {}, removeItem: () => {} };
  assert.equal(readPersonalStrategy(store, 'a').onboardingStatus, 'new');
  const saved = storage();
  savePersonalStrategy(saved, 'a', { ...createPersonalStrategyProfile(), reminders: { enabled: true, times: ['25:99', '09:00', '17:30', '20:00'], maxPerDay: 2 } });
  assert.deepEqual(readPersonalStrategy(saved, 'a').reminders, { enabled: true, times: ['09:00', '17:30'], maxPerDay: 2 });
});
