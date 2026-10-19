import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PSTask } from '../src/types';
import type { AgentWorkspace } from '../src/utils/aiAgentActions';
import {
  AGENT_MAX_ROUNDS, AGENT_SYSTEM_INSTRUCTION, AGENT_TOOL_DECLARATIONS, applyConfirmedAgentAction, runAgentTurn, withoutRepeatedSummaries,
  type AgentGenerationFunction,
} from './aiAgent';
import { AIRequestError, type AIFunctionCall, type GeminiContent } from './geminiGeneration';

const NOW = Date.parse('2026-10-19T09:00:00.000Z');
const task = (overrides: Partial<PSTask> = {}): PSTask => ({
  id: 'animation', title: 'Робота над анімацією', phase: 'focus', priority: 2,
  steps: 3, currentStep: 0, done: false, pinned: false, createdAt: NOW - 86_400_000,
  stepList: [1, 2, 3].map(number => ({ id: 'step-' + number, title: 'Етап ' + number, done: false })),
  timerMode: 'countdown', countdownDurationSeconds: 7200, countdownRemainingSeconds: 7200,
  timerRunning: false, ...overrides,
});
const workspace = (overrides: Partial<AgentWorkspace> = {}): AgentWorkspace => ({
  tasks: [task()], tabs: [{ id: 'focus', name: 'Робота' }], deletedTasks: [], notes: [], ...overrides,
});
type Request = Parameters<AgentGenerationFunction>[0];
type Response = Awaited<ReturnType<AgentGenerationFunction>>;
type ScriptStep = Response | ((request: Request) => Response | Promise<Response>);
function scripted(steps: ScriptStep[]) {
  const requests: Request[] = [];
  const generate: AgentGenerationFunction = async request => {
    const step = steps[requests.length];
    requests.push({ ...request, contents: structuredClone(request.contents) });
    assert.ok(step, 'Unexpected extra model round');
    const result = typeof step === 'function' ? await step(request) : step;
    return { usedModel: request.selectedModel, metrics: {
      model: request.selectedModel!, elapsedMs: 1, attempts: 1, thinking: 'LOW',
      promptTokens: 10, outputTokens: 2, attemptModels: [request.selectedModel!],
    }, ...result };
  };
  return { requests, generate };
}
const calls = (...functionCalls: AIFunctionCall[]): Response => ({ text: '', functionCalls });
const call = (name: string, args: unknown): AIFunctionCall => ({ name, args });
const base = { userText: 'збільш час роботи над анімацією до 3х годин і заверш 3 етап', now: NOW, timeZone: 'Europe/Kyiv', lang: 'uk' };
const responses = (request: Request): any[] => {
  const contents = request.contents as GeminiContent[];
  return contents.at(-1)!.parts!.map(part => part.functionResponse);
};

test('compound request resolves its task, configures a paused countdown and completes step 3 before the final text', async () => {
  const original = workspace(), before = structuredClone(original), deltas: string[] = [];
  const fake = scripted([
    calls(call('find_tasks', { query: 'анімацією' })),
    request => {
      assert.equal(responses(request)[0].response.tasks[0].id, 'animation');
      return calls(call('set_countdown', { taskId: 'animation', minutes: 180, start: false }),
        call('set_step_done', { taskId: 'animation', step: 3, done: true }));
    },
    request => {
      const parts = responses(request);
      assert.deepEqual(parts.map(part => part.name), ['set_countdown', 'set_step_done']);
      assert.equal(parts[0].response.ok, true);
      assert.equal(parts[0].response.tasks[0].timer.countdownMinutes, 180);
      assert.equal(parts[0].response.tasks[0].timer.running, false);
      assert.equal(parts[1].response.tasks[0].steps[2].done, true);
      return { text: 'Таймер — 3 години, крок 3 виконано.' };
    },
  ]);
  const result = await runAgentTurn({ ...base, workspace: original, generate: fake.generate, onTextDelta: delta => deltas.push(delta) });
  assert.deepEqual(result.actions.map(item => item.action.type), ['set_countdown', 'set_step_done']);
  assert.deepEqual(result.actions.map(item => item.changedTaskIds), [['animation'], ['animation']]);
  assert.equal(result.text, 'Таймер — 3 години, крок 3 виконано.');
  assert.deepEqual(deltas, [result.text]);
  assert.deepEqual(result.pendingConfirmations, []);
  assert.deepEqual(original, before);
  assert.equal(result.metrics.attempts, 3);
  assert.equal(result.metrics.promptTokens, 30);
  assert.equal(result.metrics.toolCalls, 3);
  assert.equal(fake.requests[0].selectedModel, 'gemini-3.8-flash');
  assert.equal(fake.requests[0].thinking, 'agent');
  assert.match(fake.requests[0].config.systemInstruction, /2026-10-19 12:00:00/);
});

test('invalid arguments are returned as an error functionResponse and the model can recover', async () => {
  const fake = scripted([
    calls(call('set_countdown', { taskId: 'animation', minutes: '180' })),
    request => {
      assert.equal(responses(request)[0].response.ok, false);
      assert.equal(responses(request)[0].response.code, 'invalid');
      assert.match(responses(request)[0].response.error, /minutes/);
      return calls(call('get_task', { taskId: 'animation' }));
    },
    calls(call('set_countdown', { taskId: 'animation', minutes: 180 })),
    { text: 'Таймер змінено на 3 години.' },
  ]);
  const result = await runAgentTurn({ ...base, workspace: workspace(), generate: fake.generate });
  assert.equal(result.actions.length, 1);
  assert.equal(result.actions[0].action.type, 'set_countdown');
});

