import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GrowthSkill, PracticeSession, PSTask, Skill, SkillMeasurement, StrategyGoal } from '../types';
import { GROWTH_STRINGS } from '../components/growth/growthI18n';
import {
  currentValue, goalVersionOf, isConfiguredSkill, isGoalReached, migrateStrategyGoals, nextMeasurementDate, plateau, plannedValueAt,
  progressShare, skillStatus, stretchShare, weakestSubskill, weekReview,
} from './growth';

const at = (day: number, hour = 12) => new Date(2026, 9, day, hour).getTime();
const skill = (overrides: Partial<Skill> = {}): Skill => ({
  id: 'calls', title: 'Холодні дзвінки', metric: { label: 'Конверсія', unit: '%', direction: 'up' },
  start: { value: 0, date: '2026-10-01' }, goal: { value: 100, date: '2026-10-11', label: 'Перша угода' },
  measure: { weekday: 5, minutes: 10, how: '20 дзвінків за однаковим сценарієм' },
  subskills: [{ id: 'opening', title: 'Відкриття' }, { id: 'objections', title: 'Заперечення' }], createdAt: at(1),
  ...overrides,
});
const measurement = (value: number, day: number, extra: Partial<SkillMeasurement> = {}): SkillMeasurement => ({
  id: 'm:' + day, skillId: 'calls', value, at: at(day), ...extra,
});
const session = (id: string, extra: Partial<PracticeSession> = {}): PracticeSession => ({
  id, skillId: 'calls', subskillId: 'opening', at: at(20), difficulty: 'edge', ...extra,
});
const task = (id: string, extra: Partial<PSTask> = {}): PSTask => ({
  id, title: id, phase: 'work', priority: 2, steps: 0, currentStep: 0, done: false, pinned: false, createdAt: at(1), ...extra,
});
const down = () => skill({ metric: { label: 'Час на фічу', unit: 'год', direction: 'down' },
  start: { value: 10, date: '2026-10-01' }, goal: { value: 0, date: '2026-10-11' } });

test('current outcome uses chronological measurements for that skill and ignores tombstones', () => {
  const values = [measurement(12, 4), measurement(99, 6, { skillId: 'other' }), measurement(8, 2),
    measurement(25, 5, { deletedAt: at(6) }), measurement(NaN, 7)];
  assert.equal(currentValue(skill(), values), 12);
  assert.equal(currentValue(skill(), []), 0);
  assert.equal(values[0].value, 12);
});

test('progress respects metric direction, clamps overshoot and handles an already met goal', () => {
  assert.equal(progressShare(skill(), 25), 0.25);
  assert.equal(progressShare(skill(), -10), 0);
  assert.equal(progressShare(skill(), 120), 1);
  assert.equal(progressShare(down(), 7), 0.3);
  assert.equal(progressShare(down(), 12), 0);
  assert.equal(progressShare(down(), -1), 1);
  assert.equal(progressShare(skill({ start: { value: 100, date: '2026-10-01' } }), 100), 1);
  assert.equal(progressShare(skill(), NaN), 0);
});

test('linear plan uses calendar dates and stays at endpoints outside the goal window', () => {
  assert.equal(plannedValueAt(skill(), '2026-10-06'), 50);
  assert.equal(plannedValueAt(down(), '2026-10-06'), 5);
  assert.equal(plannedValueAt(skill(), '2026-09-30'), 0);
  assert.equal(plannedValueAt(skill(), '2026-10-20'), 100);
  assert.equal(plannedValueAt(skill(), at(6, 23)), 50);
  assert.equal(plannedValueAt(skill(), 'invalid'), 0);
  const sameDay = skill({ goal: { value: 100, date: '2026-10-01' } });
  assert.equal(plannedValueAt(sameDay, '2026-10-01'), 100);
});

test('status compares real outcome with planned improvement in either direction', () => {
  assert.deepEqual(skillStatus(skill(), [], at(6)), { kind: 'no_data' });
  assert.deepEqual(skillStatus(skill(), [measurement(43, 6)], at(6)), { kind: 'behind', gapPercent: 14 });
  assert.deepEqual(skillStatus(skill(), [measurement(57, 6)], at(6)), { kind: 'ahead', gapPercent: 14 });
  assert.deepEqual(skillStatus(skill(), [measurement(51, 6)], at(6)), { kind: 'on_track', gapPercent: 2 });
  assert.deepEqual(skillStatus(down(), [measurement(5.7, 6)], at(6)), { kind: 'behind', gapPercent: 14 });
  assert.deepEqual(skillStatus(down(), [measurement(4.3, 6)], at(6)), { kind: 'ahead', gapPercent: 14 });
  assert.deepEqual(skillStatus(skill(), [measurement(100, 9)], at(6)), { kind: 'no_data' });
  assert.deepEqual(skillStatus(skill(), [measurement(0, 1)], at(1)), { kind: 'on_track', gapPercent: 0 });
});

