import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PSTask } from '../types';
import { addTaskStep, completeTask, createTask, deleteTaskStep, materializeStepList, reopenTask,
  sanitizeTasksTimerSafeguard, setTaskProgress, setTaskTimeSpent, startTaskWork, toggleTaskDone, toggleTaskStep } from './taskOperations';

const task = (overrides: Partial<PSTask> = {}): PSTask => ({
  id: 'task-1', title: 'Task', phase: 'focus', priority: 2, steps: 1,
  currentStep: 0, done: false, pinned: false, createdAt: 1, ...overrides,
});

test('stale running timers are capped and paused after desktop restart', () => {
  const now = 10_000_000;
  const [repaired] = sanitizeTasksTimerSafeguard([
    task({ timerRunning: true, timerStartedAt: now - 3 * 60 * 60 * 1000, timeSpentSeconds: 30 }),
  ], now);
  assert.equal(repaired.timerRunning, false);
  assert.equal(repaired.timerStartedAt, undefined);
  assert.equal(repaired.timeSpentSeconds, 7230);
  assert.equal(repaired.autoPausedOverdue, true);
});

test('expired countdown restored after restart banks only its remaining session once', () => {
  const original = task({ timerRunning: true, timerStartedAt: 1000, timeSpentSeconds: 900,
    countdownDurationSeconds: 3600, countdownRemainingSeconds: 1800 });
  const restored = JSON.parse(JSON.stringify(original));
  const [settled] = sanitizeTasksTimerSafeguard([restored], 10_000_000);
  assert.equal(settled.timeSpentSeconds, 2700);
  assert.equal(settled.countdownRemainingSeconds, 0);
  assert.equal(settled.timerRunning, false);
  assert.equal(settled.done, false);
  assert.equal(sanitizeTasksTimerSafeguard([settled], 20_000_000)[0], settled);
});

test('explicit long countdown is not cut short by the stopwatch two-hour safeguard', () => {
  const running = task({ timerRunning: true, timerStartedAt: 1000,
    countdownDurationSeconds: 14400, countdownRemainingSeconds: 14400 });
  assert.equal(sanitizeTasksTimerSafeguard([running], 3 * 3600 * 1000)[0], running);
});

test('checking the last step leaves its parent active until explicit completion banks time once', () => {
  const running = task({ steps: 3, currentStep: 1, timerRunning: true, timerStartedAt: 1000,
    timeSpentSeconds: 20, countdownDurationSeconds: 60, countdownRemainingSeconds: 60 });
  assert.deepEqual(materializeStepList(running).map(step => step.done), [true, false, false]);
  const allSteps = setTaskProgress(running, 99, 120_000);
  assert.equal(allSteps.done, false);
  assert.equal(allSteps.timerRunning, true);
  assert.equal(allSteps.completedAt, undefined);
  const done = completeTask(allSteps, 120_000);
  assert.equal(done.done, true);
  assert.equal(done.currentStep, 3);
  assert.equal(done.completedAt, 120_000);
  assert.equal(done.timerRunning, false);
  assert.equal(done.timeSpentSeconds, 80);
  assert.equal(done.countdownRemainingSeconds, 0);
  assert.equal(setTaskProgress(done, 3, 150_000).timeSpentSeconds, 80);
  const edited = toggleTaskStep(done, 1, 160_000);
  assert.equal(edited.done, true);
  assert.equal(edited.completedAt, 120_000);
  const reopened = reopenTask(edited, 160_000);
  assert.equal(reopened.done, false);
  assert.equal(reopened.completedAt, undefined);
  assert.equal(reopened.currentStep, 2);
});

test('adding and removing steps keep completion and archive dates consistent', () => {
  const done = toggleTaskDone(task({ steps: 2, currentStep: 2 }), 10_000);
  const added = addTaskStep(done, { id: 'new-step', title: ' Verify ', done: true }, 20_000);
  assert.equal(added.done, true);
  assert.equal(added.completedAt, 10_000);
  assert.equal(added.currentStep, 2);
  assert.equal(added.stepList![2].title, 'Verify');
  const allSteps = deleteTaskStep(reopenTask(added, 25_000), 2, 30_000);
  assert.equal(allSteps.done, false);
  const closed = completeTask(allSteps, 30_000);
  assert.equal(closed.done, true);
  assert.equal(closed.completedAt, 30_000);
  assert.equal(deleteTaskStep(closed, -1, 40_000), closed);
  assert.equal(addTaskStep(added, { id: 'new-step', title: 'Duplicate', done: false }, 40_000), added);
});

