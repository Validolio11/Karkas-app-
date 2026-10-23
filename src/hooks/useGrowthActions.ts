import { useEffect, useRef, useState } from 'react';
import type { GrowthSkill, SkillMeasurement, PracticeSession } from '../types';
import type { WorkspaceState } from '../utils/syncState';
import { currentValue, goalVersionOf, isConfiguredSkill, isGoalReached } from '../utils/growth';
import { canonical } from '../utils/canonical';
import { isTaskDate, localTaskDate } from '../utils/taskDates';
import { canUndoGrowthJournal, type GrowthUndoChange, type GrowthUndoJournal, type GrowthUndoTarget } from '../utils/growthUndo';
export type { GrowthUndoTarget } from '../utils/growthUndo';

export type PracticeResultInput = Omit<PracticeSession, 'at' | 'deletedAt' | 'measurementId'> & { at?: number };
export type PracticeResultExpected = { session: PracticeSession | null; measurement: SkillMeasurement | null };
const collections = ['skills', 'measurements', 'practiceSessions'] as const;
type Entity = GrowthSkill | SkillMeasurement | PracticeSession;
const stamp = (before?: { updatedAt?: number; deletedAt?: number }) => Math.max(Date.now(), (before?.updatedAt ?? 0) + 1, (before?.deletedAt ?? 0) + 1);

function withAchievements(workspace: WorkspaceState): WorkspaceState {
  return { ...workspace, skills: workspace.skills?.map(skill => {
    if (!isConfiguredSkill(skill) || skill.deletedAt !== undefined || skill.archivedAt !== undefined) return skill;
    const observations = (workspace.measurements ?? []).filter(value => value.skillId === skill.id && value.deletedAt === undefined && value.at >= new Date(skill.start.date + 'T00:00:00').getTime());
    const reached = observations.length > 0 && isGoalReached(skill, currentValue(skill, observations));
    if (reached && !['achieved', 'maintaining', 'completed'].includes(skill.goalState ?? 'active')) return { ...skill, goalVersion: goalVersionOf(skill), goalState: 'achieved' as const, goalReachedAt: Date.now(), updatedAt: stamp(skill) };
    if (!reached && skill.goalState === 'achieved') return { ...skill, goalState: 'active' as const, goalReachedAt: undefined, updatedAt: stamp(skill) };
    return skill;
  }) };
}

