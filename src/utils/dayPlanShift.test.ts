import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PSTask } from '../types';
import { applyAgentAction, type AgentWorkspace } from './aiAgentActions';
import { taskScheduledEnd, taskTimeRange } from './schedulePresentation';
import { captureAgentUndo, undoAgentTurn } from './agentUndo';
import { planDelay, shiftDay } from './dayPlanShift';

const KYIV = 'Europe/Kyiv';
const at = (clock: string) => Date.parse('2026-10-21T' + clock + ':00+03:00');
const now = at('16:05');
const task = (id: string, clock: string, minutes = 60, fields: Partial<PSTask> = {}): PSTask => ({
  id, title: id, phase: 'work', priority: 2, steps: 0, currentStep: 0, done: false, pinned: false, createdAt: 1,
  scheduledFor: at(clock), timerMode: 'countdown', countdownDurationSeconds: minutes * 60, ...fields,
});
const workspace = (tasks: PSTask[]): AgentWorkspace => ({ tasks, deletedTasks: [], tabs: [{ id: 'work', name: 'Робота' }], notes: [] });
const anchor = (fields: Partial<PSTask> = {}) => task('current', '14:30', 60, { countdownExpiredAt: at('15:30'), startedAt: at('14:30'), ...fields });

test('a running or expired block reports delay rounded up to five minutes and subsequent unstarted blocks', () => {
  const next = task('next', '15:30');
  const result = planDelay([next, anchor(), task('later', '17:00'), task('earlier', '13:00')], now, KYIV);
  assert.equal(result.minutes, 35);
  assert.equal(result.currentTask?.id, 'current');
  assert.equal(result.fromTime, at('14:30'));
  assert.deepEqual(result.tasks.map(item => item.id), ['next', 'later']);
  assert.equal(planDelay([anchor({ countdownExpiredAt: undefined, timerRunning: true })], now + 1000, KYIV).minutes, 40);
  assert.equal(planDelay([anchor()], at('15:30'), KYIV).minutes, 0);
  assert.equal(planDelay([anchor({ countdownExpiredAt: undefined })], now, KYIV).minutes, 0);
  assert.equal(planDelay([anchor({ done: true })], now, KYIV).minutes, 0);
});

test('continuing a countdown does not move the end of its original planned block', () => {
  const running = anchor({ countdownExpiredAt: undefined, timerRunning: true,
    plannedDurationSeconds: 3600, scheduledDurationSeconds: 3600, countdownDurationSeconds: 5400 });
  assert.equal(planDelay([running], now, KYIV).minutes, 35);
});

test('replanning a started task changes the fixed block while preserving its first work estimate', () => {
  const before = workspace([anchor({ plannedDurationSeconds: 3600, timeSpentSeconds: 600 })]);
  const result = applyAgentAction(before, { type: 'plan_day', date: '2026-10-21', start: '14:30',
    items: [{ taskId: 'current', durationMinutes: 90 }] }, { now, timeZone: KYIV, newId: () => 'replan' });
  assert.equal(result.result.ok, true);
  const replanned = result.workspace.tasks[0];
  assert.equal(replanned.scheduledDurationSeconds, 5400);
  assert.equal(replanned.plannedDurationSeconds, 3600);
  assert.equal(replanned.timeSpentSeconds, 600);
  assert.equal(taskScheduledEnd(replanned), at('16:00'));
  assert.equal(taskTimeRange(replanned, now, KYIV, 'uk'), 'Сьогодні 14:30–16:00');
  assert.equal(planDelay([{ ...replanned, timerRunning: true }], now, KYIV).minutes, 5);
});

test('shift keeps task order and duration and only moves today unfinished blocks that have not started', () => {
  const next = task('next', '15:30', 30), later = task('later', '17:00', 90);
  const excluded = [anchor(), task('same-start', '14:30'), task('earlier', '13:00'), task('done', '18:00', 30, { done: true }),
    task('started', '18:00', 30, { startedAt: at('15:00') }), task('paused', '18:00', 30, { timeSpentSeconds: 10 }),
    task('running', '18:00', 30, { timerRunning: true }), task('expired', '18:00', 30, { countdownExpiredAt: at('18:30') }),
    task('progress', '18:00', 30, { currentStep: 1, steps: 2 }),
    task('step-done', '18:00', 30, { stepList: [{ id: 'step', title: 'Крок', done: true }] }),
    task('template', '18:00', 30, { scheduledPending: true }),
    task('tomorrow', '18:00', 30, { scheduledFor: at('18:00') + 86400000 })];
  const before = workspace([later, ...excluded, next]);
  const result = shiftDay(before, 35, undefined, now, KYIV);
  assert.deepEqual(result.shiftedTaskIds, ['next', 'later']);
  assert.deepEqual(result.overflowTaskIds, []);
  assert.deepEqual(result.workspace.tasks.map(item => item.id), before.tasks.map(item => item.id));
  for (const item of result.workspace.tasks) {
    const original = before.tasks.find(previous => previous.id === item.id)!;
    assert.equal(item.countdownDurationSeconds, original.countdownDurationSeconds);
    assert.equal(item.scheduledFor, original.scheduledFor! + (result.shiftedTaskIds.includes(item.id) ? 35 * 60000 : 0));
    if (!result.shiftedTaskIds.includes(item.id)) assert.equal(item, original);
  }
  assert.equal(next.scheduledFor, at('15:30'));
  assert.equal(later.scheduledFor, at('17:00'));
});

