import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentResponse, PSTask } from '../types';
import type { AgentAction, AgentWorkspace } from '../utils/aiAgentActions';
import { buildAgentWorkspaceRequest, describeAgentConfirmation, singlePendingAgentConfirmation, validateAgentResponse } from './aiAgentClient';
import { AIRequestError, readAIResponse } from './aiAssistantState';
import { loadAIChatHistory, saveAIChatHistory } from '../services/chatHistory';

const task: PSTask = { id: 'task-a', title: 'Анімація', phase: 'work', priority: 2, steps: 1, currentStep: 0,
  stepList: [{ id: 'step-a', title: 'Ескіз', done: false }], done: false, pinned: false, createdAt: 100,
  timeSpentSeconds: 120, timeSessions: { session: { seconds: 120 } }, updatedAt: 200 };
const workspace: AgentWorkspace = { tasks: [task], deletedTasks: [{ ...task, id: 'deleted', deletedAt: 300 }],
  tabs: [{ id: 'work', name: 'Робота', color: '#abcd00' }], notes: [{ id: 'note-a', title: 'Ідея', content: 'Повний текст', createdAt: 100 }] };
const action: AgentAction = { type: 'delete_task', taskId: task.id };
const agent = (pendingConfirmations: AgentAction[] = [action]): AgentResponse => ({ actions: [], pendingConfirmations });

test('agent request preserves complete persisted workspace records and sent clock', () => {
  const clock = { now: '2026-10-19T12:00:00.000Z', timeZone: 'Europe/Kyiv' };
  const request = buildAgentWorkspaceRequest(workspace, clock);
  assert.deepEqual(request, { currentTasks: workspace.tasks, tabs: workspace.tabs, deletedTasks: workspace.deletedTasks, notes: workspace.notes, clientClock: clock });
  assert.equal(request.currentTasks[0].timeSessions?.session.seconds, 120);
  assert.equal(request.deletedTasks[0].deletedAt, 300);
  assert.equal(request.notes[0].content, 'Повний текст');
});

test('bare assent confirms only the single unresolved action of the latest assistant reply', () => {
  const message = { role: 'assistant' as const, response: { agent: agent() } };
  for (const text of ['так', 'Так!', ' ок… ', 'YES.', 'да', 'давай?!']) assert.deepEqual(singlePendingAgentConfirmation(text, message), { action, index: 0 });
  for (const text of ['так, але інше', 'так видали', 'не треба', 'окей', 'yes please', 'так так', '']) assert.equal(singlePendingAgentConfirmation(text, message), null);
  assert.equal(singlePendingAgentConfirmation('так', null), null);
  assert.equal(singlePendingAgentConfirmation('так', { ...message, role: 'user' }), null);
  assert.equal(singlePendingAgentConfirmation('так', { role: 'assistant', response: { agent: agent([]) } }), null);
  for (const status of ['confirmed', 'dismissed'] as const) assert.equal(singlePendingAgentConfirmation('так', { ...message, agentConfirmationStatus: { 0: status } }), null);
  const multiple = { role: 'assistant' as const, response: { agent: agent([action, { type: 'reset_time', taskId: task.id }]) } };
  assert.equal(singlePendingAgentConfirmation('так', multiple), null);
  assert.equal(singlePendingAgentConfirmation('так', { ...multiple, agentConfirmationStatus: { 0: 'dismissed' } }), null);
});

test('confirmation descriptions use current task and tab names and explain destructive scope', () => {
  assert.equal(describeAgentConfirmation(action, workspace, 'uk'), 'Видалити завдання «Анімація»?');
  assert.match(describeAgentConfirmation({ type: 'permanently_delete_task', taskId: 'deleted' }, workspace, 'uk'), /Назавжди.*Анімація/);
  assert.match(describeAgentConfirmation({ type: 'reset_time', taskId: task.id }, workspace, 'uk'), /Скинути записаний час.*Анімація/);
  assert.match(describeAgentConfirmation({ type: 'delete_tab', tabId: 'work' }, workspace, 'uk'), /Робота.*перенесено/);
  assert.match(describeAgentConfirmation({ type: 'clear_completed' }, { ...workspace, tasks: [{ ...task, done: true }] }, 'uk'), /історії [(]1[)]/);
  assert.equal(describeAgentConfirmation({ type: 'delete_step', taskId: task.id, step: 1 }, workspace, 'uk'), 'Видалити крок «Ескіз» завдання «Анімація»?');
  assert.match(describeAgentConfirmation({ type: 'delete_task', taskId: 'missing' }, workspace, 'en'), /Delete task.*missing/);
  assert.match(describeAgentConfirmation({ type: 'complete_task', taskId: task.id }, workspace, 'en'), /Perform action.*Анімація/);
});

