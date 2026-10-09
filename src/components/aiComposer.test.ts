import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AIAssistantSheet } from './AIAssistantSheet';
import { saveAIAssistantDraft } from './aiAssistantState';

function renderWithDraft(prompt: string, recoverable = false, initialPrompt = '') {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  saveAIAssistantDraft(storage, {
    prompt, mode: 'chat',
    recoverableRequest: recoverable ? { text: 'Запит для повторення після помилки', mode: 'chat' } : null,
  }, 'composer-test');
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  try {
    return renderToStaticMarkup(React.createElement(AIAssistantSheet, {
      isOpen: true, lang: 'uk', onClose() {}, currentTasks: [], accountId: 'composer-test', initialPrompt,
      onInjectTasks: () => ({ created: 0, updated: 0, deleted: 0, tabs: 0, rejected: 0 }),
    }));
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
}

test('opening chat does not put old persisted text into the composer', () => {
  const html = renderWithDraft('Старий текст, який користувач вже закрив');
  assert.match(html, /<textarea[^>]*id="ai-prompt-input"[^>]*><\/textarea>/);
  assert.doesNotMatch(html, /Старий текст, який користувач вже закрив/);
});

test('recoverable failed request remains available for retry without filling ordinary input', () => {
  const html = renderWithDraft('Стара чернетка', true);
  assert.match(html, /<textarea[^>]*id="ai-prompt-input"[^>]*><\/textarea>/);
  assert.match(html, /Повторити запит/);
});

test('an explicit task prompt remains editable as multiline text with a clear action', () => {
  const html = renderWithDraft('Застарілий текст', false, 'Перший рядок\nДругий рядок');
  assert.match(html, /Перший рядок\nДругий рядок<\/textarea>/);
  assert.match(html, /aria-label="Очистити введений текст"/);
  assert.match(html, /Shift \+ Enter/);
  assert.doesNotMatch(html, /Застарілий текст/);
});
