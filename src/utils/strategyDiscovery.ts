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
/**
 * How the app addresses the person in Ukrainian: "ти" only when they write with "ти", otherwise "ви".
 * App-written text (acknowledgements, fallback questions) must use the same form as the model.
 */
export type DiscoveryAddress = 'ty' | 'vy';
const notLetter = "(?<![\\p{L}\\p{N}'’ʼ])";
const wordEnd = "(?![\\p{L}\\p{N}'’ʼ])";
// Task-command imperatives count too ("Перенеси…", "Заплануйте…"); words that coincide with
// another form (nouns "зміни", "розклади"; past tense "видали") are left out.
const tyForms = new RegExp(`${notLetter}(?:ти|тобі|тебе|тобою|твій|твоя|твоє|твої|твого|твоєї|твоїй|твоєму|твоїм|твоїх|твою|слухай|скажи|зроби|допоможи|розбий|поясни|підкажи|порадь|глянь|подивись|створи|додай|напиши|розкажи|знайди|уяви|давай|дай|можеш|знаєш|хочеш|бачиш|розумієш|думаєш|перенеси|заплануй|сплануй|розплануй|онови|познач|заархівуй|прибери|покажи|перевір|проаналізуй|оціни|нагадай|запусти|зупини|постав|встанови|перейменуй|розпиши|відкрий|почни)${wordEnd}`, 'giu');
const vyForms = new RegExp(`${notLetter}(?:ви|вам|вас|вами|ваш|ваша|ваше|ваші|вашого|вашої|вашій|вашому|вашим|ваших|вашу|слухайте|скажіть|зробіть|допоможіть|розбийте|поясніть|підкажіть|порадьте|гляньте|подивіться|створіть|додайте|напишіть|розкажіть|знайдіть|уявіть|давайте|дайте|можете|знаєте|хочете|бачите|розумієте|думаєте|перенесіть|заплануйте|сплануйте|розплануйте|оновіть|видаліть|позначте|заархівуйте|приберіть|покажіть|перевірте|проаналізуйте|оцініть|нагадайте|запустіть|зупиніть|поставте|встановіть|перейменуйте|розпишіть|відкрийте|почніть)${wordEnd}`, 'giu');
/** The form one message uses, if it shows one. */
export function addressFormOf(text: string): DiscoveryAddress | undefined {
  const ty = (text.match(tyForms) || []).length, vy = (text.match(vyForms) || []).length;
  return ty > vy ? 'ty' : vy > ty ? 'vy' : undefined;
}
/** Texts are oldest first; the latest message that shows a form decides. Default: "ви". */
export function detectDiscoveryAddress(texts: readonly string[], fallback: DiscoveryAddress = 'vy'): DiscoveryAddress {
  for (let index = texts.length - 1; index >= 0; index--) {
    const form = typeof texts[index] === 'string' ? addressFormOf(texts[index]) : undefined;
    if (form) return form;
  }
  return fallback;
}
/** The person's own discovery answers, used when no recent chat shows a form. */
export const discoveryEvidenceTexts = (state: StrategyDiscoveryState): string[] =>
  STRATEGY_DISCOVERY_TOPICS.flatMap(topic => state.topics[topic].evidence.map(entry => entry.quote));

/** One question per topic: [ви, ти]. Ти-variants avoid gendered past tense. */
const questionText: Record<StrategyDiscoveryTopic, [string, string]> = {
  direction: ['Що ви хотіли б змінити у своєму житті й чому це для вас важливо?', 'Що тобі хотілося б змінити у своєму житті й чому це для тебе важливо?'],
  motivation: ['Що ця зміна дасть саме вам і чому це для вас важливо?', 'Що ця зміна дасть саме тобі і чому це для тебе важливо?'],
  circumstances: ['Які обставини вашого життя зараз впливають на цю ціль?', 'Які обставини твого життя зараз впливають на цю ціль?'],
  barriers: ['Що зараз найчастіше заважає вам почати або продовжити важливу справу?', 'Що зараз найчастіше заважає тобі почати або продовжити важливу справу?'],
  capacity: ['Скільки часу й сил ви реально можете виділити зараз, з урахуванням відпочинку та інших справ?', 'Скільки часу й сил ти реально можеш виділити зараз, з урахуванням відпочинку та інших справ?'],
  attempts: ['Що ви вже пробували для цієї зміни й що з цього допомогло? Якщо ще нічого — це теж важлива відповідь.', 'Що вже доводилося пробувати для цієї зміни й що з цього допомогло? Якщо ще нічого — це теж важлива відповідь.'],
};
const practicalQuestion: Partial<Record<StrategyDiscoveryTopic, [string, string]>> = {
  direction: ['Особистими подробицями можна не ділитися. Яку одну конкретну справу ви хотіли б полегшити зараз?', 'Особистими подробицями можна не ділитися. Яку одну конкретну справу тобі хотілося б полегшити зараз?'],
  motivation: ['Без приватних подробиць: який корисний результат дала б одна конкретна справа, з якою ви хочете допомоги?', 'Без приватних подробиць: який корисний результат дала б одна конкретна справа, з якою тобі потрібна допомога?'],
  barriers: ['Приватні подробиці залишимо осторонь. Якщо зручно, згадайте одну справу, яку важко почати: що відбувається безпосередньо перед цим?', 'Приватні подробиці залишимо осторонь. Якщо зручно, згадай одну справу, яку важко почати: що відбувається безпосередньо перед цим?'],
  capacity: ['Без особистих подробиць: який мінімальний обсяг однієї справи зараз був би для вас посильним?', 'Без особистих подробиць: який мінімальний обсяг однієї справи зараз був би для тебе посильним?'],
};
const formIndex = (address: DiscoveryAddress) => address === 'ty' ? 1 : 0;

