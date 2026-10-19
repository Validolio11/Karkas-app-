import type { AITaskUpdate, DeletedTask, NotepadNote, PSTask, TaskStepItem, TaskTab } from '../types';
import { applyAITaskUpdate } from './aiTaskUpdates';
import { completeTask, createTask, materializeStepList, reopenTask, setTaskSteps, setTaskTimeSpent, startTaskWork } from './taskOperations';
import { clearTaskCountdown, configureTaskCountdown, extendTaskCountdown, getTaskRemainingSeconds, getTaskTimerMode, getTaskTotalSeconds, pauseTaskTimer } from './taskTimer';
import { finishLimitedStart, latestAttempt, startLimitedStart } from './limitedStart';
import { discardTaskStepAttribution } from './taskWorkTelemetry';
import { isTaskDate } from './taskDates';
import { annotateTaskChanges } from './taskActivity';
import { selectArchivedTasks } from './taskArchive';
import { remapTaskTabs } from './workspaceTabs';

export interface AgentWorkspace { tasks: PSTask[]; deletedTasks: DeletedTask[]; tabs: TaskTab[]; notes: NotepadNote[] }
type StepRef = number | string;
export type AgentAction =
  | { type: 'create_task'; title: string; phase?: string; priority?: 1 | 2 | 3; note?: string; plannedDate?: string; deadlineDate?: string; steps?: string[]; timerMinutes?: number }
  | { type: 'update_task'; taskId: string; title?: string; note?: string; priority?: 1 | 2 | 3; phase?: string; plannedDate?: string | null; deadlineDate?: string | null; pinned?: boolean }
  | { type: 'complete_task' | 'reopen_task'; taskId: string }
  | { type: 'add_steps'; taskId: string; titles: string[]; afterStepIndex?: number } // 0 prepends; otherwise after the 1-based row.
  | { type: 'rename_step'; taskId: string; step: StepRef; title: string }
  | { type: 'set_step_done'; taskId: string; step: StepRef; done: boolean }
  | { type: 'delete_step'; taskId: string; step: StepRef }
  | { type: 'start_timer' | 'pause_timer' | 'clear_countdown' | 'finish_limited_start' | 'reset_time'; taskId: string }
  | { type: 'set_countdown'; taskId: string; minutes: number; start?: boolean }
  | { type: 'extend_countdown' | 'limited_start' | 'set_recorded_time'; taskId: string; minutes: number }
  | { type: 'create_tab'; name: string; color?: string }
  | { type: 'rename_tab'; tabId: string; name: string }
  | { type: 'set_tab_color'; tabId: string; color: string }
  | { type: 'delete_tab'; tabId: string }
  | { type: 'delete_task'; taskId: string; reason?: 'accidental' | 'cancelled' }
  | { type: 'restore_task' | 'permanently_delete_task'; taskId: string }
  | { type: 'clear_completed' }
  | { type: 'create_note'; title: string; content: string }
  | { type: 'update_note'; noteId: string; title?: string; content?: string }
  | { type: 'open_view'; view: 'dashboard' | 'strategy' | 'notes' | 'history' | 'tasks' }
  | { type: 'reveal_task'; taskId: string };
export type AgentActionResult =
  | { ok: true; summary: { uk: string; en: string }; changedTaskIds: string[]; createdIds?: string[]; data?: unknown; error?: undefined; code?: undefined }
  | { ok: false; error: string; code: 'not_found' | 'invalid' | 'conflict' | 'needs_confirmation' };
export interface AgentContext { now: number; newId: () => string; timeZone?: string; confirmed?: boolean }
export const AGENT_DESTRUCTIVE_ACTIONS: ReadonlySet<AgentAction['type']> = new Set([
  'reset_time', 'delete_tab', 'delete_task', 'permanently_delete_task', 'clear_completed',
]);

