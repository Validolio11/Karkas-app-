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

test("period results come from task dates rather than contaminated client aggregates", async () => {
  const previousMonth = new Date();
  previousMonth.setDate(0);
  const result = await post("recommendations", {
    period: "THIS_MONTH", lang: "en",
    tasks: [{ title: "Old result", done: true, createdAt: previousMonth.getTime(), completedAt: previousMonth.getTime() }],
    periodMetrics: { totalCreated: 100, totalCompleted: 100, totalDeleted: 0, successRate: 100 },
  });
  assert.equal(result.status, 200);
  assert.match(result.data.periodRetrospective, /tracked 0 tasks/);
  assert.equal(result.data.productivityGrade, "C");
});

test("grade requires both enough delivered tasks and the matching success rate", async () => {
  const timestamp = Date.now();
  for (const [completed, cancelled, successRate, grade] of [[5, 0, 100, "C"], [6, 6, 50, "B"], [10, 5, 67, "A"],
    [15, 3, 83, "A+"], [20, 2, 91, "S"], [20, 3, 87, "A+"], [20, 21, 49, "C"]] as const) {
    const result = await post("recommendations", {
      period: "THIS_MONTH", lang: "en",
      tasks: Array.from({ length: completed }, (_, index) => ({ title: `Delivered ${index}`, done: true, createdAt: timestamp, completedAt: timestamp })),
      deletedTasks: Array.from({ length: cancelled }, (_, index) => ({ title: `Cancelled ${index}`, done: false, deletionReason: "cancelled", createdAt: timestamp, deletedAt: timestamp })),
      periodMetrics: { totalCompleted: 1000, successRate: 100 },
    });
    assert.equal(result.status, 200);
    assert.equal(result.data.productivityGrade, grade, `${completed}/${successRate}`);
    assert.match(result.data.periodRetrospective, new RegExp(`Delivered ${completed} \\(${successRate}%`));
  }
});

test("period recommendations separate completed archives and cancellations while excluding accidental and unclassified work", async () => {
  const timestamp = Date.now();
  const previousMonth = new Date(timestamp);
  previousMonth.setDate(0);
  const older = previousMonth.getTime();
  const archived = (title: string, done: boolean, deletionReason?: string, dates: any = {}) => ({
    title, phase: "focus", priority: 2, done, createdAt: timestamp, deletedAt: timestamp, deletionReason, ...dates,
  });
  const result = await post("recommendations", {
    period: "THIS_MONTH", lang: "en",
    tasks: [
      { title: "Active", done: false, createdAt: timestamp },
      { title: "Delivered", done: true, createdAt: timestamp, completedAt: timestamp },
      archived("Accident in live input", true, "accidental"),
      archived("Unknown archive in live input", false),
    ],
    deletedTasks: [
      archived("Legacy completed archive", true),
      archived("Completed archive with cancellation label", true, "cancelled"),
      archived("Completed now after older creation", true, undefined, { createdAt: older, completedAt: timestamp }),
      archived("Explicit cancellation", false, "cancelled"),
      archived("Accidental completed entry", true, "accidental"),
      archived("Accidental unfinished entry", false, "accidental"),
      archived("Unclassified unfinished archive", false),
      archived("Earlier cancellation", false, "cancelled", { createdAt: older, deletedAt: older }),
      archived("Earlier completion archived now", true, undefined, { createdAt: older, completedAt: older }),
    ],
    periodMetrics: { totalCreated: 500, totalCompleted: 400, totalDeleted: 100, totalActive: 300, successRate: 1 },
  });
  assert.equal(result.status, 200);
  assert.match(result.data.periodRetrospective, /tracked 5 tasks/);
  assert.match(result.data.periodRetrospective, /Delivered 4 \(80%/);
  assert.match(result.data.dropoffAnalysis, /^1 unfinished tasks were deliberately cancelled/);
  assert.equal(result.data.productivityGrade, "C");
  assert.doesNotMatch(JSON.stringify(result.data), /\bAccident|Unknown archive|Unclassified|Earlier cancellation/);
});

test("offline analysis counts completed history and explicit cancellations without trusting client statistics", async () => {
  const timestamp = Date.now();
  const result = await post("assist", {
    prompt: "Audit my workflow", action: "analyze", lang: "en",
    fullAppContext: {
      activeTasks: [
        { title: "Active", done: false },
        { title: "Accidental live entry", done: false, deletionReason: "accidental" },
        { title: "Archived unfinished entry", done: false, deletedAt: timestamp },
      ],
      completedTasks: [{ title: "Delivered", done: true }],
      deletedTasks: [
        { title: "Completed history", done: true, deletedAt: timestamp },
        { title: "Cancelled history", done: false, deletionReason: "cancelled", deletedAt: timestamp },
        { title: "Accidental history", done: true, deletionReason: "accidental", deletedAt: timestamp },
        { title: "Unclassified history", done: false, deletedAt: timestamp },
      ],
      stats: { total: 999, completed: 999, percent: 100 },
      adaptiveProfile: { trackedTasks: 999, completedTasks: 999, activeLoad: 999 },
    },
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.analyzedContext, { activeCount: 1, completedCount: 2, tabsCount: 0 });
  assert.match(result.data.summary, /1 active tasks, 2 completed/);
  assert.match(result.data.summary, /Deliberately cancelled: 1, counted separately/);
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
    assert.equal(result.status, 503);
    assert.equal(result.data.source, 'ai-error');
    assert.equal(result.data.code, 'MISSING_API_KEY');
    assert.deepEqual(result.data.tasks, []);
    assert.deepEqual(result.data.taskUpdates, []);
    assert.deepEqual(result.data.taskDeletions, []);
    assert.match(result.data.error, /налаштуваннях AI/);
    assert.match(result.data.error, /не застосовано/);
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

test('malformed scheduling clock is rejected before provider access', async () => {
  for (const clientClock of [null, {}, { now: 'tomorrow', timeZone: 'Europe/Kyiv' }, { now: '2026-10-09T12:00:00Z', timeZone: 'Unknown/Zone' }]) {
    assert.equal((await post('assist', { prompt: 'Schedule typing tomorrow', clientClock })).status, 400);
  }
});
test('offline scheduling never silently creates immediate tasks instead of tomorrow', async () => {
  const response = await post('assist', { prompt: 'Schedule typing tomorrow at 20:00', action: 'generate', clientClock: { now: '2026-10-09T12:00:00Z', timeZone: 'Europe/Kyiv' } });
  assert.equal(response.status, 503);
  assert.deepEqual(response.data.tasks, []);
});
test('pending plans are excluded from offline productivity counts', async () => {
  const response = await post('recommendations', { lang: 'en', tasks: [{ id: 'future', title: 'Typing', done: false, scheduledPending: true, createdAt: Date.now() }] });
  assert.equal(response.status, 200);
  assert.match(response.data.periodRetrospective, /tracked 0 tasks/);
});