test('unknown task IDs produce not_found for both reads and actions, never an applied action', async () => {
  const fake = scripted([
    calls(call('get_task', { taskId: 'missing' }), call('pause_timer', { taskId: 'missing' })),
    request => {
      for (const part of responses(request)) {
        assert.equal(part.response.ok, false);
        assert.equal(part.response.code, 'not_found');
      }
      return { text: 'Не знайшов цього завдання.' };
    },
  ]);
  const result = await runAgentTurn({ ...base, workspace: workspace(), generate: fake.generate });
  assert.deepEqual(result.actions, []);
});

test('destructive deletion collects a pending action and leaves the task unchanged', async () => {
  const original = workspace(), before = structuredClone(original);
  const fake = scripted([
    calls(call('find_tasks', { query: 'анімація' })),
    calls(call('delete_task', { taskId: 'animation', reason: 'cancelled' })),
    request => {
      const response = responses(request)[0].response;
      assert.equal(response.ok, false);
      assert.equal(response.code, 'needs_confirmation');
      assert.equal(response.awaitingConfirmation, true);
      assert.match(response.instruction, /must confirm/);
      return calls(call('get_task', { taskId: 'animation' }));
    },
    request => {
      assert.equal(responses(request)[0].response.deleted, false);
      assert.equal(responses(request)[0].response.task.timer.countdownMinutes, 120);
      return { text: 'Видалення «Робота над анімацією» потребує підтвердження в додатку.' };
    },
  ]);
  const result = await runAgentTurn({ ...base, workspace: original, generate: fake.generate });
  assert.deepEqual(result.pendingConfirmations, [{ type: 'delete_task', taskId: 'animation', reason: 'cancelled' }]);
  assert.deepEqual(result.actions, []);
  assert.deepEqual(original, before);
});

test('ask_user preserves self-contained options, ends the loop and skips later calls in the same batch', async () => {
  const clarification = { question: 'Таймер чи записаний час?', options: [
    { label: 'Таймер', message: 'Постав таймер на 3 години для «Робота над анімацією»' },
    { label: 'Записаний час', message: 'Зарахуй 3 години для «Робота над анімацією»' },
  ] };
  const fake = scripted([calls(call('ask_user', clarification), call('complete_task', { taskId: 'animation' }))]);
  const result = await runAgentTurn({ ...base, workspace: workspace(), generate: fake.generate });
  assert.deepEqual(result.clarification, clarification);
  assert.equal(fake.requests.length, 1);
  assert.equal(result.text, clarification.question);
  assert.deepEqual(result.actions, []);
});

test('open_personal_coaching ends the loop with a handoff and emits no premature text', async () => {
  const fake = scripted([calls(call('open_personal_coaching', { reason: 'The person needs help with burnout and life goals.' }))]);
  const deltas: string[] = [];
  const result = await runAgentTurn({ ...base, workspace: workspace(), generate: fake.generate, onTextDelta: delta => deltas.push(delta) });
  assert.equal(result.handoff, 'personal');
  assert.equal(fake.requests.length, 1);
  assert.deepEqual(result.actions, []);
  assert.deepEqual(deltas, []);
});

test('eight-round cap returns successful actions and honestly reports unfinished work', async () => {
  const fake = scripted([
    calls(call('get_task', { taskId: 'animation' })),
    calls(call('set_countdown', { taskId: 'animation', minutes: 180 })),
    ...Array.from({ length: AGENT_MAX_ROUNDS - 2 }, () => calls(call('list_tabs', {}))),
  ]);
  const result = await runAgentTurn({ ...base, workspace: workspace(), generate: fake.generate });
  assert.equal(fake.requests.length, 8);
  assert.equal(result.actions.length, 1);
  assert.match(result.actions[0].summary.uk, /3 год/); assert.doesNotMatch(result.text, /3 год/);
  assert.match(result.text, /не вдалося/);
  assert.doesNotMatch(result.text, /Unknown|Invalid|Missing/);
});

test('pre-aborted and mid-round abort signals stop without another model round', async () => {
  const pre = new AbortController();
  pre.abort(new DOMException('cancelled', 'AbortError'));
  let requests = 0;
  const never: AgentGenerationFunction = async () => { requests++; return new Promise(() => {}); };
  await assert.rejects(runAgentTurn({ ...base, workspace: workspace(), generate: never, signal: pre.signal }), { name: 'AbortError' });
  assert.equal(requests, 0);
  const controller = new AbortController();
  const running = runAgentTurn({ ...base, workspace: workspace(), generate: never, signal: controller.signal });
  controller.abort(new DOMException('cancelled', 'AbortError'));
  await assert.rejects(running, { name: 'AbortError' });
  assert.equal(requests, 1);
});

