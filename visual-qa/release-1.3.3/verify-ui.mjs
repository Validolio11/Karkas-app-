import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { confirmedProfile, discoveryGoal, discoveryStatements } from '../../src/utils/strategyDiscovery.testHelpers.ts';
import { createPersonalStrategyProfile } from '../../src/utils/personalStrategy.ts';
import { preparePersonalDiscoveryRequest, isPersonalStrategyReady } from '../../src/utils/strategyDiscovery.ts';
import { sanitizeDiscoveryResponse } from '../../server/strategyDiscovery.ts';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Ivan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const out = path.dirname(fileURLToPath(import.meta.url));
const url = process.env.QA_URL || 'http://127.0.0.1:54837';
assert.equal(new URL(url).port, '54837', 'Only authorized isolated production server');
const results = process.env.QA_REMAINING ? JSON.parse(fs.readFileSync(path.join(out, 'qa-results.json'), 'utf8')).scenariosCompleted : [];
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const history = Array.from({ length: 36 }, (_, i) => ({ id: `old-${i}`, role: i % 2 ? 'assistant' : 'user', content: `Попередня розмова ${i + 1}` }));
const timedTask = { id: 'timed', title: 'Підготувати матеріали', phase: 'work', priority: 2, steps: 2, currentStep: 1, done: false, pinned: false, createdAt: 1720000000000, timerMode: 'stopwatch', timerRunning: false, timeSpentSeconds: 75, stepList: [{ id: 'completed', title: 'Переглянути матеріали', done: true, timeSpentSeconds: 50 }, { id: 'measured', title: 'Зібрати нотатки', done: false, timeSpentSeconds: 25 }] };
async function setup(viewport, profile, tasks = [], options = {}) {
  const context = await browser.newContext({ viewport });
  // Prevent authentication SDK/analytics/font requests from reaching any real service.
  await context.route(requestUrl => new URL(requestUrl).origin !== new URL(url).origin, route => route.abort('blockedbyclient'));
  await context.addInitScript(({ history, profile, tasks, options }) => {
    if (localStorage.getItem('qa-seeded')) return;
    localStorage.setItem('qa-seeded', '1');
    localStorage.setItem('todo_app_lang', options.lang || 'uk');
    localStorage.setItem('life_todo_tabs_v2', JSON.stringify([{ id: 'work', name: 'Робота', color: '#fff' }]));
    localStorage.setItem('life_todo_tasks_v2', JSON.stringify(tasks));
    localStorage.setItem('karkas_deleted_tasks_v2', JSON.stringify(options.deletedTasks || []));
    localStorage.setItem('karkas_custom_api_key', 'synthetic-qa-key');
    localStorage.setItem('karkas_custom_ai_enabled', 'true');
    localStorage.setItem('karkas_available_models', '["gemini-qa-model"]');
    localStorage.setItem('karkas_custom_model', 'gemini-qa-model');
    localStorage.setItem('karkas_notepad_notes_v1', JSON.stringify([{ id: 'legacy-note', title: 'Ізольована стара нотатка', content: 'Приватний синтетичний текст', createdAt: 1720000000000 }]));
    localStorage.setItem('karkas_notepad_notes_v1:account%3Asynthetic-a', '[]');
    localStorage.setItem('karkas_strategy_audit_v1:guest:THIS_MONTH:uk:gemini-qa-model', JSON.stringify({ at: Date.now(), context: 'damaged-cache', value: { suggestedTasks: [null], productivityScore: null, summary: {} } }));
    localStorage.setItem('karkas_ai_chat_history:guest', JSON.stringify(history));
    localStorage.setItem('karkas.personal-strategy.v1:account%3Asynthetic-a', 'sentinel-account-a');
    localStorage.setItem('karkas.personal-strategy.v1:account%3Asynthetic-b', 'sentinel-account-b');
    localStorage.setItem('karkas_ai_draft.v2:account:guest', 'sentinel-account-named-guest-draft');
    localStorage.setItem('karkas_ai_chat_history.v2:account:guest', 'sentinel-account-named-guest-history');
    localStorage.setItem('karkas_ai_chat_welcome.v2:account:guest', 'sentinel-account-named-guest-welcome');
    if (profile) localStorage.setItem('karkas.personal-strategy.v1:guest', JSON.stringify(profile));
  }, { history, profile, tasks, options });
  const page = await context.newPage();
  const requests = [], errors = []; let failedOnce = false;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', async route => {
    if (route.request().url().endsWith('/ai/verify-key')) return route.fulfill({ json: { success: true, models: ['gemini-qa-model'] } });
    if (!route.request().url().endsWith('/ai/assist')) return route.fulfill({ json: { ok: true } });
    const request = route.request().postDataJSON(); requests.push(request);
    if (request.prompt === 'Помилка мережі' && !failedOnce) { failedOnce = true; return route.abort('failed'); }
    let response = { summary: 'Тестова відповідь', reply: 'Допоможу з конкретним запитом.', tasks: [], taskUpdates: [], taskDeletions: [], tabs: [] };
    if (request.prompt === 'Затримана відповідь') {
      await new Promise(resolve => setTimeout(resolve, 800));
      response.strategy = { status: 'ready', narrative: 'Пізня відповідь', actions: [{ id: 'late', goalId: 'g', type: 'create', reason: 'Затримана дія', changes: { title: 'Пізня дія не має з’явитися', phase: 'work' } }] };
    } else if (request.intent === 'analysis' && request.prompt === 'Перевір старий план') {
      response.strategy = { status: 'ready', narrative: 'Неправильно підмінений план аналізу', nextAction: 'Недозволена наступна дія', actions: [{ id: 'analysis-leak', goalId: 'g', type: 'create', reason: 'Неправильне застосування аналізу', changes: { title: 'Аналіз не має створити завдання', phase: 'work' } }] };
    } else if (request.prompt.includes('Створи завдання')) response.tasks = [{ title: 'Конкретна звичайна справа', phase: 'work', priority: 2, steps: 0 }];
    else if (request.prompt === 'Недозволений автономний план') response.strategy = { status: 'ready', narrative: 'Небажаний ранній план', actions: [{ id: 'unsafe', goalId: 'g', type: 'create', reason: 'Непідтверджено', changes: { title: 'Не має з’явитися', phase: 'work' } }] };
    else if (request.prompt === 'Адаптуй погоджений підхід') {
      const expectedTask = request.taskSnapshots?.find(task => task.id === 'timed');
      assert.ok(expectedTask, 'Raw dispatch snapshot provided for actual strategy update');
      const storedTask = await page.evaluate(() => JSON.parse(localStorage.getItem('life_todo_tasks_v2')).find(task => task.id === 'timed'));
      assert.deepEqual(expectedTask, storedTask, 'Expected task uses canonical raw task, not derived AI timer context');
      response.strategy = { status: 'ready', narrative: 'Погоджений підхід адаптовано.', nextAction: 'Уточнити наступний крок.', actions: [{ id: 'adapt', goalId: 'g', taskId: 'timed', type: 'update', expectedTask, reason: 'Зберегти зроблене й уточнити наступний крок', changes: { title: 'Уточнені матеріали', stepTitles: ['Новий наступний крок'] } }] };
    } else if (request.prompt === 'Застаріле оновлення після правки') {
      const expectedTask = request.taskSnapshots.find(task => task.id === 'timed');
      await new Promise(resolve => setTimeout(resolve, 800));
      response.strategy = { status: 'ready', narrative: 'Уточнення підходу', actions: [{ id: 'stale-update', goalId: 'g', taskId: 'timed', type: 'update', expectedTask, reason: 'Тест конкурентної правки', changes: { title: 'Застарілий заголовок не має з’явитися' } }] };
    } else if (!request.prompt.startsWith('Поясни') && !['Помилка мережі', 'Продовжуй звичайну розмову'].includes(request.prompt)) {
      const prepared = preparePersonalDiscoveryRequest(request.strategyContext || createPersonalStrategyProfile(), request.prompt, request.discoveryConfirmationId);
      if (isPersonalStrategyReady(prepared.profile)) response.strategy = { status: 'ready', narrative: 'Розуміння підтверджено. Можемо обрати посильний підхід.', actions: [] };
      else {
        const matchingTopic = Object.entries(discoveryStatements).find(([, quote]) => quote === request.prompt)?.[0];
        const wishlist = request.prompt.startsWith('Хочу портфоліо');
        const answers = matchingTopic ? [{ topic: matchingTopic, status: 'answered', quote: request.prompt }] : wishlist ? Object.keys(discoveryStatements).map(topic => ({ topic, status: 'answered', quote: request.prompt })) : [];
        response = sanitizeDiscoveryResponse({ reply: 'Почніть працювати щодня по дві години!', memoryPatch: { ...(wishlist ? { goals: [{ ...discoveryGoal, title: 'Портфоліо та навчання' }] } : {}), discovery: { answers, ...(wishlist ? { selectedGoalIds: ['g'] } : {}) } }, tasks: [{ title: 'Зайве', phase: 'work' }] }, prepared.profile, request.prompt, request.turnId, true);
        response.summary = response.reply;
      }
    }
    return route.fulfill({ json: { ...response, source: 'gemini-chat' } });
  });
  await page.goto(url); await page.locator('#bottom-summon-ai-btn').waitFor();
  return { page, context, requests, errors };
}
async function profileOf(page) { return page.evaluate(() => JSON.parse(localStorage.getItem('karkas.personal-strategy.v1:guest'))); }
async function tasksOf(page) { return page.evaluate(() => JSON.parse(localStorage.getItem('life_todo_tasks_v2'))); }
async function open(page) { await page.locator('#bottom-summon-ai-btn').click(); await page.locator('#ps-ai-sheet').waitFor(); }
async function send(session, text) {
  const count = session.requests.length;
  await session.page.locator('#ai-prompt-input').fill(text);
  await session.page.locator('#ai-generate-submit-btn').click();
  await session.page.waitForFunction(() => !document.getElementById('ai-request-cancel-btn'));
  assert.equal(session.requests.length, count + 1);
}
async function noOverflow(page, label) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, label);
}
async function screenshot(page, name, fullPage = false) {
  if (await page.locator('#ps-ai-sheet').count()) await page.waitForFunction(() => {
    const transform = getComputedStyle(document.getElementById('ps-ai-sheet')).transform;
    return transform === 'none' || Math.abs(new DOMMatrixReadOnly(transform).m42) < 0.5;
  });
  await page.screenshot({ path: path.join(out, name), fullPage });
}
try {
  if (!process.env.QA_REMAINING) {
  const d = await setup({ width: 1440, height: 1000 }); const p = d.page;
  await p.locator('#phase-filter-notepad').click();
  await p.getByRole('heading', { name: 'Ізольована стара нотатка', exact: true }).waitFor();
  assert.equal(await p.evaluate(() => localStorage.getItem('karkas_notepad_notes_v1:migration-owner')), 'guest');
  assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('karkas_notepad_notes_v1:guest'))[0].id), 'legacy-note');
  assert.equal(await p.evaluate(() => localStorage.getItem('karkas_notepad_notes_v1:account%3Asynthetic-a')), '[]');
  assert.ok(await p.evaluate(() => localStorage.getItem('karkas_notepad_notes_v1') !== null), 'Original notes preserved');
  await p.getByTitle('Видалити', { exact: true }).click();
  const confirmation = p.locator('dialog[open]');
  await confirmation.waitFor();
  await p.keyboard.press('Tab');
  assert.equal(await p.evaluate(() => !!document.activeElement.closest('dialog[open]')), true, 'Native dialog keeps Tab inside');
  await p.keyboard.press('Shift+Tab');
  assert.equal(await p.evaluate(() => !!document.activeElement.closest('dialog[open]')), true);
  await p.keyboard.press('Escape');
  await confirmation.waitFor({ state: 'hidden' });
  assert.equal(await p.getByRole('heading', { name: 'Ізольована стара нотатка', exact: true }).count(), 1);
  results.push('Legacy notes migrate once into guest scope, preserving original and synthetic account data; native delete dialog traps Tab and cancels with Escape without deleting');
  await p.getByRole('button', { name: 'МОЯ СТРАТЕГІЯ', exact: true }).click();
  assert.equal(d.requests.length, 0);
  assert.equal(d.errors.length, 0, d.errors.join('\n'));
  results.push('Damaged cached strategy payload cannot crash the strategy view or generate a provider request on opening');
  await open(p); await p.getByText('Вітаю! Я ШІ-помічник Karkas.', { exact: false }).waitFor();
  assert.match(await p.locator('[role=log] .karkas-ai-message').first().innerText(), /Вітаю!/);
  assert.equal(d.requests.length, 0);
  const migratedHistory = await p.evaluate(() => JSON.parse(localStorage.getItem('karkas_ai_chat_history.v2:guest')));
  assert.equal(migratedHistory.filter(message => message.id?.startsWith('old-')).length, 36);
  assert.equal(await p.evaluate(() => localStorage.getItem('karkas_ai_chat_history:guest')), null);
  const rect = await p.locator('#ps-ai-sheet').boundingBox(); assert.equal(Math.round(rect.width), 1100); assert.equal(Math.round(rect.height), 950);
  const style = await p.locator('#ai-command-menu-btn').evaluate(el => { const s = getComputedStyle(el), svg = el.querySelector('svg'), send = document.getElementById('ai-generate-submit-btn'); return { radius: s.borderRadius, background: s.backgroundColor, color: s.color, width: el.offsetWidth, height: el.offsetHeight, svgWidth: svg.getBoundingClientRect().width, svgHeight: svg.getBoundingClientRect().height, sendWidth: send.offsetWidth, sendHeight: send.offsetHeight }; });
  assert.deepEqual(style, { radius: '0px', background: 'rgb(255, 255, 255)', color: 'rgb(0, 0, 0)', width: 44, height: 44, svgWidth: 16, svgHeight: 16, sendWidth: 44, sendHeight: 44 });
  await p.locator('#ai-command-menu-btn').click(); await p.locator('#ai-command-menu').waitFor(); await screenshot(p, 'desktop-menu.png');
  await p.keyboard.press('Escape'); assert.equal(await p.locator('#ai-command-menu').count(), 0); assert.ok(await p.locator('#ps-ai-sheet').isVisible());
  await p.locator('#ai-command-menu-btn').focus(); await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter');
  assert.match(await p.locator('.karkas-ai-command-chip').innerText(), /@analysis/); assert.equal(d.requests.length, 0);
  await p.locator('.karkas-ai-command-chip button').click(); await p.locator('#ai-command-menu-btn').click(); await p.locator('#ai-prompt-input').click(); assert.equal(await p.locator('#ai-command-menu').count(), 0);
  results.push('Desktop dimensions; white square 44px plus / black 16px icon matches Send; keyboard, Escape and outside menu; menu does not send');
  await send(d, 'Хочу портфоліо, фриланс, англійську та швидкий друк.');
  let profile = await profileOf(p); assert.equal(profile.discovery.topics.direction.status, 'answered');
  for (const topic of ['barriers', 'capacity', 'circumstances', 'attempts']) assert.equal(profile.discovery.topics[topic].status, 'unknown');
  assert.equal((await tasksOf(p)).length, 0); assert.doesNotMatch(await p.locator('[role=log]').innerText(), /щодня по дві години/);
  await send(d, 'Так'); assert.ok(!isPersonalStrategyReady(await profileOf(p)));
  await send(d, 'Недозволений автономний план'); assert.equal((await tasksOf(p)).length, 0); assert.equal(await p.getByRole('button', { name: 'Скасувати зміни стратегії' }).count(), 0);
  await send(d, 'Створи завдання Конкретна звичайна справа'); await p.locator('#ai-chat-apply-changes-btn').waitFor();
  const beforeYes = d.requests.length; await p.locator('#ai-prompt-input').fill('так'); await p.locator('#ai-generate-submit-btn').click();
  await p.waitForFunction(() => JSON.parse(localStorage.getItem('life_todo_tasks_v2')).length === 1); assert.equal(d.requests.length, beforeYes); assert.ok(!isPersonalStrategyReady(await profileOf(p))); assert.ok(await p.locator('#ps-ai-sheet').isVisible());
  results.push('Wishlist does not fill barriers/capacity or leak a prose plan; random yes and malicious autonomous response cannot authorize; ordinary task proposal yes applies during interview without completing it');
  for (let i = 0; i < 11; i++) await send(d, `Поясни звичайну тему ${i}`);
  const beforeResume = d.requests.length; await p.locator('#close-ai-sheet-btn').click(); await open(p);
  profile = await profileOf(p); assert.match(await p.locator('[role=log] .is-assistant').last().innerText(), new RegExp(profile.discovery.pendingQuestion.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))); assert.equal(d.requests.length, beforeResume);
  await screenshot(p, 'desktop-pending-resume.png');
  for (const topic of ['motivation', 'circumstances', 'barriers', 'capacity', 'attempts']) await send(d, discoveryStatements[topic]);
  profile = await profileOf(p); assert.equal(profile.discovery.phase, 'confirming'); assert.ok(profile.discovery.pendingSummary.text.includes('?')); assert.ok(profile.goals.every(goal => !goal.agreed));
  const expectedSummaryId = profile.discovery.pendingSummary.id; await screenshot(p, 'desktop-scoped-summary.png'); await send(d, 'Так.');
  assert.equal(d.requests.at(-1).discoveryConfirmationId, expectedSummaryId); assert.ok(isPersonalStrategyReady(await profileOf(p)));
  results.push('Pending question restored after 11 ordinary turns without request; six grounded topics persist; summary precedes planning; exact current summary ID permits standalone consent');
  await p.locator('#ai-prompt-input').fill('@analysis Поясни звичайну тему'); assert.match(await p.locator('.karkas-ai-command-chip').innerText(), /@analysis/);
  await p.locator('#ai-generate-submit-btn').click(); await p.waitForFunction(() => !document.getElementById('ai-request-cancel-btn')); assert.equal(d.requests.at(-1).intent, 'analysis'); assert.equal(await p.locator('.karkas-ai-command-chip').count(), 0);
  await send(d, 'Помилка мережі'); await p.locator('#ai-request-error').waitFor(); const failedId = d.requests.at(-1).turnId;
  await p.locator('#ai-retry-request-btn').click(); await p.locator('#ai-request-error').waitFor({ state: 'hidden' }); assert.equal(d.requests.at(-1).turnId, failedId); assert.equal(await p.locator('[role=log] .is-user').filter({ hasText: 'Помилка мережі' }).count(), 1);
  const lateRequest = p.waitForRequest(request => request.url().endsWith('/ai/assist') && request.postDataJSON()?.prompt === 'Затримана відповідь');
  await p.locator('#ai-prompt-input').fill('Затримана відповідь'); await p.locator('#ai-generate-submit-btn').click(); await lateRequest;
  await p.locator('#ai-request-cancel-btn').click(); await p.waitForTimeout(1000);
  assert.ok(!(await tasksOf(p)).some(task => task.title === 'Пізня дія не має з’явитися'));
  assert.equal(await p.locator('[role=log] .is-assistant').filter({ hasText: 'Пізня відповідь' }).count(), 0);
  await p.locator('#ai-prompt-input').fill('Збережена тестова чернетка'); const requestsBeforeReload = d.requests.length; await p.reload(); await open(p); assert.equal(await p.locator('#ai-prompt-input').inputValue(), 'Збережена тестова чернетка'); assert.equal(d.requests.length, requestsBeforeReload);
  assert.deepEqual(await p.evaluate(() => [localStorage.getItem('karkas.personal-strategy.v1:account%3Asynthetic-a'), localStorage.getItem('karkas.personal-strategy.v1:account%3Asynthetic-b')]), ['sentinel-account-a', 'sentinel-account-b']);
  assert.deepEqual(await p.evaluate(() => ['karkas_ai_draft', 'karkas_ai_chat_history', 'karkas_ai_chat_welcome'].map(prefix => localStorage.getItem(prefix + '.v2:account:guest'))), ['sentinel-account-named-guest-draft', 'sentinel-account-named-guest-history', 'sentinel-account-named-guest-welcome']);
  results.push('Manual command and one-turn reset; retry retains turn ID without duplicate user message; cancelled late autonomous response ignored; restored draft not sent; synthetic account sentinel keys preserved');
  await p.locator('#close-ai-sheet-btn').click(); const strategyButton = p.getByRole('button', { name: 'МОЯ СТРАТЕГІЯ', exact: true }); const dashboardButton = p.getByRole('button', { name: 'ДАШБОРД', exact: true });
  assert.equal(Math.round((await strategyButton.boundingBox()).height), Math.round((await dashboardButton.boundingBox()).height));
  await strategyButton.click(); await noOverflow(p, 'Desktop strategy no overflow'); await screenshot(p, 'strategy-desktop.png', true);
  assert.equal(d.errors.length, 0, d.errors.join('\n')); await d.context.close();
  const a = await setup({ width: 1440, height: 1000 }, confirmedProfile([{ ...discoveryGoal, taskIds: ['timed'] }]), [timedTask]);
  await open(a.page); await send(a, 'Адаптуй погоджений підхід'); await a.page.getByRole('button', { name: 'Скасувати зміни стратегії' }).waitFor();
  const changed = (await tasksOf(a.page))[0]; assert.equal(changed.title, 'Уточнені матеріали'); assert.equal(changed.timeSpentSeconds, 75); assert.equal(changed.currentStep, 1); assert.ok(changed.stepList.some(step => step.id === 'completed' && step.done && step.timeSpentSeconds === 50)); assert.ok(changed.stepList.some(step => step.id === 'measured' && step.timeSpentSeconds === 25));
  await a.page.getByRole('button', { name: 'Скасувати зміни стратегії' }).click(); await a.page.waitForFunction(() => JSON.parse(localStorage.getItem('life_todo_tasks_v2'))[0].title === 'Підготувати матеріали');
  assert.equal((await tasksOf(a.page))[0].timeSpentSeconds, 75); await screenshot(a.page, 'desktop-autonomous-undo.png');
  const strategyBeforeAnalysis = (await profileOf(a.page)).latestStrategy;
  await send(a, '@analysis Перевір старий план');
  assert.deepEqual((await profileOf(a.page)).latestStrategy, strategyBeforeAnalysis);
  assert.equal((await tasksOf(a.page)).length, 1); assert.ok(!(await tasksOf(a.page)).some(task => task.title === 'Аналіз не має створити завдання'));
  const beforeConcurrent = (await tasksOf(a.page))[0];
  const staleRequest = a.page.waitForRequest(request => request.url().endsWith('/ai/assist') && request.postDataJSON()?.prompt === 'Застаріле оновлення після правки');
  await a.page.locator('#ai-prompt-input').fill('Застаріле оновлення після правки'); await a.page.locator('#ai-generate-submit-btn').click(); await staleRequest;
  // Synthetic concurrent task edit through the actual task's UI handler while the response is delayed.
  await a.page.locator('#task-priority-btn-timed').dispatchEvent('click');
  await a.page.waitForFunction(priority => JSON.parse(localStorage.getItem('life_todo_tasks_v2'))[0].priority !== priority, beforeConcurrent.priority);
  await a.page.waitForFunction(() => !document.getElementById('ai-request-cancel-btn'));
  const afterConcurrent = (await tasksOf(a.page))[0];
  assert.equal(afterConcurrent.title, beforeConcurrent.title); assert.notEqual(afterConcurrent.priority, beforeConcurrent.priority); assert.equal(afterConcurrent.timeSpentSeconds, 75);
  await a.page.locator('#close-ai-sheet-btn').click();
  await a.page.locator('#task-edit-btn-timed').click();
  await a.page.getByRole('textbox', { name: 'Назва завдання', exact: true }).fill('Моя незбережена правка');
  await open(a.page); await send(a, 'Адаптуй погоджений підхід');
  await a.page.locator('#close-ai-sheet-btn').click();
  assert.equal(await a.page.getByRole('textbox', { name: 'Назва завдання', exact: true }).inputValue(), 'Моя незбережена правка');
  await a.page.getByRole('button', { name: 'Зберегти', exact: true }).click();
  await a.page.getByRole('alert').filter({ hasText: 'Це поле вже змінилося' }).waitFor();
  assert.equal((await tasksOf(a.page))[0].title, 'Уточнені матеріали');
  assert.equal(await a.page.getByRole('textbox', { name: 'Назва завдання', exact: true }).inputValue(), 'Моя незбережена правка');
  results.push('Concurrent AI task update preserves the open edit draft and rejects stale save while retaining newer task data');
  assert.equal(a.errors.length, 0, a.errors.join('\n')); await a.context.close();
  results.push('Confirmed autonomous update uses raw dispatch snapshot, retains measured/completed steps, current progress and 75 seconds; Undo preserves time; malicious ready @analysis cannot replace strategy/create tasks; delayed stale update cannot overwrite a concurrent synthetic priority edit');
  const m = await setup({ width: 375, height: 812 }); await open(m.page); assert.equal(m.requests.length, 0); assert.equal((await tasksOf(m.page)).length, 0);
  const mobileRect = await m.page.locator('#ps-ai-sheet').boundingBox(); assert.equal(Math.round(mobileRect.width), 375); assert.equal(Math.round(mobileRect.height), 812);
  await m.page.locator('#ai-command-menu-btn').click(); await screenshot(m.page, 'mobile-menu.png'); await noOverflow(m.page, 'Mobile chat no overflow'); await m.page.keyboard.press('Escape');
  await m.page.locator('#close-ai-sheet-btn').click(); await m.page.getByRole('button', { name: 'МОЯ СТРАТЕГІЯ', exact: true }).click(); await noOverflow(m.page, 'Mobile strategy no overflow'); await screenshot(m.page, 'strategy-mobile.png', true); assert.equal(m.errors.length, 0, m.errors.join('\n')); await m.context.close();
  results.push('Mobile 375x812 uses full screen; chat/strategy no horizontal overflow; separate browser contexts share no tasks/profile; no uncaught React errors');
  }
  if (process.env.QA_REMAINING !== 'history') {
  const damaged = await setup({ width: 1280, height: 850 }, undefined, [null, timedTask]);
  assert.equal(damaged.errors.length, 0, damaged.errors.join('\n'));
  assert.equal((await tasksOf(damaged.page)).length, 0);
  assert.ok(await damaged.page.evaluate(() => Object.keys(localStorage).filter(key => key.includes('recovery-backup')).some(key => {
    const raw = localStorage.getItem(key); return raw?.includes('"id":"timed"') && raw.includes('null');
  })), 'Original damaged workspace including its valid task remains in recovery backup');
  await damaged.context.close();
  }
  const english = await setup({ width: 1280, height: 850 }, undefined, [], { lang: 'en', deletedTasks: [{ ...timedTask, done: true, currentStep: 2, deletedAt: Date.now() }] });
  await english.page.getByRole('button', { name: /^HISTORY/ }).click();
  await english.page.getByTitle('Time spent on task', { exact: true }).waitFor();
  assert.equal(await english.page.getByTitle('Time spent on task', { exact: true }).innerText(), '1 m 15 s');
  assert.equal(english.errors.length, 0, english.errors.join('\n'));
  await english.context.close();
  results.push('Malformed task entries recovered with a backup without crashing; English history uses English recorded-time labels');
  fs.writeFileSync(path.join(out, 'qa-results.json'), JSON.stringify({ passed: true, url, syntheticOnly: true, realAiCalls: 0, scenarios: results, limitations: ['Actual authenticated A-to-B Firebase login transitions were source-reviewed, not exercised in the browser; account-key sentinels and independent browser contexts checked.', 'Provider responses were mocked using actual sanitizer and core fixtures, so this verifies client integration rather than live model quality.'], screenshots: fs.readdirSync(out).filter(name => name.endsWith('.png')) }, null, 2));
  console.log(`PASS ${results.length} isolated production browser QA groups`);
} catch (error) {
  fs.writeFileSync(path.join(out, 'qa-results.json'), JSON.stringify({ passed: false, url, scenariosCompleted: results, error: error.stack }, null, 2)); throw error;
} finally { await browser.close(); }
