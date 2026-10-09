import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DeletedTask, PSTask } from '../types';
import { buildWorkInsights } from './workInsights';

const DAY = 86400000;
const NOW = Date.parse('2026-10-09T17:30:00Z'); // 20:30 in Kyiv.
const options = { now: NOW, timeZone: 'Europe/Kyiv', lang: 'en' as const };
const task = (id: string, changes: Partial<PSTask> = {}): PSTask => ({
  id, title: `Task ${id}`, phase: 'focus', priority: 2, steps: 0,
  currentStep: 0, done: false, pinned: false, createdAt: NOW - DAY, ...changes,
});
const completed = (id: string, daysAgo: number, changes: Partial<PSTask> = {}) => task(id, {
  done: true, completedAt: NOW - daysAgo * DAY, timeSpentSeconds: 600, ...changes,
});
const archived = (id: string, changes: Partial<DeletedTask> = {}): DeletedTask => ({
  ...completed(id, 1), deletedAt: NOW, ...changes,
});
const learnedHistory = () => [1, 2, 3, 4, 5].map(day => completed(`h-${day}`, day, {
  startedAt: NOW - day * DAY,
}));
const weeklyHistory = () => [1, 2, 8, 15, 16, 17, 22].map((day, index) => completed(`w-${index}`, day));

test('live rows and first archive rows are authoritative; accidental and unfinished archives never count as completions', () => {
  const live = [completed('live', 1), task('reopened'), completed('live', 2, { timeSpentSeconds: 999 })];
  const archive = [
    archived('live', { timeSpentSeconds: 999 }), archived('reopened'),
    archived('accident', { deletionReason: 'accidental' }), archived('accident'),
    archived('cancelled', { done: false, deletionReason: 'cancelled' }), archived('cancelled'),
    archived('unfinished', { done: false }), archived('legacy'),
    archived('finished-cancelled', { deletionReason: 'cancelled' }),
    archived('template', { scheduledPending: true }),
  ];
  const result = buildWorkInsights(live, archive, options);
  assert.equal(result.coverage.completed, 3);
  assert.equal(result.coverage.measured, 3);
  assert.equal(result.coverage.excludedAccidental, 1);
  assert.equal(result.workload.active, 1);
});

test('blank or malformed task IDs and malformed top-level arrays are excluded safely', () => {
  const result = buildWorkInsights([
    completed('valid', 1), completed('valid', 2), completed(' ', 1),
    completed('', 1), { ...completed('invalid', 1), id: 42 }, null,
  ] as any, [null, archived(' ')] as any, options);
  assert.equal(result.coverage.completed, 1);
  assert.equal(result.workload.recentCompleted, 1);
  assert.equal(buildWorkInsights(null as any, {} as any, options).coverage.completed, 0);
});

test('coverage distinguishes recorded effort from zero, missing, non-finite and unsafe measurements', () => {
  const values = [undefined, 0, NaN, Infinity, -2, Number.MAX_SAFE_INTEGER + 1, 61.9];
  const result = buildWorkInsights(values.map((timeSpentSeconds, index) => completed(`c-${index}`, 1, { timeSpentSeconds })), [], options);
  assert.equal(result.coverage.completed, 7);
  assert.equal(result.coverage.measured, 1);
  assert.equal(result.coverage.ratio, 1 / 7);
  assert.equal(result.forecasts.length, 0);
});

test('timestamps alone never invent work duration or a forecast and small histories do not invent a pace', () => {
  const history = [1, 2, 3, 4].map(day => completed(`small-${day}`, day, { timeSpentSeconds: undefined, startedAt: NOW - (day + 1) * DAY }));
  const result = buildWorkInsights([...history, task('active')], [], options);
  assert.equal(result.workload.confidence, 'insufficient');
  assert.equal(result.workload.observedDailyPace, null);
  assert.equal(result.workload.suggestedActiveLimit, null);
  assert.equal(result.workingPattern.confidence, 'insufficient');
  assert.equal(result.queueForecast, null);
  assert.deepEqual(result.prioritySuggestions, []);
  assert.deepEqual(result.forecasts, []);
});