test('new tasks support zero subtasks and no timer without an artificial step or automatic start', () => {
  const created = createTask({ title: '  Write report  ', phase: 'work', priority: 2, steps: 0 }, 'new-1', 1000)!;
  assert.equal(created.title, 'Write report');
  assert.equal(created.timerMode, 'none');
  assert.equal(created.steps, 0);
  assert.deepEqual(materializeStepList(created), []);
  assert.equal(created.timerRunning, false);
  assert.equal(created.startedAt, undefined);
  const started = startTaskWork(created, 2000);
  assert.equal(started.startedAt, 2000);
  assert.equal(started.timerRunning, false);
  assert.equal(startTaskWork(started, 3000).startedAt, 2000);
  const completed = completeTask(started, 4000);
  assert.equal(completed.steps, 0);
  assert.equal(completed.currentStep, 0);
  assert.equal(completed.timeSpentSeconds, 0);
  assert.equal(startTaskWork(completed, 5000), completed);
});

test('new countdowns are paused until start and completion/reopening preserve actual checklist and budget', () => {
  const created = createTask({ title: 'Draft', phase: 'work', priority: 1, steps: 2, timerMode: 'countdown',
    countdownDurationSeconds: 60, stepList: [{ id: 'a', title: 'Prepare', done: true }, { id: 'b', title: 'Write', done: false }] }, 'new-2', 1000)!;
  assert.equal(created.countdownRemainingSeconds, 60);
  assert.equal(created.timerRunning, false);
  assert.equal(created.stepList![0].done, false);
  const started = startTaskWork(created, 2000);
  const checked = toggleTaskStep(started, 0, 20_000);
  const completed = completeTask(checked, 32_000);
  assert.equal(completed.timeSpentSeconds, 30);
  assert.equal(completed.countdownRemainingSeconds, 30);
  assert.equal(completed.currentStep, 1);
  assert.deepEqual(completed.stepList!.map(step => step.done), [true, false]);
  assert.equal(completeTask(completed, 40_000).timeSpentSeconds, 30);
  const reopened = toggleTaskDone(completed, 50_000);
  assert.equal(reopened.done, false);
  assert.equal(reopened.timerRunning, false);
  assert.equal(reopened.countdownRemainingSeconds, 30);
  assert.equal(reopened.startedAt, 2000);
  assert.deepEqual(reopened.stepList, completed.stepList);
});

test('create validates titles, counts, modes and the allowed countdown interval without mutation', () => {
  const base = { title: 'Task', phase: 'focus', priority: 2 as const, steps: 0 };
  for (const changes of [{ title: ' ' }, { steps: -1 }, { steps: NaN }, { steps: 1.5 },
    { timerMode: 'invalid' }, ...[0, 59, 86401, NaN, Infinity, 60.5].map(countdownDurationSeconds =>
      ({ timerMode: 'countdown', countdownDurationSeconds }))]) {
    assert.equal(createTask({ ...base, ...changes } as any, 'new', 1000), null);
  }
  for (const countdownDurationSeconds of [60, 86400]) {
    assert.ok(createTask({ ...base, timerMode: 'countdown', countdownDurationSeconds }, 'new', 1000));
  }
  assert.deepEqual(base, { title: 'Task', phase: 'focus', priority: 2, steps: 0 });
});

test('manual time editing preserves consumed countdown budget and rejects invalid totals', () => {
  const running = task({ timerRunning: true, timerStartedAt: 1000,
    countdownDurationSeconds: 60, countdownRemainingSeconds: 60 });
  const edited = setTaskTimeSpent(running, 300, 31_000);
  assert.equal(edited.countdownRemainingSeconds, 30);
  assert.equal(edited.timerStartedAt, 31_000);
  assert.equal(edited.timeSpentSeconds, 300);
  assert.equal(setTaskTimeSpent(edited, NaN, 40_000), edited);
  assert.equal(setTaskTimeSpent(edited, -10, 40_000).timeSpentSeconds, 0);
});

test('malformed or future running timestamps are safely paused rather than running forever', () => {
  for (const started of [undefined, NaN, Infinity, 200_000]) {
    const [repaired] = sanitizeTasksTimerSafeguard([task({ timerRunning: true, timerStartedAt: started, timeSpentSeconds: 20 })], 100_000);
    assert.equal(repaired.timerRunning, false);
    assert.equal(repaired.timeSpentSeconds, 20);
    assert.equal(repaired.autoPausedOverdue, true);
  }
});
