import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PSTask } from '../types';
import type { WorkspaceState } from './syncState';
import { continueAfterExpiry, countdownReminderIndex, finishAfterExpiry, MAX_OVERRUN_SECONDS, overrunGapSeconds } from './countdownOverrun';
import { serializeTaskForCloud } from './cloudTaskSerialization';
import { startLimitedStart } from './limitedStart';
import { completeTask, sanitizeTasksTimerSafeguard } from './taskOperations';
import { configureTaskCountdown, expireTaskCountdown, getTaskRemainingSeconds, getTaskTotalSeconds } from './taskTimer';
import { applyWorkspaceMutation, diffWorkspaceMutation } from './syncOperations';
import { parseWorkspace } from './workspaceValidation';
import { parseWorkspace as parseNativeWorkspace } from '../../electron/workspace-validation.mjs';

const task = (overrides: Partial<PSTask> = {}): PSTask => ({
  id: 'focus', title: 'Жалюзі', phase: 'work', priority: 2, steps: 0,
  currentStep: 0, done: false, pinned: false, createdAt: 0, ...overrides,
});
const expired = (): PSTask => expireTaskCountdown(configureTaskCountdown(task({ timeSpentSeconds: 20 }), 60, 1000), 120_000);
const workspace = (value: PSTask): WorkspaceState => ({ tasks: [value], deletedTasks: [], tabs: [{ id: 'work', name: 'Work' }],
  settings: { lang: 'uk', aiIconVariant: 'quantum', soundEnabled: true, fireEnabled: false } });

test('automatic expiry records the actual zero crossing, banks its budget once, and excludes limited starts', () => {
  const running = configureTaskCountdown(task({ timeSpentSeconds: 20 }), 60, 1000);
  assert.equal(expireTaskCountdown(running, 60_999), running);
  const [settled] = sanitizeTasksTimerSafeguard([running], 120_000);
  assert.equal(settled.countdownExpiredAt, 61_000);
  assert.equal(settled.timeSpentSeconds, 80);
  assert.equal(settled.timerRunning, false);
  assert.equal(expireTaskCountdown(settled, 180_000), settled);
  const limited = startLimitedStart(task(), 60, 1000);
  const [paused] = sanitizeTasksTimerSafeguard([limited], 120_000);
  assert.equal(paused.timerRunning, false);
  assert.equal(paused.countdownExpiredAt, undefined);
});

test('continue credits the unrecorded gap once and starts the extension without a fresh original interval', () => {
  const original = expired();
  const next = continueAfterExpiry(original, 181_000, 30, () => 'continued');
  assert.equal(overrunGapSeconds(original, 181_000), 120);
  assert.equal(next.timeSpentSeconds, 200);
  assert.equal(next.countdownExpiredAt, undefined);
  assert.equal(next.timerRunning, true);
  assert.equal(next.timerSessionId, 'continued');
  assert.equal(getTaskRemainingSeconds(next, 181_000), 1800);
  assert.equal(getTaskTotalSeconds(next, 211_000), 230);
  assert.equal(continueAfterExpiry(next, 211_000), next);
  assert.equal(original.countdownExpiredAt, 61_000);
});

test('a fully consumed twenty-four-hour budget continues without changing its original estimate', () => {
  const running = configureTaskCountdown(task({ timeSpentSeconds: 20 }), 86400, 1000);
  const original = expireTaskCountdown(running, 86_461_000);
  const next = continueAfterExpiry(original, 86_461_000, 30, () => 'continued');
  assert.equal(next.timeSpentSeconds, 20 + 86400 + 60);
  assert.equal(next.plannedDurationSeconds, 86400);
  assert.equal(next.timerRunning, true);
  assert.equal(getTaskRemainingSeconds(next, 86_461_000), 1800);
  assert.equal(next.countdownExpiredAt, undefined);
  for (const minutes of [0, -1, 0.5, NaN, Infinity, 1441]) assert.equal(continueAfterExpiry(original, 86_461_000, minutes), original);
  assert.equal(continueAfterExpiry(original, 86_400_000), original, 'a future remote expiry waits for its local clock');
});

