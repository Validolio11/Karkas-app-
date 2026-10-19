import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PSTask } from '../types';
import { calendarDateKey, compareTodayTimedFirst, taskTimeRange } from './schedulePresentation';

const KYIV = 'Europe/Kyiv';
const at = (iso: string) => Date.parse(iso);
const block = (start: string, minutes?: number, fields: Partial<PSTask> = {}): Pick<PSTask, 'scheduledFor' | 'timerMode' | 'countdownDurationSeconds' | 'done'> => ({
  scheduledFor: at(start), done: false,
  ...(minutes === undefined ? {} : { timerMode: 'countdown' as const, countdownDurationSeconds: minutes * 60 }),
  ...fields,
});

const WEDNESDAY_MORNING = at('2026-10-21T09:00:00+03:00');

test('today and tomorrow blocks read as an hour plan in both languages', () => {
  assert.equal(taskTimeRange(block('2026-10-21T14:00:00+03:00', 30), WEDNESDAY_MORNING, KYIV, 'uk'), 'Сьогодні 14:00–14:30');
  assert.equal(taskTimeRange(block('2026-10-21T14:30:00+03:00', 300), WEDNESDAY_MORNING, KYIV, 'uk'), 'Сьогодні 14:30–19:30');
  assert.equal(taskTimeRange(block('2026-10-21T14:00:00+03:00', 30), WEDNESDAY_MORNING, KYIV, 'en'), 'Today 14:00–14:30');
  assert.equal(taskTimeRange(block('2026-10-22T09:00:00+03:00', 60), WEDNESDAY_MORNING, KYIV, 'uk'), 'Завтра 09:00–10:00');
  assert.equal(taskTimeRange(block('2026-10-22T09:00:00+03:00', 60), WEDNESDAY_MORNING, KYIV, 'en'), 'Tomorrow 09:00–10:00');
});

test('later days name the weekday and date before the time', () => {
  assert.equal(taskTimeRange(block('2026-10-23T14:00:00+03:00', 30), WEDNESDAY_MORNING, KYIV, 'uk'), 'Пт, 23 жовт · 14:00–14:30');
  assert.equal(taskTimeRange(block('2026-10-23T14:00:00+03:00', 30), WEDNESDAY_MORNING, KYIV, 'en'), 'Fri, 23 Oct · 14:00–14:30');
  assert.equal(taskTimeRange(block('2026-10-20T14:00:00+03:00'), WEDNESDAY_MORNING, KYIV, 'uk'), 'Вт, 20 жовт · 14:00');
});

test('only a configured countdown adds an end time', () => {
  assert.equal(taskTimeRange(block('2026-10-21T14:00:00+03:00'), WEDNESDAY_MORNING, KYIV, 'uk'), 'Сьогодні 14:00');
  assert.equal(taskTimeRange(block('2026-10-21T14:00:00+03:00', 0), WEDNESDAY_MORNING, KYIV, 'uk'), 'Сьогодні 14:00');
  assert.equal(taskTimeRange(block('2026-10-21T14:00:00+03:00', 30, { timerMode: 'stopwatch' }), WEDNESDAY_MORNING, KYIV, 'uk'), 'Сьогодні 14:00');
  assert.equal(taskTimeRange(block('2026-10-21T14:00:00+03:00', 30, { timerMode: 'none' }), WEDNESDAY_MORNING, KYIV, 'en'), 'Today 14:00');
  // Legacy tasks without timerMode count down when a duration is configured.
  assert.equal(taskTimeRange({ scheduledFor: at('2026-10-21T14:00:00+03:00'), countdownDurationSeconds: 1800 }, WEDNESDAY_MORNING, KYIV, 'uk'), 'Сьогодні 14:00–14:30');
});

test('tasks without a valid start have no time range', () => {
  assert.equal(taskTimeRange({}, WEDNESDAY_MORNING, KYIV, 'uk'), undefined);
  assert.equal(taskTimeRange({ scheduledFor: Number.NaN, timerMode: 'countdown', countdownDurationSeconds: 60 }, WEDNESDAY_MORNING, KYIV, 'en'), undefined);
});

