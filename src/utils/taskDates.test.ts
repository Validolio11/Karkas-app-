import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeDeadline, describePlannedDate, formatTaskDate, getDeadlineProgress, isTaskDate, localTaskDate, pluralTaskDays, taskDateEnd, taskDayDiff } from './taskDates';

function localTime(year: number, month: number, day: number, hour = 12) {
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(hour, 0, 0, 0);
  return date.getTime();
}

test('calendar validation accepts real leap dates and small years without rolling invalid dates forward', () => {
  for (const date of ['0001-01-01', '0096-02-29', '2000-02-29', '2028-02-29', '9999-12-31']) assert.equal(isTaskDate(date), true, date);
  for (const date of ['0000-01-01', '1900-02-29', '2026-02-29', '2026-04-31', '2026-00-01', '2026-13-01', '2026-01-00', '2026-1-01', '2026-10-12T00:00:00Z', null]) assert.equal(isTaskDate(date), false, String(date));
});

test('formatting respects local today and tomorrow over year boundaries', () => {
  const now = localTime(2026, 12, 31, 23);
  assert.equal(localTaskDate(now), '2026-12-31');
  assert.equal(formatTaskDate('2026-12-31', 'uk', now), 'Сьогодні');
  assert.equal(formatTaskDate('2027-01-01', 'en', now), 'Tomorrow');
  assert.equal(formatTaskDate('2027-01-02', 'uk', now), '02.01.2027');
  assert.equal(formatTaskDate('2026-02-30', 'uk', now), '');
});

test('deadline includes its entire local day and the next day begins immediately after it', () => {
  for (const date of ['0096-02-29', '2026-03-29', '2026-10-25', '2026-12-31']) {
    const end = taskDateEnd(date)!;
    assert.equal(localTaskDate(end), date);
    const next = new Date(end + 1);
    assert.equal(next.getHours(), 0);
    assert.equal(next.getMinutes(), 0);
    assert.equal(next.getMilliseconds(), 0);
    assert.notEqual(localTaskDate(end + 1), date);
  }
  assert.equal(taskDateEnd('2026-02-30'), null);
});

test('deadline progress is bounded elapsed time and freezes at explicit task completion', () => {
  const end = taskDateEnd('2026-10-15')!;
  const task = { createdAt: end - 10000, deadlineDate: '2026-10-15', done: false };
  assert.equal(getDeadlineProgress(task, end - 20000), 0);
  assert.equal(getDeadlineProgress(task, end - 5000), 50);
  assert.equal(getDeadlineProgress(task, end + 10000), 100);
  assert.equal(getDeadlineProgress({ ...task, done: true, completedAt: end - 7500 }, end + 10000), 25);
  assert.equal(getDeadlineProgress({ ...task, deadlineDate: undefined }, end), 0);
});

test('day differences use local calendar days across DST and year boundaries', () => {
  const now = new Date(2026, 9, 19, 12).getTime();
  assert.equal(taskDayDiff('2026-10-19', now), 0);
  assert.equal(taskDayDiff('2026-10-20', now), 1);
  assert.equal(taskDayDiff('2026-10-18', now), -1);
  assert.equal(taskDayDiff('2026-10-26', now), 7);
  assert.equal(taskDayDiff('2026-03-30', new Date(2026, 2, 28, 12).getTime()), 2);
  assert.equal(taskDayDiff('2026-03-28', new Date(2026, 2, 30, 12).getTime()), -2);
  assert.equal(taskDayDiff('2026-10-26', new Date(2026, 9, 24, 12).getTime()), 2);
  assert.equal(taskDayDiff('2027-01-01', new Date(2026, 11, 31, 12).getTime()), 1);
  assert.equal(taskDayDiff('0096-03-01', localTime(96, 2, 28)), 2);
  assert.equal(taskDayDiff('2026-02-30', now), null);
  assert.equal(taskDayDiff('invalid', now), null);
  assert.equal(taskDayDiff('2026-10-19', NaN), null);
  assert.equal(taskDayDiff('2026-10-19', 1e20), null);
});

test('Ukrainian day nouns follow singular, plural and teen endings', () => {
  for (const count of [1, 21, 101]) assert.equal(pluralTaskDays(count), 'день', String(count));
  for (const count of [2, 3, 4, 22, 24, 102]) assert.equal(pluralTaskDays(count), 'дні', String(count));
  for (const count of [0, 5, 11, 12, 13, 14, 25, 111, 112, 114]) assert.equal(pluralTaskDays(count), 'днів', String(count));
});

