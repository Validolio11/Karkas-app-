import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAICommand, migrateAIComposer, modeIntent } from './aiCommands';
import { readAIResponse, readAIAssistantDraft, saveAIAssistantDraft } from './aiAssistantState';
import { ensureAIChatWelcome, loadAIChatHistory, saveAIChatHistory, recentAIChatContext, visibleAIChatMessages } from '../services/chatHistory';
import { proposalTargetsUnchanged } from './aiProposalGuard';
import type { PSTask } from '../types';
import { removeAccountStorage } from '../utils/accountStorage';

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

test('retry context excludes only the current turn and preserves earlier identical answers', () => {
  const messages = [
    { id: 'old', role: 'user' as const, content: 'Old introduction' },
    { id: 'welcome', role: 'assistant' as const, content: 'Let us get to know each other', greeting: true },
    { id: 'earlier-answer', role: 'user' as const, content: 'I get distracted' },
    { id: 'question', role: 'assistant' as const, content: 'What happened last time?' },
    { id: 'failed-turn', role: 'user' as const, content: 'I get distracted' },
  ];
  assert.deepEqual(recentAIChatContext(messages, 2, 'failed-turn'), [
    { role: 'user', content: 'I get distracted' },
    { role: 'assistant', content: 'What happened last time?' },
  ]);
  assert.equal(messages.at(-1)?.id, 'failed-turn');
  assert.deepEqual(recentAIChatContext(messages, 2, 'new-turn'), [
    { role: 'assistant', content: 'What happened last time?' },
    { role: 'user', content: 'I get distracted' },
  ]);
});

test('recorded messages carry a compact client-local timestamp prefix', () => {
  const sentAt = new Date(2026, 9, 2, 9, 5).getTime();
  assert.deepEqual(recentAIChatContext([{ id: 'm', role: 'user', content: 'Move it to tomorrow', sentAt }]), [
    { role: 'user', content: '[02.10 09:05] Move it to tomorrow' },
  ]);
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
    removeAccountStorage(storage, 'karkas_ai_chat_welcome', 'old-account');
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

test('provider history tells which proposals were applied, partly applied or never applied', () => {
  const response = { summary: 'Plan', tasks: [{ title: 'Prepare', phase: 'work', priority: 2 as const, steps: 0 }] };
  const messages = [
    { id: 'u1', role: 'user' as const, content: 'Break down the banners' },
    { id: 'a1', role: 'assistant' as const, content: 'Five steps', response, proposalStatus: 'stale' as const },
    { id: 'a2', role: 'assistant' as const, content: 'A timer', response, proposalStatus: 'applied' as const, applyOutcome: 'partial' as const },
    { id: 'a3', role: 'assistant' as const, content: 'A step', response, proposalStatus: 'applied' as const, applyOutcome: 'applied' as const },
    { id: 'a4', role: 'assistant' as const, content: 'Rejected', response, proposalStatus: 'applied' as const, applyOutcome: 'none' as const },
    { id: 'a5', role: 'assistant' as const, content: 'Waiting', response, proposalStatus: 'pending' as const },
    { id: 'a6', role: 'assistant' as const, content: 'Just advice' },
  ];
  assert.deepEqual(recentAIChatContext(messages).map(message => [message.content, message.proposalStatus]), [
    ['Break down the banners', undefined], ['Five steps', 'not_applied'], ['A timer', 'partial'],
    ['A step', 'applied'], ['Rejected', 'not_applied'], ['Waiting', 'not_applied'], ['Just advice', undefined],
  ]);
  assert.equal('proposalStatus' in recentAIChatContext(messages)[0], false);
});

test('the apply outcome survives reload for an applied proposal', () => {
  const values = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => values.set(key, value) } });
  try {
    const response = { summary: 'A plan', tasks: [{ title: 'Prepare', phase: 'work', priority: 2 as const, steps: 0 }] };
    saveAIChatHistory('account', [
      { id: 'partial', role: 'assistant', content: 'A plan', response, proposalStatus: 'applied', applyOutcome: 'partial' },
      { id: 'pending', role: 'assistant', content: 'Another plan', response, proposalStatus: 'pending', applyOutcome: 'applied' },
    ]);
    const loaded = loadAIChatHistory('account');
    assert.equal(loaded[0].applyOutcome, 'partial');
    assert.equal(loaded[1].proposalStatus, 'stale');
    assert.equal(loaded[1].applyOutcome, undefined);
    assert.deepEqual(recentAIChatContext(loaded).map(message => message.proposalStatus), ['partial', 'not_applied']);
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
