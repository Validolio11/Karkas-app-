import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AIChatText } from './AIChatText';

const render = (text: string) => renderToStaticMarkup(React.createElement(AIChatText, { text }));

test('separates paragraphs while preserving deliberate line breaks and Cyrillic text', () => {
  const html = render('Перший рядок\r\nДругий рядок\r\n\r\nНовий абзац');
  assert.ok(html.includes('<p>Перший рядок\nДругий рядок</p><p>Новий абзац</p>'));
});

test('keeps a numbered plan as an ordered list and retains its initial number', () => {
  const html = render('3. Пошук референсів\n4. Підготовка\n\n- **Важливо**: зберегти результат\n- Перевірка');
  assert.ok(html.includes('<ol start="3"><li>Пошук референсів</li><li>Підготовка</li></ol>'));
  assert.ok(html.includes('<ul><li><strong>Важливо</strong>: зберегти результат</li><li>Перевірка</li></ul>'));
  assert.equal((html.match(/<li>/g) || []).length, 4);
});

test('renders emphasis, inline code and accessible headings without losing literal C#', () => {
  const html = render('# План C#\nЗбережіть **результат** у `notes.txt`.');
  assert.ok(html.includes('role="heading" aria-level="3">План C#</div>'));
  assert.ok(html.includes('<strong>результат</strong>'));
  assert.ok(html.includes('<code>notes.txt</code>'));
});

test('fenced code remains literal and does not create headings, lists or emphasis', () => {
  const html = render('```text\n# Не заголовок\n1. Не крок\n**Не жирний**\n```\nГотово');
  assert.ok(html.includes('<pre><code># Не заголовок\n1. Не крок\n**Не жирний**</code></pre>'));
  assert.ok(html.endsWith('<p>Готово</p></div>'));
  assert.equal(html.includes('<ol'), false);
  assert.equal(html.includes('<strong'), false);
});

test('unclosed code fence preserves all remaining text for an incomplete AI response', () => {
  const html = render('```js\nconst value = 1;\nnext();');
  assert.ok(html.includes('<pre><code>const value = 1;\nnext();</code></pre>'));
});

test('AI-supplied HTML and unsafe links cannot become executable elements', () => {
  const html = render('<img src=x onerror="alert(1)">\n<script>alert(1)</script>\n[відкрити](javascript:alert(1))\n**<iframe src=x>**');
  assert.equal(/<(?:img|script|iframe|a)(?:\s|>)/.test(html), false);
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('<strong>&lt;iframe src=x&gt;</strong>'));
});

test('empty and unmatched Markdown remain safe without dropping the text', () => {
  assert.equal(render('  \n'), '<div class="karkas-ai-chat-text"></div>');
  assert.ok(render('Залишити **незавершене та `слово').includes('Залишити **незавершене та `слово'));
});