test('five completions concentrated on one local day are insufficient to learn a schedule or pace', () => {
  const history = Array.from({ length: 5 }, (_, index) => completed(`same-${index}`, 1, { completedAt: NOW - DAY - index * 60000 }));
  const result = buildWorkInsights([...history, task('due', { scheduledFor: NOW - 600000 })], [], options);
  assert.equal(result.workload.confidence, 'insufficient');
  assert.equal(result.workingPattern.distinctDays, 1);
  assert.deepEqual(result.workingPattern.observedHours, []);
  assert.deepEqual(result.reminderCandidates, []);
});

test('effort ranges use only recorded completions in the same category and subtract recorded effort', () => {
  const history = [60, 120, 180].map((timeSpentSeconds, index) => completed(`focus-${index}`, index + 1, { timeSpentSeconds }));
  const other = [1000, 2000, 3000].map((timeSpentSeconds, index) => completed(`other-${index}`, index + 1, { phase: 'other', timeSpentSeconds }));
  const result = buildWorkInsights([...history, ...other, task('next', { timeSpentSeconds: 20 }), task('unknown', { phase: 'empty' })], [], options);
  assert.equal(result.forecasts.length, 1);
  const range = result.forecasts[0];
  assert.equal(range.taskId, 'next');
  assert.equal(range.sampleCount, 3);
  assert.equal(range.lowerSeconds, 90);
  assert.equal(range.upperSeconds, 150);
  assert.equal(range.remainingLowerSeconds, 70);
  assert.equal(range.remainingUpperSeconds, 130);
  assert.equal(range.confidence, 'low');
});

test('live sessions count toward remaining effort and reaching the upper range withdraws a remaining prediction', () => {
  const history = [60, 120, 180].map((timeSpentSeconds, index) => completed(`effort-${index}`, index + 1, { timeSpentSeconds }));
  const result = buildWorkInsights([...history,
    task('running', { timeSpentSeconds: 40, timerMode: 'stopwatch', timerRunning: true, timerStartedAt: NOW - 50000 }),
    task('exceeded', { timeSpentSeconds: 150 }),
  ], [], options);
  const running = result.forecasts.find(item => item.taskId === 'running')!;
  assert.equal(running.recordedSeconds, 90);
  assert.equal(running.remainingLowerSeconds, 0);
  assert.equal(running.remainingUpperSeconds, 60);
  const exceeded = result.forecasts.find(item => item.taskId === 'exceeded')!;
  assert.equal(exceeded.remainingLowerSeconds, null);
  assert.equal(exceeded.remainingUpperSeconds, null);
  assert.match(exceeded.explanation, /cannot be estimated reliably/);
});

test('confidence uses category-specific measurement coverage instead of unrelated categories', () => {
  const measured = Array.from({ length: 8 }, (_, index) => completed(`measured-${index}`, 1, { timeSpentSeconds: 600 + index * 60 }));
  const unrelated = Array.from({ length: 20 }, (_, index) => completed(`unrelated-${index}`, 2, { phase: 'other', timeSpentSeconds: undefined }));
  const result = buildWorkInsights([...measured, ...unrelated, task('next')], [], options);
  assert.equal(result.forecasts[0].measurementRatio, 1);
  assert.equal(result.forecasts[0].confidence, 'moderate');
  const missingSameCategory = Array.from({ length: 6 }, (_, index) => completed(`missing-${index}`, 3, { timeSpentSeconds: undefined }));
  const incomplete = buildWorkInsights([...measured, ...unrelated, ...missingSameCategory, task('next')], [], options);
  assert.equal(incomplete.forecasts[0].measurementRatio, 8 / 14);
  assert.equal(incomplete.forecasts[0].confidence, 'low');
});

test('future occurrences and pending schedule templates never inflate the active queue or effort forecasts', () => {
  const result = buildWorkInsights([...learnedHistory(),
    task('active'), task('future', { scheduledFor: NOW + DAY }),
    completed('template', 1, { scheduledPending: true }),
  ], [], options);
  assert.equal(result.workload.active, 1);
  assert.equal(result.coverage.completed, 5);
  assert.deepEqual(result.forecasts.map(item => item.taskId), ['active']);
  assert.deepEqual(result.reminderCandidates, []);
});

