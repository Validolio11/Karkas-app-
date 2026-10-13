import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aiToolsEnabled, newTasksBatchSchema, proposalFromFunctionCalls, proposalSummaryReply, TASK_COMMAND_FUNCTION_DECLARATIONS, TASK_COMMAND_TOOLS_CONFIG } from './aiTools.ts';
import { newTabItemSchema, newTaskItemSchema, taskMutationProperties } from './aiActions.ts';

test('tool parameters are the same schema objects the JSON proposal schema uses', () => {
  const byName = Object.fromEntries(TASK_COMMAND_FUNCTION_DECLARATIONS.map(declaration => [declaration.name, declaration.parameters]));
  assert.equal(byName.propose_create_task, newTaskItemSchema);
  assert.equal(byName.propose_create_tasks, newTasksBatchSchema);
  assert.equal(newTasksBatchSchema.properties.tasks.items, newTaskItemSchema);
  assert.deepEqual(newTasksBatchSchema.required, ['tasks']);
  assert.equal(byName.propose_update_task, taskMutationProperties.taskUpdates.items);
  assert.equal(byName.propose_delete_task, taskMutationProperties.taskDeletions.items);
  assert.equal(byName.propose_create_tab, newTabItemSchema);
  assert.equal(TASK_COMMAND_TOOLS_CONFIG.toolConfig.functionCallingConfig.mode, 'AUTO');
});

test('task create and update tools state what each priority number means', () => {
  for (const name of ['propose_create_task', 'propose_update_task']) {
    const declaration = TASK_COMMAND_FUNCTION_DECLARATIONS.find(item => item.name === name)!;
    assert.match(declaration.description, /priority: 1 high, 2 normal, 3 low/, name);
  }
});

test('create tools ask for every listed task and structured dates and priority instead of notes', () => {
  const byName = Object.fromEntries(TASK_COMMAND_FUNCTION_DECLARATIONS.map(declaration => [declaration.name, declaration.description]));
  assert.match(byName.propose_create_task, /two or more new tasks, use propose_create_tasks with ALL of them/);
  assert.match(byName.propose_create_tasks, /every task the person listed.*none omitted/);
  for (const name of ['propose_create_task', 'propose_create_tasks']) {
    assert.match(byName[name], /deadlineDate for "by\/until\/deadline\/дедлайн\/до"/, name);
    assert.match(byName[name], /терміново.*means 1/, name);
    assert.match(byName[name], /never only into note or title/, name);
  }
});

test('a batch create call adds every task in order, between other calls; malformed batches are rejected', () => {
  const proposal = proposalFromFunctionCalls([
    { name: 'propose_create_task', args: { title: 'A', phase: 'focus', priority: 2, steps: 0 } },
    { name: 'propose_create_tasks', args: { tasks: [
      { title: 'B', phase: 'focus', priority: 1, steps: 0, deadlineDate: '2026-10-16' },
      { title: 'C', phase: 'focus', priority: 3, steps: 0 },
    ] } },
    { name: 'propose_update_task', args: { id: 'u', done: true } },
  ]);
  assert.deepEqual(proposal.tasks.map(task => task.title), ['A', 'B', 'C']);
  assert.equal(proposal.tasks[1].deadlineDate, '2026-10-16');
  assert.deepEqual(proposal.taskUpdates, [{ id: 'u', done: true }]);
  assert.deepEqual(proposalFromFunctionCalls([{ name: 'propose_create_tasks', args: { tasks: [] } }]).tasks, []);
  for (const args of [null, [], {}, { tasks: 'A' }, { tasks: [null] }, { tasks: [['A']] }]) {
    assert.throws(() => proposalFromFunctionCalls([{ name: 'propose_create_tasks', args } as any]), undefined, JSON.stringify(args));
  }
});

test('the KARKAS_AI_TOOLS kill switch accepts common off values only', () => {
  assert.equal(aiToolsEnabled({}), true);
  assert.equal(aiToolsEnabled({ KARKAS_AI_TOOLS: 'on' }), true);
  for (const value of ['off', 'OFF', 'false', '0', 'no', ' disabled ']) assert.equal(aiToolsEnabled({ KARKAS_AI_TOOLS: value }), false, value);
});

