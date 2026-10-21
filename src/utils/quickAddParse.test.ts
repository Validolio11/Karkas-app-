import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TaskTab } from '../types';
import { parseQuickAdd } from './quickAddParse';

function localTime(year: number, month: number, day: number, hour = 12) {
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(hour, 0, 0, 0);
  return date.getTime();
}

const now = localTime(2026, 10, 19); // Monday, in the local calendar.
const tabs: TaskTab[] = [
  { id: 'work', name: 'Робота', color: '#fff' },
  { id: 'work-projects', name: 'Work Projects' },
  { id: 'home', name: 'Дім' },
  { id: 'family', name: 'Сімʼя' },
];

const parse = (text: string) => parseQuickAdd(text, tabs, now);

test('plain titles collapse whitespace without inventing task fields', () => {
  assert.deepEqual(parse('  Купити   молоко\nі хліб  '), { title: 'Купити молоко і хліб', tokens: [] });
  assert.deepEqual(parse(''), { title: '', tokens: [] });
  assert.deepEqual(parse('  \t\n'), { title: '', tokens: [] });
});

test('extracts category, priority and planned date in input order', () => {
  assert.deepEqual(parse('Звіт завтра !1 #Робота'), {
    title: 'Звіт', phase: 'work', priority: 1, plannedDate: '2026-10-20',
    tokens: [
      { kind: 'planned', raw: 'завтра', value: '2026-10-20' },
      { kind: 'priority', raw: '!1', value: '1' },
      { kind: 'phase', raw: '#Робота', value: 'work' },
    ],
  });
});

test('supports all priority values and lets the last explicit priority win', () => {
  for (const priority of [1, 2, 3] as const) {
    const result = parse(`Task !${priority}`);
    assert.equal(result.priority, priority);
    assert.equal(result.title, 'Task');
  }
  const repeated = parse('Task !1 !3');
  assert.equal(repeated.priority, 3);
  assert.equal(repeated.tokens.length, 2);
  assert.equal(repeated.title, 'Task');
});

test('category matching normalizes case, whitespace and apostrophe variants', () => {
  for (const name of ["#СІМ'Я", '#Сім’я', '#сімʼя']) {
    assert.equal(parse('Зателефонувати ' + name).phase, 'family', name);
  }
  assert.equal(parse('Plan #workprojects').phase, 'work-projects');
  assert.equal(parse('Звіт #роб').phase, 'work');
  assert.equal(parse('Task #HOME').phase, 'home');
});

test('exact category names and ids take precedence over name prefixes', () => {
  const overlapping: TaskTab[] = [
    { id: 'first', name: 'Work Projects' },
    { id: 'exact', name: 'Work' },
    { id: 'work', name: 'Other' },
  ];
  assert.equal(parseQuickAdd('Task #work', overlapping, now).phase, 'work');
  assert.equal(parseQuickAdd('Task #work', overlapping.slice(0, 2), now).phase, 'exact');
  assert.equal(parse('Task #home #робота').phase, 'work');
});

test('unknown categories become proposals without staying in the title', () => {
  assert.deepEqual(parseQuickAdd('Звіт #робота', [], now), {
    title: 'Звіт', proposedCategoryName: 'Робота',
    tokens: [{ kind: 'category_proposal', raw: '#робота', value: 'Робота' }],
  });
  assert.equal(parse('Task #unknown').proposedCategoryName, 'Unknown');
  assert.equal(parse('Task #unknown #робота').proposedCategoryName, undefined);
  assert.equal(parse('Task #unknown #робота').phase, 'work');
});

test('non-whole or invalid category tokens remain title text', () => {
  const title = 'Task # #work, !4 !12 urgent!1 !1, today, tomorrow-ish 19.10.2026x';
  assert.deepEqual(parse(title), { title, tokens: [] });
});

test('relative dates are case insensitive and use the local calendar', () => {
  for (const [word, expected] of [
    ['сьогодні', '2026-10-19'], ['TODAY', '2026-10-19'],
    ['ЗАВТРА', '2026-10-20'], ['Tomorrow', '2026-10-20'],
    ['післязавтра', '2026-10-21'],
  ]) assert.equal(parse('Task ' + word).plannedDate, expected, word);
});

test('Ukrainian weekday names, abbreviations and accusatives find their next occurrence', () => {
  const groups: [string[], string][] = [
    [['пн', 'понеділок'], '2026-10-19'],
    [['вт', 'вівторок'], '2026-10-20'],
    [['ср', 'середа', 'середу'], '2026-10-21'],
    [['чт', 'четвер'], '2026-10-22'],
    [['пт', "п'ятниця", "п'ятницю", 'п’ятницю', 'пʼятницю'], '2026-10-23'],
    [['сб', 'субота', 'суботу'], '2026-10-24'],
    [['нд', 'неділя', 'неділю'], '2026-10-25'],
  ];
  for (const [words, expected] of groups) {
    for (const word of words) assert.equal(parse('Task ' + word).plannedDate, expected, word);
  }
});

test('English weekday names and abbreviations include today', () => {
  for (const [index, names] of [
    ['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'],
    ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday'],
  ].entries()) {
    for (const name of names) assert.equal(parse('Task ' + name).plannedDate, `2026-10-${19 + index}`, name);
  }
  assert.equal(parseQuickAdd('Task Monday', tabs, localTime(2026, 10, 20)).plannedDate, '2026-10-26');
});

