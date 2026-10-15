import assert from 'node:assert/strict';
import test from 'node:test';
import { createPersonalStrategyProfile } from './personalStrategy';
import { applyDiscoveryTurn, isPersonalStrategyReady, preserveDiscoveryAfterUserGoalEdit, normalizeStrategyDiscovery, isDiscoveryRepetitionComplaint, discoveryQuestionsEquivalent, wantsPracticalHelpNow } from './strategyDiscovery';
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

test('a concrete repetitive-work barrier is accepted and a repeated question cannot reopen it', () => {
  const quote = 'Встановлювати кейфрейми, багато кейфреймів щоб все почало рухатись і це забирає багато часу і багато не цікавої рутини';
  const base = createPersonalStrategyProfile();
  const question = 'Пригадай останній раз, коли важлива справа відкладалася: що відбувалося безпосередньо перед тим, як увага перемкнулася на інше?';
  const profile = { ...base, discovery: { ...normalizeStrategyDiscovery(base), pendingQuestion: {
    id: 'question:barriers', topic: 'barriers' as const, text: question,
  } } };
  const result = applyDiscoveryTurn(profile, { memoryPatch: { discovery: {
    answers: [{ topic: 'barriers', status: 'answered', quote }], question: { topic: 'barriers', text: question },
  } } }, quote, 'routine');
  assert.equal(result.discovery?.topics.barriers.status, 'answered');
  assert.equal(result.discovery?.topics.barriers.evidence[0].quote, quote);
  assert.notEqual(result.discovery?.pendingQuestion?.topic, 'barriers');
  assert.equal(isPersonalStrategyReady(result), false);
  const omitted = applyDiscoveryTurn(profile, { memoryPatch: { discovery: {} } }, quote, 'routine-without-model-answer');
  assert.equal(omitted.discovery?.topics.barriers.status, 'answered');
});

test('a short answer to an antecedent stays in memory without pretending to explain the barrier', () => {
  const base = createPersonalStrategyProfile();
  const profile = { ...base, discovery: { ...normalizeStrategyDiscovery(base), pendingQuestion: {
    id: 'question:barriers', topic: 'barriers' as const, text: 'Що відбувалося перед тим, як увага перемкнулася?',
  } } };
  const quote = 'нічого не відбувається';
  const result = applyDiscoveryTurn(profile, { memoryPatch: { discovery: {} } }, quote, 'no-event');
  const state = normalizeStrategyDiscovery(result);
  assert.equal(state.topics.barriers.status, 'unknown');
  assert.deepEqual(state.topics.barriers.evidence, [{ quote, messageId: 'no-event' }]);
  assert.equal(isPersonalStrategyReady(result), false);
});

test('screenshot complaints and requests to start work ask for help without inventing discovery evidence', () => {
  const complaint = 'та блять я заєбався відповідати на одні і тай й ж повідомлення';
  assert.equal(isDiscoveryRepetitionComplaint(complaint), true);
  assert.equal(wantsPracticalHelpNow(complaint), true);
  assert.equal(wantsPracticalHelpNow('Допоможи мені почати завдання «Робота над анімацією» — зараз на черзі «Анімація 2». Спершу зрозумій, що робить початок складним.'), true);
  assert.equal(isDiscoveryRepetitionComplaint('Я втомився від монотонної роботи'), false);
  assert.equal(isDiscoveryRepetitionComplaint('Повтори, будь ласка, запитання'), false);
  const base = createPersonalStrategyProfile();
  assert.equal(applyDiscoveryTurn(base, { memoryPatch: { discovery: {
    answers: [{ topic: 'barriers', status: 'answered', quote: complaint }],
  } } }, complaint, 'complaint'), base);
});

test('paraphrased antecedent questions are repetitions; a question about another aspect is fresh', () => {
  const first = 'Коли ви востаннє відклали важливу справу, що відбувалося перед тим, як ви переключилися на щось інше?';
  assert.equal(discoveryQuestionsEquivalent(first, 'Пригадай останній раз, коли важлива справа відкладалася: що відбувалося безпосередньо перед тим, як увага перемкнулася на інше?'), true);
  assert.equal(discoveryQuestionsEquivalent(first, 'Скільки часу й сил у тебе є на це зараз?'), false);
});