test('plateau needs three observed weeks without a new best, including down metrics', () => {
  assert.equal(plateau(skill(), [], at(30)), null);
  assert.equal(plateau(skill(), [measurement(20, 2)], at(30)), null);
  const unchanged = [measurement(20, 2), measurement(20, 22), measurement(19, 23)];
  assert.deepEqual(plateau(skill(), unchanged, at(30)), { weeks: 3 });
  assert.equal(plateau(skill(), [...unchanged, measurement(21, 24)], at(30)), null);
  assert.deepEqual(plateau(down(), [measurement(8, 2), measurement(9, 23)], at(30)), { weeks: 3 });
  assert.equal(plateau(skill(), [measurement(20, 2), measurement(20, 23, { deletedAt: at(24) })], at(30)), null);
});

test('weakest subskill requires three scored sessions and weighs each actual attempt', () => {
  const values = [
    session('a', { result: { done: 1, of: 1 } }), session('b', { result: { done: 0, of: 8 } }), session('c', { result: { done: 1, of: 1 } }),
    session('d', { subskillId: 'objections', result: { done: 1, of: 2 } }),
    session('e', { subskillId: 'objections', result: { done: 1, of: 2 } }),
    session('f', { subskillId: 'objections', result: { done: 1, of: 2 } }),
    session('invalid', { result: { done: 2, of: 0 } }),
    session('other', { skillId: 'other', result: { done: 0, of: 100 } }),
    session('removed', { result: { done: 0, of: 100 }, deletedAt: at(21) }),
  ];
  assert.deepEqual(weakestSubskill(skill(), values), { subskillId: 'opening', rate: 0.2 });
  assert.equal(weakestSubskill(skill(), values.slice(0, 2)), null);
  assert.equal(weakestSubskill(skill(), [session('no-result')]), null);
});

test('growth-zone share measures edge sessions and excludes deleted entries', () => {
  assert.equal(stretchShare([]), 0);
  assert.equal(stretchShare([session('a'), session('b', { difficulty: 'easy' }), session('c', { difficulty: 'hard' }),
    session('d', { deletedAt: at(21) })]), 1 / 3);
});

test('next measurement follows the local weekday and advances after that day is measured', () => {
  assert.equal(nextMeasurementDate(skill(), [], at(19)), '2026-10-23');
  assert.equal(nextMeasurementDate(skill(), [], at(23)), '2026-10-23');
  assert.equal(nextMeasurementDate(skill(), [measurement(10, 23)], at(23, 15)), '2026-10-30');
  assert.equal(nextMeasurementDate(skill(), [measurement(10, 23, { deletedAt: at(23, 13) })], at(23, 15)), '2026-10-23');
  assert.equal(nextMeasurementDate(skill({ start: { value: 0, date: '2026-11-01' } }), [], at(19)), '2026-11-06');
  assert.equal(nextMeasurementDate(skill({ archivedAt: at(20) }), [], at(23)), null);
  assert.equal(nextMeasurementDate(skill(), [], Number.MAX_VALUE), null);
});

test('week review retains measured deltas, prioritizes latest lessons and records explicit completions', () => {
  const values = [measurement(10, 18), measurement(12, 20, { note: 'Контрольний замір' }), measurement(14, 25), measurement(99, 26)];
  const sessions = [session('early', { at: at(20), lesson: 'Перший висновок' }),
    session('late', { at: at(24), lesson: '  Ставлю конкретне питання  ' }), session('future', { at: at(26), lesson: 'Не цей тиждень' })];
  const completed = task('done', { done: true, completedAt: at(19, 0) });
  const reopened = task('reopened', { activityTrail: [{ id: 'complete', kind: 'completed', at: at(21) }, { id: 'reopen', kind: 'reopened', at: at(22) }] });
  const result = weekReview([skill()], values, sessions, [completed, completed, reopened,
    task('outside', { done: true, completedAt: at(26, 0) }), task('undated', { done: true }),
    task('future-plan', { done: true, completedAt: at(22), scheduledPending: true })], '2026-10-19');
  assert.equal(result.skills[0].from, 10);
  assert.equal(result.skills[0].to, 14);
  assert.equal(result.skills[0].delta, 4);
  assert.equal(result.skills[0].why, 'Ставлю конкретне питання');
  assert.deepEqual(result.skills[0].status, skillStatus(skill(), values.filter(value => value.at < at(26, 0)), at(26, 0) - 1));
  assert.deepEqual(result.completedTasks.map(value => value.id), ['done', 'reopened']);
});

test('review falls back to recorded measurement notes and never invents a reason or completion date', () => {
  const result = weekReview([skill()], [measurement(12, 20, { note: 'Той самий сценарій' })], [], [task('legacy', { done: true })], at(19));
  assert.equal(result.skills[0].from, 0);
  assert.equal(result.skills[0].why, 'Той самий сценарій');
  assert.deepEqual(result.completedTasks, []);
  assert.equal(weekReview([skill()], [], [], [], '2026-10-19').skills[0].why, undefined);
  assert.deepEqual(weekReview([skill()], [], [], [], 'invalid'), { skills: [], completedTasks: [] });
});

