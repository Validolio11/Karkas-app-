import type { GrowthSkill, Skill, SkillDraft, SkillMeasurement, PracticeSession, StrategyGoal } from '../types';
import type { WorkspaceState } from '../utils/syncState';
import { migrateStrategyGoals } from '../utils/growth';
import { isTaskDate } from '../utils/taskDates';

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
  return !!metric && !!start && !!goal && !!measure && typeof metric.label === 'string' && !!metric.label.trim()
    && typeof metric.unit === 'string' && ['up', 'down'].includes(metric.direction)
    && Number.isFinite(start.value) && Number.isFinite(goal.value)
    && isTaskDate(start.date) && isTaskDate(goal.date) && goal.date >= start.date
    && (goal.value - start.value) * (metric.direction === 'down' ? -1 : 1) >= 0
    && Number.isInteger(measure.weekday) && measure.weekday >= 0 && measure.weekday <= 6
    && Number.isFinite(measure.minutes) && measure.minutes > 0;
}

/** Actions share the task workspace commit, account guards and durable sync queue. */
export function useGrowth(
  state: GrowthState,
  getWorkspace: () => WorkspaceState,
  commitWorkspace: (workspace: WorkspaceState) => boolean,
  canWrite: () => boolean,
) {
  const activeSkill = (workspace: WorkspaceState, id: string) =>
    workspace.skills?.find(skill => skill.id === id && skill.archivedAt === undefined && skill.deletedAt === undefined);
  const configuredSkill = (workspace: WorkspaceState, id: string): Skill | undefined => {
    const skill = activeSkill(workspace, id);
    return skill && !skill.needsSetup && skill.metric && skill.start && skill.goal && skill.measure ? skill as Skill : undefined;
  };
  const commit = (change: (workspace: WorkspaceState) => WorkspaceState | null): boolean => {
    if (!canWrite()) return false;
    const next = change(getWorkspace());
    return next !== null && commitWorkspace(next);
  };
  return {
    ...state,
    sessions: state.practiceSessions,
    createSkill: (input: SkillInput): string | null => {
      const id = `skill-${crypto.randomUUID()}`;
      if (!input.title.trim() || !validSetup(input)) return null;
      const value: Skill = { ...input, title: input.title.trim(), needsSetup: false, id, createdAt: Date.now() };
      return commit(workspace => ({ ...workspace, skills: [...(workspace.skills ?? []), value] })) ? id : null;
    },
    updateSkill: (id: string, updates: Partial<Omit<Skill, 'id' | 'createdAt' | 'deletedAt' | 'sourceGoalId'>>) =>
      commit(workspace => {
        const before = activeSkill(workspace, id);
        if (!before || updates.title !== undefined && !updates.title.trim()) return null;
        const value = { ...before, ...updates, id, createdAt: before.createdAt, updatedAt: Date.now() } as GrowthSkill;
        if (updates.title !== undefined) value.title = updates.title.trim();
        const hasSetup = value.metric || value.start || value.goal || value.measure;
        if (hasSetup && !validSetup(value) || !hasSetup && value.needsSetup !== true) return null;
        if (hasSetup && before.needsSetup && updates.needsSetup !== true) value.needsSetup = false;
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
        if (!configuredSkill(workspace, input.skillId)) return null;
        if (input.sessionId && !workspace.practiceSessions?.some(session => session.id === input.sessionId && session.skillId === input.skillId && session.deletedAt === undefined && !session.measurementId)) return null;
        const value: SkillMeasurement = { ...input, id, at: input.at ?? Date.now() };
        return { ...workspace, measurements: [...(workspace.measurements ?? []), value],
          ...(input.sessionId ? { practiceSessions: workspace.practiceSessions!.map(session => session.id === input.sessionId ? { ...session, measurementId: id } : session) } : {}) };
      }) ? id : null;
    },
    addPracticeSession: (input: SessionInput, measurement?: SessionMeasurement): string | null => {
      const id = `practice-${crypto.randomUUID()}`;
      return commit(workspace => {
        const skill = configuredSkill(workspace, input.skillId);
        if (!skill || input.subskillId && !skill.subskills.some(subskill => subskill.id === input.subskillId)) return null;
        if (input.taskId) {
          const task = [...workspace.tasks, ...workspace.deletedTasks].find(task => task.id === input.taskId);
          if (!task || task.skillId !== input.skillId || input.subskillId && task.subskillId !== input.subskillId) return null;
        }
        const at = input.at ?? Date.now();
        const measurementId = measurement ? `measurement-${crypto.randomUUID()}` : undefined;
        const session: PracticeSession = { ...input, id, at, ...(measurementId ? { measurementId } : {}) };
        return { ...workspace, practiceSessions: [...(workspace.practiceSessions ?? []), session],
          ...(measurement && measurementId ? { measurements: [...(workspace.measurements ?? []),
            { ...measurement, id: measurementId, skillId: input.skillId, sessionId: id, at }] } : {}) };
      }) ? id : null;
    },
    linkTaskToSkill: (taskId: string, skillId?: string, subskillId?: string) => commit(workspace => {
      const task = workspace.tasks.find(task => task.id === taskId);
      if (!task || !skillId && subskillId) return null;
      if (skillId) {
        const skill = configuredSkill(workspace, skillId);
        if (!skill || subskillId && !skill.subskills.some(subskill => subskill.id === subskillId)) return null;
      }
      return { ...workspace, tasks: workspace.tasks.map(task => task.id === taskId
        ? { ...task, skillId, subskillId, updatedAt: Date.now() } : task) };
    }),
    migrateGoals: (goals: StrategyGoal[]) => commit(workspace => {
      const drafts: SkillDraft[] = migrateStrategyGoals(goals, workspace.skills ?? [], Date.now());
      return drafts.length ? { ...workspace, skills: [...(workspace.skills ?? []), ...drafts] } : null;
    }),
  };
}
