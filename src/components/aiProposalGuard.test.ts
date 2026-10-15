import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AIResponse, PSTask } from '../types';
import { proposalTargetsUnchanged, proposalTransition } from './aiProposalGuard';

test('a read-only follow-up leaves a prepared two-task draft available for explicit Apply', () => {
  const draft: AIResponse = { summary: 'Дві справи', tasks: [
    { title: 'Зробити три анімації', phase: 'focus', priority: 2, steps: 3 },
    { title: 'Швидкий друк', phase: 'focus', priority: 2, steps: 0 },
  ] };
  assert.equal(proposalTransition(draft, false, false), 'replace');
  assert.equal(proposalTransition({ summary: 'Завдання ще не додано.' }, true, true), 'retain');
  assert.equal(draft.tasks?.length, 2);
});

test('an incomplete correction preserves the draft but unrelated replies cannot reactivate Apply', () => {
  assert.equal(proposalTransition({ summary: 'Яке завдання?', proposalDisposition: 'clarification' }, true, true), 'suspend');
  assert.equal(proposalTransition({ summary: 'Пояснення' }, true, false), 'suspend');
  assert.equal(proposalTransition({ summary: 'Виправлена пропозиція', tasks: [
    { title: 'Анімації', phase: 'focus', priority: 2, steps: 3, timerMode: 'countdown', countdownDurationSeconds: 10800 },
    { title: 'Друк', phase: 'focus', priority: 2, steps: 0 },
  ] }, true, false), 'replace');
});

test('only explicit cancellation clears a draft and another account has no current draft', () => {
  assert.equal(proposalTransition({ summary: 'Скасовано', proposalDisposition: 'cancelled' }, true, true), 'cancel');
  assert.equal(proposalTransition({ summary: 'Звичайна відповідь' }, false, false), 'none');
});

test('task edits invalidate a pending update while elapsed timer ticks do not', () => {
  const task: PSTask = { id: 'animation', title: 'Анімація', phase: 'focus', priority: 2,
    steps: 0, currentStep: 0, done: false, pinned: false, createdAt: 1, timeSpentSeconds: 10 };
  assert.equal(proposalTargetsUnchanged([task], [{ ...task, timeSpentSeconds: 20 }], [task.id]), true);
  assert.equal(proposalTargetsUnchanged([task], [{ ...task, title: 'Новіша назва' }], [task.id]), false);
  assert.equal(proposalTargetsUnchanged([task], [{ ...task, timeSpentSeconds: 10800, timeResetAt: 100 }], [task.id]), false);
  assert.equal(proposalTargetsUnchanged([task], [], [task.id]), false);
});
