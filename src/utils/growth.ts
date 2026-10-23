import type { GrowthSkill, PracticeSession, PSTask, Skill, SkillDraft, SkillMeasurement, StrategyGoal } from '../types';
import { isTaskDate, localTaskDate } from './taskDates';

export interface GrowthStatus {
  kind: 'ahead' | 'on_track' | 'behind' | 'no_data' | 'no_deadline';
  gapPercent?: number;
}

export interface SkillWeekReview {
  skillId: string;
  delta: number;
  from: number;
  to: number;
  status: GrowthStatus;
  why?: string;
}

const DAY = 86400000;
const WEEK = 7 * DAY;
const STATUS_TOLERANCE_PERCENT = 5;
const MIN_SUBSKILL_SESSIONS = 3;
type GrowthDate = string | number | Date;
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const live = (record: { deletedAt?: number }) => record.deletedAt === undefined;

export function isConfiguredSkill(skill: GrowthSkill): skill is Skill {
  return !skill.needsSetup && !!skill.metric && !!skill.start && !!skill.goal;
}

export function goalVersionOf(skill: Skill): string {
  if (skill.goalVersion) return skill.goalVersion;
  const source = JSON.stringify([skill.metric, skill.start, skill.goal]);
  let first = 2166136261, second = 5381;
  for (let i = 0; i < source.length; i++) { first = Math.imul(first ^ source.charCodeAt(i), 16777619); second = Math.imul(second, 33) ^ source.charCodeAt(i); }
  return `legacy-goal-${(first >>> 0).toString(36)}-${(second >>> 0).toString(36)}`;
}
export function isGoalReached(skill: Skill, value: number): boolean {
  return Number.isFinite(value) && (value - skill.goal.value) * (skill.metric.direction === 'down' ? -1 : 1) >= 0;
}

function calendarDay(value: GrowthDate): number | null {
  const date = typeof value === 'string' ? value : localTaskDate(value instanceof Date ? value.getTime() : value);
  if (!isTaskDate(date)) return null;
  const [year, month, day] = date.split('-').map(Number);
  const result = new Date(0);
  result.setUTCHours(0, 0, 0, 0);
  result.setUTCFullYear(year, month - 1, day);
  return result.getTime();
}

