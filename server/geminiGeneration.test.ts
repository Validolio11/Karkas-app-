import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { GoogleGenAI } from '@google/genai';
import { AIRequestError, aiRequestFailure, classifyAIRequestError, createGeminiClient, generateGeminiWithFallback, quotaInfoFromError, resetModelHealthForTests, thinkingConfigForModel } from './geminiGeneration.ts';
import { confirmedProfile, discoveryGoal, understandingProfile } from '../src/utils/strategyDiscovery.testHelpers';
import { continueStrategyDiscovery } from '../src/utils/strategyDiscovery';
import { applyStrategyActions } from '../src/utils/strategyActions';

const originalFetch = globalThis.fetch;
const originalAutostart = process.env.KARKAS_SERVER_AUTOSTART;
const originalKey = process.env.GEMINI_API_KEY;
let invokeDesktopApi: typeof import('../server.ts').invokeDesktopApi;
let provider: typeof fetch;
const calls: { model: string; body: any; signal?: AbortSignal }[] = [];

before(async () => {
  process.env.KARKAS_SERVER_AUTOSTART = 'false';
  process.env.GEMINI_API_KEY = '';
  // Keep the real SDK: intercept only its HTTP transport, so schema serialization,
  // native error shapes and response.text conversion are exercised without Google.
  globalThis.fetch = ((url: any, options: RequestInit) => provider(url, options)) as typeof fetch;
  ({ invokeDesktopApi } = await import('../server.ts'));
});

after(() => {
  globalThis.fetch = originalFetch;
  if (originalAutostart === undefined) delete process.env.KARKAS_SERVER_AUTOSTART;
  else process.env.KARKAS_SERVER_AUTOSTART = originalAutostart;
  if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalKey;
});

function mockProvider(respond: (model: string, body: any, options: RequestInit) => Response | Promise<Response>) {
  calls.length = 0;
  // Quota cooldowns and thinking support are remembered per client; isolate tests.
  resetModelHealthForTests();
  provider = (async (url: any, options: RequestInit) => {
    assert.match(String(url), /^https:\/\/generativelanguage\.googleapis\.com\//);
    const model = /models\/([^:]+):generateContent/.exec(String(url))?.[1];
    assert.ok(model);
    const body = JSON.parse(String(options.body));
    calls.push({ model, body, signal: options.signal ?? undefined });
    const response = await respond(model, body, options);
    // task_command uses function calling: the same proposal arrives as reply text plus one call per operation.
    const proposal = (response as any)?.proposal;
    return body.tools && proposal ? toolCallResponse(proposal) : response;
  }) as typeof fetch;
}

const json = (data: any, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const success = (proposal: any) => Object.assign(json({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(proposal) }] }, finishReason: 'STOP' }] }), { proposal });
const TOOL_FOR: Record<string, string> = { tasks: 'propose_create_task', taskUpdates: 'propose_update_task', taskDeletions: 'propose_delete_task', tabs: 'propose_create_tab' };
/** The function-calling form of a JSON proposal: reply text, then one functionCall part per operation. */
function toolCallResponse(proposal: any, usageMetadata?: any) {
  const parts: any[] = typeof proposal.reply === 'string' && proposal.reply ? [{ text: proposal.reply }] : [];
  for (const [field, name] of Object.entries(TOOL_FOR)) {
    for (const args of Array.isArray(proposal[field]) ? proposal[field] : []) parts.push({ functionCall: { name, args } });
  }
  return json({ candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }], ...(usageMetadata ? { usageMetadata } : {}) });
}
/** Exercise the forced-JSON path (the KARKAS_AI_TOOLS kill switch) inside one test. */
async function withToolsOff<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.KARKAS_AI_TOOLS;
  process.env.KARKAS_AI_TOOLS = 'off';
  try { return await run(); } finally {
    if (previous === undefined) delete process.env.KARKAS_AI_TOOLS;
    else process.env.KARKAS_AI_TOOLS = previous;
  }
}
const rejected = (status: number, providerStatus: string, message = 'private-test-key provider-internal-data') => json({ error: { code: status, status: providerStatus, message } }, status);
const chat = (overrides: any = {}) => invokeDesktopApi('assist', {
  prompt: 'Додай таймер на 25 хвилин до завдання', action: 'chat', lang: 'uk', customApiKey: 'test-only-fake-key',
  selectedModel: 'gemini-3.1-flash-lite', ...overrides,
});

test('unified chat transmits persistent memory and intent without private action journals', async () => {
  mockProvider((_model, body) => {
    const prompt = body.contents.flatMap((content: any) => content.parts.map((part: any) => part.text ?? '')).join('\n');
    assert.match(prompt, /PERSONAL_DISCOVERY/);
    assert.match(prompt, /I want time for family/);
    assert.doesNotMatch(prompt, /PRIVATE-JOURNAL-TASK|PRIVATE-DEDUP-ID|processedTurnIds|"fingerprint"/);
    assert.match(prompt, /pendingQuestion/);
    assert.match(body.systemInstruction.parts[0].text, /ask what happened before suggesting fixes/);
    assert.equal(body.generationConfig.responseSchema.properties.tasks, undefined);
    assert.ok(body.generationConfig.responseSchema.properties.memoryPatch.properties.discovery);
    return success({ reply: 'What would reaching this goal change for you?', strategy: { status: 'getting_to_know', question: 'Why does it matter?' } });
  });
  const result = await chat({ prompt: 'Хочу більше часу для сім’ї', intent: 'plan', discoveryMode: true, strategyContext: { onboardingStatus: 'in_progress', goals: [], facts: [{ id: 'f', text: 'I want time for family', source: 'user' }], discovery: { version: 1, processedTurnIds: ['PRIVATE-DEDUP-ID'] }, actionHistory: [{ task: 'PRIVATE-JOURNAL-TASK' }] }, currentTasks: [{ id: 't', title: 'Study', done: false }] });
  assert.equal(result.status, 200);
  assert.equal(result.body.strategy.status, 'getting_to_know');
  assert.equal(calls.length, 1);
});
test('strategy updates attach the original task snapshot and reject protected autonomous fields', async () => {
  const existing = { id: 't', title: 'Study', done: false, timeSpentSeconds: 600 };
  const ready = confirmedProfile([{ ...discoveryGoal, taskIds: ['t'] }]);
  mockProvider(() => success({ reply: 'I reduced the next step.', strategy: { status: 'ready', actions: [{ id: 'a', goalId: 'g', type: 'update', taskId: 't', reason: 'Reduce friction', changes: { title: 'Read one page' } }] } }));
  const result = await chat({ prompt: 'Підготуй наступний крок', intent: 'plan', discoveryMode: true, currentTasks: [existing], strategyContext: ready });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.strategy.actions[0].expectedTask, existing);
  mockProvider(() => success({ reply: 'Done.', strategy: { actions: [{ id: 'a', goalId: 'g', type: 'update', taskId: 't', reason: 'Done', changes: { done: true } }] } }));
  const refused = await chat({ prompt: 'Підготуй наступний крок', intent: 'plan', discoveryMode: true, currentTasks: [existing], strategyContext: ready });
  assert.equal(refused.status, 502);
  assert.equal(refused.body.code, 'INVALID_AI_RESPONSE');
});

test('server rejects an oversized autonomous change set rather than returning partial task mutations', async () => {
  mockProvider(() => success({ reply: 'Four new actions', strategy: { status: 'ready', actions: Array.from({ length: 4 }, (_, index) => ({
    id: `new-${index}`, goalId: 'g', type: 'create', reason: 'Next action', changes: { title: `Next ${index}`, phase: 'work' },
  })) } }));
  const result = await chat({ prompt: 'Підбери наступні дії для моєї цілі', discoveryMode: true, strategyContext: confirmedProfile(), tabs: ['work'] });
  assert.equal(result.status, 502);
  assert.equal(result.body.code, 'INVALID_AI_RESPONSE');
  assert.deepEqual(result.body.tasks, []);
  assert.deepEqual(result.body.taskUpdates, []);
  assert.equal(calls.length, 3);
});
test('analysis intent never delivers task mutations even if a provider proposes them', async () => {
  mockProvider(() => success({ reply: 'Review the measurements.', tasks: [{ title: 'New', phase: 'work', priority: 2, steps: 0 }], strategy: {
    actions: [{ id: 'a', goalId: 'g', type: 'create', reason: 'Next', changes: { title: 'New', phase: 'work' } }], narrative: 'Review the measurements.',
  } }));
  const result = await chat({ prompt: 'Проаналізуй поточні завдання', intent: 'analysis', strategyContext: { goals: [] } });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.tasks, []);
  assert.equal(result.body.strategy, undefined);
});

test('wishlists and early @plan discard provider prose, legacy arrays and autonomous actions in one call', async () => {
  for (const [prompt, intent] of [['Хочу портфоліо, фриланс, англійську та швидкий друк', 'auto'], ['@plan Зроби план для мого життя', 'plan']] as const) {
    mockProvider((_model, body) => {
      assert.equal(body.generationConfig.responseSchema.properties.tasks, undefined);
      assert.match(body.systemInstruction.parts[0].text, /priority over generic task instructions/);
      return success({ reply: 'FORBIDDEN-PLAN tomorrow 20 minutes', tasks: [{ title: 'FORBIDDEN-TASK' }], taskUpdates: [{ id: 'unknown', timerAction: 'start' }], taskDeletions: [{ id: 't' }], strategy: { status: 'ready', narrative: 'FORBIDDEN-NARRATIVE', nextAction: 'FORBIDDEN-NEXT', actions: [{ changes: { done: true } }], memoryPatch: { onboardingStatus: 'complete', discovery: { question: { topic: 'capacity', text: 'Чи готовий ти завтра почати 20-хвилинний блок?' } } } } });
    });
    const result = await chat({ prompt, intent, discoveryMode: true, turnId: `early-${intent}`, strategyContext: { onboardingStatus: 'complete', goals: [{ ...discoveryGoal, agreed: true }] } });
    assert.equal(result.status, 200);
    assert.equal(calls.length, 1);
    assert.doesNotMatch(JSON.stringify(result.body), /FORBIDDEN/);
    assert.deepEqual(result.body.tasks, []);
    assert.deepEqual(result.body.taskUpdates, []);
    assert.deepEqual(result.body.taskDeletions, []);
    assert.deepEqual(result.body.strategy.actions, []);
    assert.equal(result.body.strategy.memoryPatch.onboardingStatus, undefined);
    assert.equal((result.body.reply.match(/\?/g) || []).length, 1);
  }
});