test('a continuation failure returns already applied actions with an honest failure summary', async () => {
  const fake = scripted([
    calls(call('set_countdown', { taskId: 'animation', minutes: 180 })),
    () => { throw new AIRequestError('TIMEOUT', { elapsedMs: 10, keyId: 'safe-key-id', attempts: [{ model: 'gemini-3.8-flash', code: 'TIMEOUT', elapsedMs: 10 }] }); },
  ]);
  const result = await runAgentTurn({ ...base, workspace: workspace(), generate: fake.generate });
  assert.equal(result.actions.length, 1);
  assert.match(result.actions[0].summary.uk, /3 год/); assert.doesNotMatch(result.text, /3 год/);
  assert.match(result.text, /TIMEOUT/);
  assert.equal(result.metrics.attempts, 2);
  assert.equal(result.metrics.failedAttempts?.[0].code, 'TIMEOUT');
  assert.equal(result.metrics.keyId, 'safe-key-id');
});

test('Gemini receives the exact signed model turn followed by ordered user functionResponse parts', async () => {
  const modelContent: GeminiContent = { role: 'model', parts: [
    { functionCall: { id: 'read-1', name: 'get_task', args: { taskId: 'animation' } }, thoughtSignature: 'opaque-thought-signature' },
    { functionCall: { id: 'read-2', name: 'list_tabs', args: {} } },
  ] };
  const fake = scripted([
    { modelContent, candidates: [{ content: modelContent }] },
    request => {
      const contents = request.contents as GeminiContent[];
      assert.deepEqual(contents.at(-2), modelContent);
      assert.equal(contents.at(-1)!.role, 'user');
      const parts = responses(request);
      assert.deepEqual(parts.map(part => [part.name, part.id]), [['get_task', 'read-1'], ['list_tabs', 'read-2']]);
      assert.equal(parts[0].response.ok, true);
      assert.equal(parts[0].response.task.id, 'animation');
      assert.equal(parts[1].response.ok, true);
      assert.equal(parts[1].response.tabs[0].id, 'focus');
      return { text: 'Перевірив.' };
    },
  ]);
  await runAgentTurn({ ...base, workspace: workspace(), historyContents: [
    { role: 'user', parts: [{ text: 'Зробімо таймер.' }] }, { role: 'model', parts: [{ text: 'На який час?' }] },
  ], generate: fake.generate });
});

test('confirmed actions validate and apply without a model call, while invalid fields stay rejected', () => {
  const original = workspace();
  const confirmation = applyConfirmedAgentAction(original, { type: 'delete_task', taskId: 'animation' }, { now: NOW, timeZone: 'Europe/Kyiv' });
  assert.equal(confirmation.result.ok, true);
  assert.equal(confirmation.workspace.tasks.length, 0);
  assert.equal(confirmation.workspace.deletedTasks[0].id, 'animation');
  assert.equal(confirmation.applied?.action.type, 'delete_task');
  assert.deepEqual(confirmation.applied?.changedTaskIds, ['animation']);
  assert.equal(original.tasks.length, 1);
  const invalid = applyConfirmedAgentAction(original, { type: 'delete_task', taskId: 'animation', confirmed: true }, { now: NOW });
  assert.equal(invalid.result.ok, false);
  assert.equal(invalid.workspace, original);
});

test('tool declarations have a stable unique order and cover every action plus read/control tools', () => {
  const names = AGENT_TOOL_DECLARATIONS.map(tool => tool.name);
  assert.equal(new Set(names).size, names.length);
  for (const tool of AGENT_TOOL_DECLARATIONS) {
    assert.equal(tool.parametersJsonSchema.type, 'object');
    assert.equal(tool.parametersJsonSchema.additionalProperties, false);
    for (const name of tool.parametersJsonSchema.required) assert.ok(Object.hasOwn(tool.parametersJsonSchema.properties, name));
  }
  assert.deepEqual(names.slice(0, 7), ['find_tasks', 'get_task', 'list_tasks', 'list_tabs', 'get_stats', 'list_history', 'list_notes']);
  assert.deepEqual(names.slice(-2), ['ask_user', 'open_personal_coaching']);
  for (const name of ['create_task', 'update_task', 'plan_day', 'complete_task', 'reopen_task', 'add_steps', 'rename_step', 'set_step_done',
    'delete_step', 'start_timer', 'continue_after_expiry', 'finish_after_expiry', 'shift_day', 'pause_timer', 'clear_countdown', 'finish_limited_start', 'reset_time', 'set_countdown',
    'extend_countdown', 'limited_start', 'set_recorded_time', 'create_tab', 'rename_tab', 'set_tab_color', 'delete_tab',
    'delete_task', 'restore_task', 'permanently_delete_task', 'clear_completed', 'create_note', 'update_note', 'open_view', 'reveal_task']) assert.ok(names.includes(name), name);
});

