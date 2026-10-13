import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PersonalStrategyProfile, PSTask, StrategyDiscoveryTopic } from '../types';
import { createPersonalStrategyProfile } from '../utils/personalStrategy';
import { STRATEGY_DISCOVERY_TOPICS } from '../utils/strategyDiscovery';
import { discoveryCta, discoveryProgress, goalTaskStats, memoryEntryCount, needsStrategyOnboarding, periodAuditStats, rankNextStepCandidates, taskStepProgress } from './strategyViewModel';

const now = new Date(2026, 9, 13, 12).getTime();
const task = (id: string, fields: Partial<PSTask> = {}): PSTask => ({
  id, title: id, phase: 'focus', priority: 2, steps: 0, currentStep: 0, done: false, pinned: false, createdAt: now - 10 * 86_400_000, ...fields,
});
const withTopics = (statuses: Partial<Record<StrategyDiscoveryTopic, 'answered' | 'deferred'>>): PersonalStrategyProfile => {
  const profile = createPersonalStrategyProfile();
  const topics = Object.fromEntries(STRATEGY_DISCOVERY_TOPICS.map(topic => [topic, statuses[topic]
    ? { status: statuses[topic], evidence: [{ quote: `quote about ${topic}`, messageId: `m-${topic}` }] }
    : { status: 'unknown', evidence: [] }]));
  return { ...profile, onboardingStatus: 'in_progress', discovery: { version: 1, topics, selectedGoalIds: [], processedTurnIds: [], phase: 'exploring' } as PersonalStrategyProfile['discovery'] };
};

test('next step puts the strategy focus first, then a running timer, and skips done or planned tasks', () => {
  const tasks = [task('done', { done: true }), task('template', { scheduledPending: true, priority: 1 }), task('p1', { priority: 1 }),
    task('running', { priority: 3, timerRunning: true, timerStartedAt: now }), task('focus', { schedulePlanId: 'plan-1', priority: 3 })];
  const ranked = rankNextStepCandidates(tasks, 'plan-1', now);
  assert.deepEqual(ranked.map(item => item.task.id), ['focus', 'running', 'p1']);
  assert.deepEqual(ranked.map(item => item.reason), ['focus', 'running', 'priority']);
});

test('next step prefers pinned, started and overdue work before plain priority', () => {
  const yesterday = new Date(now - 86_400_000);
  const day = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
  const ranked = rankNextStepCandidates([task('p1', { priority: 1 }), task('overdue', { priority: 3, deadlineDate: day }),
    task('started', { priority: 3, startedAt: now - 1000 }), task('pinned', { priority: 3, pinned: true })], undefined, now);
  assert.deepEqual(ranked.map(item => item.task.id), ['pinned', 'started', 'overdue', 'p1']);
  assert.deepEqual(ranked.map(item => item.reason), ['pinned', 'inProgress', 'deadline', 'priority']);
});

test('step progress points at the first unfinished step for lists and legacy counters', () => {
  const list = taskStepProgress({ steps: 3, currentStep: 0, stepList: [{ id: 'a', title: 'A', done: true }, { id: 'b', title: 'B', done: false }, { id: 'c', title: 'C', done: true }] });
  assert.deepEqual(list, { total: 3, done: 2, nextIndex: 1, nextTitle: 'B', percent: 67 });
  assert.deepEqual(taskStepProgress({ steps: 4, currentStep: 4 }), { total: 4, done: 4, nextIndex: -1, percent: 100 });
  assert.deepEqual(taskStepProgress({ steps: 0, currentStep: 0 }), { total: 0, done: 0, nextIndex: -1, percent: 0 });
});

test('goal stats combine directly linked tasks and category tasks without double counting', () => {
  const tasks = [task('a', { phase: 'work', done: true }), task('b', { phase: 'work' }), task('c', { phase: 'home' }), task('d', { phase: 'home', scheduledPending: true })];
  const stats = goalTaskStats({ taskIds: ['a', 'c'], categoryIds: ['work'] }, tasks);
  assert.deepEqual(stats.active.map(item => item.id), ['b', 'c']);
  assert.equal(stats.done, 1); assert.equal(stats.total, 3); assert.equal(stats.percent, 33);
});

test('period audit counts overdue active tasks and only measured time', () => {
  const stats = periodAuditStats({
    activeInPeriod: [task('late', { deadlineDate: '2026-10-01', timeSpentSeconds: 120 }), task('fresh', { deadlineDate: '2026-12-01' })],
    completedInPeriod: [task('done', { done: true, timeSpentSeconds: 60 })], deletedCompleted: [],
  }, now);
  assert.deepEqual(stats, { completed: 1, active: 2, overdue: 1, trackedSeconds: 180, completionPercent: 33 });
  assert.equal(periodAuditStats({ activeInPeriod: [], completedInPeriod: [], deletedCompleted: [] }, now).trackedSeconds, null);
});

test('discovery shows one button: continue only an open unfinished interview', () => {
  const unfinished = withTopics({ direction: 'answered' });
  assert.equal(discoveryCta(unfinished, true), 'continue');
  assert.equal(discoveryCta(unfinished, false), 'deepen');
  assert.equal(discoveryCta(createPersonalStrategyProfile(), false), 'deepen');
});

test('discovery progress counts grounded answers and deferrals', () => {
  const progress = discoveryProgress(withTopics({ direction: 'answered', barriers: 'deferred' }));
  assert.equal(progress.total, 6); assert.equal(progress.answered, 2);
  assert.deepEqual(progress.statuses, ['answered', 'unknown', 'unknown', 'deferred', 'unknown', 'unknown']);
  assert.equal(discoveryProgress(createPersonalStrategyProfile()).answered, 0);
});

test('onboarding replaces empty strategy and goals; memory count includes interview answers', () => {
  const empty = createPersonalStrategyProfile();
  assert.equal(needsStrategyOnboarding(empty), true);
  assert.equal(needsStrategyOnboarding({ ...empty, goals: [{ id: 'g', title: 'G', motive: '', agreed: false, taskIds: [], categoryIds: [] }] }), false);
  assert.equal(needsStrategyOnboarding({ ...empty, latestStrategy: { narrative: 'Plan', updatedAt: now } }), false);
  const profile = { ...withTopics({ direction: 'answered' }), facts: [{ id: 'f', text: 'Fact', source: 'user' as const }] };
  assert.equal(memoryEntryCount(profile), 2);
});
