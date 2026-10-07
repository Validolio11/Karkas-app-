import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { after, before, test } from "node:test";

let child: ChildProcess;
let baseUrl: string;

before(async () => {
  // Exercise the actual HTTP routes with the API key explicitly disabled.
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((done) => reservation.close(() => done()));
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval",
    "const {startServer}=await import('./server.ts'); await startServer({port:Number(process.env.PORT),host:'127.0.0.1'}); console.log('server running');"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), NODE_ENV: "production", GEMINI_API_KEY: "", KARKAS_SERVER_AUTOSTART: "false" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((done, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`Server did not start: ${output}`)), 30_000);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${output}`)); });
    child.stderr?.on("data", (chunk) => { output += chunk; });
    child.stdout?.on("data", (chunk) => {
      output += chunk;
      if (output.includes("server running")) { clearTimeout(timer); done(); }
    });
  });
});

after(async () => {
  if (child && child.exitCode === null) {
    const exited = once(child, "exit");
    child.kill();
    await exited;
  }
});

async function post(route: string, body: unknown) {
  const response = await fetch(`${baseUrl}/api/ai/${route}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}

test("invalid context is rejected as a client error on all AI routes", async () => {
  for (const [route, body] of [
    ["assist", { prompt: "Plan", currentTasks: {} }],
    ["assist", { prompt: "Plan", fullAppContext: { activeTasks: [null] } }],
    ["assist", { prompt: "Plan", stats: null }],
    ["assist", { prompt: "Plan", tabs: [{ name: "Missing ID" }] }],
    ["breakdown-task", { task: { title: "Plan" }, allTasks: "invalid" }],
    ["recommendations", { tasks: [null] }],
    ["recommendations", { periodMetrics: { totalCompleted: -1 } }],
    ["recommendations", { periodMetrics: { successRate: 101 } }],
  ] as const) {
    const result = await post(route, body);
    assert.equal(result.status, 400, JSON.stringify(body));
    assert.equal(typeof result.data.error, "string");
  }
});

test("empty prompts and non-string task titles are rejected", async () => {
  for (const body of [{ prompt: "   " }, { prompt: 123 }]) {
    assert.equal((await post("assist", body)).status, 400);
  }
  for (const title of ["   ", 123, {}, []]) {
    assert.equal((await post("breakdown-task", { task: { title } })).status, 400);
  }
});

test("empty productivity history reports zero tasks and grade C", async () => {
  const result = await post("recommendations", { lang: "en" });
  assert.equal(result.status, 200);
  assert.equal(result.data.source, "rule-engine");
  assert.equal(result.data.productivityGrade, "C");
  assert.match(result.data.periodRetrospective, /tracked 0 tasks/);
  assert.match(result.data.periodRetrospective, /Delivered 0 \(0%/);
});

test("explicit zero period metrics are preserved despite older completed tasks", async () => {
  const result = await post("recommendations", {
    lang: "en", tasks: [{ title: "Old result", done: true }],
    periodMetrics: { totalCreated: 0, totalCompleted: 0, totalDeleted: 0, successRate: 0 },
  });
  assert.equal(result.status, 200);
  assert.match(result.data.periodRetrospective, /tracked 0 tasks/);
  assert.equal(result.data.productivityGrade, "C");
});

test("grade requires both enough delivered tasks and the matching success rate", async () => {
  for (const [completed, successRate, grade] of [[5, 100, "C"], [6, 50, "B"], [10, 65, "A"],
    [15, 80, "A+"], [20, 90, "S"], [20, 49, "C"]] as const) {
    const result = await post("recommendations", {
      period: "THIS_MONTH", periodMetrics: { totalCompleted: completed, successRate },
    });
    assert.equal(result.status, 200);
    assert.equal(result.data.productivityGrade, grade, `${completed}/${successRate}`);
  }
});

test("offline assistance retains user categories and consistent substep counts", async () => {
  const result = await post("assist", { prompt: "План роботи", tabs: [{ id: "custom", name: "Моя категорія" }] });
  assert.equal(result.status, 200);
  assert.ok(result.data.tasks.length > 0);
  for (const task of result.data.tasks) {
    assert.equal(task.phase, "custom");
    assert.equal(task.steps, task.stepList.length);
    assert.ok(task.stepList.every((step: any) => typeof step.title === "string" && !step.done));
  }
});

test('offline timer requests never pretend to edit or generate replacement tasks', async () => {
  for (const action of ['chat', 'generate', 'analyze']) {
    const result = await post('assist', { prompt: 'Додай таймер на 25 хвилин для референсів', action, lang: 'uk' });
    assert.equal(result.status, 200);
    assert.equal(result.data.source, 'local-timer-fallback');
    assert.deepEqual(result.data.tasks, []);
    assert.deepEqual(result.data.taskUpdates, []);
    assert.deepEqual(result.data.taskDeletions, []);
    assert.match(result.data.reply, /недоступний/);
    assert.match(result.data.reply, /не змінено/);
  }
});

test("offline breakdown accepts the flat title request and repairs invalid priority", async () => {
  const result = await post("breakdown-task", { taskId: "task-1", title: "Finish draft", lang: "en", priority: 99 });
  assert.equal(result.status, 200);
  assert.equal(result.data.taskId, "task-1");
  assert.equal(result.data.steps, result.data.stepList.length);
  assert.equal(result.data.suggestedPriority, 2);
  assert.ok(result.data.stepList.every((step: any) => step.title.trim().length > 0));
});

test("desktop IPC uses the same validation and computes calendar labels for the current year", async (context) => {
  const savedAutostart = process.env.KARKAS_SERVER_AUTOSTART;
  const savedKey = process.env.GEMINI_API_KEY;
  process.env.KARKAS_SERVER_AUTOSTART = "false";
  process.env.GEMINI_API_KEY = "";
  try {
    const { invokeDesktopApi } = await import('../server');
    assert.equal((await invokeDesktopApi('assist', { prompt: 'Plan', currentTasks: {} })).status, 400);
    assert.equal((await invokeDesktopApi('recommendations', null)).status, 400);
    assert.equal((await invokeDesktopApi('missing')).status, 404);
    const greeting = await invokeDesktopApi('assist', { prompt: 'hello', action: 'chat', lang: 'en' });
    assert.equal(greeting.status, 200);
    assert.equal(greeting.body.source, 'greeting');
    context.mock.timers.enable({ apis: ['Date'], now: new Date('2028-07-01T12:00:00Z').getTime() });
    const thisYear = await invokeDesktopApi('recommendations', { period: 'THIS_YEAR', lang: 'en' });
    const lastYear = await invokeDesktopApi('recommendations', { period: 'LAST_YEAR', lang: 'en' });
    assert.match(thisYear.body.periodRetrospective, /This Year \(2028\)/);
    assert.match(lastYear.body.periodRetrospective, /Last Year \(2027\)/);
  } finally {
    context.mock.timers.reset();
    if (savedAutostart === undefined) delete process.env.KARKAS_SERVER_AUTOSTART;
    else process.env.KARKAS_SERVER_AUTOSTART = savedAutostart;
    if (savedKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = savedKey;
  }
});
