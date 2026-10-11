import type { PSTask, TaskTab } from '../types';

export const SYSTEM_VIEW_IDS = ['ALL', 'DASHBOARD', 'STRATEGY', 'NOTES', 'HISTORY'] as const;
export function isSystemView(id: string): boolean {
  return (SYSTEM_VIEW_IDS as readonly string[]).includes(id);
}

/** Stable migration of category IDs that collide with navigation, preserving their tasks. */
export function migrateSystemCategories<T extends { tabs: TaskTab[]; tasks: PSTask[]; deletedTasks?: PSTask[] }>(workspace: T): T {
  const remap = new Map<string, string>();
  const taken = new Set(workspace.tabs.map(tab => tab.id));
  for (const tab of workspace.tabs) {
    if (!isSystemView(tab.id) || remap.has(tab.id)) continue;
    const base = `category-${tab.id.toLowerCase()}`;
    let id = base;
    for (let suffix = 2; taken.has(id); suffix++) id = `${base}-${suffix}`;
    remap.set(tab.id, id);
    taken.add(id);
  }
  if (!remap.size) return workspace;
  const tasks = <U extends PSTask>(items: U[]) => items.map(task => remap.has(task.phase) ? { ...task, phase: remap.get(task.phase)! } : task);
  return { ...workspace, tabs: workspace.tabs.map(tab => remap.has(tab.id) ? { ...tab, id: remap.get(tab.id)! } : tab),
    tasks: tasks(workspace.tasks), ...(workspace.deletedTasks ? { deletedTasks: tasks(workspace.deletedTasks) } : {}) };
}