test('response parser accepts action replay, clarification, navigation and personal handoff', () => {
  const response = { reply: 'Готово', summary: 'Готово', agent: { actions: [{ action: { type: 'create_task', title: 'Нове' },
    summary: { uk: 'Створено', en: 'Created' }, changedTaskIds: ['new'], createdIds: ['new', 'step'] }], pendingConfirmations: [action],
    clarification: { question: 'Який час?', options: [{ label: '3 год', message: 'Таймер на 3 години' }] },
    view: { type: 'reveal_task', taskId: 'new' }, handoff: 'personal' } };
  assert.equal(validateAgentResponse(response.agent), true);
  assert.equal(readAIResponse(response, 'chat'), response);
  assert.equal(validateAgentResponse({ actions: [], pendingConfirmations: [], view: { type: 'open_view', view: 'notes' } }), true);
});

test('malformed executable agent payloads are rejected before local replay', () => {
  const valid = { action, summary: { uk: 'Видалено', en: 'Deleted' }, changedTaskIds: [task.id] };
  for (const malformed of [null, [], {}, { actions: [], pendingConfirmations: 'yes' },
    { actions: [{ ...valid, action: { type: 'delete_task', taskId: task.id, confirmed: true } }], pendingConfirmations: [] },
    { actions: [{ ...valid, summary: { uk: 'Видалено' } }], pendingConfirmations: [] },
    { actions: [{ ...valid, changedTaskIds: [1] }], pendingConfirmations: [] },
    { actions: [{ ...valid, createdIds: [''] }], pendingConfirmations: [] },
    { actions: [], pendingConfirmations: [{ type: 'delete_task' }] },
    { actions: [], pendingConfirmations: [], view: action },
    { actions: [], pendingConfirmations: [], handoff: 'other' },
    { actions: [], pendingConfirmations: [], clarification: { question: '?', options: [{ label: 'Час', message: '' }] } },
  ]) {
    assert.equal(validateAgentResponse(malformed), false);
    assert.throws(() => readAIResponse({ reply: 'Відповідь', agent: malformed }, 'chat'), AIRequestError);
  }
});

function withChatStorage(run: () => void) {
  const values = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } });
  try { run(); } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
}

test('reloaded agent messages retain outcomes but cannot replay or expose session Undo', () => withChatStorage(() => {
  const summary = { uk: 'Створено', en: 'Created' };
  saveAIChatHistory('owner', [{ id: 'turn', role: 'assistant', content: 'Готово', response: { summary: 'Готово', agent: agent() },
    agentApplied: false, agentSummaries: [summary], agentFailures: [{ action, error: 'Task changed' }], agentConfirmationStatus: { 0: 'dismissed' },
    proposalStatus: 'pending', agentUndoStatus: 'unavailable' }]);
  const [loaded] = loadAIChatHistory('owner');
  assert.equal(loaded.agentApplied, true);
  assert.deepEqual(loaded.agentSummaries, [summary]);
  assert.deepEqual(loaded.agentFailures, [{ action, error: 'Task changed' }]);
  assert.deepEqual(loaded.agentConfirmationStatus, { 0: 'dismissed' });
  assert.equal(loaded.agentUndoStatus, 'unavailable');
  assert.equal(loaded.proposalStatus, undefined);
  assert.deepEqual(loadAIChatHistory('other-owner'), []);
  for (const agentUndoStatus of ['undone', 'conflict'] as const) {
    saveAIChatHistory('owner', [{ ...loaded, agentUndoStatus }]);
    assert.equal(loadAIChatHistory('owner')[0].agentUndoStatus, agentUndoStatus);
  }
}));

test('history discards malformed action outcomes and out-of-range confirmation statuses', () => withChatStorage(() => {
  const message = { role: 'assistant', content: 'Готово', response: { summary: 'Готово', agent: agent() }, agentSummaries: [{ uk: 'Без перекладу' }, { uk: 'Готово', en: 'Done' }],
    agentFailures: [{ action: { type: 'delete_task' }, error: 'Bad' }, { action, error: 'Task changed' }],
    agentConfirmationStatus: { 0: 'confirmed', 1: 'dismissed', '-1': 'confirmed', 'oops': 'dismissed' }, agentUndoStatus: 'ready' };
  localStorage.setItem('karkas_ai_chat_history:owner', JSON.stringify([message]));
  const [loaded] = loadAIChatHistory('owner');
  assert.deepEqual(loaded.agentSummaries, [{ uk: 'Готово', en: 'Done' }]);
  assert.deepEqual(loaded.agentFailures, [{ action, error: 'Task changed' }]);
  assert.deepEqual(loaded.agentConfirmationStatus, { 0: 'confirmed' });
  assert.equal(loaded.agentUndoStatus, 'unavailable');
}));