test('exact visible summary ID and standalone consent are required before a personal plan can act', async () => {
  const profile = understandingProfile([{ ...discoveryGoal, taskIds: ['t'] }]);
  const summaryId = profile.discovery!.pendingSummary!.id;
  for (const [prompt, id, allowed] of [['Так', undefined, false], ['Так', 'stale-summary', false], ['Так, але мета інша', summaryId, false], ['Так.', summaryId, true]] as const) {
    mockProvider(() => success({ reply: 'FORBIDDEN-UNTIL-CONSENT', strategy: { status: 'ready', nextAction: 'Read one page', actions: [{ id: 'a', goalId: 'g', type: 'update', taskId: 't', reason: 'A manageable scope', changes: { title: 'Read one page' } }] } }));
    const result = await chat({ prompt, discoveryConfirmationId: id, turnId: `consent-${prompt}-${id}`, currentTasks: [{ id: 't', title: 'Study', phase: 'work', done: false }], strategyContext: profile });
    assert.equal(result.status, 200);
    assert.equal(calls.length, 1);
    // Without valid consent the request may become a read-only general chat; it must never carry plan actions.
    assert.equal(result.body.strategy?.actions?.length ?? 0, allowed ? 1 : 0);
    if (!allowed && result.body.strategy) assert.doesNotMatch(result.body.reply, /FORBIDDEN/);
  }
  mockProvider(() => { throw new Error('Validation must happen before transport'); });
  const invalid = await chat({ discoveryConfirmationId: 10 });
  assert.equal(invalid.status, 400);
  assert.equal(calls.length, 0);
});

test('discovery prompts retain the pending question beyond ten messages and never send journals', async () => {
  const profile = continueStrategyDiscovery(confirmedProfile());
  profile.discovery!.pendingQuestion!.text = 'Що відбулося перед останнім відволіканням UNIQUE-PENDING-QUESTION?';
  profile.actionHistory = [{ after: { title: 'PRIVATE-JOURNAL' } }] as any;
  mockProvider((_model, body) => {
    const prompt = body.contents.flatMap((content: any) => content.parts.map((part: any) => part.text || '')).join('\n');
    assert.match(prompt, /UNIQUE-PENDING-QUESTION/);
    assert.doesNotMatch(prompt, /PRIVATE-JOURNAL|OLD-RECENT-MESSAGE/);
    return success({ memoryPatch: { discovery: {} } });
  });
  const result = await chat({ prompt: 'Не знаю', discoveryMode: true, strategyContext: profile, turnId: 'resume', conversation: [{ role: 'assistant', content: 'OLD-RECENT-MESSAGE' }, ...Array.from({ length: 10 }, () => ({ role: 'user', content: 'ordinary' }))] });
  assert.equal(result.status, 200);
  assert.match(result.body.strategy.question, /в ту мить/);
  assert.equal(calls.length, 1);
});

test('concrete steps and polite timer requests preserve their operation without starting an interview', async () => {
  for (const [prompt, intent, update] of [['Study', 'steps', { id: 't', stepList: [{ title: 'Read' }] }], ['Можеш запустити таймер Study?', 'auto', { id: 't', timerAction: 'start' }]] as const) {
    mockProvider(() => success({ reply: 'Proposal', tasks: [{ title: 'Unrequested duplicate', phase: 'work', priority: 2, steps: 0 }], taskUpdates: [update], strategy: { status: 'ready', narrative: 'Unrequested strategy' } }));
    const result = await chat({ prompt, intent, currentTasks: [{ id: 't', title: 'Study', phase: 'work', done: false, timerMode: 'stopwatch' }], strategyContext: { goals: [] } });
    assert.equal(result.status, 200);
    assert.equal(calls.length, 1);
    assert.deepEqual(result.body.tasks, []);
    assert.equal(result.body.taskUpdates.length, 1);
    assert.equal(result.body.strategy, undefined);
  }
});

test('a refused start asks for its reason before provider changes can adapt a ready plan', async () => {
  const profile = confirmedProfile([{ ...discoveryGoal, taskIds: ['t'] }]);
  mockProvider(() => success({ reply: 'FORBIDDEN-ADVICE', strategy: { status: 'ready', nextAction: 'FORBIDDEN-NEXT', actions: [{ id: 'a', goalId: 'g', taskId: 't', type: 'update', reason: 'Unjustified guess', changes: { title: 'Smaller task' } }] } }));
  const result = await chat({ prompt: 'Я не почав працювати', discoveryMode: true, turnId: 'refused', strategyContext: profile, currentTasks: [{ id: 't', title: 'Study', phase: 'work' }] });
  assert.equal(result.status, 200);
  assert.equal(calls.length, 1);
  assert.match(result.body.reply, /Що відбувалося/);
  assert.doesNotMatch(JSON.stringify(result.body), /FORBIDDEN/);
  assert.deepEqual(result.body.strategy.actions, []);
});

test('an ordinary pending proposal can be revised and cancelled during discovery', async () => {
  const pending = { tasks: [{ title: 'References', phase: 'focus', priority: 2, steps: 0, countdownDurationSeconds: 1500 }] };
  mockProvider(() => success({ reply: 'Updated proposal', taskUpdates: [{ id: 'pending-task:0', countdownDurationSeconds: 600 }] }));
  const revision = await chat({ prompt: 'Зменши час у пропозиції до 10 хвилин', pendingChanges: pending, strategyContext: { goals: [] }, tabs: ['focus'] });
  assert.equal(revision.status, 200);
  assert.equal(revision.body.tasks[0].countdownDurationSeconds, 600);
  assert.equal(calls.length, 1);
  mockProvider(() => success({ reply: 'Proposal cancelled', tasks: pending.tasks }));
  const cancel = await chat({ prompt: 'Скасуй пропозицію', pendingChanges: pending, strategyContext: { goals: [] } });
  assert.equal(cancel.status, 200);
  assert.deepEqual(cancel.body.tasks, []);
  assert.equal(cancel.body.strategy, undefined);
  assert.equal(cancel.body.proposalDisposition, 'cancelled');
  assert.equal(calls.length, 0, 'explicit cancellation is app-owned');
});

test('ready personal analysis keeps its reply and observations without replacing the saved plan', async () => {
  const profile = confirmedProfile();
  const prompt = 'Проаналізуй мої перешкоди з продуктивністю';
  mockProvider(() => success({ reply: 'Analysis of your reported obstacles', strategy: { status: 'ready', narrative: 'Forbidden replacement narrative', nextAction: 'Forbidden replacement action', focusTaskId: 't', memoryPatch: { facts: [{ id: 'f', text: prompt, source: 'user' }], discovery: { question: { topic: 'barriers', text: 'Що відбулося?' } } }, actions: [{ id: 'a', goalId: 'g', type: 'create', reason: 'Analysis is not permission', changes: { title: 'Unrequested task', phase: 'work' } }] } }));
  const result = await chat({ prompt, intent: 'analysis', discoveryMode: true, strategyContext: profile, turnId: 'personal-analysis' });
  assert.equal(result.status, 200);
  assert.equal(result.body.reply, 'Analysis of your reported obstacles');
  assert.equal(result.body.strategy.status, 'clarifying');
  assert.equal(result.body.strategy.nextAction, undefined);
  assert.equal(result.body.strategy.narrative, undefined);
  assert.equal(result.body.strategy.focusTaskId, undefined);
  assert.equal(result.body.strategy.memoryPatch.discovery, undefined);
  assert.equal(result.body.strategy.memoryPatch.facts[0].text, prompt);
  assert.deepEqual(result.body.strategy.actions, []);
  assert.equal(calls.length, 1);
});

test('autonomous updates use exact raw dispatch snapshots rather than derived analytics context', async () => {
  const task = { id: 't', title: 'Study', phase: 'work', done: false, steps: 0, currentStep: 0, pinned: false, priority: 2, createdAt: 100, timeSpentSeconds: 600, timerMode: 'stopwatch', timerRunning: false, note: 'A real persisted note' } as const;
  const profile = confirmedProfile([{ ...discoveryGoal, taskIds: ['t'] }]);
  const tabs = [{ id: 'work', name: 'Work', color: '#123456' }];
  mockProvider((_model, body) => {
    const prompt = body.contents.flatMap((content: any) => content.parts.map((part: any) => part.text || '')).join('\n');
    assert.doesNotMatch(prompt, /taskSnapshots/);
    return success({ reply: 'A smaller next step', strategy: { status: 'ready', nextAction: 'Read one page', actions: [{ id: 'update', type: 'update', goalId: 'g', taskId: 't', reason: 'Clarify the scope', changes: { title: 'Read one page' }, expectedTask: { id: 't', title: 'Provider forgery' } }] } });
  });
  const result = await chat({ prompt: 'Підготуй наступний крок', intent: 'plan', discoveryMode: true, turnId: 'snapshot-turn', strategyContext: profile,
    taskSnapshots: [task], currentTasks: [{ ...task, timeSpentSeconds: 999, countdownDurationSeconds: 0 }], fullAppContext: { activeTasks: [{ id: 't', title: 'Study', phase: 'work', priority: 2, done: false, timeSpentSeconds: 999 }] } });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.strategy.actions[0].expectedTask, task);
  const options = { tasks: [task], profile, actions: result.body.strategy.actions, ownerId: 'account', currentOwnerId: 'account', turnId: 'snapshot-turn', tabs };
  const applied = applyStrategyActions(options);
  assert.equal(applied.applied.length, 1);
  assert.equal(applied.tasks[0].title, 'Read one page');
  assert.equal(applied.tasks[0].timeSpentSeconds, 600);
  for (const changed of [{ ...task, title: 'Newer title' }, { ...task, timeSpentSeconds: 601 }, { ...task, timerRunning: true }]) {
    const stale = applyStrategyActions({ ...options, tasks: [changed] });
    assert.equal(stale.applied.length, 0);
    assert.match(stale.rejected[0].reason, /changed since analysis/);
  }
  assert.equal(calls.length, 1);
});

