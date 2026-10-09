import React, { useState } from 'react';
import type { PSTask } from '../types';
import type { WorkInsights } from '../utils/workInsights';

const minutes = (seconds: number) => Math.max(1, Math.ceil(seconds / 60));
export const WorkInsightsPanel: React.FC<{
  insights: WorkInsights; tasks: PSTask[]; lang: 'uk' | 'en'; expanded?: boolean;
  remindersEnabled: boolean; onRemindersChange: (enabled: boolean) => void;
  onReviewAI: (prompt: string) => void;
  onApplyPriority: (id: string, from: 1 | 2 | 3, to: 1 | 2 | 3) => void;
  onEditPlan: (id: string) => void;
}> = ({ insights, tasks, lang, expanded = false, remindersEnabled, onRemindersChange, onReviewAI, onApplyPriority, onEditPlan }) => {
  const uk = lang === 'uk';
  const [open, setOpen] = useState(expanded);
  const byId = new Map<string, PSTask>(tasks.map(task => [task.id, task]));
  const active = tasks.filter(task => !task.done && !task.scheduledPending);
  const confidence = (value: string) => value === 'moderate' ? (uk ? 'помірна впевненість' : 'moderate confidence') : (uk ? 'низька впевненість' : 'low confidence');
  const date = (value: number) => new Intl.DateTimeFormat(uk ? 'uk-UA' : 'en-GB', { day: 'numeric', month: 'short', timeZone: insights.workingPattern.timeZone }).format(value);
  const explanation = (text: string) => <details className="mt-2 text-xs text-neutral-400"><summary className="min-h-8 cursor-pointer">{uk ? 'Як це визначено' : 'How this is calculated'}</summary><p className="mt-1 leading-relaxed">{text}</p></details>;
  return <details open={open} onToggle={event => setOpen(event.currentTarget.open)} className="mb-6 border border-neutral-800 bg-[#0c0c0e] text-neutral-200">
    <summary className="cursor-pointer px-4 py-4 text-base font-semibold">{uk ? 'Підказки планування' : 'Planning insights'}
      {insights.prioritySuggestions.length > 0 && <span className="ml-3 inline-block text-sm font-normal text-amber-300">{uk ? 'Варто переглянути пріоритети' : 'Review priorities'}</span>}
    </summary>
    <div className="space-y-4 border-t border-neutral-800 p-4 text-sm leading-relaxed sm:p-5">
      <details className="text-neutral-400"><summary className="min-h-8 cursor-pointer">{uk ? 'Дані для прогнозів' : 'Forecast data'}: {insights.coverage.measured}/{insights.coverage.completed} {uk ? 'завершених завдань мають записаний час' : 'completed tasks have recorded time'}</summary><p className="mt-2">{insights.coverage.explanation}</p></details>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="border border-neutral-800 p-4">
          <h3 className="mb-2 text-base font-semibold">{uk ? 'Темп і пріоритети' : 'Pace and priorities'}</h3>
          <p className="text-neutral-300">{insights.workload.active} {uk ? 'активних' : 'active'} · {insights.workload.urgent} P1{insights.workload.observedDailyPace !== null && <> · {insights.workload.observedDailyPace.toFixed(1)} {uk ? 'завдання/день' : 'tasks/day'}</>}</p>
          {explanation(insights.workload.explanation)}
          {insights.prioritySuggestions.length > 0 && <p className="mt-2 text-xs text-amber-200">{uk ? 'Є ризик перевантаження. Перегляньте ці ще не розпочаті завдання.' : 'Possible overload. Review these unstarted tasks.'}</p>}
          {insights.prioritySuggestions.map(proposal => <div key={proposal.taskId} className="mt-3 border-t border-neutral-800 pt-3">
            <div className="flex flex-wrap items-center gap-3"><p className="min-w-0 flex-1 break-words font-semibold">{byId.get(proposal.taskId)?.title}</p><button type="button" onClick={() => onApplyPriority(proposal.taskId, proposal.currentPriority, proposal.suggestedPriority)} className="min-h-11 shrink-0 border border-neutral-600 px-3 hover:border-white">P{proposal.currentPriority} → P{proposal.suggestedPriority}</button></div>
            {explanation(proposal.explanation)}
          </div>)}
        </section>
        <section className="border border-neutral-800 p-4">
          <h3 className="mb-2 text-base font-semibold">{uk ? 'Перевищення часу' : 'Time overruns'}</h3>
          {!insights.bottlenecks.length && <p className="text-neutral-400">{uk ? 'Виміряних перевищень немає. Задайте план часу для порівняння.' : 'No measured overruns. Set expected time to compare.'}</p>}
          {insights.bottlenecks.slice(0, 5).map(item => <div key={`${item.taskId}:${item.stepId || 'task'}`} className="mt-3 border-l-2 border-amber-700 pl-3"><p className="break-words font-semibold">{item.title}</p><p className="mt-1 text-amber-200">{uk ? 'План' : 'Plan'} {minutes(item.estimatedSeconds)} {uk ? 'хв' : 'min'} · {uk ? 'Записано' : 'Recorded'} {minutes(item.recordedSeconds)} {uk ? 'хв' : 'min'}</p>{explanation(item.explanation)}</div>)}
        </section>
        <section className="border border-neutral-800 p-4">
          <h3 className="mb-2 text-base font-semibold">{uk ? 'Прогноз завершення' : 'Completion forecast'}</h3>
          {insights.queueForecast ? <div className="mb-3 border-l-2 border-emerald-600 pl-3"><p>{uk ? 'Поточна черга' : 'Current queue'}: {insights.queueForecast.lowerDays}–{insights.queueForecast.upperDays} {uk ? 'днів' : 'days'}</p><p className="mt-1 text-xs text-neutral-400">{date(insights.queueForecast.earliestAt)} — {date(insights.queueForecast.latestAt)} · {confidence(insights.queueForecast.confidence)}</p>{explanation(insights.queueForecast.explanation)}</div> : <p className="mb-3 text-neutral-400">{uk ? 'Для календарного прогнозу потрібна регулярна історія завершень за 4 тижні.' : 'Calendar forecasting needs a regular completion history across 4 weeks.'}</p>}
          {!insights.forecasts.length && <p className="text-neutral-400">{uk ? 'Для оцінки часу потрібно хоча б 3 виміряні завершені завдання в категорії.' : 'Effort estimates need at least 3 measured completed tasks in the category.'}</p>}
          {insights.forecasts.length > 0 && <details><summary className="min-h-11 cursor-pointer">{uk ? 'Орієнтовний час завдань' : 'Estimated task effort'} ({insights.forecasts.length})</summary>{insights.forecasts.map(item => <div key={item.taskId} className="border-t border-neutral-800 py-3"><p className="break-words font-semibold">{byId.get(item.taskId)?.title}</p><p className="mt-1">{item.remainingUpperSeconds === null ? (uk ? 'Залишок потребує нової оцінки' : 'Remaining work needs a new estimate') : `${uk ? 'Ще' : 'Remaining'} ${Math.ceil((item.remainingLowerSeconds || 0) / 60)}–${minutes(item.remainingUpperSeconds)} ${uk ? 'хв роботи' : 'minutes of work'}`}</p><p className="mt-1 text-xs text-neutral-400">{item.sampleCount} {uk ? 'виміряних прикладів' : 'measured examples'} · {confidence(item.confidence)}</p>{explanation(item.explanation)}</div>)}</details>}
          <p className="mt-2 text-xs text-neutral-400">{uk ? 'Це діапазони за історією, а не гарантовані дедлайни.' : 'Historical ranges, not guaranteed deadlines.'}</p>
        </section>
        <section className="border border-neutral-800 p-4">
          <h3 className="mb-2 text-base font-semibold">{uk ? 'Нагадування за графіком' : 'Schedule-aware reminders'}</h3>
          <label className="flex min-h-11 cursor-pointer items-center gap-3"><input type="checkbox" checked={remindersEnabled} onChange={event => onRemindersChange(event.target.checked)} className="h-5 w-5 shrink-0 accent-emerald-400" />{uk ? 'Нагадувати про пропущений початок' : 'Remind me about a missed start'}</label>
          {insights.workingPattern.observedHours.length > 0 ? <p className="mt-2 text-neutral-300">{uk ? 'Часті години' : 'Frequent hours'}: {insights.workingPattern.observedHours.map(item => `${String(item.hour).padStart(2, '0')}:00`).join(' · ')}</p> : <p className="mt-2 text-neutral-400">{uk ? 'Графік ще вивчається з історії роботи.' : 'Your working pattern is still being learned.'}</p>}
          <p className="mt-2 text-xs text-neutral-400">{uk ? 'Коли таймери на паузі, а додаток відкритий або в треї. Не частіше одного нагадування за 30 хв.' : 'While timers are paused and the app is open or in the tray. At most one reminder every 30 minutes.'}</p>
          {explanation(insights.workingPattern.explanation)}
        </section>
      </div>
      <details className="border-t border-neutral-800 pt-3"><summary className="min-h-11 cursor-pointer font-semibold">{uk ? 'Задати план часу завдань і кроків' : 'Set expected task and step time'}</summary><div className="max-h-64 overflow-y-auto">{active.length ? active.map(task => <div key={task.id} className="flex items-center gap-3 border-t border-neutral-800 py-2"><span className="min-w-0 flex-1 break-words">{task.title}</span><button type="button" onClick={() => onEditPlan(task.id)} className="min-h-11 shrink-0 border border-neutral-700 px-3">{uk ? 'План часу' : 'Time plan'}</button></div>) : <p className="text-neutral-400">{uk ? 'Активних завдань немає.' : 'No active tasks.'}</p>}</div></details>
      <button type="button" onClick={() => onReviewAI(uk ? 'Проаналізуй мій темп, ризик перевантаження, виміряні затримки кроків та прогноз завершення. Запропонуй перегляд пріоритетів із причинами, але не застосовуй зміни без мого підтвердження. Дай конкретні способи оптимізувати кроки й реалістичний план з урахуванням історії та пропусків в обліку.' : 'Analyze my pace, overload risk, measured step delays and completion outlook. Propose priority changes with reasons, without applying them before my confirmation. Suggest concrete step improvements and a realistic plan that accounts for history and missing measurements.')} className="min-h-11 border border-neutral-600 px-4 font-semibold hover:border-white">{uk ? 'Поглибити аналіз з AI' : 'Analyze further with AI'}</button>
      <p className="text-xs text-neutral-500">{uk ? 'Підказки обчислено з даних додатка. Зміни пріоритетів — після вашого натискання. Запит до AI — після надсилання в чаті.' : 'Insights come from app data. Priority changes require your click; AI requests require sending in chat.'}</p>
    </div>
  </details>;
};