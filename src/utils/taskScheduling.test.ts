import test from 'node:test';
import assert from 'node:assert/strict';
import { createScheduledTaskPlan, getDueScheduledOccurrences, materializeScheduledWorkspace, normalizeTaskSchedule } from './taskScheduling';
import type { PSTask } from '../types';

const task = { title: 'Швидкий друк', phase: 'work', priority: 2 as const, steps: 0 };
const at = (iso: string) => Date.parse(iso);
function plan(startAt = '2026-10-09T20:00:00+03:00', recurrence: 'once' | 'daily' = 'once') {
  return createScheduledTaskPlan('typing', task, { startAt, recurrence, timeZone: 'Europe/Kyiv', leadMinutes: 5 });
}

test('creates a planned task five minutes before its local start and consumes once plan', () => {
  const p = plan();
  assert.equal(getDueScheduledOccurrences([p], at('2026-10-09T19:54:59+03:00')).tasks.length, 0);
  const due = getDueScheduledOccurrences([p], at('2026-10-09T19:55:00+03:00'));
  assert.equal(due.tasks.length, 1);
  assert.equal(due.plans.length, 0);
  assert.equal(due.tasks[0].timerRunning, false);
  assert.equal(due.notifications[0].scheduledFor, at(p.schedule.startAt));
  assert.equal(getDueScheduledOccurrences(due.plans, at('2026-10-09T20:00:00+03:00')).tasks.length, 0);
});

test('existing occurrence IDs, including deleted records, prevent recreation and advance plan', () => {
  const p = plan(undefined, 'daily');
  const now = at('2026-10-09T19:55:00+03:00');
  const first = getDueScheduledOccurrences([p], now);
  const repeat = getDueScheduledOccurrences([p], now, [first.tasks[0].id]);
  assert.equal(repeat.tasks.length, 0);
  assert.equal(repeat.notifications.length, 0);
  assert.equal(repeat.plans[0].nextStartAt, '2026-10-10T17:00:00.000Z');
  assert.equal(getDueScheduledOccurrences([p, p], now).tasks.length, 1);
});

test('overdue once plan catches up after reopening', () => {
  const result = getDueScheduledOccurrences([plan()], at('2026-10-12T09:00:00+03:00'));
  assert.equal(result.tasks.length, 1);
  assert.equal(result.plans.length, 0);
});

test('offline daily catchup creates latest due only, with next evening retained', () => {
  const result = getDueScheduledOccurrences([plan(undefined, 'daily')], at('2026-10-15T10:00:00+03:00'));
  assert.equal(result.tasks.length, 1);
  assert.equal(result.notifications[0].scheduledFor, at('2026-10-14T20:00:00+03:00'));
  assert.equal(result.plans[0].nextStartAt, '2026-10-15T17:00:00.000Z');
});

test('daily wall time survives autumn and spring DST changes', () => {
  const fall = getDueScheduledOccurrences([plan('2026-10-23T20:00:00+03:00', 'daily')], at('2026-10-25T19:55:00+02:00'));
  assert.equal(fall.notifications[0].scheduledFor, at('2026-10-25T20:00:00+02:00'));
  assert.equal(fall.plans[0].nextStartAt, '2026-10-26T18:00:00.000Z');
  const spring = getDueScheduledOccurrences([plan('2026-03-27T20:00:00+02:00', 'daily')], at('2026-03-29T19:55:00+03:00'));
  assert.equal(spring.notifications[0].scheduledFor, at('2026-03-29T20:00:00+03:00'));
  assert.equal(spring.plans[0].nextStartAt, '2026-03-30T17:00:00.000Z');
});

test('nonexistent spring hour shifts forward, subsequent days return to original hour', () => {
  const p = createScheduledTaskPlan('gap', task, { startAt: '2026-03-27T02:30:00+01:00', recurrence: 'daily', timeZone: 'Europe/Warsaw', leadMinutes: 5 });
  const due = getDueScheduledOccurrences([p], at('2026-03-29T03:25:00+02:00'));
  assert.equal(due.notifications[0].scheduledFor, at('2026-03-29T03:30:00+02:00'));
  assert.equal(due.plans[0].nextStartAt, '2026-03-30T00:30:00.000Z');
});

test('repeated autumn hour creates a single occurrence at its first instant', () => {
  const p = createScheduledTaskPlan('repeat', task, { startAt: '2026-10-23T02:30:00+02:00', recurrence: 'daily', timeZone: 'Europe/Warsaw', leadMinutes: 5 });
  const due = getDueScheduledOccurrences([p], at('2026-10-25T02:25:00+02:00'));
  assert.equal(due.notifications[0].scheduledFor, at('2026-10-25T02:30:00+02:00'));
  assert.equal(getDueScheduledOccurrences(due.plans, at('2026-10-25T02:25:00+01:00')).tasks.length, 0);
});

test('rejects invalid schedules; defaults lead to five minutes', () => {
  const base = { startAt: '2026-10-09T20:00:00+03:00', recurrence: 'daily', timeZone: 'Europe/Kyiv' };
  assert.equal(normalizeTaskSchedule(base)?.leadMinutes, 5);
  for (const change of [{ timeZone: 'Wrong/Zone' }, { startAt: '2026-10-09T20:00:00' }, { leadMinutes: -1 }, { leadMinutes: 1.5 }, { recurrence: 'weekly' }]) {
    assert.equal(normalizeTaskSchedule({ ...base, ...change }), null);
  }
});