test('raw snapshots are optional for compatibility but malformed or duplicate IDs are rejected before transport', async () => {
  mockProvider(() => { throw new Error('Invalid snapshots must not reach the provider'); });
  for (const taskSnapshots of [{}, [null], [{ title: 'Missing id' }], [{ id: 't', title: 'One' }, { id: 't', title: 'Duplicate' }]]) {
    const result = await chat({ taskSnapshots });
    assert.equal(result.status, 400);
  }
  assert.equal(calls.length, 0);
});
test('period audit incorporates personal goals and motives without transmitting action snapshots', async () => {
  mockProvider((_model, body) => {
    const prompt = body.contents.flatMap((content: any) => content.parts.map((part: any) => part.text ?? '')).join('\n');
    assert.match(prompt, /More time with family/);
    assert.match(prompt, /Build a stable income/);
    assert.doesNotMatch(prompt, /PRIVATE-ACTION-SNAPSHOT/);
    assert.match(body.systemInstruction.parts[0].text, /Keep hypotheses unconfirmed/);
    return success({ focusAdvice: 'Choose the step toward stable income.', optimizationTip: 'Leave space for family.', workloadStatus: 'Personal focus', periodRetrospective: 'Review measured progress.', dropoffAnalysis: 'No cancellations.', futureStrategy: 'Discuss the next step.', suggestedTasks: [] });
  });
  const result = await invokeDesktopApi('recommendations', { customApiKey: 'test-only-fake-key', lang: 'en', strategyContext: {
    goals: [{ id: 'g', title: 'Build a stable income', motive: 'More time with family', agreed: true, taskIds: [], categoryIds: ['work'] }],
    actionHistory: [{ after: { title: 'PRIVATE-ACTION-SNAPSHOT' } }],
  } });
  assert.equal(result.status, 200);
  assert.equal(calls.length, 1);
});
test('selected period uses the client calendar timezone across a New Year boundary', async () => {
  const result = await invokeDesktopApi('recommendations', { period: 'THIS_YEAR', lang: 'en', clientClock: { now: '2027-01-01T00:30:00+02:00', timeZone: 'Europe/Kyiv' }, tasks: [
    { id: 'new-year', title: 'New local year', done: true, createdAt: Date.parse('2026-12-31T22:05:00Z'), completedAt: Date.parse('2026-12-31T22:10:00Z') },
    { id: 'last-year', title: 'Old local year', done: true, createdAt: Date.parse('2026-12-31T21:59:00Z'), completedAt: Date.parse('2026-12-31T21:59:00Z') },
  ] });
  assert.equal(result.status, 200);
  assert.match(result.body.periodRetrospective, /This Year \(2027\)/);
  assert.match(result.body.periodRetrospective, /1 tasks were added and 1 completed/);
});

test('retired selected model falls back through the real SDK and preserves serialized timer schema', async () => {
  mockProvider((model, body, options) => {
    assert.ok(options.signal);
    // Commands use function calling: the tool parameters carry the same timer constraints.
    assert.equal(body.generationConfig?.responseSchema, undefined);
    const declarations = Object.fromEntries(body.tools[0].functionDeclarations.map((declaration: any) => [declaration.name, declaration.parameters]));
    assert.equal(declarations.propose_create_task.properties.countdownDurationSeconds.minimum, 60);
    assert.equal(declarations.propose_create_task.properties.countdownDurationSeconds.maximum, 86400);
    // Ordinary commands no longer ask the model for a personal strategy.
    assert.equal(Object.keys(declarations).some(name => /strategy/.test(name)), false);
    assert.deepEqual(declarations.propose_update_task.properties.timerAction.enum, ['start', 'pause', 'stop']);
    return model === 'gemini-retired-model' ? rejected(404, 'NOT_FOUND') : success({
      reply: 'Пропоную таймер на 25 хвилин.', tasks: [], taskUpdates: [{ id: 't1', timerMode: 'countdown', countdownDurationSeconds: 1500 }],
    });
  });
  const result = await chat({ selectedModel: 'models/gemini-retired-model', currentTasks: [{ id: 't1', title: 'Референси' }] });
  assert.equal(result.status, 200);
  assert.equal(result.body.source, 'gemini-chat');
  assert.equal(result.body.taskUpdates[0].countdownDurationSeconds, 1500);
  assert.equal(result.body.usedModel, 'gemini-3.5-flash-lite');
  assert.equal(result.body.fallbackUsed, true);
  assert.equal(result.body.aiMetrics.selectedModelFailure, 'MODEL_UNAVAILABLE');
  assert.deepEqual(calls.map(call => call.model), ['gemini-retired-model', 'gemini-3.5-flash-lite']);
});

