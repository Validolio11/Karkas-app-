import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GrowthSkill, PracticeSession, PSTask, Skill, SkillMeasurement } from '../types';
import type { WorkspaceState } from './syncState';
import { useGrowth, growthStateFrom } from '../hooks/useGrowth';
import { canUndoGrowthJournal, type GrowthUndoJournal } from './growthUndo';
import { applyGrowthWorkspaceOperations, diffGrowthWorkspaceOperations } from './growthSync';
import { buildGrowthCloudShadow, emptyGrowthShadowWrites, materializeGrowthCloudShadow, suppressPurgedGrowth, validateGrowthCloudManifest, type GrowthShadowManifest } from './growthCloudShadow';
import { validGrowthEntity } from '../../electron/workspace-validation.mjs';

const skill = (extra: Partial<Skill> = {}): Skill => ({ id: 'skill', title: 'Conversion', metric: { label: 'Conversion', unit: '%', direction: 'up' }, start: { value: 0, date: '2026-01-01' }, goal: { value: 100 }, subskills: [], createdAt: 1, ...extra });
const measurement = (extra: Partial<SkillMeasurement> = {}): SkillMeasurement => ({ id: 'measure', skillId: 'skill', value: 20, at: 2, ...extra });
const session = (extra: Partial<PracticeSession> = {}): PracticeSession => ({ id: 'session', skillId: 'skill', at: 2, ...extra });
const task = (extra: Partial<PSTask> = {}): PSTask => ({ id: 'task', title: 'Practice', phase: 'work', priority: 2, steps: 0, currentStep: 0, done: true, pinned: false, createdAt: 1, completedAt: 2, skillId: 'skill', ...extra });
const workspace = (extra: Partial<WorkspaceState> = {}): WorkspaceState => ({ tasks: [], deletedTasks: [], tabs: [{ id: 'work', name: 'Work' }], skills: [skill()], measurements: [], practiceSessions: [], settings: { soundEnabled: true, fireEnabled: true, lang: 'uk', aiIconVariant: 'quantum' }, ...extra });

// Public React SSR establishes valid hook refs. This exercises synchronous actions, not effects or client rerenders.
function actionsHarness(initial: WorkspaceState) {
  let state = structuredClone(initial), writable = true, commits = true;
  let actions!: ReturnType<typeof useGrowth>;
  function Harness() { actions = useGrowth(growthStateFrom(state), () => state, next => { if (!commits) return false; state = structuredClone(next); return true; }, () => writable, 'owner-a:1'); return null; }
  renderToStaticMarkup(createElement(Harness));
  return { actions, read: () => state, write: (next: WorkspaceState) => { state = next; }, setWritable: (value: boolean) => { writable = value; }, setCommits: (value: boolean) => { commits = value; } };
}

test('practice autosaves keep one session and one measurement ID through edit and mode changes', () => {
  const h = actionsHarness(workspace({ tasks: [task()] }));
  const beforeTasks = structuredClone(h.read().tasks), beforeSettings = structuredClone(h.read().settings);
  const input = { id: 'stable-session', skillId: 'skill', taskId: 'task', at: Date.now() - 1000, result: { done: 2, of: 10 } };
  assert.equal(h.actions.savePracticeResult(input, { value: 20 }), input.id);
  const measurementId = h.read().measurements![0].id;
  assert.equal(h.actions.savePracticeResult({ ...input, result: { done: 3, of: 10 } }, { value: 30 }, h.actions.readPracticeResult(input.id)), input.id);
  assert.equal(h.read().practiceSessions!.length, 1);
  assert.equal(h.read().measurements!.length, 1);
  assert.equal(h.read().measurements![0].id, measurementId);
  assert.equal(h.read().measurements![0].value, 30);
  assert.equal(h.actions.savePracticeResult(input, undefined, h.actions.readPracticeResult(input.id)), input.id);
  assert.ok(h.read().measurements![0].deletedAt);
  assert.equal(h.read().practiceSessions![0].measurementId, measurementId);
  assert.equal(h.actions.savePracticeResult(input, { value: 20 }, h.actions.readPracticeResult(input.id)), input.id);
  assert.equal(h.read().measurements!.length, 1);
  assert.equal(h.read().measurements![0].id, measurementId);
  assert.equal(h.read().measurements![0].deletedAt, undefined);
  assert.equal(h.read().practiceSessions![0].difficulty, undefined);
  assert.deepEqual(h.read().tasks, beforeTasks);
  assert.deepEqual(h.read().settings, beforeSettings);
});