test('an explicit boundary shifts blocks at that time while default without an active delay starts now', () => {
  const before = workspace([task('past', '15:00'), task('next', '17:00'), task('later', '18:00')]);
  assert.deepEqual(shiftDay(before, 30, undefined, now, KYIV).shiftedTaskIds, ['next', 'later']);
  assert.deepEqual(shiftDay(before, 30, at('18:00'), now, KYIV).shiftedTaskIds, ['later']);
});

test('blocks ending after midnight are reported without moving them to tomorrow; exactly midnight fits', () => {
  const before = workspace([task('fits', '21:30', 60), task('end-overflow', '23:00', 60), task('start-overflow', '23:45', 15)]);
  const result = shiftDay(before, 30, at('20:00'), now, KYIV);
  assert.deepEqual(result.shiftedTaskIds, ['fits']);
  assert.deepEqual(result.overflowTaskIds, ['end-overflow', 'start-overflow']);
  assert.equal(result.workspace.tasks[0].scheduledFor, at('22:00'));
  assert.deepEqual(shiftDay(workspace([task('midnight', '22:30', 60)]), 30, at('20:00'), now, KYIV).shiftedTaskIds, ['midnight']);
  assert.equal(result.workspace.tasks[1], before.tasks[1]);
  assert.equal(result.workspace.tasks[2], before.tasks[2]);
});

test('retained overflow blocks cannot be overtaken or overlapped by earlier shifted blocks', () => {
  const before = workspace([task('early', '20:00', 30), task('short', '22:00', 15), task('long', '22:30', 90)]);
  const result = shiftDay(before, 60, at('19:00'), now, KYIV);
  assert.deepEqual(result.shiftedTaskIds, ['early']);
  assert.deepEqual(result.overflowTaskIds, ['short', 'long']);
  assert.equal(result.workspace.tasks[0].scheduledFor, at('21:00'));
  assert.equal(result.workspace.tasks[1], before.tasks[1]);
  assert.equal(result.workspace.tasks[2], before.tasks[2]);
  assert.ok(result.workspace.tasks[0].scheduledFor! < result.workspace.tasks[1].scheduledFor!);
  assert.ok(result.workspace.tasks[1].scheduledFor! < result.workspace.tasks[2].scheduledFor!);
});

test('calendar boundaries use the chosen time zone on a 25-hour day', () => {
  const autumnNow = Date.parse('2026-10-25T00:30:00+03:00');
  const late = task('late', '23:00', 30, { scheduledFor: Date.parse('2026-10-25T23:00:00+02:00') });
  const result = shiftDay(workspace([late]), 30, undefined, autumnNow, KYIV);
  assert.deepEqual(result.shiftedTaskIds, ['late']);
  assert.deepEqual(result.overflowTaskIds, []);
  assert.equal(result.workspace.tasks[0].scheduledFor, Date.parse('2026-10-25T23:30:00+02:00'));
});

test('the existing agent undo restores shifted starts and preserves unrelated changes', () => {
  const before = workspace([anchor(), task('next', '15:30'), task('later', '17:00')]);
  const shifted = shiftDay(before, 35, undefined, now, KYIV);
  const undo = captureAgentUndo(before, shifted.workspace, shifted.shiftedTaskIds);
  const extra = task('unrelated', '19:00');
  const result = undoAgentTurn({ ...shifted.workspace, tasks: [...shifted.workspace.tasks, extra] }, undo);
  assert.equal(result.undone, true);
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.workspace.tasks.map(item => [item.id, item.scheduledFor]),
    [...before.tasks, extra].map(item => [item.id, item.scheduledFor]));
  assert.deepEqual(result.workspace.tasks.map(item => item.countdownDurationSeconds),
    [...before.tasks, extra].map(item => item.countdownDurationSeconds));
});

test('invalid instants and shifts leave the workspace untouched', () => {
  const before = workspace([task('next', '17:00')]);
  for (const minutes of [0, -5, Infinity, Number.NaN, 1441]) assert.equal(shiftDay(before, minutes, undefined, now, KYIV).workspace, before);
  assert.equal(shiftDay(before, 30, Number.NaN, now, KYIV).workspace, before);
  assert.equal(shiftDay(before, 30, undefined, Number.NaN, KYIV).workspace, before);
  assert.deepEqual(planDelay(before.tasks, Number.NaN, KYIV), { minutes: 0, tasks: [] });
});
