import type { TaskSchedule } from '../types';

export function describeSchedule(schedule: TaskSchedule, lang: 'uk' | 'en', nextStartAt = schedule.startAt): string {
  const locale = lang === 'uk' ? 'uk-UA' : 'en-GB';
  const date = new Date(nextStartAt);
  try {
    const start = new Intl.DateTimeFormat(locale, { timeZone: schedule.timeZone, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
    const clock = new Intl.DateTimeFormat(locale, { timeZone: schedule.timeZone, hour: '2-digit', minute: '2-digit' }).format(date);
    const when = schedule.recurrence === 'daily' ? (lang === 'uk' ? `Щодня о ${clock} · наступне: ${start}` : `Daily at ${clock} · next: ${start}`) : start;
    return `${when} · ${lang === 'uk' ? `додати за ${schedule.leadMinutes} хв` : `add ${schedule.leadMinutes} min before`} · ${schedule.timeZone}`;
  } catch { return lang === 'uk' ? 'Некоректний розклад — уточніть дату й часовий пояс' : 'Invalid schedule — check date and timezone'; }
}
