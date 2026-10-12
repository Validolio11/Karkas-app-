import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatTaskDate, getDeadlineProgress, isTaskDate, localTaskDate, taskDateEnd } from './taskDates';

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
