import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { applyStrategyResponse, createPersonalStrategyProfile } from '../../src/utils/personalStrategy.ts';
import { discoveryGoal, discoveryStatements } from '../../src/utils/strategyDiscovery.testHelpers.ts';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Ivan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const question = 'Коли ви востаннє відклали важливу справу, що відбувалося перед тим, як ви переключилися на щось інше?';
const profile = applyStrategyResponse(createPersonalStrategyProfile(), { memoryPatch: { goals: [discoveryGoal], discovery: { answers: [{ topic: 'direction', quote: discoveryStatements.direction, status: 'answered' }], selectedGoalIds: ['g'], question: { topic: 'barriers', text: question } } } }, discoveryStatements.direction, 'capture-direction');
const history = [{ id: 'reply-capture-direction', role: 'assistant', content: question }, ...Array.from({ length: 22 }, (_, i) => ({ id: `ordinary-${i}`, role: i % 2 ? 'assistant' : 'user', content: i % 2 ? 'Допоможу з конкретним запитом.' : `Поясни звичайну тему ${Math.floor(i / 2)}` }))];
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(({ profile, history }) => {
    localStorage.setItem('todo_app_lang', 'uk'); localStorage.setItem('life_todo_tabs_v2', '[{"id":"work","name":"Робота"}]');
    localStorage.setItem('life_todo_tasks_v2', '[]'); localStorage.setItem('karkas.personal-strategy.v1:guest', JSON.stringify(profile));
    localStorage.setItem('karkas_ai_chat_history.v2:guest', JSON.stringify(history));
  }, { profile, history });
  const page = await context.newPage(); let requests = 0;
  await page.route('**/api/**', route => { requests++; return route.fulfill({ json: { ok: true } }); });
  await page.goto('http://127.0.0.1:54837'); await page.locator('#bottom-summon-ai-btn').click();
  await page.waitForFunction(() => {
    const el = document.getElementById('ps-ai-sheet'); if (!el) return false;
    const transform = getComputedStyle(el).transform; return transform === 'none' || Math.abs(new DOMMatrixReadOnly(transform).m42) < 0.5;
  });
  assert.match(await page.locator('[role=log] .is-assistant').last().innerText(), /Коли ви востаннє відклали/);
  assert.equal(requests, 0);
  await page.screenshot({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), 'desktop-pending-resume.png') });
  console.log('PASS pending-resume screenshot captured after opening transition, no AI requests');
} finally { await browser.close(); }
