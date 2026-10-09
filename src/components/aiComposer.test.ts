import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AIAssistantSheet } from './AIAssistantSheet';
import { saveAIAssistantDraft } from './aiAssistantState';

function renderWithDraft(prompt: string, recoverable = false, initialPrompt = '', messages: { role: 'user' | 'assistant'; content: string }[] = []) {
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
  storage.setItem('karkas_ai_chat_history:composer-test', JSON.stringify(messages));
  storage.setItem('karkas_available_models', JSON.stringify(['gemini-test-model']));
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

test('ordinary AI numbered steps remain a readable list rather than resend buttons', () => {
  const html = renderWithDraft('', false, '', [{ role: 'assistant', content: 'План:\n1. Знайти референси\n2. Скласти добірку' }]);
  assert.match(html, /<ol[^>]*><li>Знайти референси<\/li><li>Скласти добірку<\/li><\/ol>/);
  assert.doesNotMatch(html, /min-h-11 w-full text-left/);
});

test('deliberate response choices remain clickable and user Markdown stays plain', () => {
  const html = renderWithDraft('', false, '', [
    { role: 'user', content: '**Мій текст**' },
    { role: 'assistant', content: 'Оберіть варіант:\n1. Почати зараз\n2. Відкласти' },
  ]);
  assert.match(html, /class="whitespace-pre-wrap">\*\*Мій текст\*\*<\/div>/);
  assert.match(html, /min-h-11 w-full text-left/);
  assert.doesNotMatch(html, /<strong>Мій текст<\/strong>/);
});

test('choice-looking lines inside fenced code remain code, not actions', () => {
  const html = renderWithDraft('', false, '', [{ role: 'assistant', content: '```\nChoose one:\n1. literal\n```' }]);
  assert.match(html, /<pre><code>Choose one:\n1\. literal<\/code><\/pre>/);
  assert.doesNotMatch(html, /min-h-11 w-full text-left/);
});

test('composer exposes a named emoji action and custom model combobox without native select', () => {
  const html = renderWithDraft('');
  assert.match(html, /aria-label="Додати емодзі"/);
  assert.match(html, /role="combobox"/);
  assert.doesNotMatch(html, /<select/);
});