test('read tools validate arguments and use the supplied local date, with compact period statistics', async () => {
  const fake = scripted([
    calls(call('find_tasks', { query: 'анімація', confirmed: true }), call('list_tasks', { filter: 'today' }),
      call('get_stats', { period: 'today' })),
    request => {
      const parts = responses(request);
      assert.equal(parts[0].response.code, 'invalid');
      assert.equal(parts[1].response.tasks[0].id, 'animation');
      assert.equal(parts[2].response.period, 'today');
      assert.equal(parts[2].response.completed, 1);
      assert.equal(parts[2].response.completedRecordedMinutes, 30);
      assert.equal(parts[2].response.workInsights.observationDays, 28);
      return { text: 'Сьогодні виконано одне завдання.' };
    },
  ]);
  await runAgentTurn({ ...base, workspace: workspace({ tasks: [task({ plannedDate: '2026-10-19' }),
    task({ id: 'done', done: true, completedAt: NOW - 1000, timeSpentSeconds: 1800 })] }), generate: fake.generate });
});

test('an explicitly selected model precedes the default Flash and Lite fallback queue', async () => {
  const fake = scripted([{ text: 'Гаразд.' }]);
  await runAgentTurn({ ...base, selectedModel: 'gemini-3.1-flash-lite', workspace: workspace(), generate: fake.generate });
  assert.equal(fake.requests[0].selectedModel, 'gemini-3.1-flash-lite');
  assert.deepEqual(fake.requests[0].fallbackModels, ['gemini-3.8-flash', 'gemini-3.5-flash-lite']);
});

test('list_notes exposes every note and note updates return only the changed note', async () => {
  const notes = Array.from({ length: 25 }, (_, index) => ({
    id: 'note-' + index, title: 'Note ' + index, content: 'x'.repeat(5000), createdAt: NOW, updatedAt: NOW,
  }));
  const fake = scripted([
    calls(call('list_notes', {})),
    request => {
      const response = responses(request)[0].response;
      assert.equal(response.notes.length, 25);
      assert.equal(response.notes[24].id, 'note-24');
      assert.equal(response.notes[24].content.length, 5000);
      return calls(call('update_note', { noteId: 'note-24', title: 'Changed' }));
    },
    request => {
      const response = responses(request)[0].response;
      assert.equal(response.notes.length, 1);
      assert.equal(response.notes[0].id, 'note-24');
      assert.equal(response.notes[0].title, 'Changed');
      assert.equal(response.notes[0].content.length, 4000);
      assert.equal(response.data, undefined);
      return { text: 'Нотатку оновлено.' };
    },
  ]);
  await runAgentTurn({ ...base, workspace: workspace({ notes }), generate: fake.generate });
});

test('completed tasks without a positive reading remain unmeasured rather than a zero-work total', async () => {
  const fake = scripted([
    calls(call('get_stats', { period: 'today' })),
    request => {
      const response = responses(request)[0].response;
      assert.equal(response.completed, 2);
      assert.equal(response.completedRecordedMinutes, null);
      assert.deepEqual(response.measurementCoverage, { measuredTasks: 0, unmeasuredTasks: 2, ratio: 0 });
      assert.match(response.evidenceLimits, /lifetime recorded work/);
      return { text: 'Два завершення; час не виміряно.' };
    },
  ]);
  await runAgentTurn({ ...base, workspace: workspace({ tasks: [
    task({ id: 'a', done: true, completedAt: NOW - 1000 }),
    task({ id: 'b', done: true, completedAt: NOW - 1000, timeSpentSeconds: 0 }),
  ] }), generate: fake.generate });
});

test('plain final user history is merged while a user functionResponse turn remains separate', async () => {
  const plain = scripted([request => {
    const contents = request.contents as GeminiContent[];
    assert.equal(contents.length, 1);
    assert.deepEqual(contents[0].parts, [{ text: 'На 3 години.' }, { text: base.userText }]);
    return { text: 'Гаразд.' };
  }]);
  await runAgentTurn({ ...base, workspace: workspace(), historyContents: [{ role: 'user', parts: [{ text: 'На 3 години.' }] }], generate: plain.generate });
  const tool = scripted([request => {
    const contents = request.contents as GeminiContent[];
    assert.equal(contents.length, 2);
    assert.ok(contents[0].parts![0].functionResponse);
    assert.deepEqual(contents[1].parts, [{ text: base.userText }]);
    return { text: 'Гаразд.' };
  }]);
  await runAgentTurn({ ...base, workspace: workspace(), historyContents: [
    { role: 'user', parts: [{ functionResponse: { name: 'list_tabs', response: { ok: true } } }] },
  ], generate: tool.generate });
});

test('invalid fixed clock inputs fail as classified request errors before generation', async () => {
  const fake = scripted([]);
  for (const overrides of [{ now: NaN }, { now: Infinity }, { now: -1 }, { timeZone: 'Invalid/Zone' }]) {
    await assert.rejects(runAgentTurn({ ...base, ...overrides, workspace: workspace(), generate: fake.generate }),
      error => error instanceof AIRequestError && error.code === 'INVALID_AI_REQUEST');
  }
  assert.equal(fake.requests.length, 0);
});

test('empty final prose still names the exact pending destructive action', async () => {
  const fake = scripted([calls(call('delete_task', { taskId: 'animation' })), { text: '' }]);
  const result = await runAgentTurn({ ...base, workspace: workspace(), generate: fake.generate });
  assert.match(result.text, /підтвердження/);
  assert.match(result.text, /видалити завдання «Робота над анімацією»/);
});

