import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Ivan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser = await chromium.launch({headless:true,channel:'chrome'});
try {
  const context = await browser.newContext({viewport:{width:1280,height:900}});
  await context.route(request => new URL(request).origin !== 'http://127.0.0.1:54837', route => route.abort());
  await context.route('**/api/**', route => route.fulfill({json:{ok:true}}));
  await context.addInitScript(() => {
    const task={id:'retained',title:'Збережене завдання',phase:'work',priority:2,steps:0,currentStep:0,done:false,pinned:false,createdAt:0};
    const workspace={tasks:[task],tabs:[{id:'work',name:'Робота'}],deletedTasks:[],settings:{lang:'uk',soundEnabled:false,fireEnabled:false,aiIconVariant:'quantum'}};
    localStorage.setItem('life_todo_tasks_v2','[null]');
    localStorage.setItem('life_todo_tabs_v2','[]');
    localStorage.setItem('karkas_deleted_tasks_v2','[]');
    localStorage.setItem('karkas_workspace:guest:recovery-backup',JSON.stringify({workspace,pendingSync:{workspace:{tasks:[null]}}}));
  });
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:54837');
  const recovery=page.getByRole('button',{name:'Відновити збережений простір',exact:true});
  await recovery.waitFor();
  await page.locator('#top-quick-add-btn').click();
  assert.equal(await page.locator('#quick-add-task-form').count(),0,'Damaged workspace cannot accept unsaved changes before recovery');
  assert.equal(await page.evaluate(()=>localStorage.getItem('life_todo_tasks_v2')),'[null]');
  await recovery.click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('life_todo_tasks_v2'))[0]?.id==='retained');
  const record=await page.evaluate(()=>JSON.parse(localStorage.getItem('karkas_workspace:guest')));
  assert.equal(record.workspace.tasks[0].title,'Збережене завдання');
  assert.equal(record.pendingSync,undefined);assert.equal(record.inFlightSync,undefined);assert.equal(record.base,null);
  assert.equal(await page.evaluate(()=>localStorage.getItem('life_todo_tasks_v2:recovery-backup')),'[null]');
  assert.equal(errors.length,0,errors.join('\n'));
  await page.screenshot({path:'visual-qa/release-1.3.4/workspace-recovered.png'});
  fs.writeFileSync('visual-qa/release-1.3.4/recovery-results.json',JSON.stringify({passed:true,syntheticOnly:true,obsoleteSyncIgnored:true,sourceRetained:true},null,2));
  console.log('PASS damaged workspace blocks edits; retained valid workspace restores without obsolete sync journal');
}finally{await browser.close();}
