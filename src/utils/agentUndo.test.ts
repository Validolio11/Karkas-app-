import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DeletedTask, NotepadNote, PSTask } from '../types';
import type { AgentWorkspace } from './aiAgentActions';
import { captureAgentUndo, undoAgentTurn } from './agentUndo';

const task = (id = 'task'): PSTask => ({ id, title: 'Анімація', phase: 'work', priority: 2,
  steps: 0, currentStep: 0, done: false, pinned: false, createdAt: 1 });
const note: NotepadNote = { id: 'note', title: 'Ідеї', content: 'Ескізи', createdAt: 1 };
const workspace = (fields: Partial<AgentWorkspace> = {}): AgentWorkspace => ({ tasks: [task()],
  deletedTasks: [], tabs: [{ id: 'work', name: 'Робота' }], notes: [note], ...fields });

test('agent undo restores changed records in every collection while keeping unrelated newer records', () => {
  const archived: DeletedTask = { ...task('archived'), deletedAt: 2 };
  const before = workspace({ deletedTasks: [archived] });
  const after = workspace({ tasks: [{ ...task(), title: 'Новий заголовок' }],
    deletedTasks: [{ ...archived, note: 'Змінено' }],
    tabs: [{ id: 'work', name: 'Проєкти', color: 'blue' }], notes: [{ ...note, content: 'Нові ідеї' }] });
  const undo = captureAgentUndo(before, after);
  const extra = task('unrelated');
  const current = { ...after, tasks: [...after.tasks, extra] };
  const result = undoAgentTurn(current, undo);
  assert.equal(result.undone, true);
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.workspace, { ...before, tasks: [...before.tasks, extra] });
  assert.equal(current.tasks[0].title, 'Новий заголовок');
});

test('a newer edit to one task blocks the entire turn without reverting another record', () => {
  const before = workspace();
  const after = workspace({ tasks: [{ ...task(), title: 'Змінено агентом' }], notes: [{ ...note, content: 'Змінено агентом' }] });
  const current = { ...after, tasks: [{ ...after.tasks[0], priority: 1 as const }] };
  const result = undoAgentTurn(current, captureAgentUndo(before, after));
  assert.equal(result.undone, false);
  assert.equal(result.workspace, current);
  assert.deepEqual(result.conflicts, [{ collection: 'tasks', id: 'task' }]);
});

test('tab and note edits, missing records and reused created ids conflict', () => {
  const before = workspace({ tasks: [] });
  const after = workspace({ tasks: [task('created')], tabs: [{ id: 'work', name: 'Проєкти' }],
    notes: [{ ...note, content: 'Змінено' }] });
  const undo = captureAgentUndo(before, after);
  const current = { ...after, tasks: [{ ...task('created'), title: 'Повторно використаний id' }],
    tabs: [], notes: [{ ...after.notes[0], updatedAt: 10 }] };
  const result = undoAgentTurn(current, undo);
  assert.equal(result.undone, false);
  assert.deepEqual(result.conflicts, [{ collection: 'tasks', id: 'created' },
    { collection: 'tabs', id: 'work' }, { collection: 'notes', id: 'note' }]);
});

test('created records are removed and deleted records restored at their previous positions', () => {
  const removed = task('removed');
  const archived: DeletedTask = { ...task('archived'), deletedAt: 2 };
  const before = workspace({ tasks: [task('first'), removed, task('last')], deletedTasks: [archived],
    tabs: [{ id: 'work', name: 'Робота' }, { id: 'old', name: 'Стара' }], notes: [note] });
  const after = workspace({ tasks: [task('first'), task('last'), task('created')], deletedTasks: [],
    tabs: [{ id: 'work', name: 'Робота' }, { id: 'new', name: 'Нова' }],
    notes: [{ id: 'new-note', title: 'Нова', content: '', createdAt: 2 }] });
  const result = undoAgentTurn(after, captureAgentUndo(before, after));
  assert.equal(result.undone, true);
  assert.deepEqual(result.workspace, before);
});

