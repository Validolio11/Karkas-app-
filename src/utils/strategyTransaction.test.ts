import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PersonalStrategyProfile, PSTask } from '../types';
import { createPersonalStrategyProfile, personalStrategyKey } from './personalStrategy';
import { clearStrategyTransaction, completeStrategyTransaction, markStrategyTransactionConflict, readStrategyTransaction,
  recoverStrategyTransaction, stageStrategyTransaction, strategyTransactionKey } from './strategyTransaction';

function storage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
}
const task = (id: string, changes: Partial<PSTask> = {}): PSTask => ({
  id, title: id, phase: 'focus', priority: 2, steps: 0, currentStep: 0,
  done: false, pinned: false, createdAt: 1, ...changes,
});
const profile = (): PersonalStrategyProfile => ({ ...createPersonalStrategyProfile(), processedTurnIds: ['turn-1'] });

function pendingSave() {
  let acknowledge!: (value: boolean) => void;
  const promise = new Promise<boolean>(resolve => { acknowledge = resolve; });
  return { promise, acknowledge };
}

test('paired transaction stays recoverable until its captured desktop save is acknowledged', async () => {
  const disk = storage();
  const before = [task('existing')], after = [task('created'), ...before];
  stageStrategyTransaction(disk, 'A', before, after, profile());
  const journal = disk.getItem(strategyTransactionKey('A'));
  const save = pendingSave();
  const complete = completeStrategyTransaction(disk, 'A', journal, save.promise, () => true);
  assert.deepEqual(recoverStrategyTransaction(disk, 'A', before).tasks, after, 'a crash before IPC acknowledgement can replay the pair');
  save.acknowledge(true);
  assert.equal(await complete, true);
  assert.equal(disk.getItem(strategyTransactionKey('A')), null);
});

test('failed and rejected desktop saves retain the journal', async () => {
  const disk = storage();
  stageStrategyTransaction(disk, 'A', [], [task('created')], profile());
  const journal = disk.getItem(strategyTransactionKey('A'));
  assert.equal(await completeStrategyTransaction(disk, 'A', journal, Promise.resolve(false), () => true), false);
  assert.equal(await completeStrategyTransaction(disk, 'A', journal, Promise.reject(new Error('disk unavailable')), () => true), false);
  assert.equal(disk.getItem(strategyTransactionKey('A')), journal);
});

test('account generation changes invalidate an old desktop acknowledgement', async () => {
  const disk = storage();
  stageStrategyTransaction(disk, 'A', [], [task('created')], profile());
  const journal = disk.getItem(strategyTransactionKey('A'));
  const save = pendingSave();
  let generation = 1;
  const complete = completeStrategyTransaction(disk, 'A', journal, save.promise, () => generation === 1);
  generation = 2;
  save.acknowledge(true);
  assert.equal(await complete, false);
  assert.equal(disk.getItem(strategyTransactionKey('A')), journal);
});

test('old completion cannot clear a new journal after memory reset', async () => {
  const disk = storage();
  stageStrategyTransaction(disk, 'A', [], [task('created')], profile());
  const oldJournal = disk.getItem(strategyTransactionKey('A'));
  const save = pendingSave();
  const complete = completeStrategyTransaction(disk, 'A', oldJournal, save.promise, () => true);
  clearStrategyTransaction(disk, 'A');
  const empty = createPersonalStrategyProfile();
  stageStrategyTransaction(disk, 'A', [task('created')], [task('created')], empty);
  const resetJournal = disk.getItem(strategyTransactionKey('A'));
  save.acknowledge(true);
  assert.equal(await complete, false);
  assert.equal(disk.getItem(strategyTransactionKey('A')), resetJournal);
  assert.deepEqual(recoverStrategyTransaction(disk, 'A', [task('created')]).profile, empty, 'recovery cannot resurrect discarded memory');
});