/** Per-entity compare-and-swap undo never overwrites a later edit from another screen or device. */
export function useGrowthActions(getWorkspace: () => WorkspaceState, commitWorkspace: (workspace: WorkspaceState) => boolean, canWrite: () => boolean, scopeKey = '') {
  const undo = useRef<GrowthUndoJournal | null>(null);
  const currentScope = useRef(scopeKey); currentScope.current = scopeKey;
  const [undoNotice, setUndoNotice] = useState<{ expiresAt: number; records: GrowthUndoTarget[] } | null>(null);
  useEffect(() => { if (undo.current?.scopeKey !== scopeKey) { undo.current = null; setUndoNotice(null); } }, [scopeKey]);
  useEffect(() => { if (!undoNotice) return; const timer = window.setTimeout(() => setUndoNotice(null), Math.max(0, undoNotice.expiresAt - Date.now())); return () => window.clearTimeout(timer); }, [undoNotice]);
  const activeSkill = (workspace: WorkspaceState, id: string) => workspace.skills?.find(skill => skill.id === id && skill.archivedAt === undefined && skill.deletedAt === undefined);
  const transactGrowth = (change: (workspace: WorkspaceState) => WorkspaceState | null, remember = true): boolean => {
    if (currentScope.current !== scopeKey || !canWrite()) return false;
    const before = getWorkspace(), changed = change(before);
    if (!changed) return false;
    const next = withAchievements(changed);
    if (canonical(before) === canonical(next)) return true;
    try {
      if (!commitWorkspace(next)) return false;
      const changes: GrowthUndoChange[] = [];
      for (const collection of collections) {
        const old = new Map<string, Entity>((before[collection] ?? []).map(value => [value.id, value] as const));
        const after = new Map<string, Entity>((next[collection] ?? []).map(value => [value.id, value] as const));
        for (const id of new Set([...old.keys(), ...after.keys()])) if (canonical(old.get(id)) !== canonical(after.get(id))) changes.push({ collection, id, before: structuredClone(old.get(id) ?? null), after: structuredClone(after.get(id) ?? null) });
      }
      if (remember && changes.length) { const expiresAt = Date.now() + 8000; undo.current = { expiresAt, changes, scopeKey }; setUndoNotice({ expiresAt, records: changes.map(({ collection, id }) => ({ collection, id })) }); }
      else if (!remember && undo.current) for (const change of changes) {
        const prior = undo.current.changes.find(value => value.collection === change.collection && value.id === change.id);
        if (prior && canonical(prior.after) === canonical(change.before)) prior.after = change.after;
      }
      return true;
    } catch { return false; }
  };
  const lifecycle = (collection: typeof collections[number], id: string, action: 'archive' | 'delete' | 'restore') => transactGrowth(workspace => {
    const record = (workspace[collection] ?? []).find(value => value.id === id);
    if (!record) return null;
    const now = stamp(record);
    const patch = action === 'restore' ? { deletedAt: undefined, archivedAt: undefined, updatedAt: now } : action === 'archive' ? { archivedAt: now, updatedAt: now } : { deletedAt: now, updatedAt: now };
    let next = { ...workspace, [collection]: (workspace[collection] ?? []).map(value => value.id === id ? { ...value, ...patch } : value) } as WorkspaceState;
    if (collection === 'practiceSessions' && 'measurementId' in record && record.measurementId) next = { ...next, measurements: next.measurements?.map(value => value.id === record.measurementId && (action === 'delete' || action === 'restore' && value.deletedAt === record.deletedAt) ? { ...value, deletedAt: action === 'delete' ? now : undefined, updatedAt: now } : value) };
    if (collection === 'measurements' && action === 'restore' && 'sessionId' in record && record.sessionId && record.deletedAt !== undefined) next = { ...next, practiceSessions: next.practiceSessions?.map(value => value.id === record.sessionId && value.deletedAt === record.deletedAt ? { ...value, deletedAt: undefined, updatedAt: now } : value) };
    return next;
  });
  const savePracticeResult = (input: PracticeResultInput, measurement?: Pick<SkillMeasurement, 'value' | 'note'>, expected?: PracticeResultExpected): string | null => {
    const id = input.id;
    return transactGrowth(workspace => {
      const skill = activeSkill(workspace, input.skillId);
      if (!skill || input.subskillId && !skill.subskills.some(value => value.id === input.subskillId) || input.difficulty !== undefined && !['easy', 'edge', 'hard'].includes(input.difficulty)) return null;
      if (input.result && (!Number.isInteger(input.result.done) || !Number.isInteger(input.result.of) || input.result.of <= 0 || input.result.done < 0 || input.result.done > input.result.of)) return null;
      if (input.durationSeconds !== undefined && (!Number.isFinite(input.durationSeconds) || input.durationSeconds < 0)) return null;
      if (measurement && (!isConfiguredSkill(skill) || !Number.isFinite(measurement.value) || skill.metric.unit.trim() === '%' && (measurement.value < 0 || measurement.value > 100))) return null;
      const previous = workspace.practiceSessions?.find(value => value.id === id) ?? null;
      const linked = previous?.measurementId ? workspace.measurements?.find(value => value.id === previous.measurementId) ?? null : null;
      if (expected && (canonical(previous) !== canonical(expected.session) || canonical(linked?.deletedAt === undefined ? linked : null) !== canonical(expected.measurement))) return null;
      if (previous?.deletedAt !== undefined && !expected || previous && previous.skillId !== input.skillId) return null;
      if (input.taskId && ![...workspace.tasks, ...workspace.deletedTasks].some(value => value.id === input.taskId && value.skillId === input.skillId)) return null;
      const at = input.at ?? previous?.at ?? Date.now();
      if (!Number.isFinite(at) || at < 0 || at > Date.now() + 60000) return null;
      const measurementId = previous?.measurementId ?? (measurement ? `measurement-${id}` : undefined);
      const session: PracticeSession = { ...input, id, at, updatedAt: stamp(previous ?? undefined), measurementId };
      const nextMeasurement: SkillMeasurement | undefined = measurement && measurementId ? { ...measurement, id: measurementId, skillId: input.skillId, sessionId: id, at, updatedAt: stamp(linked ?? undefined) } : undefined;
      return { ...workspace, practiceSessions: [...(workspace.practiceSessions ?? []).filter(value => value.id !== id), session],
        measurements: [...(workspace.measurements ?? []).filter(value => value.id !== measurementId), ...(nextMeasurement ? [nextMeasurement] : linked ? [{ ...linked, deletedAt: stamp(linked), updatedAt: stamp(linked) }] : [])] };
    }) ? id : null;
  };
  const canUndoChange = (target?: GrowthUndoTarget): boolean => {
    return currentScope.current === scopeKey && canUndoGrowthJournal(undo.current, scopeKey, getWorkspace(), Date.now(), target);
  };
  return { transactGrowth, savePracticeResult, scopeKey, undoNotice: undo.current?.scopeKey === scopeKey ? undoNotice : null,
    canUndoChange,
    readMeasurement: (id: string) => getWorkspace().measurements?.find(value => value.id === id),
    readPracticeResult: (id: string): PracticeResultExpected => { const workspace = getWorkspace(), session = workspace.practiceSessions?.find(value => value.id === id) ?? null; return { session, measurement: session?.measurementId ? workspace.measurements?.find(value => value.id === session.measurementId && value.deletedAt === undefined) ?? null : null }; },
    saveMeasurement: (input: SkillMeasurement, expected: SkillMeasurement) => transactGrowth(workspace => {
      const before = workspace.measurements?.find(value => value.id === input.id), skill = activeSkill(workspace, input.skillId);
      if (!before || canonical(before) !== canonical(expected) || !skill || !isConfiguredSkill(skill) || !Number.isFinite(input.value) || skill.metric.unit.trim() === '%' && (input.value < 0 || input.value > 100) || !Number.isFinite(input.at) || input.at < 0 || input.at > Date.now() + 60000) return null;
      return { ...workspace, measurements: workspace.measurements!.map(value => value.id === input.id ? { ...input, updatedAt: stamp(before) } : value) };
    }),
    dismissUndo: () => { undo.current = null; setUndoNotice(null); },
    undoLastChange: (target?: GrowthUndoTarget) => {
      const journal = undo.current;
      if (!journal || !canUndoChange(target) || !canWrite()) return false;
      const workspace = getWorkspace();
      if (journal.changes.some(change => canonical((workspace[change.collection] ?? []).find(value => value.id === change.id) ?? null) !== canonical(change.after))) return false;
      const next = { ...workspace };
      for (const collection of collections) {
        const changes = journal.changes.filter(change => change.collection === collection), values = [...(workspace[collection] ?? [])] as Entity[];
        for (const change of changes) {
          const now = stamp(change.after ?? undefined), restored = change.before ? { ...structuredClone(change.before), updatedAt: now } : change.after ? { ...change.after, deletedAt: now, updatedAt: now } : null;
          const index = values.findIndex(value => value.id === change.id);
          if (restored) { if (index >= 0) values[index] = restored; else values.push(restored); }
        }
        Object.assign(next, { [collection]: values });
      }
      try { if (!commitWorkspace(next)) return false; undo.current = null; setUndoNotice(null); return true; } catch { return false; }
    },
    createPracticeSkill: (input: { title: string; subskills?: GrowthSkill['subskills'] }) => { const id = `skill-${crypto.randomUUID()}`; return input.title.trim() && transactGrowth(workspace => ({ ...workspace, skills: [...(workspace.skills ?? []), { id, title: input.title.trim(), subskills: input.subskills ?? [], needsSetup: true, createdAt: Date.now() }] })) ? id : null; },
    archiveSkill: (id: string) => lifecycle('skills', id, 'archive'), deleteSkill: (id: string) => lifecycle('skills', id, 'delete'), restoreSkill: (id: string) => lifecycle('skills', id, 'restore'),
    deleteMeasurement: (id: string) => lifecycle('measurements', id, 'delete'), restoreMeasurement: (id: string) => lifecycle('measurements', id, 'restore'),
    deletePracticeSession: (id: string) => lifecycle('practiceSessions', id, 'delete'), restorePracticeSession: (id: string) => lifecycle('practiceSessions', id, 'restore'),
    acknowledgeGoal: (id: string, version: string) => transactGrowth(workspace => ({ ...workspace, skills: workspace.skills?.map(skill => skill.id === id && isConfiguredSkill(skill) && goalVersionOf(skill) === version ? { ...skill, goalAcknowledgedVersion: version, updatedAt: stamp(skill) } : skill) }), false),
    resolveGoal: (id: string, action: 'completed' | 'maintaining', version: string) => transactGrowth(workspace => {
      const skill = activeSkill(workspace, id); if (!skill || !isConfiguredSkill(skill) || goalVersionOf(skill) !== version || !isGoalReached(skill, currentValue(skill, workspace.measurements ?? []))) return null;
      const now = stamp(skill), history = skill.goalHistory ?? [], achievement = { version, value: currentValue(skill, workspace.measurements ?? []), reachedAt: skill.goalReachedAt ?? now, metricLabel: skill.metric.label, unit: skill.metric.unit, direction: skill.metric.direction };
      return { ...workspace, skills: workspace.skills!.map(value => value.id === id ? { ...value, goalState: action, goalAcknowledgedVersion: version, goalHistory: history.some(item => item.version === version) ? history : [...history, achievement], ...(action === 'completed' ? { completedAt: now, archivedAt: now } : {}), updatedAt: now } : value) };
    }),
    startNewGoal: (id: string, version: string, value: number, date?: string) => transactGrowth(workspace => {
      const skill = activeSkill(workspace, id); if (!skill || !isConfiguredSkill(skill) || goalVersionOf(skill) !== version || !isGoalReached(skill, currentValue(skill, workspace.measurements ?? [])) || !Number.isFinite(value) || date && (!isTaskDate(date) || date < localTaskDate())) return null;
      if (skill.metric.unit.trim() === '%' && (value < 0 || value > 100)) return null;
      const current = currentValue(skill, workspace.measurements ?? []);
      if (skill.metric.unit.trim() === '%' && (current < 0 || current > 100)) return null;
      if ((value - current) * (skill.metric.direction === 'down' ? -1 : 1) <= 0) return null;
      const achievement = { version, value: current, reachedAt: skill.goalReachedAt ?? Date.now(), metricLabel: skill.metric.label, unit: skill.metric.unit, direction: skill.metric.direction };
      const goalHistory = (skill.goalHistory ?? []).some(item => item.version === version) ? skill.goalHistory : [...(skill.goalHistory ?? []), achievement];
      return { ...workspace, skills: workspace.skills!.map(item => item.id === id ? { ...skill, start: { value: current, date: localTaskDate() }, goal: { value, ...(date ? { date } : {}) }, goalVersion: crypto.randomUUID(), goalState: 'active', goalReachedAt: undefined, goalAcknowledgedVersion: undefined, goalHistory, updatedAt: stamp(skill) } : item) };
    }),
  };
}