test('task deletion and archive restoration undo both sides of the move', () => {
  const before = workspace();
  const archived: DeletedTask = { ...task(), deletedAt: 10, deletionReason: 'cancelled' };
  const after = workspace({ tasks: [], deletedTasks: [archived] });
  const deletedUndo = undoAgentTurn(after, captureAgentUndo(before, after));
  assert.equal(deletedUndo.undone, true);
  assert.deepEqual(deletedUndo.workspace, before);
  const restoredUndo = undoAgentTurn(before, captureAgentUndo(after, before));
  assert.equal(restoredUndo.undone, true);
  assert.deepEqual(restoredUndo.workspace, after);
});

test('banked time and audit fields do not conflict and their current values survive undo', () => {
  const before = workspace({ tasks: [{ ...task(), timeSpentSeconds: 5, updatedAt: 1,
    stepList: [{ id: 'step', title: 'Крок', done: false, timeSpentSeconds: 5 }] }] });
  const after = { ...before, tasks: [{ ...before.tasks[0], title: 'Змінено', updatedAt: 2 }] };
  const live = { ...after.tasks[0], timeSpentSeconds: 20, updatedAt: 3,
    timeSessions: { session: { seconds: 15, stepId: 'step' } },
    activityTrail: [{ id: 'started', at: 3, kind: 'started' as const }],
    stepList: [{ id: 'step', title: 'Крок', done: false, timeSpentSeconds: 20 }] };
  const result = undoAgentTurn({ ...after, tasks: [live] }, captureAgentUndo(before, after));
  assert.equal(result.undone, true);
  assert.deepEqual(result.workspace.tasks, [{ ...live, title: task().title }]);
  const editedStep = { ...live, stepList: [{ ...live.stepList[0], done: true }] };
  assert.equal(undoAgentTurn({ ...after, tasks: [editedStep] }, captureAgentUndo(before, after)).undone, false);
});

test('undo retains missing live bank fields and banked time across archive moves; created tasks are removed', () => {
  const before = workspace({ tasks: [{ ...task(), timeSpentSeconds: 5, updatedAt: 1 }] });
  const archived: DeletedTask = { ...task(), title: 'Архів', deletedAt: 10 };
  const after = workspace({ tasks: [task('created')], deletedTasks: [archived] });
  const liveArchived = { ...archived, timeSpentSeconds: 30, timeSessions: { session: { seconds: 30 } } };
  const current = { ...after, tasks: [{ ...task('created'), timeSpentSeconds: 9 }], deletedTasks: [liveArchived] };
  const result = undoAgentTurn(current, captureAgentUndo(before, after));
  assert.equal(result.undone, true);
  assert.deepEqual(result.workspace.tasks, [{ ...task(), timeSpentSeconds: 30, timeSessions: liveArchived.timeSessions }]);
  assert.deepEqual(result.workspace.deletedTasks, []);
});

test('snapshots are detached and canonical equality tolerates property order and undefined fields', () => {
  const before = workspace();
  const after = workspace({ tasks: [{ ...task(), title: 'Змінено', note: undefined }] });
  const undo = captureAgentUndo(before, after);
  before.tasks[0].title = 'Зміна початкового знімка';
  const current = { ...after, tasks: [{ title: 'Змінено', id: 'task', phase: 'work', priority: 2 as const, steps: 0, currentStep: 0, done: false, pinned: false, createdAt: 1 }] };
  const result = undoAgentTurn(current, undo);
  assert.equal(result.undone, true);
  assert.equal(result.workspace.tasks[0].title, 'Анімація');
});

test('changed ids limit capture without including untouched records', () => {
  const before = workspace();
  const after = workspace({ tasks: [{ ...task(), title: 'Змінено' }], notes: [{ ...note, content: 'Змінено' }] });
  const undo = captureAgentUndo(before, after, { tasks: [], notes: ['note'] });
  assert.deepEqual(undo.tasks, []);
  assert.equal(undo.notes.length, 1);
  const selected = captureAgentUndo(before, after, ['task']);
  assert.equal(selected.tasks.length, 1);
  assert.deepEqual(selected.notes, []);
});
