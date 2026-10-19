import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PSTask } from '../types';
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
