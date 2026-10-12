import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Ivan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const out = path.dirname(fileURLToPath(import.meta.url));
const url = 'http://127.0.0.1:54837';
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const results = [];
async function session(width, height, legacy = false) {
  const context = await browser.newContext({ viewport: { width, height } });
  await context.route(request => new URL(request).origin !== url, route => route.abort());
  await context.route('**/api/**', route => route.fulfill({ json: { ok: true } }));
  await context.addInitScript(({ legacy }) => {
    localStorage.setItem('todo_app_lang', 'uk');
    localStorage.setItem('life_todo_tabs_v2', JSON.stringify([{ id: 'work', [legacy ? 'label' : 'name']: 'Робота', color: '#fff' }]));
    localStorage.setItem('life_todo_tasks_v2', '[]');
    localStorage.setItem('karkas_deleted_tasks_v2', '[]');
  }, { legacy });
  // Seed once only: reload must retain created tasks and drafts.
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.locator('#top-quick-add-btn').click();
  return { page, context, errors };
}
async function next(page) { await page.locator('#quick-add-next-btn').click(); await page.waitForTimeout(270); }
async function noOverflow(page) { assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow'); }
try {
  const s = await session(1280, 900, true), p = s.page;
  assert.ok(await p.locator('#quick-add-title-input').isVisible());
  assert.equal(await p.locator('#quick-add-next-btn').isEnabled(), false);
  await p.locator('#quick-add-title-input').fill('Ізольоване завдання з датами');
  await p.locator('#quick-add-note-input').fill('Перший рядок\nДругий рядок');
  await next(p); await p.locator('#quick-add-tab-work').click();
  await next(p); await p.locator('#quick-add-priority-slider').fill('2');
  await next(p);
  await p.locator('#quick-add-planned-date').fill('2026-10-16');
  await p.locator('#quick-add-deadline-date').fill('2026-10-15');
  await next(p); assert.ok(await p.locator('#quick-add-dates-warning').isVisible());
  await p.locator('#quick-add-deadline-date').fill('2026-10-21');
  await p.getByRole('button', { name: 'Наступний місяць', exact: true }).click();
  await p.getByRole('button', { name: 'Попередній місяць', exact: true }).click();
  assert.equal(await p.locator('#quick-add-planned-date').inputValue(), '2026-10-16');
  await noOverflow(p); await p.screenshot({ path: path.join(out, 'task-dates-desktop.png') });
  await p.locator('#quick-add-close-btn').click(); await p.locator('#top-quick-add-btn').click();
  assert.equal(await p.locator('#quick-add-deadline-date').inputValue(), '2026-10-21');
  await next(p); await p.locator('#quick-add-timer-countdown').click();
  await p.locator('#quick-add-countdown-minutes').fill('35'); await next(p);
  await p.locator('#quick-add-step-count').fill('2');
  await p.locator('#custom-step-input-0').fill('Почати');
  await p.locator('#custom-step-input-1').fill('Завершити');
  await p.screenshot({ path: path.join(out, 'task-steps-desktop.png') });
  await p.locator('#quick-add-submit-btn').click();
  await p.waitForFunction(() => JSON.parse(localStorage.getItem('life_todo_tasks_v2')).length === 1);
  const task = await p.evaluate(() => JSON.parse(localStorage.getItem('life_todo_tasks_v2'))[0]);
  assert.equal(task.plannedDate, '2026-10-16'); assert.equal(task.deadlineDate, '2026-10-21');
  assert.equal(task.priority, 1); assert.equal(task.countdownDurationSeconds, 2100);
  assert.equal(task.timerRunning, false); assert.equal(task.stepList.length, 2);
  assert.equal(task.note, 'Перший рядок\nДругий рядок');
  assert.equal(s.errors.length, 0, s.errors.join('\n')); await s.context.close();
  results.push('Six-stage creation, blank title, categories, priority, reversed dates, calendar navigation, retained draft, paused countdown and named substeps');
  const m = await session(375, 812), mp = m.page;
  await mp.locator('#quick-add-title-input').fill('Мобільне завдання');
  for (let step = 0; step < 3; step++) await next(mp);
  await noOverflow(mp); await mp.screenshot({ path: path.join(out, 'task-dates-mobile.png') });
  await next(mp); await mp.locator('#quick-add-timer-none').click(); await next(mp);
  await mp.locator('#quick-add-submit-btn').click();
  await mp.waitForFunction(() => JSON.parse(localStorage.getItem('life_todo_tasks_v2')).length === 1);
  const mobileTask = await mp.evaluate(() => JSON.parse(localStorage.getItem('life_todo_tasks_v2'))[0]);
  assert.equal(mobileTask.timerMode, 'none'); assert.equal(mobileTask.plannedDate, undefined);
  assert.equal(mobileTask.deadlineDate, undefined); assert.equal(m.errors.length, 0, m.errors.join('\n'));
  await m.context.close(); results.push('Mobile calendar and creation without dates/time/substeps; no overflow or React errors');
  fs.writeFileSync(path.join(out, 'task-entry-results.json'), JSON.stringify({ passed: true, syntheticOnly: true, realAiCalls: 0, results }, null, 2));
  console.log(`PASS ${results.length} task-entry integration groups`);
} finally { await browser.close(); }
