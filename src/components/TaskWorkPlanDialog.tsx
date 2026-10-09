import React, { useState } from 'react';
import { X } from 'lucide-react';
import type { PSTask } from '../types';
import { materializeStepList } from '../utils/taskOperations';
import type { WorkPlanEdit } from '../utils/taskWorkPlan';
import { useDialogKeyboard } from './useDialogKeyboard';

export const TaskWorkPlanDialog: React.FC<{
  task: PSTask;
  lang: 'uk' | 'en';
  onClose: () => void;
  onSave: (taskId: string, edit: WorkPlanEdit) => boolean;
}> = ({ task, lang, onClose, onSave }) => {
  const uk = lang === 'uk';
  const [initialSteps] = useState(() => materializeStepList(task, uk ? 'Крок' : 'Step'));
  const [expected] = useState(() => ({
    plannedDurationSeconds: task.plannedDurationSeconds,
    steps: initialSteps.map(({ id, title, estimatedDurationSeconds }) => ({ id, title, estimatedDurationSeconds })),
  }));
  const asMinutes = (seconds?: number) => seconds ? String(Number((seconds / 60).toFixed(2))) : '';
  const [total, setTotal] = useState(() => asMinutes(task.plannedDurationSeconds));
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(initialSteps.map(step => [step.id, asMinutes(step.estimatedDurationSeconds)])));
  const [error, setError] = useState('');
  const valid = (value: string) => value === '' || /^\d+(?:\.\d{1,2})?$/.test(value) && Number(value) > 0 && Number(value) <= 1440;
  const toSeconds = (value: string) => value === '' ? undefined : Math.round(Number(value) * 60);
  useDialogKeyboard(true, onClose, 'task-work-plan-dialog');
  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-4">
    <form id="task-work-plan-dialog" role="dialog" aria-modal="true" aria-labelledby="task-work-plan-title"
      className="max-h-[85dvh] w-full max-w-lg overflow-y-auto border border-neutral-700 bg-[#0c0c0e] p-5 text-neutral-200"
      onSubmit={event => {
        event.preventDefault();
        if (!valid(total) || Object.values(values as Record<string, string>).some(value => !valid(value))) {
          setError(uk ? 'Вкажіть від 0,01 до 1440 хвилин або залиште поле порожнім.' : 'Enter 0.01–1440 minutes or leave the field empty.'); return;
        }
        if (!onSave(task.id, { expected, plannedDurationSeconds: toSeconds(total), steps: initialSteps.map(step => ({ id: step.id, estimatedDurationSeconds: toSeconds(values[step.id] || '') })) })) {
          setError(uk ? 'Завдання або його кроки змінилися. Відкрийте план часу ще раз.' : 'The task or steps changed. Reopen the time plan.'); return;
        }
        onClose();
      }}>
      <header className="mb-5 flex items-start gap-3">
        <div className="min-w-0 flex-1"><h2 id="task-work-plan-title" className="text-lg font-semibold">{uk ? 'План часу' : 'Time plan'}</h2><p className="mt-2 break-words text-sm text-neutral-400">{task.title}</p></div>
        <button type="button" onClick={onClose} aria-label={uk ? 'Закрити' : 'Close'} className="flex min-h-11 min-w-11 items-center justify-center"><X className="h-5 w-5" /></button>
      </header>
      <p className="mb-5 text-sm leading-relaxed text-neutral-400">{uk ? 'Це очікуваний час роботи для порівняння з фактичним. Зміна плану не запускає таймер і не стирає записаний час.' : 'Expected work time to compare with measurements. Editing this plan does not start the timer or erase recorded time.'}</p>
      <label className="flex items-center justify-between gap-4 text-sm">{uk ? 'Усе завдання · хв' : 'Whole task · min'}<input type="number" min="0.01" max="1440" step="0.01" value={total} onChange={event => setTotal(event.target.value)} className="min-h-11 w-24 border border-neutral-700 bg-black px-3 text-white" /></label>
      {initialSteps.length > 0 && <div className="mt-5 space-y-3 border-t border-neutral-800 pt-5">
        <p className="text-sm text-neutral-400">{uk ? 'Очікуваний час кроків · хв' : 'Expected step time · min'}</p>
        {initialSteps.map(step => <label key={step.id} className="flex items-center justify-between gap-4 text-sm"><span className="min-w-0 break-words">{step.title}</span><input type="number" min="0.01" max="1440" step="0.01" aria-label={`${step.title} · ${uk ? 'хвилини' : 'minutes'}`} value={values[step.id] || ''} onChange={event => setValues(previous => ({ ...previous, [step.id]: event.target.value }))} className="min-h-11 w-24 shrink-0 border border-neutral-700 bg-black px-3 text-white" /></label>)}
      </div>}
      <p className="mt-5 text-xs leading-relaxed text-neutral-400">{uk ? 'Таймер вимірює перший незавершений крок. Позначайте крок після виконання, щоб час наступного етапу обліковувався окремо. Попередній час без вимірювання кроків не розподіляється автоматично.' : 'The timer measures the first unfinished step. Check it off when done to track the next step separately. Previous work without step measurements is not distributed automatically.'}</p>
      {error && <p role="alert" className="mt-4 text-sm text-red-300">{error}</p>}
      <footer className="mt-5 flex justify-end gap-3"><button type="button" onClick={onClose} className="min-h-11 border border-neutral-700 px-4 text-sm">{uk ? 'Скасувати' : 'Cancel'}</button><button type="submit" className="min-h-11 bg-white px-4 text-sm font-semibold text-black">{uk ? 'Зберегти план' : 'Save plan'}</button></footer>
    </form>
  </div>;
};