test('day planning uses one five-item action, tab names and the existing animation task, then replies briefly above the tool schedule', async () => {
  const userText = 'сплануй мені день, 1 потрібно встановити жалюзі, спланувати анімацію 30хв, після планування перейти до анімації 5 годин, пізніше навчання друку 30 хв, відпочинок';
  const original = workspace({ tabs: [{ id: 'focus', name: 'Робота' }, { id: 'learn', name: 'Навчання' }, { id: 'home', name: 'Особисте' }] });
  const items = [
    { title: 'Встановити жалюзі', phase: 'Особисте', priority: 1, durationMinutes: 60, estimated: true },
    { title: 'Спланувати анімацію', phase: 'Робота', priority: 2, durationMinutes: 30 },
    { taskId: 'animation', phase: 'Робота', priority: 1, durationMinutes: 300 },
    { title: 'Навчання друку', phase: 'Навчання', priority: 2, durationMinutes: 30 },
    { title: 'Відпочинок', phase: 'Особисте', priority: 3, durationMinutes: 60, estimated: true },
  ];
  const fake = scripted([
    request => {
      assert.equal((request.contents as GeminiContent[]).at(-1)!.parts![0].text, userText);
      assert.match(request.config.systemInstruction, /call plan_day ONCE/);
      assert.match(request.config.systemInstruction, /пів другої.*13:30/);
      assert.match(request.config.systemInstruction, /о другій.*14:00/);
      assert.match(request.config.systemInstruction, /tab NAME from WORKSPACE TABS/);
      assert.match(request.config.systemInstruction, /Set a priority on every plan_day item/);
      assert.match(request.config.systemInstruction, /ACTIVE TASK INDEX.*animation.*Робота над анімацією/);
      return calls(call('plan_day', { date: '2026-10-19', start: '13:00', items }));
    },
    request => {
      const response = responses(request)[0].response;
      assert.equal(response.ok, true);
      assert.deepEqual(response.data.map((block: any) => [block.start, block.end]), [
        ['13:00', '14:00'], ['14:00', '14:30'], ['14:30', '19:30'], ['19:30', '20:00'], ['20:00', '21:00'],
      ]);
      assert.equal(response.data[2].taskId, 'animation');
      assert.equal(response.data[2].created, false);
      assert.equal(response.data[3].phase, 'learn');
      assert.equal(response.data[4].priority, 3);
      assert.deepEqual(response.createdIds.filter((id: string) => response.data.some((block: any) => block.created && block.taskId === id)),
        response.data.filter((block: any) => block.created).map((block: any) => block.taskId));
      assert.match(response.summary.uk, /14:00–14:30.*Спланувати анімацію.*Робота.*P2/);
      assert.match(response.summary.uk, /19:30–20:00.*Навчання друку.*Навчання/);
      assert.match(response.summary.uk, /орієнтовно/);
      return { text: response.summary.uk };
    },
  ]);
  const result = await runAgentTurn({ ...base, userText, workspace: original, generate: fake.generate });
  assert.equal(result.actions.length, 1);
  assert.equal(result.actions[0].action.type, 'plan_day');
  assert.equal(result.actions[0].changedTaskIds.length, 5);
  assert.equal(result.actions[0].createdIds?.filter(id => result.workspace.tasks.some(item => item.id === id)).length, 4);
  assert.equal(result.workspace.tasks.length, 5);
  assert.equal(result.workspace.tasks.filter(item => item.title === 'Робота над анімацією').length, 1);
  assert.equal(result.workspace.tasks.find(item => item.title === 'Навчання друку')?.phase, 'learn');
  assert.equal(result.text, 'Ось розклад:'); assert.match(result.actions[0].summary.uk, /13:00–14:00 · Встановити жалюзі/);
  assert.deepEqual(original.tasks, [task()]);
});

test('plan_day conflicts reach the model as functionResponse and leave the workspace unchanged', async () => {
  const original = workspace(), before = structuredClone(original);
  const clarification = { question: 'Перенести друк на 14:00?', options: [
    { label: 'На 14:00', message: 'Сплануй жалюзі з 13:00 на годину, а друк з 14:00 на 30 хвилин.' },
    { label: 'Скоротити жалюзі', message: 'Сплануй жалюзі з 13:00 на 30 хвилин, а друк з 13:30 на 30 хвилин.' },
  ] };
  const fake = scripted([
    calls(call('plan_day', { start: '13:00', items: [
      { title: 'Жалюзі', durationMinutes: 60, priority: 2 },
      { title: 'Друк', durationMinutes: 30, fixedStart: '13:30', priority: 2 },
    ] })),
    request => {
      const part = responses(request)[0];
      assert.equal(part.name, 'plan_day');
      assert.equal(part.response.ok, false);
      assert.equal(part.response.code, 'conflict');
      assert.match(part.response.error, /Жалюзі/);
      assert.match(part.response.error, /Друк/);
      assert.match(part.response.error, /13:30/);
      assert.match(part.response.error, /14:00/);
      return calls(call('ask_user', clarification));
    },
  ]);
  const result = await runAgentTurn({ ...base, userText: 'Жалюзі з 13:00 на годину, друк о пів другої.', workspace: original, generate: fake.generate });
  assert.deepEqual(result.actions, []);
  assert.deepEqual(result.workspace, before);
  assert.deepEqual(original, before);
  assert.deepEqual(result.clarification, clarification);
});

