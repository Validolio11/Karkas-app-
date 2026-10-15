import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Ivan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const output = path.dirname(fileURLToPath(import.meta.url));
const url = process.env.QA_URL || 'http://127.0.0.1:54839';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(url).hostname));
const prompt = 'додай завдання створити скрипт';
const historyKey = 'karkas_ai_chat_history.v2:guest';
const results = [];
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 375, height: 812 }]) {
    const context = await browser.newContext({ viewport });
    const errors = [], requests = [];
    await context.route(request => new URL(request).origin !== new URL(url).origin, route => route.abort('blockedbyclient'));
    await context.route('**/api/**', async route => {
      if (!route.request().url().includes('/api/ai/assist')) return route.fulfill({ json: { ok: true, success: true, models: ['gemini-3-flash-preview'] } });
      requests.push(route.request().postDataJSON());
      await route.fulfill({ json: { reply: 'Пропозиція готова: нові завдання (1): «створити скрипт». Переглянь її й натисни «Застосувати зміни», щоб її виконати.', summary: 'Нове завдання', tasks: [{ title: 'створити скрипт', phase: 'work', priority: 2, steps: 0, timerMode: 'none' }] } });
    });
    await context.addInitScript(() => {
      if (localStorage.getItem('qa-apply-seeded')) return;
      localStorage.setItem('qa-apply-seeded', '1');
      localStorage.setItem('todo_app_lang', 'uk');
      localStorage.setItem('life_todo_tabs_v2', JSON.stringify([{ id: 'work', name: 'Робота', color: '#fff' }]));
      localStorage.setItem('life_todo_tasks_v2', '[]');
      localStorage.setItem('karkas_deleted_tasks_v2', '[]');
      localStorage.setItem('karkas_custom_ai_enabled', 'true');
      localStorage.setItem('karkas_available_models', JSON.stringify(['gemini-3-flash-preview']));
      localStorage.setItem('karkas_custom_model', 'gemini-3-flash-preview');
      sessionStorage.setItem('karkas_custom_api_key_session', 'synthetic-local-qa-key');
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.locator('#bottom-summon-ai-btn').click();
    await page.getByPlaceholder('Напишіть повідомлення…', { exact: true }).fill(prompt);
    await page.locator('#ai-generate-submit-btn').click();
    const apply = page.locator('#ai-chat-apply-changes-btn');
    await apply.waitFor();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('life_todo_tasks_v2')).length), 0, 'Proposal must await consent');
    await page.waitForFunction(() => Math.abs(new DOMMatrixReadOnly(getComputedStyle(document.querySelector('#ps-ai-sheet')).transform).m42) < 0.5);
    await page.screenshot({ path: path.join(output, viewport.width > 500 ? 'apply-proposal-desktop.png' : 'apply-proposal-mobile.png'), fullPage: true });
    // Synchronous DOM clicks exercise the ref guard before React can remove the button.
    await apply.evaluate(button => { button.click(); button.click(); button.click(); });
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('life_todo_tasks_v2')).length === 1);
    assert.equal(await apply.count(), 0, 'Applied proposal no longer offers Apply');
    const task = await page.evaluate(() => JSON.parse(localStorage.getItem('life_todo_tasks_v2'))[0]);
    assert.equal(task.title, 'створити скрипт');
    assert.equal(task.phase, 'work');
    const applied = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).find(message => message.response?.tasks?.length), historyKey);
    assert.equal(applied.proposalStatus, 'applied');
    await page.locator('#close-ai-sheet-btn').click();
    await page.locator('#bottom-summon-ai-btn').click();
    assert.equal(await apply.count(), 0, 'Reopen cannot apply the proposal twice');
    await page.reload();
    await page.locator('#bottom-summon-ai-btn').click();
    await page.getByPlaceholder('Напишіть повідомлення…', { exact: true }).waitFor();
    assert.equal(await apply.count(), 0, 'Reload cannot apply the proposal twice');
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('life_todo_tasks_v2'))), [task], 'One created task persists exactly');
    assert.deepEqual(errors, [], 'No uncaught browser errors');
    await page.locator('#close-ai-sheet-btn').click();
    await page.locator('#ps-ai-sheet').waitFor({ state: 'detached' });
    await page.screenshot({ path: path.join(output, viewport.width > 500 ? 'apply-result-desktop.png' : 'apply-result-mobile.png'), fullPage: true });
    results.push({ viewport, passed: true, account: 'guest', assistRequests: requests.length, taskId: task.id, scenarios: ['Proposal awaits explicit Apply', 'Apply creates one task', 'Three immediate clicks create no duplicates', 'Applied status survives close/reopen and reload'] });
    await context.close();
  }
  fs.writeFileSync(path.join(output, 'apply-ui-results.json'), JSON.stringify({ passed: true, syntheticOnly: true, realAiCalls: 0, note: 'Actual production UI with deterministic assist mocks. Guest account only; no real Firebase login or cloud writes.', results }, null, 2));
  console.log(`PASS ${results.length} Apply UI regression groups`);
} finally { await browser.close(); }
