import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PSTask } from '../types';
import { applyAgentAction, type AgentWorkspace } from './aiAgentActions';
import { taskScheduledEnd, taskTimeRange } from './schedulePresentation';
import { captureAgentUndo, undoAgentTurn } from './agentUndo';
import { missedBlock, planDelay, replanRestOfDay, shiftDay } from './dayPlanShift';

const KYIV = 'Europe/Kyiv';
const at = (clock: string) => Date.parse('2026-10-21T' + clock + ':00+03:00');
const now = at('16:05');
const task = (id: string, clock: string, minutes = 60, fields: Partial<PSTask> = {}): PSTask => ({
  id, title: id, phase: 'work', priority: 2, steps: 0, currentStep: 0, done: false, pinned: false, createdAt: 1,
  scheduledFor: at(clock), timerMode: 'countdown', countdownDurationSeconds: minutes * 60, ...fields,
});
const workspace = (tasks: PSTask[]): AgentWorkspace => ({ tasks, deletedTasks: [], tabs: [{ id: 'work', name: 'Робота' }], notes: [] });
const anchor = (fields: Partial<PSTask> = {}) => task('current', '14:30', 60, { countdownExpiredAt: at('15:30'), startedAt: at('14:30'), ...fields });

test('delay includes missed and paused blocks and rounds the oldest delay up to five minutes', () => {
  const next = task('next', '15:30');
  const result = planDelay([next, anchor(), task('later', '17:00'), task('earlier', '13:00')], now, KYIV);
  assert.equal(result.minutes, 185);
  assert.equal(result.currentTask?.id, 'earlier');
  assert.equal(result.fromTime, at('13:00'));
  assert.deepEqual(result.tasks.map(item => item.id), ['earlier', 'current', 'next', 'later']);
  assert.deepEqual(result.missedTasks?.map(item => item.id), ['next', 'current', 'earlier']);
  assert.equal(planDelay([anchor({ countdownExpiredAt: undefined, timerRunning: true })], now + 1000, KYIV).minutes, 40);
  assert.equal(planDelay([anchor()], at('15:30'), KYIV).minutes, 0);
  assert.equal(planDelay([anchor({ countdownExpiredAt: undefined })], now, KYIV).minutes, 35);
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

test('shift preserves work and moves paused blocks while excluding running, completed and still-past starts', () => {
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
  assert.deepEqual(result.shiftedTaskIds, ['next', 'later', 'started', 'paused', 'expired', 'progress', 'step-done']);
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


test('missed blocks use the unstarted start or paused end without flagging active work', () => {
  const unstarted = task('missed', '15:30', 30);
  assert.deepEqual(missedBlock(unstarted, now, KYIV), { since: at('15:30'), start: at('15:30'), end: at('16:00'), paused: false });
  const paused = { ...unstarted, startedAt: at('15:30'), timeSpentSeconds: 60 };
  assert.deepEqual(missedBlock(paused, now, KYIV), { since: at('16:00'), start: at('15:30'), end: at('16:00'), paused: true });
  assert.equal(missedBlock(unstarted, at('15:30'), KYIV), undefined);
  assert.equal(missedBlock(paused, at('15:45'), KYIV), undefined);
  for (const fields of [{ done: true }, { timerRunning: true }, { scheduledPending: true }, { scheduledFor: at('17:00') }]) {
    assert.equal(missedBlock({ ...unstarted, ...fields }, now, KYIV), undefined);
  }
  assert.equal(missedBlock(unstarted, Number.NaN, KYIV), undefined);
  assert.equal(missedBlock({ ...unstarted, scheduledFor: Number.NaN }, now, KYIV), undefined);
  assert.equal(missedBlock({ ...unstarted, scheduledFor: at('15:30') - 86400000 }, now, KYIV)?.since, at('15:30') - 86400000);
});

test('an explicit shift can recover missed starts without moving other starts into the past', () => {
  const before = workspace([task('too-old', '14:00'), task('missed', '15:45'), task('paused', '16:00', 60, { timeSpentSeconds: 600 })]);
  const shifted = shiftDay(before, 30, undefined, now, KYIV);
  assert.deepEqual(shifted.shiftedTaskIds, ['missed', 'paused']);
  assert.equal(shifted.workspace.tasks[0], before.tasks[0]);
  assert.equal(shifted.workspace.tasks[1].scheduledFor, at('16:15'));
  assert.equal(shifted.workspace.tasks[2].timeSpentSeconds, 600);
});

test('replan packs missed animation and paused remaining work to midnight and reports later blocks as overflow', () => {
  const evening = at('18:30');
  const before = workspace([
    task('plan-animation', '15:30', 30),
    task('animate', '16:00', 300, { startedAt: at('16:00'), currentStep: 3, steps: 6, timeSpentSeconds: 600,
      countdownRemainingSeconds: 18000, scheduledDurationSeconds: 18000, plannedDurationSeconds: 18000 }),
    task('typing', '22:00', 30), task('rest', '22:30', 30),
  ]);
  const replanned = replanRestOfDay(before, evening, KYIV);
  assert.deepEqual(replanned.shiftedTaskIds, ['plan-animation', 'animate']);
  assert.deepEqual(replanned.overflowTaskIds, ['typing', 'rest']);
  assert.deepEqual(replanned.overflow, before.tasks.slice(2));
  assert.equal(replanned.workspace.tasks[0].scheduledFor, evening);
  assert.equal(taskScheduledEnd(replanned.workspace.tasks[0]), at('19:00'));
  assert.equal(replanned.workspace.tasks[1].scheduledFor, at('19:00'));
  assert.equal(taskScheduledEnd(replanned.workspace.tasks[1]), at('23:59') + 60000);
  assert.equal(replanned.workspace.tasks[1].plannedDate, '2026-10-21');
  assert.equal(replanned.workspace.tasks[1].timeSpentSeconds, 600);
  assert.equal(replanned.workspace.tasks[1].currentStep, 3);
  assert.equal(replanned.workspace.tasks[1].countdownRemainingSeconds, 18000);
  assert.equal(replanned.workspace.tasks[1].plannedDurationSeconds, 18000);
  assert.equal(replanned.workspace.tasks[2], before.tasks[2]);
  assert.equal(replanned.workspace.tasks[3], before.tasks[3]);
  assert.equal(before.tasks[0].scheduledFor, at('15:30'));
  const undo = captureAgentUndo(before, replanned.workspace, replanned.shiftedTaskIds);
  const undone = undoAgentTurn(replanned.workspace, undo);
  assert.equal(undone.undone, true);
  assert.deepEqual(undone.conflicts, []);
  assert.deepEqual(undone.workspace.tasks.map(item => ({ ...item, updatedAt: undefined })),
    before.tasks.map(item => ({ ...item, updatedAt: undefined })));
  assert.deepEqual(undone.workspace.tabs, before.tabs);
});

test('replan leaves running timers intact and starts after their block, using paused remaining duration', () => {
  const running = task('running', '18:00', 60, { timerRunning: true, timerStartedAt: at('18:00') });
  const paused = task('paused', '17:00', 60, { startedAt: at('17:00'), countdownRemainingSeconds: 900,
    timeSpentSeconds: 2700, scheduledDurationSeconds: 3600 });
  const before = workspace([running, paused, task('done', '16:00', 30, { done: true }), task('template', '16:00', 30, { scheduledPending: true })]);
  const replanned = replanRestOfDay(before, at('18:32'), KYIV);
  assert.equal(replanned.workspace.tasks[0], running);
  assert.deepEqual(replanned.shiftedTaskIds, ['paused']);
  const next = replanned.workspace.tasks[1];
  assert.equal(next.scheduledFor, at('19:00'));
  assert.equal(taskScheduledEnd(next), at('19:15'));
  assert.equal(next.scheduledDurationSeconds, 900);
  assert.equal(next.countdownDurationSeconds, 3600);
  assert.equal(next.countdownRemainingSeconds, 900);
  assert.equal(next.timeSpentSeconds, 2700);
});

test('replan rounds its start up, keeps at least five minutes for paused blocks and supports explicit order', () => {
  const before = workspace([task('unstarted', '16:00', 30, { scheduledDurationSeconds: 600 }),
    task('paused', '17:00', 60, { startedAt: at('17:00'), countdownRemainingSeconds: 120 })]);
  const result = replanRestOfDay(before, at('18:31'), KYIV, { from: at('18:36'), order: ['paused', 'unstarted'] });
  assert.deepEqual(result.shiftedTaskIds, ['paused', 'unstarted']);
  assert.equal(result.workspace.tasks[1].scheduledFor, at('18:40'));
  assert.equal(result.workspace.tasks[1].scheduledDurationSeconds, 300);
  assert.equal(result.workspace.tasks[0].scheduledFor, at('18:45'));
  assert.equal(result.workspace.tasks[0].scheduledDurationSeconds, 600);
  assert.equal(result.workspace.tasks[1].countdownRemainingSeconds, 120);
  assert.equal(replanRestOfDay(before, Number.NaN, KYIV).workspace, before);
  assert.equal(replanRestOfDay(before, now, KYIV, { from: Number.NaN }).workspace, before);
});