test('fallback attempts each model once, then returns the quota category without raw diagnostics', async () => {
  mockProvider(() => rejected(429, 'RESOURCE_EXHAUSTED'));
  const result = await chat();
  assert.equal(result.status, 429);
  assert.equal(result.body.code, 'QUOTA_EXCEEDED');
  assert.deepEqual(calls.map(call => call.model), ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.8-flash']);
  assert.deepEqual(result.body.taskUpdates, []);
  assert.equal(result.body.source, 'ai-error');
  assert.doesNotMatch(JSON.stringify(result.body), /private-test-key|provider-internal-data/);
});

test('provider authorization failures stop immediately with the correct category', async () => {
  for (const [status, providerStatus, code] of [[401, 'UNAUTHENTICATED', 'INVALID_API_KEY'], [403, 'PERMISSION_DENIED', 'ACCESS_DENIED']] as const) {
    mockProvider(() => rejected(status, providerStatus));
    const result = await chat();
    assert.equal(result.status, status);
    assert.equal(result.body.code, code);
    assert.equal(calls.length, 1);
    assert.deepEqual(result.body.tasks, []);
  }
});

test('the real SDK invalid request error is explicit, stops once and does not blame user wording', async () => {
  mockProvider(() => rejected(400, 'INVALID_ARGUMENT', 'responseSchema invalid private-test-key'));
  const result = await chat();
  assert.equal(result.status, 502);
  assert.equal(result.body.code, 'INVALID_AI_REQUEST');
  assert.equal(calls.length, 1);
  assert.match(result.body.error, /запит додатка/);
  assert.doesNotMatch(result.body.error, /responseSchema|private-test-key|Уточніть/);
});

test('model outages and network failures retain their category instead of a successful local chat reply', async () => {
  for (const [respond, code] of [
    [() => rejected(404, 'NOT_FOUND'), 'MODEL_UNAVAILABLE'],
    [() => { throw new TypeError('fetch failed'); }, 'NETWORK_ERROR'],
    [() => rejected(503, 'UNAVAILABLE'), 'PROVIDER_UNAVAILABLE'],
  ] as const) {
    mockProvider(respond);
    const result = await chat();
    assert.ok(result.status >= 500);
    assert.equal(result.body.code, code);
    assert.equal(result.body.source, 'ai-error');
    assert.match(result.body.error, /не застосовано/);
  }
});

test('invalid Gemini output does not silently generate heuristic changes', async () => {
  mockProvider(() => success({ reply: 'Сформовано.', tasks: [], taskUpdates: [{ id: 'unknown', timerAction: 'start' }] }));
  const result = await chat();
  assert.equal(result.status, 502);
  assert.equal(result.body.code, 'INVALID_AI_RESPONSE');
  assert.deepEqual(result.body.tasks, []);
  assert.deepEqual(result.body.taskUpdates, []);
  assert.deepEqual(calls.map(call => call.model), ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.8-flash']);
});

const lottieTask = { title: 'Пошук референсів для анімації Lottie', phase: 'focus', priority: 2, steps: 0, stepList: [], timerMode: 'countdown', countdownDurationSeconds: 2400 };
const lottiePrompt = 'Привіт, додай завдання пошук референсів для анімації лотті з таймером на 40 хвилин';

test('Lottie forty-minute task tolerates unused optional nulls and preserves zero subtasks', async () => {
  for (const action of ['chat', 'generate']) {
    mockProvider((_model, body) => {
      assert.match(body.systemInstruction.parts[0].text, /40 minutes means countdownDurationSeconds:2400/);
      return success({ reply: 'Пропоную завдання з таймером на 40 хвилин.', summary: 'Пропозицію підготовлено.',
        tasks: [{ ...lottieTask, note: null, timerAction: null }], tabs: null, taskUpdates: null, taskDeletions: null });
    });
    const result = await chat({ prompt: lottiePrompt, action, tabs: ['focus'] });
    assert.equal(result.status, 200);
    assert.equal(result.body.tasks.length, 1);
    assert.equal(result.body.tasks[0].countdownDurationSeconds, 2400);
    assert.equal(result.body.tasks[0].timerAction, undefined);
    assert.equal(result.body.tasks[0].steps, 0);
    assert.deepEqual(result.body.tasks[0].stepList, []);
    assert.deepEqual(result.body.taskUpdates, []);
    assert.deepEqual(result.body.taskDeletions, []);
    assert.equal(calls.length, 1);
  }
});

test('existing-task forty-minute timer with null optional text remains a valid complete mutation', async () => {
  mockProvider(() => success({ reply: 'Пропоную таймер на 40 хвилин.', tasks: [], taskUpdates: [{
    id: 't1', title: null, note: null, phase: null, priority: null, done: null, steps: null, stepList: null,
    timerMode: null, countdownDurationSeconds: 2400, timerAction: null,
  }], taskDeletions: null }));
  const result = await chat({ prompt: `Додай таймер на 40 хвилин до завдання ${lottieTask.title}`, currentTasks: [{ id: 't1', title: lottieTask.title, note: 'Моя примітка' }] });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.taskUpdates, [{ id: 't1', countdownDurationSeconds: 2400, timerMode: 'countdown' }]);
  assert.equal(calls.length, 1);
});

test('invalid duration is not reinterpreted as minutes and a valid distinct fallback repairs the entire proposal', async () => {
  mockProvider(model => success({ reply: 'Пропоную завдання.', tasks: [{ ...lottieTask,
    countdownDurationSeconds: model === 'gemini-3.1-flash-lite' ? 40 : 2400 }] }));
  const result = await chat({ prompt: lottiePrompt, tabs: ['focus'] });
  assert.equal(result.status, 200);
  assert.equal(result.body.tasks[0].countdownDurationSeconds, 2400);
  assert.equal(result.body.usedModel, 'gemini-3.5-flash-lite');
  assert.equal(result.body.fallbackUsed, true);
  // The selected model answered, only invalidly: the client must not switch away from it.
  assert.equal(result.body.aiMetrics.selectedModelFailure, 'INVALID_AI_RESPONSE');
  assert.deepEqual(calls.map(call => call.model), ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite']);
});

test('all invalid timer, target and required-title variants fail without a partial proposal', async () => {
  for (const malformed of [
    { tasks: [{ ...lottieTask, countdownDurationSeconds: 40 }] },
    { tasks: [{ ...lottieTask, countdownDurationSeconds: '2400' }] },
    { tasks: [lottieTask, { ...lottieTask, countdownDurationSeconds: 0 }] },
    { tasks: [{ ...lottieTask, title: null }] },
    { tasks: [null] },
    { tasks: [], taskUpdates: [{ id: 'unknown', timerAction: 'start' }] },
    { tasks: [{ ...lottieTask, timerRunning: null }] },
  ]) {
    mockProvider(() => success({ reply: 'Пропоную завдання.', ...malformed }));
    const result = await chat({ prompt: lottiePrompt, tabs: ['focus'] });
    assert.equal(result.status, 502, JSON.stringify(malformed));
    assert.equal(result.body.code, 'INVALID_AI_RESPONSE');
    assert.deepEqual(result.body.tasks, []);
    assert.deepEqual(result.body.taskUpdates, []);
    assert.equal(calls.length, 3);
  }
});

test('malformed optional mutation values trigger model fallback before a successful server response', async () => {
  for (const malformed of [{ title: {} }, { note: [] }, { phase: {} }, { steps: {} }, { steps: 2.5 }, { done: 'false' }]) {
    mockProvider(model => success({ reply: 'Пропоную таймер.', tasks: [], taskUpdates: [{ id: 't1',
      countdownDurationSeconds: 2400, ...(model === 'gemini-3.1-flash-lite' ? malformed : {}) }] }));
    const result = await chat({ currentTasks: [{ id: 't1', title: lottieTask.title }] });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.taskUpdates, [{ id: 't1', countdownDurationSeconds: 2400, timerMode: 'countdown' }]);
    assert.equal(result.body.usedModel, 'gemini-3.5-flash-lite');
    assert.equal(calls.length, 2);
  }
});

test('all assistant modes send classified records and recomputed statistics to the provider', async () => {
  const timestamp = Date.now();
  const task = (id: string, done: boolean, extra: any = {}) => ({ id, title: id, phase: 'focus', priority: 2, done, createdAt: timestamp, ...extra });
  const fullAppContext = {
    activeTasks: [task('live', false), task('EXCLUDED-accidental-live', false, { deletionReason: 'accidental' }), task('EXCLUDED-archived-live', false, { deletedAt: timestamp })],
    completedTasks: [task('completed', true)],
    deletedTasks: [
      task('archived-completed', true, { deletedAt: timestamp }),
      task('cancelled', false, { deletedAt: timestamp, deletionReason: 'cancelled' }),
      task('live', true, { title: 'EXCLUDED-restored-task-archive', deletedAt: timestamp }),
      task('completed', false, { title: 'EXCLUDED-completed-task-cancellation', deletedAt: timestamp, deletionReason: 'cancelled' }),
      task('archived-completed', true, { title: 'EXCLUDED-duplicate-completion', deletedAt: timestamp }),
      task('cancelled', false, { title: 'EXCLUDED-duplicate-cancellation', deletedAt: timestamp, deletionReason: 'cancelled' }),
      task('EXCLUDED-accidental-archive', true, { deletedAt: timestamp, deletionReason: 'accidental' }),
      task('EXCLUDED-accidental-archive', true, { title: 'EXCLUDED-older-completion-for-accident', deletedAt: timestamp }),
      task('EXCLUDED-unknown-archive', false, { deletedAt: timestamp }),
      task('EXCLUDED-unknown-archive', false, { title: 'EXCLUDED-older-cancellation-for-unknown', deletedAt: timestamp, deletionReason: 'cancelled' }),
      task('EXCLUDED-accidental-live', true, { title: 'EXCLUDED-older-completion-for-current-accident', deletedAt: timestamp }),
    ],
    stats: { total: 999, completed: 999, percent: 100, phaseCounts: { 'EXCLUDED-client-aggregate': 999 } },
    adaptiveProfile: { trackedTasks: 999, completedTasks: 999, activeLoad: 999, preferredPhases: ['EXCLUDED-client-profile'] },
  };
  for (const action of ['chat', 'generate', 'analyze']) {
    mockProvider((_model, body) => {
      const contents = body.contents.flatMap((content: any) => content.parts.map((part: any) => part.text ?? '')).join('\n');
      assert.doesNotMatch(contents, /EXCLUDED-|999/);
      const serialized = action === 'chat'
        ? /WORKSPACE CONTEXT:\n([\s\S]+?)\n\nCURRENT USER MESSAGE:/.exec(contents)?.[1]
        : /WORKSPACE REAL-TIME CONTEXT:\n([\s\S]+)$/.exec(contents)?.[1];
      assert.ok(serialized);
      const context = JSON.parse(serialized);
      assert.deepEqual(context.activeTasks.map((item: any) => item.id), ['live']);
      assert.deepEqual(context.completedTasks.map((item: any) => item.id), ['completed']);
      assert.deepEqual(context.completedHistory.map((item: any) => item.id), ['archived-completed']);
      assert.deepEqual(context.cancelledTasks.map((item: any) => item.id), ['cancelled']);
      const profile = context.adaptiveProfile ?? context.behavioralProfile;
      assert.equal(profile.trackedTasks, 4);
      assert.equal(profile.completedTasks, 2);
      assert.equal(profile.activeLoad, 1);
      assert.equal(profile.completionRate, 50);
      if (action === 'chat') assert.deepEqual(context.stats, { total: 4, completed: 2, active: 1, cancelled: 1, percent: 50, phaseCounts: { focus: 4 } });
      else assert.deepEqual(context.overview, { totalTasks: 4, completedCount: 2, completionPercent: 50, activeCount: 1, urgentP1Count: 0 });
      // Chat workspace analysis has no JSON mutation schema; requested changes arrive only as propose_* tool calls.
      if (action === 'chat') {
        assert.equal(body.generationConfig?.responseSchema, undefined);
        assert.ok(body.tools[0].functionDeclarations.some((declaration: any) => declaration.name === 'propose_delete_task'));
      } else assert.deepEqual(body.generationConfig.responseSchema.properties.taskDeletions.items.properties.deletionReason.enum, ['accidental', 'cancelled']);
      return success({ reply: 'Review prepared.', summary: 'Review prepared.', tasks: [], taskUpdates: [], taskDeletions: [] });
    });
    const result = await chat({ prompt: 'Audit the workspace', lang: 'en', action, fullAppContext });
    assert.equal(result.status, 200);
    assert.equal(calls.length, 1);
  }
});

test('recommendations send server-derived period metrics and distinct completion and cancellation groups', async () => {
  const timestamp = Date.now();
  const previousMonth = new Date(timestamp);
  previousMonth.setDate(0);
  const older = previousMonth.getTime();
  const task = (id: string, done: boolean, extra: any = {}) => ({ id, title: id, phase: 'focus', priority: 2, done, createdAt: timestamp, ...extra });
  mockProvider((_model, body) => {
    const contents = body.contents.flatMap((content: any) => content.parts.map((part: any) => part.text ?? '')).join('\n');
    assert.doesNotMatch(contents, /EXCLUDED-|999/);
    const metrics = JSON.parse(/Metrics Overview: (.+)/.exec(contents)![1]);
    assert.deepEqual(metrics, { totalCreated: 4, totalCompleted: 2, totalActive: 1, totalCancelled: 1, totalDeleted: 1, successRate: 67 });
    assert.match(contents, /Active Tasks \(1\): \[{"title":"live"/);
    assert.match(contents, /Completed Tasks \(2; first 15 shown\):.*"title":"completed".*"title":"archived-completed"/);
    assert.match(contents, /"recordedWorkSeconds":null/);
    assert.match(contents, /Deliberately Cancelled Unfinished Tasks \(1\): \[{"title":"cancelled"/);
    assert.match(body.systemInstruction.parts[0].text, /Active unfinished tasks are not failures/);
    return success({ focusAdvice: 'Review results.', optimizationTip: 'Plan next steps.', workloadStatus: 'LOW VOLUME',
      periodRetrospective: 'Two completed tasks.', dropoffAnalysis: 'One cancellation.', futureStrategy: 'Plan next steps.', productivityGrade: 'S', suggestedTasks: [] });
  });
  const result = await invokeDesktopApi('recommendations', {
    customApiKey: 'test-only-fake-key', lang: 'en', period: 'THIS_MONTH',
    tasks: [task('live', false), task('completed', true, { completedAt: timestamp }), task('EXCLUDED-live-accident', false, { deletionReason: 'accidental' })],
    deletedTasks: [
      task('archived-completed', true, { deletedAt: timestamp }),
      task('cancelled', false, { deletedAt: timestamp, deletionReason: 'cancelled' }),
      task('live', true, { title: 'EXCLUDED-restored-task-archive', deletedAt: timestamp }),
      task('completed', false, { title: 'EXCLUDED-completed-task-cancellation', deletedAt: timestamp, deletionReason: 'cancelled' }),
      task('archived-completed', true, { title: 'EXCLUDED-duplicate-completion', deletedAt: timestamp }),
      task('cancelled', false, { title: 'EXCLUDED-duplicate-cancellation', deletedAt: timestamp, deletionReason: 'cancelled' }),
      task('EXCLUDED-accidental', true, { deletedAt: timestamp, deletionReason: 'accidental' }),
      task('EXCLUDED-accidental', true, { title: 'EXCLUDED-older-completion-for-accident', deletedAt: timestamp }),
      task('EXCLUDED-unclassified', false, { deletedAt: timestamp }),
      task('EXCLUDED-unclassified', false, { title: 'EXCLUDED-older-cancellation-for-unknown', deletedAt: timestamp, deletionReason: 'cancelled' }),
      task('EXCLUDED-live-accident', true, { title: 'EXCLUDED-older-completion-for-current-accident', deletedAt: timestamp }),
      task('EXCLUDED-earlier-cancellation', false, { createdAt: older, deletedAt: older, deletionReason: 'cancelled' }),
      task('EXCLUDED-earlier-completion', true, { createdAt: older, completedAt: older, deletedAt: timestamp }),
    ],
    periodMetrics: { totalCreated: 999, totalCompleted: 999, totalActive: 999, totalDeleted: 999, successRate: 100 },
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.productivityGrade, undefined, 'provider grades are discarded');
  assert.equal(calls.length, 1);
});

test('period report temporal context keeps open work and plans but only completions from the period', async () => {
  const at = (iso: string) => Date.parse(iso);
  let temporalIds: string[] = [];
  mockProvider((_model, body) => {
    const contents = body.contents.flatMap((content: any) => content.parts.map((part: any) => part.text ?? '')).join('\n');
    temporalIds = JSON.parse(/Task temporal context \([^)]*\): (.+)/.exec(contents)![1]).tasks.map((task: any) => task.id);
    return success({ focusAdvice: 'a', optimizationTip: 'b', workloadStatus: 'c', periodRetrospective: 'd', dropoffAnalysis: 'e', futureStrategy: 'f', suggestedTasks: [] });
  });
  const result = await invokeDesktopApi('recommendations', {
    customApiKey: 'test-only-fake-key', lang: 'en', period: 'THIS_MONTH', clientClock: { now: '2026-10-12T12:00:00Z', timeZone: 'Europe/Kyiv' },
    tasks: [
      { id: 'open-old', title: 'Open old', done: false, createdAt: at('2026-07-01T10:00:00Z') },
      { id: 'done-in-period', title: 'Done now', done: true, createdAt: at('2026-10-01T10:00:00Z'), completedAt: at('2026-10-05T10:00:00Z') },
      { id: 'done-before-period', title: 'Done before', done: true, createdAt: at('2026-07-01T10:00:00Z'), completedAt: at('2026-08-01T10:00:00Z') },
      { id: 'plan', title: 'Plan', done: false, scheduledPending: true, createdAt: at('2026-10-10T10:00:00Z'), scheduledFor: at('2026-10-20T10:00:00Z') },
    ],
  });
  assert.equal(result.status, 200);
  assert.deepEqual([...temporalIds].sort(), ['done-in-period', 'open-old', 'plan']);
  // Technical metrics are reported by every Gemini-backed endpoint, not only chat.
  assert.equal(typeof result.body.aiMetrics?.elapsedMs, 'number');
  assert.equal(result.body.aiMetrics.model, result.body.usedModel);
});

test('breakdown excludes completed, accidental and archived tasks from other active work', async () => {
  mockProvider((_model, body) => {
    const contents = body.contents.flatMap((content: any) => content.parts.map((part: any) => part.text ?? '')).join('\n');
    assert.match(contents, /Other active tasks: \["live"\]/);
    assert.doesNotMatch(contents, /EXCLUDED-/);
    return success({ stepList: [{ title: 'First step' }], suggestedPriority: 2, note: 'Plan ready.' });
  });
  const result = await invokeDesktopApi('breakdown', {
    customApiKey: 'test-only-fake-key', task: { id: 'target', title: 'Prepare draft' }, lang: 'en',
    fullAppContext: { activeTasks: [
      { id: 'live', title: 'live', done: false },
      { id: 'done', title: 'EXCLUDED-completed', done: true },
      { id: 'accidental', title: 'EXCLUDED-accidental', done: false, deletionReason: 'accidental' },
      { id: 'archived', title: 'EXCLUDED-archived', done: false, deletedAt: Date.now() },
    ] },
  });
  assert.equal(result.status, 200);
  assert.equal(calls.length, 1);
});

test('classified deletion proposals round-trip through the SDK and unknown enum values fail without mutations', async () => {
  for (const deletionReason of ['accidental', 'cancelled', undefined, 'unknown']) {
    mockProvider(() => success({ reply: 'Deletion proposal prepared.', tasks: [], taskDeletions: [{ id: 't1', deletionReason }] }));
    const result = await chat({ prompt: 'Видали завдання Current task', currentTasks: [{ id: 't1', title: 'Current task' }] });
    if (deletionReason === 'unknown') {
      assert.equal(result.status, 502);
      assert.equal(result.body.code, 'INVALID_AI_RESPONSE');
      assert.deepEqual(result.body.taskDeletions, []);
      assert.equal(calls.length, 3);
    } else {
      assert.equal(result.status, 200);
      assert.deepEqual(result.body.taskDeletions, [{ id: 't1', ...(deletionReason ? { deletionReason } : {}) }]);
      assert.equal(calls.length, 1);
    }
  }
});

test('real SDK ignores thought text and joins fenced JSON text parts for the Lottie proposal', () => withToolsOff(async () => {
  mockProvider(() => {
    const proposal = JSON.stringify({ reply: 'Пропоную завдання.', tasks: [lottieTask] });
    const split = Math.floor(proposal.length / 2);
    return json({ candidates: [{ content: { role: 'model', parts: [
      { thought: true, text: 'Internal reasoning must not be parsed.' },
      { text: '\uFEFF```json\n' + proposal.slice(0, split) }, { text: proposal.slice(split) + '\n```' },
    ] }, finishReason: 'STOP' }] });
  });
  const result = await chat({ prompt: lottiePrompt, tabs: ['focus'] });
  assert.equal(result.status, 200);
  assert.equal(result.body.tasks[0].countdownDurationSeconds, 2400);
  assert.equal(calls.length, 1);
}));

test('malformed JSON uses a distinct model, while repeated truncation stays an explicit failure', () => withToolsOff(async () => {
  for (const repair of [true, false]) {
    mockProvider(model => model !== 'gemini-3.1-flash-lite' && repair
      ? success({ reply: 'Пропоную завдання.', tasks: [lottieTask] })
      : json({ candidates: [{ content: { parts: [{ text: '{"reply":"Пропоную", "tasks": [' }] } }] }));
    const result = await chat({ prompt: lottiePrompt, tabs: ['focus'] });
    assert.equal(result.status, repair ? 200 : 502);
    assert.equal(calls.length, repair ? 2 : 3);
    if (!repair) assert.deepEqual(result.body.tasks, []);
  }
}));

test('validation fallback shares the original deadline and does not grant another full timeout', async () => {
  mockProvider((model, _body, options) => model === 'gemini-3.1-flash-lite' ? success({ invalid: true })
    : new Promise((_resolve, reject) => options.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })));
  const started = performance.now();
  await assert.rejects(generateGeminiWithFallback({
    ai: new GoogleGenAI({ apiKey: 'test-only-fake-key' }), contents: 'Test', config: {},
    validateResponse: () => { throw new Error('Invalid proposal'); }, timeoutMs: 30, totalTimeoutMs: 15,
  }), (error: unknown) => error instanceof AIRequestError && error.code === 'TIMEOUT');
  assert.ok(performance.now() - started < 150);
  assert.ok(calls.length <= 2);
  assert.ok(calls.at(-1)?.signal?.aborted);
});

test('provider failures in planning, breakdown and recommendations are explicit too', async () => {
  const inputs = [
    ['assist', { prompt: 'План роботи', action: 'generate' }],
    ['breakdown', { task: { id: 't1', title: 'Робота' } }],
    ['recommendations', { tasks: [] }],
  ] as const;
  for (const [operation, input] of inputs) {
    mockProvider(() => rejected(401, 'UNAUTHENTICATED'));
    const result = await invokeDesktopApi(operation, { ...input, customApiKey: 'test-only-fake-key', lang: 'uk' });
    assert.equal(result.status, 401);
    assert.equal(result.body.code, 'INVALID_API_KEY');
    assert.equal(result.body.source, 'ai-error');
  }
});

test('missing chat credentials are explicit while the local greeting remains available', async () => {
  mockProvider(() => { throw new Error('Google must not be called without credentials'); });
  const missing = await invokeDesktopApi('assist', { prompt: 'Допоможи скласти план', action: 'chat', lang: 'uk' });
  assert.equal(missing.status, 503);
  assert.equal(missing.body.code, 'MISSING_API_KEY');
  const greeting = await invokeDesktopApi('assist', { prompt: 'Привіт', action: 'chat', lang: 'uk' });
  assert.equal(greeting.status, 200);
  assert.equal(greeting.body.source, 'greeting');
  assert.equal(calls.length, 0);
});

test('the generation deadline aborts every unfinished SDK transport and stays bounded', async () => {
  mockProvider((_model, _body, options) => new Promise((_resolve, reject) => {
    options.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }));
  const started = performance.now();
  await assert.rejects(generateGeminiWithFallback({
    ai: new GoogleGenAI({ apiKey: 'test-only-fake-key' }), contents: 'Test', config: {}, timeoutMs: 10, totalTimeoutMs: 25,
  }), (error: unknown) => error instanceof AIRequestError && error.code === 'TIMEOUT');
  assert.ok(performance.now() - started < 500);
  assert.ok(calls.length >= 1 && calls.length <= 3);
  assert.ok(calls.every(call => call.signal?.aborted));
});

test('cancelling transcription transport aborts the provider without trying fallback models', async () => {
  const controller = new AbortController();
  mockProvider((_model, _body, options) => new Promise((_resolve, reject) => {
    options.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    controller.abort(new DOMException('User cancelled', 'AbortError'));
  }));
  await assert.rejects(generateGeminiWithFallback({
    ai: new GoogleGenAI({ apiKey: 'test-only-fake-key' }), contents: [{ inlineData: { mimeType: 'audio/webm', data: 'dGVzdA==' } }], config: {},
    signal: controller.signal, timeoutMs: 100, totalTimeoutMs: 300,
  }), (error: unknown) => error instanceof Error && error.name === 'AbortError');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].signal?.aborted, true);
});

test('structured API key reasons and malformed request failures are categorized without disclosure', () => {
  const invalid = classifyAIRequestError({ status: 400, message: JSON.stringify({ error: { details: [{ reason: 'API_KEY_INVALID' }] } }) });
  assert.equal(invalid.code, 'INVALID_API_KEY');
  assert.equal(classifyAIRequestError({ status: 400, message: 'responseSchema not supported' }).code, 'INVALID_AI_REQUEST');
  const failure = aiRequestFailure(invalid, false);
  assert.equal(failure.status, 401);
  assert.match(failure.body.error, /No changes were prepared or applied/);
});

test('thinking effort maps to settings each model family accepts', () => {
  // Flash-Lite keeps its fastest level for commands and never rises above LOW.
  assert.deepEqual(thinkingConfigForModel('gemini-3.1-flash-lite', 'low'), { thinkingLevel: 'MINIMAL' });
  assert.deepEqual(thinkingConfigForModel('models/gemini-3.5-flash-lite', 'medium'), { thinkingLevel: 'LOW' });
  // 3.7/3.8 Flash reject MINIMAL, so Flash never receives it.
  for (const model of ['gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.8-flash', 'gemini-flash-latest']) {
    assert.deepEqual(thinkingConfigForModel(model, 'minimal'), { thinkingLevel: 'LOW' });
    assert.deepEqual(thinkingConfigForModel(model, 'medium'), { thinkingLevel: 'MEDIUM' });
  }
  assert.deepEqual(thinkingConfigForModel('gemini-2.5-flash', 'low'), { thinkingBudget: 512 });
  assert.deepEqual(thinkingConfigForModel('gemini-2.5-pro', 'minimal'), { thinkingBudget: 128 });
  assert.equal(thinkingConfigForModel('gemini-3.8-flash', 'default'), undefined);
  assert.equal(thinkingConfigForModel('custom-tuned-model', 'low'), undefined);
});

test('chat sends route thinking settings and reports timing metrics', async () => {
  mockProvider((_model, body) => {
    assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingLevel: 'MINIMAL' });
    return toolCallResponse({ reply: 'Пропоную таймер.', taskUpdates: [{ id: 't1', timerMode: 'countdown', countdownDurationSeconds: 1500 }] },
      { promptTokenCount: 900, candidatesTokenCount: 40, thoughtsTokenCount: 12 });
  });
  const result = await chat({ currentTasks: [{ id: 't1', title: 'Референси' }] });
  assert.equal(result.status, 200);
  assert.equal(result.body.aiMetrics.toolCalls, 1);
  assert.deepEqual(result.body.taskUpdates, [{ id: 't1', timerMode: 'countdown', countdownDurationSeconds: 1500 }]);
  assert.equal(result.body.aiMetrics.model, 'gemini-3.1-flash-lite');
  assert.equal(result.body.aiMetrics.thinking, 'MINIMAL');
  assert.equal(result.body.aiMetrics.promptTokens, 900);
  assert.equal(result.body.aiMetrics.thoughtsTokens, 12);
  assert.equal(typeof result.body.aiMetrics.elapsedMs, 'number');
});

