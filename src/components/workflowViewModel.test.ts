import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DeletedTask, PSTask } from '../types';
import { getNextPendingStepIndex, getPendingTaskIndexes, getPeriodBounds, getRollingWindows, selectPeriodTasks } from './workflowViewModel';

const now = new Date(2026, 9, 6, 12);
const september = new Date(2026, 8, 20, 12).getTime();
const october = new Date(2026, 9, 2, 12).getTime();
const task = (id: string, fields: Partial<PSTask> = {}): PSTask => ({
  id, title: id, phase: 'focus', priority: 2, steps: 1, currentStep: 0,
  done: false, pinned: false, createdAt: september, ...fields,
});

test('completion is attributed to completion date even after later deletion', () => {
  const deleted: DeletedTask[] = [
    { ...task('old', { done: true, completedAt: september }), deletedAt: october },
    { ...task('new', { done: true, completedAt: october }), deletedAt: october },
  ];
  const result = selectPeriodTasks([], deleted, 'THIS_MONTH', now);
  assert.deepEqual(result.deletedCompleted.map(item => item.id), ['new']);
  assert.equal(result.droppedInPeriod.length, 0);
  assert.equal(result.createdInPeriod.length, 0);
});

test('creation is not counted as deletion and later completion is not counted in last year', () => {
  const created = new Date(2025, 11, 30).getTime();
  const deleted: DeletedTask[] = [{ ...task('dropped', { createdAt: created }), deletedAt: october, deletionReason: 'cancelled' }];
  const completed = task('completed', { createdAt: created, completedAt: october, done: true });
  const result = selectPeriodTasks([completed], deleted, 'LAST_YEAR', now);
  assert.equal(result.completedInPeriod.length, 0);
  assert.equal(result.droppedInPeriod.length, 0);
  assert.equal(result.createdInPeriod.length, 2);
});

test('archive analytics exclude accidental and unclassified unfinished tasks without changing recoverable data', () => {
  const deleted: DeletedTask[] = [
    { ...task('unknown', { createdAt: october }), deletedAt: october },
    { ...task('accidental', { createdAt: october }), deletedAt: october, deletionReason: 'accidental' },
    { ...task('accidental-completed', { createdAt: october, done: true, completedAt: october }), deletedAt: october, deletionReason: 'accidental' },
    { ...task('cancelled', { createdAt: october }), deletedAt: october, deletionReason: 'cancelled' },
    { ...task('legacy-completed', { createdAt: october, done: true }), deletedAt: october },
  ];
  const saved = structuredClone(deleted);
  const result = selectPeriodTasks([], deleted, 'THIS_MONTH', now);
  assert.deepEqual(result.deletedCompleted.map(item => item.id), ['legacy-completed']);
  assert.deepEqual(result.droppedInPeriod.map(item => item.id), ['cancelled']);
  assert.deepEqual(result.createdInPeriod.map(item => item.id), ['cancelled', 'legacy-completed']);
  assert.deepEqual(result.deletedInPeriod.map(item => item.id), ['cancelled', 'legacy-completed']);
  assert.deepEqual(deleted, saved);
});

test('cancelled work is attributed to deletion date, independently of creation and completion', () => {
  const deleted: DeletedTask[] = [
    { ...task('cancelled-this-month'), deletedAt: october, deletionReason: 'cancelled' },
    { ...task('cancelled-last-month', { createdAt: october }), deletedAt: september, deletionReason: 'cancelled' },
    { ...task('completed', { done: true, completedAt: september }), deletedAt: october, deletionReason: 'cancelled' },
  ];
  const result = selectPeriodTasks([], deleted, 'THIS_MONTH', now);
  assert.deepEqual(result.droppedInPeriod.map(item => item.id), ['cancelled-this-month']);
  assert.deepEqual(result.createdInPeriod.map(item => item.id), ['cancelled-last-month']);
  assert.deepEqual(result.deletedInPeriod.map(item => item.id), ['cancelled-this-month', 'completed']);
  assert.equal(result.deletedCompleted.length, 0);
});

