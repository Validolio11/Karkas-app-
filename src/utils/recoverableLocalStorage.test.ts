import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeRecoverableJson } from './recoverableLocalStorage';

function storage(initial: [string, string][] = []) {
  const values = new Map(initial);
  return { values, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); } };
}

test('malformed task bytes are preserved before an empty recovery snapshot replaces them', () => {
  const disk = storage([['tasks', '[{"id":"unfinished']]);
  writeRecoverableJson(disk, 'tasks', '[]');
  assert.equal(disk.getItem('tasks'), '[]');
  assert.deepEqual([...disk.values].filter(([key]) => key.startsWith('tasks:corrupt:')).map(([, raw]) => raw), ['[{"id":"unfinished']);
});

test('backup failure prevents overwriting the malformed source', () => {
  const disk = storage([['workspace:A', '{broken']]);
  const denied = { ...disk, setItem: (key: string, value: string) => {
    if (key.includes(':corrupt:')) throw new Error('quota exceeded');
    disk.setItem(key, value);
  } };
  assert.throws(() => writeRecoverableJson(denied, 'workspace:A', '{}'), /quota exceeded/);
  assert.equal(disk.getItem('workspace:A'), '{broken');
});

test('silent backup failure also keeps original data intact', () => {
  const disk = storage([['tasks', '']]);
  const denied = { ...disk, setItem: () => undefined };
  assert.throws(() => writeRecoverableJson(denied, 'tasks', '[]'), /preserve/);
  assert.equal(disk.getItem('tasks'), '');
});

test('valid and missing snapshots write normally without unnecessary backups', () => {
  const disk = storage([['tasks', '[{"id":"task"}]']]);
  writeRecoverableJson(disk, 'tasks', '[]');
  writeRecoverableJson(disk, 'workspace:B', '{"tasks":[]}');
  assert.equal(disk.values.size, 2);
  assert.equal(disk.getItem('workspace:B'), '{"tasks":[]}');
});

test('a second corruption creates a distinct backup without replacing the first', () => {
  const disk = storage([['tasks', 'broken-1']]);
  writeRecoverableJson(disk, 'tasks', '[]');
  disk.setItem('tasks', 'broken-2');
  writeRecoverableJson(disk, 'tasks', '[]');
  assert.deepEqual([...disk.values].filter(([key]) => key.startsWith('tasks:corrupt:')).map(([, raw]) => raw), ['broken-1', 'broken-2']);
});

test('an invalid outgoing snapshot cannot replace a usable source', () => {
  const disk = storage([['tasks', '[{"id":"keep"}]']]);
  assert.throws(() => writeRecoverableJson(disk, 'tasks', 'invalid'), SyntaxError);
  assert.equal(disk.getItem('tasks'), '[{"id":"keep"}]');
});