test('practice without a metric stores no fabricated measurement, rating or task completion', () => {
  const h = actionsHarness(workspace({ skills: [] }));
  const id = h.actions.createPracticeSkill({ title: 'Piano' }); assert.ok(id);
  assert.equal(h.actions.savePracticeResult({ id: 'unrated', skillId: id!, lesson: 'Relax shoulders' }), 'unrated');
  const value = h.read().skills![0];
  assert.equal(value.needsSetup, true);
  for (const field of ['metric', 'start', 'goal', 'measure']) assert.equal(value[field as keyof GrowthSkill], undefined);
  assert.deepEqual(h.read().measurements, []);
  assert.equal(h.read().practiceSessions![0].difficulty, undefined);
  assert.equal(h.read().practiceSessions![0].result, undefined);
  assert.equal(h.read().practiceSessions![0].durationSeconds, undefined);
  assert.deepEqual(h.read().tasks, []);
  assert.equal(validGrowthEntity('skill', value), true);
  assert.equal(validGrowthEntity('practiceSession', h.read().practiceSessions![0]), true);
});

test('stale result autosave and unrelated local Undo cannot overwrite another edit', () => {
  const h = actionsHarness(workspace());
  h.actions.savePracticeResult({ id: 'a', skillId: 'skill', lesson: 'First' });
  const stale = structuredClone(h.actions.readPracticeResult('a'));
  h.actions.savePracticeResult({ id: 'a', skillId: 'skill', lesson: 'Newer' }, undefined, stale);
  assert.equal(h.actions.savePracticeResult({ id: 'a', skillId: 'skill', lesson: 'Stale' }, undefined, stale), null);
  h.actions.savePracticeResult({ id: 'b', skillId: 'skill', lesson: 'Other record' });
  const before = structuredClone(h.read());
  assert.equal(h.actions.canUndoChange({ collection: 'practiceSessions', id: 'a' }), false);
  assert.equal(h.actions.undoLastChange({ collection: 'practiceSessions', id: 'a' }), false);
  assert.deepEqual(h.read(), before);
  assert.equal(h.actions.undoLastChange({ collection: 'practiceSessions', id: 'b' }), true);
  assert.equal(h.read().practiceSessions!.find(value => value.id === 'a')!.lesson, 'Newer');
  assert.ok(h.read().practiceSessions!.find(value => value.id === 'b')!.deletedAt);
});

test('failed or read-only growth commits do not claim a saved result or allow Undo', () => {
  const h = actionsHarness(workspace()); h.setCommits(false);
  assert.equal(h.actions.savePracticeResult({ id: 'a', skillId: 'skill' }), null);
  assert.deepEqual(h.read().practiceSessions, []);
  assert.equal(h.actions.canUndoChange(), false);
  h.setCommits(true); h.actions.savePracticeResult({ id: 'a', skillId: 'skill' }); h.setWritable(false);
  const before = structuredClone(h.read()); assert.equal(h.actions.undoLastChange(), false); assert.deepEqual(h.read(), before);
});

test('only a real measurement confirms a goal; maintaining and a new goal preserve one achievement and task credit', () => {
  const h = actionsHarness(workspace({ skills: [skill({ goal: { value: 80 } })], tasks: [task()] }));
  const originalTasks = structuredClone(h.read().tasks);
  h.actions.savePracticeResult({ id: 'practice', skillId: 'skill', lesson: 'Practiced' });
  assert.equal(h.read().skills![0].goalState, undefined);
  h.actions.savePracticeResult({ id: 'measured', skillId: 'skill', at: Date.now() - 1000 }, { value: 80 });
  const achieved = h.read().skills![0] as Skill, version = achieved.goalVersion!;
  assert.equal(achieved.goalState, 'achieved'); assert.ok(version);
  assert.equal(h.actions.acknowledgeGoal(achieved.id, version), true);
  assert.equal(h.actions.resolveGoal(achieved.id, 'maintaining', version), true);
  assert.equal(h.actions.resolveGoal(achieved.id, 'maintaining', version), true);
  assert.equal(h.read().skills![0].goalHistory!.length, 1);
  assert.equal(h.actions.startNewGoal(achieved.id, 'stale-version', 100), false);
  assert.equal(h.actions.startNewGoal(achieved.id, version, 100), true);
  const next = h.read().skills![0] as Skill;
  assert.equal(next.start.value, 80); assert.equal(next.goal.value, 100);
  assert.equal(next.goalState, 'active'); assert.notEqual(next.goalVersion, version);
  assert.equal(next.goalHistory!.length, 1); assert.equal(next.goalAcknowledgedVersion, undefined);
  assert.deepEqual(h.read().tasks, originalTasks);
});

