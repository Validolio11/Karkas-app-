import type { AIIntent, PersonalStrategyProfile, StrategyDiscoveryPatch, StrategyDiscoveryTopic, StrategyMemoryPatch } from '../src/types';
import { applyStrategyMemory, readPersonalStrategy } from '../src/utils/personalStrategy';
import { applyDiscoveryTurn, discoveryQuestionForState, isPersonalStrategyReady, missingStrategyDiscoveryTopics, normalizeStrategyDiscovery, STRATEGY_DISCOVERY_TOPICS } from '../src/utils/strategyDiscovery';

export type PersonalChatRoute = 'personal' | 'task_command' | 'workspace_analysis' | 'help';
export interface ConcreteTaskScope {
  operation: 'create' | 'update' | 'delete' | 'timer' | 'steps' | 'tabs' | 'proposal' | 'cancel';
  taskIds: string[];
  createCount?: number;
}
const normalized = (value: string) => value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
const personalConcern = /(?:прокраст|мотивац|motiv|barrier|distraction|procrast|житт|life goal|чому\s+я|why\s+(?:do\s+i|am\s+i)|що\s+мене\s+гальму|що\s+заважа|what\s+(?:holds|stops)\s+me|не\s+можу\s+(?:поча|зосеред|працюва)|i\s+cannot\s+(?:start|focus))/iu;