test('day labels follow the Kyiv calendar across DST changes, not 24-hour steps', () => {
  // 25 October 2026 lasts 25 hours in Kyiv: 24 hours after 00:30 is still the same date.
  const autumnNight = at('2026-10-25T00:30:00+03:00');
  assert.equal(taskTimeRange(block('2026-10-25T23:30:00+02:00'), autumnNight, KYIV, 'uk'), 'Сьогодні 23:30');
  assert.equal(taskTimeRange(block('2026-10-26T09:00:00+02:00'), autumnNight, KYIV, 'uk'), 'Завтра 09:00');
  // A two-hour block over the clock change ends two real hours later, which the wall clock shows as 04:00.
  assert.equal(taskTimeRange(block('2026-10-25T03:00:00+03:00', 120), autumnNight, KYIV, 'uk'), 'Сьогодні 03:00–04:00');
  // 29 March 2026 lasts 23 hours: 24 hours after 23:30 on the 28th is already the 30th.
  const springEve = at('2026-03-28T23:30:00+02:00');
  assert.equal(taskTimeRange(block('2026-03-29T09:00:00+03:00', 60), springEve, KYIV, 'en'), 'Tomorrow 09:00–10:00');
  assert.equal(taskTimeRange(block('2026-03-30T00:30:00+03:00'), springEve, KYIV, 'en'), 'Mon, 30 Mar · 00:30');
  assert.equal(calendarDateKey(at('2026-03-29T23:59:00+03:00'), KYIV), '2026-03-29');
});

test('the same instant can be today in one time zone and tomorrow in another', () => {
  const lateUtc = block('2026-10-21T22:30:00Z', 30);
  assert.equal(taskTimeRange(lateUtc, WEDNESDAY_MORNING, 'UTC', 'en'), 'Today 22:30–23:00');
  assert.equal(taskTimeRange(lateUtc, WEDNESDAY_MORNING, KYIV, 'en'), 'Tomorrow 01:30–02:00');
});

test("today's unfinished timed tasks come first in start order and the rest keep the caller's order", () => {
  const tasks = [
    { id: 'unscheduled', done: false },
    { id: 'animation', ...block('2026-10-21T14:30:00+03:00', 300) },
    { id: 'tomorrow', ...block('2026-10-22T09:00:00+03:00', 60) },
    { id: 'blinds', ...block('2026-10-21T13:00:00+03:00', 60) },
    { id: 'done-today', ...block('2026-10-21T08:00:00+03:00', 30, { done: true }) },
    { id: 'planning', ...block('2026-10-21T14:00:00+03:00', 30) },
    { id: 'yesterday', ...block('2026-10-20T10:00:00+03:00', 30) },
  ];
  const sorted = [...tasks].sort((a, b) => compareTodayTimedFirst(a, b, WEDNESDAY_MORNING, KYIV));
  assert.deepEqual(sorted.map(task => task.id), ['blinds', 'planning', 'animation', 'unscheduled', 'tomorrow', 'done-today', 'yesterday']);
});

test('the comparator uses the given time zone for "today"', () => {
  const late = { scheduledFor: at('2026-10-21T22:30:00Z'), done: false };
  const plain = { done: false };
  assert.ok(compareTodayTimedFirst(late, plain, WEDNESDAY_MORNING, 'UTC') < 0);
  assert.equal(compareTodayTimedFirst(late, plain, WEDNESDAY_MORNING, KYIV), 0);
});

test('fixed scheduled duration stays independent of extensions, timer mode and the first work estimate', () => {
  const fixed = { ...block('2026-10-21T14:30:00+03:00', 90), scheduledDurationSeconds: 3600 };
  assert.equal(taskTimeRange(fixed, WEDNESDAY_MORNING, KYIV, 'uk'), 'Сьогодні 14:30–15:30');
  assert.equal(taskTimeRange({ ...fixed, timerMode: 'stopwatch' }, WEDNESDAY_MORNING, KYIV, 'en'), 'Today 14:30–15:30');
  assert.equal(taskTimeRange({ ...fixed, timerMode: 'none' }, WEDNESDAY_MORNING, KYIV, 'en'), 'Today 14:30–15:30');
  const replanned: PSTask = { id: 'replanned', title: 'Робота', phase: 'work', priority: 2, steps: 0, currentStep: 0,
    pinned: false, createdAt: 1, startedAt: 2, plannedDurationSeconds: 3600,
    ...block('2026-10-21T14:30:00+03:00', 90), scheduledDurationSeconds: 5400 };
  assert.equal(taskTimeRange(replanned, WEDNESDAY_MORNING, KYIV, 'uk'), 'Сьогодні 14:30–16:00');
  assert.equal(replanned.plannedDurationSeconds, 3600);
});