test('Undo snapshots enforce owner/generation, expiry, target and affected-record comparisons', () => {
  const value = session({ lesson: 'Saved' }), state = workspace({ practiceSessions: [value] });
  const journal: GrowthUndoJournal = { scopeKey: 'owner-a:1', expiresAt: 100, changes: [{ collection: 'practiceSessions', id: value.id, before: null, after: structuredClone(value) }] };
  assert.equal(canUndoGrowthJournal(journal, 'owner-a:1', state, 99), true);
  assert.equal(canUndoGrowthJournal(journal, 'owner-b:1', state, 99), false);
  assert.equal(canUndoGrowthJournal(journal, 'owner-a:2', state, 99), false);
  assert.equal(canUndoGrowthJournal(journal, 'owner-a:1', state, 101), false);
  assert.equal(canUndoGrowthJournal(journal, 'owner-a:1', state, 99, { collection: 'measurements', id: value.id }), false);
  assert.equal(canUndoGrowthJournal(journal, 'owner-a:1', { ...state, practiceSessions: [{ ...value, lesson: 'Concurrent' }] }, 99), false);
  assert.equal(canUndoGrowthJournal(journal, 'owner-a:1', { ...state, tasks: [task()] }, 99), true);
});

test('Growth restore requires a newer explicit lifecycle change; permanent purge removes tombstones', () => {
  const before = workspace({ skills: [skill({ deletedAt: 5, updatedAt: 5 })], measurements: [measurement({ deletedAt: 5 })], practiceSessions: [session({ deletedAt: 5 })] });
  const restored = { ...before, skills: [skill({ updatedAt: 6 })] };
  const operations = diffGrowthWorkspaceOperations(before, restored);
  assert.ok(operations[0].unset?.includes('deletedAt'));
  assert.equal(applyGrowthWorkspaceOperations(before, operations, 7).skills![0].deletedAt, undefined);
  assert.equal(applyGrowthWorkspaceOperations(before, [{ kind: 'skill', id: 'skill', lifecycle: 'active', patch: { updatedAt: 5 }, unset: ['deletedAt'] }], 7).skills![0].deletedAt, 5);
  assert.deepEqual(diffGrowthWorkspaceOperations(before, { ...before, skills: [skill({ updatedAt: 4 })] }), []);
  const purged = workspace({ skills: [], measurements: [], practiceSessions: [] });
  const purges = diffGrowthWorkspaceOperations(before, purged);
  assert.deepEqual(purges.map(value => value.lifecycle), ['purged', 'purged', 'purged']);
  assert.deepEqual(applyGrowthWorkspaceOperations(before, JSON.parse(JSON.stringify(purges)), 8), { skills: [], measurements: [], practiceSessions: [] });
});

test('permanent Growth deletion writes payload-free receipts and stale clients cannot downgrade them', () => {
  const before = workspace({ skills: [skill({ deletedAt: 5 })], measurements: [measurement({ deletedAt: 5 })], practiceSessions: [session({ deletedAt: 5 })] });
  const first = buildGrowthCloudShadow(null, before, before, 1, true);
  const after = workspace({ skills: [], measurements: [], practiceSessions: [] });
  const purge = buildGrowthCloudShadow(first.inventory, before, after, 2, false);
  validateGrowthCloudManifest(purge.inventory, 2);
  const documents = emptyGrowthShadowWrites();
  for (const collection of ['skills', 'measurements', 'practiceSessions'] as const) {
    assert.equal(purge.writes[collection][0].lifecycle, 'purged');
    assert.equal(purge.writes[collection][0].value, undefined);
    documents[collection] = purge.writes[collection].map(value => ({ ...value, revision: 2 }));
  }
  assert.deepEqual(materializeGrowthCloudShadow(purge.inventory, documents), { skills: [], measurements: [], practiceSessions: [] });
  for (const reconcile of [false, true]) {
    const stale = buildGrowthCloudShadow(purge.inventory, after, before, 3, reconcile);
    assert.equal(stale.writeCount, 0); assert.deepEqual(stale.inventory, purge.inventory);
  }
});

test('purge suppression removes stale children and links while preserving tasks, counts and unrelated records', () => {
  const source = workspace({ tasks: [task(), task({ id: 'other-task', skillId: 'other-skill' })], deletedTasks: [{ ...task({ id: 'deleted-task' }), deletedAt: 5 }],
    skills: [skill(), skill({ id: 'other-skill' })],
    measurements: [measurement(), measurement({ id: 'orphan-child', skillId: 'other-skill', sessionId: 'purged-session' }), measurement({ id: 'safe-measure', skillId: 'other-skill' })],
    practiceSessions: [session(), session({ id: 'safe-session', skillId: 'other-skill', measurementId: 'purged-measure' })] });
  const original = structuredClone(source);
  const receipts: GrowthShadowManifest = { skills: [{ id: 'skill', revision: 1, lifecycle: 'purged' }], practiceSessions: [{ id: 'purged-session', revision: 1, lifecycle: 'purged' }], measurements: [{ id: 'purged-measure', revision: 1, lifecycle: 'purged' }] };
  const clean = suppressPurgedGrowth(source, receipts);
  assert.deepEqual(clean.skills!.map(value => value.id), ['other-skill']);
  assert.deepEqual(clean.measurements!.map(value => value.id), ['safe-measure']);
  assert.deepEqual(clean.practiceSessions!.map(value => value.id), ['safe-session']);
  assert.equal(clean.practiceSessions![0].measurementId, undefined);
  assert.equal(clean.tasks[0].skillId, undefined); assert.equal(clean.deletedTasks[0].skillId, undefined);
  assert.equal(clean.tasks[0].done, true); assert.equal(clean.tasks[0].completedAt, 2);
  assert.equal(clean.tasks[1].skillId, 'other-skill'); assert.deepEqual(clean.settings, source.settings);
  assert.deepEqual(source, original);
});

