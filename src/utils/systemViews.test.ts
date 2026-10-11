import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DeletedTask, PSTask } from '../types';
import { isSystemView, migrateSystemCategories, SYSTEM_VIEW_IDS } from './systemViews';

const task = (id: string, phase: string): PSTask => ({ id, title: id, phase, priority: 2,
  steps: 0, currentStep: 0, done: false, pinned: false, createdAt: 1 });

test('all built-in views are reserved while normal category IDs remain usable', () => {
  for (const id of ['ALL', 'DASHBOARD', 'STRATEGY', 'NOTES', 'HISTORY']) assert.equal(isSystemView(id), true);
  for (const id of ['focus', 'strategy-work', 'notes', 'category-strategy']) assert.equal(isSystemView(id), false);
  assert.equal(SYSTEM_VIEW_IDS.length, 5);
});

test('a conflicting category is renamed without losing active or archived work and preserving other data', () => {
  const archived: DeletedTask = { ...task('archived', 'STRATEGY'), done: true, deletedAt: 2,
    timeSpentSeconds: 90, stepList: [{ id: 's1', title: 'Done step', done: true }], steps: 1, currentStep: 1 };
  const workspace = { tabs: [{ id: 'STRATEGY', name: 'My existing category', color: '#123456' }, { id: 'focus', name: 'Focus' }],
    tasks: [task('active', 'STRATEGY'), task('unrelated', 'focus')], deletedTasks: [archived], settings: { lang: 'uk' } };
  const migrated = migrateSystemCategories(workspace);
  assert.deepEqual(migrated.tabs[0], { id: 'category-strategy', name: 'My existing category', color: '#123456' });
  assert.equal(migrated.tasks[0].phase, 'category-strategy');
  assert.equal(migrated.tasks[1], workspace.tasks[1]);
  assert.deepEqual(migrated.deletedTasks[0], { ...archived, phase: 'category-strategy' });
  assert.equal(migrated.settings, workspace.settings);
  assert.equal(workspace.tasks[0].phase, 'STRATEGY', 'input is not mutated');
  assert.equal(workspace.deletedTasks[0].phase, 'STRATEGY');
});

test('migration chooses an unused stable suffix and is idempotent', () => {
  const workspace = { tabs: [{ id: 'STRATEGY', name: 'Legacy' }, { id: 'category-strategy', name: 'Existing' },
    { id: 'category-strategy-2', name: 'Also existing' }], tasks: [task('active', 'STRATEGY')] };
  const migrated = migrateSystemCategories(workspace);
  assert.equal(migrated.tabs[0].id, 'category-strategy-3');
  assert.equal(migrated.tasks[0].phase, 'category-strategy-3');
  assert.equal(migrateSystemCategories(migrated), migrated);
});

test('multiple system collisions are independently mapped and workspaces without collisions keep identity', () => {
  const normal = { tabs: [{ id: 'focus', name: 'Focus' }], tasks: [task('normal', 'focus')] };
  assert.equal(migrateSystemCategories(normal), normal);
  const collided = { tabs: [{ id: 'NOTES', name: 'Notes work' }, { id: 'HISTORY', name: 'Research' }],
    tasks: [task('a', 'NOTES'), task('b', 'HISTORY')] };
  const migrated = migrateSystemCategories(collided);
  assert.deepEqual(migrated.tasks.map(item => item.phase), ['category-notes', 'category-history']);
  assert.equal(migrated.tabs.every(tab => !isSystemView(tab.id)), true);
});
