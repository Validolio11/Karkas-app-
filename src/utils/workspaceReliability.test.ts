import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorkspaceState } from './syncState';
import { annotateTaskChanges } from './taskActivity';
import { createPersonalStrategyProfile } from './personalStrategy';
import { remapWorkspaceTabs } from './workspaceTabs';
import { claimGuestWorkspaceImport } from './guestWorkspaceImport';

const task = { id: 't', title: 'Keep', phase: 'old', priority: 2 as const, steps: 0, currentStep: 0,
  done: true, pinned: false, createdAt: 1, completedAt: 2 };

test('an unchanged timer tick retains array identity and cannot trigger persistence', () => {
  const tasks = [task];
  assert.equal(annotateTaskChanges(tasks, tasks, 1000), tasks);
});

test('tab replacement moves live tasks, completed history and goal categories together', () => {
  const workspace: WorkspaceState = { tasks: [task], tabs: [{ id: 'old', name: 'Old' }],
    deletedTasks: [{ ...task, id: 'archived', deletedAt: 3 }],
    settings: { soundEnabled: true, fireEnabled: false, lang: 'uk', aiIconVariant: 'cube' } };
  const profile = { ...createPersonalStrategyProfile(), goals: [{ id: 'g', title: 'Goal', motive: 'Motive',
    agreed: true, categoryIds: ['old'], taskIds: ['t'] }] };
  const result = remapWorkspaceTabs(workspace, profile, [{ id: 'new', name: 'New' }])!;
  assert.equal(result.workspace.tasks[0].phase, 'new');
  assert.equal(result.workspace.deletedTasks[0].phase, 'new');
  assert.equal(result.workspace.deletedTasks[0].completedAt, 2);
  assert.deepEqual(result.profile.goals[0].categoryIds, ['new']);
  assert.deepEqual(result.profile.goals[0].taskIds, ['t']);
  assert.equal(remapWorkspaceTabs(workspace, profile, []), null);
});

test('guest workspace has one recipient and retains retry permission for only that account', () => {
  const values = new Map<string, string>();
  const store = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); } };
  assert.equal(claimGuestWorkspaceImport(store, 'first'), true);
  assert.equal(claimGuestWorkspaceImport(store, 'second'), false);
  assert.equal(claimGuestWorkspaceImport(store, 'first'), true);
  assert.throws(() => claimGuestWorkspaceImport({ getItem: () => null, setItem: () => {} }, 'third'));
});
