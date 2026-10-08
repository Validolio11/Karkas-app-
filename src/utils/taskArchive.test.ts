import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DeletedTask } from '../types';
import { isCancelledArchivedTask, isCompletedArchivedTask, isRelevantArchivedTask, selectArchivedTasks, selectRelevantArchivedTasks } from './taskArchive';

const archived = (id: string, fields: Partial<DeletedTask> = {}): DeletedTask => ({
  id, title: id, phase: 'focus', priority: 2, steps: 0, currentStep: 0,
  done: false, pinned: false, createdAt: 10, deletedAt: 20, ...fields,
});

test('archive intent keeps legacy completion and explicit cancellation separate from accidental or unknown removals', () => {
  const cases: { done: boolean; deletionReason?: DeletedTask['deletionReason']; completed: boolean; cancelled: boolean }[] = [
    { done: false, completed: false, cancelled: false },
    { done: false, deletionReason: 'accidental', completed: false, cancelled: false },
    { done: false, deletionReason: 'cancelled', completed: false, cancelled: true },
    { done: true, completed: true, cancelled: false },
    { done: true, deletionReason: 'accidental', completed: false, cancelled: false },
    { done: true, deletionReason: 'cancelled', completed: true, cancelled: false },
  ];
  for (const { completed, cancelled, ...fields } of cases) {
    const task = archived('task', fields);
    assert.equal(isCompletedArchivedTask(task), completed, JSON.stringify(fields));
    assert.equal(isCancelledArchivedTask(task), cancelled, JSON.stringify(fields));
    assert.equal(isRelevantArchivedTask(task), completed || cancelled, JSON.stringify(fields));
  }
});

test('analytics and AI use current task ownership and first archive classification without mutating persisted rows', () => {
  const archive = [
    archived('restored', { done: true }),
    archived('completed', { done: true }),
    archived('completed', { done: true }),
    archived('excluded-newest', { deletionReason: 'accidental' }),
    archived('excluded-newest', { done: true }),
    archived('unknown-newest'),
    archived('unknown-newest', { deletionReason: 'cancelled' }),
    archived('cancelled', { deletionReason: 'cancelled' }),
  ];
  const saved = structuredClone(archive);
  const result = selectRelevantArchivedTasks([{ id: 'restored' }], archive);
  assert.deepEqual(result.map(task => task.id), ['completed', 'cancelled']);
  assert.equal(result[0], archive[1]);
  assert.deepEqual(archive, saved);
});

test('legacy API rows without a usable ID remain independent', () => {
  const archive = [
    { ...archived('first', { done: true }), id: undefined },
    { ...archived('second', { done: true }), id: undefined },
    archived('', { deletionReason: 'cancelled' }),
    archived('   ', { deletionReason: 'cancelled' }),
  ] as unknown as DeletedTask[];
  assert.equal(selectRelevantArchivedTasks([{ id: undefined }, { id: '' }] as unknown as { id: string }[], archive).length, 4);
});

test('trash, completion history and clearing share first-row ownership without reviving excluded older completions', () => {
  const archive = [
    archived('mistake', { deletionReason: 'accidental' }),
    archived('mistake', { done: true }),
    archived('unknown'),
    archived('unknown', { done: true }),
    archived('restored', { done: true }),
    archived('completed', { done: true }),
    archived('completed', { done: true }),
    archived('cancelled', { deletionReason: 'cancelled' }),
  ];
  const current = [{ id: 'restored' }];
  const trash = selectArchivedTasks(current, archive);
  assert.deepEqual(trash.map(task => task.id), ['mistake', 'unknown', 'completed', 'cancelled']);
  const completionHistory = trash.filter(isCompletedArchivedTask);
  const retainedAfterClear = selectRelevantArchivedTasks(current, archive).filter(isCompletedArchivedTask);
  assert.deepEqual(completionHistory.map(task => task.id), ['completed']);
  assert.deepEqual(retainedAfterClear, completionHistory);
  assert.deepEqual(selectRelevantArchivedTasks(current, retainedAfterClear), completionHistory);
  assert.equal(archive.length, 8);
});
