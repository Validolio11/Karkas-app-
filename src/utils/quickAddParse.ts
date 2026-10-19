import type { TaskTab } from '../types';
import { isTaskDate, localTaskDate } from './taskDates';

export interface QuickAddToken {
  kind: 'phase' | 'priority' | 'planned' | 'deadline';
  raw: string;
  value: string;
}

export interface ParsedQuickAdd {
  title: string;
  phase?: string;
  priority?: 1 | 2 | 3;
  plannedDate?: string;
  deadlineDate?: string;
  tokens: QuickAddToken[];
}

const weekdays: Record<string, number> = {
  пн: 1, понеділок: 1, mon: 1, monday: 1,
  вт: 2, вівторок: 2, tue: 2, tuesday: 2,
  ср: 3, середа: 3, середу: 3, wed: 3, wednesday: 3,
  чт: 4, четвер: 4, thu: 4, thursday: 4,
  пт: 5, "п'ятниця": 5, "п'ятницю": 5, fri: 5, friday: 5,
  сб: 6, субота: 6, суботу: 6, sat: 6, saturday: 6,
  нд: 0, неділя: 0, неділю: 0, sun: 0, sunday: 0,
};

function normalize(value: string): string {
  return value.toLowerCase().replace(/['’ʼ]/g, "'");
}

function normalizePhase(value: string): string {
  return normalize(value).replace(/\s/g, '');
}

function parseDate(word: string, now: number): string | undefined {
  const normalized = normalize(word);
  const date = new Date(now);
  if (['сьогодні', 'today', 'завтра', 'tomorrow', 'післязавтра'].includes(normalized)) {
    const offset = normalized === 'післязавтра' ? 2 : ['завтра', 'tomorrow'].includes(normalized) ? 1 : 0;
    date.setDate(date.getDate() + offset);
    return localTaskDate(date.getTime());
  }
  if (Object.prototype.hasOwnProperty.call(weekdays, normalized)) {
    date.setDate(date.getDate() + (weekdays[normalized] - date.getDay() + 7) % 7);
    return localTaskDate(date.getTime());
  }
  const numeric = /^(\d{2})\.(\d{2})(?:\.(\d{4}))?$/.exec(word);
  if (!numeric) return undefined;
  const [, day, month, explicitYear] = numeric;
  let year = explicitYear ? Number(explicitYear) : date.getFullYear();
  let value = `${String(year).padStart(4, '0')}-${month}-${day}`;
  if (!explicitYear && value < localTaskDate(now)) {
    year += 1;
    value = `${String(year).padStart(4, '0')}-${month}-${day}`;
  }
  if (!isTaskDate(value)) return undefined;
  date.setFullYear(year, Number(month) - 1, Number(day));
  return localTaskDate(date.getTime());
}

export function parseQuickAdd(text: string, tabs: readonly TaskTab[], now = Date.now()): ParsedQuickAdd {
  const words = Array.from(text.matchAll(/\S+/g), match => ({ raw: match[0], start: match.index! }));
  const consumed = new Set<number>();
  const recognized: QuickAddToken[] = [];
  const result: ParsedQuickAdd = { title: '', tokens: [] };
  const addToken = (kind: QuickAddToken['kind'], value: string, start: number, end = start) => {
    const indices = Array.from({ length: end - start + 1 }, (_, offset) => start + offset);
    indices.forEach(index => consumed.add(index));
    const raw = text.slice(words[start].start, words[end].start + words[end].raw.length);
    recognized.push({ kind, raw, value });
  };

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index].raw;
    if (/^![123]$/.test(word)) {
      result.priority = Number(word[1]) as 1 | 2 | 3;
      addToken('priority', word[1], index);
      continue;
    }
    if (word.startsWith('#') && word.length > 1) {
      const name = normalizePhase(word.slice(1));
      const tab = tabs.find(tab => normalizePhase(tab.id) === name)
        ?? tabs.find(tab => normalizePhase(tab.name) === name)
        ?? tabs.find(tab => normalizePhase(tab.name).startsWith(name));
      if (tab) {
        result.phase = tab.id;
        addToken('phase', tab.id, index);
        continue;
      }
    }

    const prefix = normalize(word);
    const hasPrefix = ['до', 'by', 'due', 'на', 'on'].includes(prefix);
    const dateIndex = hasPrefix ? index + 1 : index;
    const date = words[dateIndex] ? parseDate(words[dateIndex].raw, now) : undefined;
    if (!date) continue;
    const deadline = ['до', 'by', 'due'].includes(prefix);
    if (deadline ? result.deadlineDate !== undefined : result.plannedDate !== undefined) {
      // Leave a duplicate date phrase intact rather than reinterpreting its date.
      if (hasPrefix) index = dateIndex;
      continue;
    }
    if (deadline) result.deadlineDate = date;
    else result.plannedDate = date;
    addToken(deadline ? 'deadline' : 'planned', date, index, dateIndex);
    index = dateIndex;
  }

  if (result.plannedDate && result.deadlineDate && result.plannedDate > result.deadlineDate) {
    result.plannedDate = undefined;
  }
  result.tokens = recognized;
  const title = words.filter((_, index) => !consumed.has(index)).map(word => word.raw).join(' ');
  result.title = title || text.trim().replace(/\s+/g, ' ');
  return result;
}
