import { isTaskDate } from '../src/utils/taskDates';

type Clock = { now: string; timeZone: string };
type Response = Record<string, any>;

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
export function guardTemporalResponse<T extends Response>(response: T, prompt: string, clock: Clock, isUk: boolean): T {
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
    ? `Зараз ${today}, ${time} (${clock.timeZone}). У вашому запиті вказано ${expected}, але відповідь ШІ запропонувала інший день. Цю пропозицію відхилено; жодних змін не застосовано. Спробуйте повторити запит, указавши потрібні завдання та дату ${expected}.`
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

/** At this boundary every returned mutation is still a proposal, including autonomous actions. */
export function guardUnappliedClaims<T extends Response>(response: T, isUk: boolean): T {
  const safe: Response = { ...response };
  let misleading = false;
  for (const field of ['reply', 'summary']) {
    if (typeof safe[field] !== 'string') continue;
    const result = unappliedClaimText(safe[field]);
    misleading ||= result.changed;
    safe[field] = result.text;
  }
  if (!misleading) return response;
  const hasActions = ['tasks', 'taskUpdates', 'taskDeletions', 'tabs'].some(field => Array.isArray(response[field]) && response[field].length > 0)
    || Array.isArray(response.strategy?.actions) && response.strategy.actions.length > 0;
  if (hasActions) {
    if (response.strategy) {
      safe.strategy = { ...response.strategy };
      for (const field of ['narrative', 'nextAction']) {
        if (typeof safe.strategy[field] === 'string') safe.strategy[field] = unappliedClaimText(safe.strategy[field]).text;
      }
    }
    return safe as T;
  }
  const message = isUk
    ? 'У цій відповіді не підготовлено змін до завдань, тому нічого не застосовано. Уточніть, які завдання та що саме потрібно змінити.'
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
