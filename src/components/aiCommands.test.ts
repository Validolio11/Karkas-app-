import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAICommand, migrateAIComposer, modeIntent } from './aiCommands';
import { readAIResponse, readAIAssistantDraft, saveAIAssistantDraft } from './aiAssistantState';
import { ensureAIChatWelcome, loadAIChatHistory, saveAIChatHistory, recentAIChatContext, visibleAIChatMessages } from '../services/chatHistory';
import { proposalTargetsUnchanged } from './aiProposalGuard';
import type { PSTask } from '../types';

test('leading commands select one turn; natural mentions and similarly named words stay chat text', () => {
  assert.deepEqual(parseAICommand('  @PLAN Build a house'), { intent: 'plan', text: 'Build a house' });
  assert.deepEqual(parseAICommand('@analysis'), { intent: 'analysis', text: '' });
  assert.deepEqual(parseAICommand('@steps Fix the compiler'), { intent: 'steps', text: 'Fix the compiler' });
  assert.deepEqual(parseAICommand('Explain @plan'), { intent: 'auto', text: 'Explain @plan' });
  assert.deepEqual(parseAICommand('@planet'), { intent: 'auto', text: '@planet' });
  assert.deepEqual(parseAICommand('@analysis Review work', 'plan'), { intent: 'analysis', text: 'Review work' });
  assert.deepEqual(parseAICommand('@plan @analysis Review work'), { intent: 'analysis', text: 'Review work' });
});

test('legacy mode drafts become one-message actions while explicit commands take precedence', () => {
  assert.deepEqual(migrateAIComposer('Design a garden', 'generate'), { prompt: 'Design a garden', mode: 'generate' });
  assert.equal(modeIntent(migrateAIComposer('A task', 'breakdown').mode), 'steps');
  assert.deepEqual(migrateAIComposer('@analysis Last month', 'generate'), { prompt: 'Last month', mode: 'analyze' });
});

test('stable turn identity and intent survive request recovery without persisting executable actions', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const request = { text: 'Plan my week', mode: 'generate' as const, intent: 'plan' as const, turnId: 'turn-one' };
  saveAIAssistantDraft(storage, { prompt: 'New draft', mode: 'chat', recoverableRequest: request }, 'account');
  assert.deepEqual(readAIAssistantDraft(storage, 'account')?.recoverableRequest, request);
  assert.equal(readAIAssistantDraft(storage, 'other-account'), null);
});

test('welcome preserves old history for an existing account and repeats only after explicit reset', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  try {
    const old = [{ role: 'user' as const, content: 'My old conversation' }];
    const first = ensureAIChatWelcome('old-account', old, 'Welcome', false);
    assert.equal(first.added, true);
    assert.equal(first.messages[0].content, old[0].content);
    assert.equal(first.messages.at(-1)?.greeting, true);
    const firstView = visibleAIChatMessages(first.messages, first.messages.at(-1)!.id!);
    assert.equal(firstView.previousCount, 1);
    assert.equal(firstView.messages[0].greeting, true);
    assert.equal(visibleAIChatMessages(first.messages, null).messages[0].content, old[0].content);
    assert.equal(ensureAIChatWelcome('old-account', first.messages, 'Welcome', false).added, false);
    assert.equal(ensureAIChatWelcome('other-account', [], 'Welcome', false).added, true);
    assert.equal(ensureAIChatWelcome('known-account', old, 'Welcome', true).added, false);
    storage.removeItem('karkas_ai_chat_welcome:old-account');
    const restarted = ensureAIChatWelcome('old-account', first.messages, 'Welcome again', false);
    assert.equal(restarted.added, true);
    assert.deepEqual(recentAIChatContext(restarted.messages), [{ role: 'assistant', content: 'Welcome again' }]);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('proposal cards survive reload as historical snapshots and cannot restore executable pending actions', () => {
  const values = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => values.set(key, value) } });
  try {
    saveAIChatHistory('account', [{ id: 'reply-one', role: 'assistant', content: 'A plan', response: { summary: 'A plan', tasks: [{ title: 'Prepare', phase: 'work', priority: 2, steps: 0 }] }, proposalStatus: 'pending' }]);
    const loaded = loadAIChatHistory('account');
    assert.equal(loaded[0].proposalStatus, 'stale');
    assert.equal(loaded[0].response?.tasks?.[0].title, 'Prepare');
    assert.equal(loadAIChatHistory('other-account').length, 0);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('malformed structured strategy cannot reach card rendering or automatic application', () => {
  assert.throws(() => readAIResponse({ summary: 'Reply', strategy: { actions: {} } }, 'chat'));
  assert.throws(() => readAIResponse({ summary: 'Reply', strategy: { memoryPatch: { goals: [{ id: 'goal', title: 'Goal' }] } } }, 'chat'));
  assert.throws(() => readAIResponse({ summary: 'Reply', strategy: { actions: [{ id: 'a', type: 'create', goalId: 'goal', reason: 'Begin', changes: { stepTitles: [42] } }] } }, 'chat'));
});

test('manual proposals preserve edits, completed steps and deleted tasks made while the provider was responding', () => {
  const task: PSTask = { id: 'task', title: 'Write', phase: 'work', priority: 2, steps: 1, currentStep: 0, done: false, pinned: false, createdAt: 1, stepList: [{ id: 'step', title: 'Draft', done: false }] };
  assert.equal(proposalTargetsUnchanged([task], [{ ...task, timeSpentSeconds: 20 }], ['task']), true);
  assert.equal(proposalTargetsUnchanged([task], [{ ...task, title: 'New title' }], ['task']), false);
  assert.equal(proposalTargetsUnchanged([task], [{ ...task, currentStep: 1, stepList: [{ ...task.stepList![0], done: true }] }], ['task']), false);
  assert.equal(proposalTargetsUnchanged([task], [], ['task']), false);
  assert.equal(proposalTargetsUnchanged([task], [task], ['missing']), false);
});