test('timed create/update arguments reach the engine and clearTime preserves the chosen day', async () => {
  let createdId = '';
  const fake = scripted([
    calls(call('create_task', { title: 'Навчання друку', phase: 'Навчання', date: '2026-10-20', startTime: '13:30', durationMinutes: 30 })),
    request => {
      const response = responses(request)[0].response;
      assert.equal(response.ok, true);
      createdId = response.createdIds[0];
      assert.equal(response.tasks[0].date, '2026-10-20');
      assert.equal(response.tasks[0].startTime, '13:30');
      assert.equal(response.tasks[0].endTime, '14:00');
      assert.equal(response.tasks[0].timer.countdownMinutes, 30);
      assert.equal(response.tasks[0].timer.running, false);
      return calls(call('update_task', { taskId: createdId, clearTime: true }));
    },
    request => {
      const response = responses(request)[0].response;
      assert.equal(response.ok, true);
      assert.equal(response.tasks[0].plannedDate, '2026-10-20');
      assert.equal(response.tasks[0].startTime, undefined);
      return { text: 'Час прибрано, день залишено.' };
    },
  ]);
  const result = await runAgentTurn({ ...base, workspace: workspace({ tabs: [{ id: 'learn', name: 'Навчання' }] }), generate: fake.generate });
  assert.deepEqual(result.actions.map(item => item.action.type), ['create_task', 'update_task']);
  assert.equal(result.workspace.tasks.find(item => item.id === createdId)?.scheduledFor, undefined);
});

test('day planning tool schemas retain strict item fields and scheduling bounds', () => {
  const byName = Object.fromEntries(AGENT_TOOL_DECLARATIONS.map(tool => [tool.name, tool.parametersJsonSchema]));
  const items = byName.plan_day.properties.items as Record<string, any>;
  assert.equal(items.minItems, 1);
  assert.equal(items.maxItems, 20);
  assert.equal(items.items.additionalProperties, false);
  assert.deepEqual(items.items.oneOf, [{ required: ['taskId'] }, { required: ['title'] }]);
  assert.deepEqual(items.items.required, ['durationMinutes']);
  assert.equal(items.items.properties.durationMinutes.type, 'integer');
  assert.equal(items.items.properties.breakAfterMinutes.type, 'integer');
  assert.equal(items.items.properties.breakAfterMinutes.minimum, 0);
  assert.equal(items.items.properties.breakAfterMinutes.maximum, 1440);
  assert.equal(items.items.properties.durationMinutes.minimum, 1);
  assert.equal(items.items.properties.durationMinutes.maximum, 1440);
  assert.match(items.items.properties.phase.description, /tab name from WORKSPACE TABS/i);
  for (const name of ['create_task', 'update_task']) {
    for (const field of ['date', 'startTime', 'durationMinutes']) assert.ok(Object.hasOwn(byName[name].properties, field));
    assert.equal(byName[name].properties.durationMinutes.type, 'integer');
    assert.match(String(byName[name].properties.phase.description), /tab name from WORKSPACE TABS/i);
  }
  assert.equal(byName.update_task.properties.clearTime.const, true);
  assert.equal(byName.set_countdown.properties.minutes.type, 'number');
  assert.equal(byName.create_task.properties.timerMinutes.type, 'number');
});


test('expired start_timer and continue_after_expiry report the actual credited time to Gemini', async () => {
  for (const name of ['start_timer', 'continue_after_expiry']) {
    const expired = task({ countdownDurationSeconds: 3600, countdownRemainingSeconds: 0,
      timeSpentSeconds: 3600, countdownExpiredAt: NOW - 35 * 60000 });
    const fake = scripted([
      calls(call('get_task', { taskId: 'animation' })),
      request => {
        const timer = responses(request)[0].response.task.timer;
        assert.equal(timer.countdownExpiredAt, expired.countdownExpiredAt);
        assert.equal(timer.overrunMinutes, 35);
        return calls(call(name, { taskId: 'animation' }));
      },
      request => {
        const result = responses(request)[0].response;
        assert.equal(result.ok, true);
        assert.equal(result.data.creditedMinutes, 35);
        assert.equal(result.tasks[0].timer.recordedMinutes, 95);
        assert.equal(result.tasks[0].timer.remainingMinutes, 30);
        assert.equal(result.tasks[0].timer.countdownExpiredAt, null);
        assert.equal(result.tasks[0].timer.running, true);
        return { text: 'Дорахував 35 хв і продовжив відлік на 30 хв.' };
      },
    ]);
    const result = await runAgentTurn({ ...base, userText: 'я ще працюю над анімацією', workspace: workspace({ tasks: [expired] }), generate: fake.generate });
    assert.equal(result.actions.length, 1);
    assert.equal(result.actions[0].action.type, name);
    assert.match(result.actions[0].summary.uk, /35 хв/);
  }
});

