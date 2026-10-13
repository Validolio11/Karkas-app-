import React, { useId, useState } from 'react';
import { MessageSquare, Settings2 } from 'lucide-react';
import type { PSTask, StrategyGoal, TaskTab } from '../types';
import { TRANSLATIONS } from '../utils/i18n';
import { goalTaskStats } from './strategyViewModel';
import { Chip, field, Meter, monoLabel, panel, Reveal, SectionTitle } from './strategyUi';

const GoalRow: React.FC<{
  goal: StrategyGoal; tasks: PSTask[]; tabs: TaskTab[]; lang: 'uk' | 'en';
  onChange: (patch: Partial<StrategyGoal>) => void; onOpenTask: (id: string) => void; onChat: (text: string) => void;
}> = ({ goal, tasks, tabs, lang, onChange, onChat }) => {
  const uk = lang === 'uk';
  const [editing, setEditing] = useState(false);
  const id = useId();
  const stats = goalTaskStats(goal, tasks);
  const phases = TRANSLATIONS[lang].phases as Record<string, string>;
  const iconBtn = 'inline-flex h-11 w-11 sm:h-8 sm:w-8 items-center justify-center text-neutral-500 transition-colors hover:bg-neutral-900 hover:text-white motion-reduce:transition-none';
  return <li className="min-w-0 py-5 first:pt-0 last:pb-0">
    <article className="grid min-w-0 items-center gap-x-8 gap-y-3 sm:grid-cols-[minmax(0,1fr)_9rem_auto]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h3 className="min-w-0 break-words text-[15px] font-semibold leading-snug text-white">{goal.title || (uk ? 'Без назви' : 'Untitled')}</h3>
          {/* Agreed is the normal state; only the exception gets a chip. */}
          {!goal.agreed && <Chip tone="amber">{uk ? 'Потребує узгодження' : 'Needs agreement'}</Chip>}
        </div>
        {goal.motive && <p className="mt-1.5 line-clamp-1 max-w-prose break-words text-[13px] text-neutral-500" title={goal.motive}>{goal.motive}</p>}
      </div>

      <div className="min-w-0" title={stats.total ? `${stats.done}/${stats.total} ${uk ? 'завдань виконано' : 'tasks done'}` : undefined}>
        <div className="mb-2 flex items-baseline justify-between gap-2 font-mono text-[11px] tabular-nums">
          <span className="text-neutral-500">{stats.total ? `${stats.done}/${stats.total}` : (uk ? 'Без завдань' : 'No tasks')}</span>
          {stats.total > 0 && <span className="font-bold text-neutral-200">{stats.percent}%</span>}
        </div>
        <Meter value={stats.percent} label={uk ? `Прогрес цілі «${goal.title}»` : `Progress of goal "${goal.title}"`} valueText={`${stats.done}/${stats.total}`} />
      </div>

      <div className="-ml-3 flex items-center gap-1 sm:ml-0">
        <button type="button" className={iconBtn} aria-label={uk ? `Обговорити ціль «${goal.title}»` : `Discuss goal "${goal.title}"`} title={uk ? 'Обговорити' : 'Discuss'}
          onClick={() => onChat(uk ? `@plan Обговорімо ціль «${goal.title}»${goal.motive ? ` (чому важливо: ${goal.motive})` : ''}. Переглянь пов’язані завдання й запропонуй посильний наступний крок.` : `@plan Let us discuss the goal "${goal.title}"${goal.motive ? ` (why it matters: ${goal.motive})` : ''}. Review the linked tasks and suggest a manageable next step.`)}>
          <MessageSquare className="h-4 w-4" aria-hidden="true" />
        </button>
        <button type="button" id={`${id}-edit`} aria-expanded={editing} aria-controls={`${id}-editor`} aria-label={uk ? `Налаштувати ціль «${goal.title}»` : `Edit goal "${goal.title}"`}
          title={uk ? 'Налаштувати' : 'Edit'} className={`${iconBtn} ${editing ? 'bg-neutral-900 text-white' : ''}`} onClick={() => setEditing(value => !value)}>
          <Settings2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </article>

    <Reveal open={editing} id={`${id}-editor`} labelledBy={`${id}-edit`}>
      <div className="mt-4 grid gap-3 border border-neutral-800 bg-black/30 p-4">
        <label className="min-w-0 text-xs text-neutral-400">{uk ? 'Ціль' : 'Goal'}<input value={goal.title} onChange={event => onChange({ title: event.target.value })} className={field} /></label>
        <label className="min-w-0 text-xs text-neutral-400">{uk ? 'Чому це важливо для мене' : 'Why it matters to me'}<textarea value={goal.motive} onChange={event => onChange({ motive: event.target.value })} rows={2} className={field} /></label>
        <label className="flex min-h-11 sm:min-h-8 items-center gap-2 text-xs"><input type="checkbox" checked={goal.agreed} onChange={event => onChange({ agreed: event.target.checked })} className="h-4 w-4 shrink-0 accent-white" />{uk ? 'Узгоджено: ШІ може адаптувати пов’язані завдання' : 'Agreed: AI may adapt related tasks'}</label>
        {tabs.length > 0 && <fieldset className="min-w-0">
          <legend className={`${monoLabel} mb-1.5`}>{uk ? 'Пов’язані категорії' : 'Related categories'}</legend>
          <div className="flex flex-wrap gap-1.5">{tabs.map(tab => {
            const selected = goal.categoryIds.includes(tab.id);
            return <button key={tab.id} type="button" aria-pressed={selected}
              onClick={() => onChange({ categoryIds: selected ? goal.categoryIds.filter(item => item !== tab.id) : [...goal.categoryIds, tab.id] })}
              className={`inline-flex min-h-11 sm:min-h-8 items-center gap-1.5 border px-2 py-1 text-[11px] font-bold uppercase tracking-wider transition-colors motion-reduce:transition-none ${selected ? 'border-white bg-neutral-900 text-white' : 'border-neutral-800 text-neutral-500 hover:border-neutral-600 hover:text-neutral-200'}`}>
              {tab.color && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tab.color }} />}{phases[tab.id] || tab.name}
            </button>;
          })}</div>
        </fieldset>}
        <details className="min-w-0">
          <summary className="min-h-11 sm:min-h-8 cursor-pointer py-1.5 text-xs text-neutral-400 hover:text-white">{uk ? 'Пов’язані завдання' : 'Related tasks'} <span className="font-mono text-neutral-500">{goal.taskIds.length}</span></summary>
          <div className="max-h-48 overflow-auto border-t border-neutral-800 pt-1">{tasks.filter(task => !task.done && !task.scheduledPending).map(task => <label key={task.id} className="flex min-h-11 sm:min-h-8 items-center gap-2 text-xs">
            <input type="checkbox" checked={goal.taskIds.includes(task.id)} onChange={event => onChange({ taskIds: event.target.checked ? [...goal.taskIds, task.id] : goal.taskIds.filter(item => item !== task.id) })} className="h-4 w-4 shrink-0 accent-white" />
            <span className="break-words">{task.title}</span></label>)}</div>
        </details>
      </div>
    </Reveal>
  </li>;
};

export const StrategyGoals: React.FC<{
  goals: StrategyGoal[]; tasks: PSTask[]; tabs: TaskTab[]; lang: 'uk' | 'en';
  onChangeGoal: (id: string, patch: Partial<StrategyGoal>) => void; onOpenTask: (id: string) => void; onChat: (text: string) => void;
}> = ({ goals, tasks, tabs, lang, onChangeGoal, onOpenTask, onChat }) => {
  if (!goals.length) return null;
  const agreed = goals.filter(goal => goal.agreed).length;
  return <section aria-labelledby="strategy-goals-title" className={panel}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <SectionTitle id="strategy-goals-title" count={goals.length}>{lang === 'uk' ? 'Мої цілі' : 'My goals'}</SectionTitle>
      <span className={monoLabel}>{agreed}/{goals.length} {lang === 'uk' ? 'узгоджено' : 'agreed'}</span>
    </div>
    <ul className="mt-6 divide-y divide-neutral-800/80">
      {goals.map(goal => <GoalRow key={goal.id} goal={goal} tasks={tasks} tabs={tabs} lang={lang}
        onChange={patch => onChangeGoal(goal.id, patch)} onOpenTask={onOpenTask} onChat={onChat} />)}
    </ul>
  </section>;
};
