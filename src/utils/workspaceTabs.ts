import type { PersonalStrategyProfile, TaskTab } from '../types';
import type { WorkspaceState } from './syncState';

/** One remapping for live work, historical work and the agreed goal scope. */
export function remapWorkspaceTabs(workspace: WorkspaceState, profile: PersonalStrategyProfile, tabs: TaskTab[], moveTo: Record<string, string> = {}) {
  if (!tabs.length || new Set(tabs.map(tab => tab.id)).size !== tabs.length) return null;
  const valid = new Set(tabs.map(tab => tab.id));
  const fallback = tabs[0].id;
  const phase = (id: string) => valid.has(id) ? id : valid.has(moveTo[id]) ? moveTo[id] : fallback;
  return {
    workspace: { ...workspace, tabs,
      tasks: workspace.tasks.map(task => phase(task.phase) === task.phase ? task : { ...task, phase: phase(task.phase) }),
      deletedTasks: workspace.deletedTasks.map(task => phase(task.phase) === task.phase ? task : { ...task, phase: phase(task.phase) }),
    },
    profile: { ...profile, goals: profile.goals.map(goal => {
      const categoryIds = [...new Set(goal.categoryIds.map(phase))];
      return categoryIds.length === goal.categoryIds.length && categoryIds.every((id, index) => id === goal.categoryIds[index])
        ? goal : { ...goal, categoryIds };
    }) },
  };
}