/** After a few interview questions the app may offer practical help instead of the next question. */
export const PRACTICAL_HELP_OFFER = {
  uk: 'Можу вже зараз підказати перший маленький крок — чи спершу ще трохи розберемося?',
  en: 'I can suggest a first small step right now — or would you rather explore a little more first?',
} as const;
export const isPracticalHelpOffer = (value: unknown): boolean => typeof value === 'string' && Object.values(PRACTICAL_HELP_OFFER).includes(value.trim() as any);
// "Не знаю, що робити далі" describes a barrier; it is not a request for advice.
const describedUncertainty = /(?:знаю|знав|знала|розумію|розумів|розуміла|уявляю|уявляв|уявляла|зрозуміти|думаю|думав|думала|вирішую|вирішити|обираю|обрати|вибираю|вибрати)[,\s]+(?:що|з\s+чого|як|куди)[^.!?…\n]*|(?:know|knew|understand|decide|deciding|figure\s+out)\s+(?:what|where|how)[^.!?\n]*/giu;
const explicitHelp = /(?:(?<![\p{L}])що\s+(?:ж\s+|же\s+)?(?:(?:мені|нам)\s+)?(?:(?:тепер|зараз|конкретно|ж|же|далі|взагалі)\s+)*(?:робити|зробити|почати|порадиш|порадите)(?![\p{L}])|(?<![\p{L}])з\s+чого\s+(?:мені\s+)?(?:почати|починати)(?![\p{L}])|(?<![\p{L}])(?:допоможи|допоможіть)(?:\s+(?:мені|будь\s+ласка|з\s+цим|нарешті))*\s*(?:[.!?…]|$)|(?<![\p{L}])(?:дай|дайте)\s+(?:мені\s+)?(?:(?:якусь|конкретну|практичну|хоч\s+якусь)\s+)?(?:пораду|поради|рекомендацію|рекомендації)(?![\p{L}])|(?<![\p{L}])(?:порадь|порадьте)(?![\p{L}])|(?<![\p{L}])(?:підкажи|підкажіть)\s+(?:мені\s+)?(?:що|як|з\s+чого|перший|якийсь)(?![\p{L}])|(?<![\p{L}])я\s+(?:ж\s+|же\s+)?(?:вже\s+)?(?:все|усе|достатньо)\s+(?:вже\s+)?(?:розповів|розповіла|розказав|розказала|пояснив|пояснила|описав|описала)(?![\p{L}])|(?<![\p{L}])(?:досить|вистачить|годі)\s+(?:питань|запитань|розпитувати|розпитувань)(?![\p{L}])|\bwhat\s+(?:should|do|can)\s+i\s+(?:do|start\s+with)\b|\bwhere\s+(?:do|should)\s+i\s+start\b|\bgive\s+me\s+(?:some\s+)?(?:advice|a\s+tip|tips|a\s+suggestion)\b|\bany\s+(?:advice|tips|suggestions)\b|\bhelp\s+me(?:\s+(?:now|please|with\s+this))?\s*(?:[.!?]|$)|\bi['’]?ve\s+(?:already\s+)?told\s+you\s+(?:everything|enough)\b|\benough\s+questions\b)/iu;
/** An explicit request for practical help now ("що мені робити?", "допоможи", "я вже все розповів"). */
export function wantsPracticalHelpNow(text: string): boolean {
  const input = text.replace(describedUncertainty, ' ');
  // A personal plan still needs the interview; this is only a request for immediate practical help.
  if (/(?:(?<![\p{L}])план(?:у|ом|и)?(?![\p{L}])|\bplan\b|стратегі|\bstrategy\b)/iu.test(input)) return false;
  return explicitHelp.test(input);
}
/** A yes to PRACTICAL_HELP_OFFER; "давай ще трохи розберемося" continues the interview. */
export function acceptsPracticalHelpOffer(text: string): boolean {
  const input = text.trim();
  if (/(?:розбер|ще\s+трохи|спершу|спочатку|продовж|питай|запитуй|(?<![\p{L}])ні(?![\p{L}])|(?<![\p{L}])не\s+(?:треба|зараз|варто)|пізніше|потім|\bno\b|\bnot\s+yet\b|\bexplore\b|\bfirst\b|\bcontinue\b|\blater\b|\bmore\s+questions\b)/iu.test(input)) return false;
  return /^(?:так|ага|угу|давай|давайте|звісно|звичайно|авжеж|ок|окей|добре|гаразд|хочу|можна|підкажи|підкажіть|yes|yeah|yep|sure|ok|okay|please|go\s+ahead)(?![\p{L}])/iu.test(input)
    || /(?:перший\s+крок|маленький\s+крок|перший\s+маленький|first\s+step|small\s+step)/iu.test(input) || wantsPracticalHelpNow(input);
}
/**
 * Interview questions asked in a row (this one included) and whether practical help was already
 * offered, read from a pending question id such as `question:<turn>~q3:offered`. The opener counts as one.
 */
export function discoveryQuestionStreak(id: string | undefined): { asked: number; offered: boolean } {
  if (!id) return { asked: 0, offered: false };
  const count = /~q(\d+)/.exec(id);
  return { asked: count ? Number(count[1]) : id.startsWith('discovery:') ? 0 : 1, offered: id.startsWith('offer:') || id.includes(':offered') };
}
/** Discovery-mode message that should get practical help now instead of the next interview question. */
export function practicalHelpRequested(text: string, profile?: PersonalStrategyProfile): boolean {
  if (wantsPracticalHelpNow(text)) return true;
  const pending = profile ? normalizeStrategyDiscovery(profile).pendingQuestion : undefined;
  return !!pending && pending.id.startsWith('offer:') && acceptsPracticalHelpOffer(text);
}
export const missingStrategyDiscoveryTopics = (state: StrategyDiscoveryState): StrategyDiscoveryTopic[] => [
  ...STRATEGY_DISCOVERY_TOPICS.filter(topic => state.topics[topic].status === 'unknown'),
  ...STRATEGY_DISCOVERY_TOPICS.filter(topic => required.has(topic) && state.topics[topic].status === 'deferred'),
];
const missingTopic = (state: StrategyDiscoveryState): StrategyDiscoveryTopic | undefined => missingStrategyDiscoveryTopics(state)[0];
export function discoveryQuestionForState(state: StrategyDiscoveryState, topic: StrategyDiscoveryTopic, lang: 'uk' | 'en' = 'uk', address: DiscoveryAddress = 'vy'): string {
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
  const form = formIndex(address);
  if (state.topics[topic].status !== 'deferred') return questionText[topic][form];
  return state.topics[topic].evidence.filter(entry => decline(entry.quote)).length > 1
    ? ['Можемо відкласти цю тему й повернутися до неї лише за вашим бажанням. З якою конкретною справою допомогти зараз?', 'Можемо відкласти цю тему й повернутися до неї лише за твоїм бажанням. З якою конкретною справою допомогти зараз?'][form]
    : (practicalQuestion[topic] || questionText[topic])[form];
}
const nextQuestion = (state: StrategyDiscoveryState, topic: StrategyDiscoveryTopic, address: DiscoveryAddress = 'vy') => discoveryQuestionForState(state, topic, 'uk', address);
/** Whether a clause speaks about a topic at all; used to pick a short key phrase from the person's words. */
export const mentionsDiscoveryTopic = (topic: StrategyDiscoveryTopic, text: string): boolean => anchors[topic].test(text);
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
/** Ids of questions opened by the «Поглибити знайомство» button: `continue:<epoch ms>-<nonce>:<topic>`. */
export const DISCOVERY_MODE_QUESTION_ID = /^continue:(\d{13})-[a-z0-9]+:/;
/**
 * The visible text of a pending question in the person's current form of address. App-written
 * questions (the opener `discovery:` and the «Поглибити знайомство» question `continue:`) are
 * re-rendered from the state, so a "ти" chat never shows a stored "ви" question; model-written
 * clarifications, and English `continue:` questions, are shown as stored.
 */
export function addressedDiscoveryQuestion(state: StrategyDiscoveryState, question: { id: string; topic: StrategyDiscoveryTopic; text: string }, lang: 'uk' | 'en' = 'uk', address: DiscoveryAddress = 'vy'): string {
  if (question.id.startsWith('discovery:') || lang === 'uk' && question.id.startsWith('continue:')) return discoveryQuestionForState(state, question.topic, lang, address);
  return question.text;
}
/**
 * The «Поглибити знайомство» button: an unfinished interview resumes at its first missing topic;
 * a finished one reopens barriers. The fresh id lets the chat enter the explicit discovery mode.
 * recentUserTexts (oldest first) are the person's latest chat messages; they decide the form of
 * address before the stored discovery answers do.
 */
export function continueStrategyDiscovery(profile: PersonalStrategyProfile, lang: 'uk' | 'en' = 'uk', now = Date.now(), recentUserTexts: readonly string[] = []): PersonalStrategyProfile {
  const discovery = normalizeStrategyDiscovery(profile);
  const address = detectDiscoveryAddress([...discoveryEvidenceTexts(discovery), ...recentUserTexts.filter(text => typeof text === 'string')]);
  const missing = discovery.phase === 'ready' ? undefined : missingTopic(discovery);
  const topic: StrategyDiscoveryTopic = missing || 'barriers';
  const topics = missing ? discovery.topics : { ...discovery.topics, barriers: { ...discovery.topics.barriers, status: 'unknown' as const } };
  const english: Record<StrategyDiscoveryTopic, string> = {
    direction: 'What would you like to change in your life, and why does it matter to you?',
    motivation: 'What would this change mean for you personally, and why does that matter?',
    circumstances: 'What in your current life situation affects this goal?',
    barriers: 'What most often gets in the way of starting or continuing something important right now?',
    capacity: 'How much time and energy can you realistically make available now, allowing for rest and other responsibilities?',
    attempts: 'What have you tried for this change, and what helped, including if you have not tried anything yet?',
  };
  const text = lang === 'uk' ? (missing ? discoveryQuestionForState(discovery, topic, 'uk', address) : questionText.barriers[formIndex(address)]) : english[topic];
  return { ...profile, onboardingStatus: 'in_progress', phase: 'exploring', discovery: { ...discovery, phase: 'exploring', topics, pendingSummary: undefined,
    pendingQuestion: { id: `continue:${now}-${Math.random().toString(36).slice(2, 8)}:${topic}`, topic, text } } };
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
  // Question ids carry how many interview questions were asked in a row and whether help was offered.
  const streak = discoveryQuestionStreak(previous.pendingQuestion?.id);
  const marked = (id: string) => `${id}~q${Math.min(streak.asked + 1, 99)}${streak.offered ? ':offered' : ''}`;
  const address = detectDiscoveryAddress([...discoveryEvidenceTexts(previous), userText]);
  if (patch?.question && isTopic(patch.question.topic) && clean(patch.question.text)) {
    const offer = isPracticalHelpOffer(patch.question.text);
    // A fresh clarification reopens that topic even if an older answer was sufficient before.
    if (!offer && topics[patch.question.topic].status === 'answered') topics[patch.question.topic] = { ...topics[patch.question.topic], status: 'unknown' };
    discovery.pendingSummary = undefined;
    discovery.pendingQuestion = { id: marked(offer ? `offer:${turnId}` : `question:${turnId}`), turnId, topic: patch.question.topic,
      text: !offer && topics[patch.question.topic].status === 'deferred' ? nextQuestion(discovery, patch.question.topic, address) : clean(patch.question.text) };
    discovery.phase = 'exploring';
  } else if (patch?.summary && covered(discovery) && selectedGoalIds.length) {
    discovery.pendingQuestion = undefined;
    discovery.pendingSummary = { id: `summary:${turnId}`, goalIds: selectedGoalIds, fingerprint: fingerprint(profile, discovery), text: clean(patch.summary), confirmed: false };
    discovery.phase = 'confirming';
  } else if (patch && discovery.phase !== 'ready') {
    discovery.pendingSummary = undefined;
    const missing = missingTopic(discovery);
    discovery.pendingQuestion = missing ? { id: marked(`question:${turnId}:${missing}`), turnId, topic: missing, text: nextQuestion(discovery, missing, address) } : undefined;
    discovery.phase = 'exploring';
  }
  // Recompute after every turn: previously completed profiles are not a permanent bypass.
  const candidate = { ...profile, discovery };
  const normalized = normalizeStrategyDiscovery(candidate);
  return { ...candidate, discovery: normalized, onboardingStatus: normalized.phase === 'ready' ? 'complete' : 'in_progress', phase: normalized.phase };
}