test('a model that rejects the thinking setting is retried once with its default', async () => {
  mockProvider((model, body) => body.generationConfig.thinkingConfig
    ? rejected(400, 'INVALID_ARGUMENT', 'Thinking level MINIMAL is not supported for this model.')
    : success({ reply: 'Готово.', taskUpdates: [{ id: 't1', timerMode: 'countdown', countdownDurationSeconds: 1500 }] }));
  const first = await chat({ selectedModel: 'gemini-3.8-flash', currentTasks: [{ id: 't1', title: 'Референси' }] });
  assert.equal(first.status, 200);
  assert.deepEqual(calls.map(call => [call.model, Boolean(call.body.generationConfig.thinkingConfig)]), [['gemini-3.8-flash', true], ['gemini-3.8-flash', false]]);
  assert.equal(first.body.usedModel, 'gemini-3.8-flash');
});

test('a model that exhausted its free quota is tried last on the next request', async () => {
  mockProvider(model => model === 'gemini-3.1-flash-lite' ? rejected(429, 'RESOURCE_EXHAUSTED') : success({ reply: 'Готово.', taskUpdates: [] }));
  const first = await chat({ currentTasks: [{ id: 't1', title: 'Референси' }] });
  assert.equal(first.status, 200);
  assert.deepEqual(calls.map(call => call.model), ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite']);
  // Keep the remembered cooldown for the second request (mockProvider would reset it).
  calls.length = 0;
  const second = await chat({ currentTasks: [{ id: 't1', title: 'Референси' }] });
  assert.equal(second.status, 200);
  assert.deepEqual(calls.map(call => call.model), ['gemini-3.5-flash-lite']);
  assert.equal(second.body.usedModel, 'gemini-3.5-flash-lite');
  assert.equal(second.body.aiMetrics.selectedModelFailure, 'QUOTA_EXCEEDED');
  // The selected model was demoted by its cooldown, yet another model answered.
  assert.equal(second.body.fallbackUsed, true);
});

test('fallbackUsed compares against the preferred model, not the cooldown-reordered head', async () => {
  mockProvider(model => model === 'gemini-3.1-flash-lite'
    ? rejected(429, 'RESOURCE_EXHAUSTED')
    : json({ candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] }));
  const ai = new GoogleGenAI({ apiKey: 'test-only-fake-key' });
  const options = { ai, contents: 'Test', config: {}, selectedModel: 'gemini-3.1-flash-lite', fallbackModels: ['gemini-flash-latest'] };
  const first = await generateGeminiWithFallback(options);
  assert.equal(first.usedModel, 'gemini-flash-latest');
  assert.equal(first.fallbackUsed, true);
  calls.length = 0;
  const second = await generateGeminiWithFallback(options);
  assert.deepEqual(calls.map(call => call.model), ['gemini-flash-latest']);
  assert.equal(second.fallbackUsed, true);
});

