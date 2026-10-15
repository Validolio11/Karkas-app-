import { isTaskDate } from '../src/utils/taskDates';

type Clock = { now: string; timeZone: string };
type Response = Record<string, any>;
/** The person's Ukrainian form of address (see discoveryAddressFor); "ви" by default. */
type Address = 'ty' | 'vy';

const relativeDays = /(?<![\p{L}\p{N}_])(?:післязавтра|сьогодні|завтра|вчора|today|tomorrow|yesterday)(?![\p{L}\p{N}_])/giu;
const schedulingRequest = /розкла[дс]|розплан|заплан|сплан|перен[ео]|переплан|створ|дода[йт]|постав|план\s+(?:на|завдан|дня)|\b(?:plan|schedule|reschedule|move|create|add)\b/iu;

function localDay(value: number, timeZone: string): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
}

function shiftedDay(today: string, offset: number): string {
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function explicitDates(text: string): string[] {
  const dates: string[] = [...(text.match(/\b\d{4}-\d{2}-\d{2}\b/g) || [])];
  for (const match of text.matchAll(/\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/g)) {
    dates.push(`${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`);
  }
  return dates.filter(isTaskDate);
}

function relativeDay(word: string, today: string): string {
  return /післязавтра/iu.test(word) ? shiftedDay(today, 2) : /завтра|tomorrow/iu.test(word) ? shiftedDay(today, 1)
    : /вчора|yesterday/iu.test(word) ? shiftedDay(today, -1) : today;
}

function requestedDay(prompt: string, today: string): string | undefined {
  if (!schedulingRequest.test(prompt)) return undefined;
  // Questions about an earlier move and requests not to move anything are not new scheduling orders.
  if (/^\s*(?:(?:чому|навіщо)(?:\s|[?!,:])|(?:why|when\s+did)\b)/iu.test(prompt)
    || /^\s*(?:не\s+(?:перен|план|розкла|заплан)|(?:do\s+not|don't)\s+(?:move|plan|schedule))/iu.test(prompt)) return undefined;
  // A negated date is not a target. Multiple distinct dates require richer task-specific mapping.
  const affirmative = prompt.replace(/(?:не|not)\s+(?:на\s+)?(?:сьогодні|завтра|вчора|today|tomorrow|yesterday)/giu, '');
  const relative = [...affirmative.matchAll(relativeDays)].map(match => relativeDay(match[0], today));
  const days = new Set([...relative, ...explicitDates(affirmative)]);
  return days.size === 1 ? [...days][0] : undefined;
}

function proposedDayContradiction(response: Response, expected: string, clock: Clock, deadline: boolean): boolean {
  const mutations = [
    ...(Array.isArray(response.tasks) ? response.tasks : []),
    ...(Array.isArray(response.taskUpdates) ? response.taskUpdates : []),
    ...(Array.isArray(response.strategy?.actions) ? response.strategy.actions.map((action: any) => action?.changes) : []),
  ];
  return mutations.some(item => {
    if (!item || typeof item !== 'object') return false;
    const date = deadline ? item.deadlineDate : item.plannedDate;
    if (isTaskDate(date) && date !== expected) return true;
    // An unchanged schedule may coexist with a changed deadline; never equate those fields.
    if (!deadline && typeof item.schedule?.startAt === 'string') {
      const at = Date.parse(item.schedule.startAt);
      return Number.isFinite(at) && localDay(at, clock.timeZone) !== expected;
    }
    return false;
  });
}

function narrativeContradiction(text: string, expected: string, today: string): boolean {
  // Only the proposed day's clauses matter; past events and explanatory comparisons do not.
  const clauses = text.replace(/\*\*/g, '').split(/[!?\n]+|\.(?=\s|$)/u);
  return clauses.some(clause => {
    const historicalReference = /раніше|минул|вчора\s+(?:ви|ти)|(?:ви|ти)\s+(?:планували|запланували|перенесли)|previously|earlier|you\s+(?:planned|scheduled|moved)/iu.test(clause);
    const freshProposal = /пропоную|давайте|зробимо|почнемо|i\s+(?:propose|suggest)|let(?:'s|\s+us)|we\s+(?:will|can)/iu.test(clause);
    if (historicalReference && !freshProposal) return false;
    const futureProposal = /план|заплан|перен[іео]|розкла[дс]|структуру|зробимо|попрацю|почнемо|\b(?:plan|schedule|move|work|start)\b/iu.test(clause);
    if (!futureProposal) return false;
    const affirmative = clause.replace(/(?:не|not)\s+(?:на\s+)?(?:сьогодні|завтра|вчора|today|tomorrow|yesterday)/giu, '');
    const targetMentions = [...affirmative.matchAll(/(?:на|for|on)\s+(сьогодні|завтра|вчора|today|tomorrow|yesterday)|(?:завтра|tomorrow)\s+(?:просто\s+)?(?:зробимо|почнемо|we\s+(?:will|can))/giu)];
    if (targetMentions.some(match => relativeDay(match[1] || match[0], today) !== expected)) return true;
    // Explicit full dates only; a bare day/month or time is deliberately not guessed.
    return explicitDates(affirmative).some(date => date !== expected);
  });
}

/** Reject a contradictory proposal once, without another provider call or fabricated replacement plan. */
export function guardTemporalResponse<T extends Response>(response: T, prompt: string, clock: Clock, isUk: boolean, address: Address = 'vy'): T {
  const now = Date.parse(clock.now);
  if (!Number.isFinite(now)) return response;
  const today = localDay(now, clock.timeZone);
  const expected = requestedDay(prompt, today);
  if (!expected) return response;
  const deadline = /(?:до|by|until)\s+(?:сьогодні|завтра|вчора|today|tomorrow|yesterday|\d)/iu.test(prompt);
  const text = [response.reply, response.summary, response.strategy?.narrative, response.strategy?.nextAction]
    .filter(value => typeof value === 'string').join('\n');
  if (!proposedDayContradiction(response, expected, clock, deadline) && !narrativeContradiction(text, expected, today)) return response;

  const time = new Intl.DateTimeFormat(isUk ? 'uk-UA' : 'en-GB', { timeZone: clock.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  const message = isUk
    ? `Зараз ${today}, ${time} (${clock.timeZone}). ${address === 'ty' ? 'У твоєму' : 'У вашому'} запиті вказано ${expected}, але відповідь ШІ запропонувала інший день. Цю пропозицію відхилено; жодних змін не застосовано. ${address === 'ty' ? 'Спробуй' : 'Спробуйте'} повторити запит, указавши потрібні завдання та дату ${expected}.`
    : `It is ${today}, ${time} (${clock.timeZone}). Your request specifies ${expected}, but the AI proposed a different day. That proposal was rejected; no changes were applied. Please retry with the intended tasks and date ${expected}.`;
  const safe: Response = { ...response, reply: message, summary: message, tasks: [], taskUpdates: [], taskDeletions: [], tabs: [], insights: [] };
  // A rejected response must not update memory or replace an existing saved strategy.
  delete safe.strategy;
  delete safe.workloadDiagnosis;
  delete safe.categoryHealth;
  return safe as T;
}

const ukAppliedClaim = /(^|[.!?\n]\s*)(Я\s+)(?:вже\s+)?(переніс|перенесла|оновив|оновила|додав|додала|створив|створила|запланував|запланувала|видалив|видалила|змінив|змінила|зберіг|зберегла|завершив|завершила|перепланував|перепланувала)(?=\s|[,:.!?]|$)/giu;
const enAppliedClaim = /(^|[.!?\n]\s*)(I\s+)(?:(?:have|already)\s+|have\s+already\s+)?(moved|updated|added|created|scheduled|deleted|changed|saved|completed|rescheduled)(?=\s|[,:.!?]|$)/giu;

const proposedUkVerb: Record<string, string> = {
  переніс: 'перенести', перенесла: 'перенести', оновив: 'оновити', оновила: 'оновити',
  додав: 'додати', додала: 'додати', створив: 'створити', створила: 'створити',
  запланував: 'запланувати', запланувала: 'запланувати', видалив: 'видалити', видалила: 'видалити',
  змінив: 'змінити', змінила: 'змінити', зберіг: 'зберегти', зберегла: 'зберегти',
  завершив: 'завершити', завершила: 'завершити', перепланував: 'перепланувати', перепланувала: 'перепланувати',
};
const proposedEnVerb: Record<string, string> = {
  moved: 'move', updated: 'update', added: 'add', created: 'create', scheduled: 'schedule',
  deleted: 'delete', changed: 'change', saved: 'save', completed: 'complete', rescheduled: 'reschedule',
};

function unappliedClaimText(text: string): { text: string; changed: boolean } {
  let changed = false;
  // Quoted user statements are data. A leading quotation mark/block quote prevents a match.
  const rewritten = text.replace(ukAppliedClaim, (_match, prefix: string, _subject: string, verb: string) => {
    changed = true;
    return `${prefix}Пропоную ${proposedUkVerb[verb.toLocaleLowerCase('uk-UA')]}`;
  }).replace(enAppliedClaim, (_match, prefix: string, _subject: string, verb: string) => {
    changed = true;
    return `${prefix}I propose to ${proposedEnVerb[verb.toLowerCase()]}`;
  });
  return { text: rewritten, changed };
}

/** Whether a response carries anything the Apply button could act on. */
export function hasProposedOperations(response: Response): boolean {
  return ['tasks', 'taskUpdates', 'taskDeletions', 'tabs'].some(field => Array.isArray(response[field]) && response[field].length > 0)
    || Array.isArray(response.strategy?.actions) && response.strategy.actions.length > 0;
}

function refersToApplyControl(text: string): boolean {
  // Quoted history is data. Inspect only instructions voiced by this reply.
  const instructions = text.split('\n').filter(line => !/^\s*(?:>|["«“])/.test(line)).join('\n');
  const directive = /натисн\p{L}*|клацн\p{L}*|клікн\p{L}*|обер\p{L}*|вибер\p{L}*|скорист\p{L}*|\b(?:click|press|tap|select|use)\b/iu;
  const control = /кнопк\p{L}*|\bbutton\b|["«“][^"»”\n]{0,80}(?:застос\p{L}*|підтверд\p{L}*|apply|confirm)[^"»”\n]{0,80}["»”]/iu;
  const apply = /застос\p{L}*|підтверд\p{L}*|\b(?:apply|confirm|confirmation)\b/iu;
  return instructions.split(/[.!?\n]+/u).some(clause => {
    // App help may describe what to do IF a prepared card exists; that does
    // not assert that this answer has created one. A generic "if you want" is not enough.
    const prefix = clause.split(/[,;:—]/u, 1)[0];
    const directiveAt = prefix.search(directive);
    const condition = directiveAt < 0 ? prefix : prefix.slice(0, directiveAt);
    const conditional = /^\s*(?:якщо|коли|після того як|when|if|once)(?![\p{L}\p{N}_])/iu.test(condition);
    const prepared = /(?:підготовлен\p{L}*|запропонован\p{L}*)\s+(?:змін\p{L}*|пропозиц\p{L}*)|картк\p{L}*\s+(?:змін\p{L}*|пропозиц\p{L}*)|\b(?:prepared|valid|proposed)\s+(?:changes|proposal)|\bproposal\s+card\b/iu.test(condition);
    const exists = /(?<![\p{L}\p{N}_])(?:є|буде|бачите|маєте|існу\p{L}*|з['’ʼ]яв\p{L}*|підготовлено|створено)(?![\p{L}\p{N}_])|\b(?:there\s+(?:is|are)|you\s+(?:have|see)|exists|has\s+been\s+prepared)\b/iu.test(condition);
    const absent = /(?:немає|нема|відсутн\p{L}*|без)\s+(?:підготовлен\p{L}*\s+)?(?:змін\p{L}*|пропозиц\p{L}*|картк\p{L}*)|\b(?:no|without)\s+(?:prepared\s+)?(?:changes|proposal|card)\b/iu.test(condition);
    if (conditional && prepared && exists && !absent) return false;
    return directive.test(clause) && control.test(clause) && apply.test(clause);
  });
}

/** At this boundary every returned mutation is still a proposal, including autonomous actions. */
export function guardUnappliedClaims<T extends Response>(response: T, isUk: boolean, address: Address = 'vy'): T {
  const safe: Response = { ...response };
  const hasPendingActions = ['tasks', 'taskUpdates', 'taskDeletions', 'tabs'].some(field => Array.isArray(response[field]) && response[field].length > 0);
  const hasActions = hasPendingActions || Array.isArray(response.strategy?.actions) && response.strategy.actions.length > 0;
  let misleading = false;
  let phantomApplyControl = false;
  for (const field of ['reply', 'summary']) {
    if (typeof safe[field] !== 'string') continue;
    const result = unappliedClaimText(safe[field]);
    misleading ||= result.changed;
    phantomApplyControl ||= !hasPendingActions && refersToApplyControl(safe[field]);
    safe[field] = result.text;
  }
  if (!hasPendingActions) {
    const otherText = [...(Array.isArray(response.insights) ? response.insights : []), response.strategy?.narrative, response.strategy?.nextAction];
    phantomApplyControl ||= otherText.some(text => typeof text === 'string' && refersToApplyControl(text));
    if (!hasActions) misleading ||= otherText.some(text => typeof text === 'string' && unappliedClaimText(text).changed);
  }
  if (!misleading && !phantomApplyControl) return response;
  if (hasProposedOperations(response)) {
    if (phantomApplyControl) {
      const message = isUk ? 'Підготовлено зміни в межах узгодженої стратегії. Результат їх застосування буде показано в чаті.'
        : 'Changes were prepared within the agreed strategy. Their application result will be shown in chat.';
      safe.reply = message;
      safe.summary = message;
      safe.insights = [];
    }
    if (response.strategy) {
      safe.strategy = { ...response.strategy };
      for (const field of ['narrative', 'nextAction']) {
        if (typeof safe.strategy[field] !== 'string') continue;
        if (phantomApplyControl && refersToApplyControl(safe.strategy[field])) delete safe.strategy[field];
        else safe.strategy[field] = unappliedClaimText(safe.strategy[field]).text;
      }
    }
    return safe as T;
  }
  const message = isUk
    ? `У цій відповіді не підготовлено змін до завдань, тому нічого не застосовано. ${address === 'ty' ? 'Уточни' : 'Уточніть'}, які завдання та що саме потрібно змінити.`
    : 'This response contains no prepared task changes, so nothing has been applied. Please specify which tasks to change and what to change.';
  safe.reply = message;
  safe.summary = message;
  safe.insights = [];
  // Do not save a strategy or memory claiming a change that was never proposed.
  delete safe.strategy;
  delete safe.workloadDiagnosis;
  delete safe.categoryHealth;
  return safe as T;
}

// Sentence-level claims that a proposal exists. Each pattern runs on one normalized
// sentence, so ^ is its start; a negated claim ("я не підготував") never matches.
const lead = String.raw`^(?:(?:добре|гаразд|готово|отже|тож|ок|окей|так|ok(?:ay)?|done|alright|sure|so)[,!.:]?\s+)?`;
const preparedClaims = [
  new RegExp(String.raw`${lead}(?:я\s+)?(?:вже\s+|щойно\s+|також\s+)?(?:підготува(?:в|ла)|сформува(?:в|ла)|склав|склала)\s+(?:для\s+(?:вас|тебе)\s+)?(?:\p{L}+\s+){0,2}?(?:пропозиці|змін|видаленн|архівуванн|перенесенн|оновленн|створенн|операці|очищенн)`, 'iu'),
  // Passive forms only open a sentence: "комерційна пропозиція готова" is about the person's work.
  /^(?:пропозиці\p{L}*|змін[иау]?|видаленн\p{L}*|архівуванн\p{L}*)\s+(?:вже\s+)?(?:сформовано|підготовлено|підготовлен[аі]|готов[аі])(?![\p{L}])/iu,
  new RegExp(String.raw`${lead}(?:I(?:'ve|\s+have)?\s+)?(?:already\s+|just\s+)?(?:prepared|drafted|queued)\s+(?:(?:the|a|an|your|these|this)\s+)?(?:\w+\s+){0,2}?(?:proposal|changes?|deletion|archiv|update|removal|move)`, 'iu'),
  /^(?:the\s+)?(?:proposal|changes?)\s+(?:is|are)\s+(?:now\s+)?(?:ready|prepared)(?![\p{L}])/iu,
  /^proposal\s+(?:prepared|ready)(?![\p{L}])/iu,
];
// Only on an operation route, where the prose exists to describe the attached proposal.
const operationRouteClaims = [
  new RegExp(String.raw`${lead}(?:я\s+)?пропоную\s+(?:\p{L}+\s+)?(?:архівувати|заархівувати|видалити|перенести|запланувати|створити|додати|змінити|оновити|зберегти|встановити|поставити|позначити|завершити|перейменувати|розбити|запустити|прибрати)(?![\p{L}])`, 'iu'),
  new RegExp(String.raw`${lead}(?:зараз\s+|давайте\s+)?(?:я\s+)?(?:архівую|заархівую|видаляю|видалю|переношу|перенесу|створюю|створю|додаю|додам|змінюю|зміню|оновлюю|оновлю|запланую|позначаю|позначу|ставлю|поставлю|встановлюю|встановлю|перейменовую|перейменую|прибираю|приберу|архівуємо|заархівуємо|видаляємо|видалимо|переносимо|перенесемо|створюємо|створимо|додаємо|додамо|змінюємо|змінимо|оновлюємо|оновимо|заплануємо|позначимо|поставимо|встановимо|перейменуємо|приберемо)(?![\p{L}])`, 'iu'),
  /^(?:ось|нижче)\s+(?:\p{L}+\s+)?(?:пропозиці\p{L}*|змін[иа]?)(?![\p{L}])/iu,
  new RegExp(String.raw`${lead}I\s+(?:propose|suggest|would\s+suggest)\s+(?:to\s+)?(?:archiv|delet|remov|mov|reschedul|schedul|creat|add|chang|updat|renam|mark|complet|set|sav)\w*`, 'iu'),
  new RegExp(String.raw`${lead}(?:I(?:'ll|\s+will)|I'm|I\s+am|let(?:'s|\s+us))\s+(?:now\s+)?(?:archiv|delet|remov|mov|reschedul|schedul|creat|add|chang|updat|renam|mark|complet|set|sav)\w*`, 'iu'),
  /^here(?:'s|\s+is|\s+are)\s+(?:the\s+|my\s+|your\s+)?(?:\w+\s+)?(?:proposal|changes)/iu,
  /(?:^|[^\p{L}])(?:буде|будуть)\s+(?:\p{L}+\s+)?(?:архівовано|заархівовано|видалено|перенесено|створено|додано|змінено|оновлено|заплановано|позначено|перейменовано)(?![\p{L}])/iu,
  /(?:^|[^\p{L}])will\s+be\s+(?:archived|deleted|removed|moved|rescheduled|scheduled|created|added|changed|updated|renamed|marked|completed)(?![\p{L}])/iu,
];
// "Press Apply" and passive claims count unless the sentence is a general how-to explanation
// ("Коли ШІ підготує пропозицію…", "Щоб застосувати…"); "Якщо все гаразд, натисніть…" still counts.
const applyInstruction = /(?:^|[^\p{L}])(?:натисніть|натисни|тисніть|клацніть|клацни|оберіть|скористайтеся|використайте|press|click|tap|hit|use)\s+(?:на\s+|on\s+)?(?:кнопку\s+|the\s+)?(?:button\s+)?[«"“„']?\s*(?:застосувати|apply)(?![\p{L}])/iu;
const generalExplanation = /^(?:якщо|коли|щоб|після\s+того|як\s+тільки|if|when|once|to\s+apply|after)(?![\p{L}])(?!,?\s+(?:все|усе|вас\s+(?:все|усе)|ви\s+згодні|згодні|погоджуєтес[ья]|everything|you\s+agree|(?:it|this|that)\s+looks))/iu;
// A yes/no confirmation of a change. "Так" on the next turn cannot name a target, so
// without an attached proposal the question is a dead end.
const confirmationStart = /^(?:(?:то|тож|отже|ну|добре|гаразд|so)[,]?\s+)?(?:чи\s+)?(?:виконати|застосувати|прийняти|підтверджуєте|підтверджуєш|підтвердите|підтвердиш|підтвердити|зберегти|видалити|архівувати|заархівувати|перенести|запланувати|створити|додати|змінити|оновити|внести|робимо|виконуємо|застосовуємо|видаляємо|архівуємо|переносимо|(?:shall|should|can|may)\s+I\s+(?:go\s+ahead|proceed|apply|delete|archive|remove|move|reschedule|update|change|create|add|save|carry\s+out|execute|prepare)|(?:do\s+you\s+)?(?:confirm|approve)|(?:apply|accept|save)\s+(?:these|this|the|those)|proceed|go\s+ahead|ready\s+to\s+(?:apply|proceed))(?![\p{L}])/iu;
const confirmationAnywhere = [
  /(?:хочете|бажаєте|хочеш|бажаєш),?\s+щоб\s+я\s+(?:\p{L}+\s+)?(?:виконав|виконала|застосував|застосувала|видалив|видалила|архівував|архівувала|заархівував|заархівувала|переніс|перенесла|змінив|змінила|оновив|оновила|створив|створила|додав|додала|запланував|запланувала|зберіг|зберегла|підготував|підготувала|вніс|внесла)(?![\p{L}])/iu,
  /(?:згодні|згоден|згодна|погоджуєтеся|погоджуєтесь|погоджуєшся)\s+(?:з|із|на)\s+(?:\p{L}+\s+){0,2}(?:змін|пропозиці|видаленн|архівуванн|очищенн|перенесенн)/iu,
  /(?:^|[^\p{L}])(?:do\s+you\s+want|would\s+you\s+like|want)\s+me\s+to\s+(?:go\s+ahead|proceed|apply|delete|archive|remove|move|reschedule|update|change|create|add|save|carry\s+out|execute|prepare)(?![\p{L}])/iu,
  /(?:^|[^\p{L}])(?:ok(?:ay)?|agree)\s+with\s+(?:these|this|the)\s+(?:changes?|proposal)(?![\p{L}])/iu,
];
const confirmationImperative = /^(?:будь\s+ласка,?\s+)?(?:підтвердіть|підтверди|please\s+confirm)(?![\p{L}])/iu;
const alternative = /(?:^|[^\p{L}])(?:чи|або|or)(?![\p{L}])/iu;

/** Questions offering alternatives are filtered out before this check. */
function confirmationRequest(sentence: string): boolean {
  return confirmationImperative.test(sentence)
    || /\?\s*$/u.test(sentence) && (confirmationStart.test(sentence) || confirmationAnywhere.some(pattern => pattern.test(sentence)));
}

// An offer to make a concrete change ("Додати ці кроки до «Інтро»?", "Хочеш, я розіб'ю…?",
// "Shall I add…?"), unlike a confirmation of an existing proposal ("Застосувати?", "Proceed?").
// A yes to it is carried over into a scoped proposal request (classifyPersonalChatRequest).
const offerLead = String.raw`^(?:(?:то|тож|отже|ну|добре|гаразд|так|окей|ок|so|ok(?:ay)?)[,]?\s+)?`;
const offerInfinitives = 'додати|створити|змінити|оновити|перенести|запланувати|розбити|розділити|поставити|встановити|налаштувати|запустити|видалити|архівувати|заархівувати|перейменувати|позначити|прибрати|оформити|записати';
const offerPast = 'додав|додала|створив|створила|змінив|змінила|оновив|оновила|переніс|перенесла|запланував|запланувала|розбив|розбила|розділив|розділила|поставив|поставила|встановив|встановила|налаштував|налаштувала|запустив|запустила|видалив|видалила|архівував|архівувала|заархівував|заархівувала|перейменував|перейменувала|позначив|позначила|прибрав|прибрала|підготував|підготувала|оформив|оформила|записав|записала';
const offerFuture = 'додам|створю|зміню|оновлю|перенесу|запланую|розіб[\'’ʼ]?ю|розділю|поставлю|встановлю|налаштую|запущу|видалю|архівую|заархівую|перейменую|позначу|приберу|підготую|оформлю|запишу|додамо|створимо|змінимо|оновимо|перенесемо|заплануємо|розіб[\'’ʼ]?ємо|розділимо|поставимо|встановимо|налаштуємо|запустимо|видалимо|заархівуємо|перейменуємо|приберемо|оформимо|запишемо';
const offerEnglish = 'add|create|change|update|move|reschedule|schedule|split|break|set|start|configure|delete|archive|remove|rename|mark|turn|put|make|prepare';
const changeOfferPatterns = [
  new RegExp(String.raw`${offerLead}(?:чи\s+)?(?:(?:я|ми)\s+)?(?:(?:можу|можемо|міг\s+би|могла\s+б|можна)\s+)?(?:одразу\s+|зараз\s+|також\s+)?(?:${offerInfinitives})(?![\p{L}])`, 'iu'),
  new RegExp(String.raw`(?:^|[^\p{L}])(?:хочете|хочеш|бажаєте|бажаєш)[,]?\s+(?:щоб\s+)?(?:я|ми)\s+(?:\p{L}+\s+)?(?:${offerPast}|${offerFuture})(?![\p{L}])`, 'iu'),
  new RegExp(String.raw`${offerLead}(?:(?:може|можливо|давай|давайте)[,]?\s+)?(?:(?:я|ми)\s+)?(?:${offerFuture})(?![\p{L}])`, 'iu'),
  new RegExp(String.raw`(?:^|[^\p{L}])(?:shall|should|can|may)\s+(?:I|we)\s+(?:also\s+|now\s+)?(?:${offerEnglish})(?![\p{L}])`, 'iu'),
  new RegExp(String.raw`(?:^|[^\p{L}])(?:do\s+you\s+want|would\s+you\s+like|want)\s+me\s+to\s+(?:also\s+)?(?:${offerEnglish})(?![\p{L}])`, 'iu'),
  new RegExp(String.raw`${offerLead}(?:${offerEnglish})\s+(?:these|this|it|them|the)(?![\p{L}])`, 'iu'),
];
const plainSentence = (sentence: string) => sentence.replace(/[*_`]+/g, '').replace(/^\s*(?:[-•–]\s+|\d+[.)]\s+|#+\s+)/u, '').trim();

/** One sentence that offers a concrete task change as a yes/no question (not a choice between options). */
export function changeOfferQuestion(sentence: string): boolean {
  const plain = plainSentence(sentence);
  if (!/\?\s*$/u.test(plain) || alternative.test(plain.replace(/^чи\s+/iu, ''))) return false;
  return changeOfferPatterns.some(pattern => pattern.test(plain));
}

/** The last change offer in an assistant reply (an optional [DD.MM HH:MM] history prefix is ignored). */
export function lastChangeOffer(text: unknown): string | undefined {
  if (typeof text !== 'string') return undefined;
  const sentences = text.replace(/^\s*\[\d{2}\.\d{2}\s+\d{2}:\d{2}\]\s*/u, '').split('\n')
    .filter(line => !/^\s*>/.test(line)).flatMap(line => line.split(/(?<=[.!?…])\s+/u)).map(plainSentence);
  return sentences.filter(changeOfferQuestion).at(-1);
}

/** Classify every sentence; quoted lines (block quotes, an opening quotation mark) are data. */
function operationClaims(text: string, operationRoute: boolean, offersCanFollow = false) {
  let strong = false;
  let weak = false;
  const lines = text.split('\n').map(line => {
    if (/^\s*>/.test(line)) return line;
    const sentences = line.split(/(?<=[.!?…])\s+/u);
    const kept = sentences.filter(sentence => {
      const plain = plainSentence(sentence);
      if (!plain || /^[«"“„']/u.test(plain)) return true;
      // A question offering alternatives ("… «Звіт» чи «Звіт 2»?") is a clarification; a leading "Чи" is not.
      if (/\?\s*$/u.test(plain) && alternative.test(plain.replace(/^чи\s+/iu, ''))) return true;
      // Where a yes is carried over into a proposal request, an offer is a real next step.
      if (offersCanFollow && changeOfferQuestion(plain)) return true;
      const general = generalExplanation.test(plain);
      if (!general && (preparedClaims.some(pattern => pattern.test(plain)) || operationRoute && operationRouteClaims.some(pattern => pattern.test(plain)))) {
        strong = true;
        return false;
      }
      if (applyInstruction.test(plain) && !general || confirmationRequest(plain)) {
        weak = true;
        return false;
      }
      return true;
    });
    return kept.length === sentences.length ? line : kept.join(' ').trimEnd();
  });
  return { strong, weak, remainder: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() };
}

/**
 * A reply must not describe a proposal the person cannot apply. Runs on the final,
 * validated response (after the scope filters); the streamed draft is replaced by
 * the `done` reply. A response with operations is returned unchanged. Without them:
 * - a claim that changes were prepared (on an operation route also a description of
 *   the proposal, e.g. "Пропоную архівувати…") replaces the whole reply;
 * - an Apply instruction or a yes/no confirmation question alone: those sentences are
 *   removed and an honest note is appended.
 * operationsDropped: the model proposed operations that the scope filter removed.
 * offersCanFollow: the person's yes to an offer of a concrete change ("Додати ці кроки
 * до «Інтро»?") is carried over into a proposal request, so such an offer is kept.
 * address: the person's Ukrainian form of address for the app-written note (default "ви").
 */
export function guardOperationlessReply<T extends Response>(response: T, isUk: boolean, options: { operationRoute?: boolean; operationsDropped?: boolean; offersCanFollow?: boolean; address?: Address } = {}): T {
  if (hasProposedOperations(response) || typeof response.reply !== 'string') return response;
  const claims = operationClaims(response.reply, options.operationRoute === true, options.offersCanFollow === true);
  if (!claims.strong && !claims.weak) return response;
  const ty = options.address === 'ty';
  const noChanges = isUk
    ? `Змін до завдань не підготовлено, тому застосовувати нічого. Щоб отримати пропозицію, ${ty ? 'напиши' : 'напишіть'}, що саме зробити, і ${ty ? 'назви' : 'назвіть'} потрібні завдання точніше.`
    : 'I did not prepare any task changes, so there is nothing to apply. To get a proposal, say what to do and name the tasks precisely.';
  const dropped = droppedOperationsReply(isUk, options.address);
  const meaningful = claims.remainder.replace(/[^\p{L}\p{N}]+/gu, '').length >= 12;
  const reply = options.operationsDropped ? dropped
    : claims.strong || !meaningful ? noChanges
      : `${claims.remainder}\n\n${noChanges}`;
  return { ...response, reply, summary: reply };
}

/** The model proposed a change for a task outside the request's scope: what is missing is which task. */
export function droppedOperationsReply(isUk: boolean, address: Address = 'vy'): string {
  if (!isUk) return 'I could not determine exactly which task to change, so nothing was prepared. Name the task more precisely and I will prepare a proposal.';
  return `Не вдалося визначити, яке саме завдання змінити, тому змін не підготовлено. ${address === 'ty' ? 'Назви' : 'Назвіть'} завдання точніше — і я підготую пропозицію.`;
}

/** A yes to a proposal from an earlier conversation, which can no longer be applied. */
export function staleProposalReply(isUk: boolean, address: Address = 'vy'): string {
  if (!isUk) return 'This earlier proposal can no longer be applied. Please repeat the request or name the intended tasks and date so I can prepare current changes.';
  return address === 'ty'
    ? 'Ця пропозиція з попередньої розмови вже неактуальна для застосування. Повтори, будь ласка, сам запит або назви потрібні завдання й дату — я підготую актуальні зміни.'
    : 'Ця пропозиція з попередньої розмови вже неактуальна для застосування. Повторіть, будь ласка, сам запит або назвіть потрібні завдання й дату — я підготую актуальні зміни.';
}

/** A scheduling command with a date but no identifiable tasks. */
export function taskScopeClarificationReply(isUk: boolean, address: Address = 'vy'): string {
  if (!isUk) return 'Which tasks should be scheduled for the date you requested? Name them so I can prepare changes for the intended tasks.';
  return address === 'ty'
    ? 'Які саме завдання потрібно запланувати на вказану тобою дату? Назви їх, щоб я підготував зміни для потрібних завдань.'
    : 'Які саме завдання потрібно запланувати на вказану вами дату? Назвіть їх, щоб я підготував зміни для потрібних завдань.';
}
