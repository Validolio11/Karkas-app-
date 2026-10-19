import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PSTask } from '../types';
import { captureAgentUndo, undoAgentTurn } from './agentUndo';
import {
  AGENT_DESTRUCTIVE_ACTIONS, applyAgentAction, describeTask, findTasks, validateAgentAction,
  type AgentAction, type AgentContext, type AgentWorkspace,
} from './aiAgentActions';

const NOW = 1_000_000;
const task = (overrides: Partial<PSTask> = {}): PSTask => ({
  id: 'task-1', title: 'Робота над анімацією', phase: 'focus', priority: 2,
  steps: 0, currentStep: 0, done: false, pinned: false, createdAt: 1, ...overrides,
});
const workspace = (overrides: Partial<AgentWorkspace> = {}): AgentWorkspace => ({
  tasks: [task()], deletedTasks: [], tabs: [{ id: 'focus', name: 'Робота' }, { id: 'later', name: 'Пізніше' }],
  notes: [], ...overrides,
});
const context = (overrides: Partial<AgentContext> = {}): AgentContext => {
  let next = 0;
  return { now: NOW, newId: () => 'agent-' + ++next, timeZone: 'Europe/Kyiv', ...overrides };
};
const freeze = <T>(value: T): T => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
const apply = (ws: AgentWorkspace, action: AgentAction, ctx = context()) => {
  const before = structuredClone(ws);
  freeze(ws);
  const output = applyAgentAction(ws, action, ctx);
  assert.deepEqual(ws, before, action.type + ' must not mutate its input');
  return output;
};
const success = (ws: AgentWorkspace, action: AgentAction, ctx = context()) => {
  const output = apply(ws, action, ctx);
  assert.equal(output.result.ok, true, JSON.stringify(output.result));
  assert.ok(output.result.summary.uk.trim());
  assert.ok(output.result.summary.en.trim());
  assert.ok(Array.isArray(output.result.changedTaskIds));
  return { workspace: output.workspace, result: output.result };
};
const checklist = (count: number, completed = 0): PSTask => task({
  steps: count, currentStep: completed,
  stepList: Array.from({ length: count }, (_, index) => ({ id: 'step-' + (index + 1), title: 'Анімація ' + (index + 1), done: index < completed })),
});

test('create_task uses injected ids, first tab defaults and a paused countdown', () => {
  const ws = workspace({ tasks: [] });
  const simple = success(ws, { type: 'create_task', title: 'Нова справа' });
  assert.equal(simple.workspace.tasks[0].phase, 'focus');
  assert.equal(simple.workspace.tasks[0].title, 'Нова справа');
  assert.equal(simple.workspace.tasks[0].createdAt, NOW);
  assert.equal(simple.workspace.tasks[0].updatedAt, NOW);
  assert.equal(simple.workspace.tasks[0].done, false);
  assert.ok(simple.result.createdIds?.includes(simple.workspace.tasks[0].id));
  assert.deepEqual(simple.result.changedTaskIds, [simple.workspace.tasks[0].id]);
  const action: AgentAction = { type: 'create_task', title: 'Монтаж', phase: 'later', priority: 1, note: 'Для клієнта',
    plannedDate: '2026-10-20', deadlineDate: '2026-10-22', steps: ['Підготовка', 'Експорт'], timerMinutes: 120 };
  const detailed = success(ws, action);
  const created = detailed.workspace.tasks[0];
  assert.equal(created.phase, 'later');
  assert.equal(created.priority, 1);
  assert.equal(created.note, 'Для клієнта');
  assert.equal(created.plannedDate, '2026-10-20');
  assert.equal(created.deadlineDate, '2026-10-22');
  assert.equal(created.steps, 2);
  assert.equal(created.currentStep, 0);
  assert.deepEqual(created.stepList?.map(step => [step.title, step.done]), [['Підготовка', false], ['Експорт', false]]);
  assert.ok(created.stepList?.every(step => step.id.startsWith('agent-')));
  assert.equal(created.countdownDurationSeconds, 7200);
  assert.equal(created.countdownRemainingSeconds, 7200);
  assert.equal(created.timerRunning, false);
  assert.deepEqual(apply(ws, action, context()), apply(ws, action, context()));
});

test('update_task changes fields, clears dates with null and preserves the rest of the workspace', () => {
  const ws = workspace({ tasks: [task({ plannedDate: '2026-10-20', deadlineDate: '2026-10-22' }), task({ id: 'other' })] });
  const output = success(ws, { type: 'update_task', taskId: 'task-1', title: 'Нова назва', note: 'Примітка',
    priority: 3, phase: 'later', plannedDate: null, deadlineDate: null, pinned: true });
  const changed = output.workspace.tasks[0];
  assert.equal(changed.title, 'Нова назва');
  assert.equal(changed.note, 'Примітка');
  assert.equal(changed.priority, 3);
  assert.equal(changed.phase, 'later');
  assert.equal(changed.pinned, true);
  assert.equal(changed.plannedDate, undefined);
  assert.equal(changed.deadlineDate, undefined);
  assert.equal(changed.updatedAt, NOW);
  assert.equal(output.workspace.tasks[1], ws.tasks[1]);
  assert.equal(output.workspace.notes, ws.notes);
  assert.deepEqual(output.result.changedTaskIds, ['task-1']);
  const dated = success(output.workspace, { type: 'update_task', taskId: 'task-1', plannedDate: '2026-10-21', deadlineDate: '2026-10-23' });
  assert.equal(dated.workspace.tasks[0].plannedDate, '2026-10-21');
  assert.equal(dated.workspace.tasks[0].deadlineDate, '2026-10-23');
});

test('complete_task banks running work without inventing checklist progress and reopen_task clears completion', () => {
  const original = { ...checklist(3, 1), timerRunning: true, timerStartedAt: NOW - 30_000, timeSpentSeconds: 10 };
  const completed = success(workspace({ tasks: [original] }), { type: 'complete_task', taskId: 'task-1' });
  const done = completed.workspace.tasks[0];
  assert.equal(done.done, true);
  assert.equal(done.completedAt, NOW);
  assert.equal(done.currentStep, 1);
  assert.equal(done.timeSpentSeconds, 40);
  assert.equal(done.timerRunning, false);
  assert.equal(done.updatedAt, NOW);
  const reopened = success(completed.workspace, { type: 'reopen_task', taskId: 'task-1' }, context({ now: NOW + 1 }));
  assert.equal(reopened.workspace.tasks[0].done, false);
  assert.equal(reopened.workspace.tasks[0].completedAt, undefined);
  assert.equal(reopened.workspace.tasks[0].currentStep, 1);
  assert.equal(reopened.workspace.tasks[0].timerRunning, false);
  assert.equal(reopened.workspace.tasks[0].updatedAt, NOW + 1);
});

test('step actions insert, rename, resolve by id and title, and keep checklist counts consistent', () => {
  const added = success(workspace({ tasks: [checklist(2, 1)] }), { type: 'add_steps', taskId: 'task-1', titles: ['Проміжний', 'Перевірка'], afterStepIndex: 1 });
  assert.deepEqual(added.workspace.tasks[0].stepList?.map(step => step.title), ['Анімація 1', 'Проміжний', 'Перевірка', 'Анімація 2']);
  assert.equal(added.workspace.tasks[0].steps, 4);
  assert.equal(added.workspace.tasks[0].currentStep, 1);
  assert.equal(added.result.createdIds?.length, 2);
  const renamed = success(added.workspace, { type: 'rename_step', taskId: 'task-1', step: 'step-2', title: 'Фінал' });
  assert.equal(renamed.workspace.tasks[0].stepList?.[3].title, 'Фінал');
  const done = success(renamed.workspace, { type: 'set_step_done', taskId: 'task-1', step: 'Перевірка', done: true });
  assert.equal(done.workspace.tasks[0].currentStep, 2);
  const reopened = success(done.workspace, { type: 'set_step_done', taskId: 'task-1', step: 1, done: false });
  assert.equal(reopened.workspace.tasks[0].currentStep, 1);
  const removed = success(reopened.workspace, { type: 'delete_step', taskId: 'task-1', step: 'Фінал' });
  assert.equal(removed.workspace.tasks[0].steps, 3);
  assert.equal(removed.workspace.tasks[0].currentStep, 1);
  assert.equal(removed.workspace.tasks[0].updatedAt, NOW);
  assert.equal(removed.workspace.tasks[0].done, false);
});

test('add_steps supports prepend, append and legacy numeric progress', () => {
  const ws = workspace({ tasks: [task({ steps: 2, currentStep: 1 })] });
  const ctx = context();
  const prepend = success(ws, { type: 'add_steps', taskId: 'task-1', titles: ['Вступ'], afterStepIndex: 0 }, ctx);
  assert.equal(prepend.workspace.tasks[0].stepList?.[0].title, 'Вступ');
  assert.deepEqual(prepend.workspace.tasks[0].stepList?.map(step => step.done), [false, true, false]);
  const append = success(prepend.workspace, { type: 'add_steps', taskId: 'task-1', titles: ['Кінець'] }, ctx);
  assert.equal(append.workspace.tasks[0].stepList?.at(-1)?.title, 'Кінець');
  assert.equal(append.workspace.tasks[0].steps, 4);
  assert.equal(append.workspace.tasks[0].currentStep, 1);
});

test('step resolution is one based, fuzzy when unique, and lists ambiguous candidates without mutation', () => {
  const ws = workspace({ tasks: [checklist(2)] });
  const fuzzy = success(ws, { type: 'rename_step', taskId: 'task-1', step: 'Анімацїя 1', title: 'Початок' });
  assert.equal(fuzzy.workspace.tasks[0].stepList?.[0].title, 'Початок');
  const ambiguous = apply(ws, { type: 'set_step_done', taskId: 'task-1', step: 'Анімація', done: true });
  assert.equal(ambiguous.workspace, ws);
  assert.equal(ambiguous.result.ok, false);
  if (ambiguous.result.ok === false) {
    assert.ok(['invalid', 'conflict'].includes(ambiguous.result.code));
    assert.match(ambiguous.result.error, /Анімація 1/);
    assert.match(ambiguous.result.error, /Анімація 2/);
  }
  for (const step of [0, 3, 'невідомий крок']) {
    const output = apply(ws, { type: 'delete_step', taskId: 'task-1', step });
    assert.equal(output.result.ok, false);
    assert.equal(output.workspace, ws);
  }
});