test('a reminder-free skill is valid in shadow materialization and legacy fields are left untouched', () => {
  const source = workspace();
  const plan = buildGrowthCloudShadow(null, workspace({ skills: [] }), source, 1, true);
  const documents = emptyGrowthShadowWrites();
  for (const collection of ['skills', 'measurements', 'practiceSessions'] as const) documents[collection] = plan.writes[collection].map(value => ({ ...value, revision: 1 }));
  assert.deepEqual(materializeGrowthCloudShadow(plan.inventory, documents).skills, source.skills);
  assert.deepEqual(diffGrowthWorkspaceOperations(source, { ...source, skills: undefined, measurements: undefined, practiceSessions: undefined }), []);
});

test('creating or editing percent goals rejects out-of-range start and goal values without changing data', () => {
  const h = actionsHarness(workspace());
  const input = (extra: Partial<Skill>) => { const { id: _id, createdAt: _createdAt, ...value } = skill(extra); return value; };
  for (const invalid of [
    { start: { value: -1, date: '2026-01-01' } },
    { goal: { value: 101 } },
    { metric: { label: 'Errors', unit: ' % ', direction: 'down' as const }, start: { value: 101, date: '2026-01-01' }, goal: { value: 90 } },
    { metric: { label: 'Errors', unit: '%', direction: 'down' as const }, start: { value: 100, date: '2026-01-01' }, goal: { value: -1 } },
  ]) {
    const before = structuredClone(h.read());
    assert.equal(h.actions.createSkill(input(invalid)), null);
    assert.equal(h.actions.updateSkill('skill', invalid), false);
    assert.deepEqual(h.read(), before);
  }
  assert.ok(h.actions.createSkill(input({ start: { value: 0, date: '2026-01-01' }, goal: { value: 100 } })));
  assert.ok(h.actions.createSkill(input({ metric: { label: 'Errors', unit: '%', direction: 'down' }, start: { value: 100, date: '2026-01-01' }, goal: { value: 0 } })));
  assert.equal(h.actions.updateSkill('skill', { goal: { value: 50 } }), true);
  assert.ok(h.actions.createSkill(input({ metric: { label: 'Words', unit: 'words', direction: 'up' }, start: { value: 101, date: '2026-01-01' }, goal: { value: 200 } })));
});

test('next percent goals remain attainable at both percentage boundaries', () => {
  for (const direction of ['up', 'down'] as const) {
    const start = direction === 'up' ? 0 : 100, reached = direction === 'up' ? 80 : 20, boundary = direction === 'up' ? 100 : 0, invalid = direction === 'up' ? 101 : -1;
    const h = actionsHarness(workspace({ skills: [skill({ metric: { label: 'Percent', unit: '%', direction }, start: { value: start, date: '2026-01-01' }, goal: { value: reached } })] }));
    h.actions.savePracticeResult({ id: 'confirmed', skillId: 'skill', at: Date.now() - 1000 }, { value: reached });
    const version = h.read().skills![0].goalVersion!;
    const before = structuredClone(h.read());
    assert.equal(h.actions.startNewGoal('skill', version, invalid), false);
    assert.deepEqual(h.read(), before);
    assert.equal(h.actions.startNewGoal('skill', version, boundary), true);
    h.actions.savePracticeResult({ id: 'boundary', skillId: 'skill', at: Date.now() }, { value: boundary });
    const nextVersion = h.read().skills![0].goalVersion!;
    assert.equal(h.actions.startNewGoal('skill', nextVersion, invalid), false);
    assert.equal(h.actions.startNewGoal('skill', nextVersion, boundary), false);
  }
  const legacy = actionsHarness(workspace({ skills: [skill({ start: { value: -20, date: '2026-01-01' }, goal: { value: -10 }, goalVersion: 'legacy-invalid-percent' })], measurements: [measurement({ value: -5 })] }));
  const before = structuredClone(legacy.read());
  assert.equal(legacy.actions.startNewGoal('skill', 'legacy-invalid-percent', 50), false);
  assert.deepEqual(legacy.read(), before);
});