test('calendar forecast uses all four nonzero weekly rates and remains a conditional low-confidence range', () => {
  const result = buildWorkInsights([...weeklyHistory(), ...Array.from({ length: 4 }, (_, index) => task(`a-${index}`))], [], options);
  const forecast = result.queueForecast!;
  assert.ok(forecast);
  assert.deepEqual(forecast.weeklyCompletions, [2, 1, 3, 1]);
  assert.equal(forecast.lowerDays, 10);
  assert.equal(forecast.upperDays, 28);
  assert.equal(forecast.earliestAt, NOW + 10 * DAY);
  assert.equal(forecast.latestAt, NOW + 28 * DAY);
  assert.equal(forecast.confidence, 'low');
  assert.match(forecast.explanation, /not a promised deadline/);
});

test('a zero-completion week or empty active queue suppresses calendar dates', () => {
  const history = weeklyHistory();
  assert.equal(buildWorkInsights([...history.filter(item => item.id !== 'w-2'), task('active')], [], options).queueForecast, null);
  assert.equal(buildWorkInsights(history, [], options).queueForecast, null);
});

test('old or future calendar completions do not establish recent pace', () => {
  const history = Array.from({ length: 8 }, (_, index) => completed(`old-${index}`, 29 + index));
  const result = buildWorkInsights([...history, completed('future', -1), task('active')], [], options);
  assert.equal(result.workload.recentCompleted, 0);
  assert.equal(result.workload.observedDailyPace, null);
  assert.equal(result.queueForecast, null);
});

test('working hours learn first-start timestamps in the requested zone and use completion only when start is missing', () => {
  const history = learnedHistory().map(item => ({ ...item, completedAt: item.completedAt! + 3600000 }));
  history[4] = { ...history[4], startedAt: undefined, completedAt: NOW - 5 * DAY };
  const result = buildWorkInsights(history, [], options);
  assert.equal(result.workingPattern.sampleCount, 5);
  assert.equal(result.workingPattern.distinctDays, 5);
  assert.equal(result.workingPattern.confidence, 'low');
  assert.deepEqual(result.workingPattern.observedHours, [{ hour: 20, count: 5 }]);
  const fallback = buildWorkInsights(history, [], { ...options, timeZone: 'not-a-zone' });
  assert.equal(fallback.workingPattern.timeZone, 'UTC');
  assert.deepEqual(fallback.workingPattern.observedHours, [{ hour: 17, count: 5 }]);
});

test('reminders use learned hours, overdue bounds and priority, excluding started, future, pending and finished work', () => {
  const history = learnedHistory();
  const due = [
    task('normal', { scheduledFor: NOW - 600000 }),
    task('urgent', { priority: 1, scheduledFor: NOW - 300000 }),
    task('old', { scheduledFor: NOW - 7200001 }),
    task('early', { scheduledFor: NOW - 299999 }),
    task('future', { scheduledFor: NOW + 60000 }),
    task('started', { scheduledFor: NOW - 600000, startedAt: NOW - 60000 }),
    task('pending', { scheduledFor: NOW - 600000, scheduledPending: true }),
    completed('finished', 1, { scheduledFor: NOW - 600000 }),
  ];
  const result = buildWorkInsights([...history, ...due], [], options);
  assert.deepEqual(result.reminderCandidates.map(item => item.taskId), ['urgent', 'normal']);
  assert.equal(buildWorkInsights([...history, ...due], [], { ...options, now: NOW + 3600000 }).reminderCandidates.length, 0);
});

test('any running active timer suppresses all reminders while paused timers do not', () => {
  const history = learnedHistory();
  const due = task('due', { scheduledFor: NOW - 600000 });
  assert.equal(buildWorkInsights([...history, due, task('running', { timerRunning: true })], [], options).reminderCandidates.length, 0);
  assert.equal(buildWorkInsights([...history, due, task('paused', { timerRunning: false })], [], options).reminderCandidates.length, 1);
});