test('reset generation prevents clearing even an identical subsequently staged journal', async () => {
  const disk = storage();
  stageStrategyTransaction(disk, 'A', [], [task('created')], profile());
  const oldJournal = disk.getItem(strategyTransactionKey('A'));
  const save = pendingSave();
  let epoch = 0;
  const complete = completeStrategyTransaction(disk, 'A', oldJournal, save.promise, () => epoch === 0);
  ++epoch;
  clearStrategyTransaction(disk, 'A');
  stageStrategyTransaction(disk, 'A', [], [task('created')], profile());
  save.acknowledge(true);
  assert.equal(await complete, false);
  assert.equal(disk.getItem(strategyTransactionKey('A')), oldJournal);
});

test('failure to remove a confirmed journal preserves recovery evidence', async () => {
  const disk = storage();
  stageStrategyTransaction(disk, 'A', [], [task('created')], profile());
  const journal = disk.getItem(strategyTransactionKey('A'));
  const blocked = { ...disk, removeItem: () => { throw new Error('storage denied'); } };
  assert.equal(await completeStrategyTransaction(blocked, 'A', journal, Promise.resolve(true), () => true), false);
  assert.equal(disk.getItem(strategyTransactionKey('A')), journal);
});

test('crash after profile write recovers its paired task without a duplicate on repeated recovery', () => {
  const disk = storage();
  const before = [task('existing')];
  const after = [task('created'), ...before];
  assert.equal(stageStrategyTransaction(disk, 'A', before, after, profile()), true);
  disk.setItem(personalStrategyKey('A'), JSON.stringify(profile()));
  const recovered = recoverStrategyTransaction(disk, 'A', before);
  assert.equal(recovered.status, 'recovered');
  assert.deepEqual(recovered.tasks, after);
  assert.deepEqual(recovered.profile?.processedTurnIds, ['turn-1']);
  assert.equal(readStrategyTransaction(disk, 'A')?.status, 'pending', 'recovery itself does not clear durable evidence');
  const repeated = recoverStrategyTransaction(disk, 'A', recovered.tasks);
  assert.deepEqual(repeated.tasks, after);
  assert.equal(clearStrategyTransaction(disk, 'A'), true);
  assert.equal(recoverStrategyTransaction(disk, 'A', after).status, 'none');
});

test('crash after task write returns matching profile and preserves unrelated newer edits', () => {
  const disk = storage();
  const before = [task('target'), task('other')];
  const after = [task('target', { priority: 1 }), before[1]];
  assert.equal(stageStrategyTransaction(disk, 'A', before, after, profile()), true);
  const newerOther = task('other', { title: 'New manual title', timeSpentSeconds: 90 });
  const current = [after[0], newerOther, task('new-unrelated')];
  const recovered = recoverStrategyTransaction(disk, 'A', current);
  assert.equal(recovered.status, 'recovered');
  assert.deepEqual(recovered.tasks, current);
  assert.equal(recovered.tasks[1], newerOther);
  assert.deepEqual(recovered.profile, profile());
});

test('update recovery applies only affected IDs, including reordered optional fields', () => {
  const disk = storage();
  const before = [task('target', { note: undefined }), task('other')];
  const after = [task('target', { title: 'Adapted plan' }), before[1]];
  assert.equal(stageStrategyTransaction(disk, null, before, after, profile()), true);
  const current = [{ ...before[0] }, task('other', { pinned: true }), task('extra')];
  const recovered = recoverStrategyTransaction(disk, null, current);
  assert.equal(recovered.status, 'recovered');
  assert.equal(recovered.tasks[0].title, 'Adapted plan');
  assert.equal(recovered.tasks[1].pinned, true);
  assert.equal(recovered.tasks[2].id, 'extra');
  assert.deepEqual(current[0], before[0], 'pure recovery must not mutate its input');
});

