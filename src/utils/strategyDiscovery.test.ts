import assert from 'node:assert/strict';
import test from 'node:test';
import type { StrategyDiscoveryTopic } from '../types';
import { applyStrategyMemory, applyStrategyResponse, createPersonalStrategyProfile, readPersonalStrategy, savePersonalStrategy } from './personalStrategy';
import { addressedDiscoveryQuestion, applyDiscoveryTurn, continueStrategyDiscovery, isPersonalStrategyReady, missingStrategyDiscoveryTopics, nextStrategyDiscoveryTopic, normalizeStrategyDiscovery, preparePersonalDiscoveryRequest, STRATEGY_DISCOVERY_TOPICS, updateDiscoveryEvidence } from './strategyDiscovery';
import { confirmedProfile, discoveryGoal, discoveryStatements, understandingProfile } from './strategyDiscovery.testHelpers';
import { addressFormOf, detectDiscoveryAddress, discoveryQuestionStreak, PRACTICAL_HELP_OFFER, practicalHelpRequested, wantsPracticalHelpNow } from './strategyDiscovery';

const answer = (topic: StrategyDiscoveryTopic, quote: string, status: 'answered' | 'deferred' = 'answered') => ({ memoryPatch: { discovery: { answers: [{ topic, quote, status }] } } });
test('a wishlist does not invent motivation, circumstances, barriers, capacity or attempts', () => {
  for (const quote of ['Хочу менше грати в ігри, більше працювати й краще керувати часом', 'Я б хотів швидше вчитися, більше заробляти, щоб подорожувати і працювати 20 хвилин']) {
    const profile = applyStrategyResponse(createPersonalStrategyProfile(), { status: 'ready', memoryPatch: { goals: [{ ...discoveryGoal, agreed: true }], onboardingStatus: 'complete', discovery: {
      answers: STRATEGY_DISCOVERY_TOPICS.map(topic => ({ topic, quote, status: 'answered' })), selectedGoalIds: ['g'], summary: 'Усе зрозуміло. Так?',
    } } }, quote, 'wishlist');
    for (const topic of ['circumstances', 'barriers', 'capacity', 'attempts'] as StrategyDiscoveryTopic[]) assert.equal(profile.discovery?.topics[topic].status, 'unknown', `${topic}: ${quote}`);
    assert.equal(isPersonalStrategyReady(profile), false);
    assert.equal(profile.goals[0].agreed, false);
    assert.equal(profile.discovery?.pendingSummary, undefined);
  }
});
test('independent grounded topics are accepted in one turn and the missing topic drives the next question', () => {
  const quote = 'Хочу незалежності. Я працюю на повний день. Коли сідаю до справи, боюсь незрозумілого першого кроку. Маю 30 хвилин увечері.';
  const profile = applyDiscoveryTurn(createPersonalStrategyProfile(), { memoryPatch: { discovery: { answers: ['direction', 'circumstances', 'barriers', 'capacity'].map(topic => ({ topic: topic as StrategyDiscoveryTopic, quote, status: 'answered' })) } } }, quote, 'multi');
  for (const topic of ['direction', 'circumstances', 'barriers', 'capacity'] as StrategyDiscoveryTopic[]) {
    assert.equal(profile.discovery?.topics[topic].status, 'answered', topic);
    assert.deepEqual(profile.discovery?.topics[topic].evidence, [{ quote, messageId: 'multi' }]);
  }
  assert.equal(nextStrategyDiscoveryTopic(profile), 'motivation');
});
test('isolated fragments cannot discard wishlist, uncertainty or negation qualifiers', () => {
  for (const [topic, userText, quote] of [
    ['capacity', 'Хочу мати 30 хвилин, але зараз не маю часу', '30 хвилин'],
    ['capacity', 'Можливо, маю 30 хвилин, але я не впевнений', 'маю 30 хвилин'],
    ['circumstances', 'Хочу сказати, що працюю на повний день', 'працюю на повний день'],
    ['barriers', 'Я не граю в ігри перед роботою', 'граю в ігри перед роботою'],
    ['motivation', 'Для мене це не важливо', 'важливо'],
  ] as const) {
    const profile = applyDiscoveryTurn(createPersonalStrategyProfile(), answer(topic, quote), userText, `qualifier-${topic}`);
    assert.equal(profile.discovery?.topics[topic].status, 'unknown', userText);
  }
  const memory = applyStrategyMemory(createPersonalStrategyProfile(), { facts: [{ id: 'fatigue', text: 'втомився', source: 'user' }] }, 'Я не втомився', 'negation');
  assert.equal(memory.facts[0].source, 'hypothesis');
  assert.equal(memory.facts[0].quote, 'Я не втомився');
});
test('privacy remains deferred, gets a practical alternative and cannot grant early autonomy', () => {
  let profile = continueStrategyDiscovery(confirmedProfile());
  const original = profile.discovery!.pendingQuestion!.text;
  const quote = 'Не хочу про це розповідати, це приватне';
  profile = applyDiscoveryTurn(profile, answer('barriers', quote, 'deferred'), quote, 'private-1');
  assert.equal(profile.discovery?.topics.barriers.status, 'deferred');
  assert.ok(missingStrategyDiscoveryTopics(profile.discovery!).includes('barriers'));
  assert.equal(nextStrategyDiscoveryTopic(profile), 'barriers');
  assert.notEqual(profile.discovery?.pendingQuestion?.text, original);
  assert.match(profile.discovery!.pendingQuestion!.text, /Якщо зручно/);
  assert.equal(isPersonalStrategyReady(profile), false);
  profile = applyDiscoveryTurn(profile, answer('barriers', quote, 'deferred'), quote, 'private-2');
  assert.match(profile.discovery!.pendingQuestion!.text, /лише за вашим бажанням/);
  assert.equal(profile.discovery?.topics.barriers.evidence.at(-1)?.quote, quote);
});
test('unknown answers and invented deferred answers leave a topic open, explicit no attempts is meaningful', () => {
  const profile = continueStrategyDiscovery(confirmedProfile());
  assert.equal(applyDiscoveryTurn(profile, answer('barriers', 'Не знаю'), 'Не знаю', 'unknown').discovery?.topics.barriers.status, 'unknown');
  assert.equal(applyDiscoveryTurn(profile, answer('barriers', 'Мені незрозуміло', 'deferred'), 'Мені незрозуміло', 'fake-deferred').discovery?.topics.barriers.status, 'unknown');
  const initial = createPersonalStrategyProfile(); initial.discovery = normalizeStrategyDiscovery(initial);
  initial.discovery.pendingQuestion = { id: 'attempts', topic: 'attempts', text: 'Що пробували?' };
  assert.equal(applyDiscoveryTurn(initial, answer('attempts', 'Нічого'), 'Нічого', 'none').discovery?.topics.attempts.status, 'answered');
});
test('only the exact pending understanding summary and standalone yes can confirm selected goals', () => {
  const profile = understandingProfile();
  assert.equal(profile.discovery?.phase, 'confirming');
  const id = profile.discovery!.pendingSummary!.id;
  for (const [text, confirmationId] of [['Так', undefined], ['Так', 'old-summary'], ['Так, але це не зовсім так', id], ['Не погоджуюся', id], ['@plan Так', id], ['Зроби план', id]] as const) {
    const prepared = preparePersonalDiscoveryRequest(profile, text, confirmationId);
    assert.equal(isPersonalStrategyReady(prepared.profile), false, text);
    assert.equal(prepared.confirmedSummaryId, undefined);
  }
  const prepared = preparePersonalDiscoveryRequest(profile, 'Так.', id);
  assert.equal(prepared.confirmedSummaryId, id);
  assert.equal(isPersonalStrategyReady(prepared.profile), true);
  assert.equal(prepared.profile.goals[0].agreed, true);
  assert.equal(isPersonalStrategyReady(applyDiscoveryTurn(profile, {}, 'Так', 'bare-yes')), false);
});
test('summary confirmation binds goal meaning and does not become sticky after edits or a fresh question', () => {
  const ready = confirmedProfile();
  assert.equal(isPersonalStrategyReady(ready), true);
  assert.equal(isPersonalStrategyReady({ ...ready, goals: ready.goals.map(goal => ({ ...goal, title: 'Changed meaning' })) }), false);
  assert.equal(isPersonalStrategyReady({ ...ready, goals: [] }), false);
  assert.equal(isPersonalStrategyReady({ ...ready, goals: ready.goals.map(goal => ({ ...goal, taskIds: ['new-authorized-task'] })) }), true);
  const changed = updateDiscoveryEvidence(ready, 'capacity', 'Маю 10 хвилин і можу їх виділити');
  assert.equal(isPersonalStrategyReady(changed), false);
  assert.equal(changed.discovery?.pendingSummary, undefined);
  const asked = applyDiscoveryTurn(ready, { memoryPatch: { discovery: { question: { topic: 'barriers', text: 'Що завадило цього разу?' } } } }, 'Хочу переглянути підхід', 'reopen');
  assert.equal(asked.discovery?.topics.barriers.status, 'unknown');
  assert.equal(isPersonalStrategyReady(asked), false);
});
test('repeated turns do not duplicate evidence or overwrite a newer strategy and plain commands retain readiness', () => {
  const ready = confirmedProfile();
  const response = { status: 'ready' as const, narrative: 'Працюйте з одним посильним кроком', nextAction: 'Відкрити матеріали' };
  const first = applyStrategyResponse(ready, response, 'Підготуй наступний крок', 'work-turn', 10);
  const replay = applyStrategyResponse(first, { nextAction: 'An old late response' }, 'Підготуй наступний крок', 'work-turn', 1);
  assert.equal(replay, first);
  assert.equal(replay.latestStrategy?.nextAction, 'Відкрити матеріали');
  for (const text of ['@analysis поточні завдання', 'Додай таймер на 25 хвилин', '@steps моє завдання']) {
    const prepared = preparePersonalDiscoveryRequest(first, text);
    const ordinary = applyStrategyResponse(prepared.profile, { question: 'Яке саме завдання?' }, text, text, 20);
    assert.equal(isPersonalStrategyReady(ordinary), true);
    assert.equal(ordinary.latestStrategy?.nextAction, 'Відкрити матеріали');
  }
});
test('legacy complete, agreed flags and hypotheses are additive data, never interview authority', () => {
  const legacy = { ...createPersonalStrategyProfile(), onboardingStatus: 'complete' as const, goals: [{ ...discoveryGoal, agreed: true }], facts: [{ id: 'h', text: discoveryStatements.capacity, quote: discoveryStatements.capacity, messageId: 'old', source: 'hypothesis' as const }], actionHistory: [], feedback: [{ id: 'f', text: 'Keep my history', createdAt: 1 }] };
  const values = new Map<string, string>();
  const store = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  savePersonalStrategy(store, 'legacy', legacy);
  const loaded = readPersonalStrategy(store, 'legacy');
  assert.equal(isPersonalStrategyReady(loaded), false);
  assert.equal(loaded.discovery?.topics.capacity.status, 'unknown');
  assert.equal(loaded.onboardingStatus, 'in_progress');
  assert.deepEqual(loaded.goals, legacy.goals);
  assert.deepEqual(loaded.feedback, legacy.feedback);
});
test('optional private details can stay deferred while the known practical scope still needs explicit confirmation', () => {
  let profile = updateDiscoveryEvidence(understandingProfile(), 'attempts', 'Не хочу про це розповідати');
  assert.equal(profile.discovery?.topics.attempts.status, 'deferred');
  profile = applyStrategyResponse(profile, { memoryPatch: { discovery: { selectedGoalIds: ['g'], summary: 'Врахуємо вашу ціль, реальні 30 хвилин і незрозумілий початок. Попередні спроби залишаємо приватними. Правильно я вас зрозумів?' } } }, 'Підсумуй відомий контекст', 'private-summary');
  assert.equal(profile.discovery?.phase, 'confirming');
  assert.equal(isPersonalStrategyReady(profile), false);
  const prepared = preparePersonalDiscoveryRequest(profile, 'Так', profile.discovery!.pendingSummary!.id);
  assert.equal(isPersonalStrategyReady(prepared.profile), true);
  assert.equal(prepared.discovery.topics.attempts.status, 'deferred');
});
test('the form of address follows the person’s latest message that shows one', () => {
  assert.equal(detectDiscoveryAddress(['Слухай, я вже все розповів']), 'ty');
  assert.equal(detectDiscoveryAddress(['Що відбувається, коли ти відкриваєш порожній композишн?']), 'ty');
  assert.equal(detectDiscoveryAddress(['Скажіть, будь ласка, що мені робити']), 'vy');
  assert.equal(detectDiscoveryAddress(['Скажіть, що робити', 'Я фрілансер', 'Розбий це на кроки']), 'ty');
  assert.equal(detectDiscoveryAddress(['Я фрілансер, моушн-дизайн']), 'vy');
  assert.equal(addressFormOf('Можете пояснити, що вам заважає?'), 'vy');
  assert.equal(addressFormOf('п’ятий день поспіль'), undefined);
});
test('«Поглибити знайомство» resumes an unfinished interview at its first missing topic in the person’s form', () => {
  const quote = 'Слухай, хочу нарешті стабільно брати проєкти й не зривати дедлайни';
  const started = applyDiscoveryTurn(createPersonalStrategyProfile(), answer('direction', quote), quote, 'd1');
  assert.equal(started.discovery?.topics.direction.status, 'answered');
  const pressed = continueStrategyDiscovery(started, 'uk', 1_800_000_000_000);
  assert.equal(pressed.discovery?.pendingQuestion?.topic, 'motivation');
  assert.match(pressed.discovery!.pendingQuestion!.id, /^continue:1800000000000-[a-z0-9]+:motivation$/);
  assert.equal(addressFormOf(pressed.discovery!.pendingQuestion!.text), 'ty');
  assert.equal(pressed.discovery?.topics.direction.status, 'answered');
});
test('explicit requests for practical help are recognised, while described uncertainty stays an answer', () => {
  for (const text of ['Слухай, я вже все розповів. Що мені конкретно робити…', 'Що робити?', 'Допоможи', 'Дай пораду', 'з чого мені почати?', 'What should I do?', 'Досить питань']) {
    assert.equal(wantsPracticalHelpNow(text), true, text);
  }
  for (const text of ['Сідаю і не знаю, що робити далі', 'Я відкриваю проєкт і думаю, що робити спочатку', 'Допоможи скласти план', 'Відкриваю After Effects і гортаю YouTube']) {
    assert.equal(wantsPracticalHelpNow(text), false, text);
  }
  const profile = createPersonalStrategyProfile();
  profile.discovery = normalizeStrategyDiscovery(profile);
  const offered = { ...profile, discovery: { ...profile.discovery, pendingQuestion: { id: 'offer:t3~q3', turnId: 't3', topic: 'barriers' as const, text: PRACTICAL_HELP_OFFER.uk } } };
  for (const text of ['Так', 'Давай перший крок', 'Ок, підкажи']) assert.equal(practicalHelpRequested(text, offered), true, text);
  for (const text of ['Давай ще трохи розберемося', 'Ні, спершу питай далі']) assert.equal(practicalHelpRequested(text, offered), false, text);
  assert.equal(practicalHelpRequested('Так', profile), false);
});
test('question ids count consecutive interview questions and remember the one-time help offer', () => {
  assert.deepEqual(discoveryQuestionStreak(undefined), { asked: 0, offered: false });
  assert.deepEqual(discoveryQuestionStreak('discovery:barriers'), { asked: 0, offered: false });
  assert.deepEqual(discoveryQuestionStreak('continue:1800000000000-ab12:barriers'), { asked: 1, offered: false });
  assert.deepEqual(discoveryQuestionStreak('offer:t3~q3'), { asked: 3, offered: true });
  let profile = continueStrategyDiscovery(confirmedProfile());
  profile = applyDiscoveryTurn(profile, { memoryPatch: { discovery: { question: { topic: 'barriers', text: 'Що саме відбувається перед цим?' } } } }, 'Відкладаю', 'q-a');
  assert.equal(profile.discovery?.pendingQuestion?.id, 'question:q-a~q2');
  profile = applyDiscoveryTurn(profile, { memoryPatch: { discovery: { question: { topic: 'barriers', text: PRACTICAL_HELP_OFFER.uk } } } }, 'Відкладаю знову', 'q-b');
  assert.equal(profile.discovery?.pendingQuestion?.id, 'offer:q-b~q3');
  assert.equal(profile.discovery?.pendingQuestion?.text, PRACTICAL_HELP_OFFER.uk);
  profile = applyDiscoveryTurn(profile, { memoryPatch: { discovery: { question: { topic: 'barriers', text: 'Що заважає найбільше?' } } } }, 'Давай ще розберемося', 'q-c');
  assert.equal(profile.discovery?.pendingQuestion?.id, 'question:q-c~q4:offered');
});
test('the «Поглибити знайомство» opener follows the form of the person’s recent chat messages', () => {
  const fresh = createPersonalStrategyProfile();
  const now = 1_800_000_000_000;
  // No discovery answers yet: the recent "ти" messages decide; the wording avoids gendered forms.
  const pressed = continueStrategyDiscovery(fresh, 'uk', now, ['Допоможи', 'Слухай, що мені робити', 'Так, давай']);
  assert.equal(pressed.discovery?.pendingQuestion?.text, 'Що тобі хотілося б змінити у своєму житті й чому це для тебе важливо?');
  assert.equal(continueStrategyDiscovery(fresh, 'uk', now).discovery?.pendingQuestion?.text, 'Що ви хотіли б змінити у своєму житті й чому це для вас важливо?');
  assert.equal(addressFormOf(continueStrategyDiscovery(fresh, 'uk', now, ['Скажіть, будь ласка, що робити']).discovery!.pendingQuestion!.text), 'vy');
  // A finished interview reopens barriers in the same form.
  assert.equal(addressFormOf(continueStrategyDiscovery(confirmedProfile(), 'uk', now, ['Розбий це на кроки']).discovery!.pendingQuestion!.text), 'ty');
});
test('a stored app-written question is shown in the current form; model clarifications stay as written', () => {
  const pressed = continueStrategyDiscovery(createPersonalStrategyProfile(), 'uk', 1_800_000_000_000);
  const state = pressed.discovery!;
  const stored = state.pendingQuestion!;
  assert.equal(addressFormOf(stored.text), 'vy');
  assert.equal(addressedDiscoveryQuestion(state, stored, 'uk', 'ty'), 'Що тобі хотілося б змінити у своєму житті й чому це для тебе важливо?');
  assert.equal(addressedDiscoveryQuestion(state, stored, 'uk', 'vy'), stored.text);
  const opener = normalizeStrategyDiscovery(createPersonalStrategyProfile()).pendingQuestion!;
  assert.equal(addressFormOf(addressedDiscoveryQuestion(state, opener, 'uk', 'ty')), 'ty');
  const clarification = { id: 'question:t1~q1', topic: 'barriers' as const, text: 'Що саме ви відкриваєте першим?' };
  assert.equal(addressedDiscoveryQuestion(state, clarification, 'uk', 'ty'), clarification.text);
  const english = { ...stored, text: 'What would you like to change in your life, and why does it matter to you?' };
  assert.equal(addressedDiscoveryQuestion(state, english, 'en', 'ty'), english.text);
});
test('task-command imperatives show the form of address too', () => {
  for (const text of ['Перенеси звіт на завтра', 'Заплануй тренування', 'Покажи мої завдання', 'Онови нотатку', 'Дай пораду']) assert.equal(addressFormOf(text), 'ty', text);
  for (const text of ['Перенесіть звіт на завтра', 'Заплануйте тренування', 'Покажіть мої завдання', 'Оновіть нотатку', 'Дайте пораду']) assert.equal(addressFormOf(text), 'vy', text);
  // Nouns and past tense that coincide with an imperative are not a signal.
  for (const text of ['Зміни в розкладі', 'Розклади на тиждень', 'Мені видали нове завдання']) assert.equal(addressFormOf(text), undefined, text);
});