test('stage bottlenecks use captured live stage effort, reject ambiguous IDs and order the largest overruns first', () => {
  const result = buildWorkInsights([
    task('live', { timeSpentSeconds: 10000, timerMode: 'stopwatch', timerRunning: true, timerStartedAt: NOW - 120000,
      timerStepId: 'stage', stepList: [
        { id: 'stage', title: 'Live stage', done: false, timeSpentSeconds: 100, estimatedDurationSeconds: 120 },
        { id: 'unmeasured', title: 'Unknown stage', done: false, estimatedDurationSeconds: 1 },
      ] }),
    task('duplicates', { timerStepId: 'same', stepList: [
      { id: 'same', title: 'Duplicate A', done: false, timeSpentSeconds: 1000, estimatedDurationSeconds: 60 },
      { id: 'same', title: 'Duplicate B', done: false, timeSpentSeconds: 1000, estimatedDurationSeconds: 60 },
      { id: ' ', title: 'Blank', done: false, timeSpentSeconds: 1000, estimatedDurationSeconds: 60 },
    ] }),
    completed('big', 1, { plannedDurationSeconds: 60, timeSpentSeconds: 1000 }),
  ], [], options);
  assert.deepEqual(result.bottlenecks.map(item => [item.taskId, item.stepId]), [['big', undefined], ['live', 'stage']]);
  assert.equal(result.bottlenecks[1].recordedSeconds, 220);
  assert.equal(result.bottlenecks[1].overrunSeconds, 100);
});

test('missing captured stage identity never distributes total task effort or live elapsed time across steps', () => {
  const result = buildWorkInsights([task('legacy', {
    timeSpentSeconds: 1000, timerRunning: true, timerStartedAt: NOW - 120000,
    stepList: [{ id: 'step', title: 'Unknown effort', done: false, estimatedDurationSeconds: 60 }],
  })], [], options);
  assert.deepEqual(result.bottlenecks, []);
});

test('overrun threshold requires both 25 percent and one minute beyond an explicit plan', () => {
  const result = buildWorkInsights([
    completed('relative-only', 1, { plannedDurationSeconds: 60, timeSpentSeconds: 90 }),
    completed('absolute-only', 1, { plannedDurationSeconds: 600, timeSpentSeconds: 660 }),
    completed('both', 1, { plannedDurationSeconds: 120, timeSpentSeconds: 181 }),
    completed('no-plan', 1, { timeSpentSeconds: 5000 }),
  ], [], options);
  assert.deepEqual(result.bottlenecks.map(item => item.taskId), ['both']);
});

test('priority review proposals retain oldest urgent work, exclude started/scheduled/running items and never mutate tasks', () => {
  const tasks = [...learnedHistory(),
    task('oldest', { priority: 1, createdAt: NOW - 4 * DAY }),
    task('review-a', { priority: 1, createdAt: NOW - 3 * DAY }),
    task('review-b', { priority: 1, createdAt: NOW - 2 * DAY }),
    task('started', { priority: 1, startedAt: NOW - 60000 }),
    task('scheduled', { priority: 1, scheduledFor: NOW - 60000 }),
    task('running', { priority: 1, timerRunning: true }),
  ];
  const before = structuredClone(tasks);
  const result = buildWorkInsights(tasks, [], options);
  assert.deepEqual(result.prioritySuggestions.map(item => item.taskId), ['review-a', 'review-b']);
  assert.ok(result.prioritySuggestions.every(item => item.currentPriority === 1 && item.suggestedPriority === 2));
  assert.deepEqual(tasks, before);
});

test('unsafe or non-finite time samples cannot create unsafe forecasts or misleading overrun entries', () => {
  const history = [60, 120, 180].map((timeSpentSeconds, index) => completed(`valid-${index}`, index + 1, { timeSpentSeconds }));
  const result = buildWorkInsights([...history,
    task('infinite', { timeSpentSeconds: Infinity, plannedDurationSeconds: 60 }),
    task('unsafe', { timeSpentSeconds: Number.MAX_SAFE_INTEGER + 1, plannedDurationSeconds: 60 }),
    task('nan', { timeSpentSeconds: NaN }),
  ], [], options);
  assert.deepEqual(result.forecasts, []);
  assert.deepEqual(result.bottlenecks, []);
});
