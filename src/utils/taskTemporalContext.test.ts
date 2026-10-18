import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTaskTemporalContext } from './taskTemporalContext';

// Monday 2026-10-12, 12:00 in Kyiv.
const clock = { now: '2026-10-12T09:00:00Z', timeZone: 'Europe/Kyiv' };

test('dated tasks carry precomputed weekday, distance and calendar week', () => {
  const context = buildTaskTemporalContext([
    { id: 'today', title: 'Today', deadlineDate: '2026-10-12' },
    { id: 'friday', title: 'Friday', deadlineDate: '2026-10-16' },
    { id: 'sunday', title: 'Sunday', plannedDate: '2026-10-18' },
    { id: 'next-monday', title: 'Next Monday', plannedDate: '2026-10-19' },
    { id: 'next-tuesday', title: 'Next Tuesday', deadlineDate: '2026-10-20' },
    { id: 'later', title: 'Later', deadlineDate: '2026-10-26' },
    { id: 'last-friday', title: 'Last Friday', deadlineDate: '2026-10-09' },
    { id: 'older', title: 'Older', deadlineDate: '2026-09-30' },
  ], clock);
  assert.deepEqual(context.clock.thisWeek, { start: '2026-10-12', end: '2026-10-18' });
  assert.deepEqual(context.clock.nextWeek, { start: '2026-10-19', end: '2026-10-25' });
  assert.equal(context.clock.weekStartsOn, 'Monday');
  const byId = Object.fromEntries(context.tasks.map(task => [task.id, task]));
  assert.deepEqual(byId.friday.deadlineDay, { date: '2026-10-16', relation: 'future', weekday: 'Friday', daysFromToday: 4, week: 'this', inclusive: true });
  assert.deepEqual(byId.today.deadlineDay, { date: '2026-10-12', relation: 'today', weekday: 'Monday', daysFromToday: 0, week: 'this', inclusive: true });
  assert.deepEqual(byId.sunday.plannedDay, { date: '2026-10-18', relation: 'future', weekday: 'Sunday', daysFromToday: 6, week: 'this' });
  assert.equal(byId['next-monday'].plannedDay?.week, 'next');
  assert.deepEqual(byId['next-tuesday'].deadlineDay, { date: '2026-10-20', relation: 'future', weekday: 'Tuesday', daysFromToday: 8, week: 'next', inclusive: true });
  assert.equal(byId.later.deadlineDay?.week, 'later');
  assert.deepEqual(byId['last-friday'].deadlineDay, { date: '2026-10-09', relation: 'past', weekday: 'Friday', daysFromToday: -3, week: 'previous', inclusive: true });
  assert.equal(byId.older.deadlineDay?.week, 'earlier');
});

test('deadline counts separate this week, next week and overdue; finished and archived work is excluded', () => {
  const context = buildTaskTemporalContext([
    { id: 'today', title: 'Today', deadlineDate: '2026-10-12' },
    { id: 'friday', title: 'Friday', deadlineDate: '2026-10-16' },
    { id: 'done', title: 'Done', deadlineDate: '2026-10-14', done: true },
    { id: 'next', title: 'Next', deadlineDate: '2026-10-20' },
    { id: 'overdue', title: 'Overdue', deadlineDate: '2026-10-09' },
  ], clock, { archivedTasks: [{ id: 'archived', title: 'Archived', deadlineDate: '2026-10-15', deletedAt: Date.parse('2026-10-11T08:00:00Z') }] });
  assert.equal(context.counts.upcomingDeadlinesThisWeek, 2);
  assert.equal(context.counts.deadlinesNextWeek, 1);
  assert.equal(context.counts.overdueDeadlines, 1);
});

test('week boundaries follow the client time zone, and Sunday’s tomorrow is already next week', () => {
  // 21:30 UTC on Sunday is 00:30 on Monday in Kyiv.
  const instant = '2026-10-18T21:30:00Z';
  const kyiv = buildTaskTemporalContext([{ id: 'a', title: 'A', deadlineDate: '2026-10-19' }], { now: instant, timeZone: 'Europe/Kyiv' });
  assert.deepEqual(kyiv.clock.thisWeek, { start: '2026-10-19', end: '2026-10-25' });
  assert.equal(kyiv.tasks[0].deadlineDay?.week, 'this');
  assert.equal(kyiv.counts.upcomingDeadlinesThisWeek, 1);
  const utc = buildTaskTemporalContext([{ id: 'a', title: 'A', deadlineDate: '2026-10-19' }], { now: instant, timeZone: 'UTC' });
  assert.deepEqual(utc.clock.thisWeek, { start: '2026-10-12', end: '2026-10-18' });
  assert.equal(utc.tasks[0].deadlineDay?.relation, 'tomorrow');
  assert.equal(utc.tasks[0].deadlineDay?.week, 'next');
  assert.equal(utc.counts.upcomingDeadlinesThisWeek, 0);
  assert.equal(utc.counts.deadlinesNextWeek, 1);
});

test('credited attempts are described neutrally without claiming task completion', () => {
  const context = buildTaskTemporalContext([{ id: 'a', title: 'Portfolio', done: false,
    activityTrail: [{ id: 'attempt:a', at: Date.parse(clock.now) - 1000, kind: 'attempt', attemptSeconds: 300,
      attemptCapSeconds: 900, attemptOutcome: 'stopped' }] }], clock);
  assert.equal(context.tasks[0].recentActivity?.[0].description, 'обмежена спроба: 5 хв із 15');
  assert.equal(context.tasks[0].done, false);
  assert.equal(context.tasks[0].recentActivity?.[0].attemptOutcome, 'stopped');
});