test('last completed step never completes the parent task', () => {
  const output = success(workspace({ tasks: [checklist(2, 1)] }), { type: 'set_step_done', taskId: 'task-1', step: 2, done: true });
  const changed = output.workspace.tasks[0];
  assert.equal(changed.currentStep, 2);
  assert.equal(changed.steps, 2);
  assert.ok(changed.stepList?.every(step => step.done));
  assert.equal(changed.done, false);
  assert.equal(changed.completedAt, undefined);
});

test('timer actions start, pause, configure, extend and clear without losing recorded work', () => {
  const ws = workspace({ tasks: [task({ timerMode: 'stopwatch', timeSpentSeconds: 30 })] });
  const ctx = context();
  const running = success(ws, { type: 'start_timer', taskId: 'task-1' }, ctx);
  assert.equal(running.workspace.tasks[0].timerRunning, true);
  assert.equal(running.workspace.tasks[0].timerStartedAt, NOW);
  assert.equal(running.workspace.tasks[0].startedAt, NOW);
  assert.equal(running.workspace.tasks[0].timerSessionId, 'agent-1');
  ctx.now = NOW + 30_000;
  const paused = success(running.workspace, { type: 'pause_timer', taskId: 'task-1' }, ctx);
  assert.equal(paused.workspace.tasks[0].timeSpentSeconds, 60);
  assert.equal(paused.workspace.tasks[0].timerRunning, false);
  const configured = success(paused.workspace, { type: 'set_countdown', taskId: 'task-1', minutes: 120 }, ctx);
  assert.equal(configured.workspace.tasks[0].countdownDurationSeconds, 7200);
  assert.equal(configured.workspace.tasks[0].countdownRemainingSeconds, 7200);
  assert.equal(configured.workspace.tasks[0].timerRunning, false);
  const extended = success(configured.workspace, { type: 'extend_countdown', taskId: 'task-1', minutes: 30 }, ctx);
  assert.equal(extended.workspace.tasks[0].countdownDurationSeconds, 9000);
  assert.equal(extended.workspace.tasks[0].countdownRemainingSeconds, 9000);
  assert.equal(extended.workspace.tasks[0].timerRunning, false);
  const started = success(extended.workspace, { type: 'set_countdown', taskId: 'task-1', minutes: 180, start: true }, ctx);
  assert.equal(started.workspace.tasks[0].timerRunning, true);
  ctx.now = NOW + 40_000;
  const cleared = success(started.workspace, { type: 'clear_countdown', taskId: 'task-1' }, ctx);
  assert.equal(cleared.workspace.tasks[0].timerMode, 'stopwatch');
  assert.equal(cleared.workspace.tasks[0].countdownDurationSeconds, undefined);
  assert.equal(cleared.workspace.tasks[0].countdownRemainingSeconds, undefined);
  assert.equal(cleared.workspace.tasks[0].timerRunning, false);
  assert.equal(cleared.workspace.tasks[0].timeSpentSeconds, 70);
  assert.equal(cleared.workspace.tasks[0].updatedAt, NOW + 40_000);
});

test('limited_start and finish_limited_start restore the original timer and bank the attempt once', () => {
  const ws = workspace({ tasks: [task({ timerMode: 'stopwatch', timeSpentSeconds: 20 })] });
  const started = success(ws, { type: 'limited_start', taskId: 'task-1', minutes: 15 });
  assert.equal(started.workspace.tasks[0].limitedStart?.capSeconds, 900);
  assert.ok(started.workspace.tasks[0].limitedStart?.id.startsWith('agent-'));
  assert.equal(started.workspace.tasks[0].timerRunning, true);
  const finished = success(started.workspace, { type: 'finish_limited_start', taskId: 'task-1' }, context({ now: NOW + 300_000 }));
  assert.equal(finished.workspace.tasks[0].limitedStart, undefined);
  assert.equal(finished.workspace.tasks[0].timerMode, 'stopwatch');
  assert.equal(finished.workspace.tasks[0].timerRunning, false);
  assert.equal(finished.workspace.tasks[0].timeSpentSeconds, 320);
  assert.equal(finished.workspace.tasks[0].activityTrail?.filter(event => event.kind === 'attempt').length, 1);
});

test('pausing and configuring finish limited start before handling the restored timer', () => {
  const ws = workspace({ tasks: [task({ timerMode: 'countdown', countdownDurationSeconds: 7200, countdownRemainingSeconds: 3600, timeSpentSeconds: 10 })] });
  const ctx = context();
  const started = success(ws, { type: 'limited_start', taskId: 'task-1', minutes: 15 }, ctx);
  ctx.now = NOW + 120_000;
  const paused = success(started.workspace, { type: 'pause_timer', taskId: 'task-1' }, ctx).workspace.tasks[0];
  assert.equal(paused.limitedStart, undefined);
  assert.equal(paused.countdownDurationSeconds, 7200);
  assert.equal(paused.countdownRemainingSeconds, 3600);
  assert.equal(paused.timeSpentSeconds, 130);
  assert.equal(paused.timerRunning, false);
  const configured = success(started.workspace, { type: 'set_countdown', taskId: 'task-1', minutes: 180 }, ctx).workspace.tasks[0];
  assert.equal(configured.limitedStart, undefined);
  assert.equal(configured.countdownDurationSeconds, 10800);
  assert.equal(configured.countdownRemainingSeconds, 10800);
  assert.equal(configured.timerRunning, false);
  assert.equal(configured.timeSpentSeconds, 130);
});

test('set_recorded_time sets an absolute total and reset_time clears attribution with a monotonic reset marker', () => {
  const ws = workspace({ tasks: [task({ timeSpentSeconds: 600, timeResetAt: NOW + 5,
    steps: 1, stepList: [{ id: 'step-1', title: 'Перший', done: false, timeSpentSeconds: 600 }], timeSessions: { previous: { seconds: 600 } } })] });
  const edited = success(ws, { type: 'set_recorded_time', taskId: 'task-1', minutes: 30 });
  assert.equal(edited.workspace.tasks[0].timeSpentSeconds, 1800);
  assert.equal(edited.workspace.tasks[0].timeResetAt, NOW + 6);
  const reset = success(edited.workspace, { type: 'reset_time', taskId: 'task-1' }, context({ confirmed: true }));
  const changed = reset.workspace.tasks[0];
  assert.equal(changed.timeSpentSeconds, 0);
  assert.equal(changed.timeResetAt, NOW + 7);
  assert.equal(changed.timerRunning, false);
  assert.equal(changed.timerStartedAt, undefined);
  assert.equal(changed.stepList?.[0].timeSpentSeconds, undefined);
  assert.equal(changed.updatedAt, NOW);
});

test('timer and active checklist paths are deterministic with the same injected clock and ids', () => {
  const ws = workspace({ tasks: [{ ...checklist(2), timerMode: 'stopwatch', timeSpentSeconds: 20 }] });
  for (const action of [
    { type: 'start_timer', taskId: 'task-1' },
    { type: 'limited_start', taskId: 'task-1', minutes: 15 },
    { type: 'set_countdown', taskId: 'task-1', minutes: 180, start: true },
  ] as AgentAction[]) assert.deepEqual(apply(ws, action, context()), apply(ws, action, context()));
  const running = workspace({ tasks: [{ ...checklist(2), timerMode: 'stopwatch', timerRunning: true,
    timerStartedAt: NOW - 30_000, timerSessionId: 'previous', timerStepId: 'step-1' }] });
  const action: AgentAction = { type: 'set_step_done', taskId: 'task-1', step: 1, done: true };
  assert.deepEqual(apply(running, action, context()), apply(running, action, context()));
});

test('compound countdown and checklist updates both apply and summarize their actual result', () => {
  const original = { ...checklist(6, 2), timerMode: 'countdown' as const, countdownDurationSeconds: 7200,
    countdownRemainingSeconds: 7200, timerRunning: false };
  const timer = success(workspace({ tasks: [original] }), { type: 'set_countdown', taskId: 'task-1', minutes: 180 });
  const step = success(timer.workspace, { type: 'set_step_done', taskId: 'task-1', step: 3, done: true });
  const changed = step.workspace.tasks[0];
  assert.equal(changed.countdownDurationSeconds, 10800);
  assert.equal(changed.countdownRemainingSeconds, 10800);
  assert.equal(changed.timerRunning, false);
  assert.equal(changed.startedAt, undefined);
  assert.equal(changed.currentStep, 3);
  assert.equal(changed.stepList?.[2].done, true);
  assert.equal(changed.done, false);
  assert.match(timer.result.summary.uk, /2|120/);
  assert.match(timer.result.summary.uk, /3|180/);
  assert.match(step.result.summary.uk, /3/);
  assert.match(step.result.summary.uk, /Анімація 3/);
});

test('tab actions create, rename, recolor and remap live and archived tasks on deletion', () => {
  const ws = workspace({ deletedTasks: [{ ...task({ id: 'archived' }), deletedAt: 20 }] });
  const created = success(ws, { type: 'create_tab', name: 'Особисте', color: '#abcdef' });
  const tab = created.workspace.tabs.find(value => value.name === 'Особисте')!;
  assert.ok(tab.id.startsWith('agent-'));
  assert.equal(tab.color, '#abcdef');
  assert.ok(created.result.createdIds?.includes(tab.id));
  const renamed = success(created.workspace, { type: 'rename_tab', tabId: tab.id, name: 'Власне' });
  assert.equal(renamed.workspace.tabs.find(value => value.id === tab.id)?.name, 'Власне');
  const colored = success(renamed.workspace, { type: 'set_tab_color', tabId: tab.id, color: '#123456' });
  assert.equal(colored.workspace.tabs.find(value => value.id === tab.id)?.color, '#123456');
  const deleted = success(colored.workspace, { type: 'delete_tab', tabId: 'focus' }, context({ confirmed: true }));
  assert.equal(deleted.workspace.tabs[0].id, 'later');
  assert.equal(deleted.workspace.tasks[0].phase, 'later');
  assert.equal(deleted.workspace.deletedTasks[0].phase, 'later');
  assert.equal(deleted.workspace.tasks[0].updatedAt, NOW);
  assert.equal(deleted.workspace.deletedTasks[0].updatedAt, NOW);
  assert.ok(deleted.result.changedTaskIds.includes('task-1'));
  const oneTab = workspace({ tabs: [{ id: 'focus', name: 'Єдина' }] });
  const refused = apply(oneTab, { type: 'delete_tab', tabId: 'focus' }, context({ confirmed: true }));
  assert.equal(refused.result.ok, false);
  assert.equal(refused.workspace, oneTab);
});

