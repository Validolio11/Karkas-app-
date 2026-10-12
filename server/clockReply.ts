import type { TemporalClientClock } from '../src/utils/taskTemporalContext';

/** A clock lookup is an app fact and does not require a provider or change tasks. */
export function currentClockReply(prompt: string, clock: TemporalClientClock, isUk: boolean): string | null {
  const asksTime = /(?:котра|яка)\s+(?:зараз\s+)?година(?:\s+зараз)?(?:\s*[?!.,]|$)|what\s+(?:is\s+the\s+(?:current\s+)?time|time\s+is\s+it)(?:\s*(?:now|right\s+now))?(?:\s*[?!.,]|$)/iu.test(prompt.trim());
  const asksAction = /(?:розклад|заплан|перенес|переніс|плануй|склади|створ|додай|онов|зміни|видал|запуст|увімк|зупин|schedule|reschedule|create|update|delete|start\s+(?:the\s+)?timer|make\s+(?:a\s+)?plan)/iu.test(prompt);
  if (!asksTime || asksAction) return null;
  const now = new Date(clock.now);
  const localTime = new Intl.DateTimeFormat(isUk ? 'uk-UA' : 'en-GB', { timeZone: clock.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  const localDate = new Intl.DateTimeFormat(isUk ? 'uk-UA' : 'en-GB', { timeZone: clock.timeZone, day: 'numeric', month: 'long', year: 'numeric' }).format(now);
  return isUk ? `Зараз ${localTime}, ${localDate}. Часовий пояс: ${clock.timeZone}.` : `It is ${localTime}, ${localDate}. Time zone: ${clock.timeZone}.`;
}