/** Wishes are personal context; only an actual command can open the ordinary task-operation path. */
export function classifyPersonalChatRequest(prompt: string, intent: AIIntent, tasks: any[], profile?: PersonalStrategyProfile, pendingProposal?: Record<string, any>) {
  const input = normalized(prompt).replace(/^@(plan|analysis|steps)\s*/iu, '').replace(/^(?:привіт|вітаю|hello|hi|hey)[,!:.]?\s+/iu, '');
  const live = tasks.filter(task => task && typeof task.id === 'string' && typeof task.title === 'string');
  const mentioned = (value: string) => {
    const escaped = normalized(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return !!escaped && new RegExp(`(?:^|[^\\p{L}\\p{N}_-])${escaped}(?![\\p{L}\\p{N}_-])`, 'iu').test(input);
  };
  const matchingIds = live.filter(task => mentioned(task.title) || mentioned(task.id)).map(task => task.id);
  const requestPrefix = /^(?:(?:будь\s+ласка|please)[,:]?\s+|(?:можеш|можете|допоможи|допоможіть|can\s+you|could\s+you|help\s+me)\s+)/iu;
  let command = input;
  let requested = false;
  for (let index = 0; index < 3 && requestPrefix.test(command); index++) {
    requested = true;
    command = command.replace(requestPrefix, '');
  }
  // Infinitives are commands only after a direct request, never after a wish such as “хочу”.
  if (requested) {
    const verbs: Record<string, string> = { створити: 'створи', додати: 'додай', змінити: 'зміни', оновити: 'онови', перейменувати: 'перейменуй', видалити: 'видали', прибрати: 'прибери', позначити: 'познач', завершити: 'заверши', відкрити: 'відкрий', повернути: 'поверни', розбити: 'розбий', розділити: 'розділи', запустити: 'запусти', увімкнути: 'увімкни', поставити: 'постав', призупинити: 'призупини', зупинити: 'зупини', вимкнути: 'вимкни', перенести: 'перенеси', запланувати: 'заплануй' };
    command = command.replace(/^([^\s?!.,:;]+)/u, verb => verbs[verb] || verb);
  }
  // Only a wholly unnamed command can use the sole task. An unmatched name
  // (even when there is just one task) must leave scope empty for clarification.
  const unnamedCommand = /^(?:видали|видаліть|прибери|заверши|завершіть|відкрий|поверни|розбий|розділи|запусти|увімкни|призупини|зупини|вимкни|delete|remove|complete|reopen|split|break\s+down|start|pause|stop)\s+(?:(?:це|цей|цю|поточне|поточний|поточну|єдине|the|this|current|only)\s+)*(?:завдання|задачу|таймер|task|timer)(?:\s+(?:для|for)\s+(?:(?:цього|поточного|the|this|current)\s+)?(?:завдання|task))?[.!?]?$/iu.test(command);
  const unnamedTimerCommand = /^(?:(?:додай|додайте|постав|запусти|увімкни)\s+(?:таймер|відлік)(?:\s+на\s+\d+(?:[.,]\d+)?\s*(?:хвилин(?:и|у)?|хв\.?|годин(?:и|у)?|год\.?|секунд(?:и|у)?|сек\.?))?(?:\s+(?:до|для)\s+(?:(?:цього|поточного|єдиного)\s+)?завдання)?|(?:set|add|start|configure)\s+(?:(?:the|this|current|only)\s+)?(?:task\s+)?timer(?:\s+(?:to|for)\s+\d+(?:[.,]\d+)?\s*(?:minutes?|mins?|hours?|seconds?))?(?:\s+for\s+(?:(?:the|this|current|only)\s+)?task)?)[.!?]?$/iu.test(command);
  const unnamedDateCommand = /^(?:(?:перенеси|заплануй|reschedule|schedule|move)\s+(?:(?:це|поточне|єдине|the|this|current|only)\s+)?(?:завдання|task)\s+(?:на|до|on|to|by)\s+(?:завтра|сьогодні|післязавтра|tomorrow|today|\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.\d{2,4})|(?:прибери|видали|remove|clear)\s+(?:дату|дедлайн|термін|date|deadline)\s+(?:(?:для|з|for|from)\s+)?(?:(?:цього|поточного|єдиного|the|this|current|only)\s+)?(?:завдання|task))[.!?]?$/iu.test(command);
  const singleTarget = matchingIds.length ? matchingIds : live.length === 1 && (unnamedCommand || unnamedTimerCommand || unnamedDateCommand) ? [live[0].id] : [];
  const directCalendarPlanning = /^(?:розкладай|розклади|розплануй|сплануй)(?![\p{L}\p{N}_])/iu.test(command)
    && /(?:завдан|задач)/iu.test(command)
    && /(?:сьогодні|завтра|післязавтра|\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.\d{2,4})(?![\p{L}\p{N}_])/iu.test(command);
  if (directCalendarPlanning) return { route: 'task_command' as PersonalChatRoute, scope: { operation: 'update', taskIds: matchingIds } as ConcreteTaskScope };
  const explicit = /^(?:створи|створіть|додай|додайте|зміни|змініть|онови|оновіть|перейменуй|перейменуйте|видали|видаліть|прибери|познач|заверши|завершіть|відкрий|поверни|розбий|розділи|запусти|увімкни|постав|призупини|зупини|вимкни|зменши|збільши|поміняй|перероби|скасуй|перенеси|перенесіть|заплануй|заплануйте|create|add|edit|update|rename|delete|remove|mark|complete|reopen|break\s+down|split|start|pause|stop|set|configure|reduce|increase|change|revise|cancel|reschedule|schedule|move)(?![\p{L}\p{N}_])/iu.test(command);
  const hasPending = pendingProposal && ['tasks', 'tabs', 'taskUpdates', 'taskDeletions'].some(key => Array.isArray(pendingProposal[key]) && pendingProposal[key].length);
  if (hasPending && explicit && /(?:пропозиц|замість|\d+\s*(?:хв|год|min|hour)|proposal|instead|duration|priority|пріоритет)/iu.test(command)) {
    const targetIds = [...(Array.isArray(pendingProposal.taskUpdates) ? pendingProposal.taskUpdates : []), ...(Array.isArray(pendingProposal.taskDeletions) ? pendingProposal.taskDeletions : [])].map((item: any) => item?.id).filter((id: any) => live.some(task => task.id === id));
    return { route: 'task_command' as PersonalChatRoute, scope: { operation: /^(?:скасуй|cancel)(?![\p{L}\p{N}_])/iu.test(command) ? 'cancel' : 'proposal', taskIds: targetIds, createCount: Array.isArray(pendingProposal.tasks) ? pendingProposal.tasks.length : 0 } as ConcreteTaskScope };
  }
  let scope: ConcreteTaskScope | undefined;
  const taskWord = /(?:завдан|задач|task|subtask|підзавдан|підзадач|крок|step)/iu.test(command);
  const timerWord = /(?:таймер|секундомір|відлік|timer|stopwatch|countdown)/iu.test(command);
  const dateField = /(?:дат[ауи]|дедлайн|термін|deadline|due\s+date|planned\s+date)/iu.test(command);
  const calendarHint = /(?:завтра|сьогодні|післязавтра|tomorrow|today|\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.\d{2,4})(?![\p{L}\p{N}_])/iu.test(command);
  if (intent === 'steps' && matchingIds.length === 1) scope = { operation: 'steps', taskIds: matchingIds };
  else if (explicit) {
    if (/^(?:створи|створіть|додай|додайте|create|add)(?![\p{L}\p{N}_])/iu.test(command) && /(?:вкладк|категор|tab|category)/iu.test(command) && !taskWord) scope = { operation: 'tabs', taskIds: [] };
    else if (/^(?:створи|створіть|додай|додайте|create|add)\s+(?:(?:нов[еуії]|новий|a|an|new|the)\s+)*(?:завдання|завдань|задачу|задачі|задач|tasks?)(?![\p{L}\p{N}_])/iu.test(command) && !/(?:підзавдан|підзадач|subtask|крок|step)/iu.test(command)) scope = { operation: 'create', taskIds: [] };
    else if (timerWord) scope = { operation: 'timer', taskIds: singleTarget };
    // Removing a date must never archive the parent task, even if its title is mentioned.
    else if (dateField) scope = { operation: 'update', taskIds: singleTarget };
    else if (/^(?:створи|створіть|додай|додайте|create|add)(?![\p{L}\p{N}_])/iu.test(command) && calendarHint && !matchingIds.length && !/(?:підзавдан|підзадач|subtask|крок|step)/iu.test(command)) scope = { operation: 'create', taskIds: [] };
    else if (/^(?:видали|видаліть|прибери|delete|remove)(?![\p{L}\p{N}_])/iu.test(command) && taskWord && !/(?:підзавдан|підзадач|subtask|крок|step)/iu.test(command)) scope = { operation: 'delete', taskIds: singleTarget };
    else if (taskWord || matchingIds.length) scope = { operation: /(?:розбий|розділи|break\s+down|split|підзавдан|підзадач|subtask|крок|step)/iu.test(command) ? 'steps' : 'update', taskIds: singleTarget };
  }
  if (scope) return { route: 'task_command' as PersonalChatRoute, scope };
  if (intent === 'steps') return { route: 'task_command' as PersonalChatRoute, scope: { operation: 'steps', taskIds: [] } as ConcreteTaskScope };
  if (personalConcern.test(input) || /^(?:я\s+)?(?:хочу|хотів|хотіла|прагну|мрію|i\s+want|i\s+wish|i\s+would\s+like)(?![\p{L}\p{N}_])/iu.test(input)) return { route: 'personal' as PersonalChatRoute };
  if (intent === 'plan' || /(?:план|plan)(?![\p{L}\p{N}_])/iu.test(command) && /^(?:зроби|склади|створи|допоможи|make|create|help)/iu.test(command)) return { route: 'personal' as PersonalChatRoute };
  const discovery = profile ? normalizeStrategyDiscovery(profile) : undefined;
  const pending = discovery?.pendingQuestion;
  const privacyRequest = /(?:не хочу (?:про це|розповідати|обговорювати|відповідати|ділитися)|не готов[аий]* (?:обговорювати|ділитися|розповідати)|особисте|приватн|пропуст(?:имо|ити)|skip (?:this|that)|prefer not|rather not|private|don['’]?t want to (?:share|discuss|answer))/iu;
  const refusalCount = pending ? discovery!.topics[pending.topic].evidence.filter(answer => privacyRequest.test(answer.quote)).length : 0;
  const practicalAnswer = /(?:коли|перед|після|сідаю|боюс|страх|важко|незрозум|маю|можу|не\s+можу|не\s+знаю|when|before|after|afraid|unclear|i\s+have|i\s+can|cannot|can['’]?t)/iu.test(input);
  const ordinaryInformation = /^(?:проаналізуй|аналіз|покажи|analyse|analyze|show|review|audit|поясни|розкажи|explain|tell)(?![\p{L}\p{N}_])/iu.test(input);
  if (intent === 'auto' && !ordinaryInformation && pending && practicalAnswer && !/\?\s*$/.test(input)) return { route: 'personal' as PersonalChatRoute };
  if (intent === 'auto' && !ordinaryInformation && pending && discovery!.topics[pending.topic].status === 'deferred' && refusalCount > 1 && !practicalAnswer && !privacyRequest.test(input)) {
    // Answering our invitation to concrete help must not send the person back into a private interview.
    return { route: 'help' as PersonalChatRoute };
  }
  const workspaceTopic = /(?:завдан|задач|метрик|статист|черг|навантаж|task|metric|statistic|queue|workload)/iu.test(input);
  const personalTopic = /(?:мо[яїює]|мій|мене|мені|сво[їює]|my\s+(?:goal|life|problem)|about\s+me|продуктив|productiv)/iu.test(input);
  if (intent === 'analysis' && personalTopic && !workspaceTopic) return { route: 'personal' as PersonalChatRoute };
  if (/^(?:як|де|що\s+означає|how|where|what\s+does)(?![\p{L}\p{N}_])/iu.test(input) && /(?:додат|кноп|меню|вклад|таймер|завдан|задач|karkas|button|menu|tab|timer|task|setting)/iu.test(input)) return { route: 'help' as PersonalChatRoute };
  if (intent === 'analysis' || /^(?:проаналізуй|аналіз|покажи|analyse|analyze|show|review|audit)(?![\p{L}\p{N}_])/iu.test(input) && /(?:завдан|задач|час|метрик|статист|черг|навантаж|task|time|metric|statistic|queue|workload|workspace)/iu.test(input)) return { route: 'workspace_analysis' as PersonalChatRoute };
  if (!personalTopic && /^(?:що\s+таке|хто|коли|де|як|поясни|розкажи|напиши|переклади|what|who|when|where|how|explain|tell|write|translate)(?![\p{L}\p{N}_])/iu.test(input)) return { route: 'help' as PersonalChatRoute };
  return { route: 'personal' as PersonalChatRoute };
}

/** A model cannot expand a concrete command into a personal plan or unrelated task operations. */
export function constrainOrdinaryChatResponse(parsed: Record<string, any>, route: PersonalChatRoute, scope?: ConcreteTaskScope) {
  if (route === 'personal') return parsed;
  const next = { ...parsed };
  const allowed = new Set(scope?.taskIds || []);
  next.tasks = ['create', 'proposal'].includes(scope?.operation || '') && Array.isArray(parsed.tasks) ? parsed.tasks.slice(0, scope?.createCount ?? 50) : [];
  next.tabs = scope?.operation === 'tabs' && Array.isArray(parsed.tabs) ? parsed.tabs : [];
  next.taskDeletions = ['delete', 'proposal'].includes(scope?.operation || '') && Array.isArray(parsed.taskDeletions) ? parsed.taskDeletions.filter((item: any) => allowed.has(item?.id)) : [];
  next.taskUpdates = ['update', 'timer', 'steps', 'proposal'].includes(scope?.operation || '') && Array.isArray(parsed.taskUpdates)
    ? parsed.taskUpdates.filter((item: any) => allowed.has(item?.id)).map((item: any) => {
      if (scope?.operation === 'timer') return Object.fromEntries(Object.entries(item).filter(([key]) => ['id', 'timerMode', 'countdownDurationSeconds', 'timerAction'].includes(key)));
      if (scope?.operation === 'steps') return Object.fromEntries(Object.entries(item).filter(([key]) => ['id', 'stepList', 'steps'].includes(key)));
      return item;
    }) : [];
  delete next.strategy;
  return next;
}

export const personalGuidanceSystemPolicy = `PERSONAL GUIDANCE POLICY (takes priority over generic task instructions below):
Distinguish a concrete task command from a person's wishes or answer to a getting-to-know-you question. A wish such as wanting a portfolio, freelance income, English or faster typing is personal context, NOT permission to create a plan or tasks.
For PERSONAL_DISCOVERY, first understand motives, actual barriers and available capacity/circumstances, adaptively, one meaningful question at a time. Never rush from goal names to a schedule, commitments, duration estimates or an execution plan. Even a direct request for a personal plan still needs the most important missing clarification. Never infer readiness from an agreed goal, your own ready status, elapsed chat length or a bare yes. Only the app's discovery state and scoped confirmation of its pending understanding summary authorize personal planning.
Concrete CRUD/timer/subtask/help commands and read-only workspace analysis remain available without a personal interview, strictly within the supplied command scope. They do not complete the personal interview or replace an existing strategy.
Respect negation and ambivalence in the person's actual words. Do not substitute your assumptions for motives, effort, mood or life circumstances. No profession assumptions, diagnoses, personality labels, blame, canned praise or generic productivity lecture. Ask about the specific situation, prior attempts and what happens before distraction when relevant. When someone has not started/refuses, ask what happened before suggesting fixes.
Memory updates add grounded observations; facts quote exact user words, interpretations are hypotheses. Never silently change or self-confirm goals. Retain existing useful memory and agreed strategy. Discovery questions, ordinary task commands and metric analysis are not new personal strategies.
Never provide a personal plan via legacy task arrays to bypass discovery. For PERSONAL_DISCOVERY omit all mutations, narrative, nextAction and focusTaskId; return only safe reflection, the next question and discovery evidence/summary.`;

export function fallbackDiscoveryQuestion(topic: string, uk: boolean): string {
  const questions: Record<string, [string, string]> = {
    motivation: ['Що для вас зміниться, якщо ви досягнете цих цілей, і чому це важливо саме зараз?', 'What would reaching these goals change for you, and why does that matter now?'],
    barriers: ['Коли ви востаннє відклали важливу справу, що відбувалося перед тим, як ви переключилися на щось інше?', 'The last time you put off something important, what happened just before you switched to something else?'],
    capacity: ['Які обставини зараз впливають на ваші сили й можливість працювати над цими цілями?', 'What circumstances currently affect your energy and ability to work on these goals?'],
    circumstances: ['Що у вашій теперішній життєвій ситуації найбільше впливає на рух до цих цілей?', 'What in your current life situation most affects progress toward these goals?'],
    attempts: ['Що ви вже пробували, щоб починати й продовжувати важливу роботу, і що з цього допомагало?', 'What have you tried to start and continue important work, and what helped?'],
    direction: ['До якої з ваших цілей ви насамперед хочете рухатися і що вона для вас означає?', 'Which of your goals would you like to work toward first, and what does it mean to you?'],
    goals: ['Що ви хотіли б змінити у своєму житті й чому це для вас важливо?', 'What would you like to change in your life, and why does it matter to you?'],
  };
  return (questions[topic] || questions.barriers)[uk ? 0 : 1];
}

export function safeDiscoveryQuestion(question: unknown): question is string {
  return typeof question === 'string' && question.trim().length > 8 && question.length <= 500
    && (question.match(/\?/g) || []).length === 1 && /\?\s*$/.test(question)
    && /^(?:що|чому|як|коли|які?|яка|яке|котра?|скільки|what|why|how|when|which)(?![\p{L}\p{N}_])/iu.test(question.trim())
    && !/[\r\n]/.test(question) && !/(?:готов|погодж|домов|зобов|commit|agree|ready|план\s*[:—-]|plan\s*[:—-]|\d+\s*[-–]?\s*(?:хв|minutes|min\b)|почни|почніть|почнем|почнете|почнеш|починайте|починай|почнімо|приступ|займіться|займись|працюй|зроби|зробіть|заплануй|завтра|tomorrow|щодня|кожного\s+дня|every\s+day|start\s+with|will\s+you|shall\s+we|let['’]s)/iu.test(question);
}

const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, limit = 2000) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && !!item.trim()).slice(0, 200) : [];
const topic = (value: unknown): value is StrategyDiscoveryTopic => STRATEGY_DISCOVERY_TOPICS.includes(value as StrategyDiscoveryTopic);

/** Reuse account-memory hydration without exposing journal records to the provider. */
export function personalProfileForRequest(value: unknown): PersonalStrategyProfile {
  return readPersonalStrategy({ getItem: () => JSON.stringify(record(value) ? { ...value, version: 1 } : null), setItem: () => {}, removeItem: () => {} }, null);
}

/** Discovery proposals carry observations, never model-authored permissions or a hidden plan. */
function discoveryMemory(value: unknown): StrategyMemoryPatch {
  const raw = record(value) ? value : {};
  const patch: StrategyMemoryPatch = {};
  if (Array.isArray(raw.goals)) patch.goals = raw.goals.filter(record).filter(goal => text(goal.id) && text(goal.title)).slice(0, 50).map(goal => ({
    id: text(goal.id, 120), title: text(goal.title), motive: text(goal.motive), agreed: false, taskIds: strings(goal.taskIds), categoryIds: strings(goal.categoryIds),
  }));
  for (const key of ['facts', 'barriers', 'preferences'] as const) {
    if (Array.isArray(raw[key])) patch[key] = raw[key].filter(record).filter(entry => text(entry.id) && text(entry.text) && ['user', 'hypothesis'].includes(entry.source)).slice(0, 200).map(entry => ({ id: text(entry.id, 120), text: text(entry.text), source: entry.source }));
  }
  const incoming = record(raw.discovery) ? raw.discovery : {};
  const discovery: StrategyDiscoveryPatch = {};
  if (Array.isArray(incoming.answers)) discovery.answers = incoming.answers.filter(record).filter(answer => topic(answer.topic) && ['answered', 'deferred'].includes(answer.status) && text(answer.quote, 8000)).slice(0, 12).map(answer => ({ topic: answer.topic, status: answer.status, quote: text(answer.quote, 8000) }));
  if (Array.isArray(incoming.selectedGoalIds)) discovery.selectedGoalIds = strings(incoming.selectedGoalIds);
  patch.discovery = discovery;
  return patch;
}

function understandingSummary(profile: PersonalStrategyProfile, uk: boolean): string {
  const state = normalizeStrategyDiscovery(profile);
  const titles = state.selectedGoalIds.map(id => profile.goals.find(goal => goal.id === id)?.title).filter(Boolean).join('; ');
  const labels: Partial<Record<StrategyDiscoveryTopic, string>> = uk
    ? { motivation: 'Особистий сенс', circumstances: 'Обставини', barriers: 'Перешкоди', capacity: 'Реальні можливості', attempts: 'Попередні спроби' }
    : { motivation: 'Personal meaning', circumstances: 'Circumstances', barriers: 'Obstacles', capacity: 'Actual capacity', attempts: 'Previous attempts' };
  const observations = new Map<string, string[]>();
  for (const key of ['motivation', 'circumstances', 'barriers', 'capacity', 'attempts'] as const) {
    const answer = state.topics[key];
    const quote = answer.evidence.at(-1)?.quote || '';
    const label = answer.status === 'deferred' ? `${labels[key]} (${uk ? 'залишено приватним' : 'kept private'})` : labels[key]!;
    observations.set(quote, [...(observations.get(quote) || []), label]);
  }
  const concise = (quote: string) => quote.length > 320 ? `${quote.slice(0, 320)}…` : quote;
  return [`${uk ? 'Ваші обрані цілі' : 'Your selected goals'}: ${titles}.`, ...[...observations].map(([quote, names]) => `${names.join(', ')}: «${concise(quote)}»`)].join('\n\n');
}


/** Ignore free-form provider prose and all action containers when interview evidence is incomplete. */
export function sanitizeDiscoveryResponse(parsed: Record<string, any>, profile: PersonalStrategyProfile, userText: string, turnId: string, uk: boolean) {
  const raw = record(parsed.strategy?.memoryPatch) ? parsed.strategy.memoryPatch : parsed.memoryPatch;
  const patch = discoveryMemory(raw);
  const incoming = record(raw?.discovery) ? raw.discovery : {};
  let interviewProfile = profile;
  const clarification = record(incoming.question) ? incoming.question : undefined;
  const previousQuestion = normalizeStrategyDiscovery(profile).pendingQuestion;
  if (clarification && topic(clarification.topic) && safeDiscoveryQuestion(clarification.text) && previousQuestion?.topic === clarification.topic) {
    // A substantive first answer may still need a narrower follow-up on the same topic.
    patch.discovery = { ...patch.discovery, question: { topic: clarification.topic, text: clarification.text.trim() } };
  }
  if (isPersonalStrategyReady(profile) && clarification && topic(clarification.topic) && safeDiscoveryQuestion(clarification.text)) {
    const discovery = normalizeStrategyDiscovery(profile);
    interviewProfile = { ...profile, discovery: { ...discovery, phase: 'exploring', pendingSummary: undefined, pendingQuestion: undefined,
      topics: { ...discovery.topics, [clarification.topic]: { ...discovery.topics[clarification.topic], status: 'unknown' } } } };
  }
  const candidate = applyDiscoveryTurn(applyStrategyMemory(interviewProfile, patch, userText, turnId), { memoryPatch: patch }, userText, turnId);
  const state = normalizeStrategyDiscovery(candidate);
  const missing = missingStrategyDiscoveryTopics(state);
  const needsDirection = !state.selectedGoalIds.length;
  if (!missing.length && !needsDirection) {
    const summary = understandingSummary(candidate, uk);
    const question = uk ? 'Чи правильно я зрозумів вашу ситуацію й ці цілі?' : 'Have I understood your situation and these goals correctly?';
    const fullSummary = `${summary}\n\n${question}`;
    patch.discovery = { ...patch.discovery, summary: fullSummary };
    return { reply: fullSummary, tasks: [], taskUpdates: [], taskDeletions: [], tabs: [], strategy: { status: 'clarifying' as const, question, memoryPatch: patch, actions: [] } };
  }
  const proposed = record(incoming.question) ? incoming.question : undefined;
  const desired = proposed && topic(proposed.topic) && missing.includes(proposed.topic) && safeDiscoveryQuestion(proposed.text) ? proposed : undefined;
  const defaultTopic = state.topics.direction.status === 'answered' && state.topics.barriers.status === 'unknown' ? 'barriers' : missing[0];
  const nextTopic: StrategyDiscoveryTopic = needsDirection && !missing.length ? 'direction' : desired?.topic || defaultTopic;
  const saved = state.pendingQuestion?.turnId && state.pendingQuestion.topic === nextTopic && safeDiscoveryQuestion(state.pendingQuestion.text) ? state.pendingQuestion.text : undefined;
  const question = state.topics[nextTopic].status === 'deferred'
    ? discoveryQuestionForState(state, nextTopic, uk ? 'uk' : 'en')
    : /^(?:не знаю|не впевнен[аий]*|важко сказати|i don['’]?t know|not sure|maybe|можливо)[.!\s]*$/iu.test(userText.trim()) && profile.discovery?.pendingQuestion?.topic === nextTopic
      ? narrowerDiscoveryQuestion(nextTopic, uk)
    : desired?.text?.trim() || saved || (nextTopic === 'capacity' ? discoveryQuestionForState(state, nextTopic, uk ? 'uk' : 'en') : fallbackDiscoveryQuestion(nextTopic, uk));
  patch.discovery = { ...patch.discovery, question: { topic: nextTopic, text: question } };
  const quote = userText.trim().replace(/\s+/gu, ' ').slice(0, 280);
  const describedDirection = state.topics.direction.evidence.some(answer => answer.messageId === turnId);
  const reflection = quote ? `${uk ? (describedDirection ? 'Ви описали бажані зміни' : 'Ви описали свою ситуацію') : (describedDirection ? 'You described the changes you want' : 'You described your situation')}: «${quote}${userText.trim().length > 280 ? '…' : ''}».` : '';
  return { reply: [reflection, question].filter(Boolean).join('\n\n'), tasks: [], taskUpdates: [], taskDeletions: [], tabs: [], strategy: { status: 'getting_to_know' as const, question, memoryPatch: patch, actions: [] } };
}

function narrowerDiscoveryQuestion(topic: StrategyDiscoveryTopic, uk: boolean): string {
  const questions: Record<StrategyDiscoveryTopic, [string, string]> = {
    direction: ['Яку одну конкретну справу ви хотіли б полегшити зараз?', 'Which one concrete task would you like to make easier now?'],
    motivation: ['Що змінилося б у вашому звичайному дні, якби ця справа вдалася?', 'What would change in your ordinary day if this worked out?'],
    barriers: ['Коли ви востаннє відкрили важливу справу й відклали її, що відбулося в ту мить?', 'The last time you opened an important task and put it aside, what happened at that moment?'],
    capacity: ['Який невеликий обсяг роботи зараз був би посильним, з урахуванням відпочинку?', 'What small amount of work feels manageable now, allowing for rest?'],
    circumstances: ['Що у вашому сьогоднішньому дні найбільше впливає на цю справу?', 'What in your day today most affects this task?'],
    attempts: ['Чи був хоча б один випадок, коли почати цю справу було легше?', 'Has there been one occasion when starting this task was easier?'],
  };
  return questions[topic][uk ? 0 : 1];
}

/** Recheck returned context and keep clarifications from silently becoming a new plan. */
export function constrainReadyPersonalResponse(parsed: Record<string, any>, profile: PersonalStrategyProfile, userText: string, turnId: string, uk: boolean) {
  const strategy = record(parsed.strategy) ? { ...parsed.strategy } : {};
  const next: Record<string, any> = { ...parsed, tasks: [], taskUpdates: [], taskDeletions: [], tabs: [] };
  const refused = /(?:не\s+почав|не\s+почала|не\s+зробив|не\s+зробила|не\s+хочу\s+(?:робити|працювати)|я\s+відволік|did\s+not\s+start|didn['’]?t\s+start|did\s+not\s+do|got\s+distracted|don['’]?t\s+want\s+to\s+(?:do|work))/iu.test(userText);
  const reasonGiven = userText.split(/[.!?;,\n]+|\s+(?:але|but)\s+/iu).some(clause => {
    if (/(?:можливо|мабуть|припускаю|не\s+знаю\s+чому|perhaps|maybe|not\s+sure|don['’]?t\s+know\s+why)/iu.test(clause)) return false;
    const grounded = clause.replace(/(?:не\s+(?:(?:дуже|зовсім|аж|так|надто)\s+)*(?:втом\p{L}*|бою\p{L}*|страш\p{L}*|тривож\p{L}*|незрозум\p{L}*)|(?:not|wasn['’]?t|am\s+not|don['’]?t\s+feel)\s+(?:very\s+)?(?:tired|afraid|anxious|unclear))/giu, '');
    return /(?:втом|боюс|страх|незрозум|не\s+знав.*почати|tired|afraid|unclear|didn['’]?t\s+know)/iu.test(grounded)
      || /(?:тому,?\s+що|бо|через|because|due\s+to)\s+\S.{5}/iu.test(grounded.trim());
  });
  if (refused && !reasonGiven) {
    const question = uk ? 'Що відбувалося в той момент, коли ви хотіли почати, але не почали або переключилися на інше?' : 'What was happening when you wanted to start but did not start or switched to something else?';
    next.reply = question;
    next.strategy = { status: 'clarifying', question, actions: [], memoryPatch: { ...strategy.memoryPatch,
      discovery: { question: { topic: 'barriers', text: question } } } };
    return next;
  }
  if (safeDiscoveryQuestion(strategy.question) && !strategy.memoryPatch?.discovery?.question) {
    const questionTopic: StrategyDiscoveryTopic = /(?:скільки|час|сил|енергі|how much|time|energy|capacity)/iu.test(strategy.question) ? 'capacity'
      : /(?:пробува|спроб|допомог|tried|attempt|helped)/iu.test(strategy.question) ? 'attempts'
      : /(?:важлив|сенс|meaning|matter|important)/iu.test(strategy.question) ? 'motivation'
      : /(?:обстав|circumstance|ситуаці[яю]|life situation)/iu.test(strategy.question) ? 'circumstances'
      : /(?:ціл|goal|пріоритет|priority)/iu.test(strategy.question) ? 'direction' : 'barriers';
    strategy.memoryPatch = { ...strategy.memoryPatch, discovery: { ...strategy.memoryPatch?.discovery,
      question: { topic: questionTopic, text: strategy.question } } };
    next.strategy = strategy;
  }
  const candidate = applyDiscoveryTurn(applyStrategyMemory(profile, strategy.memoryPatch, userText, turnId), strategy, userText, turnId);
  if (!isPersonalStrategyReady(candidate)) return sanitizeDiscoveryResponse({ ...next, strategy }, profile, userText, turnId, uk);
  if (parsed.strategy && (strategy.status !== 'ready' || text(strategy.question) || strategy.memoryPatch?.discovery?.question)) {
    next.strategy = { ...strategy, actions: [] };
    for (const key of ['narrative', 'nextAction', 'focusTaskId']) delete next.strategy[key];
  }
  return next;
}