test('delete_task finishes limited work, archives with intent, restore_task restores and permanent deletion removes it', () => {
  const ctx = context();
  const started = success(workspace(), { type: 'limited_start', taskId: 'task-1', minutes: 5 }, ctx);
  const deleted = success(started.workspace, { type: 'delete_task', taskId: 'task-1', reason: 'cancelled' }, context({ now: NOW + 60_000, confirmed: true }));
  assert.equal(deleted.workspace.tasks.length, 0);
  const archived = deleted.workspace.deletedTasks[0];
  assert.equal(archived.id, 'task-1');
  assert.equal(archived.deletionReason, 'cancelled');
  assert.equal(archived.deletedAt, NOW + 60_000);
  assert.equal(archived.updatedAt, NOW + 60_000);
  assert.equal(archived.timerRunning, false);
  assert.equal(archived.limitedStart, undefined);
  assert.equal(archived.timeSpentSeconds, 60);
  const restored = success(deleted.workspace, { type: 'restore_task', taskId: 'task-1' }, context({ now: NOW + 60_001 }));
  assert.equal(restored.workspace.deletedTasks.length, 0);
  assert.equal(restored.workspace.tasks[0].id, 'task-1');
  assert.equal('deletedAt' in restored.workspace.tasks[0], false);
  assert.equal(restored.workspace.tasks[0].updatedAt, NOW + 60_001);
  const permanent = success(deleted.workspace, { type: 'permanently_delete_task', taskId: 'task-1' }, context({ confirmed: true }));
  assert.equal(permanent.workspace.deletedTasks.length, 0);
  assert.equal(permanent.workspace.tasks.length, 0);
});

test('clear_completed archives completed tasks once and preserves completion results and history', () => {
  const completed = { ...checklist(2, 1), id: 'done', done: true, completedAt: 500, timeSpentSeconds: 300 };
  const ws = workspace({ tasks: [task(), completed], deletedTasks: [{ ...completed, deletedAt: 600 }, { ...task({ id: 'older' }), deletedAt: 700 }] });
  const output = success(ws, { type: 'clear_completed' }, context({ confirmed: true }));
  assert.deepEqual(output.workspace.tasks.map(value => value.id), ['task-1']);
  assert.equal(output.workspace.deletedTasks.filter(value => value.id === 'done').length, 1);
  const archived = output.workspace.deletedTasks.find(value => value.id === 'done')!;
  assert.equal(archived.done, true);
  assert.equal(archived.completedAt, 500);
  assert.equal(archived.currentStep, 1);
  assert.equal(archived.deletedAt, NOW);
  assert.equal(archived.updatedAt, NOW);
  assert.ok(output.workspace.deletedTasks.some(value => value.id === 'older'));
  assert.deepEqual(output.result.changedTaskIds, ['done']);
});

test('note actions use injected ids, preserve content and bump updatedAt', () => {
  const created = success(workspace(), { type: 'create_note', title: 'Ідеї', content: 'Перший рядок\nДругий рядок' });
  const note = created.workspace.notes[0];
  assert.ok(note.id.startsWith('agent-'));
  assert.equal(note.title, 'Ідеї');
  assert.equal(note.content, 'Перший рядок\nДругий рядок');
  assert.equal(note.createdAt, NOW);
  assert.equal(note.updatedAt, NOW);
  assert.ok(created.result.createdIds?.includes(note.id));
  assert.deepEqual(created.result.changedTaskIds, []);
  const title = success(created.workspace, { type: 'update_note', noteId: note.id, title: 'План' }, context({ now: NOW + 1 }));
  assert.equal(title.workspace.notes[0].title, 'План');
  assert.equal(title.workspace.notes[0].content, note.content);
  const content = success(title.workspace, { type: 'update_note', noteId: note.id, content: '' }, context({ now: NOW + 2 }));
  assert.equal(content.workspace.notes[0].content, '');
  assert.equal(content.workspace.notes[0].createdAt, NOW);
  assert.equal(content.workspace.notes[0].updatedAt, NOW + 2);
});

test('navigation returns actionable data and the exact unchanged workspace', () => {
  const ws = workspace();
  for (const view of ['dashboard', 'strategy', 'notes', 'history', 'tasks'] as const) {
    const action: AgentAction = { type: 'open_view', view };
    const output = success(ws, action);
    assert.equal(output.workspace, ws);
    assert.deepEqual(output.result.data, action);
    assert.deepEqual(output.result.changedTaskIds, []);
  }
  const action: AgentAction = { type: 'reveal_task', taskId: 'task-1' };
  const revealed = success(ws, action);
  assert.equal(revealed.workspace, ws);
  assert.deepEqual(revealed.result.data, action);
});

test('all destructive actions require confirmation before returning a changed workspace', () => {
  assert.deepEqual([...AGENT_DESTRUCTIVE_ACTIONS].sort(), ['clear_completed', 'delete_tab', 'delete_task', 'permanently_delete_task', 'reset_time']);
  const actions: AgentAction[] = [
    { type: 'reset_time', taskId: 'task-1' }, { type: 'delete_tab', tabId: 'focus' },
    { type: 'delete_task', taskId: 'task-1' }, { type: 'permanently_delete_task', taskId: 'archived' }, { type: 'clear_completed' },
  ];
  for (const action of actions) {
    const ws = workspace({ tasks: [task({ timeSpentSeconds: 120 }), task({ id: 'done', done: true })],
      deletedTasks: [{ ...task({ id: 'archived' }), deletedAt: 10 }] });
    const denied = apply(ws, action);
    assert.equal(denied.workspace, ws);
    assert.equal(denied.result.ok, false);
    if (denied.result.ok === false) {
      assert.equal(denied.result.code, 'needs_confirmation');
      assert.ok(denied.result.error.trim());
    }
    const allowed = success(ws, action, context({ confirmed: true }));
    assert.notEqual(allowed.workspace, ws);
  }
});

test('missing tasks, tabs, notes and archived tasks return not_found without changing workspace identity', () => {
  const ws = workspace();
  const actions: AgentAction[] = [
    { type: 'update_task', taskId: 'missing', title: 'Назва' }, { type: 'complete_task', taskId: 'missing' },
    { type: 'start_timer', taskId: 'missing' }, { type: 'reveal_task', taskId: 'missing' },
    { type: 'rename_tab', tabId: 'missing', name: 'Назва' }, { type: 'update_note', noteId: 'missing', content: 'Текст' },
    { type: 'restore_task', taskId: 'missing' }, { type: 'permanently_delete_task', taskId: 'missing' },
  ];
  for (const action of actions) {
    const output = apply(ws, action, context({ confirmed: true }));
    assert.equal(output.workspace, ws);
    assert.equal(output.result.ok, false);
    if (output.result.ok === false) assert.equal(output.result.code, 'not_found');
  }
});

test('invalid phase and date combinations explain errors and preserve workspace identity', () => {
  const ws = workspace();
  const actions: AgentAction[] = [
    { type: 'create_task', title: 'Назва', phase: 'unknown' },
    { type: 'update_task', taskId: 'task-1', phase: 'unknown' },
    { type: 'create_task', title: 'Назва', plannedDate: '2026-10-23', deadlineDate: '2026-10-20' },
    { type: 'update_task', taskId: 'task-1', plannedDate: '2026-10-23', deadlineDate: '2026-10-20' },
    { type: 'set_countdown', taskId: 'task-1', minutes: 0 },
    { type: 'limited_start', taskId: 'task-1', minutes: 4 },
    { type: 'add_steps', taskId: 'task-1', titles: ['Новий'], afterStepIndex: 10 },
  ];
  for (const action of actions) {
    const output = apply(ws, action);
    assert.equal(output.workspace, ws);
    assert.equal(output.result.ok, false);
    if (output.result.ok === false) {
      assert.equal(output.result.code, 'invalid');
      if ('phase' in action) {
        assert.match(output.result.error, /focus/);
        assert.match(output.result.error, /later/);
      }
    }
  }
});

test('findTasks handles Ukrainian inflections, Russian spelling and typos, ranking useful compact records', () => {
  const ws = workspace({ tasks: [task({ id: 'animation' }), task({ id: 'unrelated', title: 'Купити продукти' }),
    task({ id: 'completed', done: true }), task({ id: 'apostrophe', title: 'Звʼязок із замовником' })],
    deletedTasks: [{ ...task({ id: 'archived' }), deletedAt: 50 }] });
  for (const query of ['анімацієй', 'анимацию', 'роботу над анімац', 'РОБОТА НАД АНІМАЦІЄЮ', 'анімцаією']) {
    const matches = findTasks(ws, query, {});
    assert.equal(matches[0]?.id, 'animation', query);
    assert.ok(matches.every(value => value.id !== 'completed' && value.id !== 'archived'), query);
    assert.equal(matches[0]?.deleted, false);
    assert.equal(typeof matches[0]?.score, 'number');
    assert.deepEqual(matches, findTasks(ws, query, {}));
  }
  assert.equal(findTasks(ws, "зв'язок", {})[0]?.id, 'apostrophe');
  assert.ok(findTasks(ws, 'анімація', { includeDone: true }).some(value => value.id === 'completed'));
  assert.ok(findTasks(ws, 'анімація', { includeDeleted: true }).some(value => value.id === 'archived' && value.deleted));
  assert.deepEqual(findTasks(ws, 'фотосинтез', {}), []);
});

test('describeTask reports compact live countdown and checklist information without mutating the task', () => {
  const original = freeze({ ...checklist(3, 1), plannedDate: '2026-10-20', deadlineDate: '2026-10-22',
    timerMode: 'countdown' as const, countdownDurationSeconds: 7200, countdownRemainingSeconds: 3600,
    timeSpentSeconds: 120, timerRunning: true, timerStartedAt: NOW - 60_000 });
  const before = structuredClone(original);
  const description = describeTask(original, NOW);
  assert.equal(description.id, original.id);
  assert.equal(description.title, original.title);
  assert.equal(description.phase, 'focus');
  assert.equal(description.priority, 2);
  assert.equal(description.done, false);
  assert.equal(description.plannedDate, '2026-10-20');
  assert.equal(description.deadlineDate, '2026-10-22');
  assert.deepEqual(description.steps.map(step => [step.number, step.id, step.done]), [[1, 'step-1', true], [2, 'step-2', false], [3, 'step-3', false]]);
  assert.equal(description.timer.mode, 'countdown');
  assert.equal(description.timer.countdownMinutes, 120);
  assert.equal(description.timer.remainingMinutes, 59);
  assert.equal(description.timer.recordedMinutes, 3);
  assert.equal(description.timer.running, true);
  assert.equal(description.timer.limitedStart, null);
  assert.deepEqual(original, before);
  const started = success(workspace(), { type: 'limited_start', taskId: 'task-1', minutes: 15 });
  assert.deepEqual(describeTask(started.workspace.tasks[0], NOW + 60_000).timer.limitedStart, { minutes: 15, remainingMinutes: 14 });
});

