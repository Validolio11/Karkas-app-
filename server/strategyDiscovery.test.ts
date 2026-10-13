import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyPersonalChatRequest, constrainOrdinaryChatResponse, constrainReadyPersonalResponse, discoveryAddressContext, discoveryAddressFor, safeDiscoveryQuestion, sanitizeDiscoveryResponse } from './strategyDiscovery';
import { applyStrategyResponse, createPersonalStrategyProfile } from '../src/utils/personalStrategy';
import { continueStrategyDiscovery, normalizeStrategyDiscovery } from '../src/utils/strategyDiscovery';
import { confirmedProfile, discoveryGoal, understandingProfile } from '../src/utils/strategyDiscovery.testHelpers';
import { discoveryQuestionText, safeDiscoveryInsight, safeDiscoveryReflection } from './strategyDiscovery';
import { addressFormOf, PRACTICAL_HELP_OFFER } from '../src/utils/strategyDiscovery';

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

test('calendar edits remain concrete during discovery and date removal never deletes the task', () => {
  for (const prompt of ['Перенеси завдання English на завтра', 'Прибери дедлайн завдання English', 'Видали дату завдання English']) {
    const route = classifyPersonalChatRequest(prompt, 'auto', tasks);
    assert.equal(route.route, 'task_command', prompt);
    assert.equal(route.scope?.operation, 'update', prompt);
    assert.deepEqual(route.scope?.taskIds, ['t1'], prompt);
    const response = constrainOrdinaryChatResponse({ taskUpdates: [{ id: 't1', deadlineDate: null }], taskDeletions: [{ id: 't1' }] }, route.route, route.scope);
    assert.deepEqual(response.taskDeletions, [], prompt);
    assert.deepEqual(response.taskUpdates, [{ id: 't1', deadlineDate: null }], prompt);
  }
  assert.deepEqual(classifyPersonalChatRequest('Перенеси завдання на завтра', 'auto', [tasks[0]]).scope?.taskIds, ['t1']);
  assert.deepEqual(classifyPersonalChatRequest('Перенеси завдання на завтра', 'auto', tasks).scope?.taskIds, []);
  assert.deepEqual(classifyPersonalChatRequest('Перенеси завдання Biology на завтра', 'auto', [tasks[0]]).scope?.taskIds, []);
  assert.equal(classifyPersonalChatRequest('Додай English на завтра', 'auto', []).scope?.operation, 'create');
});

