import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Plus, X } from 'lucide-react';
import type { GrowthSkill, NewTaskInput, PSTask, TaskTab } from '../../types';
import type { QuickAddPrefill } from '../QuickAddDrawer';
import { useDialogKeyboard } from '../useDialogKeyboard';
import { isTaskDate } from '../../utils/taskDates';
import { materializeStepList } from '../../utils/taskOperations';
import { getTaskTimerMode } from '../../utils/taskTimer';
import { normalizeTaskSchedule } from '../../utils/taskScheduling';
import './taskEditor.css';

export type TaskEditPatch = Partial<Pick<PSTask, 'title' | 'note' | 'phase' | 'priority' | 'plannedDate' | 'deadlineDate' | 'completedAt' | 'timerMode' | 'countdownDurationSeconds' | 'skillId' | 'subskillId' | 'stepList' | 'steps' | 'schedule'>>;
interface Props {
  ownerId: string | null; task?: PSTask; prefill?: QuickAddPrefill;
  tabs: TaskTab[]; skills: GrowthSkill[]; lang: 'uk' | 'en';
  onClose: () => void;
  onCreate: (input: NewTaskInput, category?: string) => boolean | PSTask;
  /** Return the confirmed task snapshot, or false without applying any part of the patch. */
  onPatch: (id: string, patch: TaskEditPatch, expected: TaskEditPatch) => boolean | PSTask;
  onReopenTask?: (id: string) => void | boolean;
  onRecordResult?: (id: string) => void | boolean;
}
interface Draft {
  title: string; note: string; phase: string; priority: 1 | 2 | 3;
  plannedDate: string; deadlineDate: string; timerMode: 'none' | 'stopwatch' | 'countdown';
  minutes: string; skillId: string; subskillId: string; steps: string; completedAt: string;
  scheduleOn: boolean; scheduleAt: string; scheduleRecurrence: 'once' | 'daily'; scheduleLead: string; scheduleTimeZone: string;
}
const DRAFT_FIELDS = {
  title: ['title'], note: ['note'], phase: ['phase'], priority: ['priority'],
  dates: ['plannedDate', 'deadlineDate'], timer: ['timerMode', 'minutes'],
  skill: ['skillId', 'subskillId'], steps: ['steps'], completedAt: ['completedAt'],
  schedule: ['scheduleOn', 'scheduleAt', 'scheduleRecurrence', 'scheduleLead', 'scheduleTimeZone'],
} satisfies Record<string, (keyof Draft)[]>;
type Group = keyof typeof DRAFT_FIELDS;
const PATCH_FIELDS: Record<Group, (keyof TaskEditPatch)[]> = {
  title: ['title'], note: ['note'], phase: ['phase'], priority: ['priority'],
  dates: ['plannedDate', 'deadlineDate'], timer: ['timerMode', 'countdownDurationSeconds'],
  skill: ['skillId', 'subskillId'], steps: ['stepList', 'steps'], completedAt: ['completedAt'], schedule: ['schedule'],
};
const GROUPS = Object.keys(DRAFT_FIELDS) as Group[];
const CREATE_GROUPS = GROUPS.filter(group => group !== 'completedAt');
function localStamp(at: number | undefined) {
  if (at === undefined || !Number.isFinite(at) || Math.abs(at) >= 8640000000000000) return '';
  const date = new Date(at);
  return new Date(at - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
}
function taskDraft(task: PSTask | undefined, fallbackPhase: string, stepLabel: string): Draft {
  return {
    title: task?.title ?? '', note: task?.note ?? '', phase: task?.phase ?? fallbackPhase, priority: task?.priority ?? 2,
    plannedDate: task?.plannedDate ?? '', deadlineDate: task?.deadlineDate ?? '',
    timerMode: task ? getTaskTimerMode(task) : 'stopwatch',
    minutes: task?.countdownDurationSeconds ? String(task.countdownDurationSeconds / 60) : '25',
    skillId: task?.skillId ?? '', subskillId: task?.subskillId ?? '',
    steps: task ? materializeStepList(task, stepLabel).map(step => step.title).join('\n') : '',
    completedAt: localStamp(task?.completedAt), scheduleOn: !!task?.schedule,
    scheduleAt: task?.schedule ? localStamp(Date.parse(task.schedule.startAt)) : '',
    scheduleRecurrence: task?.schedule?.recurrence ?? 'once', scheduleLead: String(task?.schedule?.leadMinutes ?? 5),
    scheduleTimeZone: task?.schedule?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

/** A session cannot carry drafts, callbacks or a baseline into another owner or task. */
export function TaskEditor(props: Props) {
  const session = JSON.stringify([props.ownerId, props.task?.id ?? null, props.task ? null : props.prefill?.key ?? null]);
  return <TaskEditorSession key={session} {...props} />;
}

function TaskEditorSession({ ownerId, task, prefill, tabs, skills, lang, onClose, onCreate, onPatch, onReopenTask, onRecordResult }: Props) {
  const uk = lang === 'uk';
  const stepLabel = uk ? 'Крок' : 'Step';
  const fallbackPhase = tabs[0]?.id ?? 'focus';
  // Quick-add keys restart at zero after navigation; they identify requests only within this page.
  const prefillSession = typeof performance === 'undefined' ? null : performance.timeOrigin;
  const prefillPayload = prefill ? JSON.stringify({ title: prefill.title, phase: prefill.phase,
    proposedCategoryName: prefill.proposedCategoryName, priority: prefill.priority,
    plannedDate: prefill.plannedDate, deadlineDate: prefill.deadlineDate, schedule: prefill.schedule,
    skillId: prefill.skillId, subskillId: prefill.subskillId }) : null;
  const draftKey = task
    ? 'karkas_task_edit_v2:' + encodeURIComponent(ownerId ?? 'guest') + ':' + encodeURIComponent(task.id)
    : 'karkas_task_entry_v2:' + (ownerId ?? 'guest');
  const initial = useRef<{ draft: Draft; baseline?: PSTask; dirty: Set<Group>; consumedPrefill: boolean; proposedCategory?: string; creationCategory?: string } | null>(null);
  if (!initial.current) {
    const value = taskDraft(task, fallbackPhase, stepLabel);
    let saved: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(draftKey) || '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) saved = parsed as Record<string, unknown>;
    } catch { /* No readable draft. */ }
    const dirty = new Set<Group>(task && Array.isArray(saved.dirty) ? saved.dirty.filter((group): group is Group => GROUPS.includes(group as Group)) : []);
    let before = task;
    if (task && saved.baseline && typeof saved.baseline === 'object' && (saved.baseline as PSTask).id === task.id) before = saved.baseline as PSTask;
    else if (task) dirty.clear();
    const stored = saved.draft && typeof saved.draft === 'object' ? saved.draft as Record<string, unknown> : saved;
    const restoreCreation = !task && (!prefill || saved.prefillKey === prefill.key && saved.prefillSession === prefillSession && saved.prefillPayload === prefillPayload);
    const editable = task ? [...dirty].flatMap<keyof Draft>(group => DRAFT_FIELDS[group]) : Object.keys(value) as (keyof Draft)[];
    if (task || restoreCreation) for (const field of editable) {
      if (typeof stored[field] === typeof value[field]) Object.assign(value, { [field]: stored[field] });
    }
    if (!task && prefill && !restoreCreation) {
      Object.assign(value, { title: prefill.title, phase: prefill.phase ?? value.phase, priority: prefill.priority ?? value.priority,
        plannedDate: prefill.plannedDate ?? '', deadlineDate: prefill.deadlineDate ?? '', skillId: prefill.skillId ?? '', subskillId: prefill.subskillId ?? '' });
      if (prefill.schedule) Object.assign(value, { scheduleOn: true, scheduleAt: localStamp(Date.parse(prefill.schedule.startAt)), scheduleRecurrence: prefill.schedule.recurrence, scheduleLead: String(prefill.schedule.leadMinutes), scheduleTimeZone: prefill.schedule.timeZone });
    }
    if (!task && !tabs.some(tab => tab.id === value.phase)) value.phase = fallbackPhase;
    if (![1, 2, 3].includes(value.priority)) value.priority = 2;
    if (!['none', 'stopwatch', 'countdown'].includes(value.timerMode)) value.timerMode = 'stopwatch';
    if (!['once', 'daily'].includes(value.scheduleRecurrence)) value.scheduleRecurrence = 'once';
    initial.current = { draft: value, baseline: before, dirty, consumedPrefill: restoreCreation && saved.consumedPrefill === true,
      proposedCategory: restoreCreation && typeof saved.proposedCategory === 'string' ? saved.proposedCategory : undefined,
      creationCategory: restoreCreation ? (typeof saved.creationCategory === 'string' ? saved.creationCategory : undefined) : prefill?.proposedCategoryName };
  }
  const [draft, setDraft] = useState<Draft>(initial.current.draft);
  const draftRef = useRef(draft); draftRef.current = draft;
  const baseline = useRef(initial.current.baseline);
  const latestSnapshot = useRef(task);
  const dirty = useRef(initial.current.dirty);
  const titleRef = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  const consumedPrefill = useRef(initial.current.consumedPrefill);
  const proposedCategory = useRef(initial.current.proposedCategory);
  const creationCategory = useRef(initial.current.creationCategory);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const applySnapshot = (snapshot: PSTask) => {
    const nextBaseline = { ...snapshot };
    // Dirty fields retain their original expected values until explicitly saved or discarded.
    for (const group of dirty.current) for (const field of PATCH_FIELDS[group]) Object.assign(nextBaseline, { [field]: baseline.current?.[field] });
    baseline.current = nextBaseline;
    const next = taskDraft(snapshot, fallbackPhase, stepLabel);
    for (const group of dirty.current) for (const field of DRAFT_FIELDS[group]) Object.assign(next, { [field]: draftRef.current[field] });
    draftRef.current = next; setDraft(next);
  };
  useEffect(() => {
    if (!task) return;
    const conflict = [...dirty.current].some(group => PATCH_FIELDS[group].some(field => JSON.stringify(baseline.current?.[field]) !== JSON.stringify(task[field])));
    latestSnapshot.current = task;
    applySnapshot(task);
    if (conflict) setError(uk ? 'Запис змінився. Ваші незбережені поля залишилися в чернетці; новіші правки не будуть перезаписані. За потреби завантажте збережену версію.' : 'This record changed. Your unsaved fields remain in the draft; newer edits will not be overwritten. You can load the saved version.');
  }, [task]);
  useEffect(() => {
    if (task || !proposedCategory.current) return;
    const category = tabs.find(tab => tab.name.trim().toLocaleLowerCase() === proposedCategory.current!.trim().toLocaleLowerCase());
    if (!category) return;
    proposedCategory.current = undefined;
    const next = { ...draftRef.current, phase: category.id };
    draftRef.current = next; setDraft(next);
  }, [tabs, task?.id]);
  useEffect(() => { titleRef.current?.focus({ preventScroll: true }); }, []);
  const persistDraft = () => {
    try {
      if (task && dirty.current.size === 0) localStorage.removeItem(draftKey);
      else localStorage.setItem(draftKey, JSON.stringify(task ? { draft: draftRef.current, baseline: baseline.current, dirty: [...dirty.current] }
        : { draft: draftRef.current, prefillKey: prefill?.key ?? null, prefillSession, prefillPayload,
          consumedPrefill: consumedPrefill.current, proposedCategory: proposedCategory.current, creationCategory: creationCategory.current }));
      return true;
    } catch { setError(uk ? 'Чернетка не записана. Залиште форму відкритою або скопіюйте текст.' : 'Draft was not saved. Keep this form open or copy the text.'); return false; }
  };
  useEffect(() => { persistDraft(); }, [draft, draftKey]);
  const update = <K extends keyof Draft>(field: K, value: Draft[K]) => {
    const group = GROUPS.find(candidate => (DRAFT_FIELDS[candidate] as readonly (keyof Draft)[]).includes(field));
    if (group) dirty.current.add(group);
    if (field === 'phase') { creationCategory.current = undefined; proposedCategory.current = undefined; }
    draftRef.current = { ...draftRef.current, [field]: value }; setDraft(draftRef.current); setError(''); setStatus('');
  };
  const fail = (message?: string) => { setError(message ?? (uk ? 'Не збережено. Перевірте значення або новіші зміни й повторіть. Чернетка залишається тут.' : 'Not saved. Check the value or newer changes and retry. Your draft stays here.')); return false; };
  const buildPatch = (groups: readonly Group[]): TaskEditPatch | null => {
    const d = draftRef.current;
    const patch: TaskEditPatch = {};
    for (const group of groups) {
      if (group === 'title') { if (!d.title.trim()) return null; patch.title = d.title.trim(); }
      if (group === 'note') patch.note = d.note.trim() || undefined;
      if (group === 'phase') { if (!tabs.some(tab => tab.id === d.phase)) return null; patch.phase = d.phase; }
      if (group === 'priority') { if (![1, 2, 3].includes(d.priority)) return null; patch.priority = d.priority; }
      if (group === 'dates') {
        if (d.plannedDate && !isTaskDate(d.plannedDate) || d.deadlineDate && !isTaskDate(d.deadlineDate) || d.plannedDate && d.deadlineDate && d.plannedDate > d.deadlineDate) return null;
        patch.plannedDate = d.plannedDate || undefined; patch.deadlineDate = d.deadlineDate || undefined;
      }
      if (group === 'timer') {
        if (d.timerMode === 'countdown' && (!Number.isInteger(Number(d.minutes)) || Number(d.minutes) < 1 || Number(d.minutes) > 1440)) return null;
        patch.timerMode = d.timerMode; patch.countdownDurationSeconds = d.timerMode === 'countdown' ? Number(d.minutes) * 60 : undefined;
      }
      if (group === 'skill') {
        const skill = skills.find(item => item.id === d.skillId && item.deletedAt === undefined && item.archivedAt === undefined);
        if (d.skillId && !skill || d.subskillId && !skill?.subskills.some(subskill => subskill.id === d.subskillId)) return null;
        patch.skillId = d.skillId || undefined; patch.subskillId = d.subskillId || undefined;
      }
      if (group === 'steps') {
        const old = baseline.current ? materializeStepList(baseline.current, stepLabel) : [];
        const titles = d.steps.split('\n').map(line => line.trim()).filter(Boolean);
        const used = new Set<string>();
        // Reserve every unchanged row before considering a positional rename.
        const matches = titles.map(title => {
          const previous = old.find(step => step.title === title && !used.has(step.id));
          if (previous) used.add(previous.id);
          return previous;
        });
        patch.stepList = titles.map((title, index) => {
          const previous = matches[index] ?? (titles.length === old.length && old[index] && !used.has(old[index].id) ? old[index] : undefined);
          if (previous) { used.add(previous.id); return { ...previous, title }; }
          return { id: 'step-' + crypto.randomUUID(), title, done: false };
        });
        patch.steps = patch.stepList.length;
      }
      if (group === 'completedAt') {
        const at = d.completedAt ? new Date(d.completedAt).getTime() : NaN;
        if (!Number.isFinite(at) || at > Date.now()) return null;
        patch.completedAt = at;
      }
      if (group === 'schedule') {
        if (!d.scheduleOn) { patch.schedule = undefined; continue; }
        const at = d.scheduleAt ? new Date(d.scheduleAt).getTime() : NaN;
        if (!Number.isFinite(at) || !d.scheduleLead.trim()) return null;
        const schedule = normalizeTaskSchedule({ startAt: new Date(at).toISOString(), recurrence: d.scheduleRecurrence,
          timeZone: d.scheduleTimeZone,
          leadMinutes: Number(d.scheduleLead) });
        if (!schedule) return null;
        patch.schedule = schedule;
      }
    }
    return patch;
  };
  const save = (only?: Group) => {
    const before = baseline.current;
    if (!before) return true;
    const groups = only ? (dirty.current.has(only) ? [only] : []) : [...dirty.current];
    if (!groups.length) return true;
    const patch = buildPatch(groups);
    if (!patch) return fail();
    const changed = (Object.keys(patch) as (keyof TaskEditPatch)[]).filter(field => JSON.stringify(before[field]) !== JSON.stringify(patch[field])
      && JSON.stringify(latestSnapshot.current?.[field]) !== JSON.stringify(patch[field]));
    const expected = Object.fromEntries(changed.map(field => [field, before[field]])) as TaskEditPatch;
    const edits = Object.fromEntries(changed.map(field => [field, patch[field]])) as TaskEditPatch;
    let accepted: boolean | PSTask = latestSnapshot.current ?? before;
    if (changed.length) {
      try { accepted = onPatch(before.id, edits, expected); } catch { return fail(); }
      if (!accepted) return fail();
    }
    for (const group of groups) dirty.current.delete(group);
    const snapshot = typeof accepted === 'object' ? accepted : { ...before, ...edits };
    latestSnapshot.current = snapshot;
    applySnapshot(snapshot); setError(''); setStatus(uk ? 'Збережено на пристрої' : 'Saved on this device');
    return true;
  };
  const close = () => { if (save() && persistDraft()) onClose(); };
  const continueTo = (action: ((id: string) => void | boolean) | undefined) => {
    if (task && action && save() && persistDraft() && action(task.id) === false) fail(uk ? 'Дія недоступна. Перевірте стан завдання та навички в Архіві й повторіть.' : 'Action unavailable. Check the task and skill in Archive and retry.');
  };
  useDialogKeyboard(true, close, 'pulse-task-editor');
  const reloadSaved = () => {
    const snapshot = latestSnapshot.current;
    if (!snapshot) return;
    dirty.current.clear(); baseline.current = snapshot; applySnapshot(snapshot); setError(''); setStatus('');
  };
  const create = (event: React.FormEvent) => {
    event.preventDefault();
    if (task) { save(); return; }
    if (lock.current || !draftRef.current.title.trim()) return;
    const patch = buildPatch(CREATE_GROUPS);
    if (!patch) { fail(); return; }
    lock.current = true;
    let accepted: boolean | PSTask = false;
    const category = !consumedPrefill.current ? creationCategory.current : undefined;
    try { accepted = onCreate(patch as NewTaskInput, category); } catch { accepted = false; }
    if (accepted) {
      consumedPrefill.current = true;
      creationCategory.current = undefined;
      proposedCategory.current = typeof accepted === 'object' ? undefined : category;
      const phase = typeof accepted === 'object' ? accepted.phase : draftRef.current.phase;
      const next = taskDraft(undefined, phase, stepLabel);
      dirty.current.clear(); draftRef.current = next; setDraft(next); setError('');
      setStatus(uk ? 'Завдання створене. Введіть наступне.' : 'Task created. Enter another.');
      titleRef.current?.focus({ preventScroll: true });
    } else fail();
    queueMicrotask(() => { lock.current = false; });
  };
  const activeSkills = skills.filter(skill => skill.deletedAt === undefined && skill.archivedAt === undefined);
  const selectedSkill = activeSkills.find(skill => skill.id === draft.skillId);
  return createPortal(<div className="pulse-task-editor-overlay app-no-drag" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <section id="pulse-task-editor" className="pulse-task-editor" role="dialog" aria-modal="true" aria-label={uk ? (task ? 'Редагувати завдання' : 'Нове завдання') : (task ? 'Edit task' : 'New task')}>
      <header><h2>{uk ? (task ? 'Редагувати завдання' : 'Нове завдання') : (task ? 'Edit task' : 'New task')}</h2><button type="button" aria-label={uk ? 'Закрити' : 'Close'} onClick={close}><X size={22} /></button></header>
      <form onSubmit={create} onKeyDown={event => { if (event.key === 'Enter' && event.target instanceof HTMLInputElement && !event.nativeEvent.isComposing) { event.preventDefault(); if (event.repeat) return; if (task || event.target !== titleRef.current) event.target.blur(); else create(event); } }}>
        <label>{uk ? 'Назва' : 'Title'}<input ref={titleRef} value={draft.title} maxLength={500} placeholder={uk ? 'Ввести назву' : 'Enter a title'} onChange={event => update('title', event.target.value)} onBlur={() => save('title')} required /></label>
        <div className="pulse-task-fields">
          <label>{uk ? 'Категорія' : 'Category'}<select value={draft.phase} onChange={event => { update('phase', event.target.value); save('phase'); }}>{!tabs.some(tab => tab.id === draft.phase) && <option value={draft.phase}>{uk ? 'Недоступна категорія' : 'Unavailable category'}</option>}{tabs.map(tab => <option key={tab.id} value={tab.id}>{tab.name}</option>)}</select></label>
          <label>{uk ? 'Пріоритет' : 'Priority'}<select value={draft.priority} onChange={event => { update('priority', Number(event.target.value) as Draft['priority']); save('priority'); }}><option value={1}>{uk ? 'Високий' : 'High'}</option><option value={2}>{uk ? 'Звичайний' : 'Normal'}</option><option value={3}>{uk ? 'Низький' : 'Low'}</option></select></label>
          <label>{uk ? 'День роботи' : 'Planned day'}<input type="date" value={draft.plannedDate} onChange={event => { update('plannedDate', event.target.value); save('dates'); }} /></label>
          <label>{uk ? 'Дедлайн' : 'Deadline'}<input type="date" value={draft.deadlineDate} onChange={event => { update('deadlineDate', event.target.value); save('dates'); }} /></label>
        </div>
        <label>{uk ? 'Опис' : 'Description'}<textarea rows={2} value={draft.note} onChange={event => update('note', event.target.value)} onBlur={() => save('note')} /></label>
        <details open={task ? true : undefined}><summary>{uk ? 'Таймер, навичка та підкроки' : 'Timer, skill and substeps'}</summary>
          <div className="pulse-task-fields"><label>{uk ? 'Облік часу' : 'Time tracking'}<select value={draft.timerMode} onChange={event => { update('timerMode', event.target.value as Draft['timerMode']); save('timer'); }}><option value="none">{uk ? 'Без таймера' : 'No timer'}</option><option value="stopwatch">{uk ? 'Секундомір' : 'Stopwatch'}</option><option value="countdown">{uk ? 'Зворотний відлік' : 'Countdown'}</option></select></label>
          {draft.timerMode === 'countdown' && <label>{uk ? 'Хвилини' : 'Minutes'}<input type="number" inputMode="numeric" min={1} max={1440} value={draft.minutes} onChange={event => update('minutes', event.target.value)} onBlur={() => save('timer')} /></label>}
          <label>{uk ? 'Навичка' : 'Skill'}<select value={draft.skillId} onChange={event => { update('skillId', event.target.value); update('subskillId', ''); save('skill'); }}><option value="">{uk ? 'Без навички' : 'No skill'}</option>{draft.skillId && !selectedSkill && <option value={draft.skillId}>{skills.find(skill => skill.id === draft.skillId)?.title ?? (uk ? 'Недоступна навичка' : 'Unavailable skill')}</option>}{activeSkills.map(skill => <option key={skill.id} value={skill.id}>{skill.title}</option>)}</select></label>
          {selectedSkill && (selectedSkill.subskills.length > 0 || !!draft.subskillId) && <label>{uk ? 'Піднавичка' : 'Subskill'}<select value={draft.subskillId} onChange={event => { update('subskillId', event.target.value); save('skill'); }}><option value="">{uk ? 'Без піднавички' : 'No subskill'}</option>{draft.subskillId && !selectedSkill.subskills.some(subskill => subskill.id === draft.subskillId) && <option value={draft.subskillId}>{uk ? 'Недоступна піднавичка' : 'Unavailable subskill'}</option>}{selectedSkill.subskills.map(subskill => <option key={subskill.id} value={subskill.id}>{subskill.title}</option>)}</select></label>}</div>
          <label>{uk ? 'Підкроки — кожен із нового рядка' : 'Substeps — one per line'}<textarea rows={4} value={draft.steps} onChange={event => update('steps', event.target.value)} onBlur={() => save('steps')} /></label>
        </details>
        <details open={draft.scheduleOn || undefined}><summary>{uk ? 'Розклад' : 'Schedule'}</summary>
          {task?.done && <p className="pulse-task-hint">{uk ? 'Для виконаного завдання можна виправити дату завершення нижче.' : 'For a completed task, correct its completion date below.'}</p>}
          <fieldset className="pulse-task-schedule-fields" disabled={task?.done}>
          <label className="pulse-task-checkbox"><input type="checkbox" checked={draft.scheduleOn} onChange={event => { update('scheduleOn', event.target.checked); if (!event.target.checked || draftRef.current.scheduleAt) save('schedule'); }} />{uk ? 'Запланувати початок' : 'Schedule start'}</label>
          {draft.scheduleOn && <><p className="pulse-task-hint">{uk ? 'Час початку показаний у часовому поясі цього пристрою.' : 'Start time is shown in this device’s time zone.'}</p><div className="pulse-task-fields">
            <label>{uk ? 'Початок' : 'Start'}<input type="datetime-local" step={1} value={draft.scheduleAt} onChange={event => update('scheduleAt', event.target.value)} onBlur={() => save('schedule')} /></label>
            <label>{uk ? 'Повторення' : 'Repeat'}<select value={draft.scheduleRecurrence} onChange={event => { update('scheduleRecurrence', event.target.value as Draft['scheduleRecurrence']); if (draftRef.current.scheduleAt) save('schedule'); }}><option value="once">{uk ? 'Один раз' : 'Once'}</option><option value="daily">{uk ? 'Щодня' : 'Daily'}</option></select></label>
            <label>{uk ? 'Додати за хвилин до початку' : 'Add minutes before start'}<input type="number" min={0} max={1440} value={draft.scheduleLead} onChange={event => update('scheduleLead', event.target.value)} onBlur={() => save('schedule')} /></label>
          </div></>}
          </fieldset>
        </details>
        {task?.done && <label>{uk ? 'Дата завершення' : 'Completion date'}<input type="datetime-local" step={1} value={draft.completedAt} onChange={event => update('completedAt', event.target.value)} onBlur={() => save('completedAt')} /></label>}
        {error && <div className="pulse-task-error" role="alert"><p>{error}</p><div className="pulse-task-error-actions"><button type="button" onClick={event => { if (task) { if (save() && persistDraft()) setError(''); } else if (draftRef.current.title.trim()) create(event); else if (persistDraft()) setError(''); }}>{uk ? 'Повторити' : 'Retry'}</button>{task && <button type="button" onClick={reloadSaved}>{uk ? 'Завантажити збережене' : 'Load saved version'}</button>}</div></div>}
        {task && (task.done && onReopenTask || task.skillId && onRecordResult) && <div className="pulse-task-editor-actions">
          {task.done && onReopenTask && <button type="button" onClick={() => continueTo(onReopenTask)}>{uk ? 'Повернути в роботу' : 'Return to work'}</button>}
          {task.skillId && onRecordResult && <button type="button" onClick={() => continueTo(onRecordResult)}>{uk ? 'Записати / редагувати результат' : 'Record / edit result'}</button>}
        </div>}
        <footer><span role="status" aria-live="polite">{status || (task ? (uk ? 'Зміни зберігаються автоматично' : 'Changes save automatically') : '')}</span>{!task && <button type="submit" className="pulse-task-create" disabled={!draft.title.trim()}><Plus size={19} />{uk ? 'Додати' : 'Add'}</button>}{task && <button type="button" onClick={close}><Check size={18} />{uk ? 'Готово' : 'Done'}</button>}</footer>
      </form>
    </section>
  </div>, document.body);
}
