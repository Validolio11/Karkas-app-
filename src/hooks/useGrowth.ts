import type { GrowthSkill, Skill, SkillDraft, SkillMeasurement, PracticeSession, StrategyGoal } from '../types';
import type { WorkspaceState } from '../utils/syncState';
import { migrateStrategyGoals } from '../utils/growth';
import { isTaskDate } from '../utils/taskDates';
import { useGrowthActions } from './useGrowthActions';
import { canonical } from '../utils/canonical';

export type GrowthState = {
  skills: GrowthSkill[];
  measurements: SkillMeasurement[];
  practiceSessions: PracticeSession[];
};

export const growthStateFrom = (workspace: Partial<GrowthState>): GrowthState => ({
  skills: workspace.skills ?? [],
  measurements: workspace.measurements ?? [],
  practiceSessions: workspace.practiceSessions ?? [],
});

type SkillInput = Omit<Skill, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>;
type MeasurementInput = Omit<SkillMeasurement, 'id' | 'at' | 'deletedAt'> & { at?: number };
type SessionInput = Omit<PracticeSession, 'id' | 'at' | 'deletedAt' | 'measurementId'> & { at?: number };
type SessionMeasurement = Pick<SkillMeasurement, 'value' | 'note'>;

function validSetup(skill: Partial<Pick<Skill, 'metric' | 'start' | 'goal' | 'measure'>>): boolean {
  const { metric, start, goal, measure } = skill;
  return !!metric && !!start && !!goal && typeof metric.label === 'string' && !!metric.label.trim()
    && typeof metric.unit === 'string' && ['up', 'down'].includes(metric.direction)
    && Number.isFinite(start.value) && Number.isFinite(goal.value)
    && (metric.unit.trim() !== '%' || start.value >= 0 && start.value <= 100 && goal.value >= 0 && goal.value <= 100)
    && isTaskDate(start.date) && (!goal.date || isTaskDate(goal.date) && goal.date >= start.date)
    && (goal.value - start.value) * (metric.direction === 'down' ? -1 : 1) >= 0
    && (!measure || Number.isInteger(measure.weekday) && measure.weekday >= 0 && measure.weekday <= 6
    && Number.isFinite(measure.minutes) && measure.minutes > 0);
}

/** Actions share the task workspace commit, account guards and durable sync queue. */
export function useGrowth(
  state: GrowthState,
  getWorkspace: () => WorkspaceState,
  commitWorkspace: (workspace: WorkspaceState) => boolean,
  canWrite: () => boolean,
  scopeKey = '',
) {
  const actions = useGrowthActions(getWorkspace, commitWorkspace, canWrite, scopeKey);
  const activeSkill = (workspace: WorkspaceState, id: string) =>
    workspace.skills?.find(skill => skill.id === id && skill.archivedAt === undefined && skill.deletedAt === undefined);
  const configuredSkill = (workspace: WorkspaceState, id: string): Skill | undefined => {
    const skill = activeSkill(workspace, id);
    return skill && !skill.needsSetup && skill.metric && skill.start && skill.goal ? skill as Skill : undefined;
  };
  const commit = (change: (workspace: WorkspaceState) => WorkspaceState | null): boolean => {
    return actions.transactGrowth(change);
  };
  return {
    ...state,
    sessions: state.practiceSessions,
    createSkill: (input: SkillInput): string | null => {
      const id = `skill-${crypto.randomUUID()}`;
      if (!input.title.trim() || !validSetup(input) || input.goal.value === input.start.value) return null;
      const value: Skill = { ...input, title: input.title.trim(), needsSetup: false, id, createdAt: Date.now() };
      return commit(workspace => ({ ...workspace, skills: [...(workspace.skills ?? []), value] })) ? id : null;
    },
    readSkill: (id: string) => getWorkspace().skills?.find(skill => skill.id === id),
    updateSkill: (id: string, updates: Partial<Omit<Skill, 'id' | 'createdAt' | 'deletedAt' | 'sourceGoalId'>>, expected?: GrowthSkill) =>
      commit(workspace => {
        const before = activeSkill(workspace, id);
        if (!before || expected && canonical(before) !== canonical(expected) || updates.title !== undefined && !updates.title.trim()) return null;
        const value = { ...before, ...updates, id, createdAt: before.createdAt, updatedAt: Date.now() } as GrowthSkill;
        if (updates.title !== undefined) value.title = updates.title.trim();
        const hasSetup = value.metric || value.start || value.goal || value.measure;
        if (hasSetup && !validSetup(value) || !hasSetup && value.needsSetup !== true) return null;
        if (hasSetup && before.needsSetup && updates.needsSetup !== true) value.needsSetup = false;
        if (hasSetup && (canonical(before.metric) !== canonical(value.metric) || canonical(before.start) !== canonical(value.start) || canonical(before.goal) !== canonical(value.goal))) {
          value.goalVersion = crypto.randomUUID(); value.goalAcknowledgedVersion = undefined; value.goalReachedAt = undefined; value.goalState = 'active';
        }
        return { ...workspace, skills: workspace.skills!.map(skill => skill.id === id ? value : skill) };
      }),
    archiveSkill: (id: string) => commit(workspace => {
      if (!activeSkill(workspace, id)) return null;
      const now = Date.now();
      return { ...workspace, skills: workspace.skills!.map(skill => skill.id === id ? { ...skill, archivedAt: now, updatedAt: now } : skill) };
    }),
    addMeasurement: (input: MeasurementInput): string | null => {
      const id = `measurement-${crypto.randomUUID()}`;
      return commit(workspace => {
        const skill = configuredSkill(workspace, input.skillId), at = input.at ?? Date.now();
        if (!skill || !Number.isFinite(input.value) || !Number.isFinite(at) || at < 0 || at > Date.now() + 60000 || skill.metric.unit.trim() === '%' && (input.value < 0 || input.value > 100)) return null;
        if (input.sessionId && !workspace.practiceSessions?.some(session => session.id === input.sessionId && session.skillId === input.skillId && session.deletedAt === undefined && !session.measurementId)) return null;
        const value: SkillMeasurement = { ...input, id, at, updatedAt: Date.now() };
        return { ...workspace, measurements: [...(workspace.measurements ?? []), value],
          ...(input.sessionId ? { practiceSessions: workspace.practiceSessions!.map(session => session.id === input.sessionId ? { ...session, measurementId: id } : session) } : {}) };
      }) ? id : null;
    },
    linkTaskToSkill: (taskId: string, skillId?: string, subskillId?: string) => commit(workspace => {
      const task = workspace.tasks.find(task => task.id === taskId);
      if (!task || !skillId && subskillId) return null;
      if (skillId) {
        const skill = activeSkill(workspace, skillId);
        if (!skill || subskillId && !skill.subskills.some(subskill => subskill.id === subskillId)) return null;
      }
      return { ...workspace, tasks: workspace.tasks.map(task => task.id === taskId
        ? { ...task, skillId, subskillId, updatedAt: Date.now() } : task) };
    }),
    migrateGoals: (goals: StrategyGoal[]) => commit(workspace => {
      const drafts: SkillDraft[] = migrateStrategyGoals(goals, workspace.skills ?? [], Date.now());
      return drafts.length ? { ...workspace, skills: [...(workspace.skills ?? []), ...drafts] } : null;
    }),
    ...actions,
    addPracticeSession: (input: SessionInput, measurement?: SessionMeasurement) => actions.savePracticeResult({ ...input, id: `practice-${crypto.randomUUID()}` }, measurement),
  };
}
