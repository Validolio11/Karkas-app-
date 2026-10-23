import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DeletedTask, PSTask, TaskCompletionLedger } from '../types';
import type { WorkspaceState } from './syncState';
import { diffWorkspaceOperations, type TaskSyncOperation } from './syncOperations';
import { annotateTaskChanges } from './taskActivity';
import { completeTask, reopenTask } from './taskOperations';
import { captureTaskCompletionLedger, countCompletedTasks, isCancelledArchivedTask, isCompletedArchivedTask, isRelevantArchivedTask, mergeCompletionLedgers, normalizeCompletedTaskHistory, retireCompletedTask, selectArchivedTasks, selectRelevantArchivedTasks } from './taskArchive';

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

const completed = (id: string, at: number): PSTask => ({
  id, title: id, phase: 'work', priority: 2, steps: 0, currentStep: 0,
  done: true, pinned: false, createdAt: 1, completedAt: at, updatedAt: at,
});
const workspace = (tasks: PSTask[] = [], deletedTasks: DeletedTask[] = [], completionLedger?: TaskCompletionLedger): WorkspaceState => ({
  tasks, deletedTasks, tabs: [{ id: 'work', name: 'Work' }],
  settings: { lang: 'uk', aiIconVariant: 'quantum', soundEnabled: true, fireEnabled: false,
    ...(completionLedger === undefined ? {} : { completionLedger }) },
});

test('the newest 50 completed details span tasks and archive while all lifetime credits survive pruning and sync tombstones', () => {
  const records = Array.from({ length: 80 }, (_, index) => completed('done-' + index, 100 + index));
  const active = { ...completed('active', 80), done: false, completedAt: undefined };
  const plan = { ...completed('pending-plan', 90), scheduledPending: true };
  const source = workspace([...records.slice(0, 40), active, plan], records.slice(40).map(task => ({ ...task, deletedAt: 1000 })));
  const before = structuredClone(source);
  const saved = normalizeCompletedTaskHistory(source, 10000);
  const retained = [...saved.tasks, ...saved.deletedTasks].filter(task => task.done && !task.scheduledPending);
  assert.equal(retained.length, 50);
  assert.deepEqual(new Set(retained.map(task => task.id)), new Set(records.slice(30).map(task => task.id)));
  assert.equal(countCompletedTasks(saved), 80);
  assert.equal(saved.tasks.some(task => task.id === active.id), true);
  assert.equal(saved.tasks.some(task => task.id === plan.id), true);
  const ledger = saved.settings.completionLedger!;
  for (const task of records.slice(0, 30)) {
    assert.equal(ledger[task.id].counted, true);
    assert.equal(ledger[task.id].retiredAt, 10000);
  }
  const purges = diffWorkspaceOperations(source, saved).filter((operation): operation is TaskSyncOperation => operation.kind === 'task' && operation.lifecycle === 'purged');
  assert.deepEqual(new Set(purges.map(operation => operation.id)), new Set(records.slice(0, 30).map(task => task.id)));
  assert.deepEqual(normalizeCompletedTaskHistory(saved, 11000), saved);
  assert.deepEqual(source, before);
});

test('the 51st detail evicts the oldest without erasing the credit or reviving a stale cloud copy', () => {
  const records = Array.from({ length: 51 }, (_, index) => completed('task-' + index, 100 + index));
  const saved = normalizeCompletedTaskHistory(workspace(records), 1000);
  assert.equal(saved.tasks.length, 50);
  assert.equal(countCompletedTasks(saved), 51);
  const stale = normalizeCompletedTaskHistory({ ...saved, tasks: [...saved.tasks, records[0]] }, 1100);
  assert.equal(stale.tasks.some(task => task.id === records[0].id), false);
  assert.equal(countCompletedTasks(stale), 51);
  const reopened = annotateTaskChanges([records[0]], [reopenTask(records[0], 1200)], 1200)[0];
  const live = normalizeCompletedTaskHistory({ ...saved, tasks: [...saved.tasks, reopened] }, 1200);
  assert.equal(live.tasks.some(task => task.id === reopened.id && !task.done), true);
  assert.equal(countCompletedTasks(live), 50);
  assert.equal(live.settings.completionLedger![reopened.id].retiredAt, 1000);
});

test('duplicate current/archive rows count once and new or scheduled unfinished work never creates a completion', () => {
  const task = completed('one', 100);
  const saved = normalizeCompletedTaskHistory(workspace([task, { ...completed('new', 5), done: false },
    { ...completed('template', 6), scheduledPending: true }], [{ ...task, deletedAt: 200 }, { ...task, deletedAt: 300 }]));
  assert.equal(countCompletedTasks(saved), 1);
  assert.deepEqual(Object.keys(saved.settings.completionLedger!), ['one']);
});

test('device ledger union is commutative, keeps distinct IDs, and an equal-time exclusion beats an old counted copy', () => {
  const left: TaskCompletionLedger = { a: { completedAt: 10, updatedAt: 30, counted: true },
    b: { completedAt: 11, updatedAt: 20, counted: true, retiredAt: 40 } };
  const right: TaskCompletionLedger = { a: { completedAt: 10, updatedAt: 30, counted: false },
    b: { completedAt: 11, updatedAt: 50, counted: false }, c: { completedAt: 12, updatedAt: 22, counted: true } };
  const merged = mergeCompletionLedgers(left, right);
  assert.deepEqual(merged, mergeCompletionLedgers(right, left));
  assert.deepEqual(Object.keys(merged), ['a', 'b', 'c']);
  assert.equal(merged.a.counted, false);
  assert.equal(merged.b.counted, false);
  assert.equal(merged.b.retiredAt, 40);
  assert.deepEqual(captureTaskCompletionLedger([completed('a', 30)], [], merged), merged);
});