test('legacy scheduled continuation fixes its block length before extension without replacing the first estimate', () => {
  const original = { ...expired(), scheduledFor: 1000, plannedDurationSeconds: 45 };
  const next = continueAfterExpiry(original, 181_000);
  assert.equal(next.scheduledDurationSeconds, 60);
  assert.equal(next.plannedDurationSeconds, 45);
  assert.equal(next.countdownDurationSeconds, 1860);
  const fixed = continueAfterExpiry({ ...original, scheduledDurationSeconds: 90 }, 181_000);
  assert.equal(fixed.scheduledDurationSeconds, 90);
  assert.equal(continueAfterExpiry(expired(), 181_000).scheduledDurationSeconds, undefined);
});

test('fixed scheduled length survives storage and independent synchronization across a time reset', () => {
  const base = workspace(task({ scheduledFor: 1000, scheduledDurationSeconds: 60, plannedDurationSeconds: 45 }));
  const next = workspace({ ...base.tasks[0], scheduledDurationSeconds: 90 });
  const cloud = JSON.parse(JSON.stringify(serializeTaskForCloud(next.tasks[0])));
  assert.equal(cloud.scheduledDurationSeconds, 90);
  assert.equal(cloud.plannedDurationSeconds, 45);
  const remote = workspace({ ...base.tasks[0], timeResetAt: 200_000, timeSpentSeconds: 500 });
  const merged = applyWorkspaceMutation(remote, diffWorkspaceMutation(base, workspace(cloud), { clientId: 'a', sequence: 1 }));
  assert.equal(merged.tasks[0].scheduledDurationSeconds, 90);
  assert.equal(merged.tasks[0].plannedDurationSeconds, 45);
  assert.equal(merged.tasks[0].timeSpentSeconds, 500);
  for (const value of [1, 86400]) {
    const valid = workspace(task({ scheduledDurationSeconds: value }));
    assert.deepEqual(parseWorkspace(valid), valid);
    assert.deepEqual(parseNativeWorkspace(valid), valid);
  }
  for (const value of [0, -1, 1.5, 86401, NaN, Infinity, '60', null]) {
    const invalid = workspace(task({ scheduledDurationSeconds: value as number }));
    assert.throws(() => parseWorkspace(invalid));
    assert.throws(() => parseNativeWorkspace(invalid));
    assert.equal(serializeTaskForCloud(invalid.tasks[0]).scheduledDurationSeconds, undefined);
  }
});

test('automatic credit stops at three hours and a longer gap awaits an explicit time', () => {
  const original = expired();
  const limit = original.countdownExpiredAt! + MAX_OVERRUN_SECONDS * 1000;
  assert.equal(continueAfterExpiry(original, limit).timeSpentSeconds, 80 + MAX_OVERRUN_SECONDS);
  assert.equal(continueAfterExpiry(original, limit + 1000), original);
  assert.equal(finishAfterExpiry(original, limit + 60_000, limit + 60_000).timeSpentSeconds, 80 + MAX_OVERRUN_SECONDS);
});

test('finish at an explicit timestamp credits only the stated interval and keeps task completion separate', () => {
  const original = expired();
  const next = finishAfterExpiry(original, 181_000, 121_000);
  assert.equal(next.timeSpentSeconds, 140);
  assert.equal(next.countdownExpiredAt, undefined);
  assert.equal(next.done, false);
  assert.equal(next.timerRunning, false);
  for (const workedUntil of [NaN, Infinity, 60_000, 182_000]) assert.equal(finishAfterExpiry(original, 181_000, workedUntil), original);
});