test('validateAgentAction strictly rejects malformed model arguments, unknown types and extra keys', () => {
  const invalid: unknown[] = [null, [], true, 2, 'start_timer', {}, { type: 'unknown' },
    { type: 'clear_completed', taskId: 'task-1' }, { type: 'start_timer', taskId: 'task-1', minutes: 30 },
    { type: 'start_timer', taskId: '' }, { type: 'start_timer', taskId: 1 },
    { type: 'create_task', title: '  ' }, { type: 'create_task', title: 'Назва', priority: 4 },
    { type: 'create_task', title: 'Назва', steps: [''] }, { type: 'create_task', title: 'Назва', timerMinutes: Infinity },
    { type: 'update_task', taskId: 'task-1', pinned: 'true' }, { type: 'update_task', taskId: 'task-1', plannedDate: '2026-02-30' },
    { type: 'set_countdown', taskId: 'task-1', minutes: -1 }, { type: 'set_countdown', taskId: 'task-1', minutes: NaN },
    { type: 'set_countdown', taskId: 'task-1', minutes: '180' }, { type: 'set_countdown', taskId: 'task-1', minutes: 180, start: 1 },
    { type: 'set_recorded_time', taskId: 'task-1', minutes: -1 },
    { type: 'limited_start', taskId: 'task-1', minutes: 4 }, { type: 'limited_start', taskId: 'task-1', minutes: 61 },
    { type: 'set_step_done', taskId: 'task-1', step: 0, done: true }, { type: 'set_step_done', taskId: 'task-1', step: 1, done: 'yes' },
    { type: 'rename_step', taskId: 'task-1', step: 1 }, { type: 'add_steps', taskId: 'task-1', titles: [], afterStepIndex: -1 },
    { type: 'delete_task', taskId: 'task-1', reason: 'finished' }, { type: 'open_view', view: 'settings' },
    { type: 'create_note', title: 'Нотатка', content: 123 }, { type: 'update_note', noteId: 'note', content: null },
  ];
  for (const raw of invalid) {
    const result = validateAgentAction(raw);
    assert.ok('error' in result, JSON.stringify(raw));
    if ('error' in result) assert.ok(result.error.trim());
  }
  const valid: AgentAction[] = [
    { type: 'create_task', title: 'Назва', priority: 2, steps: ['Крок'], timerMinutes: 180 },
    { type: 'update_task', taskId: 'task-1', plannedDate: null, pinned: false },
    { type: 'rename_step', taskId: 'task-1', step: 'step-1', title: 'Нова назва' },
    { type: 'set_countdown', taskId: 'task-1', minutes: 180, start: false },
    { type: 'limited_start', taskId: 'task-1', minutes: 5 }, { type: 'limited_start', taskId: 'task-1', minutes: 60 },
    { type: 'clear_completed' }, { type: 'open_view', view: 'tasks' }, { type: 'create_note', title: 'Нотатка', content: '' },
  ];
  for (const action of valid) assert.deepEqual(validateAgentAction(action), action);
});


test('invalid contexts and generated id conflicts return the original workspace atomically', () => {
  const ws = workspace();
  for (const now of [NaN, Infinity, -1]) {
    const output = apply(ws, { type: 'create_task', title: 'Нова справа' }, context({ now }));
    assert.equal(output.workspace, ws);
    assert.equal(output.result.ok, false);
    if (!output.result.ok) assert.equal(output.result.code, 'invalid');
  }
  for (const action of [{ type: 'create_task', title: 'Нова справа' },
    { type: 'add_steps', taskId: 'task-1', titles: ['Перший', 'Другий'] }] as AgentAction[]) {
    const output = apply(ws, action, context({ newId: () => 'task-1' }));
    assert.equal(output.workspace, ws);
    assert.equal(output.result.ok, false);
    if (!output.result.ok) assert.equal(output.result.code, 'conflict');
  }
  const legacy = workspace({ tasks: [task({ steps: 1 })] });
  const output = apply(legacy, { type: 'add_steps', taskId: 'task-1', titles: ['Наступний'] }, context({ newId: () => 's-task-1-0' }));
  assert.equal(output.workspace, legacy);
  assert.equal(output.result.ok, false);
});

test('validation rejects inherited types, sparse arrays and empty updates', () => {
  for (const value of [Object.create({ type: 'clear_completed' }),
    { type: 'create_task', title: 'Нова справа', steps: Array(1) },
    { type: 'update_task', taskId: 'task-1' }, { type: 'update_note', noteId: 'note' },
    { type: 'start_timer', taskId: 'task-1', extra: undefined }]) {
    assert.ok('error' in validateAgentAction(value));
  }
});

const PLAN_NOW = Date.parse('2026-10-19T07:07:04Z'); // 10:07 in Kyiv.
const planContext = (overrides: Partial<AgentContext> = {}) => context({ now: PLAN_NOW, ...overrides });
const planWorkspace = (overrides: Partial<AgentWorkspace> = {}) => workspace({
  tabs: [{ id: 'focus', name: 'Робота' }, { id: 'learn', name: 'Навчання' }, { id: 'home', name: 'Особисте' }], ...overrides,
});
type ScheduleBlock = { taskId: string; title: string; start: string; end: string; phase: string; priority: 1 | 2 | 3; estimated: boolean; created: boolean };
const schedule = (result: { data?: unknown }): ScheduleBlock[] => {
  assert.ok(Array.isArray(result.data));
  return result.data as ScheduleBlock[];
};
const assertPaused = (value: PSTask, minutes: number) => {
  assert.equal(value.timerMode, 'countdown');
  assert.equal(value.countdownDurationSeconds, minutes * 60);
  assert.equal(value.countdownRemainingSeconds, minutes * 60);
  assert.equal(value.timerRunning, false);
  assert.equal(value.timerStartedAt, undefined);
  assert.equal(value.startedAt, undefined);
};

test('plan_day schedules the spoken example in order, resolves tabs and updates animation without a duplicate', () => {
  const before = planWorkspace();
  const action: AgentAction = { type: 'plan_day', date: '2026-10-19', start: '13:00', items: [
    { title: 'Встановити жалюзі', phase: 'Особисте', priority: 1, durationMinutes: 60, estimated: true },
    { title: 'Спланувати анімацію', phase: 'Робота', priority: 2, durationMinutes: 30, steps: ['Ідея', 'Сценарій'] },
    { title: 'Робота над анімацією', phase: 'Робота', priority: 1, durationMinutes: 300, note: 'Головне на сьогодні' },
    { title: 'Навчання друку', phase: 'Навчання', priority: 2, durationMinutes: 30 },
    { title: 'Відпочинок', phase: 'Особисте', priority: 3, durationMinutes: 60, estimated: true },
  ] };
  const output = success(before, action, planContext());
  const blocks = schedule(output.result);
  assert.deepEqual(blocks.map(value => [value.start, value.end]), [
    ['13:00', '14:00'], ['14:00', '14:30'], ['14:30', '19:30'], ['19:30', '20:00'], ['20:00', '21:00'],
  ]);
  assert.deepEqual(blocks.map(value => value.phase), ['home', 'focus', 'focus', 'learn', 'home']);
  assert.deepEqual(blocks.map(value => value.priority), [1, 2, 1, 2, 3]);
  assert.deepEqual(blocks.map(value => value.estimated), [true, false, false, false, true]);
  assert.deepEqual(blocks.map(value => value.created), [true, true, false, true, true]);
  assert.equal(blocks[2].taskId, 'task-1');
  assert.equal(output.workspace.tasks.length, 5);
  assert.equal(output.workspace.tasks.filter(value => value.title === 'Робота над анімацією').length, 1);
  assert.equal(output.workspace.tasks.find(value => value.id === 'task-1')?.note, 'Головне на сьогодні');
  assert.deepEqual(new Set(output.result.changedTaskIds), new Set(blocks.map(value => value.taskId)));
  for (const [index, block] of blocks.entries()) {
    const value = output.workspace.tasks.find(value => value.id === block.taskId)!;
    assert.equal(value.plannedDate, '2026-10-19');
    assert.equal(value.scheduledPending, false);
    assert.equal(value.schedule, undefined);
    assertPaused(value, action.items[index].durationMinutes);
  }
  assert.equal(output.workspace.tasks.find(value => value.id === blocks[0].taskId)?.scheduledFor, Date.parse('2026-10-19T10:00:00Z'));
  assert.deepEqual(output.workspace.tasks.find(value => value.id === blocks[1].taskId)?.stepList?.map(value => value.title), ['Ідея', 'Сценарій']);
  assert.equal(output.result.summary.uk.split('\n').length, 5);
  assert.match(output.result.summary.uk, /14:00–14:30 · Спланувати анімацію · Робота · P2/);
  assert.match(output.result.summary.uk, /орієнтовно/);
  assert.match(output.result.summary.en, /estimated/);
  const createdTasks = blocks.filter(value => value.created).map(value => value.taskId);
  assert.deepEqual(output.result.createdIds?.filter(id => createdTasks.includes(id)), createdTasks);
  let replayIndex = 0;
  const replayed = success(before, action, planContext({ newId: () => output.result.createdIds![replayIndex++] }));
  assert.deepEqual(replayed.workspace, output.workspace);
  assert.deepEqual(replayed.result, output.result);
  assert.equal(replayIndex, output.result.createdIds?.length);
});