test('restored tasks and repeated archive records are counted once, using the current task and first archive row', () => {
  const current = [task('restored', { createdAt: october }), task('current-completed', { createdAt: october, done: true, completedAt: october })];
  const deleted: DeletedTask[] = [
    { ...task('restored', { createdAt: october, done: true, completedAt: october }), deletedAt: october },
    { ...task('current-completed', { createdAt: october, done: true, completedAt: october }), deletedAt: october },
    { ...task('archived-completed', { createdAt: october, done: true, completedAt: october }), deletedAt: october },
    { ...task('archived-completed', { createdAt: october, done: true, completedAt: october }), deletedAt: october },
    { ...task('excluded-newest', { createdAt: october, done: true, completedAt: october }), deletedAt: october, deletionReason: 'accidental' },
    { ...task('excluded-newest', { createdAt: october, done: true, completedAt: october }), deletedAt: september },
  ];
  const result = selectPeriodTasks(current, deleted, 'THIS_MONTH', now);
  assert.deepEqual(result.activeInPeriod.map(item => item.id), ['restored']);
  assert.deepEqual(result.completedInPeriod.map(item => item.id), ['current-completed']);
  assert.deepEqual(result.deletedCompleted.map(item => item.id), ['archived-completed']);
  assert.deepEqual(result.createdInPeriod.map(item => item.id), ['restored', 'current-completed', 'archived-completed']);
  assert.deepEqual(result.deletedInPeriod.map(item => item.id), ['archived-completed']);
});

test('calendar month includes exactly 30 local days and excludes future timestamps', () => {
  const { start, end } = getPeriodBounds('LAST_30_DAYS', now);
  assert.equal(start, new Date(2026, 8, 7).getTime());
  assert.equal(end, now.getTime());
  const result = selectPeriodTasks([
    task('first', { createdAt: start }),
    task('last', { createdAt: end }),
    task('before', { createdAt: start - 1 }),
    task('future', { createdAt: end + 1 }),
  ], [], 'LAST_30_DAYS', now);
  assert.deepEqual(result.createdInPeriod.map(item => item.id), ['first', 'last']);
});

test('dashboard periods start at local midnight and include today across calendar boundaries', () => {
  const clock = new Date(2025, 9, 26, 12, 30);
  for (const [period, days] of [['TODAY', 1], ['LAST_7_DAYS', 7], ['LAST_30_DAYS', 30], ['LAST_90_DAYS', 90], ['LAST_365_DAYS', 365]] as const) {
    const expected = new Date(2025, 9, 26 - days + 1).getTime();
    const { start, end } = getPeriodBounds(period, clock);
    assert.equal(start, expected, period);
    assert.equal(end, clock.getTime(), period);
    const result = selectPeriodTasks([
      task('before', { createdAt: start - 1 }), task('first', { createdAt: start }),
      task('now', { createdAt: end }), task('future', { createdAt: end + 1 }),
    ], [], period, clock);
    assert.deepEqual(result.createdInPeriod.map(item => item.id), ['first', 'now'], period);
  }
});

test('legacy calendar periods keep their existing bounds', () => {
  assert.deepEqual(getPeriodBounds('THIS_MONTH', now), { start: new Date(2026, 9, 1).getTime(), end: now.getTime() });
  assert.deepEqual(getPeriodBounds('THIS_YEAR', now), { start: new Date(2026, 0, 1).getTime(), end: now.getTime() });
  assert.deepEqual(getPeriodBounds('LAST_YEAR', now), { start: new Date(2025, 0, 1).getTime(), end: new Date(2026, 0, 1).getTime() - 1 });
  assert.deepEqual(getPeriodBounds('ALL_TIME', now), { start: -Infinity, end: now.getTime() });
});

test('legacy rolling windows partition elapsed time without overlapping boundaries', () => {
  const end = now.getTime();
  const windows = getRollingWindows(end, 30);
  const start = end - 30 * 86400000;
  assert.equal(windows[0].start, start);
  assert.equal(windows[3].end, end);
  for (const timestamp of [start, end, ...windows.slice(0, -1).map(window => window.end)]) {
    assert.equal(windows.filter(window =>
      (window.includeStart ? timestamp >= window.start : timestamp > window.start) && timestamp <= window.end,
    ).length, 1);
  }
});

test('add all only includes suggestions not already injected singly', () => {
  assert.deepEqual(getPendingTaskIndexes(4, [0, 2]), [1, 3]);
  assert.deepEqual(getPendingTaskIndexes(4, [0, 1, 2, 3]), []);
  assert.deepEqual(getPendingTaskIndexes(0, []), []);
});

test('next action follows first pending step, including out of order completion', () => {
  const steps = [false, true, false].map((done, index) => ({ id: String(index), title: String(index), done }));
  assert.equal(getNextPendingStepIndex(steps), 0);
  assert.equal(getNextPendingStepIndex(steps.map(step => ({ ...step, done: true }))), -1);
  assert.equal(getNextPendingStepIndex([]), -1);
});