test('a selected model unknown to the key outranks later quota and overload failures', async () => {
  // The field case: listed but 404, then an overloaded and an exhausted fallback.
  mockProvider(model => model === 'gemini-2.5-flash-lite' ? rejected(404, 'NOT_FOUND')
    : model === 'gemini-3.5-flash-lite' ? rejected(503, 'UNAVAILABLE') : rejected(429, 'RESOURCE_EXHAUSTED'));
  const result = await chat({ selectedModel: 'gemini-2.5-flash-lite' });
  assert.equal(result.body.code, 'MODEL_UNAVAILABLE');
  assert.match(result.body.error, /Виберіть іншу модель/);
  assert.deepEqual(result.body.diagnostics.attempts.map((attempt: any) => [attempt.model, attempt.code]), [
    ['gemini-2.5-flash-lite', 'MODEL_UNAVAILABLE'], ['gemini-3.5-flash-lite', 'PROVIDER_UNAVAILABLE'], ['gemini-3.1-flash-lite', 'QUOTA_EXCEEDED']]);
  // Without an explicit selection there is no selected model to blame.
  mockProvider(model => model === 'only-404' ? rejected(404, 'NOT_FOUND') : rejected(429, 'RESOURCE_EXHAUSTED'));
  await assert.rejects(generateGeminiWithFallback({ ai: new GoogleGenAI({ apiKey: 'test-only-fake-key' }), contents: 'Test', config: {}, fallbackModels: ['only-404', 'quota'] }),
    (error: unknown) => error instanceof AIRequestError && error.code === 'QUOTA_EXCEEDED');
});

test('a selected model that returned 404 stays demoted and keeps reporting why', async () => {
  mockProvider(model => model === 'gemini-2.5-flash'
    ? rejected(404, 'NOT_FOUND')
    : json({ candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] }));
  const ai = new GoogleGenAI({ apiKey: 'test-only-fake-key' });
  const options = { ai, contents: 'Test', config: {}, selectedModel: 'gemini-2.5-flash', fallbackModels: ['gemini-3-flash-preview'] };
  const first = await generateGeminiWithFallback(options);
  assert.equal(first.usedModel, 'gemini-3-flash-preview');
  assert.equal(first.metrics.selectedModelFailure, 'MODEL_UNAVAILABLE');
  calls.length = 0;
  const second = await generateGeminiWithFallback(options);
  // The dead model is not retried first; the client still learns it should switch.
  assert.deepEqual(calls.map(call => call.model), ['gemini-3-flash-preview']);
  assert.equal(second.metrics.selectedModelFailure, 'MODEL_UNAVAILABLE');
  // A model that answers itself reports no selected-model failure.
  const direct = await generateGeminiWithFallback({ ...options, selectedModel: 'gemini-3-flash-preview' });
  assert.equal(direct.metrics.selectedModelFailure, undefined);
});

const quotaBody = (violations: any[], retryDelay?: string) => json({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'private-test-key quota text', details: [
  { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations },
  { '@type': 'type.googleapis.com/google.rpc.Help', links: [{ url: 'https://ai.google.dev/gemini-api/docs/rate-limits' }] },
  ...(retryDelay ? [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay }] : []),
] } }, 429);

test('429 quota details are parsed from the SDK error shape into categories and numbers', () => {
  // The SDK ApiError carries the JSON body as its message.
  const sdkError = Object.assign(new Error(JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'quota', details: [
    { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [
      { quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests', quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
        quotaDimensions: { location: 'global', model: 'gemini-3-flash' }, quotaValue: '250' },
      { quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_input_token_count', quotaId: 'GenerateContentInputTokensPerModelPerMinute-FreeTier', quotaValue: '250000' },
      { quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests', quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier', quotaValue: 'not-a-number' },
    ] },
    { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '43.5s' },
  ] } })), { name: 'ApiError', status: 429 });
  assert.deepEqual(quotaInfoFromError(sdkError), { retryAfterMs: 43500, violations: [
    { unit: 'requests', window: 'day', limit: 250 },
    { unit: 'input_tokens', window: 'minute', limit: 250000 },
    { unit: 'requests', window: 'minute' },
  ] });
  assert.equal(quotaInfoFromError(new Error('fetch failed')), undefined);
  assert.deepEqual(quotaInfoFromError({ status: 429, message: JSON.stringify({ error: { details: [{ retryDelay: '5s' }] } }) }), { violations: [], retryAfterMs: 5000 });
});