test('deadline prefixes consume only a following valid date and preserve their exact raw text', () => {
  for (const prefix of ['до', 'BY', 'due']) {
    const result = parse('Report ' + prefix + '  TOMORROW');
    assert.equal(result.deadlineDate, '2026-10-20');
    assert.equal(result.plannedDate, undefined);
    assert.equal(result.title, 'Report');
    assert.deepEqual(result.tokens, [{ kind: 'deadline', raw: prefix + '  TOMORROW', value: '2026-10-20' }]);
  }
});

test('planned prefixes consume only a following valid date', () => {
  for (const prefix of ['на', 'ON']) {
    const result = parse('Report ' + prefix + '\tсереду');
    assert.equal(result.plannedDate, '2026-10-21');
    assert.equal(result.title, 'Report');
    assert.equal(result.tokens[0].raw, prefix + '\tсереду');
  }
  for (const title of ['Report by email', 'На роботу', 'Plan on', 'Due 31.02', 'Task до !1']) {
    assert.equal(parse(title).title, title === 'Task до !1' ? 'Task до' : title, title);
  }
});

test('numeric dates use the current year unless the calendar day has passed', () => {
  assert.equal(parse('Task 19.10').plannedDate, '2026-10-19');
  assert.equal(parse('Task 20.10').plannedDate, '2026-10-20');
  assert.equal(parse('Task 18.10').plannedDate, '2027-10-18');
  assert.equal(parse('Task 01.01').plannedDate, '2027-01-01');
  assert.equal(parse('Task 18.10.2025').plannedDate, '2025-10-18');
  assert.equal(parse('Task 29.02.2028').plannedDate, '2028-02-29');
  assert.equal(parse('Task 01.01.0001').plannedDate, '0001-01-01');
});

test('invalid numeric dates and unsupported date formats stay literal', () => {
  for (const word of ['31.02', '29.02.2026', '31.04.2027', '00.10', '10.00', '10.13', '01.01.0000', '1.10', '19.10.26', '2026-10-19']) {
    assert.deepEqual(parse('Task ' + word), { title: 'Task ' + word, tokens: [] }, word);
  }
});

test('only the first planned and first deadline date are interpreted', () => {
  const result = parse('Task today tomorrow on Wednesday due Friday by Saturday');
  assert.equal(result.plannedDate, '2026-10-19');
  assert.equal(result.deadlineDate, '2026-10-23');
  assert.equal(result.title, 'Task tomorrow on Wednesday by Saturday');
  assert.deepEqual(result.tokens.map(token => token.raw), ['today', 'due Friday']);
  const deadlines = parse('Task due today by tomorrow');
  assert.equal(deadlines.plannedDate, undefined, 'a duplicate deadline must not become a planned date');
  assert.equal(deadlines.title, 'Task by tomorrow');
});

test('equal dates remain valid in either order', () => {
  for (const text of ['Task today due today', 'Task due today on today']) {
    const result = parse(text);
    assert.equal(result.plannedDate, '2026-10-19');
    assert.equal(result.deadlineDate, '2026-10-19');
    assert.equal(result.title, 'Task');
  }
});

test('a planned day later than the deadline is dropped but recognized tokens remain removable', () => {
  for (const text of ['Task tomorrow due today', 'Task due today on tomorrow']) {
    const result = parse(text);
    assert.equal(result.plannedDate, undefined);
    assert.equal(result.deadlineDate, '2026-10-19');
    assert.equal(result.title, 'Task');
    assert.equal(result.tokens.length, 2);
    assert.equal(result.tokens.find(token => token.kind === 'planned')?.value, '2026-10-20');
  }
});

test('tokens-only input keeps a nonempty original title while retaining parsed fields', () => {
  for (const text of ['tomorrow', '!1', '#Робота', '  !1  due tomorrow   #WorkProjects  ']) {
    const result = parse(text);
    assert.equal(result.title, text.trim().replace(/\s+/g, ' '));
    assert.ok(result.tokens.length > 0);
  }
});

test('calendar arithmetic crosses years and DST dates without adding fixed 24-hour durations', () => {
  assert.equal(parseQuickAdd('Task tomorrow', tabs, localTime(2026, 12, 31, 23)).plannedDate, '2027-01-01');
  assert.equal(parseQuickAdd('Task післязавтра', tabs, localTime(2026, 12, 31, 23)).plannedDate, '2027-01-02');
  assert.equal(parseQuickAdd('Task tomorrow', tabs, localTime(2026, 3, 28, 23)).plannedDate, '2026-03-29');
  assert.equal(parseQuickAdd('Task tomorrow', tabs, localTime(2026, 10, 24, 23)).plannedDate, '2026-10-25');
  assert.equal(parseQuickAdd('Task 01.01', tabs, localTime(2026, 12, 31)).plannedDate, '2027-01-01');
});

test('parsing leaves tabs unchanged and ignores object-prototype weekday names', () => {
  const snapshot = JSON.stringify(tabs);
  parse('Task #WorkProjects tomorrow !1');
  assert.equal(JSON.stringify(tabs), snapshot);
  assert.deepEqual(parse('Task constructor toString'), { title: 'Task constructor toString', tokens: [] });
});
