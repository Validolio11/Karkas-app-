import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyPersonalChatRequest, constrainOrdinaryChatResponse, constrainReadyPersonalResponse, safeDiscoveryQuestion, sanitizeDiscoveryResponse } from './strategyDiscovery';
import { applyStrategyResponse, createPersonalStrategyProfile } from '../src/utils/personalStrategy';
import { continueStrategyDiscovery, normalizeStrategyDiscovery } from '../src/utils/strategyDiscovery';
import { confirmedProfile, discoveryGoal, understandingProfile } from '../src/utils/strategyDiscovery.testHelpers';

const tasks = [{ id: 't1', title: 'English', phase: 'work', done: false }, { id: 't2', title: 'Study', phase: 'work', done: false }];
const early = { reply: 'FORBIDDEN-PLAN: tomorrow 25 minutes', tasks: [{ title: 'FORBIDDEN-TASK' }], tabs: [{ id: 'bad' }], taskUpdates: [{ id: 't1', done: true }], taskDeletions: [{ id: 't2' }], strategy: { status: 'ready', narrative: 'FORBIDDEN-NARRATIVE', nextAction: 'FORBIDDEN-NEXT', focusTaskId: 't1', actions: [{ changes: { done: true } }] } };

test('an unknown named target cannot mutate the sole other task', () => {
  const sole = [tasks[0]];
  for (const prompt of ['Видали завдання Biology', 'Запусти таймер Biology', 'Розбий завдання Biology на кроки', 'Delete task Biology']) {
    const route = classifyPersonalChatRequest(prompt, 'auto', sole);
    assert.deepEqual(route.scope?.taskIds, [], prompt);
    const constrained = constrainOrdinaryChatResponse({ taskUpdates: [{ id: 't1', title: 'Wrong', timerAction: 'start', steps: 3 }], taskDeletions: [{ id: 't1' }] }, route.route, route.scope);
    assert.deepEqual(constrained.taskUpdates, [], prompt);
    assert.deepEqual(constrained.taskDeletions, [], prompt);
  }
  assert.deepEqual(classifyPersonalChatRequest('Видали це завдання', 'auto', sole).scope?.taskIds, ['t1']);
  assert.deepEqual(classifyPersonalChatRequest('Видали це завдання', 'auto', tasks).scope?.taskIds, []);
  for (const prompt of ['Додай таймер на 25 хвилин до завдання', 'Set task timer to 40 minutes']) {
    assert.deepEqual(classifyPersonalChatRequest(prompt, 'auto', sole).scope?.taskIds, ['t1']);
    assert.deepEqual(classifyPersonalChatRequest(prompt, 'auto', tasks).scope?.taskIds, []);
  }
});

test('concrete Ukrainian commands and polite infinitives stay available during discovery', () => {
  for (const [prompt, operation] of [['Привіт, додай завдання English', 'create'], ['Можеш додати завдання English?', 'create'], ['Можеш будь ласка запустити таймер English?', 'timer'], ['Додай таймер на 25 хвилин до завдання English', 'timer'], ['Зміни назву завдання English', 'update'], ['Видали завдання English', 'delete'], ['Розбий завдання English на кроки', 'steps']] as const) {
    const result = classifyPersonalChatRequest(prompt, 'auto', tasks);
    assert.equal(result.route, 'task_command', prompt);
    assert.equal(result.scope?.operation, operation, prompt);
    if (operation !== 'create') assert.deepEqual(result.scope?.taskIds, ['t1'], prompt);
  }
});

test('wishlists, explicit personal plan and personal analysis remain personal; workspace analysis/help remain ordinary', () => {
  for (const prompt of ['Хочу портфоліо, фриланс, англійську та швидкий друк', 'Хочу стати архітектором', 'Хочу додати більше часу для ігор', 'Зроби мені план', 'Чому я не можу почати працювати?']) assert.equal(classifyPersonalChatRequest(prompt, 'auto', tasks).route, 'personal', prompt);
  assert.equal(classifyPersonalChatRequest('Мої проблеми з продуктивністю', 'analysis', tasks).route, 'personal');
  assert.equal(classifyPersonalChatRequest('Audit the workspace', 'auto', tasks).route, 'workspace_analysis');
  assert.equal(classifyPersonalChatRequest('Проаналізуй поточні завдання', 'analysis', tasks).route, 'workspace_analysis');
  assert.equal(classifyPersonalChatRequest('Як запустити таймер?', 'auto', tasks).route, 'help');
  assert.equal(classifyPersonalChatRequest('Поясни синтаксис JavaScript', 'auto', tasks).route, 'help');
  assert.deepEqual(classifyPersonalChatRequest('English', 'steps', tasks).scope?.taskIds, ['t1']);
  assert.deepEqual(classifyPersonalChatRequest('Невідоме завдання', 'steps', tasks).scope?.taskIds, []);
});

