const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizePresence, progressFor, tooltipFor, trayMenuModel } = require('./presence.cjs');

function activePresence(changes = {}, lang = 'uk') {
  return {
    lang,
    active: {
      taskId: 'task-1', title: 'Оновити дизайн онбордингу', state: 'running', mode: 'countdown',
      elapsedSeconds: 180, totalSeconds: 900, remainingSeconds: 720, ...changes,
    },
  };
}

test('sanitizePresence copies only the supported presence fields', () => {
  const input = { ...activePresence(), next: { taskId: 'task-2', title: 'Write notes', extra: true }, extra: true };
  input.active.extra = true;
  const result = sanitizePresence(input);
  assert.deepEqual(result, {
    lang: 'uk',
    active: {
      taskId: 'task-1', title: 'Оновити дизайн онбордингу', state: 'running', mode: 'countdown',
      elapsedSeconds: 180, totalSeconds: 900, remainingSeconds: 720,
    },
    next: { taskId: 'task-2', title: 'Write notes' },
  });
  assert.notEqual(result.active, input.active);
  assert.notEqual(result.next, input.next);
  assert.deepEqual(sanitizePresence({ lang: 'en' }), { lang: 'en' });
});

test('sanitizePresence falls back safely for malformed payloads', () => {
  for (const payload of [undefined, null, [], 'en', 0, {}, { lang: 'fr' }, { lang: 'en', active: null }, { lang: 'en', next: [] }]) {
    assert.deepEqual(sanitizePresence(payload), { lang: 'uk' });
  }
  const throwing = { get lang() { throw new Error('unreadable'); } };
  assert.deepEqual(sanitizePresence(throwing), { lang: 'uk' });
});

test('sanitizePresence rejects invalid task references, states and timer values', () => {
  for (const changes of [
    { taskId: '' }, { taskId: '   ' }, { taskId: 'x'.repeat(129) }, { taskId: 1 },
    { title: 'x'.repeat(61) }, { title: null }, { state: 'idle' }, { mode: 'pomodoro' },
    { elapsedSeconds: -1 }, { elapsedSeconds: NaN }, { elapsedSeconds: Infinity },
    { totalSeconds: -1 }, { totalSeconds: '900' }, { remainingSeconds: -1 }, { remainingSeconds: Infinity },
  ]) {
    assert.deepEqual(sanitizePresence(activePresence(changes, 'en')), { lang: 'uk' });
  }
  assert.deepEqual(sanitizePresence({ lang: 'en', next: { taskId: 'x'.repeat(129), title: 'Next' } }), { lang: 'uk' });
  const boundaries = activePresence({ taskId: 'x'.repeat(128), title: 'x'.repeat(60), elapsedSeconds: 0, totalSeconds: 0, remainingSeconds: 0 }, 'en');
  assert.deepEqual(sanitizePresence(boundaries), boundaries);
});

test('sanitizePresence accepts optional timer fields without inventing values', () => {
  assert.deepEqual(sanitizePresence({
    lang: 'en', active: { taskId: 'clock', title: 'Work', state: 'running', mode: 'stopwatch', elapsedSeconds: 3900 },
  }), {
    lang: 'en', active: { taskId: 'clock', title: 'Work', state: 'running', mode: 'stopwatch', elapsedSeconds: 3900 },
  });
});

test('progressFor maps countdown states and clamps progress', () => {
  assert.deepEqual(progressFor(activePresence()), { value: 0.2, mode: 'normal' });
  assert.deepEqual(progressFor(activePresence({ state: 'paused' })), { value: 0.2, mode: 'paused' });
  assert.deepEqual(progressFor(activePresence({ state: 'expired' })), { value: 1, mode: 'error' });
  assert.deepEqual(progressFor(activePresence({ elapsedSeconds: 1200 })), { value: 1, mode: 'normal' });
  assert.deepEqual(progressFor(activePresence({ totalSeconds: 0 })), { value: 0, mode: 'normal' });
  assert.deepEqual(progressFor(activePresence({ totalSeconds: undefined })), { value: 0, mode: 'normal' });
});