test('attempt records carry quota facts, responded flags and a one-way key label for usage accounting', async () => {
  mockProvider(model => model === 'gemini-3.1-flash-lite'
    ? quotaBody([{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaValue: '20' }], '30s')
    : model === 'gemini-3.5-flash-lite' ? success({ invalid: true }) : rejected(503, 'UNAVAILABLE'));
  const failed = await chat({ currentTasks: [{ id: 't1', title: 'Референси' }] });
  const { attempts, keyId } = failed.body.diagnostics;
  assert.match(keyId, /^[a-f0-9]{16}$/);
  assert.deepEqual(attempts.map((attempt: any) => [attempt.model, attempt.code, attempt.responded ?? false]), [
    ['gemini-3.1-flash-lite', 'QUOTA_EXCEEDED', false], ['gemini-3.5-flash-lite', 'INVALID_AI_RESPONSE', true], ['gemini-3.8-flash', 'PROVIDER_UNAVAILABLE', false]]);
  assert.deepEqual(attempts[0].quota, { violations: [{ unit: 'requests', window: 'day', limit: 20 }], retryAfterMs: 30000 });
  assert.doesNotMatch(JSON.stringify(failed.body), /private-test-key|test-only-fake-key/);

  mockProvider(model => model === 'gemini-3.1-flash-lite' ? rejected(404, 'NOT_FOUND') : success({ reply: 'Готово.', taskUpdates: [] }));
  const answered = await chat({ currentTasks: [{ id: 't1', title: 'Референси' }] });
  assert.equal(answered.body.aiMetrics.keyId, keyId);
  assert.deepEqual(answered.body.aiMetrics.failedAttempts.map((attempt: any) => [attempt.model, attempt.code]), [['gemini-3.1-flash-lite', 'MODEL_UNAVAILABLE']]);
  // The label is stable per key, differs between keys and does not contain the key.
  const label = (key: string) => generateGeminiWithFallback({ ai: createGeminiClient(key), contents: 'x', config: {}, selectedModel: 'gemini-3-flash-preview', fallbackModels: [], allowEmptyText: true })
    .then(result => result.metrics.keyId);
  const [first, again, other] = await Promise.all([label('key-one'), label('key-one'), label('key-two')]);
  assert.equal(first, again);
  assert.notEqual(first, other);
  assert.doesNotMatch(String(first), /key-one/);
});

test('a 429 with a quota of 0 means the model is not on this tier, not that a limit was used up', async () => {
  const zeroQuota = () => quotaBody([{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaValue: '0' },
    { quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier', quotaValue: '0' }]);
  mockProvider(model => model === 'gemini-3.1-pro-preview' ? zeroQuota()
    : model === 'gemini-3.5-flash-lite' ? rejected(429, 'RESOURCE_EXHAUSTED') : rejected(503, 'UNAVAILABLE'));
  const failed = await chat({ selectedModel: 'gemini-3.1-pro-preview' });
  assert.equal(failed.body.code, 'MODEL_TIER_UNAVAILABLE');
  assert.match(failed.body.error, /безкоштовному тарифі/);
  assert.deepEqual(failed.body.diagnostics.attempts.map((attempt: any) => [attempt.model, attempt.code]), [
    ['gemini-3.1-pro-preview', 'MODEL_TIER_UNAVAILABLE'], ['gemini-3.5-flash-lite', 'QUOTA_EXCEEDED'], ['gemini-3.1-flash-lite', 'PROVIDER_UNAVAILABLE']]);
  assert.deepEqual(failed.body.diagnostics.attempts[0].quota.violations.map((violation: any) => violation.limit), [0, 0]);

  mockProvider(model => model === 'gemini-3.1-pro-preview' ? zeroQuota() : success({ reply: 'Готово.', taskUpdates: [] }));
  const answered = await chat({ selectedModel: 'gemini-3.1-pro-preview', currentTasks: [{ id: 't1', title: 'Референси' }] });
  assert.equal(answered.body.usedModel, 'gemini-3.5-flash-lite');
  assert.equal(answered.body.aiMetrics.selectedModelFailure, 'MODEL_TIER_UNAVAILABLE');
  // Remembered like a 404: the next request does not wait on Pro first.
  calls.length = 0;
  const next = await chat({ selectedModel: 'gemini-3.1-pro-preview', currentTasks: [{ id: 't1', title: 'Референси' }] });
  assert.equal(calls[0].model, 'gemini-3.5-flash-lite');
  assert.equal(next.body.aiMetrics.selectedModelFailure, 'MODEL_TIER_UNAVAILABLE');
  // A missing quotaValue is not mistaken for 0.
  assert.deepEqual(quotaInfoFromError({ status: 429, message: JSON.stringify({ error: { details: [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaValue: '' }] }] } }) }),
    { violations: [{ unit: 'requests', window: 'day' }] });
});

test('confirmation words accepted by the client also trigger the stale-proposal guard', async () => {
  mockProvider(() => success({ reply: 'Should not be called.', taskUpdates: [] }));
  for (const prompt of ['ок', 'Окей!', 'Застосувати', 'застосуй', 'зберегти', 'Збережи.', 'підтверджено']) {
    const result = await chat({ prompt, lastAssistantProposalStatus: 'stale' });
    assert.equal(result.status, 200, prompt);
    assert.equal(result.body.source, 'stale-proposal-clarification', prompt);
  }
  assert.equal(calls.length, 0);
});

test('app-written chat replies follow the person’s ти from recent messages', async () => {
  mockProvider(() => success({ reply: 'Should not be called.', taskUpdates: [] }));
  const conversation = [{ role: 'user', content: '[13.10 09:00] Слухай, перенеси звіт на завтра' }, { role: 'assistant', content: 'Підготував пропозицію.' }];
  const stale = await chat({ prompt: 'Так', lastAssistantProposalStatus: 'stale', conversation });
  assert.equal(stale.body.source, 'stale-proposal-clarification');
  assert.match(stale.body.reply, /Повтори, будь ласка, сам запит або назви/);
  const staleVy = await chat({ prompt: 'Так', lastAssistantProposalStatus: 'stale' });
  assert.match(staleVy.body.reply, /Повторіть, будь ласка, сам запит або назвіть/, 'no signal: "ви"');
  assert.equal(calls.length, 0);
});

test('a rejected thinking level is remembered only for that model and level', async () => {
  mockProvider((_model, body) => body.generationConfig?.thinkingConfig?.thinkingLevel === 'MEDIUM'
    ? rejected(400, 'INVALID_ARGUMENT', 'Thinking level MEDIUM is not supported for this model.')
    : json({ candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] }));
  const ai = new GoogleGenAI({ apiKey: 'test-only-fake-key' });
  const run = (thinking: 'low' | 'medium') => generateGeminiWithFallback({ ai, contents: 'Test', config: {}, selectedModel: 'gemini-3.8-flash', fallbackModels: [], thinking });
  await run('medium');
  assert.deepEqual(calls.map(call => call.body.generationConfig?.thinkingConfig?.thinkingLevel), ['MEDIUM', undefined]);
  calls.length = 0;
  const repeated = await run('medium');
  assert.deepEqual(calls.map(call => call.body.generationConfig?.thinkingConfig?.thinkingLevel), [undefined]);
  assert.equal(repeated.metrics.thinking, 'provider-default');
  calls.length = 0;
  const low = await run('low');
  assert.deepEqual(calls.map(call => call.body.generationConfig?.thinkingConfig?.thinkingLevel), ['LOW']);
  assert.equal(low.metrics.thinking, 'LOW');
});

const turnText = (body: any) => body.contents.flatMap((content: any) => content.parts.map((part: any) => part.text ?? '')).join('\n');

test('missed-start work correction survives the screenshot clarification sequence in JSON and tools', async () => {
  const cases = [
    {
      lang: 'uk', title: 'Робота над анімацією',
      original: 'зміни таймер на 3 години бо я забув його включити',
      clarification: 'Про анімацію',
      assistant: 'Я бачу активне завдання «Робота над анімацією» у вкладці «Фріланс». Ви хочете змінити час у таймері на 3 години чи продовжити роботу над наступними кроками?',
      repeated: 'зміни таймер на 3 години',
    },
    {
      lang: 'en', title: 'Animation work',
      original: 'change the timer to 3 hours because I forgot to start the timer',
      clarification: 'About animation',
      assistant: 'I see the active task «Animation work» in Freelance. Would you like to change its timer to 3 hours or continue the next steps?',
      repeated: 'change the timer to 3 hours',
    },
  ];
  for (const tools of [true, false]) {
    for (const example of cases) {
      const run = async () => {
        mockProvider((_model, body) => {
          const schema = tools
            ? body.tools[0].functionDeclarations.find((item: any) => item.name === 'propose_update_task').parameters
            : body.generationConfig.responseSchema.properties.taskUpdates.items;
          assert.equal(schema.properties.recordedWorkSeconds.minimum, 0);
          assert.equal(schema.properties.recordedWorkSeconds.maximum, 6000059);
          assert.match(body.systemInstruction.parts[0].text, /ROUTE task_command/);
          return success({ reply: 'Proposal: total recorded work is 3 hours.', taskUpdates: [{ id: 'animation', recordedWorkSeconds: 10800 }] });
        });
        const result = await chat({
          lang: example.lang, prompt: example.repeated,
          conversation: [
            { role: 'user', content: example.original },
            { role: 'assistant', content: 'Please specify the task.' },
            { role: 'user', content: example.clarification },
            { role: 'assistant', content: example.assistant },
          ],
          currentTasks: [
            { id: 'animation', title: example.title, phase: 'freelance', done: false, timerMode: 'stopwatch', timeSpentSeconds: 600 },
            { id: 'unrelated', title: 'Read a book', phase: 'personal', done: false },
          ],
          tabs: ['freelance', 'personal'],
        });
        assert.equal(result.status, 200, `${example.lang}, tools=${tools}`);
        assert.equal(calls.length, 1, 'the resolved target must not trigger clarification or fallback');
        assert.deepEqual(result.body.taskUpdates, [{ id: 'animation', recordedWorkSeconds: 10800 }]);
        assert.deepEqual(result.body.tasks, []);
        assert.deepEqual(result.body.taskDeletions, []);
      };
      if (tools) await run();
      else await withToolsOff(run);
    }
  }
});

test('ordinary countdown requests cannot authorize provider-invented recorded work', async () => {
  for (const tools of [true, false]) {
    const run = async () => {
      mockProvider(() => success({ reply: 'Changed recorded work.', taskUpdates: [{ id: 'animation', recordedWorkSeconds: 10800 }] }));
      const result = await chat({ prompt: 'Зміни таймер для анімації на 3 години', currentTasks: [
        { id: 'animation', title: 'Робота над анімацією', timerMode: 'stopwatch', done: false },
      ] });
      assert.equal(result.status, 200);
      assert.deepEqual(result.body.taskUpdates, []);
      assert.deepEqual(result.body.tasks, []);
    };
    if (tools) await run();
    else await withToolsOff(run);
  }
});

