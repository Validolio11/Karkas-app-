import assert from 'node:assert/strict';
import test from 'node:test';
import { createPersonalStrategyProfile } from './personalStrategy';
import { applyDiscoveryTurn, isPersonalStrategyReady, preserveDiscoveryAfterUserGoalEdit, normalizeStrategyDiscovery } from './strategyDiscovery';
import { confirmedProfile } from './strategyDiscovery.testHelpers';

test('an uncertain sentence cannot close the asked direction and attempts topics', () => {
  const quote = 'Ще не знаю, бо треба подумати';
  const profile = applyDiscoveryTurn(createPersonalStrategyProfile(), { memoryPatch: { discovery: {
    answers: [{ topic: 'direction', quote, status: 'answered' }, { topic: 'attempts', quote, status: 'answered' }],
  } } }, quote, 'uncertain');
  assert.equal(profile.discovery?.topics.direction.status, 'unknown');
  assert.equal(profile.discovery?.topics.attempts.status, 'unknown');
});

test('manual title edit preserves readiness but a change in motive cannot bypass confirmation', () => {
  const previous = confirmedProfile();
  const titleEdit = { ...previous, goals: previous.goals.map(goal => ({ ...goal, title: `${goal.title}!` })) };
  assert.equal(isPersonalStrategyReady(preserveDiscoveryAfterUserGoalEdit(previous, titleEdit)), true);
  const motiveEdit = { ...titleEdit, goals: titleEdit.goals.map(goal => ({ ...goal, motive: 'Інша мотивація' })) };
  assert.equal(isPersonalStrategyReady(preserveDiscoveryAfterUserGoalEdit(previous, motiveEdit)), false);
});

test('short Cyrillic capacity durations remain substantive answers to the capacity question', () => {
  for (const quote of ['30 хв', '2 год']) {
    const blank = createPersonalStrategyProfile();
    const discovery = normalizeStrategyDiscovery(blank);
    const profile = { ...blank, discovery: { ...discovery, pendingQuestion: { id: 'capacity', topic: 'capacity' as const, text: 'Скільки часу є?' } } };
    assert.equal(applyDiscoveryTurn(profile, { memoryPatch: { discovery: { answers: [{ topic: 'capacity', quote, status: 'answered' }] } } }, quote, quote).discovery?.topics.capacity.status, 'answered');
  }
});