test('plan_day can reference a taskId and uses one strong active title match but never a completed or archived match', () => {
  const before = planWorkspace({ tasks: [task(), task({ id: 'done', title: 'Відпочинок', done: true })],
    deletedTasks: [{ ...task({ id: 'archived', title: 'Купити молоко' }), deletedAt: 5 }] });
  const byId = success(before, { type: 'plan_day', start: '10:00', items: [
    { taskId: 'task-1', durationMinutes: 30, phase: 'Навчання', priority: 1 },
    { title: 'Відпочинок', durationMinutes: 20, priority: 3 },
    { title: 'Купити молоко', durationMinutes: 15 },
  ] }, planContext());
  assert.deepEqual(schedule(byId.result).map(value => value.created), [false, true, true]);
  assert.equal(byId.workspace.tasks.find(value => value.id === 'task-1')?.phase, 'learn');
  const fuzzy = success(planWorkspace(), { type: 'plan_day', start: '10:00', items: [
    { title: 'роботу над анімацією', durationMinutes: 60 },
  ] }, planContext());
  assert.equal(fuzzy.workspace.tasks.length, 1);
  assert.equal(schedule(fuzzy.result)[0].taskId, 'task-1');
  assert.equal(schedule(fuzzy.result)[0].created, false);
  const ambiguous = planWorkspace({ tasks: [task({ id: 'a', title: 'Монтаж відео для клієнта' }), task({ id: 'b', title: 'Монтаж відео для каналу' })] });
  const created = success(ambiguous, { type: 'plan_day', start: '10:00', items: [{ title: 'Монтаж відео', durationMinutes: 30 }] }, planContext());
  assert.equal(schedule(created.result)[0].created, true);
  assert.equal(created.workspace.tasks.length, 3);
});

test('plan_day fixedStart 13:30 shifts later blocks and breakAfterMinutes advances the cursor', () => {
  const output = success(planWorkspace({ tasks: [] }), { type: 'plan_day', start: '12:30', items: [
    { title: 'Жалюзі', durationMinutes: 30, breakAfterMinutes: 15 },
    { title: 'Пів другої', durationMinutes: 45, fixedStart: '13:30', breakAfterMinutes: 10 },
    { title: 'Друк', durationMinutes: 30, phase: 'Навчання' },
  ] }, planContext());
  assert.deepEqual(schedule(output.result).map(value => [value.start, value.end]), [
    ['12:30', '13:00'], ['13:30', '14:15'], ['14:25', '14:55'],
  ]);
});

test('plan_day overlap names both blocks and times and refuses the entire plan atomically', () => {
  const before = planWorkspace();
  const output = apply(before, { type: 'plan_day', start: '13:00', items: [
    { taskId: 'task-1', durationMinutes: 60, priority: 1 },
    { title: 'Друк', durationMinutes: 30, fixedStart: '13:30' },
  ] }, planContext());
  assert.equal(output.workspace, before);
  assert.equal(output.result.ok, false);
  if (!output.result.ok) {
    assert.equal(output.result.code, 'conflict');
    for (const expected of ['Робота над анімацією', 'Друк', '13:30', '14:00']) assert.ok(output.result.error.includes(expected), output.result.error);
  }
});

test('plan_day validates midnight, future-date start and every item before returning any changes', () => {
  const before = planWorkspace();
  const cases: AgentAction[] = [
    { type: 'plan_day', start: '23:30', items: [{ title: 'Пізній блок', durationMinutes: 31 }] },
    { type: 'plan_day', date: '2026-10-20', items: [{ title: 'Завтра', durationMinutes: 30 }] },
    { type: 'plan_day', start: '10:00', items: [{ title: 'Нова', durationMinutes: 30 }, { taskId: 'missing', durationMinutes: 30 }] },
    { type: 'plan_day', start: '10:00', items: [{ title: 'Нова', durationMinutes: 30 }, { taskId: 'task-1', phase: 'unknown', durationMinutes: 30 }] },
  ];
  for (const action of cases) {
    const output = apply(before, action, planContext());
    assert.equal(output.workspace, before);
    assert.equal(output.result.ok, false);
    if (!output.result.ok && action === cases[0]) {
      assert.equal(output.result.code, 'invalid');
      assert.match(output.result.error, /24:00|midnight|північ/i);
    }
    if (!output.result.ok && action === cases[1]) {
      assert.equal(output.result.code, 'invalid');
      assert.match(output.result.error, /start|почат/i);
    }
  }
  const midnight = success(before, { type: 'plan_day', start: '23:30', items: [{ title: 'До опівночі', durationMinutes: 30 }] }, planContext());
  assert.equal(schedule(midnight.result)[0].end, '24:00');
});

test('plan_day default start is the next quarter hour in the context time zone and defaults date locally', () => {
  const action: AgentAction = { type: 'plan_day', items: [{ title: 'Почати', durationMinutes: 30 }] };
  const output = success(planWorkspace({ tasks: [] }), action, planContext());
  assert.equal(schedule(output.result)[0].start, '10:15');
  assert.equal(output.workspace.tasks[0].plannedDate, '2026-10-19');
  assert.equal(output.workspace.tasks[0].scheduledFor, Date.parse('2026-10-19T07:15:00Z'));
  const nextDate = success(planWorkspace({ tasks: [] }), action, planContext({ now: Date.parse('2026-10-19T21:07:04Z') }));
  assert.equal(nextDate.workspace.tasks[0].plannedDate, '2026-10-20');
  assert.equal(schedule(nextDate.result)[0].start, '00:15');
});

test('plan_day undo removes every created task and restores the existing task schedule, tab, priority and countdown', () => {
  const before = planWorkspace({ tasks: [task({ plannedDate: '2026-10-18', scheduledFor: Date.parse('2026-10-18T09:00:00Z'),
    timerMode: 'countdown', countdownDurationSeconds: 900, countdownRemainingSeconds: 600, timerRunning: false, note: 'До планування' })] });
  const after = success(before, { type: 'plan_day', start: '13:00', items: [
    { title: 'Жалюзі', durationMinutes: 60 },
    { taskId: 'task-1', durationMinutes: 300, phase: 'Навчання', priority: 1, note: 'Новий план' },
    { title: 'Відпочинок', durationMinutes: 30, priority: 3 },
  ] }, planContext());
  const snapshot = captureAgentUndo(before, after.workspace, after.result.changedTaskIds);
  assert.equal(snapshot.tasks.length, 3);
  const undone = undoAgentTurn(after.workspace, snapshot);
  assert.equal(undone.undone, true);
  assert.deepEqual(undone.conflicts, []);
  assert.equal(undone.workspace.tasks.length, 1);
  const stripAudit = (value: PSTask) => {
    const copy = { ...value };
    for (const field of ['timeSpentSeconds', 'timeSessions', 'updatedAt', 'activityTrail'] as const) delete copy[field];
    return copy;
  };
  assert.deepEqual(undone.workspace.tasks.map(stripAudit), before.tasks.map(stripAudit));
  assert.deepEqual(undone.workspace.tabs, before.tabs);
  assert.deepEqual(undone.workspace.notes, before.notes);
  assert.deepEqual(undone.workspace.deletedTasks, before.deletedTasks);
});

test('create_task and update_task timed fields keep tasks visible, paused and on the correct local date', () => {
  const ctx = planContext();
  const created = success(planWorkspace({ tasks: [] }), { type: 'create_task', title: 'Друк', startTime: '14:00', durationMinutes: 30, phase: 'Навчання' }, ctx);
  const value = created.workspace.tasks[0];
  assert.equal(value.plannedDate, '2026-10-19');
  assert.equal(value.scheduledFor, Date.parse('2026-10-19T11:00:00Z'));
  assert.equal(value.scheduledPending, false);
  assert.equal(value.schedule, undefined);
  assertPaused(value, 30);
  const updated = success(created.workspace, { type: 'update_task', taskId: value.id, date: '2026-10-20', startTime: '09:30', durationMinutes: 45 }, ctx);
  assert.equal(updated.workspace.tasks[0].plannedDate, '2026-10-20');
  assert.equal(updated.workspace.tasks[0].scheduledFor, Date.parse('2026-10-20T06:30:00Z'));
  assertPaused(updated.workspace.tasks[0], 45);
  const cleared = success(updated.workspace, { type: 'update_task', taskId: value.id, clearTime: true }, ctx);
  assert.equal(cleared.workspace.tasks[0].scheduledFor, undefined);
  assert.equal(cleared.workspace.tasks[0].plannedDate, '2026-10-20');
  assertPaused(cleared.workspace.tasks[0], 45);
  const today = success(updated.workspace, { type: 'update_task', taskId: value.id, startTime: '12:00' }, ctx);
  assert.equal(today.workspace.tasks[0].plannedDate, '2026-10-19');
  assert.equal(today.workspace.tasks[0].scheduledFor, Date.parse('2026-10-19T09:00:00Z'));
});

test('durationMinutes alone configures a paused countdown without inventing a scheduled hour', () => {
  const created = success(planWorkspace({ tasks: [] }), { type: 'create_task', title: 'Без години', durationMinutes: 25 }, planContext());
  assertPaused(created.workspace.tasks[0], 25);
  assert.equal(created.workspace.tasks[0].scheduledFor, undefined);
  const updated = success(planWorkspace(), { type: 'update_task', taskId: 'task-1', durationMinutes: 40 }, planContext());
  assertPaused(updated.workspace.tasks[0], 40);
  assert.equal(updated.workspace.tasks[0].scheduledFor, undefined);
  const dated = success(planWorkspace(), { type: 'update_task', taskId: 'task-1', date: '2026-10-21' }, planContext());
  assert.equal(dated.workspace.tasks[0].plannedDate, '2026-10-21');
  assert.equal(dated.workspace.tasks[0].scheduledFor, undefined);
});

test('setting a time refuses done or running tasks and keeps plannedDate at or before the deadline', () => {
  for (const original of [task({ done: true }), task({ timerRunning: true, timerStartedAt: PLAN_NOW - 60_000 })]) {
    const before = planWorkspace({ tasks: [original] });
    for (const action of [
      { type: 'update_task', taskId: 'task-1', startTime: '14:00', durationMinutes: 30 },
      { type: 'plan_day', start: '14:00', items: [{ title: 'Спочатку нова', durationMinutes: 10 }, { taskId: 'task-1', durationMinutes: 30 }] },
    ] as AgentAction[]) {
      const output = apply(before, action, planContext());
      assert.equal(output.result.ok, false);
      assert.equal(output.workspace, before);
    }
  }
  const before = planWorkspace({ tasks: [task({ deadlineDate: '2026-10-20' })] });
  for (const action of [
    { type: 'create_task', title: 'Пізно', date: '2026-10-21', startTime: '10:00', deadlineDate: '2026-10-20' },
    { type: 'update_task', taskId: 'task-1', date: '2026-10-21', startTime: '10:00' },
    { type: 'plan_day', date: '2026-10-21', start: '10:00', items: [{ taskId: 'task-1', durationMinutes: 30 }] },
  ] as AgentAction[]) {
    const output = apply(before, action, planContext());
    assert.equal(output.result.ok, false);
    assert.equal(output.workspace, before);
    if (!output.result.ok) assert.equal(output.result.code, 'invalid');
  }
});