test('early malicious plans and commitment questions are replaced without losing safe memory', () => {
  const profile = createPersonalStrategyProfile();
  const userText = 'Хочу більше свободи вибору роботи.';
  const result = sanitizeDiscoveryResponse({ ...early, strategy: { ...early.strategy, memoryPatch: { goals: [discoveryGoal], facts: [{ id: 'f', text: userText, source: 'user' }], discovery: {
    answers: [{ topic: 'direction', status: 'answered', quote: userText }], selectedGoalIds: ['g'], question: { topic: 'barriers', text: 'Чи готовий ти завтра працювати над портфоліо?' }, summary: 'FORBIDDEN-SUMMARY',
  } } } }, profile, userText, 'wishlist', true);
  assert.doesNotMatch(JSON.stringify(result), /FORBIDDEN|готовий|завтра/);
  for (const key of ['tasks', 'tabs', 'taskUpdates', 'taskDeletions'] as const) assert.deepEqual(result[key], []);
  assert.deepEqual(result.strategy.actions, []);
  assert.equal(result.strategy.memoryPatch?.facts?.[0].text, userText);
  assert.equal(result.strategy.memoryPatch?.discovery?.question?.topic, 'barriers');
  assert.equal((result.reply.match(/\?/g) || []).length, 1);
  const persisted = applyStrategyResponse(profile, result.strategy, userText, 'wishlist');
  assert.equal(persisted.discovery?.topics.direction.status, 'answered');
  assert.equal(persisted.discovery?.topics.capacity.status, 'unknown');
  assert.equal(persisted.goals[0].agreed, false);
});

test('questions must inquire rather than smuggle a schedule, commitment or multiple questions', () => {
  for (const question of ['Чи готовий ти завтра працювати над портфоліо?', 'Коли завтра почнемо працювати?', 'Як почнете перший 25-хвилинний блок?', 'Що заважає? Скільки часу є?', 'What time tomorrow will you commit to the plan?', 'What is hard?\nStart with English.']) assert.equal(safeDiscoveryQuestion(question), false, question);
  assert.equal(safeDiscoveryQuestion('Що відбувається перед тим, як ви переключаєтеся на гру?'), true);
});

test('not knowing stays unknown and narrows the pending question rather than repeating it', () => {
  const profile = continueStrategyDiscovery(confirmedProfile());
  const original = profile.discovery!.pendingQuestion!.text;
  const result = sanitizeDiscoveryResponse({ memoryPatch: { discovery: { answers: [{ topic: 'barriers', quote: 'Не знаю', status: 'answered' }], question: { topic: 'barriers', text: original } } } }, profile, 'Не знаю', 'unknown', true);
  assert.notEqual(result.strategy.question, original);
  assert.match(result.strategy.question!, /в ту мить/);
  const persisted = applyStrategyResponse(profile, result.strategy, 'Не знаю', 'unknown');
  assert.equal(persisted.discovery?.topics.barriers.status, 'unknown');
  assert.equal(persisted.discovery?.phase, 'exploring');
});

test('privacy produces an optional practical alternative and never a plan or confirmation', () => {
  const profile = continueStrategyDiscovery(confirmedProfile());
  const quote = 'Не хочу про це розповідати, це приватне';
  const result = sanitizeDiscoveryResponse({ ...early, memoryPatch: { discovery: { answers: [{ topic: 'barriers', status: 'deferred', quote }] } } }, profile, quote, 'privacy', true);
  assert.match(result.strategy.question!, /Якщо зручно/);
  assert.doesNotMatch(JSON.stringify(result), /FORBIDDEN/);
  const persisted = applyStrategyResponse(profile, result.strategy, quote, 'privacy');
  assert.equal(persisted.discovery?.topics.barriers.status, 'deferred');
  assert.equal(persisted.discovery?.pendingSummary, undefined);
  assert.equal(classifyPersonalChatRequest('Коли сідаю до справи, боюсь незрозумілого першого кроку', 'auto', tasks, persisted).route, 'personal');
  const repeated = applyStrategyResponse(persisted, { memoryPatch: { discovery: { answers: [{ topic: 'barriers', status: 'deferred', quote }] } } }, quote, 'privacy-2');
  assert.equal(classifyPersonalChatRequest('Коли сідаю до справи, боюсь незрозумілого першого кроку', 'auto', tasks, repeated).route, 'personal');
  assert.equal(classifyPersonalChatRequest('English', 'auto', tasks, repeated).route, 'help');
  for (const prompt of ['Покажи статистику після виконання завдань', 'Проаналізуй коли виконувались завдання']) {
    for (const intent of ['auto', 'analysis'] as const) assert.equal(classifyPersonalChatRequest(prompt, intent, tasks, repeated).route, 'workspace_analysis');
  }
});

test('the saved understanding summary includes the visible scoped confirmation and no provider plan', () => {
  const profile = understandingProfile();
  const result = sanitizeDiscoveryResponse(early, profile, 'Так, але спершу хочу перевірити розуміння', 'summary-again', true);
  assert.equal(result.strategy.memoryPatch?.discovery?.summary, result.reply);
  assert.match(result.reply, /Чи правильно я зрозумів/);
  assert.doesNotMatch(JSON.stringify(result), /FORBIDDEN/);
  const persisted = applyStrategyResponse(profile, result.strategy, 'Так, але спершу хочу перевірити розуміння', 'summary-again');
  assert.equal(persisted.discovery?.phase, 'confirming');
  assert.equal(persisted.discovery?.pendingSummary?.text, result.reply);
});

