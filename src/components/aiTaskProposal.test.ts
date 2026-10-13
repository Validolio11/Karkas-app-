import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PSTask } from '../types';
import { aiApplyOutcome, describeAIApplyResult, describeAITimer, getAITimerContext, prepareAITask } from './aiTaskProposal';
import { createTask } from '../utils/taskOperations';

test('AI creation keeps a zero-step countdown and explicit start request', () => {
  const proposal = prepareAITask({ title: 'References', phase: 'focus', priority: 2, steps: 0,
    timerMode: 'countdown', countdownDurationSeconds: 1500, timerAction: 'start' }, index => `step-${index}`);
  assert.equal(proposal.steps, 0);
  assert.equal(proposal.timerMode, 'countdown');
  assert.equal(proposal.countdownDurationSeconds, 1500);
  assert.equal(proposal.timerAction, 'start');
});

test('AI checklist creation respects an empty checklist and clears proposed completion', () => {
  const proposal = prepareAITask({ title: 'Draft', phase: 'focus', priority: 1, steps: 4,
    stepList: [] }, index => `step-${index}`);
  assert.equal(proposal.steps, 0);
  const named = prepareAITask({ title: 'Draft', phase: 'focus', priority: 1, steps: 0,
    stepList: [{ title: 'Review', done: true }] }, index => `step-${index}`);
  assert.deepEqual(named.stepList, [{ id: 'step-0', title: 'Review', done: false }]);
});

test('timer preview distinguishes creation from running and pause from stop', () => {
  assert.equal(describeAITimer({ timerMode: 'countdown', countdownDurationSeconds: 1500 }, 'uk'),
    'Таймер 25:00 · Зберегти без запуску');
  assert.match(describeAITimer({ timerAction: 'stop' }, 'uk')!, /Зупинити.*час зберігається/);
  assert.match(describeAITimer({ timerAction: 'pause' }, 'en')!, /Pause.*time is preserved/);
  assert.equal(describeAITimer({}, 'uk'), null);
});

test('AI context includes none and a running countdown actual remaining time', () => {
  const task: PSTask = { id: 't', title: 'Task', phase: 'focus', priority: 2, steps: 0,
    currentStep: 0, done: false, pinned: false, createdAt: 0, timerMode: 'countdown',
    countdownDurationSeconds: 1500, countdownRemainingSeconds: 900,
    timerRunning: true, timerStartedAt: 1000, timeSpentSeconds: 600 };
  assert.deepEqual(getAITimerContext(task, 11000), { timerMode: 'countdown', timerRunning: true,
    timeSpentSeconds: 610, countdownDurationSeconds: 1500, countdownRemainingSeconds: 890 });
  assert.equal(getAITimerContext({ ...task, timerMode: 'none', timerRunning: false }, 11000).timerMode, 'none');
});

test('confirmation reports actual applied counts and warns about stale or invalid edits', () => {
  const message = describeAIApplyResult({ created: 1, updated: 0, deleted: 0, tabs: 0, rejected: 2 }, 'uk');
  assert.match(message, /створено: 1/);
  assert.doesNotMatch(message, /оновлено/);
  assert.match(message, /Не застосовано: 2/);
});

test('a fully rejected timer edit never claims successful application', () => {
  const message = describeAIApplyResult({ created: 0, updated: 0, deleted: 0, tabs: 0, rejected: 1 }, 'en');
  assert.match(message, /^No changes were applied\./);
  assert.match(message, /Not applied: 1/);
});

test('apply outcome separates full, partial and fully rejected application', () => {
  assert.equal(aiApplyOutcome({ created: 1, updated: 1, deleted: 0, tabs: 0, rejected: 0 }), 'applied');
  assert.equal(aiApplyOutcome({ created: 0, updated: 2, deleted: 0, tabs: 0, rejected: 1 }), 'partial');
  assert.equal(aiApplyOutcome({ created: 0, updated: 0, deleted: 0, tabs: 0, rejected: 3 }), 'none');
});

test('applying a new AI task keeps its planned and deadline dates', () => {
  const proposal = prepareAITask({ title: 'Анімувати інтро', phase: 'focus', priority: 1, steps: 0, note: 'Терміново',
    plannedDate: '2026-10-14', deadlineDate: '2026-10-16' }, index => `step-${index}`);
  assert.equal(proposal.plannedDate, '2026-10-14');
  assert.equal(proposal.deadlineDate, '2026-10-16');
  // The same path the Apply button takes: the stored task carries both dates.
  const stored = createTask(proposal, 'task-1', 1000)!;
  assert.equal(stored.plannedDate, '2026-10-14');
  assert.equal(stored.deadlineDate, '2026-10-16');
  // A null date (clear) has no meaning for a task that does not exist yet and must not reject it.
  const cleared = prepareAITask({ title: 'Banners', phase: 'focus', priority: 2, steps: 0, deadlineDate: null } as any, index => `step-${index}`);
  assert.equal(cleared.deadlineDate, undefined);
  const created = createTask(cleared, 'task-2', 1000)!;
  assert.ok(created);
  assert.equal('deadlineDate' in created, false);
});

test('review mapper preserves the exact requested future schedule alongside timer configuration', () => {
  const schedule = { startAt: '2026-10-10T20:00:00+03:00', recurrence: 'daily' as const, timeZone: 'Europe/Kyiv', leadMinutes: 5 };
  const input = { title: 'Typing', phase: 'focus', priority: 2 as const, steps: 0, schedule, timerMode: 'countdown' as const, countdownDurationSeconds: 1200 };
  const saved = structuredClone(input);
  const proposal = prepareAITask(input, index => `step-${index}`);
  assert.deepEqual(proposal.schedule, schedule);
  assert.equal(proposal.countdownDurationSeconds, 1200);
  assert.equal(proposal.timerAction, undefined);
  assert.deepEqual(input, saved);
});