test('finish_after_expiry credits the named local time and never completes the task itself', async () => {
  const expired = task({ countdownDurationSeconds: 3600, countdownRemainingSeconds: 0,
    timeSpentSeconds: 3600, countdownExpiredAt: NOW - 60 * 60000 });
  const fake = scripted([
    calls(call('finish_after_expiry', { taskId: 'animation', workedUntil: '11:40' })),
    request => {
      const result = responses(request)[0].response;
      assert.equal(result.ok, true);
      assert.equal(result.data.creditedMinutes, 40);
      assert.equal(result.tasks[0].timer.recordedMinutes, 100);
      assert.equal(result.tasks[0].done, false);
      assert.equal(result.tasks[0].timer.countdownExpiredAt, null);
      return { text: 'Дорахував до 11:40: 40 хв.' };
    },
  ]);
  const result = await runAgentTurn({ ...base, userText: 'закінчив об 11:40', workspace: workspace({ tasks: [expired] }), generate: fake.generate });
  assert.equal(result.actions[0].action.type, 'finish_after_expiry');
  assert.equal(result.workspace.tasks[0].done, false);
});

test('shift_day reaches the shared engine locally and reports blocks that do not fit', async () => {
  const late = task({ id: 'late', title: 'Пізній блок', scheduledFor: Date.parse('2026-10-19T20:00:00Z'), countdownDurationSeconds: 3600 });
  const next = task({ scheduledFor: NOW + 30 * 60000 });
  const fake = scripted([
    calls(call('shift_day', { minutes: 30 })),
    request => {
      const result = responses(request)[0].response;
      assert.equal(result.ok, true);
      assert.deepEqual(result.changedTaskIds, ['animation']);
      assert.deepEqual(result.data.overflowTaskIds, ['late']);
      assert.equal(result.tasks[0].startTime, '13:00');
      assert.match(result.summary.uk, /Не вміщається.*Пізній блок/);
      return { text: 'Посунув один блок на 30 хв. Пізній блок не вміщається до 24:00.' };
    },
  ]);
  const result = await runAgentTurn({ ...base, userText: 'посунь решту дня на пів години', workspace: workspace({ tasks: [next, late] }), generate: fake.generate });
  assert.equal(result.actions[0].action.type, 'shift_day');
  assert.equal(result.workspace.tasks[1].scheduledFor, late.scheduledFor);
});

test('expiry and day shift tool schemas and instructions preserve explicit work and tab decisions', () => {
  const byName = Object.fromEntries(AGENT_TOOL_DECLARATIONS.map(tool => [tool.name, tool.parametersJsonSchema]));
  assert.deepEqual(byName.continue_after_expiry.required, ['taskId']);
  assert.equal(byName.continue_after_expiry.properties.extendMinutes.type, 'integer');
  assert.deepEqual(byName.finish_after_expiry.required, ['taskId']);
  assert.match(String(byName.finish_after_expiry.properties.workedUntil.pattern), /2\[0-3\]/);
  assert.deepEqual(byName.shift_day.required, ['minutes']);
  assert.equal(byName.shift_day.properties.fromTime.pattern, byName.finish_after_expiry.properties.workedUntil.pattern);
  assert.match(AGENT_SYSTEM_INSTRUCTION, /я ще працюю.*continue_after_expiry/);
  assert.match(AGENT_SYSTEM_INSTRUCTION, /actual credited time/);
  assert.match(AGENT_SYSTEM_INSTRUCTION, /Never create a tab unless the person asks/);
  assert.match(AGENT_SYSTEM_INSTRUCTION, /Створити вкладку «Особисте»/);
});


test('replan_day exposes a timed schedule and replays through the shared action engine', async () => {
  const missed = task({ scheduledFor: NOW - 90 * 60000, scheduledDurationSeconds: 1800,
    countdownDurationSeconds: 1800, countdownRemainingSeconds: 1800 });
  const fake = scripted([
    calls(call('replan_day', { from: '12:05' })),
    request => {
      const result = responses(request)[0].response;
      assert.equal(result.ok, true);
      assert.deepEqual(result.changedTaskIds, ['animation']);
      assert.deepEqual(result.data.schedule.map((block: any) => [block.start, block.end]), [['12:05', '12:35']]);
      assert.deepEqual(result.data.overflowTaskIds, []);
      assert.equal(result.tasks[0].timer.running, false);
      return { text: result.summary.uk };
    },
  ]);
  const result = await runAgentTurn({ ...base, userText: 'підкоригуй час, я не встигаю', workspace: workspace({ tasks: [missed] }), generate: fake.generate });
  assert.deepEqual(result.actions.map(applied => applied.action), [{ type: 'replan_day', from: '12:05' }]);
  assert.equal(result.workspace.tasks[0].scheduledFor, NOW + 5 * 60000);
  assert.equal(result.workspace.tasks[0].countdownRemainingSeconds, 1800);
  assert.match(result.actions[0].summary.uk, /12:05–12:35 · Робота над анімацією/); assert.doesNotMatch(result.text, /12:05–12:35/);
  assert.equal(result.clarification, undefined);
});