test('deadlines describe overdue dates, today and tomorrow with absolute tooltip dates', () => {
  const now = new Date(2026, 9, 19, 12).getTime();
  assert.deepEqual(describeDeadline('2026-10-18', 'uk', now), { label: 'Прострочено на 1 день', tone: 'overdue', full: '18.10.2026' });
  assert.equal(describeDeadline('2026-10-17', 'uk', now).label, 'Прострочено на 2 дні');
  assert.equal(describeDeadline('2026-10-08', 'uk', now).label, 'Прострочено на 11 днів');
  assert.equal(describeDeadline('2026-09-28', 'uk', now).label, 'Прострочено на 21 день');
  assert.equal(describeDeadline('2026-10-18', 'en', now).label, 'Overdue by 1 day');
  assert.equal(describeDeadline('2026-10-17', 'en', now).label, 'Overdue by 2 days');
  assert.deepEqual(describeDeadline('2026-10-19', 'uk', now), { label: 'Дедлайн сьогодні', tone: 'today', full: '19.10.2026' });
  assert.equal(describeDeadline('2026-10-19', 'en', now).label, 'Due today');
  assert.deepEqual(describeDeadline('2026-10-20', 'uk', now), { label: 'Дедлайн завтра', tone: 'soon', full: '20.10.2026' });
  assert.equal(describeDeadline('2026-10-20', 'en', now).label, 'Due tomorrow');
});

test('deadline labels change tone at four days and use short dates after thirteen days', () => {
  const now = new Date(2026, 9, 19, 12).getTime();
  assert.deepEqual(describeDeadline('2026-10-21', 'uk', now), { label: 'Дедлайн через 2 дні', tone: 'soon', full: '21.10.2026' });
  assert.deepEqual(describeDeadline('2026-10-22', 'en', now), { label: 'Due in 3 days', tone: 'soon', full: '22.10.2026' });
  assert.deepEqual(describeDeadline('2026-10-23', 'uk', now), { label: 'Дедлайн через 4 дні', tone: 'later', full: '23.10.2026' });
  assert.deepEqual(describeDeadline('2026-11-01', 'uk', now), { label: 'Дедлайн через 13 днів', tone: 'later', full: '01.11.2026' });
  assert.deepEqual(describeDeadline('2026-11-02', 'uk', now), { label: 'Дедлайн 02.11', tone: 'later', full: '02.11.2026' });
  assert.equal(describeDeadline('2026-11-02', 'en', now).label, 'Due 02.11');
  assert.equal(describeDeadline('2027-01-01', 'uk', now).label, 'Дедлайн 01.01.2027');
  assert.equal(describeDeadline('2027-01-01', 'en', now).label, 'Due 01.01.2027');
  assert.deepEqual(describeDeadline('invalid', 'uk', now), { label: '', tone: 'later', full: '' });
});

test('planned dates distinguish missed, today, tomorrow, weekdays and later dates', () => {
  const now = new Date(2026, 9, 19, 12).getTime();
  assert.deepEqual(describePlannedDate('2026-10-18', 'uk', now), { label: 'Планувалось 1 день тому', tone: 'missed', full: '18.10.2026' });
  assert.equal(describePlannedDate('2026-10-17', 'uk', now).label, 'Планувалось 2 дні тому');
  assert.equal(describePlannedDate('2026-10-08', 'uk', now).label, 'Планувалось 11 днів тому');
  assert.equal(describePlannedDate('2026-10-18', 'en', now).label, 'Planned 1 day ago');
  assert.equal(describePlannedDate('2026-10-17', 'en', now).label, 'Planned 2 days ago');
  assert.deepEqual(describePlannedDate('2026-10-19', 'uk', now), { label: 'Сьогодні', tone: 'today', full: '19.10.2026' });
  assert.equal(describePlannedDate('2026-10-19', 'en', now).label, 'Today');
  assert.deepEqual(describePlannedDate('2026-10-20', 'uk', now), { label: 'Завтра', tone: 'upcoming', full: '20.10.2026' });
  assert.equal(describePlannedDate('2026-10-20', 'en', now).label, 'Tomorrow');
  assert.equal(describePlannedDate('2026-10-21', 'uk', now).label, 'Ср, 21.10');
  assert.deepEqual(describePlannedDate('2026-10-23', 'uk', now), { label: 'Пт, 23.10', tone: 'upcoming', full: '23.10.2026' });
  assert.equal(describePlannedDate('2026-10-23', 'en', now).label, 'Fri, 23.10');
  assert.equal(describePlannedDate('2026-10-25', 'uk', now).label, 'Нд, 25.10');
  assert.deepEqual(describePlannedDate('2026-10-26', 'uk', now), { label: '26.10', tone: 'upcoming', full: '26.10.2026' });
  assert.equal(describePlannedDate('2027-01-01', 'en', now).label, '01.01.2027');
  assert.deepEqual(describePlannedDate('invalid', 'en', now), { label: '', tone: 'upcoming', full: '' });
});
