import type { AIIntent, PersonalStrategyProfile, StrategyDiscoveryPatch, StrategyDiscoveryTopic, StrategyMemoryPatch } from '../src/types';
import { applyStrategyMemory, readPersonalStrategy } from '../src/utils/personalStrategy';
import { addressFormOf, applyDiscoveryTurn, detectDiscoveryAddress, discoveryEvidenceTexts, discoveryQuestionForState, discoveryQuestionStreak, discoveryQuestionsEquivalent, isDiscoveryRepetitionComplaint, isPersonalStrategyReady, mentionsDiscoveryTopic, missingStrategyDiscoveryTopics, normalizeStrategyDiscovery, PRACTICAL_HELP_OFFER, STRATEGY_DISCOVERY_TOPICS, type DiscoveryAddress } from '../src/utils/strategyDiscovery';
import { lastChangeOffer } from './temporalResponseGuard';
import { hasExplicitTimeRange, pendingRevisionTargets, type PendingProposalRevision } from './pendingProposalRevision';

export type PersonalChatRoute = 'personal' | 'task_command' | 'workspace_analysis' | 'help' | 'general';
export interface ConcreteTaskScope {
  operation: 'create' | 'update' | 'delete' | 'timer' | 'steps' | 'tabs' | 'proposal' | 'cancel';
  taskIds: string[];
  createCount?: number;
  /** A requested clock window must survive the timer-field scope filter. */
  allowSchedule?: boolean;
  /** Only an explicit retrospective correction may replace recorded work. */
  allowRecordedWork?: true;
}
export function requestedRecordedWorkCorrection(prompt: string): boolean {
  return /(?:забув|забула|забули)\s+(?:(?:його|її|таймер)\s+)?(?:включити|увімкнути|запустити)|(?:вже\s+)?(?:відпрацював|відпрацювала|працював|працювала)\s+\d|(?:зарахуй|зарахуйте|запиши|запишіть)\s+\d+(?:[.,]\d+)?\s*(?:годин|год|хвилин|хв)\p{L}*\s+роботи|(?:виправ|зміни|встанови|онови)\s+(?:(?:записаний|витрачений|відпрацьований|фактичний)\s+час)|forgot\s+to\s+(?:start|turn\s+on)\s+(?:the\s+)?timer|(?:set|change|correct|update)\s+(?:(?:the|my)\s+)?(?:recorded|spent|logged)\s+time|(?:record|log)\s+\d+(?:[.,]\d+)?\s*(?:hours?|minutes?|mins?)\s+(?:of\s+)?work/iu.test(prompt);
}
const normalized = (value: string) => value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
// A reported refusal or unexplained non-start belongs to the personal path, which asks why before adapting.
export const refusedStart = /(?:не\s+почав|не\s+почала|не\s+зробив|не\s+зробила|не\s+хочу\s+(?:робити|працювати)|я\s+відволік|did\s+not\s+start|didn['’]?t\s+start|did\s+not\s+do|got\s+distracted|don['’]?t\s+want\s+to\s+(?:do|work))/iu;
const personalGoalReference = /(?:мо[яїює]\p{L}*|сво[яїює]\p{L}*|my)\s+(?:ціл|мет[аиуі]|мрі|стратегі|goal|dream|strategy)/iu;
const personalConcern = /(?:прокраст|мотивац|motiv|barrier|distraction|procrast|житт|life goal|чому\s+я|why\s+(?:do\s+i|am\s+i)|що\s+мене\s+гальму|що\s+заважа|what\s+(?:holds|stops)\s+me|не\s+можу\s+(?:поча|зосеред|працюва)|i\s+cannot\s+(?:start|focus))/iu;

// Generic words never name a task; command verbs are listed so “видали” cannot match a title such as “Видалити …”.
const genericWords = new Set(`для про або але так все всі усі всіх усіх мої моє мій моя моїх мого свої своє свій своя цей ця це цю ці цього цієї того той та які яка яке який
  щодо після перед через також тільки ще уже вже його її їх нам нас вас мені мене тут там коли як що чи щоб від під над при між без біля
  крок кроки кроків кроком етапи етапів пункти справа справу справи зробити зроби зробіть робити треба потрібно хочу будь ласка можеш можете допоможи допоможіть
  створи створіть створити додай додайте додати зміни змініть змінити онови оновіть оновити перейменуй перейменуйте перейменувати видали видаліть видалити
  прибери прибрати познач позначити заверши завершіть завершити відкрий відкрити поверни повернути розбий розбити розділи розділити запусти запустити
  увімкни увімкнути постав поставити призупини призупинити зупини зупинити вимкни вимкнути зменши зменшити збільши збільшити поміняй поміняти перероби переробити
  скасуй скасувати перенеси перенесіть перенести заплануй заплануйте запланувати розклади розкладай розплануй сплануй назву назва назві опис дату дата дедлайн термін
  таймер таймера відлік пріоритет час хвилин хвилини годин години сьогодні завтра післязавтра новий нове нову нові нового виконане виконаним виконаною виконані готове
  клієнт клієнта клієнтом клієнту клієнтів the for and with from into onto that this these those all every each mine our your task tasks subtask subtasks step steps
  item items please can you could help make new set add create edit update rename delete remove mark complete completed done reopen break down split start pause stop
  configure reduce increase change revise cancel reschedule schedule move timer date deadline today tomorrow minutes hours title name client робота роботи зарахуй зарахуйте запиши запишіть record log work`.split(/\s+/u));