test('replan_day overflow always asks one question with tomorrow, shorten and clear-time choices', async () => {
  const now = Date.parse('2026-10-19T15:30:00Z');
  const missed = task({ scheduledFor: Date.parse('2026-10-19T12:30:00Z'), scheduledDurationSeconds: 1800,
    countdownDurationSeconds: 1800, countdownRemainingSeconds: 1800 });
  const paused = task({ id: 'paused', title: 'Робота на паузі', scheduledFor: Date.parse('2026-10-19T13:00:00Z'),
    scheduledDurationSeconds: 18000, countdownDurationSeconds: 18000, countdownRemainingSeconds: 18000,
    startedAt: Date.parse('2026-10-19T13:00:00Z'), timeSpentSeconds: 60 });
  const late = task({ id: 'typing', title: 'Навчання друку', scheduledFor: Date.parse('2026-10-19T19:00:00Z'),
    scheduledDurationSeconds: 1800, countdownDurationSeconds: 1800, countdownRemainingSeconds: 1800 });
  for (const modelAsks of [false, true]) {
    const fake = scripted([
      calls(call('replan_day', {})),
      request => {
        const result = responses(request)[0].response;
        assert.deepEqual(result.data.overflowTaskIds, ['typing']);
        assert.match(result.summary.uk, /19:00–24:00/);
        return modelAsks ? calls(call('ask_user', { question: 'Інше питання?', options: [{ label: 'Так', message: 'Так' }] }),
          call('update_task', { taskId: 'typing', clearTime: true })) : { text: 'Готово.' };
      },
    ]);
    const result = await runAgentTurn({ ...base, now, userText: 'переплануй решту дня', workspace: workspace({ tasks: [missed, paused, late] }), generate: fake.generate });
    assert.deepEqual(result.actions.map(applied => applied.action.type), ['replan_day']);
    assert.equal(result.workspace.tasks[2].scheduledFor, late.scheduledFor);
    assert.match(result.clarification!.question, /Не вміщається сьогодні.*Навчання друку/);
    assert.deepEqual(result.clarification!.options.map(option => option.label), ['Перенести на завтра', 'Скоротити блоки', 'Лишити без часу']);
    assert.match(result.clarification!.options[0].message, /2026-10-20.*Навчання друку.*22:00/);
    assert.match(result.clarification!.options[1].message, /23:59/);
    assert.match(result.clarification!.options[2].message, /Прибери час.*Навчання друку/);
    assert.match(result.actions[0].summary.uk, /18:30–19:00/); assert.doesNotMatch(result.text, /18:30–19:00/);
    assert.equal(fake.requests.length, 2);
  }
});

test('replan_day declaration and instructions distinguish adjustment from explicit shifts and dictation noise', () => {
  const byName = Object.fromEntries(AGENT_TOOL_DECLARATIONS.map(tool => [tool.name, tool.parametersJsonSchema]));
  assert.deepEqual(byName.replan_day.required, []);
  assert.deepEqual(Object.keys(byName.replan_day.properties), ['from']);
  assert.equal(byName.replan_day.properties.from.pattern, byName.shift_day.properties.fromTime.pattern);
  assert.match(AGENT_SYSTEM_INSTRUCTION, /підкоригуй час.*replan_day/);
  assert.match(AGENT_SYSTEM_INSTRUCTION, /посунь на N хв.*shift_day/);
  assert.match(AGENT_SYSTEM_INSTRUCTION, /overflowTaskIds.*ask_user ONCE/);
  assert.match(AGENT_SYSTEM_INSTRUCTION, /Париж зараз 1 година.*schedule.*time zones/);
});

test('repeated action summaries are removed from the reply text while other prose stays', () => {
  const summaries = ['Таймер «Робота над анімацією»: 2 год → 3 год', '18:45–19:15 · Спланувати анімацію\nНе вміщається сьогодні: Навчання друку'];
  const text = ['Готово, підлаштував розклад.', '', '**Таймер «Робота над анімацією»: 2 год → 3 год**', '- 18:45 – 19:15 · Спланувати анімацію.',
    '1. Не вміщається сьогодні: Навчання друку', '', 'Перенести друк на завтра?'].join('\n');
  assert.equal(withoutRepeatedSummaries(text, summaries), 'Готово, підлаштував розклад.\n\nПеренести друк на завтра?');
  // A sentence that only mentions a task is not a summary line and stays.
  assert.equal(withoutRepeatedSummaries('Таймер для «Робота над анімацією» тепер довший.', summaries), 'Таймер для «Робота над анімацією» тепер довший.');
  assert.equal(withoutRepeatedSummaries('Нічого не змінено.', []), 'Нічого не змінено.');
});

test('an agent reply that only copies the applied summaries becomes a short confirmation', async () => {
  const fake = scripted([
    calls(call('set_countdown', { taskId: 'animation', minutes: 180, start: false }), call('set_step_done', { taskId: 'animation', step: 3, done: true })),
    request => {
      const summaries = responses(request).map(part => part.response.summary?.uk ?? '');
      assert.equal(summaries.length, 2);
      return { text: ['Готово!', ...summaries.map(line => '- ' + line)].join('\n') };
    },
  ]);
  const result = await runAgentTurn({ ...base, workspace: workspace(), generate: fake.generate });
  assert.equal(result.actions.length, 2);
  assert.equal(result.text, 'Готово!');
  const copiedOnly = scripted([
    calls(call('set_countdown', { taskId: 'animation', minutes: 180, start: false })),
    request => ({ text: responses(request)[0].response.summary?.uk ?? '' }),
  ]);
  const short = await runAgentTurn({ ...base, workspace: workspace(), generate: copiedOnly.generate });
  assert.equal(short.text, 'Готово.');
});