test('phase accepts ids, normalized names and typos while ambiguity and unknown tabs list candidates', () => {
  for (const phase of ['learn', '  НАВЧАННЯ  ', 'Навчаня']) {
    const created = success(planWorkspace({ tasks: [] }), { type: 'create_task', title: 'Друк', phase }, planContext());
    assert.equal(created.workspace.tasks[0].phase, 'learn');
    const updated = success(planWorkspace(), { type: 'update_task', taskId: 'task-1', phase }, planContext());
    assert.equal(updated.workspace.tasks[0].phase, 'learn');
  }
  const spaced = planWorkspace({ tabs: [{ id: 'learn', name: 'Навчання та курси' }] });
  assert.equal(success(spaced, { type: 'create_task', title: 'Друк', phase: ' навчання  та  КУРСИ ' }, planContext()).workspace.tasks[0].phase, 'learn');
  const ambiguous = planWorkspace({ tabs: [{ id: 'a', name: 'Навчання друку' }, { id: 'b', name: 'Навчання курсів' }] });
  for (const [before, phase] of [[ambiguous, 'Навчання'], [planWorkspace(), 'Невідома']] as const) {
    const output = apply(before, { type: 'create_task', title: 'Друк', phase }, planContext());
    assert.equal(output.result.ok, false);
    assert.equal(output.workspace, before);
    if (!output.result.ok) for (const tab of before.tabs) assert.ok(output.result.error.includes(tab.id + ' — ' + tab.name), output.result.error);
  }
  const noTabs = planWorkspace({ tabs: [] });
  const output = apply(noTabs, { type: 'create_task', title: 'Друк', phase: 'Навчання' }, planContext());
  assert.equal(output.result.ok, false);
  if (!output.result.ok) assert.match(output.result.error, /none: omit phase/);
});

test('timed conversion follows context time zone and Kyiv DST transition dates', () => {
  for (const [date, startTime, expected] of [
    ['2026-03-29', '01:30', '2026-03-28T23:30:00Z'],
    ['2026-03-29', '04:30', '2026-03-29T01:30:00Z'],
    ['2026-10-25', '04:30', '2026-10-25T02:30:00Z'],
  ]) {
    const output = success(planWorkspace({ tasks: [] }), { type: 'create_task', title: 'DST', date, startTime, durationMinutes: 30 }, planContext());
    assert.equal(output.workspace.tasks[0].scheduledFor, Date.parse(expected));
    assert.equal(output.workspace.tasks[0].plannedDate, date);
  }
  const missingHour = planWorkspace({ tasks: [] });
  const refused = apply(missingHour, { type: 'create_task', title: 'Пропущена година', date: '2026-03-29', startTime: '03:30' }, planContext());
  assert.equal(refused.workspace, missingHour);
  assert.equal(refused.result.ok, false);
  if (!refused.result.ok) assert.equal(refused.result.code, 'invalid');
  const tokyo = success(planWorkspace({ tasks: [] }), { type: 'create_task', title: 'Токіо', startTime: '09:00', durationMinutes: 30 }, planContext({ now: Date.parse('2026-10-19T18:07:00Z'), timeZone: 'Asia/Tokyo' }));
  assert.equal(tokyo.workspace.tasks[0].plannedDate, '2026-10-20');
  assert.equal(tokyo.workspace.tasks[0].scheduledFor, Date.parse('2026-10-20T00:00:00Z'));
  const fallback = success(planWorkspace({ tasks: [] }), { type: 'create_task', title: 'Київ', date: '2026-10-19', startTime: '14:00' }, planContext({ timeZone: undefined }));
  assert.equal(fallback.workspace.tasks[0].scheduledFor, Date.parse('2026-10-19T11:00:00Z'));
});

test('describeTask returns scheduled date, start and countdown end in the requested time zone', () => {
  const original = freeze(task({ scheduledFor: Date.parse('2026-10-19T11:00:00Z'), plannedDate: '2026-10-19',
    countdownDurationSeconds: 1800, countdownRemainingSeconds: 600, timerMode: 'countdown' }));
  const before = structuredClone(original);
  const description = describeTask(original, PLAN_NOW);
  assert.equal(description.date, '2026-10-19');
  assert.equal(description.startTime, '14:00');
  assert.equal(description.endTime, '14:30');
  const tokyo = describeTask(original, PLAN_NOW, 'Asia/Tokyo');
  assert.equal(tokyo.startTime, '20:00');
  assert.equal(tokyo.endTime, '20:30');
  assert.deepEqual(original, before);
});

test('timed and plan_day schemas validate every new field and keep unexpected argument rejection strict', () => {
  const valid: AgentAction[] = [
    { type: 'create_task', title: 'Нова', date: '2026-10-19', startTime: '00:00', durationMinutes: 1 },
    { type: 'update_task', taskId: 'task-1', startTime: '23:59', durationMinutes: 1440 },
    { type: 'update_task', taskId: 'task-1', clearTime: true },
    { type: 'plan_day', date: '2026-10-19', start: '12:30', items: [{ taskId: 'task-1', durationMinutes: 150, fixedStart: '13:30', estimated: true, breakAfterMinutes: 5, phase: 'Навчання', priority: 1, note: 'План', steps: ['Крок'] }] },
    { type: 'plan_day', items: Array.from({ length: 20 }, (_, index) => ({ title: 'Блок ' + index, durationMinutes: 1 })) },
  ];
  for (const action of valid) assert.deepEqual(validateAgentAction(action), action);
  const invalid: unknown[] = [
    { type: 'create_task', title: 'Нова', date: '2026-02-30' },
    ...['24:00', '9:30', '12:60', '-1:00', '12:30:00', '', 930].map(startTime => ({ type: 'create_task', title: 'Нова', startTime })),
    ...[0, -1, 1441, Infinity, '30'].map(durationMinutes => ({ type: 'update_task', taskId: 'task-1', durationMinutes })),
    { type: 'update_task', taskId: 'task-1', clearTime: false },
    { type: 'update_task', taskId: 'task-1', clearTime: 'true' },
    { type: 'plan_day', items: [] }, { type: 'plan_day', items: Array(1) },
    { type: 'plan_day', items: Array.from({ length: 21 }, () => ({ title: 'Нова', durationMinutes: 1 })) },
    { type: 'plan_day', items: [{ durationMinutes: 30 }] },
    { type: 'plan_day', items: [{ taskId: 'task-1', title: 'Нова', durationMinutes: 30 }] },
    { type: 'plan_day', items: [{ title: 'Нова' }] },
    { type: 'plan_day', items: [{ title: 'Нова', durationMinutes: 30, fixedStart: '24:00' }] },
    { type: 'plan_day', items: [{ title: 'Нова', durationMinutes: 30, estimated: 'true' }] },
    { type: 'plan_day', items: [{ title: 'Нова', durationMinutes: 30, breakAfterMinutes: -1 }] },
    { type: 'plan_day', items: [{ title: 'Нова', durationMinutes: 30, priority: 4 }] },
    { type: 'plan_day', items: [{ title: 'Нова', durationMinutes: 30, steps: [''] }] },
    { type: 'plan_day', date: '2026-02-30', items: [{ title: 'Нова', durationMinutes: 30 }] },
    { type: 'plan_day', start: '25:00', items: [{ title: 'Нова', durationMinutes: 30 }] },
  ];
  for (const value of invalid) assert.ok('error' in validateAgentAction(value), JSON.stringify(value));
  for (const value of [
    { type: 'create_task', title: 'Нова', fixedStart: '14:00' },
    { type: 'update_task', taskId: 'task-1', clearTime: true, extra: undefined },
    { type: 'plan_day', items: [{ title: 'Нова', durationMinutes: 30 }], extra: true },
    { type: 'plan_day', items: [{ title: 'Нова', durationMinutes: 30, extra: true }] },
  ]) {
    const result = validateAgentAction(value);
    assert.ok('error' in result);
    if ('error' in result) assert.match(result.error, /Unexpected argument/);
  }
});

test('duration-only and plan_day countdown updates replay the complete createdIds sequence on the client', () => {
  const before = planWorkspace({ tasks: [task({ timerMode: 'countdown', countdownDurationSeconds: 900,
    countdownRemainingSeconds: 600, timerRunning: false })] });
  const actions: AgentAction[] = [
    { type: 'update_task', taskId: 'task-1', durationMinutes: 45 },
    { type: 'plan_day', start: '10:00', items: [
      { title: 'Планування', durationMinutes: 30, steps: ['Ідея', 'Сценарій'] },
      { taskId: 'task-1', durationMinutes: 300 },
    ] },
  ];
  for (const action of actions) {
    const server = success(before, action, planContext());
    assert.ok(server.result.createdIds?.length);
    const ids = [...server.result.createdIds!];
    let used = 0;
    const client = success(before, action, planContext({ newId: () => {
      assert.ok(used < ids.length, 'every generated id must be returned for client replay');
      return ids[used++];
    } }));
    assert.equal(used, ids.length);
    assert.deepEqual(client.workspace, server.workspace);
    assert.deepEqual(client.result, server.result);
  }
});

test('plan_day preflight errors consume no generated ids, including errors in a later item', () => {
  const before = planWorkspace();
  const actions: AgentAction[] = [
    { type: 'plan_day', start: '13:00', items: [
      { title: 'Нова справа', durationMinutes: 60 }, { title: 'Друк', durationMinutes: 30, fixedStart: '13:30' },
    ] },
    { type: 'plan_day', start: '10:00', items: [
      { title: 'Нова справа', durationMinutes: 30 }, { taskId: 'missing', durationMinutes: 30 },
    ] },
    { type: 'plan_day', start: '10:00', items: [
      { title: 'Нова справа', durationMinutes: 30 }, { taskId: 'task-1', phase: 'unknown', durationMinutes: 30 },
    ] },
  ];
  for (const action of actions) {
    let generated = 0;
    const output = apply(before, action, planContext({ newId: () => 'preflight-' + ++generated }));
    assert.equal(output.result.ok, false);
    assert.equal(output.workspace, before);
    assert.equal(generated, 0);
  }
});

