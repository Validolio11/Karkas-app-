import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

const originalFetch = globalThis.fetch;
const originalAutostart = process.env.KARKAS_SERVER_AUTOSTART;
const originalKey = process.env.GEMINI_API_KEY;
let invokeDesktopApi: typeof import('../server.ts').invokeDesktopApi;
let answer: Record<string, unknown>;
const providerCalls: any[] = [];

before(async () => {
  process.env.KARKAS_SERVER_AUTOSTART = 'false';
  process.env.GEMINI_API_KEY = '';
  // Intercept the real SDK transport. Every possible provider request stays local.
  globalThis.fetch = (async (url: any, options: RequestInit) => {
    assert.match(String(url), /^https:\/\/generativelanguage\.googleapis\.com\//);
    providerCalls.push(JSON.parse(String(options.body)));
    return new Response(JSON.stringify({ candidates: [{ content: {
      role: 'model', parts: [{ text: JSON.stringify(answer) }],
    }, finishReason: 'STOP' }] }), { headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  ({ invokeDesktopApi } = await import('../server.ts'));
});

after(() => {
  globalThis.fetch = originalFetch;
  if (originalAutostart === undefined) delete process.env.KARKAS_SERVER_AUTOSTART;
  else process.env.KARKAS_SERVER_AUTOSTART = originalAutostart;
  if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalKey;
});

const now = Date.parse('2026-10-09T19:30:00Z');
const DAY = 86_400_000;
const clock = { now: new Date(now).toISOString(), timeZone: 'UTC' };
function workspace() {
  const completed = Array.from({ length: 6 }, (_, index) => ({
    id: `done-${index}`, title: `Completed ${index}`, phase: 'focus', priority: 2, done: true,
    createdAt: now - (index * 4 + 1) * DAY,
    startedAt: now - (index * 4 + 1) * DAY - 10 * 60_000,
    completedAt: now - (index * 4 + 1) * DAY,
    ...(index < 5 ? { timeSpentSeconds: 600 + index * 300 } : {}),
  }));
  const active = Array.from({ length: 4 }, (_, index) => ({
    id: `active-${index}`, title: `Active ${index}`, phase: 'focus', priority: 1, done: false,
    createdAt: now - (10 - index) * DAY,
    ...(index === 0 ? { plannedDurationSeconds: 600, timeSpentSeconds: 1200,
      stepList: [{ id: 'measured-step', title: 'Research', done: false,
        estimatedDurationSeconds: 300, timeSpentSeconds: 900 }] } : {}),
  }));
  const due = { id: 'due', title: 'Scheduled lesson', phase: 'study', priority: 2, done: false,
    createdAt: now - DAY, scheduledFor: now - 10 * 60_000 };
  const future = { id: 'future', title: 'Future template', phase: 'study', priority: 1,
    done: false, scheduledPending: true, createdAt: now, scheduledFor: now + DAY };
  const deleted = [
    { id: 'accident', title: 'Accidental task', phase: 'focus', priority: 1, done: true,
      createdAt: now - DAY, completedAt: now - DAY, deletedAt: now,
      timeSpentSeconds: 999_999, deletionReason: 'accidental' },
    { id: 'cancelled', title: 'Cancelled task', phase: 'focus', priority: 1, done: false,
      createdAt: now - DAY, deletedAt: now, timeSpentSeconds: 999_999, deletionReason: 'cancelled' },
  ];
  return { active, completed, due, future, deleted };
}
function assertEvidence(insights: any) {
  assert.equal(insights.coverage.completed, 6);
  assert.equal(insights.coverage.measured, 5);
  assert.equal(insights.coverage.excludedAccidental, 1);
  assert.equal(insights.workload.active, 5);
  assert.equal(insights.workload.urgent, 4);
  assert.equal(insights.workload.suggestedActiveLimit, 2);
  assert.deepEqual(insights.prioritySuggestions.map((item: any) => item.taskId), ['active-1', 'active-2', 'active-3']);
  assert.ok(insights.prioritySuggestions.every((item: any) => item.suggestedPriority === 2));
  const stage = insights.bottlenecks.find((item: any) => item.stepId === 'measured-step');
  assert.equal(stage.recordedSeconds, 900);
  assert.equal(stage.estimatedSeconds, 300);
  const forecast = insights.forecasts.find((item: any) => item.taskId === 'active-1');
  assert.equal(forecast.sampleCount, 5);
  assert.equal(forecast.measurementRatio, 5 / 6);
  assert.ok(forecast.upperSeconds < 999_999);
  assert.equal(insights.workingPattern.timeZone, 'UTC');
  assert.deepEqual(insights.reminderCandidates.map((item: any) => item.taskId), ['due']);
}
function requestBody(action = 'analyze') {
  const w = workspace();
  return { prompt: 'Analyze workload and suggest improvements', action, lang: 'en', clientClock: clock,
    customApiKey: 'test-only-fake-key',
    workInsights: { coverage: { completed: 999 }, prioritySuggestions: [{ taskId: 'future' }] },
    fullAppContext: { activeTasks: [...w.active, w.due, w.future], completedTasks: w.completed,
      deletedTasks: w.deleted, workInsights: { workload: { active: 999 } },
      stats: { completed: 999, active: 999 }, tabs: [{ id: 'focus', name: 'Focus' }] } };
}
function requestText(body: any): string {
  return body.contents.flatMap((content: any) => content.parts.map((part: any) => part.text || '')).join('\n');
}

test('chat sends recomputed evidence and preserves priorities for an analysis-only request', async () => {
  providerCalls.length = 0;
  answer = { reply: 'Review the urgent queue.', tasks: [], taskUpdates: [], taskDeletions: [] };
  const input = requestBody('chat');
  const original = structuredClone(input);
  const result = await invokeDesktopApi('assist', input);
  assert.equal(result.status, 200);
  assert.equal(providerCalls.length, 1);
  const prompt = requestText(providerCalls[0]);
  const context = JSON.parse(prompt.split('WORKSPACE CONTEXT:\n')[1].split('\n\nINSTRUCTIONS:')[0]);
  assertEvidence(context.workInsights);
  assertEvidence(result.body.workInsights);
  assert.match(prompt, /analysis request or detected overload alone does not authorize any task mutation/);
  assert.match(prompt, /proposals requiring the Apply button/);
  assert.match(prompt, /application controls reminders and must remain running/);
  assert.deepEqual(result.body.taskUpdates, []);
  assert.deepEqual(input, original);
});

test('planning receives measurements rather than forged summaries and returns the same evidence', async () => {
  providerCalls.length = 0;
  answer = { summary: 'Measured steps need review.', tasks: [], taskUpdates: [], taskDeletions: [] };
  const result = await invokeDesktopApi('assist', requestBody('analyze'));
  assert.equal(result.status, 200);
  assert.equal(providerCalls.length, 1);
  const context = JSON.parse(requestText(providerCalls[0]).split('WORKSPACE REAL-TIME CONTEXT:\n')[1]);
  assertEvidence(context.workInsights);
  assertEvidence(result.body.workInsights);
  assert.match(providerCalls[0].systemInstruction.parts[0].text, /not promised calendar deadlines/);
  assert.deepEqual(result.body.taskUpdates, []);
});

test('recommendations retain all-history evidence separately from selected-period statistics', async () => {
  providerCalls.length = 0;
  answer = { focusAdvice: 'Keep one urgent item.', suggestedTasks: [] };
  const w = workspace();
  const result = await invokeDesktopApi('recommendations', { lang: 'en', period: 'LAST_YEAR', clientClock: clock,
    customApiKey: 'test-only-fake-key', tasks: [...w.active, w.due, w.future, ...w.completed],
    deletedTasks: w.deleted, workInsights: { coverage: { completed: 999 } } });
  assert.equal(result.status, 200);
  assert.equal(providerCalls.length, 1);
  const prompt = requestText(providerCalls[0]);
  const serialized = prompt.split('- Adaptive work insights (all available history/current queue; not selected-period totals): ')[1].split('\n')[0];
  assertEvidence(JSON.parse(serialized));
  assertEvidence(result.body.workInsights);
  assert.match(providerCalls[0].systemInstruction.parts[0].text, /do not attribute all-history readings to the selected period/);
  assert.match(prompt, /Completed Tasks \(0; first 15 shown\): \[\]/);
});

test('offline analysis and recommendations expose local evidence with no provider calls', async () => {
  providerCalls.length = 0;
  const input = requestBody();
  delete (input as any).customApiKey;
  const analysis = await invokeDesktopApi('assist', input);
  assert.equal(analysis.status, 200);
  assert.equal(analysis.body.source, 'life-rule-engine');
  assertEvidence(analysis.body.workInsights);
  const w = workspace();
  const recommendations = await invokeDesktopApi('recommendations', { lang: 'en', clientClock: clock,
    tasks: [...w.active, w.due, w.future, ...w.completed], deletedTasks: w.deleted });
  assert.equal(recommendations.status, 200);
  assert.equal(recommendations.body.source, 'rule-engine');
  assertEvidence(recommendations.body.workInsights);
  const greeting = await invokeDesktopApi('assist', { ...input, prompt: 'hello', action: 'chat' });
  assert.equal(greeting.body.source, 'greeting');
  assert.equal(providerCalls.length, 0);
});