test('interrupted undo removes only its created task and is idempotent', () => {
  const disk = storage();
  const before = [task('created'), task('other')];
  const after = [before[1]];
  assert.equal(stageStrategyTransaction(disk, 'A', before, after, profile()), true);
  const recovered = recoverStrategyTransaction(disk, 'A', [before[0], task('other', { note: 'newer' })]);
  assert.equal(recovered.status, 'recovered');
  assert.deepEqual(recovered.tasks, [task('other', { note: 'newer' })]);
  assert.deepEqual(recoverStrategyTransaction(disk, 'A', recovered.tasks).tasks, recovered.tasks);
});

test('interrupted undo of an update restores the old plan while preserving unrelated records', () => {
  const disk = storage();
  const original = task('target');
  const adapted = task('target', { priority: 1 });
  assert.equal(stageStrategyTransaction(disk, 'A', [adapted], [original], profile()), true);
  const recovered = recoverStrategyTransaction(disk, 'A', [adapted, task('unrelated')]);
  assert.deepEqual(recovered.tasks, [original, task('unrelated')]);
});

test('newer progress on an affected task prevents the entire paired commit and marks evidence', () => {
  const disk = storage();
  const before = [task('target')];
  const after = [task('new'), task('target', { title: 'Adapted' })];
  assert.equal(stageStrategyTransaction(disk, 'A', before, after, profile()), true);
  const current = [task('target', { timeSpentSeconds: 60 })];
  const recovered = recoverStrategyTransaction(disk, 'A', current);
  assert.equal(recovered.status, 'conflict');
  assert.equal(recovered.tasks, current);
  assert.equal(recovered.profile, null);
  assert.deepEqual(recovered.conflictTaskIds, ['target']);
  assert.equal(markStrategyTransactionConflict(disk, 'A', recovered.conflictTaskIds), true);
  assert.equal(readStrategyTransaction(disk, 'A')?.status, 'conflict');
  assert.equal(stageStrategyTransaction(disk, 'A', current, after, profile()), false);
});

test('account journal cannot be read, recovered or cleared through another owner', () => {
  const disk = storage();
  assert.equal(stageStrategyTransaction(disk, 'A', [], [task('new')], profile()), true);
  assert.equal(readStrategyTransaction(disk, 'B'), null);
  assert.equal(recoverStrategyTransaction(disk, 'B', []).status, 'none');
  assert.equal(clearStrategyTransaction(disk, 'B'), true);
  assert.notEqual(readStrategyTransaction(disk, 'A'), null);
  disk.setItem(strategyTransactionKey('B'), disk.getItem(strategyTransactionKey('A'))!);
  assert.equal(readStrategyTransaction(disk, 'B'), null);
  assert.equal(recoverStrategyTransaction(disk, 'B', []).status, 'invalid');
  assert.equal(stageStrategyTransaction(disk, 'B', [], [], profile()), false);
});

test('unresolved corrupted evidence and failed writes never authorize a mutation', () => {
  const disk = storage();
  disk.setItem(strategyTransactionKey(null), 'broken JSON');
  assert.equal(stageStrategyTransaction(disk, null, [], [task('new')], profile()), false);
  assert.equal(recoverStrategyTransaction(disk, null, []).status, 'invalid');
  assert.equal(disk.getItem(strategyTransactionKey(null)), 'broken JSON');
  const unavailable = { ...storage(), setItem: () => { throw new Error('storage full'); } };
  assert.equal(stageStrategyTransaction(unavailable, null, [], [task('new')], profile()), false);
});

test('newer colliding create or deletion is a conflict rather than overwritten/resurrected data', () => {
  const disk = storage();
  assert.equal(stageStrategyTransaction(disk, 'A', [], [task('new')], profile()), true);
  assert.equal(recoverStrategyTransaction(disk, 'A', [task('new', { title: 'Manual task' })]).status, 'conflict');
  assert.equal(clearStrategyTransaction(disk, 'A'), true);
  assert.equal(stageStrategyTransaction(disk, 'A', [task('target')], [task('target', { priority: 1 })], profile()), true);
  assert.equal(recoverStrategyTransaction(disk, 'A', []).status, 'conflict');
});