test('progressFor clears idle, invalid and stopwatch presence', () => {
  assert.deepEqual(progressFor({ lang: 'en' }), { value: -1, mode: 'none' });
  assert.deepEqual(progressFor(null), { value: -1, mode: 'none' });
  assert.deepEqual(progressFor(activePresence({ mode: 'stopwatch' })), { value: -1, mode: 'none' });
});

test('tooltipFor formats Ukrainian countdown, stopwatch, expired and idle presence', () => {
  assert.equal(tooltipFor(activePresence()), 'Karkas · Оновити дизайн онбордингу · залишилось 12 хв');
  assert.equal(tooltipFor(activePresence({ mode: 'stopwatch', elapsedSeconds: 3900 })), 'Karkas · Оновити дизайн онбордингу · 1 год 5 хв у роботі');
  assert.equal(tooltipFor(activePresence({ state: 'expired' })), 'Karkas · Оновити дизайн онбордингу · сесію завершено');
  assert.equal(tooltipFor(activePresence({ state: 'paused' })), 'Karkas · Оновити дизайн онбордингу · на паузі · залишилось 12 хв');
  assert.equal(tooltipFor({ lang: 'uk', next: { taskId: 'next', title: 'План' } }), 'Karkas · Далі: План');
  assert.equal(tooltipFor({ lang: 'uk' }), 'Karkas');
});

test('tooltipFor localizes English durations and rounds countdown time up', () => {
  assert.equal(tooltipFor(activePresence({ title: 'Work', remainingSeconds: 61 }, 'en')), 'Karkas · Work · 2 min left');
  assert.equal(tooltipFor(activePresence({ title: 'Work', remainingSeconds: 3900 }, 'en')), 'Karkas · Work · 1 h 5 min left');
  assert.equal(tooltipFor(activePresence({ title: 'Work', mode: 'stopwatch', elapsedSeconds: 59 }, 'en')), 'Karkas · Work · 0 min in progress');
  assert.equal(tooltipFor(activePresence({ title: 'Work', state: 'expired' }, 'en')), 'Karkas · Work · session finished');
  assert.equal(tooltipFor({ lang: 'en', next: { taskId: 'next', title: 'Notes' } }), 'Karkas · Next: Notes');
});

test('trayMenuModel builds localized base actions and idle quick start', () => {
  assert.deepEqual(trayMenuModel({ lang: 'en', next: { taskId: 'next', title: 'Notes' } }), [
    { label: 'Start: Notes', enabled: true, command: { type: 'start-task', taskId: 'next' } },
    { label: 'Open Karkas', enabled: true, command: 'open' },
    { label: 'New task', enabled: true, command: 'new-task' },
    { label: 'Settings', enabled: true, command: 'open-settings' },
    { label: '', enabled: false },
    { label: 'Quit', enabled: true, command: 'quit' },
  ]);
  assert.deepEqual(trayMenuModel({ lang: 'uk' }).map(item => item.label), [
    'Відкрити Karkas', 'Нова задача', 'Налаштування', '', 'Вийти',
  ]);
});

test('trayMenuModel exposes active commands and suppresses quick start while running', () => {
  const presence = { ...activePresence(), next: { taskId: 'next', title: 'Notes' } };
  const model = trayMenuModel(presence);
  assert.deepEqual(model.slice(0, 4), [
    { label: 'Оновити дизайн онбордингу · залишилось 12 хв', enabled: false },
    { label: 'Пауза', enabled: true, command: { type: 'toggle-timer', taskId: 'task-1' } },
    { label: 'Завершити', enabled: true, command: { type: 'complete-task', taskId: 'task-1' } },
    { label: '', enabled: false },
  ]);
  assert.equal(model.some(item => item.command?.type === 'start-task'), false);
  assert.equal(JSON.stringify(trayMenuModel(presence)), JSON.stringify(model));
});

test('trayMenuModel permits resume and quick start after pause or expiry', () => {
  for (const state of ['paused', 'expired']) {
    const presence = { ...activePresence({ title: 'Work', state }, 'en'), next: { taskId: 'next', title: 'Notes' } };
    const model = trayMenuModel(presence);
    assert.equal(model[1].label, 'Resume');
    assert.equal(model[2].label, 'Complete');
    assert.deepEqual(model[4], { label: 'Start: Notes', enabled: true, command: { type: 'start-task', taskId: 'next' } });
  }
});