test('retrospective timer requests cannot silently become future countdown proposals', async () => {
  for (const tools of [true, false]) {
    const run = async () => {
      mockProvider(() => success({ reply: 'Proposed countdown.', taskUpdates: [{ id: 'animation', timerMode: 'countdown', countdownDurationSeconds: 10800 }] }));
      const result = await chat({ prompt: 'зміни таймер для анімації на 3 години бо я забув його включити', currentTasks: [
        { id: 'animation', title: 'Робота над анімацією', timerMode: 'stopwatch', done: false },
      ] });
      assert.equal(result.status, 200);
      assert.deepEqual(result.body.taskUpdates, []);
      assert.deepEqual(result.body.tasks, []);
    };
    if (tools) await run();
    else await withToolsOff(run);
  }
});

test('recorded-work proposal boundaries survive both transports as absolute totals', async () => {
  for (const tools of [true, false]) {
    for (const recordedWorkSeconds of [0, 6000059]) {
      const run = async () => {
        mockProvider(() => success({ reply: 'Proposed corrected total.', taskUpdates: [{ id: 'animation', recordedWorkSeconds }] }));
        const result = await chat({ prompt: `Correct recorded time for Animation to ${recordedWorkSeconds} seconds`, lang: 'en', currentTasks: [
          { id: 'animation', title: 'Animation', timerMode: 'stopwatch', timeSpentSeconds: 900, done: false },
        ] });
        assert.equal(result.status, 200);
        assert.deepEqual(result.body.taskUpdates, [{ id: 'animation', recordedWorkSeconds }], 'existing time must not be added to the requested replacement total');
      };
      if (tools) await run();
      else await withToolsOff(run);
    }
  }
});

test('invalid or mixed recorded-work proposals fail atomically in JSON and tools', async () => {
  const invalidUpdates = [
    { recordedWorkSeconds: -1 },
    { recordedWorkSeconds: 6000060 },
    { recordedWorkSeconds: 1.5 },
    { recordedWorkSeconds: '10800' },
    { recordedWorkSeconds: 10800, timerMode: 'stopwatch' },
    { recordedWorkSeconds: 10800, countdownDurationSeconds: 10800 },
    { recordedWorkSeconds: 10800, timerAction: 'start' },
    { recordedWorkSeconds: 10800, schedule: { startAt: '2026-10-20T10:00:00+03:00', recurrence: 'once', timeZone: 'Europe/Kyiv', leadMinutes: 5 } },
  ];
  for (const tools of [true, false]) {
    for (const update of invalidUpdates) {
      const run = async () => {
        mockProvider(() => success({ reply: 'Invalid correction.', taskUpdates: [{ id: 'animation', ...update }] }));
        const result = await chat({ prompt: 'Зарахуй 3 години роботи для анімації', currentTasks: [
          { id: 'animation', title: 'Робота над анімацією', timerMode: 'stopwatch', done: false },
        ] });
        assert.equal(result.status, 502, JSON.stringify(update));
        assert.equal(result.body.code, 'INVALID_AI_RESPONSE');
        assert.deepEqual(result.body.taskUpdates, []);
        assert.deepEqual(result.body.tasks, []);
      };
      if (tools) await run();
      else await withToolsOff(run);
    }
  }
});

test('future scheduled tasks cannot receive retrospective recorded work', async () => {
  for (const tools of [true, false]) {
    const run = async () => {
      mockProvider(() => success({ reply: 'Invalid future correction.', taskUpdates: [{ id: 'animation', recordedWorkSeconds: 10800 }] }));
      const result = await chat({ prompt: 'Зарахуй 3 години роботи для анімації', currentTasks: [
        { id: 'animation', title: 'Робота над анімацією', timerMode: 'stopwatch', done: false, scheduledPending: true,
          scheduledFor: Date.parse('2026-10-20T10:00:00+03:00') },
      ] });
      assert.equal(result.status, 502);
      assert.equal(result.body.code, 'INVALID_AI_RESPONSE');
      assert.deepEqual(result.body.taskUpdates, []);
    };
    if (tools) await run();
    else await withToolsOff(run);
  }
});

test('a free message gets general coaching with proposal-only tools, not a personal interview or a strategy', async () => {
  mockProvider((_model, body) => {
    const system = body.systemInstruction.parts[0].text;
    assert.match(system, /ROUTE general/);
    assert.doesNotMatch(system, /PERSONAL_DISCOVERY RULES/);
    // Changes can only be proposed through the propose_* tools; there is no JSON strategy/task schema.
    assert.equal(body.generationConfig?.responseSchema, undefined);
    assert.ok(body.tools[0].functionDeclarations.some((declaration: any) => declaration.name === 'propose_create_task'));
    assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingLevel: 'MINIMAL' });
    assert.match(turnText(body), /REQUEST ROUTE: general/);
    assert.doesNotMatch(turnText(body), /PERSONAL_DISCOVERY/);
    return success({ reply: 'Спробуй почати з короткого блоку без сповіщень.', tasks: [{ title: 'Короткий блок фокусу', phase: 'work', priority: 2, steps: 0 }], strategy: { status: 'ready', narrative: 'FORBIDDEN' } });
  });
  const result = await chat({ prompt: 'Як мені зосередитись після обіду?', strategyContext: { goals: [] }, currentTasks: [{ id: 't', title: 'Study', done: false }], tabs: ['work'] });
  assert.equal(result.status, 200);
  assert.equal(calls.length, 1);
  assert.match(result.body.reply, /короткого блоку/);
  // A proposed new task awaits the person's Apply; no existing task is touched and no strategy is set.
  assert.deepEqual(result.body.tasks.map((task: any) => task.title), ['Короткий блок фокусу']);
  assert.deepEqual(result.body.taskUpdates, []);
  assert.deepEqual(result.body.taskDeletions, []);
  assert.equal(result.body.strategy, undefined);
  assert.doesNotMatch(JSON.stringify(result.body), /FORBIDDEN/);
});

test('chat history is sent as real alternating turns with the dynamic request last', async () => {
  mockProvider((_model, body) => {
    assert.deepEqual(body.contents.map((turn: any) => turn.role), ['user', 'model', 'user', 'model', 'user']);
    assert.equal(body.contents[1].parts[0].text, 'HISTORY-WELCOME');
    assert.deepEqual(body.contents[2].parts.map((part: any) => part.text), ['HISTORY-A', 'HISTORY-B']);
    const last = body.contents.at(-1).parts.map((part: any) => part.text).join('\n');
    assert.match(last, /^REQUEST CONTEXT/);
    assert.match(last, /CURRENT USER MESSAGE:\nДякую, це допомогло$/);
    assert.doesNotMatch(last, /HISTORY-/);
    return success({ reply: 'Радий допомогти.' });
  });
  const result = await chat({ prompt: 'Дякую, це допомогло', conversation: [
    { role: 'assistant', content: 'HISTORY-WELCOME' }, { role: 'user', content: 'HISTORY-A' }, { role: 'user', content: 'HISTORY-B' }, { role: 'assistant', content: 'HISTORY-C' },
  ] });
  assert.equal(result.status, 200);
  assert.equal(calls.length, 1);
});

test('chat system instructions are static per route and read-only routes omit the action contract', async () => {
  const systems: Record<string, string[]> = {};
  mockProvider((_model, body) => {
    const route = /REQUEST ROUTE: (\w+)/.exec(turnText(body))![1];
    (systems[route] ||= []).push(body.systemInstruction.parts[0].text);
    return success({ reply: 'Готово.', tasks: [], taskUpdates: [] });
  });
  const requests = [
    { prompt: 'Як запустити таймер?', clientClock: { now: '2026-10-12T09:00:00Z', timeZone: 'Europe/Kyiv' }, currentTasks: [{ id: 'a', title: 'UNIQUE-A' }] },
    { prompt: 'Як працює меню?', clientClock: { now: '2026-11-01T20:00:00Z', timeZone: 'UTC' }, lang: 'en', currentTasks: [{ id: 'b', title: 'UNIQUE-B' }] },
    { prompt: 'Проаналізуй поточні завдання', intent: 'analysis', currentTasks: [{ id: 'c', title: 'UNIQUE-C' }] },
    { prompt: 'Видали завдання UNIQUE-D', currentTasks: [{ id: 'd', title: 'UNIQUE-D' }] },
  ];
  for (const request of requests) assert.equal((await chat(request)).status, 200);
  assert.equal(systems.help.length, 2);
  assert.equal(systems.help[0], systems.help[1], 'same route, different data: byte-identical system prefix');
  for (const text of [...systems.help, ...systems.workspace_analysis]) {
    assert.doesNotMatch(text, /APPLICATION ACTION CONTRACT|strategy\.actions|UNIQUE-|2026-/);
  }
  assert.match(systems.task_command[0], /APPLICATION ACTION CONTRACT/);
  assert.doesNotMatch(systems.task_command[0], /UNIQUE-D|Видали/);
});

test('each workspace task is sent once with its temporal fields merged in', async () => {
  mockProvider((_model, body) => {
    const text = turnText(body);
    assert.equal(text.split('UNIQUE-TASK-TITLE').length - 1, 2, 'once in the workspace record, once in the user message');
    const context = JSON.parse(/WORKSPACE CONTEXT:\n([\s\S]+?)\n\nCURRENT USER MESSAGE:/.exec(text)![1]);
    const [task] = context.activeTasks;
    assert.deepEqual(task.plannedDay, { date: '2026-10-12', relation: 'today', weekday: 'Monday', daysFromToday: 0, week: 'this' });
    assert.ok(task.statuses.includes('planned_today_unfinished'));
    assert.equal(task.plannedDate, undefined);
    const temporal = JSON.parse(/TASK TEMPORAL CONTEXT: (.+)/.exec(text)![1]);
    assert.equal(temporal.tasks, undefined);
    assert.equal(temporal.clock.localDate, '2026-10-12');
    return success({ reply: 'Пропоную таймер.', taskUpdates: [{ id: 't1', timerMode: 'countdown', countdownDurationSeconds: 1500 }] });
  });
  const result = await chat({ prompt: 'Додай таймер на 25 хвилин до завдання UNIQUE-TASK-TITLE', clientClock: { now: '2026-10-12T09:00:00Z', timeZone: 'Europe/Kyiv' },
    currentTasks: [{ id: 't1', title: 'UNIQUE-TASK-TITLE', done: false, plannedDate: '2026-10-12' }] });
  assert.equal(result.status, 200);
  assert.equal(calls.length, 1);
});
