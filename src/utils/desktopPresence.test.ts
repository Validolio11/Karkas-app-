import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PSTask } from '../types';
import { buildDesktopPresence } from './desktopPresence';

const now = 1_800_000_000_000;
const task = (id: string, changes: Partial<PSTask> = {}): PSTask => ({
  id, title: id, phase: 'work', priority: 2, steps: 0, currentStep: 0,
  done: false, pinned: false, createdAt: now - 60_000, ...changes,
});

test('running countdown wins over expired and paused tasks and tracks its current budget', () => {
  const presence = buildDesktopPresence([
    task('expired', { timerMode: 'countdown', countdownDurationSeconds: 600, countdownExpiredAt: now - 1000 }),
    task('running', { timerRunning: true, timerStartedAt: now - 30_000, timerMode: 'countdown',
      countdownDurationSeconds: 600, countdownRemainingSeconds: 480, timeSpentSeconds: 5000 }),
  ], now, 'uk');
  assert.deepEqual(presence.active, { taskId: 'running', title: 'running', state: 'running', mode: 'countdown',
    elapsedSeconds: 150, totalSeconds: 600, remainingSeconds: 450 });
  assert.equal(presence.next?.taskId, 'expired');
});

test('stopwatch uses elapsed helpers including already banked session time', () => {
  const running = task('watch', { timerRunning: true, timerStartedAt: now - 65_000,
    timerSessionId: 'session', timeSpentSeconds: 100, timeSessions: { session: { seconds: 20 } } });
  assert.deepEqual(buildDesktopPresence([running], now, 'en'), { lang: 'en', active: {
    taskId: 'watch', title: 'watch', state: 'running', mode: 'stopwatch', elapsedSeconds: 145,
  } });
  assert.equal(buildDesktopPresence([running], now + 15_000, 'en').active?.elapsedSeconds, 160);
});

test('expired countdown awaits a decision with a full elapsed budget', () => {
  assert.deepEqual(buildDesktopPresence([task('expired', { timerMode: 'countdown', countdownDurationSeconds: 300,
    countdownRemainingSeconds: 0, countdownExpiredAt: now - 2000 })], now, 'uk').active, {
    taskId: 'expired', title: 'expired', state: 'expired', mode: 'countdown',
    elapsedSeconds: 300, totalSeconds: 300, remainingSeconds: 0,
  });
});

test('only explicitly recorded recent pauses of partly used countdown sessions remain active', () => {
  const paused = task('paused', { timerMode: 'countdown', countdownDurationSeconds: 600, countdownRemainingSeconds: 450,
    activityTrail: [{ id: 'pause', kind: 'paused', at: now - 1000 }] });
  assert.equal(buildDesktopPresence([paused], now, 'en').active?.state, 'paused');
  assert.equal(buildDesktopPresence([paused], now + 30 * 60_000, 'en').active, undefined);
  for (const changes of [
    { activityTrail: undefined },
    { activityTrail: [{ id: 'edit', kind: 'edited' as const, at: now - 1000 }] },
    { activityTrail: [{ id: 'future', kind: 'paused' as const, at: now + 1000 }] },
    { countdownRemainingSeconds: 600 },
    { timeResetAt: now },
    { timerMode: 'stopwatch' as const },
  ]) assert.equal(buildDesktopPresence([{ ...paused, ...changes }], now, 'en').active, undefined);
  assert.equal(buildDesktopPresence([paused, task('expired', { timerMode: 'countdown',
    countdownDurationSeconds: 300, countdownExpiredAt: now - 2000 })], now, 'en').active?.taskId, 'expired');
});

test('next follows strategy ranking and excludes active, done, and scheduled templates', () => {
  const tasks = [task('urgent', { priority: 1 }), task('pinned', { pinned: true }),
    task('done', { done: true, pinned: true, timerRunning: true }),
    task('future', { scheduledPending: true, pinned: true, timerRunning: true }),
    task('running', { timerRunning: true, timerStartedAt: now })];
  const original = JSON.stringify(tasks);
  const presence = buildDesktopPresence(tasks, now, 'en');
  assert.equal(presence.active?.taskId, 'running');
  assert.deepEqual(presence.next, { taskId: 'pinned', title: 'pinned' });
  assert.equal(JSON.stringify(tasks), original);
  assert.deepEqual(buildDesktopPresence([], now, 'uk'), { lang: 'uk' });
  assert.equal(buildDesktopPresence([task('none', { timerMode: 'none', timerRunning: true })], now, 'en').active, undefined);
});

test('active and next titles fit the sixty character native surface budget', () => {
  const presence = buildDesktopPresence([
    task('active', { title: 'A'.repeat(61), timerRunning: true, timerStartedAt: now }),
    task('next', { title: 'B'.repeat(60) }),
  ], now, 'uk');
  assert.equal(presence.active?.title, 'A'.repeat(59) + '…');
  assert.equal(presence.next?.title, 'B'.repeat(60));
  assert.equal(buildDesktopPresence([task('long', { title: 'C'.repeat(70) })], now, 'en').next?.title, 'C'.repeat(59) + '…');
});
