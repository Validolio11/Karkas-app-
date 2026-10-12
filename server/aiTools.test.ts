import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aiToolsEnabled, proposalFromFunctionCalls, proposalSummaryReply, TASK_COMMAND_FUNCTION_DECLARATIONS, TASK_COMMAND_TOOLS_CONFIG } from './aiTools.ts';
import { newTabItemSchema, newTaskItemSchema, taskMutationProperties } from './aiActions.ts';

test('tool parameters are the same schema objects the JSON proposal schema uses', () => {
  const byName = Object.fromEntries(TASK_COMMAND_FUNCTION_DECLARATIONS.map(declaration => [declaration.name, declaration.parameters]));
  assert.equal(byName.propose_create_task, newTaskItemSchema);
  assert.equal(byName.propose_update_task, taskMutationProperties.taskUpdates.items);
  assert.equal(byName.propose_delete_task, taskMutationProperties.taskDeletions.items);
  assert.equal(byName.propose_create_tab, newTabItemSchema);
  assert.equal(TASK_COMMAND_TOOLS_CONFIG.toolConfig.functionCallingConfig.mode, 'AUTO');
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