test('wishlists, plan requests and personal analysis are personal only in discovery mode; workspace analysis/help remain ordinary', () => {
  for (const prompt of ['Хочу портфоліо, фриланс, англійську та швидкий друк', 'Хочу стати архітектором', 'Хочу додати більше часу для ігор', 'Зроби мені план', 'Чому я не можу почати працювати?']) {
    assert.equal(classifyPersonalChatRequest(prompt, 'auto', tasks, undefined, undefined, { discoveryMode: true }).route, 'personal', prompt);
    // Outside the explicit mode the same message gets ordinary coaching, never the interview.
    assert.equal(classifyPersonalChatRequest(prompt, 'auto', tasks).route, 'general', prompt);
  }
  assert.equal(classifyPersonalChatRequest('Мій план', 'plan', tasks).route, 'general');
  assert.equal(classifyPersonalChatRequest('Мої проблеми з продуктивністю', 'analysis', tasks, undefined, undefined, { discoveryMode: true }).route, 'personal');
  assert.equal(classifyPersonalChatRequest('Мої проблеми з продуктивністю', 'analysis', tasks).route, 'workspace_analysis');
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
  const discovering = { discoveryMode: true };
  assert.equal(classifyPersonalChatRequest('Коли сідаю до справи, боюсь незрозумілого першого кроку', 'auto', tasks, persisted, undefined, discovering).route, 'personal');
  const repeated = applyStrategyResponse(persisted, { memoryPatch: { discovery: { answers: [{ topic: 'barriers', status: 'deferred', quote }] } } }, quote, 'privacy-2');
  assert.equal(classifyPersonalChatRequest('Коли сідаю до справи, боюсь незрозумілого першого кроку', 'auto', tasks, repeated, undefined, discovering).route, 'personal');
  assert.equal(classifyPersonalChatRequest('English', 'auto', tasks, repeated, undefined, discovering).route, 'help');
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

const workTasks = [
  { id: 'banners', title: 'Зробити анімовані банери для рекламної кампанії (6 розмірів)', done: false },
  { id: 'auth', title: 'Виправити баг з авторизацією в React-додатку клієнта', done: false },
  { id: 'intro', title: 'Анімувати інтро-заставку для YouTube-каналу клієнта', done: false },
  { id: 'reel', title: 'Змонтувати шоурил моушн-дизайну 2026', done: false },
  { id: 'site', title: 'Переписати сайт-портфоліо на Next.js', done: true },
  { id: 'call', title: 'Зідзвонитися з клієнтом щодо брендингу', done: false },
];

test('a distinctive inflected word from a title targets that task', () => {
  const steps = classifyPersonalChatRequest('Розбий завдання з банерами на підзавдання', 'auto', workTasks);
  assert.deepEqual(steps.scope, { operation: 'steps', taskIds: ['banners'] });
  const constrained = constrainOrdinaryChatResponse({ taskUpdates: [{ id: 'banners', stepList: ['Розміри', 'Анімація'] }] }, steps.route, steps.scope);
  assert.deepEqual(constrained.taskUpdates, [{ id: 'banners', stepList: ['Розміри', 'Анімація'] }]);
  assert.deepEqual(classifyPersonalChatRequest('Зміни завдання про баг з авторизацією', 'auto', workTasks).scope, { operation: 'update', taskIds: ['auth'] });
  assert.deepEqual(classifyPersonalChatRequest('Розбий «шоурил» на кроки', 'auto', workTasks).scope?.taskIds, ['reel']);
  assert.deepEqual(classifyPersonalChatRequest('Онови сайт на Next', 'auto', workTasks).scope, { operation: 'update', taskIds: ['site'] });
  assert.deepEqual(classifyPersonalChatRequest('Банери', 'steps', workTasks).scope?.taskIds, ['banners']);
});

test('the exact full title remains the strongest target signal', () => {
  assert.deepEqual(classifyPersonalChatRequest('Видали завдання «Переписати сайт-портфоліо на Next.js»', 'auto', workTasks).scope, { operation: 'delete', taskIds: ['site'] });
  assert.deepEqual(classifyPersonalChatRequest('Розбий завдання Змонтувати шоурил моушн-дизайну 2026 на кроки', 'auto', workTasks).scope?.taskIds, ['reel']);
});

test('all my tasks targets every live task, and completing all skips finished ones', () => {
  const route = classifyPersonalChatRequest('Видали всі мої завдання', 'auto', workTasks);
  assert.deepEqual(route.scope, { operation: 'delete', taskIds: workTasks.map(task => task.id) });
  const deletions = workTasks.map(task => ({ id: task.id }));
  assert.deepEqual(constrainOrdinaryChatResponse({ taskDeletions: deletions }, route.route, route.scope).taskDeletions, deletions);
  assert.deepEqual(classifyPersonalChatRequest('Delete all my tasks', 'auto', workTasks).scope?.taskIds, workTasks.map(task => task.id));
  assert.deepEqual(classifyPersonalChatRequest('Заверши всі завдання', 'auto', workTasks).scope?.taskIds, workTasks.filter(task => !task.done).map(task => task.id));
  // A named subset wins over the quantifier; steps never fan out to every task.
  assert.deepEqual(classifyPersonalChatRequest('Видали всі завдання з банерами', 'auto', workTasks).scope?.taskIds, ['banners']);
  assert.deepEqual(classifyPersonalChatRequest('Розбий всі завдання на кроки', 'auto', workTasks).scope?.taskIds, []);
});

test('ambiguous or generic partial names never pick a wrong single task', () => {
  for (const prompt of ['Розбий завдання з анімацією на кроки', 'Розбий завдання для клієнта на кроки', 'Розбий завдання для YouTube і банерів на кроки', 'Видали завдання клієнта']) {
    const route = classifyPersonalChatRequest(prompt, 'auto', workTasks);
    assert.deepEqual(route.scope?.taskIds, [], prompt);
    assert.deepEqual(constrainOrdinaryChatResponse({ taskUpdates: [{ id: 'banners', steps: 3 }], taskDeletions: [{ id: 'intro' }] }, route.route, route.scope).taskUpdates, [], prompt);
  }
  // Several distinctly named tasks may share a non-single-target scope.
  assert.deepEqual(classifyPersonalChatRequest('Видали завдання для YouTube і з банерами', 'auto', workTasks).scope?.taskIds.slice().sort(), ['banners', 'intro']);
  // A word shared by several titles is not distinctive.
  const reports = [{ id: 'r1', title: 'Написати звіт за вересень' }, { id: 'r2', title: 'Написати звіт за жовтень' }];
  assert.deepEqual(classifyPersonalChatRequest('Видали завдання зі звітом', 'auto', reports).scope?.taskIds, []);
  assert.deepEqual(classifyPersonalChatRequest('Видали завдання про жовтневий звіт', 'auto', reports).scope?.taskIds, ['r2']);
  // A partial match cannot turn a new item into an edit, and a command verb cannot match a title verb.
  assert.equal(classifyPersonalChatRequest('Додай зустріч щодо брендингу на завтра', 'auto', workTasks).scope?.operation, 'create');
  assert.deepEqual(classifyPersonalChatRequest('Видали завдання з банерами', 'auto', [...workTasks, { id: 'files', title: 'Видалити старі файли' }]).scope?.taskIds, ['banners']);
});

test('free conversation falls back to the general route instead of personal discovery', () => {
  for (const prompt of ['Як мені зосередитись?', 'Дякую, це допомогло', 'Сьогодні важкий день', 'Thanks, that helped']) {
    assert.equal(classifyPersonalChatRequest(prompt, 'auto', tasks).route, 'general', prompt);
  }
  // Personal signals open the interview only in the explicit discovery mode.
  for (const prompt of ['Я не почав працювати', 'Підбери наступні дії для моєї цілі', 'Хочу більше часу для сім’ї', 'Чому я відкладаю справи?', 'В мене жахлива прокрастинація, не можу почати працювати']) {
    assert.equal(classifyPersonalChatRequest(prompt, 'auto', tasks).route, 'general', prompt);
    assert.equal(classifyPersonalChatRequest(prompt, 'auto', tasks, undefined, undefined, { discoveryMode: true }).route, 'personal', prompt);
  }
  // In discovery mode a clear command is still a command for that turn.
  assert.equal(classifyPersonalChatRequest('Розбий завдання English на кроки', 'auto', tasks, undefined, undefined, { discoveryMode: true }).route, 'task_command');
  // Commands keep priority over the general fallback.
  assert.equal(classifyPersonalChatRequest('Видали завдання English', 'auto', tasks).route, 'task_command');
  const general = constrainOrdinaryChatResponse(early, 'general');
  for (const key of ['tasks', 'tabs', 'taskUpdates', 'taskDeletions'] as const) assert.deepEqual(general[key], []);
  assert.equal(general.strategy, undefined);
  assert.equal(general.reply, early.reply);
});

test('in discovery mode a reply to the visible discovery question or pending summary continues discovery', () => {
  const discovering = { discoveryMode: true };
  assert.equal(classifyPersonalChatRequest('Мабуть, втома', 'auto', tasks, createPersonalStrategyProfile()).route, 'general');
  assert.equal(classifyPersonalChatRequest('Мабуть, втома', 'auto', tasks, createPersonalStrategyProfile(), undefined, { ...discovering, answeringDiscovery: true }).route, 'personal');
  // Outside the mode even a reply to an old discovery question is ordinary conversation.
  assert.equal(classifyPersonalChatRequest('Мабуть, втома', 'auto', tasks, createPersonalStrategyProfile(), undefined, { answeringDiscovery: true }).route, 'general');
  // A question or an ordinary information request is not an answer.
  assert.equal(classifyPersonalChatRequest('А що ти маєш на увазі?', 'auto', tasks, createPersonalStrategyProfile(), undefined, { ...discovering, answeringDiscovery: true }).route, 'general');
  assert.equal(classifyPersonalChatRequest('Так', 'auto', tasks, understandingProfile(), undefined, discovering).route, 'personal');
  assert.equal(classifyPersonalChatRequest('Так', 'auto', tasks, understandingProfile()).route, 'general');
});

test('conversational lead-ins and the first-person plural still open the command path', () => {
  for (const [prompt, operation, taskIds] of [
    ['Давай розбий інтро на дуже маленькі кроки, по 15-20 хвилин', 'steps', ['intro']],
    ['Давайте розбити інтро на кроки', 'steps', ['intro']],
    ['Давай розіб’ємо шоурил на кроки', 'steps', ['reel']],
    ["Ну а можеш розбити інтро на кроки?", 'steps', ['intro']],
    ['Так, додай крок до шоурилу', 'steps', ['reel']],
    ['Ок, перенеси завдання з банерами на завтра', 'update', ['banners']],
    ['Добре, заплануймо', undefined, undefined],
    ['Зроби так, щоб інтро було розбите на кроки', 'steps', ['intro']],
  ] as const) {
    const route = classifyPersonalChatRequest(prompt, 'auto', workTasks);
    if (!operation) { assert.notEqual(route.route, 'task_command', prompt); continue; }
    assert.equal(route.route, 'task_command', prompt);
    assert.deepEqual(route.scope, { operation, taskIds }, prompt);
  }
  // A lead-in alone or a suggestion to think is conversation, not a command.
  for (const prompt of ['Добре', 'Давай подумаємо, як краще почати', 'Ну, не знаю']) assert.equal(classifyPersonalChatRequest(prompt, 'auto', workTasks).route, 'general', prompt);
});

test('a yes to a concrete offered change carries it into a scoped proposal; a doubt or refusal does not', () => {
  const offer = 'Ось план:\n1. Відкрити проєкт — 15 хв\n2. Зібрати референси — 20 хв\n\nЯ можу додати ці пункти підзадачами до задачі «Анімувати інтро-заставку…» на завтра?';
  for (const prompt of ['Так, додай', 'Так', 'Давай', 'Ок', 'Добре, давай', 'Yes, go ahead']) {
    const route = classifyPersonalChatRequest(prompt, 'auto', workTasks, undefined, undefined, { previousAssistantText: offer });
    assert.equal(route.route, 'task_command', prompt);
    assert.deepEqual(route.scope, { operation: 'proposal', taskIds: ['intro'] }, prompt);
    assert.equal(route.acceptedOffer, true, prompt);
  }
  // Other offer forms name their target too.
  const split = classifyPersonalChatRequest('Так', 'auto', workTasks, undefined, undefined, { previousAssistantText: 'Хочеш, я розіб’ю шоурил на кроки по 15 хвилин?' });
  assert.deepEqual(split.scope, { operation: 'proposal', taskIds: ['reel'] });
  // A yes naming its own target keeps the concrete scope and still carries the offered plan.
  const named = classifyPersonalChatRequest('Так, розбий шоурил на кроки', 'auto', workTasks, undefined, undefined, { previousAssistantText: offer });
  assert.deepEqual(named.scope, { operation: 'steps', taskIds: ['reel'] });
  assert.equal(named.acceptedOffer, true);
  // Without a named task only new tasks can be proposed.
  assert.deepEqual(classifyPersonalChatRequest('Так', 'auto', workTasks, undefined, undefined, { previousAssistantText: 'Створити окреме завдання для звуку?' }).scope, { operation: 'proposal', taskIds: [] });
  for (const prompt of ['Ні, не треба', 'Давай потім', 'Так, а скільки це займе?', 'Не зараз', 'No, later']) {
    const route = classifyPersonalChatRequest(prompt, 'auto', workTasks, undefined, undefined, { previousAssistantText: offer });
    assert.notEqual(route.route, 'task_command', prompt);
    assert.equal(route.acceptedOffer, undefined, prompt);
  }
  // No offer, a choice between options, or the discovery mode: a yes is not consent to a change.
  for (const previousAssistantText of ['Гарного дня!', 'Перенести інтро на завтра чи на п’ятницю?', 'Що для вас зараз найважливіше?']) {
    assert.equal(classifyPersonalChatRequest('Так', 'auto', workTasks, undefined, undefined, { previousAssistantText }).route, 'general', previousAssistantText);
  }
  assert.equal(classifyPersonalChatRequest('Так', 'auto', workTasks, undefined, undefined, { previousAssistantText: offer, discoveryMode: true }).route, 'personal');
});

test('a yes to an offer that names no task targets the running timer, the recently mentioned task or the only active one', () => {
  // Live scenario: a timer was started for the intro two turns earlier, then the person got tired.
  const timing = workTasks.map(task => task.id === 'intro' ? { ...task, timerRunning: true } : { ...task, timerRunning: false });
  const offer = 'Зупинись і дай собі спокій… Хочеш, я поставлю таймер завдання на паузу, щоб ти міг закрити всі програми й піти відпочити?';
  const previousUserTexts = ['Запусти таймер на 25 хвилин для інтро', 'Все, я видихся, голова вже не варить. Що робити?'];
  const yes = classifyPersonalChatRequest('Так', 'auto', timing, undefined, undefined, { previousAssistantText: offer, previousUserText: previousUserTexts[1], previousUserTexts });
  assert.equal(yes.route, 'task_command');
  assert.equal(yes.acceptedOffer, true);
  assert.deepEqual(yes.scope, { operation: 'proposal', taskIds: ['intro'] });
  // The pause the model proposes stays within the scope; nothing is applied here.
  assert.deepEqual(constrainOrdinaryChatResponse({ taskUpdates: [{ id: 'intro', timerAction: 'pause' }] }, yes.route, yes.scope).taskUpdates, [{ id: 'intro', timerAction: 'pause' }]);
  // Even without the earlier messages the running timer identifies the task.
  assert.deepEqual(classifyPersonalChatRequest('Так', 'auto', timing, undefined, undefined, { previousAssistantText: offer }).scope?.taskIds, ['intro']);
  // Several running timers: all of them, still only a proposal.
  const two = timing.map(task => task.id === 'reel' ? { ...task, timerRunning: true } : task);
  assert.deepEqual(classifyPersonalChatRequest('Так', 'auto', two, undefined, undefined, { previousAssistantText: offer, previousUserTexts }).scope?.taskIds.slice().sort(), ['intro', 'reel']);
  // A refusal or hesitation is never consent; the discovery mode is unchanged.
  for (const prompt of ['Ні', 'Ні, не треба', 'Не зараз', 'Потім']) {
    const route = classifyPersonalChatRequest(prompt, 'auto', timing, undefined, undefined, { previousAssistantText: offer, previousUserTexts });
    assert.notEqual(route.route, 'task_command', prompt);
    assert.equal(route.acceptedOffer, undefined, prompt);
  }
  assert.equal(classifyPersonalChatRequest('Так', 'auto', timing, undefined, undefined, { previousAssistantText: offer, previousUserTexts, discoveryMode: true }).route, 'personal');
  // No running timer: the task mentioned in the recent conversation.
  assert.deepEqual(classifyPersonalChatRequest('Так', 'auto', workTasks, undefined, undefined, { previousAssistantText: offer, previousUserTexts }).scope?.taskIds, ['intro']);
  // A steps offer without a name: the most recently mentioned task.
  const stepsOffer = 'Хочеш, я розіб’ю це завдання на кроки по 15 хвилин?';
  assert.deepEqual(classifyPersonalChatRequest('Так', 'auto', workTasks, undefined, undefined, { previousAssistantText: stepsOffer, previousUserTexts: ['Що з банерами?', 'А як почати шоурил?'] }).scope?.taskIds, ['reel']);
  // Nothing mentioned: the only active task, otherwise no target.
  const single = [workTasks[2], workTasks[4]];
  assert.deepEqual(classifyPersonalChatRequest('Так', 'auto', single, undefined, undefined, { previousAssistantText: stepsOffer }).scope?.taskIds, ['intro']);
  assert.deepEqual(classifyPersonalChatRequest('Так', 'auto', workTasks, undefined, undefined, { previousAssistantText: stepsOffer }).scope?.taskIds, []);
  // An offer of a new task borrows no target.
  assert.deepEqual(classifyPersonalChatRequest('Так', 'auto', single, undefined, undefined, { previousAssistantText: 'Створити окреме завдання для звуку?', previousUserTexts }).scope?.taskIds, []);
});

test('ordinary conversation exposes a proposal scope of the tasks named now or in the previous turn', () => {
  const now = classifyPersonalChatRequest('Як мені швидше зробити інтро?', 'auto', workTasks);
  assert.equal(now.route, 'general');
  assert.deepEqual(now.proposalScope, { operation: 'proposal', taskIds: ['intro'] });
  assert.deepEqual(classifyPersonalChatRequest('Дякую', 'auto', workTasks, undefined, undefined, { previousUserText: 'Що мені робити з банерами?' }).proposalScope?.taskIds, ['banners']);
  assert.deepEqual(classifyPersonalChatRequest('Дякую', 'auto', workTasks, undefined, undefined, { previousAssistantText: 'Почніть зі «Змонтувати шоурил моушн-дизайну 2026».' }).proposalScope?.taskIds, ['reel']);
  // Nothing named: only new tasks may be proposed; commands and discovery carry no proposal scope.
  assert.deepEqual(classifyPersonalChatRequest('Сьогодні важкий день', 'auto', workTasks).proposalScope, { operation: 'proposal', taskIds: [] });
  assert.equal(classifyPersonalChatRequest('Розбий інтро на кроки', 'auto', workTasks).proposalScope, undefined);
  assert.equal(classifyPersonalChatRequest('Сьогодні важкий день', 'auto', workTasks, undefined, undefined, { discoveryMode: true }).proposalScope, undefined);
});

test('natural discovery questions are accepted while plans, schedules and several questions stay rejected', () => {
  for (const question of ['А що саме відбувається перед тим, як ви відкладаєте справу?', 'Розумію. Що найчастіше заважає почати?', 'Is there a moment in the day when starting feels easier?']) {
    assert.equal(safeDiscoveryQuestion(question), true, question);
  }
  for (const question of ['', '   ?', 'Що заважає? Скільки часу є?', `${'Дуже довге питання '.repeat(30)}?`, 'Розумію.\nЩо заважає?', 'Чи готовий ти завтра працювати над портфоліо?', 'No question here.']) {
    assert.equal(safeDiscoveryQuestion(question), false, question);
  }
});

const freelancer = 'Я моушн-дизайнер на фрілансі, в мене жахлива прокрастинація, відкриваю After Effects і замість роботи гортаю YouTube';

test('discovery replies never echo the whole message; the model reflection is one short sentence in its own words', () => {
  const plain = sanitizeDiscoveryResponse({ memoryPatch: { discovery: {} } }, createPersonalStrategyProfile(), freelancer, 'echo', true);
  assert.doesNotMatch(plain.reply, /Ви описали|гортаю YouTube/);
  const reflection = 'Схоже, найважче — дотягнути до старту, поки дедлайн не підтисне.';
  const reflected = sanitizeDiscoveryResponse({ reflection, memoryPatch: { discovery: {} } }, createPersonalStrategyProfile(), freelancer, 'reflection', true);
  assert.ok(reflected.reply.startsWith(reflection));
  assert.equal((reflected.reply.match(/\?/g) || []).length, 1);
  assert.equal(safeDiscoveryReflection('Звучить так, ніби «гортаю YouTube» стало звичним колом.', freelancer), 'Звучить так, ніби «гортаю YouTube» стало звичним колом.');
  for (const candidate of [`Ви описали свою ситуацію: «${freelancer}».`, freelancer, 'Почни завтра з 25 хвилин роботи над проєктом.', 'Розумію. Це виснажує.', 'Що саме тебе зупиняє?', 'Ти молодець, що це помітив.', 'Тобі варто почати з розкадровки.']) {
    assert.equal(safeDiscoveryReflection(candidate, freelancer), undefined, candidate);
  }
  // The reflection keeps the person's form of address.
  assert.equal(safeDiscoveryReflection('Вам, здається, найважче саме почати.', 'Слухай, мені важко почати', 'ty'), undefined);
});

test('a fallback question quotes at most a short key phrase of the person and skips the canned acknowledgement', () => {
  const profile = continueStrategyDiscovery(confirmedProfile());
  const result = sanitizeDiscoveryResponse({ memoryPatch: { discovery: {} } }, profile, freelancer, 'grounded', true);
  assert.match(result.reply, /^Ви пишете: «в мене жахлива прокрастинація»\. /);
  assert.doesNotMatch(result.reply, /After Effects/);
  assert.equal(result.strategy.memoryPatch?.discovery?.question?.topic, 'barriers');
  assert.equal((result.reply.match(/\?/g) || []).length, 1);
});

test('app-written discovery text follows the person’s ти or ви', () => {
  const ty = sanitizeDiscoveryResponse({ memoryPatch: { discovery: {} } }, createPersonalStrategyProfile(), 'Слухай, хочу нарешті перестати все відкладати', 'ty', true,
    { history: [{ role: 'user', content: '[12.10 16:25] Привіт, допоможи розібратися з прокрастинацією' }] });
  assert.equal(addressFormOf(ty.reply), 'ty');
  const vy = sanitizeDiscoveryResponse({ memoryPatch: { discovery: {} } }, createPersonalStrategyProfile(), 'Скажіть, як мені перестати все відкладати', 'vy', true);
  assert.equal(addressFormOf(vy.reply), 'vy');
  // A model question in the other form is replaced by the app's own question in the person's form.
  const mixed = sanitizeDiscoveryResponse({ memoryPatch: { discovery: { question: { topic: 'direction', text: 'Що ви хотіли б змінити насамперед?' } } } }, createPersonalStrategyProfile(), 'Слухай, хочу менше відкладати', 'mixed', true);
  assert.equal(addressFormOf(mixed.strategy.question!), 'ty');
  const refusal = constrainReadyPersonalResponse({ reply: 'x' }, confirmedProfile(), 'Я не почав, слухай', 'refusal-ty', true);
  assert.match(refusal.reply, /^Що відбувалося/);
  assert.doesNotMatch(refusal.reply, /(?<![\p{L}])ви(?![\p{L}])/u);
});

test('the question validator accepts natural questions and still rejects plans, schedules and commitments', () => {
  for (const question of ['Що відбувається в ту мить, коли ти відкриваєш порожній композишн?', 'Що ти зробив минулого разу, коли дедлайн уже підтискав?', 'Що зазвичай відкладається на завтра і чому саме це?',
    'Коли ти кажеш собі «зроби це зараз», що відбувається далі?', 'What have you already tried when a project felt too big?', 'Які зобов’язання зараз забирають найбільше сил?', 'Що відбувається під час підготовки до нового проєкту?']) {
    assert.equal(safeDiscoveryQuestion(question), true, question);
  }
  for (const question of ['Спробуєш завтра відкрити проєкт на 10 хвилин?', 'Почни з розкадровки, добре?', 'План: розкадровка, потім анімація. Згода?', 'Ти готовий щодня працювати по годині?', 'Почему ты откладываешь?', 'Давай о 9 сядеш за таймлайн?', 'Shall we start with the storyboard?']) {
    assert.equal(safeDiscoveryQuestion(question), false, question);
  }
  assert.equal(discoveryQuestionText('Звучить виснажливо.\nЩо відбувається, коли ти сідаєш за таймлайн?'), 'Звучить виснажливо. Що відбувається, коли ти сідаєш за таймлайн?');
  assert.equal(discoveryQuestionText('- Розкадровка\n- Анімація\nЩо обереш?'), undefined);
});

test('after two interview questions a reply adds one grounded insight, or offers practical help once', () => {
  const base = continueStrategyDiscovery(confirmedProfile());
  const profile = { ...base, discovery: { ...base.discovery!, pendingQuestion: { id: 'question:t2~q2', turnId: 't2', topic: 'barriers' as const, text: 'Що відбувається перед тим, як ви відкладаєте справу?' } } };
  const answer = 'Коли відкриваю порожній композишн, мене накриває і я йду гортати стрічку';
  const insight = 'Коли старт здається величезним, іноді допомагає відкрити проєкт лише для того, щоб на нього подивитися.';
  const withInsight = sanitizeDiscoveryResponse({ insight, memoryPatch: { discovery: {} } }, profile, answer, 't3', true);
  assert.ok(withInsight.reply.includes(insight));
  assert.notEqual(withInsight.strategy.question, PRACTICAL_HELP_OFFER.uk);
  assert.match(applyStrategyResponse(profile, withInsight.strategy, answer, 't3').discovery!.pendingQuestion!.id, /~q3$/);
  // An unsafe insight is dropped; without one the app offers practical help instead of a fourth question.
  assert.equal(safeDiscoveryInsight('Працюй щодня по 25 хвилин за планом.', answer), undefined);
  const offered = sanitizeDiscoveryResponse({ insight: 'Створи завдання на завтра о 9:00.', memoryPatch: { discovery: {} } }, profile, answer, 't3', true);
  assert.equal(offered.strategy.question, PRACTICAL_HELP_OFFER.uk);
  assert.ok(offered.reply.endsWith(PRACTICAL_HELP_OFFER.uk));
  const afterOffer = applyStrategyResponse(profile, offered.strategy, answer, 't3');
  assert.match(afterOffer.discovery!.pendingQuestion!.id, /^offer:t3/);
  // Declining continues the interview, and the offer is not repeated.
  const declined = sanitizeDiscoveryResponse({ memoryPatch: { discovery: {} } }, afterOffer, 'Давай ще трохи розберемося', 't4', true);
  assert.notEqual(declined.strategy.question, PRACTICAL_HELP_OFFER.uk);
  assert.match(applyStrategyResponse(afterOffer, declined.strategy, 'Давай ще трохи розберемося', 't4').discovery!.pendingQuestion!.id, /:offered$/);
  const later = sanitizeDiscoveryResponse({ memoryPatch: { discovery: {} } }, applyStrategyResponse(afterOffer, declined.strategy, 'Давай ще трохи розберемося', 't4'), answer, 't5', true);
  assert.notEqual(later.strategy.question, PRACTICAL_HELP_OFFER.uk);
});

test('one address resolver serves every chat route: current message, then recent user messages, "ви" only without a signal', () => {
  const fresh = createPersonalStrategyProfile();
  const history = [
    { role: 'user', content: '[13.10 09:00] Допоможи' },
    { role: 'assistant', content: 'Що ви хотіли б змінити?' },
    { role: 'user', content: 'Слухай, що мені робити' },
  ];
  // The live case: the person writes with "ти"; the assistant's own "ви" is not a signal.
  assert.equal(discoveryAddressFor(fresh, 'Так, давай', history), 'ty');
  assert.equal(discoveryAddressFor(fresh, 'Я фрілансер', history), 'ty');
  assert.equal(discoveryAddressFor(fresh, 'Перенеси звіт на завтра', []), 'ty');
  assert.equal(discoveryAddressFor(fresh, 'Скажіть, що мені робити', history), 'vy', 'the current message decides');
  assert.equal(discoveryAddressFor(fresh, 'Я фрілансер', []), 'vy');
  assert.equal(discoveryAddressFor(undefined, 'Я фрілансер', [{ role: 'assistant', content: 'Слухай, ти молодець' }]), 'vy', 'assistant messages are ignored');
  assert.equal(discoveryAddressFor(undefined, 'Покажи мої завдання', 'not a history'), 'ty');
});

test('the ADDRESS FORM line covers ordinary chat replies and asks for gender-neutral ти', () => {
  const ty = discoveryAddressContext('ty', true, 'chat');
  assert.match(ty, /^ADDRESS FORM .*"ти" throughout the reply/);
  assert.match(ty, /gender is unknown/);
  assert.match(ty, /тобі хотілося б/);
  assert.match(discoveryAddressContext('vy', true, 'chat'), /"ви" throughout the reply/);
  assert.match(discoveryAddressContext('ty', true), /"ти" in every field \(reflection, insight, question\)/);
  assert.equal(discoveryAddressContext('ty', false, 'chat'), 'ADDRESS FORM: English; no special form.');
});