test('calls become proposal arrays in call order; unknown tools and non-object arguments are rejected', () => {
  const args = { id: 't', timerAction: 'stop' };
  const proposal = proposalFromFunctionCalls([
    { name: 'propose_update_task', args },
    { name: 'propose_create_task', args: { title: 'A', phase: 'focus', priority: 2, steps: 0 } },
    { name: 'propose_update_task', args: { id: 'u', done: true } },
    { name: 'propose_delete_task', args: { id: 'd', deletionReason: 'cancelled' } },
    { name: 'propose_create_tab', args: { id: 'tab', name: 'Tab' } },
  ]);
  assert.deepEqual(proposal.taskUpdates, [args, { id: 'u', done: true }]);
  assert.notEqual(proposal.taskUpdates[0], args, 'arguments are copied before validation normalizes them');
  assert.equal(proposal.tasks.length, 1);
  assert.deepEqual(proposal.taskDeletions, [{ id: 'd', deletionReason: 'cancelled' }]);
  assert.deepEqual(proposal.tabs, [{ id: 'tab', name: 'Tab' }]);
  assert.deepEqual(proposalFromFunctionCalls([]), { tasks: [], tabs: [], taskUpdates: [], taskDeletions: [] });
  for (const call of [{ name: 'apply_changes', args: {} }, { name: 'toString', args: {} }, { name: 'propose_update_task', args: null }, { name: 'propose_update_task', args: [] }, { name: 'propose_update_task', args: 'id=t' }]) {
    assert.throws(() => proposalFromFunctionCalls([call]), undefined, JSON.stringify(call));
  }
});

test('a summary for tool-only answers describes the proposal without claiming it was applied', () => {
  const english = proposalSummaryReply({ tasks: [{ title: 'Buy milk' }], taskUpdates: [{ id: 't' }], taskDeletions: [], tabs: [] }, false);
  assert.match(english, /^Proposal ready: new tasks \(1\): "Buy milk"; task changes \(1\)\./);
  assert.doesNotMatch(english, /\b(applied|saved|done)\b/i);
  assert.match(proposalSummaryReply({ taskDeletions: [{ id: 't' }] }, true), /архівування завдань \(1\).*«Застосувати зміни»/);
  assert.match(proposalSummaryReply({}, true), /Уточніть/);
});

test('the tool-only summary addresses the person with their own ти or ви', () => {
  const proposal = { tasks: [{ title: 'Зробити вправи' }] };
  const ty = proposalSummaryReply(proposal, true, 'ty');
  assert.match(ty, /Переглянь її й натисни «Застосувати зміни»/);
  assert.doesNotMatch(ty, /Перегляньте|натисніть/);
  assert.match(proposalSummaryReply(proposal, true, 'vy'), /Перегляньте її й натисніть «Застосувати зміни»/);
  assert.equal(proposalSummaryReply(proposal, true), proposalSummaryReply(proposal, true, 'vy'), '"ви" stays the default');
  assert.match(proposalSummaryReply({}, true, 'ty'), /Уточни, яке саме завдання/);
  assert.equal(proposalSummaryReply(proposal, false, 'ty'), proposalSummaryReply(proposal, false), 'English has no special form');
});

test('a tool-only answer whose change fell outside the scope asks which task, in the person\'s form', () => {
  const dropped = { tasks: [], taskUpdates: [], taskDeletions: [], tabs: [], operationsDropped: true };
  const ty = proposalSummaryReply(dropped, true, 'ty');
  assert.match(ty, /Не вдалося визначити, яке саме завдання змінити.*Назви завдання точніше/);
  assert.doesNotMatch(ty, /Назвіть|Уточніть/);
  assert.match(proposalSummaryReply(dropped, true), /Назвіть завдання точніше/);
  assert.match(proposalSummaryReply(dropped, false), /could not determine exactly which task/);
});