test('permanent cleanup keeps completion credit, accidental cleanup excludes it, and repeated cleanup is idempotent', () => {
  const source = workspace([completed('keep', 100), completed('mistake', 110)]);
  const kept = retireCompletedTask(source, 'keep', {}, 200);
  assert.equal(kept.tasks.some(task => task.id === 'keep'), false);
  assert.equal(countCompletedTasks(kept), 2);
  const excluded = retireCompletedTask(kept, 'mistake', { accidental: true }, 300);
  assert.equal(excluded.tasks.length, 0);
  assert.equal(countCompletedTasks(excluded), 1);
  assert.equal(excluded.settings.completionLedger!.mistake.counted, false);
  assert.deepEqual(retireCompletedTask(excluded, 'mistake', {}, 400), excluded);
  const oldCloud = { mistake: { completedAt: 110, updatedAt: 110, counted: true } };
  assert.equal(mergeCompletionLedgers(excluded.settings.completionLedger, oldCloud).mistake.counted, false);
});

test('restoring or editing an accidental completion does not grant credit, including later completion-date corrections', () => {
  const removed = { ...completed('mistake', 100), deletedAt: 200, deletionReason: 'accidental' as const };
  const excluded = normalizeCompletedTaskHistory(workspace([], [removed]), 200);
  const { deletedAt, deletionReason, ...record } = removed;
  const restored = annotateTaskChanges([record], [{ ...record, title: 'Restored', updatedAt: 300 }], 300)[0];
  const active = normalizeCompletedTaskHistory(workspace([restored], [], excluded.settings.completionLedger), 300);
  assert.equal(countCompletedTasks(active), 0);
  assert.equal(active.tasks[0].done, true);
  const corrected = annotateTaskChanges([restored], [{ ...restored, completedAt: 350 }], 400)[0];
  const correction = normalizeCompletedTaskHistory({ ...active, tasks: [corrected] }, 400);
  assert.equal(countCompletedTasks(correction), 0);
  assert.equal(countCompletedTasks(retireCompletedTask(correction, 'mistake', {}, 500)), 0);
});

test('a real reopen and later completion grant one credit again, and Undo restores only that completion status', () => {
  const original = completed('task', 100);
  let state = normalizeCompletedTaskHistory(workspace([original]), 100);
  const reopened = annotateTaskChanges([original], [reopenTask(original, 200)], 200)[0];
  state = normalizeCompletedTaskHistory({ ...state, tasks: [reopened] }, 200);
  assert.equal(countCompletedTasks(state), 0);
  const finished = annotateTaskChanges([reopened], [completeTask(reopened, 300)], 300)[0];
  state = normalizeCompletedTaskHistory({ ...state, tasks: [finished] }, 300);
  assert.equal(countCompletedTasks(state), 1);
  const undo = annotateTaskChanges([finished], [reopenTask(finished, 400)], 400)[0];
  state = normalizeCompletedTaskHistory({ ...state, tasks: [undo] }, 400);
  assert.equal(countCompletedTasks(state), 0);
  assert.equal(Object.keys(state.settings.completionLedger!).length, 1);
});

test('purging immediately after a new completion captures its credit even if the existing receipt still says reopened', () => {
  const undone = { ...completed('task', 100), done: false, completedAt: undefined };
  const receipt = captureTaskCompletionLedger([undone], [], { task: { completedAt: 100, updatedAt: 200, counted: false } });
  const finished = annotateTaskChanges([undone], [completeTask(undone, 300)], 300)[0];
  const purged = retireCompletedTask(workspace([finished], [], receipt), 'task', {}, 400);
  assert.equal(purged.tasks.length, 0);
  assert.equal(countCompletedTasks(purged), 1);
});

test('an actual completion event can restore credit even when its displayed completion date is backdated', () => {
  const done = { ...completed('task', 150), updatedAt: 300,
    activityTrail: [{ id: 'real-completion', at: 300, kind: 'completed' as const }] };
  const saved = normalizeCompletedTaskHistory(workspace([done], [], { task: { completedAt: 100, updatedAt: 200, counted: false } }), 300);
  assert.equal(countCompletedTasks(saved), 1);
  assert.equal(saved.settings.completionLedger!.task.completedAt, 150);
});

test('legacy completions without event history still supersede an older reopened receipt', () => {
  const saved = normalizeCompletedTaskHistory(workspace([completed('legacy', 300)], [], {
    legacy: { completedAt: 100, updatedAt: 200, counted: false },
  }), 300);
  assert.equal(countCompletedTasks(saved), 1);
});

test('cleanup cannot weaken a retained retirement barrier when the device clock moves backwards', () => {
  const old = completed('retired', 100);
  const purged = retireCompletedTask(workspace([old], [], {
    retired: { completedAt: 100, updatedAt: 100, retiredAt: 1000, counted: true },
  }), 'retired', {}, 500);
  assert.ok(purged.settings.completionLedger!.retired.retiredAt! > 1000);
  const stale = { ...old, updatedAt: 900 };
  const reloaded = normalizeCompletedTaskHistory({ ...purged, tasks: [stale] }, 600);
  assert.equal(reloaded.tasks.length, 0);
  assert.equal(countCompletedTasks(reloaded), 1);
});