test('planned countdowns preserve historical sessions and startedAt without recording a temporary session', () => {
  const original = task({ startedAt: PLAN_NOW - 86400000, timeSpentSeconds: 40,
    timerMode: 'countdown', countdownDurationSeconds: 900, countdownRemainingSeconds: 600, timerRunning: false,
    timeSessions: { historical: { seconds: 40 } } });
  const before = planWorkspace({ tasks: [original] });
  for (const action of [
    { type: 'update_task', taskId: 'task-1', durationMinutes: 45 },
    { type: 'update_task', taskId: 'task-1', startTime: '14:00', durationMinutes: 30 },
    { type: 'plan_day', start: '14:00', items: [{ taskId: 'task-1', durationMinutes: 300 }] },
  ] as AgentAction[]) {
    const output = success(before, action, planContext());
    const value = output.workspace.tasks[0];
    assert.equal(value.startedAt, original.startedAt);
    assert.equal(value.timeSpentSeconds, 40);
    assert.deepEqual(value.timeSessions, original.timeSessions);
    assert.equal(value.timerRunning, false);
    assert.equal(value.timerSessionId, undefined);
  }
  const created = success(planWorkspace({ tasks: [] }), { type: 'create_task', title: 'Новий відлік', startTime: '14:00', durationMinutes: 30 }, planContext());
  assert.deepEqual(Object.keys(created.workspace.tasks[0].timeSessions ?? {}), []);
});

test('Kyiv repeated DST hour uses the first occurrence and day plans reject blocks crossing a clock change', () => {
  const repeated = success(planWorkspace({ tasks: [] }), { type: 'create_task', title: 'Повторена година', date: '2026-10-25', startTime: '03:30', durationMinutes: 15 }, planContext());
  assert.equal(repeated.workspace.tasks[0].scheduledFor, Date.parse('2026-10-25T00:30:00Z'));
  const before = planWorkspace();
  let generated = 0;
  const crossing = apply(before, { type: 'plan_day', date: '2026-03-29', start: '02:30', items: [
    { taskId: 'task-1', durationMinutes: 120 },
  ] }, planContext({ newId: () => 'dst-' + ++generated }));
  assert.equal(crossing.workspace, before);
  assert.equal(crossing.result.ok, false);
  if (!crossing.result.ok) {
    assert.equal(crossing.result.code, 'invalid');
    assert.match(crossing.result.error, /DST/);
  }
  assert.equal(generated, 0);
});


test('expired start_timer credits the gap and resumes for 30 minutes with replayable ids', () => {
  const now = Date.parse('2026-10-19T13:05:00Z'), expiredAt = now - 35 * 60000;
  const original = task({ timerMode: 'countdown', countdownDurationSeconds: 3600, countdownRemainingSeconds: 0,
    timerRunning: false, startedAt: expiredAt - 3600000, timeSpentSeconds: 3600, countdownExpiredAt: expiredAt });
  const ws = workspace({ tasks: [original] });
  const output = success(ws, { type: 'start_timer', taskId: original.id }, context({ now }));
  const changed = output.workspace.tasks[0];
  assert.equal(changed.timeSpentSeconds, 5700);
  assert.equal(changed.countdownRemainingSeconds, 1800);
  assert.equal(changed.countdownDurationSeconds, 5400);
  assert.equal(changed.timerRunning, true);
  assert.equal(changed.countdownExpiredAt, undefined);
  assert.equal((output.result.data as { creditedMinutes: number }).creditedMinutes, 35);
  assert.match(output.result.summary.uk, /35 хв/);
  const ids = [...output.result.createdIds!];
  assert.ok(ids.length);
  const replay = success(ws, { type: 'start_timer', taskId: original.id }, context({ now, newId: () => ids.shift()! }));
  assert.deepEqual(replay.workspace, output.workspace);
  assert.equal(ids.length, 0);
});

test('continue_after_expiry supports a chosen extension and refuses unconfirmed long gaps', () => {
  const now = Date.parse('2026-10-19T13:05:00Z');
  const expired = task({ timerMode: 'countdown', countdownDurationSeconds: 3600, countdownRemainingSeconds: 0,
    timeSpentSeconds: 3600, countdownExpiredAt: now - 600000 });
  const output = success(workspace({ tasks: [expired] }), { type: 'continue_after_expiry', taskId: expired.id, extendMinutes: 15 }, context({ now }));
  assert.equal(output.workspace.tasks[0].timeSpentSeconds, 4200);
  assert.equal(output.workspace.tasks[0].countdownRemainingSeconds, 900);
  for (const type of ['start_timer', 'continue_after_expiry'] as const) {
    const ws = workspace({ tasks: [{ ...expired, countdownExpiredAt: now - 181 * 60000 }] });
    const rejected = apply(ws, { type, taskId: expired.id }, context({ now }));
    assert.equal(rejected.workspace, ws);
    assert.equal(rejected.result.ok, false);
    if (!rejected.result.ok) assert.match(rejected.result.error, /3 hours/);
  }
  const longGap = workspace({ tasks: [{ ...expired, countdownExpiredAt: now - 181 * 60000 }] });
  const explicit = success(longGap, { type: 'set_recorded_time', taskId: expired.id, minutes: 150 }, context({ now }));
  assert.equal(explicit.workspace.tasks[0].countdownExpiredAt, undefined);
  assert.equal(explicit.workspace.tasks[0].timeSpentSeconds, 9000);
});

test('finish_after_expiry resolves local finish time and keeps completion separate', () => {
  const now = Date.parse('2026-10-19T13:30:00Z');
  const expired = task({ timerMode: 'countdown', countdownDurationSeconds: 3600, countdownRemainingSeconds: 0,
    timeSpentSeconds: 3600, countdownExpiredAt: Date.parse('2026-10-19T12:30:00Z') });
  const ws = workspace({ tasks: [expired] });
  const output = success(ws, { type: 'finish_after_expiry', taskId: expired.id, workedUntil: '16:10' }, context({ now }));
  assert.equal(output.workspace.tasks[0].timeSpentSeconds, 6000);
  assert.equal(output.workspace.tasks[0].done, false);
  assert.equal(output.workspace.tasks[0].timerRunning, undefined);
  assert.equal(output.workspace.tasks[0].countdownExpiredAt, undefined);
  assert.equal((output.result.data as { creditedMinutes: number }).creditedMinutes, 40);
  const dismissed = success(ws, { type: 'finish_after_expiry', taskId: expired.id }, context({ now }));
  assert.equal(dismissed.workspace.tasks[0].timeSpentSeconds, 3600);
  assert.equal(dismissed.workspace.tasks[0].countdownExpiredAt, undefined);
  const future = apply(ws, { type: 'finish_after_expiry', taskId: expired.id, workedUntil: '16:45' }, context({ now }));
  assert.equal(future.result.ok, false);
  assert.equal(future.workspace, ws);
});

test('finish_after_expiry handles an overnight finish in the expiry time zone', () => {
  const now = Date.parse('2026-10-19T22:00:00Z');
  const expired = task({ timerMode: 'countdown', countdownDurationSeconds: 3600, countdownRemainingSeconds: 0,
    timeSpentSeconds: 3600, countdownExpiredAt: Date.parse('2026-10-19T20:30:00Z') });
  const result = success(workspace({ tasks: [expired] }), { type: 'finish_after_expiry', taskId: expired.id, workedUntil: '00:10' }, context({ now }));
  assert.equal(result.workspace.tasks[0].timeSpentSeconds, 6000);
});

test('shift_day uses the delayed block by default, reports overflow and supports exact undo', () => {
  const now = Date.parse('2026-10-19T13:05:00Z');
  const current = task({ scheduledFor: Date.parse('2026-10-19T11:30:00Z'), timerMode: 'countdown', countdownDurationSeconds: 3600,
    countdownRemainingSeconds: 0, countdownExpiredAt: Date.parse('2026-10-19T12:30:00Z'), timeSpentSeconds: 3600 });
  const following = task({ id: 'next', scheduledFor: Date.parse('2026-10-19T12:30:00Z'), timerMode: 'countdown', countdownDurationSeconds: 1800 });
  const late = task({ id: 'late', scheduledFor: Date.parse('2026-10-19T20:00:00Z'), timerMode: 'countdown', countdownDurationSeconds: 3600 });
  const ws = workspace({ tasks: [current, following, late] });
  const output = success(ws, { type: 'shift_day', minutes: 35 }, context({ now }));
  assert.equal(output.workspace.tasks[0].scheduledFor, current.scheduledFor);
  assert.equal(output.workspace.tasks[1].scheduledFor, following.scheduledFor! + 35 * 60000);
  assert.equal(output.workspace.tasks[1].countdownDurationSeconds, 1800);
  assert.equal(output.workspace.tasks[2].scheduledFor, late.scheduledFor);
  assert.deepEqual(output.result.changedTaskIds, ['next']);
  assert.deepEqual((output.result.data as { overflowTaskIds: string[] }).overflowTaskIds, ['late']);
  assert.match(output.result.summary.uk, /Не вміщається/);
  const restored = undoAgentTurn(output.workspace, captureAgentUndo(ws, output.workspace));
  assert.equal(restored.undone, true);
  assert.deepEqual(restored.workspace.tasks.map(task => task.scheduledFor), ws.tasks.map(task => task.scheduledFor));
  const boundary = success(ws, { type: 'shift_day', minutes: 10, fromTime: '23:00' }, context({ now }));
  assert.equal(boundary.workspace.tasks[1].scheduledFor, following.scheduledFor);
  assert.equal(boundary.workspace.tasks[2].scheduledFor, late.scheduledFor);
});

test('expiry and shift schemas reject malformed minutes, clock strings and extra arguments', () => {
  for (const action of [
    { type: 'continue_after_expiry', taskId: 'task-1', extendMinutes: 0 },
    { type: 'continue_after_expiry', taskId: 'task-1', extendMinutes: 1.5 },
    { type: 'continue_after_expiry', taskId: 'task-1', workedUntil: '16:10' },
    { type: 'finish_after_expiry', taskId: 'task-1', workedUntil: '24:00' },
    { type: 'finish_after_expiry', taskId: 'task-1', workedUntil: 16 },
    { type: 'shift_day', minutes: 0 }, { type: 'shift_day', minutes: 30, fromTime: '9:00' },
    { type: 'shift_day', minutes: 30, taskId: 'task-1' },
  ]) assert.ok('error' in validateAgentAction(action), JSON.stringify(action));
  for (const action of [
    { type: 'continue_after_expiry', taskId: 'task-1', extendMinutes: 15 },
    { type: 'finish_after_expiry', taskId: 'task-1', workedUntil: '16:10' },
    { type: 'shift_day', minutes: 35, fromTime: '15:30' },
  ]) assert.deepEqual(validateAgentAction(action), action);
});