type Check = (value: unknown) => boolean;
const text: Check = value => typeof value === 'string';
const nonempty: Check = value => typeof value === 'string' && !!value.trim();
const boolean: Check = value => typeof value === 'boolean';
const integer: Check = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const minutes: Check = value => typeof value === 'number' && value >= 1 && value <= 1440 && Number.isSafeInteger(value * 60);
const recorded: Check = value => typeof value === 'number' && value >= 0 && Number.isSafeInteger(value * 60);
const titles: Check = value => Array.isArray(value) && Array.from(value).every(nonempty);
const step: Check = value => nonempty(value) || typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
const date: Check = value => isTaskDate(value);
const nullableDate: Check = value => value === null || isTaskDate(value);
const priority: Check = value => value === 1 || value === 2 || value === 3;
const color: Check = nonempty;
type Schema = { required: Record<string, Check>; optional?: Record<string, Check> };
const taskOnly = { required: { taskId: nonempty } };
const schemas: Record<AgentAction['type'], Schema> = {
  create_task: { required: { title: nonempty }, optional: { phase: nonempty, priority, note: text, plannedDate: date, deadlineDate: date, steps: titles, timerMinutes: minutes } },
  update_task: { required: { taskId: nonempty }, optional: { title: nonempty, note: text, priority, phase: nonempty, plannedDate: nullableDate, deadlineDate: nullableDate, pinned: boolean } },
  complete_task: taskOnly, reopen_task: taskOnly,
  add_steps: { required: { taskId: nonempty, titles: value => titles(value) && (value as string[]).length > 0 }, optional: { afterStepIndex: integer } },
  rename_step: { required: { taskId: nonempty, step, title: nonempty } },
  set_step_done: { required: { taskId: nonempty, step, done: boolean } },
  delete_step: { required: { taskId: nonempty, step } },
  start_timer: taskOnly, pause_timer: taskOnly, clear_countdown: taskOnly, finish_limited_start: taskOnly, reset_time: taskOnly,
  set_countdown: { required: { taskId: nonempty, minutes }, optional: { start: boolean } },
  extend_countdown: { required: { taskId: nonempty, minutes } },
  limited_start: { required: { taskId: nonempty, minutes: value => minutes(value) && (value as number) >= 5 && (value as number) <= 60 } },
  set_recorded_time: { required: { taskId: nonempty, minutes: recorded } },
  create_tab: { required: { name: nonempty }, optional: { color } },
  rename_tab: { required: { tabId: nonempty, name: nonempty } },
  set_tab_color: { required: { tabId: nonempty, color } }, delete_tab: { required: { tabId: nonempty } },
  delete_task: { required: { taskId: nonempty }, optional: { reason: value => value === 'accidental' || value === 'cancelled' } },
  restore_task: taskOnly, permanently_delete_task: taskOnly, clear_completed: { required: {} },
  create_note: { required: { title: text, content: text } },
  update_note: { required: { noteId: nonempty }, optional: { title: text, content: text } },
  open_view: { required: { view: value => ['dashboard', 'strategy', 'notes', 'history', 'tasks'].includes(value as string) } },
  reveal_task: taskOnly,
};

/** Reject extra fields as well as malformed values; never silently discard model arguments. */
export function validateAgentAction(raw: unknown): AgentAction | { error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'Action must be an object.' };
  const args = raw as Record<string, unknown>;
  if (!Object.hasOwn(args, 'type') || typeof args.type !== 'string' || !Object.hasOwn(schemas, args.type)) return { error: 'Unknown action type: ' + String(args.type) };
  const schema = schemas[args.type as AgentAction['type']];
  const fields = { ...schema.required, ...schema.optional };
  for (const key of Object.keys(args)) {
    if (key !== 'type' && !Object.hasOwn(fields, key)) return { error: 'Unexpected argument: ' + key };
    if (key !== 'type' && !fields[key](args[key])) return { error: 'Invalid argument: ' + key };
  }
  for (const key of Object.keys(schema.required)) if (!Object.hasOwn(args, key)) return { error: 'Missing argument: ' + key };
  if ((args.type === 'update_task' || args.type === 'update_note') && !Object.keys(schema.optional!).some(key => Object.hasOwn(args, key))) return { error: 'Provide at least one field to update.' };
  if (typeof args.plannedDate === 'string' && typeof args.deadlineDate === 'string' && args.plannedDate > args.deadlineDate) return { error: 'plannedDate must not be after deadlineDate.' };
  return { ...args } as AgentAction;
}