test('strict frontend scheduling validation rejects invalid calendars and offset limits', () => {
  const base = plan().schedule;
  for (const startAt of ['2026-02-30T20:00:00Z', '2026-13-01T20:00:00Z', '2026-10-10T24:00:00Z', '2026-10-10T20:00:00', '2026-10-10T20:00:00+14:30', '2026-10-10T20:00:00+15:00', '2026-10-10T20:00:00+03:60', '2026-10-10T20:00Z', '1999-10-10T20:00:00Z', '2101-10-10T20:00:00Z']) {
    assert.equal(normalizeTaskSchedule({ ...base, startAt }), null, startAt);
  }
  assert.equal(normalizeTaskSchedule({ ...base, arbitrary: true }), null);
  assert.ok(normalizeTaskSchedule({ ...base, startAt: '2028-02-29T20:00:00.123+14:00' }));
});

function pending(recurrence: 'once' | 'daily' = 'once'): PSTask {
  return { ...task, id: 'typing-plan', done: false, pinned: false, currentStep: 0, createdAt: 1, scheduledPending: true, schedule: plan(undefined, recurrence).schedule };
}

test('workspace wrapper preserves future plans without counting or materializing them early', () => {
  const records = [pending()];
  const result = materializeScheduledWorkspace(records, [], at('2026-10-09T19:54:00+03:00'));
  assert.equal(result.records, records);
  assert.equal(result.records[0].scheduledPending, true);
  assert.equal(result.notifications.length, 0);
});

test('workspace JSON round trip persists cursor and strips template metadata from occurrence', () => {
  const template = pending('daily');
  template.timerMode = 'countdown';
  template.countdownDurationSeconds = 600;
  template.timerRunning = true;
  template.timeSpentSeconds = 50;
  template.currentStep = 1;
  template.steps = 1;
  template.stepList = [{ id: 'step1', title: 'Підготовка', done: true }];
  const result = materializeScheduledWorkspace(JSON.parse(JSON.stringify([template])), [], at('2026-10-09T19:55:00+03:00'));
  const occurrence = result.records[0];
  assert.equal(occurrence.scheduledPending, undefined);
  assert.equal(occurrence.schedule, undefined);
  assert.equal(occurrence.scheduleNextStartAt, undefined);
  assert.equal(occurrence.timeSpentSeconds, 0);
  assert.equal(occurrence.timerRunning, false);
  assert.equal(occurrence.countdownRemainingSeconds, 600);
  assert.equal(occurrence.currentStep, 0);
  assert.equal(occurrence.stepList?.[0].done, false);
  assert.equal(result.records[1].schedule?.startAt, template.schedule?.startAt);
  assert.equal(result.records[1].scheduleNextStartAt, '2026-10-10T17:00:00.000Z');
  const restored = JSON.parse(JSON.stringify(result.records)) as PSTask[];
  assert.equal(materializeScheduledWorkspace(restored, [], at('2026-10-09T20:00:00+03:00')).records, restored);
});

test('workspace wrapper consumes once plans even when occurrence was already deleted', () => {
  const template = pending();
  const first = materializeScheduledWorkspace([template], [], at('2026-10-09T19:55:00+03:00'));
  const repeated = materializeScheduledWorkspace([template], [first.records[0].id], at('2026-10-09T20:00:00+03:00'));
  assert.equal(repeated.records.length, 0);
  assert.equal(repeated.notifications.length, 0);
});

test('invalid durable schedules remain visible for correction without crashing scheduler', () => {
  const invalid = { ...pending(), schedule: { ...pending().schedule!, timeZone: 'invalid-zone' } };
  const records = [invalid];
  assert.equal(materializeScheduledWorkspace(records).records, records);
});

test('daily occurrences clear prior stage measurements and session identity but retain explicit estimates', () => {
  const template: PSTask = { ...pending('daily'), timerMode: 'countdown', countdownDurationSeconds: 900,
    plannedDurationSeconds: 600, steps: 1, currentStep: 1, timerRunning: true, timerStartedAt: 50,
    timerStepId: 'collect', timeSpentSeconds: 100, startedAt: 10, completedAt: 40,
    stepList: [{ id: 'collect', title: 'Collect', done: true, estimatedDurationSeconds: 300, timeSpentSeconds: 100 }] };
  const snapshot = structuredClone(template);
  const first = materializeScheduledWorkspace([template], [], at('2026-10-09T19:55:00+03:00'));
  const occurrence = first.records[0];
  assert.equal(occurrence.plannedDurationSeconds, 600);
  assert.equal(occurrence.countdownRemainingSeconds, 900);
  assert.equal(occurrence.timerRunning, false);
  assert.equal(occurrence.timeSpentSeconds, 0);
  assert.equal(occurrence.timerStepId, undefined);
  assert.equal(occurrence.timerStartedAt, undefined);
  assert.equal(occurrence.startedAt, undefined);
  assert.equal(occurrence.completedAt, undefined);
  assert.deepEqual(occurrence.stepList, [{ id: 'collect', title: 'Collect', done: false, estimatedDurationSeconds: 300 }]);
  const second = materializeScheduledWorkspace(first.records, [], at('2026-10-10T19:55:00+03:00'));
  assert.notEqual(second.records[0].id, occurrence.id);
  assert.deepEqual(second.records[0].stepList, occurrence.stepList);
  assert.notEqual(second.records[0].stepList, occurrence.stepList);
  assert.deepEqual(template, snapshot);
});