const titleWords = (value: string) => [...new Set((value.toLocaleLowerCase().replace(/['’ʼ]/gu, '')
  .replace(/\d{4}-\d{2}-\d{2}|\d{1,2}[.:]\d{1,2}(?:[.:]\d{2,4})?/gu, ' ').match(/[\p{L}\p{N}]+/gu) || [])
  .filter(word => word.length >= 3 && !genericWords.has(word) && !/^(?:під)?(?:завдан|задач)/u.test(word)))];
// Inflection-tolerant: a shared stem of 4+ characters leaving at most a 3-character ending on the shorter word (банерами ↔ банери).
const sameStem = (a: string, b: string) => {
  if (a === b) return true;
  let common = 0;
  while (common < a.length && common < b.length && a[common] === b[common]) common++;
  return common >= 4 && common >= Math.min(a.length, b.length) - 3;
};

/**
 * Partial names: a task counts only when the prompt uses a word no other task title shares;
 * quoted text, when present, is the only name searched. best is the unique top scorer, if any.
 */
function partiallyNamedTasks(prompt: string, tasks: any[]) {
  const quoted = [...prompt.matchAll(/[«"“„]([^«»"“”„]{2,})[»"”“]/gu)].map(match => match[1]).join(' ');
  const asked = titleWords(quoted || prompt);
  const titles = tasks.map(task => titleWords(task.title));
  const scored = tasks.map((task, index) => {
    let score = 0;
    let distinctive = false;
    for (const word of asked) {
      if (!titles[index].some(title => sameStem(word, title))) continue;
      const shared = titles.filter(other => other.some(title => sameStem(word, title))).length;
      score += 1 / shared;
      distinctive = distinctive || shared === 1;
    }
    return { id: task.id as string, score, distinctive };
  }).filter(entry => entry.distinctive).sort((a, b) => b.score - a.score);
  const unique = scored.length === 1 || scored.length > 1 && scored[0].score - scored[1].score > 1e-9;
  return { ids: scored.map(entry => entry.id), best: unique ? [scored[0].id] : [] };
}

export interface PersonalChatClassification {
  route: PersonalChatRoute;
  /** task_command only: the operation and targets the command or accepted offer allows. */
  scope?: ConcreteTaskScope;
  /** Conversational routes: proposals the person may explicitly ask for or agree to — tasks named now or in the previous turn, otherwise new tasks only. */
  proposalScope?: ConcreteTaskScope;
  /** The person agreed to the concrete change offered in the previous assistant reply. */
  acceptedOffer?: boolean;
  pendingRevision?: PendingProposalRevision;
}

export interface PersonalChatRequestOptions {
  /** App-derived: the client replied to the visible discovery question or to the understanding summary. */
  answeringDiscovery?: boolean;
  /** App-derived: the explicit «Поглибити знайомство» mode. Only it opens the discovery interview. */
  discoveryMode?: boolean;
  /** The assistant reply directly before this message; its change offer can be accepted with a yes. */
  previousAssistantText?: string;
  /** The person's previous message; tasks it named stay in the proposal scope of this turn. */
  previousUserText?: string;
  /** The person's recent messages before this one, oldest first (about three); unnamed commands and accepted offers can resolve their target there. */
  previousUserTexts?: string[];
}

// What an accepted offer that names no task is about, for inferring its target.
const timerOfferTopic = /(?:таймер|пауз|зупин|відлік|секундомір|timer|pause|stop|countdown|stopwatch)/iu;
const timerStopTopic = /(?:пауз|зупин|вимкн|стоп|pause|stop|halt)/iu;
const timerStartTopic = /(?:запуст|увімкн|старт|почн|start|resume|run)/iu;
const stepsOfferTopic = /(?:крок|підзавдан|підзадач|пункт|розби|розділ|виконан|познач|заверш|step|subtask|split|break|done|complete|finish|mark)/iu;
// "Створити окреме завдання для звуку?" proposes new tasks only; it never borrows a target.
const createOfferTopic = /(?:створ\p{L}*|додат\p{L}*|додам|додамо|create|add)\s+(?:(?:\p{L}+\s+){0,2})?(?:завдан|задач|tasks?(?![\p{L}])|їх(?![\p{L}])|them(?![\p{L}]))/iu;

// Conversational lead-ins never change the meaning of the command after them (“Так, додай…”, “Ок, розбий…”).
const conversationalLeadIn = /^(?:ну|ок|окей|окай|добре|гаразд|так|ага|угу|а|тоді|ok|okay|yes|yeah|yep|sure|alright|so|then)(?:\s*[,!.:]\s*|\s+)/iu;
// A direct request: an infinitive after it is a command (“Давай розбити…”, “Let's split…”).
const requestPrefix = /^(?:(?:будь\s+ласка|please)[,:]?\s+|(?:можеш|можете|допоможи|допоможіть|давай|давайте|can\s+you|could\s+you|would\s+you|will\s+you|help\s+me|let['’]?s|go\s+ahead\s+and)\s+)/iu;
// “Зроби так, щоб інтро було розбите на кроки” asks for a change without an imperative verb.
const changeRequestPrefix = /^(?:зроби|зробіть|make\s+it\s+so)\s+(?:так[,]?\s+)?(?:щоб|that)\s+/iu;
// The first-person plural (“давай розіб'ємо”, “додамо крок”) is a command too.
const pluralCommandVerbs: Record<string, string> = {
  розібємо: 'розбий', розбиймо: 'розбий', додамо: 'додай', додаймо: 'додай', створимо: 'створи', створімо: 'створи', змінимо: 'зміни', змінімо: 'зміни',
  оновимо: 'онови', перейменуємо: 'перейменуй', видалимо: 'видали', видалімо: 'видали', приберемо: 'прибери', позначимо: 'познач', завершимо: 'заверши',
  відкриємо: 'відкрий', повернемо: 'поверни', розділимо: 'розділи', запустимо: 'запусти', запустімо: 'запусти', увімкнемо: 'увімкни', поставимо: 'постав',
  призупинимо: 'призупини', зупинимо: 'зупини', вимкнемо: 'вимкни', перенесемо: 'перенеси', перенесімо: 'перенеси', заплануємо: 'заплануй', зменшимо: 'зменши',
  збільшимо: 'збільши', поміняємо: 'поміняй', переробимо: 'перероби', скасуємо: 'скасуй', розкладемо: 'розклади', розплануємо: 'розплануй', сплануємо: 'сплануй',
};
// A yes to an offered change, optionally with a short verb (“Так, додай”); a doubt or refusal never is.
const affirmativeReply = /^(?:так|ага|угу|давай(?:те)?|ок|окей|окай|добре|гаразд|звісно|звичайно|авжеж|згоден|згодна|погоджуюсь|погоджуюся|можна|yes|yeah|yep|yup|sure|ok(?:ay)?|alright|go\s+ahead|please\s+do|do\s+it|let['’]?s\s+do\s+it)(?![\p{L}\p{N}_])/iu;
const doubtfulReply = /(?:^|[^\p{L}])(?:ні|нє|не\s+треба|не\s+потрібно|не\s+зараз|не\s+варто|не\s+додавай|не\s+змінюй|потім|пізніше|згодом|подумаю|no|nope|not\s+now|later|don['’]?t|do\s+not|wait)(?![\p{L}])/iu;

/**
 * Wishes are personal context; only an actual command or a yes to an offered change opens the
 * task-operation path. The discovery interview runs only in the explicit discovery mode; every
 * other message is ordinary conversation (general, help or workspace analysis) that may still
 * propose changes the person asks for, within proposalScope.
 */
export function classifyPersonalChatRequest(prompt: string, intent: AIIntent, tasks: any[], profile?: PersonalStrategyProfile, pendingProposal?: Record<string, any>, options: PersonalChatRequestOptions = {}): PersonalChatClassification {
  const input = normalized(prompt).replace(/^@(plan|analysis|steps)\s*/iu, '').replace(/^(?:привіт|вітаю|hello|hi|hey)[,!:.]?\s+/iu, '');
  const live = tasks.filter(task => task && typeof task.id === 'string' && typeof task.title === 'string');
  const discoveryMode = options.discoveryMode === true;
  const mentioned = (value: string) => {
    const escaped = normalized(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return !!escaped && new RegExp(`(?:^|[^\\p{L}\\p{N}_-])${escaped}(?![\\p{L}\\p{N}_-])`, 'iu').test(input);
  };
  // An exact title or id is the strongest signal and keeps its previous semantics.
  const exactIds = live.filter(task => mentioned(task.title) || mentioned(task.id)).map(task => task.id);
  let command = input;
  let requested = false;
  let changeRequested = false;
  for (let index = 0; index < 4; index++) {
    if (changeRequestPrefix.test(command)) { changeRequested = true; command = command.replace(changeRequestPrefix, ''); }
    else if (requestPrefix.test(command)) { requested = true; command = command.replace(requestPrefix, ''); }
    else if (conversationalLeadIn.test(command)) command = command.replace(conversationalLeadIn, '');
    else break;
  }
  command = command.replace(/^([^\s?!.,:;]+)/u, verb => pluralCommandVerbs[verb.replace(/['’ʼ]/gu, '')] || verb);
  // Infinitives are commands only after a direct request, never after a wish such as “хочу”.
  if (requested) {
    const verbs: Record<string, string> = { створити: 'створи', додати: 'додай', змінити: 'зміни', оновити: 'онови', перейменувати: 'перейменуй', видалити: 'видали', прибрати: 'прибери', позначити: 'познач', завершити: 'заверши', відкрити: 'відкрий', повернути: 'поверни', розбити: 'розбий', розділити: 'розділи', запустити: 'запусти', увімкнути: 'увімкни', поставити: 'постав', призупинити: 'призупини', зупинити: 'зупини', вимкнути: 'вимкни', перенести: 'перенеси', запланувати: 'заплануй' };
    command = command.replace(/^([^\s?!.,:;]+)/u, verb => verbs[verb] || verb);
  }
  const partial = exactIds.length ? undefined : partiallyNamedTasks(command, live);
  // “Всі мої завдання” covers every live task (unfinished ones when completing); results stay proposals for Apply.
  const everyTask = /(?:^|[^\p{L}\p{N}_])(?:всі|усі|все|всіх|усіх|all|every|each)\s+(?:(?:мої|свої|наявні|поточні|активні|ці|my|the|current|active|these|of\s+my|of\s+the)\s+)*(?:завдання|завдань|задачі|задач|tasks?)(?![\p{L}\p{N}_])/iu.test(command);
  const completing = /^(?:заверши|завершіть|познач|complete|mark)(?![\p{L}\p{N}_])/iu.test(command);
  const matchingIds = exactIds.length ? exactIds : partial!.ids.length ? partial!.ids : everyTask ? live.filter(task => !completing || !task.done).map(task => task.id) : [];
  // Tasks this message actually names; “all tasks” never widens a conversational proposal scope.
  const namedNow: string[] = exactIds.length ? exactIds : partial!.ids;
  // Only a wholly unnamed command can use the sole task. An unmatched name
  // (even when there is just one task) must leave scope empty for clarification.
  const unnamedCommand = /^(?:видали|видаліть|прибери|заверши|завершіть|відкрий|поверни|розбий|розділи|запусти|увімкни|призупини|зупини|вимкни|delete|remove|complete|reopen|split|break\s+down|start|pause|stop)\s+(?:(?:це|цей|цю|поточне|поточний|поточну|єдине|the|this|current|only)\s+)*(?:завдання|задачу|таймер|task|timer)(?:\s+(?:для|for)\s+(?:(?:цього|поточного|the|this|current)\s+)?(?:завдання|task))?[.!?]?$/iu.test(command);
  // A reason explains the command, but must not be mistaken for a task name.
  const commandWithoutReason = command.split(/\s+(?:бо|тому\s+що|оскільки|because)\s+/iu)[0].replace(/[,\s]+$/u, '');
  const allowRecordedWork = requestedRecordedWorkCorrection(command);
  const recordedWorkCommand = allowRecordedWork && /^(?:зарахуй|зарахуйте|запиши|запишіть|виправ|зміни|встанови|онови|record|log|set|change|correct|update)(?![\p{L}\p{N}_])/iu.test(command);
  const unnamedRecordedWorkCommand = /^(?:(?:зарахуй|зарахуйте|запиши|запишіть)\s+\d+(?:[.,]\d+)?\s*(?:годин(?:и|у)?|год\.?|хвилин(?:и|у)?|хв\.?)\s+роботи|(?:record|log)\s+\d+(?:[.,]\d+)?\s*(?:hours?|minutes?|mins?)\s+(?:of\s+)?work)[.!?]?$/iu.test(commandWithoutReason);
  const unnamedTimerCommand = /^(?:(?:додай|додайте|постав|запусти|увімкни|зміни|змініть|онови|оновіть|поміняй|зменши|збільши)\s+(?:(?:цей|поточний|єдиний)\s+)?(?:таймер|відлік|секундомір)(?:\s+(?:на|до)\s+\d+(?:[.,]\d+)?\s*(?:хвилин(?:и|у)?|хв\.?|годин(?:и|у)?|год\.?|секунд(?:и|у)?|сек\.?))?(?:\s+(?:до|для)\s+(?:(?:цього|поточного|єдиного)\s+)?завдання)?|(?:set|add|start|configure|change|update|reduce|increase)\s+(?:(?:the|this|current|only)\s+)?(?:task\s+)?timer(?:\s+(?:to|for)\s+\d+(?:[.,]\d+)?\s*(?:minutes?|mins?|hours?|seconds?))?(?:\s+for\s+(?:(?:the|this|current|only)\s+)?task)?)[.!?]?$/iu.test(commandWithoutReason);
  const unnamedDateCommand = /^(?:(?:перенеси|заплануй|reschedule|schedule|move)\s+(?:(?:це|поточне|єдине|the|this|current|only)\s+)?(?:завдання|task)\s+(?:на|до|on|to|by)\s+(?:завтра|сьогодні|післязавтра|tomorrow|today|\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.\d{2,4})|(?:прибери|видали|remove|clear)\s+(?:дату|дедлайн|термін|date|deadline)\s+(?:(?:для|з|for|from)\s+)?(?:(?:цього|поточного|єдиного|the|this|current|only)\s+)?(?:завдання|task))[.!?]?$/iu.test(command);
  const singleTarget = matchingIds.length ? matchingIds : live.length === 1 && (unnamedCommand || unnamedTimerCommand || unnamedDateCommand) ? [live[0].id] : [];
  // Steps and timers need one target: a partial name must single out one task, and “all tasks” never does.
  const oneTarget = exactIds.length || !matchingIds.length ? singleTarget : partial!.best;
  const directCalendarPlanning = /^(?:розкладай|розклади|розплануй|сплануй)(?![\p{L}\p{N}_])/iu.test(command)
    && /(?:завдан|задач)/iu.test(command)
    && /(?:сьогодні|завтра|післязавтра|\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.\d{2,4})(?![\p{L}\p{N}_])/iu.test(command);
  if (directCalendarPlanning) return { route: 'task_command', scope: { operation: 'update', taskIds: matchingIds } };
  const explicit = recordedWorkCommand || changeRequested || /^(?:створи|створіть|додай|додайте|зміни|змініть|онови|оновіть|перейменуй|перейменуйте|видали|видаліть|прибери|познач|заверши|завершіть|відкрий|поверни|розбий|розділи|запусти|увімкни|постав|призупини|зупини|вимкни|зменши|збільши|поміняй|перероби|скасуй|перенеси|перенесіть|заплануй|заплануйте|create|add|edit|update|rename|delete|remove|mark|complete|reopen|break\s+down|split|start|pause|stop|set|configure|reduce|increase|change|revise|cancel|reschedule|schedule|move)(?![\p{L}\p{N}_])/iu.test(command);
  const newTaskCreation = /^(?:створи|створіть|додай|додайте|create|add)\s+(?:(?:ще|також|одне|один|нов[еуії]|новий|a|an|new|the|another|also|more)\s+)*(?:завдання|завдань|задачу|задачі|задач|tasks?)(?![\p{L}\p{N}_])/iu.test(command)
    && !/(?:підзавдан|підзадач|subtask|крок|step)/iu.test(command);
  const hasPending = pendingProposal && ['tasks', 'tabs', 'taskUpdates', 'taskDeletions'].some(key => Array.isArray(pendingProposal[key]) && pendingProposal[key].length);
  if (hasPending && explicit) {
    // Cancelling the whole draft must name the proposal. “Скасуй анімацію” or
    // “Скасуй це” cannot silently cancel its other pending tasks.
    const wholeDraftCancellation = /^(?:скасуй|скасуйте|cancel)\s+(?:(?:цю|поточну|останню|підготовлену|the|this|current|pending)\s+)?(?:пропозицію|чернетку|proposal|draft)[.!?]*$/iu.test(command);
    if (wholeDraftCancellation) return { route: 'task_command', scope: { operation: 'cancel', taskIds: [] } };
    const draftReference = /(?:^|[^\p{L}\p{N}_])(?:(?:у|в|до|з|із|цю|цієї|поточну|поточній|підготовлену|підготовленій|останню|останніх)\s+(?:(?:цій|поточній|підготовленій)\s+)?(?:пропозиц|чернетк)|(?:in|to|of|this|the|pending|current)\s+(?:(?:the|this|pending|current)\s+)?(?:proposal|draft))/iu.test(command)
      || /^(?:зміни|онови|перероби|change|revise|update)\s+(?:пропозицію|чернетку|proposal|draft)(?![\p{L}])/iu.test(command);
    const deictic = /(?:до\s+цього|до\s+цієї|у\s+цьому|в\s+цьому|для\s+цього|цьому\s+завдан\p{L}*|цього\s+завдан\p{L}*|це\s+завдання|this|that|these)(?![\p{L}\p{N}_])/iu.test(command);
    const targets = pendingRevisionTargets(pendingProposal, live);
    const addingToDraft = newTaskCreation && /(?:ще|також|до\s+цього|до\s+пропозиції|до\s+чернетки|another|also|more|to\s+(?:this|the)\s+(?:proposal|draft))(?![\p{L}\p{N}_])/iu.test(command);
    if (addingToDraft) return { route: 'task_command', scope: { operation: 'proposal', taskIds: [], createCount: Math.max(0, 50 - (pendingProposal.tasks?.length ?? 0)) },
      pendingRevision: { targets, allowedIds: [], allowCreate: true } };
    const draftNamed = partiallyNamedTasks(command, targets.map(target => target.task));
    const draftExact = targets.filter(target => mentioned(target.task.title) || mentioned(target.id)).map(target => target.id);
    // A shared partial name still refers to the draft, but cannot authorize an
    // arbitrary one of its tasks. Keep the revision open for clarification.
    const draftWords = titleWords(command);
    const draftSharedName = targets.some(target => titleWords(target.task.title).some(title => draftWords.some(word => sameStem(word, title))));
    // A live task named exactly still wins unless the person explicitly says draft/proposal.
    // Pending titles are resolved before fuzzy workspace names such as “Робота над анімацією”.
    const ambiguousCancellation = /^(?:скасуй|скасуйте|cancel)(?![\p{L}\p{N}_])/iu.test(command) && !exactIds.length;
    const revise = !newTaskCreation && (draftReference || ambiguousCancellation || !exactIds.length && (draftExact.length > 0 || draftNamed.ids.length > 0 || draftSharedName || deictic));
    if (revise) {
      const ids = draftExact.length ? draftExact : draftNamed.ids.length ? draftNamed.best
        : draftReference ? targets.map(target => target.id) : targets.length === 1 ? [targets[0].id] : [];
      const cancelling = /^(?:скасуй|скасуйте|cancel)(?![\p{L}\p{N}_])/iu.test(command);
      const operation = cancelling ? 'update' : recordedWorkCommand || /(?:таймер|секундомір|відлік|timer|stopwatch|countdown)/iu.test(command) ? 'timer'
        : /(?:крок|підзавдан|підзадач|step|subtask)/iu.test(command) ? 'steps' : 'update';
      const allowedIds = cancelling ? [] : ids;
      return { route: 'task_command', scope: { operation, taskIds: allowedIds,
        ...(operation === 'timer' && hasExplicitTimeRange(command) ? { allowSchedule: true } : {}), ...(allowRecordedWork ? { allowRecordedWork: true as const } : {}) },
        pendingRevision: { targets, allowedIds } };
    }
  }
  let scope: ConcreteTaskScope | undefined;
  const taskWord = /(?:завдан|задач|task|subtask|підзавдан|підзадач|крок|step)/iu.test(command);
  const timerWord = recordedWorkCommand || /(?:таймер|секундомір|відлік|timer|stopwatch|countdown)/iu.test(command);
  const dateField = /(?:дат[ауи]|дедлайн|термін|deadline|due\s+date|planned\s+date)/iu.test(command);
  const calendarHint = /(?:завтра|сьогодні|післязавтра|tomorrow|today|\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.\d{2,4})(?![\p{L}\p{N}_])/iu.test(command);
  const createVerb = /^(?:створи|створіть|додай|додайте|create|add)(?![\p{L}\p{N}_])/iu.test(command);
  if (intent === 'steps' && oneTarget.length === 1) scope = { operation: 'steps', taskIds: oneTarget };
  else if (explicit) {
    if (createVerb && /(?:вкладк|категор|tab|category)/iu.test(command) && !taskWord) scope = { operation: 'tabs', taskIds: [] };
    else if (newTaskCreation) scope = { operation: 'create', taskIds: [] };
    else if (timerWord) scope = { operation: 'timer', taskIds: oneTarget, ...(hasExplicitTimeRange(command) ? { allowSchedule: true } : {}), ...(allowRecordedWork ? { allowRecordedWork: true as const } : {}) };
    // Removing a date must never archive the parent task, even if its title is mentioned.
    else if (dateField) scope = { operation: 'update', taskIds: singleTarget };
    // A partial word match must not turn “add something new” into an edit of a similar task.
    else if (createVerb && calendarHint && !exactIds.length && !/(?:підзавдан|підзадач|subtask|крок|step)/iu.test(command)) scope = { operation: 'create', taskIds: [] };
    else if (/^(?:видали|видаліть|прибери|delete|remove)(?![\p{L}\p{N}_])/iu.test(command) && taskWord && !/(?:підзавдан|підзадач|subtask|крок|step)/iu.test(command)) scope = { operation: 'delete', taskIds: singleTarget };
    else if (taskWord || (createVerb ? exactIds : matchingIds).length) {
      const steps = /(?:розби[йтв]|розділи|розділен|break\s+down|split|підзавдан|підзадач|subtask|крок|step)/iu.test(command);
      scope = { operation: steps ? 'steps' : 'update', taskIds: steps ? oneTarget : singleTarget };
    }
  }

  // Tasks a reply names: exact titles first, then a quoted or distinctive partial name.
  const namedIn = (text: string | undefined, fuzzy: boolean) => {
    if (!text) return [];
    const exact = live.filter(task => normalized(text).includes(normalized(task.title))).map(task => task.id as string);
    if (exact.length || !fuzzy && !/[«"“„]/u.test(text)) return exact;
    const found = partiallyNamedTasks(text, live);
    return found.best.length ? found.best : found.ids;
  };
  // A repeated explicit instruction ("зміни таймер на 3 години") is as concrete
  // as accepting an offer. Resolve its missing subject from the conversation,
  // while never substituting a target for an unknown or ambiguous task name.
  const unnamedStepsCommand = /^(?:розбий|розділи|split|break\s+down)\s+(?:(?:це|поточне|єдине|the|this|current|only)\s+)?(?:завдання|задачу|task)(?:\s+(?:на\s+кроки|into\s+steps))?[.!?]?$/iu.test(command);
  if (scope && ['timer', 'steps', 'update'].includes(scope.operation) && !namedNow.length
    && (unnamedCommand || unnamedTimerCommand || unnamedRecordedWorkCommand || unnamedDateCommand || unnamedStepsCommand)) {
    const recentTexts = (options.previousUserTexts?.length ? options.previousUserTexts : [options.previousUserText])
      .filter((text): text is string => typeof text === 'string' && !!text.trim()).slice(-3);
    const contextNamedIn = (text: string) => {
      const named = namedIn(text, true);
      if (named.length) return named;
      // A shared partial name is still a subject, just an ambiguous one. Do not
      // skip it and fall back to an older subject or the one running timer.
      const words = titleWords(text);
      return live.filter(task => titleWords(task.title).some(title => words.some(word => sameStem(word, title)))).map(task => task.id as string);
    };
    const recent = [...recentTexts].reverse().map(contextNamedIn).find(ids => ids.length);
    const previous = namedIn(options.previousAssistantText, false);
    // The person's latest subject wins over task names quoted in the assistant's
    // explanation. Multiple possible subjects must still trigger clarification.
    const discussed = recent ?? (previous.length ? previous : undefined);
    if (discussed) scope.taskIds = discussed.length === 1 ? discussed : [];
    else if (scope.operation === 'timer') {
      const running = live.filter(task => task.timerRunning === true && !task.done).map(task => task.id as string);
      const active = live.filter(task => !task.done && !task.scheduledPending).map(task => task.id as string);
      scope.taskIds = running.length ? running.length === 1 ? running : [] : active.length === 1 ? active : [];
    }
    if (scope.operation === 'timer' && scope.taskIds.length === 1 && !scope.allowRecordedWork && unnamedTimerCommand
      && /^(?:зміни|змініть|онови|оновіть|поміняй|change|update|set)(?![\p{L}\p{N}_])/iu.test(command) && /\d/u.test(commandWithoutReason)) {
      // A short repeated command keeps the correction already requested before
      // the task clarification. A different intervening subject ends that scope.
      const newestFirst = [...recentTexts].reverse();
      const correction = newestFirst.findIndex(requestedRecordedWorkCorrection);
      if (correction >= 0 && newestFirst.slice(0, correction + 1).every(text => {
        const ids = contextNamedIn(text);
        return !ids.length || ids.length === 1 && ids[0] === scope!.taskIds[0];
      })) scope.allowRecordedWork = true;
    }
  }
  /**
   * Targets of an accepted offer, first match wins: (1) tasks named in the offer or the previous
   * reply; (2) a timer offer ("поставлю таймер на паузу?") → the tasks whose timer is running;
   * (3) a steps/completion offer → the task the person mentioned most recently; (4) tasks the
   * person mentioned in the recent conversation; (5) the only active task. An offer of new tasks
   * borrows no target. The result is still only a proposal scope; nothing is applied.
   */
  const acceptedOfferTargets = (offerText: string): string[] => {
    const offered = namedIn(offerText, true);
    if (offered.length) return offered;
    const previous = namedIn(options.previousAssistantText, false);
    if (previous.length) return previous;
    if (createOfferTopic.test(offerText) && !stepsOfferTopic.test(offerText)) return [];
    if (timerOfferTopic.test(offerText) && (timerStopTopic.test(offerText) || !timerStartTopic.test(offerText))) {
      const running = live.filter(task => task.timerRunning === true && !task.done).map(task => task.id as string);
      if (running.length) return running;
    }
    const recentUserTexts = (options.previousUserTexts?.length ? options.previousUserTexts : [options.previousUserText])
      .filter((text): text is string => typeof text === 'string' && !!text.trim()).slice(-3);
    const mentionedRecently = recentUserTexts.map(text => namedIn(text, true));
    if (stepsOfferTopic.test(offerText)) {
      const latest = [...mentionedRecently].reverse().find(ids => ids.length);
      if (latest) return latest;
    }
    const recent = [...new Set(mentionedRecently.flat())];
    if (recent.length) return recent;
    const active = live.filter(task => !task.done && !task.scheduledPending);
    return active.length === 1 ? [active[0].id] : [];
  };
  // A yes to the change the previous reply offered: the offer's plan becomes the proposal.
  // Outside discovery only; a doubt, refusal or question is never consent.
  const offer = !discoveryMode && !options.answeringDiscovery ? lastChangeOffer(options.previousAssistantText) : undefined;
  if (offer && (affirmativeReply.test(input) || /^(?:застосуй(?:те)?|застосувати|apply)(?:\s+(?:ці\s+)?(?:зміни|пропозицію|changes|proposal))?[.!\s]*$/iu.test(input)) && !doubtfulReply.test(input) && !/\?\s*$/u.test(input) && input.split(' ').length <= 12) {
    if (scope && (scope.taskIds.length || ['create', 'tabs'].includes(scope.operation))) return { route: 'task_command', scope, acceptedOffer: true };
    // “Додам їх знову?” concerns missing new tasks. A different existing task
    // named in the surrounding explanation must not become its update target.
    if (createOfferTopic.test(offer) && !stepsOfferTopic.test(offer) && !timerOfferTopic.test(offer)) return { route: 'task_command', scope: { operation: 'create', taskIds: [] }, acceptedOffer: true };
    const targets = [...new Set([...namedNow, ...acceptedOfferTargets(offer)])].slice(0, 8);
    return { route: 'task_command', scope: { operation: 'proposal', taskIds: targets }, acceptedOffer: true };
  }
  if (scope) return { route: 'task_command', scope };
  if (intent === 'steps') return { route: 'task_command', scope: { operation: 'steps', taskIds: [] } };

  const discovery = profile ? normalizeStrategyDiscovery(profile) : undefined;
  const ordinaryInformation = /^(?:проаналізуй|аналіз|покажи|analyse|analyze|show|review|audit|поясни|розкажи|explain|tell)(?![\p{L}\p{N}_])/iu.test(input);
  const question = /\?\s*$/.test(input);
  const workspaceTopic = /(?:завдан|задач|метрик|статист|черг|навантаж|task|metric|statistic|queue|workload)/iu.test(input);
  const personalTopic = /(?:мо[яїює]|мій|мене|мені|сво[їює]|my\s+(?:goal|life|problem)|about\s+me|продуктив|productiv)/iu.test(input);
  const conversationRoute = (): PersonalChatRoute => {
    if (discoveryMode) {
      // Inside the explicit discovery mode the interview continues; commands were handled above.
      if (personalConcern.test(input) || refusedStart.test(input) || personalGoalReference.test(input) || /^(?:я\s+)?(?:хочу|хотів|хотіла|прагну|мрію|i\s+want|i\s+wish|i\s+would\s+like)(?![\p{L}\p{N}_])/iu.test(input)) return 'personal';
      if (intent === 'plan' || /(?:план|plan)(?![\p{L}\p{N}_])/iu.test(command) && /^(?:зроби|склади|створи|допоможи|make|create|help)/iu.test(command)) return 'personal';
      const pending = discovery?.pendingQuestion;
      const privacyRequest = /(?:не хочу (?:про це|розповідати|обговорювати|відповідати|ділитися)|не готов[аий]* (?:обговорювати|ділитися|розповідати)|особисте|приватн|пропуст(?:имо|ити)|skip (?:this|that)|prefer not|rather not|private|don['’]?t want to (?:share|discuss|answer))/iu;
      const refusalCount = pending ? discovery!.topics[pending.topic].evidence.filter(answer => privacyRequest.test(answer.quote)).length : 0;
      const practicalAnswer = /(?:коли|перед|після|сідаю|боюс|страх|важко|незрозум|маю|можу|не\s+можу|не\s+знаю|when|before|after|afraid|unclear|i\s+have|i\s+can|cannot|can['’]?t)/iu.test(input);
      if (intent === 'auto' && !ordinaryInformation && pending && practicalAnswer && !question) return 'personal';
      if (intent === 'auto' && !ordinaryInformation && pending && discovery!.topics[pending.topic].status === 'deferred' && refusalCount > 1 && !practicalAnswer && !privacyRequest.test(input)) {
        // Answering our invitation to concrete help must not send the person back into a private interview.
        return 'help';
      }
      // Answering the visible discovery question, or the pending understanding summary, continues discovery.
      if (intent === 'auto' && !ordinaryInformation && !question && (options.answeringDiscovery || discovery?.phase === 'confirming' || discovery?.pendingSummary)) return 'personal';
      if (intent === 'analysis' && personalTopic && !workspaceTopic) return 'personal';
    }
    if (/^(?:як|де|що\s+означає|how|where|what\s+does)(?![\p{L}\p{N}_])/iu.test(input) && /(?:додат|кноп|меню|вклад|таймер|завдан|задач|karkas|button|menu|tab|timer|task|setting)/iu.test(input)) return 'help';
    if (intent === 'analysis' || /^(?:проаналізуй|аналіз|покажи|analyse|analyze|show|review|audit)(?![\p{L}\p{N}_])/iu.test(input) && /(?:завдан|задач|час|метрик|статист|черг|навантаж|task|time|metric|statistic|queue|workload|workspace)/iu.test(input)) return 'workspace_analysis';
    if (!personalTopic && /^(?:що\s+таке|хто|коли|де|як|поясни|розкажи|напиши|переклади|what|who|when|where|how|explain|tell|write|translate)(?![\p{L}\p{N}_])/iu.test(input)) return 'help';
    // In discovery mode a statement keeps the interview going; a question gets an ordinary answer.
    if (discoveryMode && intent === 'auto' && !ordinaryInformation && !question) return 'personal';
    // Wishes, struggles, plan requests, small talk and general questions get ordinary coaching, not an interview.
    return 'general';
  };
  const route = conversationRoute();
  if (route === 'personal') return { route };
  // Ordinary conversation may still propose changes the person explicitly asks for or agrees to,
  // but only for tasks named now or in the previous turn; with none named, only new tasks.
  const discussed = [...new Set([...namedNow, ...namedIn(options.previousUserText, true), ...namedIn(options.previousAssistantText, false)])].slice(0, 8);
  return { route, proposalScope: { operation: 'proposal', taskIds: discussed } };
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
      if (scope?.operation === 'timer') return Object.fromEntries(Object.entries(item).filter(([key]) => (scope.allowRecordedWork
        ? ['id', 'recordedWorkSeconds']
        : ['id', 'timerMode', 'countdownDurationSeconds', 'timerAction', ...(scope.allowSchedule ? ['schedule', 'plannedDate'] : [])]).includes(key)));
      if (scope?.operation === 'steps') return Object.fromEntries(Object.entries(item).filter(([key]) => ['id', 'stepList', 'steps'].includes(key)));
      if (!scope?.allowRecordedWork) { const { recordedWorkSeconds: _recordedWorkSeconds, ...safe } = item; return safe; }
      const { timerMode: _timerMode, countdownDurationSeconds: _countdownDurationSeconds, timerAction: _timerAction, schedule: _schedule, plannedDate: _plannedDate, ...correction } = item;
      return correction;
    }).map((item: Record<string, any>) => Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined)))
      .filter((item: Record<string, any>) => Object.keys(item).some(key => key !== 'id')) : [];
  delete next.strategy;
  return next;
}

export const personalGuidanceSystemPolicy = `PERSONAL GUIDANCE POLICY (takes priority over generic task instructions below):
Distinguish a concrete task command from a person's wishes or answer to a getting-to-know-you question. A wish such as wanting a portfolio, freelance income, English or faster typing is personal context, NOT permission to create a plan or tasks.
For PERSONAL_DISCOVERY, first understand motives, actual barriers and available capacity/circumstances, adaptively, one meaningful question at a time. Never rush from goal names to a schedule, commitments, duration estimates or an execution plan. Even a direct request for a personal plan still needs the most important missing clarification. Never infer readiness from an agreed goal, your own ready status, elapsed chat length or a bare yes. Only the app's discovery state and scoped confirmation of its pending understanding summary authorize personal planning.
Concrete CRUD/timer/subtask/help commands and read-only workspace analysis remain available without a personal interview, strictly within the supplied command scope. They do not complete the personal interview or replace an existing strategy.
When a timer command scope has allowRecordedWork:true, it authorizes correcting the task's absolute recorded work total through recordedWorkSeconds only. Preserve timer mode, countdown duration, running/paused state and schedule; do not substitute a future countdown for missed recorded work. Without that flag, never include recordedWorkSeconds.
Respect negation and ambivalence in the person's actual words. Do not substitute your assumptions for motives, effort, mood or life circumstances. No profession assumptions, diagnoses, personality labels, blame, canned praise or generic productivity lecture. Ask about the specific situation, prior attempts and what happens before distraction when relevant. When someone has not started/refuses, ask what happened before suggesting fixes.
Use the person's existing answers. Repetitive routine, boredom and excessive time spent are concrete barriers. "Nothing happens" after a question about an event before distraction is an answer, not a reason to repeat that question. Never repeat or paraphrase a question already asked. If the person complains about repeated questions, stop the interview and respond to their stated concern without another question or readiness claim.
Memory updates add grounded observations; facts quote exact user words, interpretations are hypotheses. Never silently change or self-confirm goals. Retain existing useful memory and agreed strategy. Discovery questions, ordinary task commands and metric analysis are not new personal strategies.
Never provide a personal plan via legacy task arrays to bypass discovery. For PERSONAL_DISCOVERY omit all mutations, narrative, nextAction and focusTaskId; return only a short reflection in your own words, optionally one grounded insight, the next question and discovery evidence/summary.`;

/** App-written fallback questions in the person's form of address; ти-variants avoid gendered past tense. */
export function fallbackDiscoveryQuestion(topic: string, uk: boolean, address: DiscoveryAddress = 'vy'): string {
  const questions: Record<string, [string, string, string]> = {
    motivation: ['Що для вас зміниться, якщо ви досягнете цих цілей, і чому це важливо саме зараз?', 'Що для тебе зміниться, якщо ці цілі вдасться досягти, і чому це важливо саме зараз?', 'What would reaching these goals change for you, and why does that matter now?'],
    barriers: ['Коли ви востаннє відклали важливу справу, що відбувалося перед тим, як ви переключилися на щось інше?', 'Пригадай останній раз, коли важлива справа відкладалася: що відбувалося безпосередньо перед тим, як увага перемкнулася на інше?', 'The last time you put off something important, what happened just before you switched to something else?'],
    capacity: ['Які обставини зараз впливають на ваші сили й можливість працювати над цими цілями?', 'Які обставини зараз впливають на твої сили й можливість працювати над цими цілями?', 'What circumstances currently affect your energy and ability to work on these goals?'],
    circumstances: ['Що у вашій теперішній життєвій ситуації найбільше впливає на рух до цих цілей?', 'Що у твоїй теперішній життєвій ситуації найбільше впливає на рух до цих цілей?', 'What in your current life situation most affects progress toward these goals?'],
    attempts: ['Що ви вже пробували, щоб починати й продовжувати важливу роботу, і що з цього допомагало?', 'Що вже доводилося пробувати, щоб починати й продовжувати важливу роботу, і що з цього допомагало?', 'What have you tried to start and continue important work, and what helped?'],
    direction: ['До якої з ваших цілей ви насамперед хочете рухатися і що вона для вас означає?', 'До якої з твоїх цілей ти насамперед хочеш рухатися і що вона для тебе означає?', 'Which of your goals would you like to work toward first, and what does it mean to you?'],
    goals: ['Що ви хотіли б змінити у своєму житті й чому це для вас важливо?', 'Що тобі хотілося б змінити у своєму житті й чому це для тебе важливо?', 'What would you like to change in your life, and why does it matter to you?'],
  };
  return (questions[topic] || questions.barriers)[!uk ? 2 : address === 'ty' ? 1 : 0];
}

// Word-bounded vocabulary: "підготовка", "already", "зробив" or "commitments" are not plans.
const letterBefore = '(?<![\\p{L}\\p{N}])';
const letterAfter = '(?![\\p{L}\\p{N}])';
const words = (alternatives: string) => new RegExp(`${letterBefore}(?:${alternatives})${letterAfter}`, 'iu');
const stems = (alternatives: string) => new RegExp(`${letterBefore}(?:${alternatives})`, 'iu');
/** Asks for readiness, consent, a promise or a start ("готовий?", "почнемо?", "will you"). */
const commitmentAsk = stems(`готов|погодж|домовим|домовились|домовилися|пообіця|обіцяєш|обіцяєте|зобов['’ʼ]?яж|зобов['’ʼ]?язуєш|зобов['’ʼ]?язуєте|почнемо|почнеш|почнете|візьмешся|візьметеся`);
const englishCommitment = /\b(?:commit(?:ted)?\s+to|agree(?:d)?\s+to|ready\s+to|will\s+you|shall\s+we|let['’]?s|start\s+with|promise)\b/iu;
/** Advice phrased as an imperative: "почни", "зроби", "спробуй". Quoted words of the person are exempt. */
const imperativeAdvice = words('почни|почніть|починай|починайте|почнімо|займись|займися|займіться|приступай|приступайте|працюй|працюйте|зроби|зробіть|заплануй|заплануйте|спробуй|спробуйте');
const durations = new RegExp(`${letterBefore}(?:\\d+(?:[.,]\\d+)?|одн[уаі]|дв[іа]|три|чотири|п['’ʼ]?ять|десять|п['’ʼ]?ятнадцять|двадцять|тридцять|сорок|пів|five|ten|fifteen|twenty|thirty|forty)\\s*[-–]?\\s*(?:хв|хвилин|год|годин|min|minute|hour)|${letterBefore}півгодин`, 'iu');
const clockTime = /(?<![\p{N}])\d{1,2}[:.]\d{2}(?![\p{N}])|(?<![\p{L}])(?:о|об|at)\s+\d{1,2}(?![\p{N}])/iu;
const scheduleWord = stems('завтра|післязавтра|сьогодні\\s+ввечері|щодня|щоранку|щовечора|кожного\\s+(?:дня|ранку|вечора)|кожен\\s+день|tomorrow|tonight|every\\s+(?:day|morning|evening)|daily');
const proposedAction = words('почни|почати|почнемо|почнеш|зроби|зробити|зробиш|сядь|сісти|сядеш|займися|зайнятися|попрацюй|попрацювати|спробуй|спробуєш|спробувати|відкрий|відкрити|візьмися|start|begin|try|work\\s+on');
const planLabel = new RegExp(`${letterBefore}(?:план|plan)\\s*[:—–-]|(?:^|\\n)\\s*(?:[-*•]|\\d+[.)])\\s`, 'iu');
const russianLetters = /[ыэъё]/iu;
const praiseOrLabel = stems('молодець|чудово|прекрасно|супер(?![\\p{L}])|great\\b|awesome|well\\s+done|лінив|ледач|лінь|депрес|діагноз|розлад|сдуг|adhd|lazy');
const quotedSegments = /[«“„"]([^«»“”„"]{0,80})[»”“"]/gu;
const withoutQuotes = (value: string) => value.replace(quotedSegments, ' ');
const sentenceBreaks = (value: string) => (value.replace(/[.!…]+\s*$/u, '').match(/[.!?…]+\s+\S/gu) || []).length;

/** Plans, schedules, durations, commitments and imperative advice that must not leak into discovery text. */
function leaksPlan(value: string, allowAdvice = false): boolean {
  return commitmentAsk.test(value) || englishCommitment.test(value) || planLabel.test(value) || durations.test(value) || clockTime.test(value)
    || scheduleWord.test(value) && proposedAction.test(value) || (!allowAdvice && imperativeAdvice.test(withoutQuotes(value)));
}

/**
 * Natural model questions are accepted with any opening word and an optional short lead-in.
 * Rejected: empty, very long, several questions, multi-line output, or a schedule, commitment,
 * plan or imperative advice smuggled into the question. The person's own quoted words are not
 * treated as advice ("Коли ти кажеш собі «зроби це», що відбувається?").
 */
export function safeDiscoveryQuestion(question: unknown): question is string {
  if (typeof question !== 'string') return false;
  const value = question.trim();
  return value.length > 8 && value.length <= 500 && !/[\r\n]/.test(value)
    && (withoutQuotes(value).match(/\?/g) || []).length === 1 && /\?[\s»”"')]*$/u.test(value)
    && !russianLetters.test(value) && !leaksPlan(value);
}

/** A short lead-in on its own line is joined; list-like or longer multi-line output stays rejected. */
export function discoveryQuestionText(question: unknown): string | undefined {
  if (typeof question !== 'string') return undefined;
  const lines = question.trim().split(/\s*\n+\s*/u).filter(Boolean);
  const joined = lines.length <= 2 && !planLabel.test(question) ? lines.join(' ') : question.trim();
  return safeDiscoveryQuestion(joined) ? joined : undefined;
}

/** True when the candidate copies the person's message: the whole short message or any 9-word run of a long one. */
function echoesMessage(candidate: string, userText: string): boolean {
  const tokens = (value: string) => value.toLocaleLowerCase().match(/[\p{L}\p{N}'’ʼ-]+/gu) || [];
  const source = tokens(userText), target = ` ${tokens(candidate).join(' ')} `;
  if (source.length < 4) return false;
  const size = Math.min(source.length, 9);
  for (let start = 0; start + size <= source.length; start++) if (target.includes(` ${source.slice(start, start + size).join(' ')} `)) return true;
  return false;
}
const addressMismatch = (value: string, address: DiscoveryAddress) => { const form = addressFormOf(value); return !!form && form !== address; };
const quotedWords = (value: string) => [...value.matchAll(quotedSegments)].reduce((sum, match) => sum + (match[1].match(/[\p{L}\p{N}]+/gu) || []).length, 0);

/**
 * The model's own one-sentence empathic reflection of the current message. It must be short, in
 * its own words (at most an 8-word quoted key phrase, never the whole message), and carry no
 * question, advice, plan, schedule, commitment, praise or label.
 */
export function safeDiscoveryReflection(value: unknown, userText: string, address: DiscoveryAddress = 'vy', uk = true): string | undefined {
  if (typeof value !== 'string') return undefined;
  const reflection = value.trim().replace(/\s+/gu, ' ');
  if (reflection.length < 6 || reflection.length > 220 || /[?\n]/u.test(value.trim()) || sentenceBreaks(reflection) > 0) return undefined;
  if (uk && (!/[а-яіїєґ]/iu.test(reflection) || russianLetters.test(reflection))) return undefined;
  if (leaksPlan(reflection) || praiseOrLabel.test(reflection) || words('раджу|рекомендую|варто|слід|try|should|recommend').test(reflection)) return undefined;
  if (quotedWords(reflection) > 8 || echoesMessage(reflection, userText) || addressMismatch(reflection, address)) return undefined;
  return /[.!…»”"]$/u.test(reflection) ? reflection : `${reflection}.`;
}

/**
 * One grounded observation or tiny low-commitment tip (at most two short sentences). A gentle
 * suggestion is allowed; schedules, durations, commitments, tasks and plans are not.
 */
export function safeDiscoveryInsight(value: unknown, userText: string, address: DiscoveryAddress = 'vy', uk = true): string | undefined {
  if (typeof value !== 'string') return undefined;
  const insight = value.trim().replace(/\s+/gu, ' ');
  if (insight.length < 12 || insight.length > 280 || /[?\n]/u.test(value.trim()) || sentenceBreaks(insight) > 1) return undefined;
  if (uk && (!/[а-яіїєґ]/iu.test(insight) || russianLetters.test(insight))) return undefined;
  if (leaksPlan(insight, true) || praiseOrLabel.test(insight)) return undefined;
  if (stems('створ\\p{L}*\\s+завдан|додам|додай\\s+завдан|розклад|графік|дедлайн|create\\s+(?:a\\s+)?task|add\\s+(?:a\\s+)?task|schedule|deadline').test(insight) || words('план|plan').test(insight)) return undefined;
  if (quotedWords(insight) > 8 || echoesMessage(insight, userText) || addressMismatch(insight, address)) return undefined;
  return /[.!…»”"]$/u.test(insight) ? insight : `${insight}.`;
}

/**
 * The form of address for this conversation, shared by every chat route and by app-written text
 * (fallback questions, proposal summaries, guard messages): the current message decides, then the
 * latest recent user message that shows a form, then the discovery answers; "ви" only without any signal.
 */
export function discoveryAddressFor(profile: PersonalStrategyProfile | undefined, userText: string, history?: unknown): DiscoveryAddress {
  const recent = Array.isArray(history) ? history.filter(message => record(message) && message.role === 'user' && typeof message.content === 'string').map(message => message.content as string).slice(-10) : [];
  const evidence = profile ? discoveryEvidenceTexts(normalizeStrategyDiscovery(profile)) : [];
  return detectDiscoveryAddress([...evidence, ...recent, typeof userText === 'string' ? userText : '']);
}

/**
 * Request-context line telling the model which form the app itself uses in this reply.
 * scope 'discovery' names the interview fields; 'chat' covers the whole reply on ordinary routes.
 */
export function discoveryAddressContext(address: DiscoveryAddress, uk: boolean, scope: 'discovery' | 'chat' = 'discovery'): string {
  if (!uk) return 'ADDRESS FORM: English; no special form.';
  const where = scope === 'discovery' ? 'in every field (reflection, insight, question)' : 'throughout the reply, including questions, offers and instructions';
  return address === 'ty'
    ? `ADDRESS FORM (app-derived from the person's messages): use "ти" ${where}; never "ви" or "давайте/хочете". The person's gender is unknown unless they state it: avoid gendered forms about them (write "тобі хотілося б", not "ти хотів/хотіла б").`
    : `ADDRESS FORM (app-derived from the person's messages): use "ви" ${where}; never "ти" or a mix of forms.`;
}

export interface DiscoveryReplyOptions {
  /** Recent conversation ({ role, content }), used for address and to avoid repeated questions. */
  history?: unknown;
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

function understandingSummary(profile: PersonalStrategyProfile, uk: boolean, address: DiscoveryAddress = 'vy'): string {
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
  const heading = uk ? (address === 'ty' ? 'Твої обрані цілі' : 'Ваші обрані цілі') : 'Your selected goals';
  return [`${heading}: ${titles}.`, ...[...observations].map(([quote, names]) => `${names.join(', ')}: «${concise(quote)}»`)].join('\n\n');
}

const tokenCount = (value: string) => (value.match(/[\p{L}\p{N}'’ʼ-]+/gu) || []).length;

/** A short clause (2–8 words) of the person's own words about the topic; never the whole message. */
function keyPhrase(userText: string, nextTopic: StrategyDiscoveryTopic): string | undefined {
  const sources: Partial<Record<StrategyDiscoveryTopic, StrategyDiscoveryTopic[]>> = {
    motivation: ['direction'], barriers: ['barriers'], attempts: ['barriers'], capacity: ['capacity', 'circumstances'], circumstances: ['circumstances'],
  };
  const topics = sources[nextTopic];
  if (!topics) return undefined;
  const total = tokenCount(userText);
  for (const part of userText.split(/[.!?;:\n,()—–…]+|\s+-\s+/u)) {
    let clause = part.trim();
    for (let index = 0; index < 3; index++) clause = clause.replace(/^(?:і|й|а|але|та|бо|що|ну|так|ой|слухай|and|but|so|because)\s+/iu, '');
    const count = tokenCount(clause);
    if (count < 2 || count > 8 || count >= total || /[«»"“”„]/u.test(clause) || !topics.some(source => mentionsDiscoveryTopic(source, clause))) continue;
    return /^\p{Lu}\p{Ll}/u.test(clause) ? `${clause[0].toLocaleLowerCase()}${clause.slice(1)}` : clause;
  }
  return undefined;
}

/** A fallback question grounded in a short key phrase of the person's words, when one exists. */
function groundedFallbackQuestion(nextTopic: StrategyDiscoveryTopic, userText: string, uk: boolean, address: DiscoveryAddress): string | undefined {
  const phrase = keyPhrase(userText, nextTopic);
  const follow: Partial<Record<StrategyDiscoveryTopic, [string, string, string]>> = {
    motivation: ['Що це змінить саме для вас і чому це важливо зараз?', 'Що це змінить саме для тебе і чому це важливо зараз?', 'What would this change for you, and why does it matter now?'],
    barriers: ['Що зазвичай відбувається безпосередньо перед тим, як увага перемикається на щось інше?', 'Що зазвичай відбувається безпосередньо перед тим, як увага перемикається на щось інше?', 'What usually happens just before your attention switches to something else?'],
    attempts: ['Що вже доводилося пробувати з цим і що хоч трохи допомагало?', 'Що вже доводилося пробувати з цим і що хоч трохи допомагало?', 'What have you already tried with this, and what helped even a little?'],
    capacity: ['Скільки часу й сил у вас реально є на це зараз, з урахуванням відпочинку?', 'Скільки часу й сил у тебе реально є на це зараз, з урахуванням відпочинку?', 'How much time and energy do you realistically have for this now, allowing for rest?'],
    circumstances: ['Що в цій ситуації найбільше впливає на вашу роботу зараз?', 'Що в цій ситуації найбільше впливає на твою роботу зараз?', 'What in this situation affects your work the most right now?'],
  };
  const options = follow[nextTopic];
  if (!phrase || !options) return undefined;
  const lead = !uk ? `You mentioned “${phrase}”.` : address === 'ty' ? `Ти пишеш: «${phrase}».` : `Ви пишете: «${phrase}».`;
  return discoveryQuestionText(`${lead} ${options[!uk ? 2 : address === 'ty' ? 1 : 0]}`);
}

/** A short neutral acknowledgement when the model gave no safe reflection; nothing for very short replies. */
function acknowledgement(userText: string, uk: boolean, turn: number): string {
  if (tokenCount(userText) < 4 || /^(?:так|ні|не знаю|не впевнен[аий]*|важко сказати|yes|no|i don['’]?t know|not sure|maybe|можливо)[.!\s]*$/iu.test(userText.trim())) return '';
  const options = uk ? ['Зрозуміло, дякую.', 'Це допомагає краще зрозуміти ситуацію.', 'Дякую за відвертість.'] : ['Got it, thanks.', 'That helps me understand the situation better.', 'Thanks for being open about this.'];
  return options[turn % options.length];
}

/** The model's optional free-text fields, wherever the schema placed them. */
function modelField(parsed: Record<string, any>, incoming: Record<string, any>, key: 'reflection' | 'insight'): unknown {
  return [parsed[key], record(parsed.strategy) ? parsed.strategy[key] : undefined, incoming[key]].find(value => typeof value === 'string' && value.trim());
}

/** Include the stored question even when the client sent no recent conversation. */
function previousDiscoveryQuestions(profile: PersonalStrategyProfile, history: unknown): string[] {
  const recent = Array.isArray(history) ? history.filter(message => record(message) && message.role === 'assistant' && typeof message.content === 'string')
    .slice(-20).flatMap(message => (message.content as string).match(/[^.!?\n]*\?/gu) || []) : [];
  const pending = normalizeStrategyDiscovery(profile).pendingQuestion?.text;
  return pending ? [...recent, pending] : recent;
}

/**
 * Ignore free-form provider prose and all action containers when interview evidence is incomplete.
 * The reply is: a short reflection (the model's own validated sentence, or a neutral acknowledgement),
 * from the third discovery turn on one validated insight, and one question. If no insight is safe by
 * then, the app offers practical help once instead of a further interview question.
 */
export function sanitizeDiscoveryResponse(parsed: Record<string, any>, profile: PersonalStrategyProfile, userText: string, turnId: string, uk: boolean, options: DiscoveryReplyOptions = {}) {
  // A complaint concerns this conversation, never personal evidence or consent to continue it.
  if (isDiscoveryRepetitionComplaint(userText)) {
    const reply = uk ? 'Я повторював уже поставлене запитання. Зупиняю це опитування; попередні відповіді вже є в розмові.'
      : 'I repeated a question I had already asked. I am stopping the interview; your earlier answers are already in the conversation.';
    return { reply, tasks: [], taskUpdates: [], taskDeletions: [], tabs: [], strategy: { status: 'getting_to_know' as const, question: undefined, memoryPatch: undefined, actions: [] } };
  }
  const raw = record(parsed.strategy?.memoryPatch) ? parsed.strategy.memoryPatch : parsed.memoryPatch;
  const patch = discoveryMemory(raw);
  const incoming = record(raw?.discovery) ? raw.discovery : {};
  const address = discoveryAddressFor(profile, userText, options.history);
  let interviewProfile = profile;
  const before = normalizeStrategyDiscovery(profile);
  const askedBefore = previousDiscoveryQuestions(profile, options.history);
  const freshQuestion = (value: string | undefined) => !!value && !askedBefore.some(previous => discoveryQuestionsEquivalent(previous, value));
  const clarification = record(incoming.question) ? incoming.question : undefined;
  const clarificationText = clarification ? discoveryQuestionText(clarification.text) : undefined;
  const usableClarification = clarification && topic(clarification.topic) && clarificationText && !addressMismatch(clarificationText, address) && freshQuestion(clarificationText) ? clarificationText : undefined;
  const previousQuestion = before.pendingQuestion;
  if (usableClarification && previousQuestion?.topic === clarification!.topic) {
    // A substantive first answer may still need a narrower follow-up on the same topic.
    patch.discovery = { ...patch.discovery, question: { topic: clarification!.topic, text: usableClarification } };
  }
  if (isPersonalStrategyReady(profile) && usableClarification) {
    interviewProfile = { ...profile, discovery: { ...before, phase: 'exploring', pendingSummary: undefined, pendingQuestion: undefined,
      topics: { ...before.topics, [clarification!.topic]: { ...before.topics[clarification!.topic as StrategyDiscoveryTopic], status: 'unknown' } } } };
  }
  const candidate = applyDiscoveryTurn(applyStrategyMemory(interviewProfile, patch, userText, turnId), { memoryPatch: patch }, userText, turnId);
  const state = normalizeStrategyDiscovery(candidate);
  const missing = missingStrategyDiscoveryTopics(state);
  const needsDirection = !state.selectedGoalIds.length;
  if (!missing.length && !needsDirection) {
    const summary = understandingSummary(candidate, uk, address);
    const question = uk ? (address === 'ty' ? 'Чи правильно я зрозумів твою ситуацію й ці цілі?' : 'Чи правильно я зрозумів вашу ситуацію й ці цілі?') : 'Have I understood your situation and these goals correctly?';
    const fullSummary = `${summary}\n\n${question}`;
    patch.discovery = { ...patch.discovery, summary: fullSummary };
    return { reply: fullSummary, tasks: [], taskUpdates: [], taskDeletions: [], tabs: [], strategy: { status: 'clarifying' as const, question, memoryPatch: patch, actions: [] } };
  }
  const desired = usableClarification && missing.includes(clarification!.topic) ? { topic: clarification!.topic as StrategyDiscoveryTopic, text: usableClarification } : undefined;
  const defaultTopic = state.topics.direction.status === 'answered' && state.topics.barriers.status === 'unknown' ? 'barriers' : missing[0];
  let nextTopic: StrategyDiscoveryTopic = needsDirection && !missing.length ? 'direction' : desired?.topic || defaultTopic;
  const lang = uk ? 'uk' : 'en';
  const reflection = safeDiscoveryReflection(modelField(parsed, incoming, 'reflection'), userText, address, uk);
  // With the model's own reflection, a quoted key phrase in the question would repeat it.
  const grounded = reflection ? undefined : groundedFallbackQuestion(nextTopic, userText, uk, address);
  let question = state.topics[nextTopic].status === 'deferred'
    ? discoveryQuestionForState(state, nextTopic, lang, address)
    : /^(?:не знаю|не впевнен[аий]*|важко сказати|i don['’]?t know|not sure|maybe|можливо)[.!\s]*$/iu.test(userText.trim()) && previousQuestion?.topic === nextTopic
      ? narrowerDiscoveryQuestion(nextTopic, uk, address)
    : desired?.text || grounded || (nextTopic === 'capacity' ? discoveryQuestionForState(state, nextTopic, lang, address) : fallbackDiscoveryQuestion(nextTopic, uk, address));
  if (!freshQuestion(question)) {
    // Explore a different aspect rather than cycling through synonyms of the same question.
    const candidates = [...new Set([nextTopic, ...missing])].flatMap(candidateTopic => {
      const practical = { topic: candidateTopic, text: discoveryQuestionForState(state, candidateTopic, lang, address) };
      // A refusal to share never falls back to a direct question about the private topic.
      return state.topics[candidateTopic].status === 'deferred' ? [practical] : [practical,
        { topic: candidateTopic, text: narrowerDiscoveryQuestion(candidateTopic, uk, address) },
        { topic: candidateTopic, text: fallbackDiscoveryQuestion(candidateTopic, uk, address) },
      ];
    });
    const next = candidates.find(candidate => freshQuestion(candidate.text));
    if (next) { nextTopic = next.topic; question = next.text; }
    else {
      // Exhausting safe questions does not authorize a summary, a plan, or invented evidence.
      if (patch.discovery) delete patch.discovery.question;
      return { reply: [reflection, uk ? 'Не ставитиму знову ті самі запитання. Зупиняю опитування на цьому місці.' : 'I will not ask the same questions again. I am pausing the interview here.'].filter(Boolean).join('\n\n'),
        tasks: [], taskUpdates: [], taskDeletions: [], tabs: [], strategy: { status: 'getting_to_know' as const, question: undefined, memoryPatch: patch, actions: [] } };
    }
  }
  // After two interview questions in a row each reply carries one grounded insight, or once offers practical help instead.
  const streak = discoveryQuestionStreak(previousQuestion?.id);
  const insight = streak.asked >= 2 ? safeDiscoveryInsight(modelField(parsed, incoming, 'insight'), userText, address, uk) : undefined;
  const offer = streak.asked >= 2 && !insight && !streak.offered && state.topics[nextTopic].status !== 'deferred' && freshQuestion(PRACTICAL_HELP_OFFER[lang]);
  const asked = offer ? PRACTICAL_HELP_OFFER[lang] : question;
  patch.discovery = { ...patch.discovery, question: { topic: nextTopic, text: asked } };
  const lead = reflection || (question === grounded && !offer ? '' : acknowledgement(userText, uk, before.processedTurnIds.length));
  return { reply: [lead, insight, asked].filter(Boolean).join('\n\n'), tasks: [], taskUpdates: [], taskDeletions: [], tabs: [], strategy: { status: 'getting_to_know' as const, question: asked, memoryPatch: patch, actions: [] } };
}

function narrowerDiscoveryQuestion(topic: StrategyDiscoveryTopic, uk: boolean, address: DiscoveryAddress = 'vy'): string {
  const questions: Record<StrategyDiscoveryTopic, [string, string, string]> = {
    direction: ['Яку одну конкретну справу ви хотіли б полегшити зараз?', 'Яку одну конкретну справу тобі хотілося б полегшити зараз?', 'Which one concrete task would you like to make easier now?'],
    motivation: ['Що змінилося б у вашому звичайному дні, якби ця справа вдалася?', 'Що змінилося б у твоєму звичайному дні, якби ця справа вдалася?', 'What would change in your ordinary day if this worked out?'],
    barriers: ['Коли ви востаннє відкрили важливу справу й відклали її, що відбулося в ту мить?', 'Що відбувається в ту мить, коли ти відкриваєш важливу справу й відкладаєш її?', 'The last time you opened an important task and put it aside, what happened at that moment?'],
    capacity: ['Який невеликий обсяг роботи зараз був би посильним, з урахуванням відпочинку?', 'Який невеликий обсяг роботи зараз був би для тебе посильним, з урахуванням відпочинку?', 'What small amount of work feels manageable now, allowing for rest?'],
    circumstances: ['Що у вашому сьогоднішньому дні найбільше впливає на цю справу?', 'Що у твоєму сьогоднішньому дні найбільше впливає на цю справу?', 'What in your day today most affects this task?'],
    attempts: ['Чи був хоча б один випадок, коли почати цю справу було легше?', 'Чи був хоча б один випадок, коли почати цю справу було легше?', 'Has there been one occasion when starting this task was easier?'],
  };
  return questions[topic][!uk ? 2 : address === 'ty' ? 1 : 0];
}

/** Recheck returned context and keep clarifications from silently becoming a new plan. */
export function constrainReadyPersonalResponse(parsed: Record<string, any>, profile: PersonalStrategyProfile, userText: string, turnId: string, uk: boolean, options: DiscoveryReplyOptions = {}) {
  const strategy = record(parsed.strategy) ? { ...parsed.strategy } : {};
  const next: Record<string, any> = { ...parsed, tasks: [], taskUpdates: [], taskDeletions: [], tabs: [] };
  const refused = refusedStart.test(userText);
  const reasonGiven = userText.split(/[.!?;,\n]+|\s+(?:але|but)\s+/iu).some(clause => {
    if (/(?:можливо|мабуть|припускаю|не\s+знаю\s+чому|perhaps|maybe|not\s+sure|don['’]?t\s+know\s+why)/iu.test(clause)) return false;
    const grounded = clause.replace(/(?:не\s+(?:(?:дуже|зовсім|аж|так|надто)\s+)*(?:втом\p{L}*|бою\p{L}*|страш\p{L}*|тривож\p{L}*|незрозум\p{L}*)|(?:not|wasn['’]?t|am\s+not|don['’]?t\s+feel)\s+(?:very\s+)?(?:tired|afraid|anxious|unclear))/giu, '');
    return /(?:втом|боюс|страх|незрозум|не\s+знав.*почати|tired|afraid|unclear|didn['’]?t\s+know)/iu.test(grounded)
      || /(?:тому,?\s+що|бо|через|because|due\s+to)\s+\S.{5}/iu.test(grounded.trim());
  });
  if (refused && !reasonGiven) {
    const question = !uk ? 'What was happening when you wanted to start but did not start or switched to something else?'
      : discoveryAddressFor(profile, userText, options.history) === 'ty' ? 'Що відбувалося в той момент, коли хотілося почати, але справа так і не почалася або увага перемкнулася на інше?'
      : 'Що відбувалося в той момент, коли ви хотіли почати, але не почали або переключилися на інше?';
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
  if (!isPersonalStrategyReady(candidate)) return sanitizeDiscoveryResponse({ ...next, strategy }, profile, userText, turnId, uk, options);
  if (parsed.strategy && (strategy.status !== 'ready' || text(strategy.question) || strategy.memoryPatch?.discovery?.question)) {
    next.strategy = { ...strategy, actions: [] };
    for (const key of ['narrative', 'nextAction', 'focusTaskId']) delete next.strategy[key];
  }
  return next;
}
