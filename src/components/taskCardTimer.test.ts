import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PSTask } from '../types';
import { TaskCard } from './TaskCard';

const noop = () => {};
const task = (fields: Partial<PSTask>): PSTask => ({
  id: 'timer-test', title: 'Підготувати референси', phase: 'focus', priority: 2,
  steps: 0, currentStep: 0, done: false, pinned: false, createdAt: 1,
  timerMode: 'countdown', countdownDurationSeconds: 1500,
  countdownRemainingSeconds: 1500, timeSpentSeconds: 0, ...fields,
});

function renderTimer(fields: Partial<PSTask>, stopAvailable = true, lang: 'uk' | 'en' = 'uk') {
  return renderToStaticMarkup(React.createElement(TaskCard, {
    task: task(fields), index: 0, lang,
    onToggleDone: noop, onUpdateStep: noop, onCyclePriority: noop,
    onCyclePhase: noop, onTogglePin: noop, onDelete: noop,
    onAskAIAboutTask: noop, onToggleTimer: noop,
    ...(stopAvailable ? { onStopTimer: noop } : {}),
  }));
}

test('AI-started timer exposes one explicit Stop action without a task start timestamp', () => {
  const html = renderTimer({ timerRunning: true, timerStartedAt: Date.now() });
  assert.match(html, /id="task-timer-stop-timer-test"/);
  assert.match(html, />Зупинити<\/button>/);
  assert.match(html, /Зупинити зі збереженням витраченого часу й залишку/);
  assert.doesNotMatch(html, /id="task-timer-toggle-timer-test"/);
});

test('paused task exposes Resume, keeps the countdown, and has no Stop action', () => {
  const html = renderTimer({ timerRunning: false, startedAt: 1, countdownRemainingSeconds: 1430, timeSpentSeconds: 70 });
  assert.match(html, /id="task-timer-toggle-timer-test"/);
  assert.match(html, />Продовжити<\/button>/);
  assert.match(html, /23:50/);
  assert.doesNotMatch(html, /id="task-timer-stop-timer-test"/);
});

test('running timer still offers pause when a caller has not adopted Stop', () => {
  const html = renderTimer({ timerRunning: true, timerStartedAt: Date.now() }, false);
  assert.match(html, /id="task-timer-toggle-timer-test"/);
  assert.match(html, />Пауза<\/button>/);
  assert.doesNotMatch(html, /id="task-timer-stop-timer-test"/);
});

test('inconsistent running task remains stoppable rather than hiding its controls', () => {
  const html = renderTimer({ timerMode: 'none', done: true, timerRunning: true, timerStartedAt: Date.now() });
  assert.match(html, /id="task-timer-widget-timer-test"/);
  assert.match(html, /id="task-timer-stop-timer-test"/);
  assert.match(html, /Таймер працює/);
});

test('Stop is localized for English users', () => {
  const html = renderTimer({ timerRunning: true, timerStartedAt: Date.now() }, true, 'en');
  assert.match(html, />Stop<\/button>/);
  assert.match(html, /Stop and keep time spent and remaining time/);
});