test('ordinary commands cannot carry autonomous plan fields and stay within target and operation', () => {
  const response = { reply: 'Proposal', tasks: [{ title: 'Extra' }], taskUpdates: [{ id: 't1', timerAction: 'start', title: 'Unrequested' }, { id: 't2', timerAction: 'start' }], strategy: { status: 'ready', nextAction: 'Replace saved plan', actions: [{ type: 'create' }] } };
  const result = constrainOrdinaryChatResponse(response, 'task_command', { operation: 'timer', taskIds: ['t1'] });
  assert.deepEqual(result.taskUpdates, [{ id: 't1', timerAction: 'start' }]);
  assert.deepEqual(result.tasks, []);
  assert.equal(result.strategy, undefined);
});

test('pending proposal revisions preserve concrete proposals without opening personal planning', () => {
  const pending = { tasks: [{ title: 'References' }], taskUpdates: [{ id: 't1', timerMode: 'countdown', countdownDurationSeconds: 1500 }] };
  const route = classifyPersonalChatRequest('Зменши час у пропозиції до 10 хвилин', 'auto', tasks, undefined, pending);
  assert.equal(route.route, 'task_command');
  assert.equal(route.scope?.operation, 'proposal');
  const result = constrainOrdinaryChatResponse({ tasks: [{ title: 'References' }, { title: 'Unrelated goal' }], taskUpdates: [{ id: 't1', countdownDurationSeconds: 600 }, { id: 't2', done: true }] }, route.route, route.scope);
  assert.equal(result.tasks.length, 1);
  assert.deepEqual(result.taskUpdates, [{ id: 't1', countdownDurationSeconds: 600 }]);
  const cancel = classifyPersonalChatRequest('Скасуй пропозицію', 'auto', tasks, undefined, pending);
  assert.deepEqual(constrainOrdinaryChatResponse(pending, cancel.route, cancel.scope).tasks, []);
});

test('ready personal refusal with no reason asks before adapting; scope changes re-open discovery', () => {
  const profile = confirmedProfile();
  const refusal = constrainReadyPersonalResponse(early, profile, 'Я не почав працювати', 'refusal', true);
  assert.match(refusal.reply, /Що відбувалося/);
  assert.deepEqual(refusal.strategy.actions, []);
  const result = constrainReadyPersonalResponse({ ...early, strategy: { ...early.strategy, memoryPatch: { goals: [{ ...discoveryGoal, title: 'Зовсім інша ціль' }] } } }, profile, 'Хочу змінити ціль', 'changed', true);
  assert.doesNotMatch(JSON.stringify(result), /FORBIDDEN/);
  assert.deepEqual(result.strategy.actions, []);
  assert.notEqual(normalizeStrategyDiscovery(applyStrategyResponse(profile, result.strategy, 'Хочу змінити ціль', 'changed')).phase, 'ready');
});

test('a grounded answer can receive a deeper follow-up on the pending topic before summary', () => {
  const profile = continueStrategyDiscovery(confirmedProfile());
  const quote = 'Коли сідаю починати справу, боюсь незрозумілого першого кроку.';
  const question = 'Що саме в цьому першому кроці здається незрозумілим?';
  const response = sanitizeDiscoveryResponse({ memoryPatch: { discovery: { answers: [{ topic: 'barriers', quote, status: 'answered' }], question: { topic: 'barriers', text: question } } } }, profile, quote, 'deeper', true);
  assert.equal(response.strategy.question, question);
  assert.equal(response.strategy.memoryPatch?.discovery?.summary, undefined);
  const updated = applyStrategyResponse(profile, response.strategy, quote, 'deeper');
  assert.equal(updated.discovery?.topics.barriers.status, 'unknown');
  assert.equal(updated.discovery?.topics.barriers.evidence.at(-1)?.quote, quote);
  assert.equal(updated.discovery?.pendingSummary, undefined);
});

test('negated and speculative labels do not explain a refused start', () => {
  const profile = confirmedProfile();
  for (const message of ['Я не почав, але не втомився', 'Я не почав, мабуть через втому', 'I did not start, but I was not tired', 'Я не почав, бо не знаю чому']) {
    const result = constrainReadyPersonalResponse(early, profile, message, message, true);
    assert.match(result.reply, /Що відбувалося/, message);
    assert.deepEqual(result.strategy.actions, [], message);
  }
  const valid = constrainReadyPersonalResponse({ reply: 'Reduce work', strategy: { status: 'ready', actions: [], nextAction: 'Rest first' } }, profile, 'Я не почав, бо не маю часу через роботу', 'known-reason', true);
  assert.equal(valid.reply, 'Reduce work');
});