const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/ё/g, 'е').replace(/[’‘ʼ'`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const words = (value: string) => normalize(value).split(' ').filter(Boolean);
// Conservative Ukrainian/Russian endings; keep at least four letters of a stem.
const stem = (value: string) => value.replace(/(?:ями|ами|ого|ому|ові|еві|ією|ией|иях|ах|ях|ою|ею|ой|ей|ію|ию|ів|ов|ам|ям|ом|ем|а|я|у|ю|і|и|ы|е|о)$/u, ending => value.length - ending.length >= 4 ? '' : ending);
function distance(a: string, b: string): number {
  const limit = a.length + b.length;
  const rows = Array.from({ length: a.length + 2 }, () => Array<number>(b.length + 2).fill(0));
  rows[0][0] = limit;
  for (let i = 0; i <= a.length; i++) { rows[i + 1][0] = limit; rows[i + 1][1] = i; }
  for (let j = 0; j <= b.length; j++) { rows[0][j + 1] = limit; rows[1][j + 1] = j; }
  const seen = new Map<string, number>();
  for (let i = 1; i <= a.length; i++) {
    let matched = 0;
    for (let j = 1; j <= b.length; j++) {
      const previous = seen.get(b[j - 1]) ?? 0, column = matched;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      if (!cost) matched = j;
      rows[i + 1][j + 1] = Math.min(rows[i][j] + cost, rows[i + 1][j] + 1, rows[i][j + 1] + 1,
        rows[previous][column] + (i - previous - 1) + 1 + (j - column - 1));
    }
    seen.set(a[i - 1], i);
  }
  return rows[a.length + 1][b.length + 1];
}
function wordScore(query: string, title: string): number {
  if (query === title) return 100;
  if (query.length < 4 || title.length < 4) return 0;
  if (stem(query) === stem(title)) return 90;
  if (title.startsWith(query)) return 80;
  const limit = Math.min(query.length, title.length) >= 7 ? 2 : 1;
  const delta = Math.min(distance(query, title), distance(stem(query), stem(title)));
  return delta <= limit ? 70 - delta * 10 : 0;
}
function matchScore(title: string, query: string): number {
  const wanted = words(query), available = words(title);
  if (!wanted.length) return 1;
  let score = 0;
  const used = new Set<number>();
  for (const word of wanted) {
    let best = 0, index = -1;
    available.forEach((candidate, i) => { const next = used.has(i) ? 0 : wordScore(word, candidate); if (next > best) { best = next; index = i; } });
    if (!best) return 0;
    used.add(index); score += best;
  }
  return score / wanted.length + (normalize(title) === normalize(query) ? 100 : 0);
}

export function describeTask(task: PSTask, now: number) {
  const remaining = getTaskRemainingSeconds(task, now);
  return {
    id: task.id, title: task.title, phase: task.phase, priority: task.priority, done: task.done,
    plannedDate: task.plannedDate ?? null, deadlineDate: task.deadlineDate ?? null,
    steps: materializeStepList(task).map((item, index) => ({ number: index + 1, id: item.id, title: item.title, done: item.done })),
    timer: { mode: getTaskTimerMode(task), countdownMinutes: task.countdownDurationSeconds === undefined ? null : task.countdownDurationSeconds / 60,
      remainingMinutes: remaining === undefined ? null : remaining / 60, running: !!task.timerRunning,
      recordedMinutes: getTaskTotalSeconds(task, now) / 60,
      limitedStart: task.limitedStart ? { minutes: task.limitedStart.capSeconds / 60, remainingMinutes: (remaining ?? 0) / 60 } : null },
  };
}

/** Stable ranking uses persisted fields only; live timer descriptions use describeTask with explicit now. */
export function findTasks(ws: AgentWorkspace, query: string, options: { includeDone?: boolean; includeDeleted?: boolean } = {}) {
  const candidates = [...ws.tasks.map(task => ({ task, deleted: false })),
    ...(options.includeDeleted ? selectArchivedTasks(ws.tasks, ws.deletedTasks).map(task => ({ task, deleted: true })) : [])];
  return candidates.filter(({ task }) => options.includeDone || !task.done).map(({ task, deleted }) => ({
    id: task.id, title: task.title, phase: task.phase, priority: task.priority, done: task.done, deleted,
    plannedDate: task.plannedDate ?? null, deadlineDate: task.deadlineDate ?? null, score: matchScore(task.title, query),
  })).filter(record => record.score > 0).sort((a, b) => b.score - a.score || Number(a.deleted) - Number(b.deleted) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

type ErrorCode = Extract<AgentActionResult, { ok: false }>['code'];
class ActionError extends Error {
  constructor(public code: ErrorCode, message: string) { super(message); }
}
const fail = (code: ErrorCode, message: string): never => { throw new ActionError(code, message); };
function resolveStep(list: TaskStepItem[], ref: StepRef): number {
  if (typeof ref === 'number') return ref <= list.length ? ref - 1 : fail('not_found', 'Step number out of range. Valid numbers: 1..' + list.length);
  const id = list.findIndex(item => item.id === ref);
  if (id >= 0) return id;
  let matches = list.map((item, index) => ({ item, index })).filter(({ item }) => normalize(item.title) === normalize(ref));
  if (!matches.length) matches = list.map((item, index) => ({ item, index })).filter(({ item }) => matchScore(item.title, ref) > 0);
  if (!matches.length) return fail('not_found', 'Step not found: ' + ref);
  if (matches.length > 1) return fail('conflict', 'Ambiguous step. Candidates: ' + matches.map(({ item, index }) => (index + 1) + ': ' + item.title + ' (' + item.id + ')').join(', '));
  return matches[0].index;
}
const duration = (minutes: number, lang: 'uk' | 'en') => minutes % 60 === 0 ? minutes / 60 + (lang === 'uk' ? ' год' : ' h') : minutes + (lang === 'uk' ? ' хв' : ' min');

/** The sole mutation entry point for both the server snapshot and live client state. */
export function applyAgentAction(ws: AgentWorkspace, input: AgentAction, ctx: AgentContext): { workspace: AgentWorkspace; result: AgentActionResult } {
  const checked = validateAgentAction(input);
  if ('error' in checked) return { workspace: ws, result: { ok: false, code: 'invalid', error: checked.error } };
  const action = checked;
  if (!Number.isFinite(ctx.now) || ctx.now < 0 || ctx.now > 8.64e15 || typeof ctx.newId !== 'function') return { workspace: ws, result: { ok: false, code: 'invalid', error: 'Context requires a valid now timestamp and newId function.' } };
  if (AGENT_DESTRUCTIVE_ACTIONS.has(action.type) && !ctx.confirmed) return { workspace: ws, result: { ok: false, code: 'needs_confirmation', error: 'User confirmation is required for ' + action.type + '.' } };
  try {
    const now = ctx.now;
    const usedIds = new Set([...ws.tabs.map(tab => tab.id), ...ws.notes.map(note => note.id),
      ...[...ws.tasks, ...ws.deletedTasks].flatMap(task => [task.id, ...materializeStepList(task).map(item => item.id),
        ...Object.keys(task.timeSessions ?? {}), ...(task.timerSessionId ? [task.timerSessionId] : []), ...(task.limitedStart ? [task.limitedStart.id] : [])])]);
    const newId = () => {
      const id = ctx.newId();
      if (typeof id !== 'string' || !id.trim() || id !== id.trim()) return fail('invalid', 'newId must return a nonempty trimmed string.');
      if (usedIds.has(id)) return fail('conflict', 'Generated ID already exists: ' + id);
      usedIds.add(id); return id;
    };
    const stamp = <T extends { updatedAt?: number }>(value: T): T => ({ ...value, updatedAt: Math.max(value.updatedAt ?? 0, now) });
    const success = (workspace: AgentWorkspace, uk: string, en: string, changedTaskIds: string[] = [], createdIds?: string[], data?: unknown): { workspace: AgentWorkspace; result: AgentActionResult } => {
      const tasks = workspace.tasks === ws.tasks ? ws.tasks : annotateTaskChanges(ws.tasks, workspace.tasks, now);
      return { workspace: tasks === workspace.tasks ? workspace : { ...workspace, tasks }, result: {
        ok: true, summary: { uk, en }, changedTaskIds, ...(createdIds?.length ? { createdIds } : {}), ...(data === undefined ? {} : { data }),
      } };
    };
    // Same default as the add form: the first tab, or the built-in focus category without custom tabs.
    const defaultPhase = ws.tabs[0]?.id ?? 'focus';
    const phaseCheck = (phase: string | undefined): string => {
      const value = phase ?? defaultPhase;
      if (!ws.tabs.some(tab => tab.id === value) && !(ws.tabs.length === 0 && value === 'focus')) {
        return fail('invalid', 'Unknown phase: ' + String(phase) + '. Valid tab IDs: ' + (ws.tabs.map(tab => tab.id).join(', ') || 'none (omit phase)'));
      }
      return value;
    };
    const archive = (task: PSTask, reason?: DeletedTask['deletionReason']): DeletedTask => {
      const paused = stamp(pauseTaskTimer(finishLimitedStart(task, now), now));
      const annotated = annotateTaskChanges([task], [paused], now)[0];
      return { ...annotated, deletedAt: now, ...(reason ? { deletionReason: reason } : {}) };
    };
    if (action.type === 'open_view') {
      const names = { dashboard: 'Дашборд', strategy: 'Стратегія', notes: 'Нотатки', history: 'Історія', tasks: 'Завдання' };
      return success(ws, 'Відкрито розділ «' + names[action.view] + '»', 'Opened view: ' + action.view, [], undefined, action);
    }
    if (action.type === 'create_task') {
      const phase = phaseCheck(action.phase);
      const id = newId(), stepIds: string[] = [];
      const stepList = action.steps?.map(title => { const id = newId(); stepIds.push(id); return { id, title, done: false }; });
      const task = createTask({ title: action.title, phase, priority: action.priority ?? 2, steps: stepList?.length ?? 0,
        ...(stepList ? { stepList } : {}), ...(action.note === undefined ? {} : { note: action.note }),
        ...(action.plannedDate === undefined ? {} : { plannedDate: action.plannedDate }),
        ...(action.deadlineDate === undefined ? {} : { deadlineDate: action.deadlineDate }),
        ...(action.timerMinutes === undefined ? {} : { timerMode: 'countdown', countdownDurationSeconds: action.timerMinutes * 60 }),
      }, id, now);
      if (!task) return fail('invalid', 'Task fields are invalid.');
      const created = stamp(task);
      return success({ ...ws, tasks: [created, ...ws.tasks] }, 'Створено завдання «' + created.title + '»', 'Created task “' + created.title + '”', [id], [id, ...stepIds], describeTask(created, now));
    }
    if (action.type === 'create_tab') {
      const tab: TaskTab = { id: newId(), name: action.name.trim(), ...(action.color ? { color: action.color } : {}) };
      return success({ ...ws, tabs: [...ws.tabs, tab] }, 'Створено вкладку «' + tab.name + '»', 'Created tab “' + tab.name + '”', [], [tab.id], tab);
    }
    if (action.type === 'rename_tab' || action.type === 'set_tab_color' || action.type === 'delete_tab') {
      const tab = ws.tabs.find(item => item.id === action.tabId);
      if (!tab) return fail('not_found', 'Tab not found: ' + action.tabId);
      if (action.type === 'delete_tab') {
        if (ws.tabs.length <= 1) return fail('conflict', 'Cannot delete the last tab. Create another tab first.');
        const remapped = remapTaskTabs(ws, ws.tabs.filter(item => item.id !== tab.id))!;
        const changed = [...remapped.tasks.filter((task, i) => task !== ws.tasks[i]), ...remapped.deletedTasks.filter((task, i) => task !== ws.deletedTasks[i])];
        return success({ ...remapped, tasks: remapped.tasks.map((task, i) => task === ws.tasks[i] ? task : stamp(task)),
          deletedTasks: remapped.deletedTasks.map((task, i) => task === ws.deletedTasks[i] ? task : stamp(task)) },
        'Видалено вкладку «' + tab.name + '»', 'Deleted tab “' + tab.name + '”', [...new Set(changed.map(task => task.id))]);
      }
      const next = action.type === 'rename_tab' ? { ...tab, name: action.name.trim() } : { ...tab, color: action.color };
      return success({ ...ws, tabs: ws.tabs.map(item => item.id === tab.id ? next : item) },
        action.type === 'rename_tab' ? 'Вкладку перейменовано на «' + next.name + '»' : 'Змінено колір вкладки «' + tab.name + '»',
        action.type === 'rename_tab' ? 'Renamed tab to “' + next.name + '”' : 'Changed color of tab “' + tab.name + '”');
    }
    if (action.type === 'create_note') {
      const note: NotepadNote = { id: newId(), title: action.title, content: action.content, createdAt: now, updatedAt: now };
      return success({ ...ws, notes: [note, ...ws.notes] }, 'Створено нотатку «' + note.title + '»', 'Created note “' + note.title + '”', [], [note.id], note);
    }
    if (action.type === 'update_note') {
      const note = ws.notes.find(item => item.id === action.noteId);
      if (!note) return fail('not_found', 'Note not found: ' + action.noteId);
      const next = stamp({ ...note, ...(action.title === undefined ? {} : { title: action.title }), ...(action.content === undefined ? {} : { content: action.content }) });
      return success({ ...ws, notes: ws.notes.map(item => item.id === note.id ? next : item) }, 'Оновлено нотатку «' + next.title + '»', 'Updated note “' + next.title + '”');
    }
    if (action.type === 'clear_completed') {
      const completed = ws.tasks.filter(task => task.done).map(task => stamp({ ...task, deletedAt: now }));
      const ids = new Set(completed.map(task => task.id));
      return success(completed.length ? { ...ws, tasks: ws.tasks.filter(task => !task.done), deletedTasks: [...completed, ...ws.deletedTasks.filter(task => !ids.has(task.id))] } : ws,
        'Перенесено виконаних завдань до історії: ' + completed.length, 'Moved completed tasks to history: ' + completed.length, [...ids]);
    }
    if (action.type === 'restore_task' || action.type === 'permanently_delete_task') {
      const task = ws.deletedTasks.find(item => item.id === action.taskId);
      if (!task) return fail('not_found', 'Archived task not found: ' + action.taskId);
      const deletedTasks = ws.deletedTasks.filter(item => item.id !== task.id);
      if (action.type === 'permanently_delete_task') return success({ ...ws, deletedTasks }, 'Назавжди видалено «' + task.title + '»', 'Permanently deleted “' + task.title + '”', [task.id]);
      if (ws.tasks.some(item => item.id === task.id)) return fail('conflict', 'Task already exists in active workspace: ' + task.id);
      const { deletedAt, deletionReason, ...restored } = task;
      const phase = ws.tabs.some(tab => tab.id === restored.phase) ? restored.phase : phaseCheck(undefined);
      const next = stamp({ ...restored, phase });
      return success({ ...ws, tasks: [next, ...ws.tasks], deletedTasks }, 'Відновлено «' + task.title + '»', 'Restored “' + task.title + '”', [task.id], undefined, describeTask(next, now));
    }
    // All remaining actions address a live task by its exact ID.
    const task = ws.tasks.find(item => item.id === action.taskId);
    if (!task) return fail('not_found', 'Task not found: ' + action.taskId);
    if (action.type === 'reveal_task') return success(ws, 'Показано завдання «' + task.title + '»', 'Revealed task “' + task.title + '”', [], undefined, action);
    if (action.type === 'delete_task') {
      const deleted = archive(task, action.reason);
      return success({ ...ws, tasks: ws.tasks.filter(item => item.id !== task.id), deletedTasks: [deleted, ...ws.deletedTasks.filter(item => item.id !== task.id)] },
        'Видалено «' + task.title + '»', 'Deleted “' + task.title + '”', [task.id]);
    }
    let next = task, uk = '', en = '';
    const createdIds: string[] = [];
    if (action.type === 'update_task') {
      if (action.phase !== undefined) phaseCheck(action.phase);
      const planned = action.plannedDate === undefined ? task.plannedDate : action.plannedDate;
      const deadline = action.deadlineDate === undefined ? task.deadlineDate : action.deadlineDate;
      if (planned && deadline && planned > deadline) return fail('invalid', 'plannedDate must not be after deadlineDate.');
      const { type, taskId, pinned, ...fields } = action;
      const update: AITaskUpdate = { ...fields, id: taskId };
      next = applyAITaskUpdate(task, update, new Set(ws.tabs.map(tab => tab.id)), now);
      if (next === task) return fail('invalid', 'Task update was rejected by existing task validation. Check task timer and date fields.');
      if (pinned !== undefined) next = { ...next, pinned };
      uk = 'Оновлено завдання «' + next.title + '»'; en = 'Updated task “' + next.title + '”';
    } else if (action.type === 'complete_task' || action.type === 'reopen_task') {
      if (action.type === 'complete_task' && task.scheduledPending) return fail('conflict', 'A pending scheduled task cannot be completed before it materializes.');
      next = action.type === 'complete_task' ? completeTask(finishLimitedStart(task, now), now) : reopenTask(task, now);
      uk = (action.type === 'complete_task' ? 'Завершено «' : 'Повернуто в роботу «') + task.title + '»';
      en = (action.type === 'complete_task' ? 'Completed “' : 'Reopened “') + task.title + '”';
    } else if (action.type === 'add_steps' || action.type === 'rename_step' || action.type === 'set_step_done' || action.type === 'delete_step') {
      const list = materializeStepList(task);
      if (action.type === 'add_steps') {
        const after = action.afterStepIndex ?? list.length;
        if (after > list.length) return fail('invalid', 'afterStepIndex must be between 0 and ' + list.length + '.');
        const added = action.titles.map(title => { const id = newId(); createdIds.push(id); return { id, title: title.trim(), done: false }; });
        list.splice(after, 0, ...added);
        uk = 'Додано кроків до «' + task.title + '»: ' + added.length; en = 'Added steps to “' + task.title + '”: ' + added.length;
      } else {
        const index = resolveStep(list, action.step), item = list[index];
        if (action.type === 'rename_step') { list[index] = { ...item, title: action.title.trim() }; uk = 'Крок ' + (index + 1) + ' перейменовано на «' + action.title.trim() + '»'; en = 'Renamed step ' + (index + 1) + ' to “' + action.title.trim() + '”'; }
        if (action.type === 'set_step_done') { list[index] = { ...item, done: action.done }; uk = 'Крок ' + (index + 1) + ' «' + item.title + '» ' + (action.done ? 'виконано' : 'повернуто в роботу'); en = 'Step ' + (index + 1) + ' “' + item.title + '” ' + (action.done ? 'completed' : 'reopened'); }
        if (action.type === 'delete_step') { list.splice(index, 1); uk = 'Видалено крок ' + (index + 1) + ' «' + item.title + '»'; en = 'Deleted step ' + (index + 1) + ' “' + item.title + '”'; }
      }
      next = setTaskSteps(task, list, now, newId);
    } else {
      const base = finishLimitedStart(task, now);
      if ((action.type === 'start_timer' || action.type === 'set_countdown' || action.type === 'extend_countdown' || action.type === 'limited_start') && task.done) return fail('conflict', 'Reopen the completed task before starting or configuring its timer.');
      if (task.scheduledPending && (action.type === 'start_timer' || action.type === 'limited_start' || action.type === 'set_recorded_time' || action.type === 'set_countdown' && action.start)) return fail('conflict', 'A pending scheduled task cannot record work before it materializes.');
      switch (action.type) {
        case 'start_timer':
          next = startTaskWork(getTaskTimerMode(base) === 'none' ? { ...base, timerMode: 'stopwatch' } : base, now, newId);
          uk = 'Запущено таймер «' + task.title + '»'; en = 'Started timer “' + task.title + '”'; break;
        case 'pause_timer':
          next = pauseTaskTimer(base, now); uk = 'Таймер «' + task.title + '» на паузі'; en = 'Paused timer “' + task.title + '”'; break;
        case 'set_countdown': {
          next = configureTaskCountdown(base, action.minutes * 60, now, newId);
          if (!action.start) {
            next = pauseTaskTimer(next, now);
            if (base.startedAt === undefined) delete next.startedAt;
            else next.startedAt = base.startedAt;
          }
          const before = base.countdownDurationSeconds;
          uk = 'Таймер «' + task.title + '»: ' + (before ? duration(before / 60, 'uk') + ' → ' : '') + duration(action.minutes, 'uk');
          en = 'Timer “' + task.title + '”: ' + (before ? duration(before / 60, 'en') + ' → ' : '') + duration(action.minutes, 'en'); break;
        }
        case 'extend_countdown':
          if (getTaskTimerMode(base) !== 'countdown' || !base.countdownDurationSeconds) return fail('invalid', 'Task has no countdown to extend.');
          if (base.countdownDurationSeconds + action.minutes * 60 > 86400) return fail('invalid', 'Extended countdown cannot exceed 1440 minutes.');
          next = extendTaskCountdown(base, action.minutes * 60, now, newId);
          uk = 'Таймер «' + task.title + '» продовжено на ' + duration(action.minutes, 'uk'); en = 'Extended timer “' + task.title + '” by ' + duration(action.minutes, 'en'); break;
        case 'clear_countdown':
          next = clearTaskCountdown(base, now); uk = 'Прибрано відлік «' + task.title + '»'; en = 'Cleared countdown “' + task.title + '”'; break;
        case 'limited_start': {
          if (task.limitedStart) return fail('conflict', 'A limited start is already active. Finish it first.');
          const attempt = latestAttempt(task);
          const continued = !!attempt && now >= attempt.at && now - attempt.at <= 30 * 60000;
          next = startLimitedStart(task, action.minutes * 60, now, { continued, newId });
          uk = 'Обмежена спроба «' + task.title + '»: ' + duration(action.minutes, 'uk'); en = 'Limited start “' + task.title + '”: ' + duration(action.minutes, 'en'); break;
        }
        case 'finish_limited_start':
          next = base; uk = 'Обмежену спробу «' + task.title + '» завершено'; en = 'Finished limited start “' + task.title + '”'; break;
        case 'set_recorded_time':
          next = setTaskTimeSpent(base, action.minutes * 60, now, newId);
          uk = 'Записаний час «' + task.title + '»: ' + duration(action.minutes, 'uk'); en = 'Recorded time “' + task.title + '”: ' + duration(action.minutes, 'en'); break;
        case 'reset_time':
          next = { ...discardTaskStepAttribution(pauseTaskTimer(base, now)), timeSpentSeconds: 0,
            timeResetAt: Math.max(now, (task.timeResetAt ?? 0) + 1), timerRunning: false, timerStartedAt: undefined };
          uk = 'Скинуто час «' + task.title + '»'; en = 'Reset time “' + task.title + '”'; break;
      }
    }
    next = stamp(next);
    return success({ ...ws, tasks: ws.tasks.map(item => item.id === task.id ? next : item) }, uk, en, [task.id], createdIds, describeTask(next, now));
  } catch (error) {
    if (error instanceof ActionError) return { workspace: ws, result: { ok: false, code: error.code, error: error.message } };
    throw error;
  }
}