test('strategy migration preserves goals as setup drafts without invented metric numbers', () => {
  const goal = (id: string): StrategyGoal => ({ id, title: 'Навчитися вести переговори', motive: 'Робота', agreed: true, taskIds: [], categoryIds: [] });
  const goals = [goal('one'), goal('one'), goal('two')];
  const drafts = migrateStrategyGoals(goals, [], at(20));
  assert.equal(drafts.length, 2);
  assert.equal(drafts[0].title, goals[0].title);
  assert.equal(drafts[0].sourceGoalId, 'one');
  assert.equal(drafts[0].needsSetup, true);
  assert.equal(drafts[0].createdAt, at(20));
  for (const draft of drafts) {
    assert.equal(draft.metric, undefined);
    assert.equal(draft.start, undefined);
    assert.equal(draft.goal, undefined);
    assert.equal(isConfiguredSkill(draft), false);
    assert.deepEqual(skillStatus(draft, [], at(20)), { kind: 'no_data' });
    assert.equal(nextMeasurementDate(draft, [], at(20)), null);
  }
  assert.deepEqual(migrateStrategyGoals(goals, drafts), []);
  const deleted: GrowthSkill[] = drafts.map(value => ({ ...value, deletedAt: at(21) }));
  assert.deepEqual(migrateStrategyGoals(goals, deleted), []);
  assert.deepEqual(migrateStrategyGoals(goals), migrateStrategyGoals(goals));
  assert.ok(!migrateStrategyGoals([goal('source/goal')])[0].id.includes('/'));
  assert.equal(isConfiguredSkill(skill()), true);
});

test('a real metric goal works without a deadline or recurring measurement reminder', () => {
  const value = skill({ goal: { value: 100 }, measure: undefined });
  assert.equal(isConfiguredSkill(value), true);
  assert.equal(nextMeasurementDate(value, [], at(23)), null);
  assert.equal(plannedValueAt(value, '2026-10-23'), value.start.value);
  assert.deepEqual(skillStatus(value, [measurement(40, 22)], at(23)), { kind: 'no_deadline' });
  assert.equal(progressShare(value, currentValue(value, [measurement(40, 22)])), 0.4);
  assert.equal(isGoalReached(value, 99), false);
  assert.equal(isGoalReached(value, 100), true);
  assert.equal(isGoalReached(down(), 0), true);
  assert.equal(isGoalReached(down(), 1), false);
});

test('a measured goal without a deadline has truthful visible labels, including at 100 percent', () => {
  const value = skill({ goal: { value: 100 }, measure: undefined });
  const recorded = [measurement(100, 22)];
  const status = skillStatus(value, recorded, at(23));
  assert.deepEqual(status, { kind: 'no_deadline' });
  assert.equal(GROWTH_STRINGS.uk.statuses[status.kind], 'Без терміну');
  assert.equal(GROWTH_STRINGS.en.statuses[status.kind], 'No deadline');
  assert.equal(progressShare(value, currentValue(value, recorded)), 1);
  assert.equal(weekReview([value], recorded, [], [], '2026-10-19').skills[0].status.kind, 'no_deadline');
  assert.deepEqual(skillStatus(value, [], at(23)), { kind: 'no_data' });
  assert.deepEqual(skillStatus(value, [measurement(100, 22, { deletedAt: at(23) }), measurement(100, 24), measurement(100, 22, { skillId: 'other' })], at(23)), { kind: 'no_data' });
});

test('unrated practice never invents growth-zone scores, measured progress or completed tasks', () => {
  const practice = [session('unrated', { difficulty: undefined, result: undefined, lesson: 'Змінив підхід' })];
  assert.equal(stretchShare(practice), 0);
  assert.equal(stretchShare([...practice, session('rated')]), 1);
  const result = weekReview([skill()], [], practice, [], '2026-10-19');
  assert.equal(result.skills[0].delta, 0);
  assert.equal(result.skills[0].to, skill().start.value);
  assert.deepEqual(result.skills[0].status, { kind: 'no_data' });
  assert.deepEqual(result.completedTasks, []);
});

test('legacy goal versions are deterministic, bounded and change with the actual goal', () => {
  const legacy = skill({ metric: { label: 'Довга назва'.repeat(100), unit: '%', direction: 'up' }, goal: { value: 100, label: 'Ціль'.repeat(300) } });
  assert.equal(goalVersionOf(legacy), goalVersionOf(structuredClone(legacy)));
  assert.ok(goalVersionOf(legacy).length < 512);
  assert.notEqual(goalVersionOf(legacy), goalVersionOf({ ...legacy, goal: { ...legacy.goal, value: 101 } }));
  assert.equal(goalVersionOf({ ...legacy, goalVersion: 'explicit-version' }), 'explicit-version');
});
