import type { AIStrategyResponse, PersonalStrategyProfile, StrategyDiscoveryEvidence, StrategyDiscoveryPatch, StrategyDiscoveryState, StrategyDiscoveryTopic, StrategyDiscoveryTopicState } from '../types';

export const STRATEGY_DISCOVERY_TOPICS: StrategyDiscoveryTopic[] = ['direction', 'motivation', 'circumstances', 'barriers', 'capacity', 'attempts'];
const required = new Set<StrategyDiscoveryTopic>(['direction', 'motivation', 'barriers', 'capacity']);
const isRecord = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const clean = (value: unknown, max = 8000): string => typeof value === 'string' ? value.trim().slice(0, max) : '';
const uniqueIds = (value: unknown, limit = 200): string[] => Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && !!id.trim()).map(id => id.trim()).slice(0, limit))] : [];
const isTopic = (value: unknown): value is StrategyDiscoveryTopic => STRATEGY_DISCOVERY_TOPICS.includes(value as StrategyDiscoveryTopic);
const strictYes = (value: string) => /^(?:так|погоджуюсь|погоджуюся|підтверджую|узгоджую|yes|agreed|confirm|i agree)[.!\s]*$/iu.test(value.trim());
const uncertain = (value: string) => /^(?:не знаю|не впевнен[аий]*|важко сказати|i don['’]?t know|not sure|maybe|можливо)[.!\s]*$/iu.test(value.trim());
const decline = (value: string) => /(?:не хочу (?:про це|розповідати|обговорювати|відповідати|ділитися)|не готов[аий]* (?:обговорювати|ділитися|розповідати)|особисте|приватн|пропуст(?:имо|ити)|skip (?:this|that)|prefer not|rather not|private|don['’]?t want to (?:share|discuss|answer))/iu.test(value);
const questionText: Record<StrategyDiscoveryTopic, string> = {
  direction: 'Що ви хотіли б змінити у своєму житті й чому це для вас важливо?',
  motivation: 'Що ця зміна дасть саме вам і чому це для вас важливо?',
  circumstances: 'Які обставини вашого життя зараз впливають на цю ціль?',
  barriers: 'Що зараз найчастіше заважає вам почати або продовжити важливу справу?',
  capacity: 'Скільки часу й сил ви реально можете виділити зараз, з урахуванням відпочинку та інших справ?',
  attempts: 'Що ви вже пробували для цієї зміни й що з цього допомогло? Якщо ще нічого — це теж важлива відповідь.',
};
const practicalQuestion: Partial<Record<StrategyDiscoveryTopic, string>> = {
  direction: 'Особистими подробицями можна не ділитися. Яку одну конкретну справу ви хотіли б полегшити зараз?',
  motivation: 'Без приватних подробиць: який корисний результат дала б одна конкретна справа, з якою ви хочете допомоги?',
  barriers: 'Приватні подробиці залишимо осторонь. Якщо зручно, згадайте одну справу, яку важко почати: що відбувається безпосередньо перед цим?',
  capacity: 'Без особистих подробиць: який мінімальний обсяг однієї справи зараз був би для вас посильним?',
};
export const missingStrategyDiscoveryTopics = (state: StrategyDiscoveryState): StrategyDiscoveryTopic[] => [
  ...STRATEGY_DISCOVERY_TOPICS.filter(topic => state.topics[topic].status === 'unknown'),
  ...STRATEGY_DISCOVERY_TOPICS.filter(topic => required.has(topic) && state.topics[topic].status === 'deferred'),
];
const missingTopic = (state: StrategyDiscoveryState): StrategyDiscoveryTopic | undefined => missingStrategyDiscoveryTopics(state)[0];
export function discoveryQuestionForState(state: StrategyDiscoveryState, topic: StrategyDiscoveryTopic, lang: 'uk' | 'en' = 'uk'): string {
  if (lang === 'en') {
    const questions: Record<StrategyDiscoveryTopic, string> = {
      direction: 'What would you like to change in your life, and why does it matter to you?',
      motivation: 'What would this change mean for you personally, and why does that matter?',
      circumstances: 'What in your current life situation affects this goal?',
      barriers: 'The last time you put off something important, what happened just before you switched to something else?',
      capacity: 'How much time and energy can you realistically make available now, allowing for rest and other responsibilities?',
      attempts: 'What have you tried for this change, and what helped, including if you have not tried anything yet?',
    };
    const practical: Partial<Record<StrategyDiscoveryTopic, string>> = {
      direction: 'We can leave private details aside. Which concrete task would you like help with?',
      motivation: 'Personal reasons can stay private. What practical result of this task would be useful to you?',
      barriers: 'Private details can stay private. At which specific point in this task is it hardest to continue?',
      capacity: 'Without personal details, what amount of work feels manageable now, allowing for rest?',
    };
    if (state.topics[topic].status !== 'deferred') return questions[topic];
    return state.topics[topic].evidence.filter(entry => decline(entry.quote)).length > 1
      ? 'We can leave this topic aside until you choose to return to it. Which concrete task would you like help with now?'
      : practical[topic] || questions[topic];
  }
  if (state.topics[topic].status !== 'deferred') return questionText[topic];
  return state.topics[topic].evidence.filter(entry => decline(entry.quote)).length > 1
    ? 'Можемо відкласти цю тему й повернутися до неї лише за вашим бажанням. З якою конкретною справою допомогти зараз?'
    : practicalQuestion[topic] || questionText[topic];
}
const nextQuestion = (state: StrategyDiscoveryState, topic: StrategyDiscoveryTopic) => discoveryQuestionForState(state, topic);
/** Topic-specific anchors prevent a list of wishes from becoming six invented answers. */
const anchors: Record<StrategyDiscoveryTopic, RegExp> = {
  direction: /(?:хочу|прагну|ціл[ьиі]|мет[аиу]|мрі[яю]|змінити|want|goal|aim|wish|change)/iu,
  motivation: /(?:тому що|тому,? що|бо\s|щоб\s|заради|важлив|сенс|потрібно.*(?:для|через)|because|matters|important|so that|in order|for my)/iu,
  circumstances: /(?:працюю|навчаюсь|навчаюся|маю.*(?:робот|сім|діт|дитин)|сім['’]?я|родин|доглядаю|живу|мешкаю|переїх|мій графік|обставин|i work|i study|my family|my children|i live|caregiv|my schedule)/iu,
  barriers: /(?:заважа|гальму|відволік|прокраст|відкладаю|страх|боюс|боя|бої|ляка|тривог|важко|незрозум|не можу|не знаю.*почати|граю|дивлюс.*(?:ют[ую]б|youtube)|перемика|barrier|distract|avoid|procrast|afraid|anxious|stuck|hard|unclear|cannot|can['’]?t|i play)/iu,
  capacity: /(?:маю.*(?:час|сил|енергі)|немає.*(?:час|сил)|годин|хвилин|[0-9]+\s*(?:хв|год|min|hour)|втом|сплю|відпочива|завантажен|i have.*(?:time|energy)|no (?:time|energy)|minute|hour|tired|i sleep|capacity)/iu,
  attempts: /(?:пробува|спроб|намаг|раніше|вже роби|допомог|не допомог|нічого.*(?:роб|проб)|ще не|поки не|tried|attempt|previous|helped|nothing yet|never tried|haven['’]?t tried)/iu,
};
function meaningful(topic: StrategyDiscoveryTopic, quote: string, asked: StrategyDiscoveryTopic | undefined): boolean {
  if (!quote || strictYes(quote) || uncertain(quote) || decline(quote)) return false;
  if (/^(?:можливо|мабуть|припускаю|може бути|perhaps|maybe)(?:\s|,|$)/iu.test(quote.trim())) return false;
  if (topic === 'direction' && /(?:не хочу|не прагну|don['’]?t want)/iu.test(quote)) return false;
  if (topic === 'motivation' && /(?:не важливо|неважливо|не має.*сенсу|немає.*сенсу|doesn['’]?t matter|not important)/iu.test(quote)) return false;
  if (asked === 'attempts' && topic === 'attempts' && /^(?:нічого|ще нічого|жодних|none|nothing)[.!\s]*$/iu.test(quote)) return true;
  const wish = /^(?:я\s+)?(?:б\s+)?(?:хочу|хотів(?:\s+би|\s+б)?|хотіла(?:\s+б)?|хотілося\s+б|прагну|мрію|want|i want|i wish|i would like|would like)(?:\s|$)/iu.test(quote.trim());
  // A wish to manage time or play fewer games does not tell us the person's actual capacity or barrier.
  if (wish && topic !== 'direction' && topic !== 'motivation') return false;
  if (topic === 'barriers') {
    // Naming procrastination alone does not describe an actual situation or obstacle.
    if (/(?:не\s+(?:граю|дивлюс|відкладаю|прокраст|відволікаю)|don['’]?t\s+(?:play|watch|procrastinate|get distracted))/iu.test(quote)) return false;
    const length = quote.split(/\s+/u).length;
    const concreteFeeling = /(?:боюс|боя|бої|ляка|страх|незрозум|не знаю.*почати|afraid|unclear)/iu.test(quote);
    return (length >= 3 && concreteFeeling || length >= 4 && /(?:коли|перед|після|замість|останн|сідаю|почина|відкрив|граю|дивлюс|перемика|втом|when|before|after|instead|last time|i play|i watch|switch|tired)/iu.test(quote)) && anchors.barriers.test(quote);
  }
  if (topic === 'capacity') {
    const actualAvailability = /(?:можу|виділ|маю.*(?:час|сил|енергі|хв|год)|немає.*(?:час|сил)|(?:сил|енергі).*немає|i have.*(?:time|energy)|i can|available|no (?:time|energy))/iu.test(quote);
    const timeAmount = /(?:\d+|одн[ау]|дв[аі]|три|пів)\s*(?:годин|хвилин|год|хв|hour|minute|min)/iu.test(quote);
    return anchors.capacity.test(quote) && (actualAvailability || asked === 'capacity' && timeAmount);
  }
  if (anchors[topic].test(quote)) return true;
  if (asked === 'direction' && topic === 'direction' && quote.split(/\s+/u).length >= 2) return true;
  // A direct, substantive answer need not repeat the wording of the question.
  return asked === topic && quote.split(/\s+/u).length >= 4 && !wish;
}
function groundedAnswer(topic: StrategyDiscoveryTopic, quote: string, fullText: string, asked: StrategyDiscoveryTopic | undefined): boolean {
  // Validate the containing clause, not an isolated word supplied by the model. Negation stays attached.
  if (/^(?:я\s+)?(?:можливо|мабуть|припускаю|може бути|perhaps|maybe)(?:\s|,|$)/iu.test(fullText)) return false;
  const clauses = fullText.split(/[.!?;\n]+|\s+(?:але|бо|тому,? що|тому що|but|because)\s+/iu).map(item => item.trim()).filter(Boolean);
  const spansClauses = quote === fullText || !clauses.some(clause => clause.includes(quote));
  const candidates = spansClauses ? clauses : clauses.filter(clause => clause.includes(quote));
  return candidates.some(clause => meaningful(topic, clause, asked) && (spansClauses || meaningful(topic, quote, asked)));
}
function emptyTopics(): StrategyDiscoveryState['topics'] {
  return Object.fromEntries(STRATEGY_DISCOVERY_TOPICS.map(topic => [topic, { status: 'unknown', evidence: [] }])) as StrategyDiscoveryState['topics'];
}
function evidence(value: unknown): StrategyDiscoveryEvidence[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.filter(isRecord).flatMap(item => {
    const quote = clean(item.quote), messageId = clean(item.messageId, 200);
    const key = `${messageId}:${quote}`;
    if (!quote || !messageId || seen.has(key)) return [];
    seen.add(key);
    return [{ quote, messageId }];
  }).slice(-100);
}
const covered = (state: StrategyDiscoveryState) => STRATEGY_DISCOVERY_TOPICS.every(topic => {
  const answer = state.topics[topic];
  return answer.evidence.length > 0 && (answer.status === 'answered' || !required.has(topic) && answer.status === 'deferred');
});
/** Task links added by an authorized plan are operational data, not a changed life goal. */
function fingerprint(profile: PersonalStrategyProfile, state: StrategyDiscoveryState): string {
  const payload = JSON.stringify({ goals: state.selectedGoalIds.map(id => profile.goals.find(goal => goal.id === id)).filter(Boolean).map(goal => ({
    id: goal!.id, title: goal!.title, motive: goal!.motive, categoryIds: [...goal!.categoryIds].sort(),
  })), topics: STRATEGY_DISCOVERY_TOPICS.map(topic => ({ topic, ...state.topics[topic] })) });
  let hash = 2166136261;
  for (let index = 0; index < payload.length; index++) hash = Math.imul(hash ^ payload.charCodeAt(index), 16777619);
  return `discovery-v1:${(hash >>> 0).toString(16)}`;
}
export function normalizeStrategyDiscovery(profile: PersonalStrategyProfile): StrategyDiscoveryState {
  const raw = profile.discovery;
  const topics = emptyTopics();
  if (raw?.version === 1 && isRecord(raw.topics)) {
    for (const topic of STRATEGY_DISCOVERY_TOPICS) {
      const item = raw.topics[topic];
      if (!isRecord(item)) continue;
      const grounded = evidence(item.evidence);
      const status = grounded.length && ['answered', 'deferred'].includes(item.status) ? item.status as StrategyDiscoveryTopicState['status'] : 'unknown';
      topics[topic] = { status, evidence: grounded };
    }
  } else {
    // Older completion/agreement flags carry no interview authority. Only retained full user quotes may help.
    for (const entry of [...profile.facts, ...profile.barriers, ...profile.preferences]) {
      if (entry.source !== 'user' || !entry.messageId || !entry.quote) continue;
      for (const topic of STRATEGY_DISCOVERY_TOPICS) if (meaningful(topic, entry.quote, undefined)) {
        topics[topic] = { status: 'answered', evidence: [...topics[topic].evidence, { quote: entry.quote, messageId: entry.messageId }] };
      }
    }
  }
  const selectedGoalIds = uniqueIds(raw?.selectedGoalIds).filter(id => profile.goals.some(goal => goal.id === id));
  const state: StrategyDiscoveryState = { version: 1, topics, selectedGoalIds, processedTurnIds: uniqueIds(raw?.processedTurnIds, 100000), phase: 'exploring' };
  if (isRecord(raw?.pendingQuestion) && isTopic(raw.pendingQuestion.topic) && clean(raw.pendingQuestion.text) && clean(raw.pendingQuestion.id)) {
    state.pendingQuestion = { id: clean(raw.pendingQuestion.id, 200), topic: raw.pendingQuestion.topic, text: clean(raw.pendingQuestion.text), ...(raw.pendingQuestion.turnId ? { turnId: clean(raw.pendingQuestion.turnId, 200) } : {}) };
  }
  const summary = raw?.pendingSummary;
  const scopeValid = selectedGoalIds.length > 0 && uniqueIds(summary?.goalIds).join('|') === selectedGoalIds.join('|');
  if (!state.pendingQuestion && covered(state) && scopeValid && summary && clean(summary.id) && clean(summary.text) && summary.fingerprint === fingerprint(profile, state)) {
    const confirmed = summary.confirmed === true && selectedGoalIds.every(id => profile.goals.some(goal => goal.id === id && goal.agreed));
    state.pendingSummary = { id: clean(summary.id, 200), text: clean(summary.text), goalIds: selectedGoalIds, fingerprint: summary.fingerprint, confirmed };
    state.phase = state.pendingSummary.confirmed ? 'ready' : 'confirming';
  }
  if (state.phase === 'exploring' && !state.pendingQuestion) {
    const missing = missingTopic(state);
    if (missing) state.pendingQuestion = { id: `discovery:${missing}`, topic: missing, text: nextQuestion(state, missing) };
  }
  return state;
}
export const isPersonalStrategyReady = (profile: PersonalStrategyProfile): boolean => normalizeStrategyDiscovery(profile).phase === 'ready';
export const nextStrategyDiscoveryTopic = (profile: PersonalStrategyProfile): StrategyDiscoveryTopic | undefined => {
  const state = normalizeStrategyDiscovery(profile);
  return missingTopic(state) ?? (state.selectedGoalIds.length ? undefined : 'direction');
};
export function continueStrategyDiscovery(profile: PersonalStrategyProfile, lang: 'uk' | 'en' = 'uk'): PersonalStrategyProfile {
  const discovery = normalizeStrategyDiscovery(profile);
  return { ...profile, onboardingStatus: 'in_progress', phase: 'exploring', discovery: { ...discovery, phase: 'exploring',
    topics: { ...discovery.topics, barriers: { ...discovery.topics.barriers, status: 'unknown' } }, pendingSummary: undefined,
    pendingQuestion: { id: `continue:${discovery.processedTurnIds.length}:${discovery.topics.barriers.evidence.length}`, topic: 'barriers', text: lang === 'uk' ? questionText.barriers : 'What most often gets in the way of starting or continuing something important right now?' } } };
}
/** A user's correction is a new source; an earlier understanding summary cannot approve it. */
export function updateDiscoveryEvidence(profile: PersonalStrategyProfile, topic: StrategyDiscoveryTopic, value: string): PersonalStrategyProfile {
  const discovery = normalizeStrategyDiscovery(profile);
  const previous = discovery.topics[topic];
  const quote = clean(value);
  if (previous.evidence.at(-1)?.quote === quote) return profile;
  const status: StrategyDiscoveryTopicState['status'] = !quote ? 'unknown' : decline(quote) ? 'deferred' : meaningful(topic, quote, topic) ? 'answered' : 'unknown';
  const corrected = { ...discovery, topics: { ...discovery.topics, [topic]: { status,
    evidence: quote ? [...previous.evidence.slice(0, -1), { quote, messageId: `memory-edit:${topic}` }] : [] } },
    pendingQuestion: undefined, pendingSummary: undefined, phase: 'exploring' as const };
  const updated = { ...profile, discovery: corrected, onboardingStatus: 'in_progress' as const, phase: 'exploring' };
  return { ...updated, discovery: normalizeStrategyDiscovery(updated) };
}
export function preparePersonalDiscoveryRequest(profile: PersonalStrategyProfile, userText: string, confirmationId?: string): { profile: PersonalStrategyProfile; discovery: StrategyDiscoveryState; confirmedSummaryId?: string } {
  let discovery = normalizeStrategyDiscovery(profile);
  let updated = profile;
  let confirmedSummaryId: string | undefined;
  if (discovery.phase === 'confirming' && discovery.pendingSummary && !discovery.pendingQuestion && confirmationId === discovery.pendingSummary.id && strictYes(userText)) {
    confirmedSummaryId = discovery.pendingSummary.id;
    discovery = { ...discovery, phase: 'ready', pendingSummary: { ...discovery.pendingSummary, confirmed: true } };
    updated = { ...profile, goals: profile.goals.map(goal => discovery.selectedGoalIds.includes(goal.id) ? { ...goal, agreed: true } : goal), onboardingStatus: 'complete', phase: 'ready', discovery };
  } else if (discovery.phase === 'confirming' && userText.trim()) {
    // A later answer or concrete command cannot leave an old yes target hanging in the conversation.
    discovery = { ...discovery, phase: 'exploring', pendingSummary: undefined };
    updated = { ...profile, onboardingStatus: 'in_progress', phase: 'exploring', discovery };
  }
  return { profile: updated, discovery, ...(confirmedSummaryId ? { confirmedSummaryId } : {}) };
}
export function applyDiscoveryTurn(profile: PersonalStrategyProfile, response: AIStrategyResponse, userText: string, turnId: string): PersonalStrategyProfile {
  const previous = normalizeStrategyDiscovery(profile);
  if (!turnId || previous.processedTurnIds.includes(turnId)) return profile;
  let discovery = previous;
  const patch: StrategyDiscoveryPatch | undefined = response.memoryPatch?.discovery;
  const topics = { ...discovery.topics };
  const fullQuote = clean(userText);
  const asked = previous.pendingQuestion?.topic;
  for (const answer of (Array.isArray(patch?.answers) ? patch.answers : []).slice(0, 12)) {
    if (!isTopic(answer?.topic)) continue;
    const quote = clean(answer.quote);
    // Match the complete quoted statement, then store the whole message including qualifiers and negation.
    if (!quote || !fullQuote.includes(quote) || !turnId || strictYes(fullQuote)) continue;
    const deferred = answer.status === 'deferred' && decline(fullQuote) && (asked === answer.topic || anchors[answer.topic].test(fullQuote));
    if (!deferred && (answer.status !== 'answered' || !groundedAnswer(answer.topic, quote, fullQuote, asked))) continue;
    const item = { quote: fullQuote, messageId: turnId };
    const before = topics[answer.topic];
    const next = before.evidence.some(entry => entry.messageId === turnId && entry.quote === fullQuote) ? before.evidence : [...before.evidence, item].slice(-100);
    topics[answer.topic] = { status: deferred ? 'deferred' : 'answered', evidence: next };
  }
  const selectedGoalIds = patch?.selectedGoalIds === undefined ? discovery.selectedGoalIds : uniqueIds(patch.selectedGoalIds).filter(id => profile.goals.some(goal => goal.id === id));
  discovery = { ...discovery, topics, selectedGoalIds, processedTurnIds: [...discovery.processedTurnIds, turnId].slice(-100000) };
  if (patch?.question && isTopic(patch.question.topic) && clean(patch.question.text)) {
    // A fresh clarification reopens that topic even if an older answer was sufficient before.
    if (topics[patch.question.topic].status === 'answered') topics[patch.question.topic] = { ...topics[patch.question.topic], status: 'unknown' };
    discovery.pendingSummary = undefined;
    discovery.pendingQuestion = { id: `question:${turnId}`, turnId, topic: patch.question.topic,
      text: topics[patch.question.topic].status === 'deferred' ? nextQuestion(discovery, patch.question.topic) : clean(patch.question.text) };
    discovery.phase = 'exploring';
  } else if (patch?.summary && covered(discovery) && selectedGoalIds.length) {
    discovery.pendingQuestion = undefined;
    discovery.pendingSummary = { id: `summary:${turnId}`, goalIds: selectedGoalIds, fingerprint: fingerprint(profile, discovery), text: clean(patch.summary), confirmed: false };
    discovery.phase = 'confirming';
  } else if (patch && discovery.phase !== 'ready') {
    discovery.pendingSummary = undefined;
    const missing = missingTopic(discovery);
    discovery.pendingQuestion = missing ? { id: `question:${turnId}:${missing}`, turnId, topic: missing, text: nextQuestion(discovery, missing) } : undefined;
    discovery.phase = 'exploring';
  }
  // Recompute after every turn: previously completed profiles are not a permanent bypass.
  const candidate = { ...profile, discovery };
  const normalized = normalizeStrategyDiscovery(candidate);
  return { ...candidate, discovery: normalized, onboardingStatus: normalized.phase === 'ready' ? 'complete' : 'in_progress', phase: normalized.phase };
}
