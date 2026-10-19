import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PSTask } from '../types';
import { scheduleDurationMinutes } from './TaskScheduleDialog';
import { TaskDateCalendar } from './TaskDateCalendar';
import { TaskCard } from './TaskCard';

const noop = () => {};

test('schedule start and end yield whole minutes including an exact midnight end', () => {
  assert.equal(scheduleDurationMinutes('19:00', '21:00'), 120);
  assert.equal(scheduleDurationMinutes('18:30', '19:00'), 30);
  assert.equal(scheduleDurationMinutes('19:00', '24:00'), 300);
});

test('schedule end before start, equal times and malformed clocks are rejected', () => {
  assert.equal(scheduleDurationMinutes('19:00', '18:30'), undefined);
  assert.equal(scheduleDurationMinutes('19:00', '19:00'), undefined);
  assert.equal(scheduleDurationMinutes('24:00', '24:00'), undefined);
  assert.equal(scheduleDurationMinutes('09:00', '24:01'), undefined);
  assert.equal(scheduleDurationMinutes('9:00', '10:00'), undefined);
});

test('schedule calendar selects a work day without exposing deadline controls', () => {
  const html = renderToStaticMarkup(React.createElement(TaskDateCalendar, {
    plannedDate: '2026-10-19', deadlineDate: '', onPlannedDateChange: noop,
    onDeadlineDateChange: noop, lang: 'uk', plannedOnly: true, idPrefix: 'schedule-test',
  }));
  assert.match(html, /Сьогодні/);
  assert.match(html, /Завтра/);
  assert.match(html, /id="schedule-test-planned-date"/);
  assert.doesNotMatch(html, /Завершити до|deadline-date/);
});

function renderCard(fields: Partial<PSTask>, lang: 'uk' | 'en' = 'uk') {
  const task: PSTask = { id: 'missed-card', title: 'Animation', phase: 'work', priority: 2,
    steps: 0, currentStep: 0, done: false, pinned: false, createdAt: 1,
    scheduledFor: Date.now() - 7200000, scheduledDurationSeconds: 1800, ...fields };
  return renderToStaticMarkup(React.createElement(TaskCard, {
    task, index: 0, lang, timeZone: 'Europe/Kyiv', onStartTask: noop,
    onToggleDone: noop, onUpdateStep: noop, onCyclePriority: noop,
    onCyclePhase: noop, onTogglePin: noop, onDelete: noop, onAskAIAboutTask: noop,
    onToggleTimer: noop, onReplanDay: noop, onApplyAgentActions: noop,
  }));
}

test('missed card offers a calm status, start and replan with an editable time range', () => {
  const html = renderCard({});
  assert.match(html, /Пропущено з \d{2}:\d{2}/);
  assert.match(html, /Почати зараз/);
  assert.match(html, /Перебудувати день/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /Змінити час/);
  assert.match(renderCard({}, 'en'), /Missed since \d{2}:\d{2}/);
});

test('paused overdue cards are missed while running and completed cards are not', () => {
  assert.match(renderCard({ startedAt: 1, timeSpentSeconds: 60 }), /Пропущено з/);
  assert.doesNotMatch(renderCard({ timerRunning: true, timerStartedAt: Date.now() }), /Пропущено з/);
  assert.doesNotMatch(renderCard({ done: true }), /Пропущено з/);
});
