import assert from 'node:assert/strict';
import { test } from 'node:test';
import { claimPlanningNotice } from './planningNotices';

function storage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); } };
}
const start = Date.UTC(2026, 9, 11, 9);
const minute = 60_000;

test('explicit schedule claims suppress optional coaching for thirty minutes but are not suppressed themselves', () => {
  const disk = storage();
  const owner = 'notice-precedence';
  assert.equal(claimPlanningNotice(disk, owner, 'coach:first', start), true);
  assert.equal(claimPlanningNotice(disk, owner, 'scheduled:task-a', start + minute, true), true);
  assert.equal(claimPlanningNotice(disk, owner, 'coach:second', start + 29 * minute), false);
  assert.equal(claimPlanningNotice(disk, owner, 'coach:second', start + 31 * minute), true);
});

test('the same schedule occurrence cannot notify twice even when explicit', () => {
  const disk = storage();
  assert.equal(claimPlanningNotice(disk, 'notice-duplicate', 'scheduled:task-a:at', start, true), true);
  assert.equal(claimPlanningNotice(disk, 'notice-duplicate', 'scheduled:task-a:at', start + 90 * minute, true), false);
  assert.equal(claimPlanningNotice(disk, 'notice-duplicate', 'scheduled:task-a:tomorrow', start + 1440 * minute, true), true);
});

test('different personal slots share the two-per-day limit after the user edits their schedule', () => {
  const disk = storage();
  const owner = 'notice-daily-limit';
  const prefix = 'coach:2026-10-11:';
  assert.equal(claimPlanningNotice(disk, owner, prefix + '09:00', start, false, prefix), true);
  assert.equal(claimPlanningNotice(disk, owner, prefix + '11:00', start + 120 * minute, false, prefix), true);
  assert.equal(claimPlanningNotice(disk, owner, prefix + '15:00', start + 360 * minute, false, prefix), false);
  const nextDay = 'coach:2026-10-12:';
  assert.equal(claimPlanningNotice(disk, owner, nextDay + '09:00', start + 1440 * minute, false, nextDay), true);
});

test('guest and account named guest have isolated notification ledgers', () => {
  const disk = storage();
  assert.equal(claimPlanningNotice(disk, null, 'same-occurrence', start, true), true);
  assert.equal(claimPlanningNotice(disk, 'guest', 'same-occurrence', start, true), true);
  assert.equal(claimPlanningNotice(disk, null, 'same-occurrence', start + minute, true), false);
  assert.equal(claimPlanningNotice(disk, 'guest', 'same-occurrence', start + minute, true), false);
  assert.equal(claimPlanningNotice(disk, 'notice-other-account', 'same-occurrence', start, true), true);
});

test('unavailable storage retains session deduplication and cooldown', () => {
  const unavailable = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  const owner = 'notice-no-storage';
  assert.equal(claimPlanningNotice(unavailable, owner, 'scheduled:once', start, true), true);
  assert.equal(claimPlanningNotice(unavailable, owner, 'scheduled:once', start + minute, true), false);
  assert.equal(claimPlanningNotice(unavailable, owner, 'coach:nudge', start + minute), false);
  assert.equal(claimPlanningNotice(unavailable, owner, 'coach:nudge', start + 30 * minute), true);
});

test('an old disk ledger cannot undo session deduplication when later persistence fails', () => {
  const disk = storage();
  const owner = 'notice-storage-fills';
  assert.equal(claimPlanningNotice(disk, owner, 'previous', start, true), true);
  const writeFailure = { getItem: disk.getItem, setItem: () => { throw new Error('quota reached'); } };
  const next = start + 60 * minute;
  assert.equal(claimPlanningNotice(writeFailure, owner, 'scheduled:new', next, true), true);
  assert.equal(claimPlanningNotice(writeFailure, owner, 'scheduled:new', next + minute, true), false);
  assert.equal(claimPlanningNotice(writeFailure, owner, 'coach:new', next + 2 * minute), false);
});

test('damaged disk ledger is ignored and records older than two days are pruned', () => {
  const disk = storage();
  const key = 'karkas_planning_notices_v1:account:notice-damaged';
  disk.setItem(key, 'broken JSON');
  assert.equal(claimPlanningNotice(disk, 'notice-damaged', 'fresh', start, true), true);
  const oldKey = 'karkas_planning_notices_v1:account:notice-pruned';
  disk.setItem(oldKey, JSON.stringify({ last: start - 3 * 1440 * minute, events: { ancient: start - 3 * 1440 * minute, future: start + minute } }));
  assert.equal(claimPlanningNotice(disk, 'notice-pruned', 'fresh', start, true), true);
  assert.deepEqual(JSON.parse(disk.getItem(oldKey)!).events, { fresh: start });
});