test('acknowledging finished or not worked clears the marker without adding time; completion clears it too', () => {
  const original = expired();
  const acknowledged = finishAfterExpiry(original, 181_000);
  assert.equal(acknowledged.countdownExpiredAt, undefined);
  assert.equal(acknowledged.timeSpentSeconds, original.timeSpentSeconds);
  assert.equal(acknowledged.done, false);
  const completed = completeTask(original, 181_000);
  assert.equal(completed.countdownExpiredAt, undefined);
  assert.equal(completed.timeSpentSeconds, original.timeSpentSeconds);
  assert.equal(completed.done, true);
});

test('expiry survives cloud serialization and cross-device mutation, then explicit acknowledgement removes it', () => {
  const base = workspace(task());
  const next = workspace(JSON.parse(JSON.stringify(serializeTaskForCloud(expired()))));
  const mutation = JSON.parse(JSON.stringify(diffWorkspaceMutation(base, next, { clientId: 'a', sequence: 1 })));
  const remote = applyWorkspaceMutation(base, mutation);
  assert.equal(remote.tasks[0].countdownExpiredAt, 61_000);
  assert.equal(remote.tasks[0].timeSpentSeconds, 80);
  const acknowledged = workspace(finishAfterExpiry(remote.tasks[0], 181_000));
  const cleared = applyWorkspaceMutation(remote, diffWorkspaceMutation(remote, acknowledged, { clientId: 'b', sequence: 1 }));
  assert.equal(cleared.tasks[0].countdownExpiredAt, undefined);
});

test('an obsolete offline expiry cannot restore a marker after an explicit newer time reset', () => {
  const base = workspace(task());
  const oldExpiry = workspace(expired());
  const remote = workspace(task({ timeResetAt: 200_000, timeSpentSeconds: 500 }));
  const merged = applyWorkspaceMutation(remote, diffWorkspaceMutation(base, oldExpiry, { clientId: 'a', sequence: 1 }));
  assert.equal(merged.tasks[0].countdownExpiredAt, undefined);
  assert.equal(merged.tasks[0].timeSpentSeconds, 500);
});

test('renderer and native validation retain finite expiry timestamps and reject malformed values', () => {
  const valid = workspace(expired());
  assert.deepEqual(parseWorkspace(valid), valid);
  assert.deepEqual(parseNativeWorkspace(valid), valid);
  assert.equal(serializeTaskForCloud(task({ countdownExpiredAt: 0 })).countdownExpiredAt, 0);
  for (const value of [-1, NaN, Infinity, '61000', null]) {
    const invalid = workspace(task({ countdownExpiredAt: value as number }));
    assert.throws(() => parseWorkspace(invalid));
    assert.throws(() => parseNativeWorkspace(invalid));
  }
});

test('expiry reminder schedule emits at zero, fifteen and forty-five minutes and stays quiet afterwards', () => {
  const original = expired();
  const delivered = new Set<number>();
  const emissions: number[] = [];
  for (const seconds of [0, 1, 899, 900, 901, 2699, 2700, 2701, 3600, 86400]) {
    const index = countdownReminderIndex(original, original.countdownExpiredAt! + seconds * 1000);
    if (index !== undefined && !delivered.has(index)) { delivered.add(index); emissions.push(seconds); }
  }
  assert.deepEqual(emissions, [0, 900, 2700]);
  assert.equal(countdownReminderIndex(original, 60_000), undefined);
  assert.equal(countdownReminderIndex(original, NaN), undefined);
  assert.equal(countdownReminderIndex(finishAfterExpiry(original, 181_000), 200_000), undefined);
  assert.equal(countdownReminderIndex({ ...original, done: true }, 200_000), undefined);
  assert.equal(countdownReminderIndex(original, original.countdownExpiredAt! + 45.5 * 60_000), 2, 'late callbacks select one latest reminder');
  for (const seconds of [46 * 60, 3600, 3 * 86400]) {
    assert.equal(countdownReminderIndex(original, original.countdownExpiredAt! + seconds * 1000), undefined);
  }
});