function localMidnight(value: GrowthDate): number | null {
  const day = calendarDay(value);
  if (day === null) return null;
  const utc = new Date(day);
  const date = new Date(0);
  date.setFullYear(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function measurementsFor(skill: GrowthSkill, measurements: readonly SkillMeasurement[], until = Infinity): SkillMeasurement[] {
  return measurements.filter(value => live(value) && value.skillId === skill.id && Number.isFinite(value.value)
    && Number.isFinite(value.at) && value.at >= 0 && value.at <= until)
    .slice().sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

export function currentValue(skill: Skill, measurements: readonly SkillMeasurement[]): number {
  return measurementsFor(skill, measurements).at(-1)?.value ?? skill.start.value;
}

export function progressShare(skill: Skill, value: number): number {
  if (!Number.isFinite(value)) return 0;
  const direction = skill.metric.direction === 'down' ? -1 : 1;
  const distance = (skill.goal.value - skill.start.value) * direction;
  if (distance <= 0) return (value - skill.goal.value) * direction >= 0 ? 1 : 0;
  return clamp((value - skill.start.value) * direction / distance);
}

/** Calendar-day interpolation stays stable through local daylight-saving changes. */
export function plannedValueAt(skill: Skill, date: GrowthDate): number {
  if (!skill.goal.date) return skill.start.value;
  const start = calendarDay(skill.start.date);
  const goal = calendarDay(skill.goal.date);
  const at = calendarDay(date);
  if (start === null || goal === null || at === null) return skill.start.value;
  const share = goal <= start ? (at >= goal ? 1 : 0) : clamp((at - start) / (goal - start));
  return skill.start.value + (skill.goal.value - skill.start.value) * share;
}

/** Gap is a percentage of planned improvement, with a five-percent tolerance. */
export function skillStatus(skill: GrowthSkill, measurements: readonly SkillMeasurement[], now: number): GrowthStatus {
  if (!isConfiguredSkill(skill) || !Number.isFinite(now)) return { kind: 'no_data' };
  const observed = measurementsFor(skill, measurements, now);
  if (!observed.length) return { kind: 'no_data' };
  if (!skill.goal.date) return { kind: 'no_deadline' };
  const planned = plannedValueAt(skill, now);
  const direction = skill.metric.direction === 'down' ? -1 : 1;
  const distance = Math.abs(planned - skill.start.value) || Math.abs(skill.goal.value - skill.start.value);
  const gap = (observed[observed.length - 1].value - planned) * direction;
  const percent = distance ? gap / distance * 100 : 0;
  if (Math.abs(percent) <= STATUS_TOLERANCE_PERCENT) return { kind: 'on_track', gapPercent: Math.round(Math.abs(percent)) };
  return { kind: percent > 0 ? 'ahead' : 'behind', gapPercent: Math.round(Math.abs(percent)) };
}

/** A later observation must confirm the plateau; missing measurements are not stagnation. */
export function plateau(skill: GrowthSkill, measurements: readonly SkillMeasurement[], now: number): { weeks: number } | null {
  if (!isConfiguredSkill(skill) || !Number.isFinite(now)) return null;
  const startAt = localMidnight(skill.start.date);
  if (startAt === null) return null;
  const observed = measurementsFor(skill, measurements, now).filter(value => value.at >= startAt);
  if (!observed.length) return null;
  const direction = skill.metric.direction === 'down' ? -1 : 1;
  let best = skill.start.value;
  let bestAt = startAt;
  for (const measurement of observed) {
    if ((measurement.value - best) * direction > 0) {
      best = measurement.value;
      bestAt = measurement.at;
    }
  }
  const weeks = Math.floor((observed[observed.length - 1].at - bestAt) / WEEK);
  return weeks >= 3 ? { weeks } : null;
}

/** Weight by attempts; three scored sessions are required before reporting a rate. */
export function subskillSuccessRate(skillId: string, subskillId: string, sessions: readonly PracticeSession[]): number | null {
  const scored = sessions.filter(session => live(session) && session.skillId === skillId && session.subskillId === subskillId
    && session.result && Number.isFinite(session.result.done) && Number.isFinite(session.result.of)
    && session.result.of > 0 && session.result.done >= 0 && session.result.done <= session.result.of);
  if (scored.length < MIN_SUBSKILL_SESSIONS) return null;
  return scored.reduce((sum, session) => sum + session.result!.done, 0)
    / scored.reduce((sum, session) => sum + session.result!.of, 0);
}

export function weakestSubskill(skill: GrowthSkill, sessions: readonly PracticeSession[]): { subskillId: string; rate: number } | null {
  let weakest: { subskillId: string; rate: number } | null = null;
  for (const subskill of skill.subskills) {
    const rate = subskillSuccessRate(skill.id, subskill.id, sessions);
    if (rate !== null && (!weakest || rate < weakest.rate)) weakest = { subskillId: subskill.id, rate };
  }
  return weakest;
}

/** Chart coordinates share the metric's real timeline and keep its own unit. */
export function measurementChart(skill: Skill, measurements: readonly SkillMeasurement[]) {
  const startAt = localMidnight(skill.start.date) ?? skill.createdAt;
  const series = [{ at: startAt, value: skill.start.value }, ...measurementsFor(skill, measurements).filter(item => item.at >= startAt)];
  const values = series.map(item => item.value);
  const min = Math.min(...values);
  const span = Math.max(...values) - min || Math.max(Math.abs(min) * .1, 1);
  const endAt = Math.max(series.at(-1)!.at, startAt + DAY);
  const points = series.map(item => ({ ...item, x: 36 + (item.at - startAt) / (endAt - startAt) * 1128,
    y: 228 - (item.value - min) / span * 158 }));
  const line = points.map((point, index) => (index ? 'L' : 'M') + point.x.toFixed(1) + ' ' + point.y.toFixed(1)).join(' ');
  const last = points.at(-1)!;
  return { points, line, area: line + ' L' + last.x.toFixed(1) + ' 270 L36 270 Z',
    delta: currentValue(skill, measurements) - skill.start.value };
}

export function reviewTrendCounts(skills: readonly Skill[], rows: readonly SkillWeekReview[]) {
  let improved = 0;
  let unchanged = 0;
  let declined = 0;
  for (const row of rows) {
    const skill = skills.find(item => item.id === row.skillId);
    if (!skill) continue;
    const directed = row.delta * (skill.metric.direction === 'down' ? -1 : 1);
    if (directed > 0) improved++; else if (directed < 0) declined++; else unchanged++;
  }
  return { improved, unchanged, declined };
}

export function stretchShare(sessions: readonly PracticeSession[]): number {
  const observed = sessions.filter(session => live(session) && ['easy', 'edge', 'hard'].includes(session.difficulty ?? ''));
  return observed.length ? observed.filter(session => session.difficulty === 'edge').length / observed.length : 0;
}

/** The weekly weekday is fixed; minutes describes the measurement's duration. */
export function nextMeasurementDate(skill: GrowthSkill, measurements: readonly SkillMeasurement[], now: number): string | null {
  if (!isConfiguredSkill(skill) || !skill.measure || !live(skill) || skill.archivedAt !== undefined || !Number.isFinite(now)
    || !Number.isInteger(skill.measure.weekday) || skill.measure.weekday < 0 || skill.measure.weekday > 6) return null;
  const start = localMidnight(skill.start.date);
  const today = localMidnight(now);
  if (start === null || today === null) return null;
  const date = new Date(Math.max(today, start));
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + (skill.measure.weekday - date.getDay() + 7) % 7);
  const latest = measurementsFor(skill, measurements, now).at(-1);
  if (latest && localTaskDate(latest.at) >= localTaskDate(date.getTime())) date.setDate(date.getDate() + 7);
  return localTaskDate(date.getTime());
}

export function weekReview(
  skills: readonly GrowthSkill[], measurements: readonly SkillMeasurement[], sessions: readonly PracticeSession[],
  tasks: readonly PSTask[], weekStart: GrowthDate,
): { skills: SkillWeekReview[]; completedTasks: PSTask[] } {
  const start = localMidnight(weekStart);
  if (start === null) return { skills: [], completedTasks: [] };
  const endDate = new Date(start);
  endDate.setDate(endDate.getDate() + 7);
  const end = endDate.getTime();
  const inWeek = (at: number) => Number.isFinite(at) && at >= start && at < end;
  const reviews = skills.filter(skill => live(skill) && isConfiguredSkill(skill) && (localMidnight(skill.start.date) ?? Infinity) < end)
    .map(skill => {
      const configured = skill as Skill;
      const observed = measurementsFor(skill, measurements, end - 1);
      const before = observed.filter(value => value.at < start).at(-1);
      const latest = observed.at(-1);
      const from = before?.value ?? configured.start.value;
      const to = latest?.value ?? from;
      const lesson = sessions.filter(session => live(session) && session.skillId === skill.id && inWeek(session.at) && session.lesson?.trim())
        .slice().sort((a, b) => b.at - a.at || b.id.localeCompare(a.id))[0]?.lesson?.trim();
      const note = observed.filter(value => inWeek(value.at) && value.note?.trim()).at(-1)?.note?.trim();
      const why = lesson || note;
      return { skillId: skill.id, delta: to - from, from, to, status: skillStatus(skill, observed, end - 1), ...(why ? { why } : {}) };
    });
  const completed = new Map<string, PSTask>();
  for (const task of tasks) {
    const archived = task as PSTask & { deletionReason?: string };
    if (task.scheduledPending || archived.deletionReason === 'accidental' || (archived.deletionReason === 'cancelled' && !task.done)) continue;
    if ((task.done && task.completedAt !== undefined && inWeek(task.completedAt))
      || task.activityTrail?.some(event => event.kind === 'completed' && inWeek(event.at))) completed.set(task.id, task);
  }
  return { skills: reviews, completedTasks: Array.from(completed.values()) };
}

/** Stable IDs and source IDs make repeat migration and cross-device retries harmless. */
export function migrateStrategyGoals(goals: readonly StrategyGoal[], existingSkills: readonly GrowthSkill[] = [], createdAt = 0): SkillDraft[] {
  const migrated = new Set(existingSkills.flatMap(skill => skill.sourceGoalId ? [skill.sourceGoalId] : []));
  const existingIds = new Set(existingSkills.map(skill => skill.id));
  const drafts: SkillDraft[] = [];
  for (const goal of goals) {
    const id = 'strategy-goal:' + encodeURIComponent(goal.id);
    if (!goal.id || migrated.has(goal.id) || existingIds.has(id)) continue;
    migrated.add(goal.id);
    drafts.push({ id, title: goal.title, sourceGoalId: goal.id, needsSetup: true, subskills: [], createdAt });
  }
  return drafts;
}

/** Signed change and direction-aware comparison in the skill's own metric. */
export function metricChange(skill: Skill, from: number, to: number): { delta: number; percent: number; comparison: 'better' | 'same' | 'worse' } {
  const delta = to - from;
  const directed = delta * (skill.metric.direction === 'down' ? -1 : 1);
  return { delta, percent: from === 0 ? (to === 0 ? 0 : 100) : delta / Math.abs(from) * 100,
    comparison: directed > 0 ? 'better' : directed < 0 ? 'worse' : 'same' };
}

export function practiceResultPreview(skill: Skill, measurements: readonly SkillMeasurement[], done: number, of: number) {
  const isPercent = skill.metric.unit.trim().includes('%');
  const value = isPercent ? (of > 0 ? done / of * 100 : 0) : done;
  const current = currentValue(skill, measurements);
  return { isPercent, value, current, ...metricChange(skill, current, value) };
}

export function daysUntilMeasurement(date: string, now: number): number {
  const target = calendarDay(date);
  const today = calendarDay(now);
  return target === null || today === null ? 0 : Math.max(0, Math.round((target - today) / DAY));
}