test('start_timer at an unprocessed zero crossing credits from the actual expiry instead of resetting', () => {
  const now = Date.parse('2026-10-19T13:05:00Z');
  const original = task({ timerMode: 'countdown', countdownDurationSeconds: 3600, countdownRemainingSeconds: 3600,
    timerRunning: true, timerStartedAt: now - 95 * 60000, timeSpentSeconds: 0 });
  const output = success(workspace({ tasks: [original] }), { type: 'start_timer', taskId: original.id }, context({ now }));
  assert.equal(output.workspace.tasks[0].timeSpentSeconds, 5700);
  assert.equal(output.workspace.tasks[0].countdownRemainingSeconds, 1800);
  assert.equal((output.result.data as { creditedMinutes: number }).creditedMinutes, 35);
});

test('an explicit long finish records at most three hours and reports the cap', () => {
  const now = Date.parse('2026-10-19T15:30:00Z');
  const expired = task({ timerMode: 'countdown', countdownDurationSeconds: 3600, countdownRemainingSeconds: 0,
    timeSpentSeconds: 3600, countdownExpiredAt: Date.parse('2026-10-19T11:00:00Z') });
  const output = success(workspace({ tasks: [expired] }), { type: 'finish_after_expiry', taskId: expired.id, workedUntil: '18:00' }, context({ now }));
  assert.equal(output.workspace.tasks[0].timeSpentSeconds, 14400);
  assert.equal((output.result.data as { creditedMinutes: number }).creditedMinutes, 180);
  assert.equal((output.result.data as { creditCapped: boolean }).creditCapped, true);
  assert.match(output.result.summary.uk, /межа дорахунку/);
});


test('explicit replanning updates fixed block duration while preserving first-estimate telemetry', () => {
  const now = Date.parse('2026-10-19T13:05:00Z');
  const original = task({ timerMode: 'countdown', countdownDurationSeconds: 7200, plannedDurationSeconds: 7200,
    countdownRemainingSeconds: 7200, timerRunning: false });
  const replan = (value: PSTask) => success(workspace({ tasks: [value] }), { type: 'plan_day', date: '2026-10-19', start: '14:30',
    items: [{ taskId: value.id, durationMinutes: 60 }] }, context({ now }));
  const planned = replan(original).workspace.tasks[0];
  assert.equal(planned.plannedDurationSeconds, 7200);
  assert.equal(planned.scheduledDurationSeconds, 3600);
  assert.equal(describeTask(planned, now).endTime, '15:30');
  const started = replan({ ...original, startedAt: now - 600000, timeSpentSeconds: 60 }).workspace.tasks[0];
  assert.equal(started.plannedDurationSeconds, 7200);
  assert.equal(started.scheduledDurationSeconds, 3600);
  assert.equal(describeTask(started, now).endTime, '15:30');
});

test('continuation keeps the original scheduled end and supports a consumed 24-hour countdown', () => {
  const now = Date.parse('2026-10-19T13:05:00Z');
  const expired = task({ scheduledFor: Date.parse('2026-10-19T11:30:00Z'), timerMode: 'countdown', countdownDurationSeconds: 3600,
    countdownRemainingSeconds: 0, countdownExpiredAt: Date.parse('2026-10-19T12:30:00Z'), timeSpentSeconds: 3600 });
  const continued = success(workspace({ tasks: [expired] }), { type: 'continue_after_expiry', taskId: expired.id }, context({ now }));
  assert.equal(describeTask(continued.workspace.tasks[0], now).endTime, '15:30');
  const fullDay = { ...expired, countdownDurationSeconds: 86400 };
  const extended = success(workspace({ tasks: [fullDay] }), { type: 'continue_after_expiry', taskId: fullDay.id }, context({ now }));
  assert.equal(extended.workspace.tasks[0].timerRunning, true);
  assert.equal(extended.workspace.tasks[0].countdownRemainingSeconds, 1800);
  assert.equal(extended.workspace.tasks[0].timeSpentSeconds, 5700);
});


test('timed create and update retain fixed durations independently from countdown extensions and clearTime removes them', () => {
  const now = Date.parse('2026-10-19T13:05:00Z'), ctx = context({ now });
  const created = success(workspace({ tasks: [] }), { type: 'create_task', title: 'Блок', date: '2026-10-19', startTime: '16:30', durationMinutes: 60 }, ctx);
  const original = created.workspace.tasks[0];
  assert.equal(original.scheduledDurationSeconds, 3600);
  const extended = success(created.workspace, { type: 'extend_countdown', taskId: original.id, minutes: 30 }, ctx);
  assert.equal(extended.workspace.tasks[0].countdownDurationSeconds, 5400);
  assert.equal(extended.workspace.tasks[0].scheduledDurationSeconds, 3600);
  assert.equal(describeTask(extended.workspace.tasks[0], now).endTime, '17:30');
  const replanned = success(extended.workspace, { type: 'update_task', taskId: original.id, durationMinutes: 45 }, ctx);
  assert.equal(replanned.workspace.tasks[0].scheduledDurationSeconds, 2700);
  assert.equal(replanned.workspace.tasks[0].plannedDurationSeconds, 3600);
  assert.equal(describeTask(replanned.workspace.tasks[0], now).endTime, '17:15');
  const cleared = success(replanned.workspace, { type: 'update_task', taskId: original.id, clearTime: true }, ctx);
  assert.equal(cleared.workspace.tasks[0].scheduledFor, undefined);
  assert.equal(cleared.workspace.tasks[0].scheduledDurationSeconds, undefined);
  assert.equal(cleared.workspace.tasks[0].plannedDate, '2026-10-19');
});


test('replan_day schedules missed and paused blocks, preserves work and has schedule-aware undo', () => {
  const now = Date.parse('2026-10-19T15:30:00Z');
  const missed = task({ id: 'missed', title: 'Спланувати анімацію', scheduledFor: Date.parse('2026-10-19T12:30:00Z'),
    timerMode: 'countdown', countdownDurationSeconds: 1800, countdownRemainingSeconds: 1800, scheduledDurationSeconds: 1800 });
  const paused = task({ scheduledFor: Date.parse('2026-10-19T13:00:00Z'), startedAt: Date.parse('2026-10-19T13:00:00Z'),
    timerMode: 'countdown', timerRunning: false, countdownDurationSeconds: 21600, countdownRemainingSeconds: 18000,
    scheduledDurationSeconds: 21600, steps: 6, currentStep: 3, timeSpentSeconds: 3600, timeSessions: { work: { seconds: 3600 } } });
  const overflow = task({ id: 'typing', title: 'Навчання друку', scheduledFor: Date.parse('2026-10-19T19:00:00Z'),
    scheduledDurationSeconds: 1800, timerMode: 'countdown', countdownDurationSeconds: 1800 });
  const ws = workspace({ tasks: [missed, paused, overflow] });
  const output = success(ws, { type: 'replan_day' }, context({ now }));
  const [first, second, third] = output.workspace.tasks;
  assert.equal(first.scheduledFor, now);
  assert.equal(second.scheduledFor, now + 1800000);
  assert.equal(second.scheduledDurationSeconds, 18000);
  assert.equal(second.countdownDurationSeconds, paused.countdownDurationSeconds);
  assert.equal(second.countdownRemainingSeconds, paused.countdownRemainingSeconds);
  assert.equal(second.timeSpentSeconds, paused.timeSpentSeconds);
  assert.deepEqual(second.timeSessions, paused.timeSessions);
  assert.equal(second.currentStep, 3);
  assert.equal(third, overflow);
  assert.deepEqual(output.result.changedTaskIds, ['missed', 'task-1']);
  assert.deepEqual((output.result.data as { overflowTaskIds: string[] }).overflowTaskIds, ['typing']);
  assert.match(output.result.summary.uk, /18:30–19:00 · Спланувати анімацію\n19:00–24:00 · Робота над анімацією/);
  assert.match(output.result.summary.uk, /Не вміщається сьогодні: Навчання друку/);
  const undone = undoAgentTurn(output.workspace, captureAgentUndo(ws, output.workspace));
  assert.equal(undone.undone, true);
  assert.deepEqual(undone.workspace.tasks.map(task => [task.scheduledFor, task.scheduledDurationSeconds]), ws.tasks.map(task => [task.scheduledFor, task.scheduledDurationSeconds]));
  const later = success(ws, { type: 'replan_day', from: '19:00' }, context({ now }));
  assert.equal(later.workspace.tasks[0].scheduledFor, now + 1800000);
});

test('shift_day can recover missed and paused blocks when the explicit shift reaches now', () => {
  const now = Date.parse('2026-10-19T15:30:00Z');
  const original = task({ scheduledFor: now - 30 * 60000, scheduledDurationSeconds: 1800,
    timerMode: 'countdown', countdownDurationSeconds: 1800, countdownRemainingSeconds: 900, startedAt: now - 20 * 60000,
    timerRunning: false, timeSpentSeconds: 900 });
  const ws = workspace({ tasks: [original] });
  const shifted = success(ws, { type: 'shift_day', minutes: 30 }, context({ now }));
  assert.equal(shifted.workspace.tasks[0].scheduledFor, now);
  assert.equal(shifted.workspace.tasks[0].timeSpentSeconds, 900);
  assert.equal(shifted.workspace.tasks[0].countdownRemainingSeconds, 900);
  const missed = success(workspace({ tasks: [{ ...original, startedAt: undefined }] }), { type: 'shift_day', minutes: 30 }, context({ now }));
  assert.equal(missed.workspace.tasks[0].scheduledFor, now);
  const tooSmall = success(ws, { type: 'shift_day', minutes: 5 }, context({ now }));
  assert.equal(tooSmall.workspace.tasks[0].scheduledFor, original.scheduledFor);
});

test('replan_day validates its optional local start and rejects unrelated arguments', () => {
  for (const action of [{ type: 'replan_day' }, { type: 'replan_day', from: '18:30' }]) assert.deepEqual(validateAgentAction(action), action);
  for (const action of [{ type: 'replan_day', from: '24:00' }, { type: 'replan_day', from: '9:00' },
    { type: 'replan_day', minutes: 30 }, { type: 'replan_day', fromTime: '18:30' }]) assert.ok('error' in validateAgentAction(action));
});
