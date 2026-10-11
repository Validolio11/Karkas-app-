import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Compass, MessageSquare, Play, RefreshCw, RotateCcw, X } from 'lucide-react';
import type { AIRecommendation, AnalyticsPeriod, DeletedTask, PersonalStrategyProfile, PSTask, TaskTab } from '../types';
import type { WorkInsights } from '../utils/workInsights';
import { WorkInsightsPanel } from './WorkInsightsPanel';
import { karkasApiFetch } from '../utils/desktopApi';
import { aiRequestErrorMessage } from './aiAssistantState';
import { TRANSLATIONS } from '../utils/i18n';
import { getPeriodBounds, selectPeriodTasks } from './workflowViewModel';
import { parseAIRecommendation } from '../utils/aiRecommendations';
import { updateStrategyMemoryEntry } from '../utils/personalStrategy';
import { isPersonalStrategyReady, STRATEGY_DISCOVERY_TOPICS, updateDiscoveryEvidence } from '../utils/strategyDiscovery';

const button = 'inline-flex min-h-11 sm:min-h-8 items-center justify-center gap-1.5 border border-neutral-700 px-2.5 py-1.5 text-xs font-semibold hover:border-white disabled:opacity-40';
const panel = 'min-w-0 border border-neutral-800 bg-[#09090b] p-3';
const accordion = 'min-w-0 border border-neutral-800 bg-[#09090b]';
const heading = 'text-[11px] font-bold uppercase tracking-wider text-neutral-300';
const summary = 'min-h-11 sm:min-h-8 cursor-pointer px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-neutral-300';
const field = 'mt-1 w-full min-h-11 sm:min-h-8 border border-neutral-700 bg-[#09090b] px-2 py-1.5 text-xs text-neutral-200';
function fingerprint(value: unknown) {
  const input = JSON.stringify(value); let hash = 2166136261;
  for (let i = 0; i < input.length; i++) hash = Math.imul(hash ^ input.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(36);
}
interface StrategyViewProps {
  ownerId: string | null; profile: PersonalStrategyProfile; tasks: PSTask[]; deletedTasks: DeletedTask[]; tabs: TaskTab[];
  lang: 'uk' | 'en'; insights: WorkInsights; remindersEnabled: boolean;
  onProfileChange: (profile: PersonalStrategyProfile) => void;
  onResetMemory: () => void; onChat: (text: string) => void; onStart: (id: string) => void; onDeepenDiscovery: () => void;
  onUndo: (id: string) => void; onRemindersChange: (value: boolean) => void;
  onApplyPriority: (id: string, from: 1 | 2 | 3, to: 1 | 2 | 3) => void; onEditPlan: (id: string) => void;
}
export const StrategyView: React.FC<StrategyViewProps> = (props: StrategyViewProps) => {
  const { profile, tasks, tabs, deletedTasks, insights, lang, ownerId, onProfileChange, onChat } = props;
  const uk = lang === 'uk';
  const discoveryReady = isPersonalStrategyReady(profile);
  const [period, setPeriod] = useState<AnalyticsPeriod>('THIS_MONTH');
  const [audit, setAudit] = useState<{ value: AIRecommendation; at: number; context: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const [feedback, setFeedback] = useState('');
  const controller = useRef<AbortController | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const update = () => setClock(Date.now());
    const visible = () => { if (document.visibilityState === 'visible') update(); };
    let boundaryTimer: ReturnType<typeof setTimeout>;
    const scheduleBoundary = () => {
      const nextDay = new Date(); nextDay.setHours(24, 0, 0, 0);
      boundaryTimer = setTimeout(() => { update(); scheduleBoundary(); }, Math.max(1, nextDay.getTime() - Date.now()));
    };
    scheduleBoundary();
    const timer = window.setInterval(update, 30_000);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', visible);
    return () => { clearTimeout(boundaryTimer); window.clearInterval(timer); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', visible); };
  }, []);
  const day = new Date(clock); day.setHours(0, 0, 0, 0);
  const dayBoundary = day.getTime();
  const calendarBounds = getPeriodBounds(period, day);
  const model = localStorage.getItem('karkas_custom_model') || 'default';
  const cacheKey = `karkas_strategy_audit_v1:${encodeURIComponent(ownerId === null ? 'guest' : `account:${ownerId}`)}:${period}:${lang}:${model}`;
  const context = useMemo(() => fingerprint([tasks, deletedTasks, tabs, profile.goals, profile.facts, profile.barriers, profile.preferences, profile.feedback, profile.discovery, calendarBounds.start, calendarBounds.end]),
    [tasks, deletedTasks, tabs, profile.goals, profile.facts, profile.barriers, profile.preferences, profile.feedback, profile.discovery, calendarBounds.start, calendarBounds.end]);
  const selected = useMemo(() => selectPeriodTasks(tasks, deletedTasks, period, new Date(clock)), [tasks, deletedTasks, period, clock]);
  const focus = tasks.find(task => (task.id === profile.latestStrategy?.focusTaskId || task.schedulePlanId === profile.latestStrategy?.focusTaskId) && !task.done && !task.scheduledPending);
  useEffect(() => {
    controller.current?.abort(); setLoading(false); setError(''); setAudit(null);
    try {
      const entry = JSON.parse(localStorage.getItem(cacheKey) || 'null');
      if (entry?.value && Number.isFinite(entry.at) && entry.at >= 0 && typeof entry.context === 'string') setAudit({ ...entry, value: parseAIRecommendation(entry.value) });
    } catch { /* Cache is optional and never initiates a provider request. */ }
    return () => controller.current?.abort();
  }, [cacheKey, dayBoundary]);
  const refreshAudit = async () => {
    controller.current?.abort(); const request = new AbortController(); controller.current = request;
    const snapshot = context; setLoading(true); setError('');
    try {
      const custom = localStorage.getItem('karkas_custom_ai_enabled') === 'true';
      const response = await karkasApiFetch('/api/ai/recommendations', { method: 'POST', signal: request.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tasks, deletedTasks, tabs, lang, period,
          strategyContext: profile, clientClock: { now: new Date().toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Kyiv' },
          customApiKey: custom ? localStorage.getItem('karkas_custom_api_key') || undefined : undefined,
          selectedModel: custom ? model : undefined }) });
      if (!response.ok) throw new Error(uk ? 'Не вдалося оновити аналіз. Спробуйте ще раз.' : 'Could not refresh the analysis. Try again.');
      let value: AIRecommendation;
      try { value = parseAIRecommendation(await response.json()); }
      catch { throw new Error(uk ? 'Некоректна відповідь аналізу.' : 'Invalid analysis response.'); }
      if (request.signal.aborted || controller.current !== request) return;
      const entry = { value, at: Date.now(), context: snapshot }; setAudit(entry);
      try { localStorage.setItem(cacheKey, JSON.stringify(entry)); } catch { setError(uk ? 'Аналіз доступний зараз, але його не вдалося зберегти.' : 'The analysis is available but could not be saved.'); }
    } catch (failure) {
      if (!request.signal.aborted && controller.current === request) setError(failure instanceof Error ? failure.message : aiRequestErrorMessage(failure, lang));
    } finally { if (controller.current === request) setLoading(false); }
  };
  const changeGoal = (id: string, patch: Partial<PersonalStrategyProfile['goals'][number]>) => onProfileChange({ ...profile, goals: profile.goals.map(goal => goal.id === id ? { ...goal, ...patch } : goal) });
  const periodLabel = TRANSLATIONS[lang].dashboardAnalytics.periods[period];
  const discuss = (text: string) => onChat(text);
  return <div className="space-y-3 text-[13px] text-neutral-200">
    <header className="flex flex-wrap items-center justify-between gap-2">
      <h1 className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-wider"><Compass className="h-4 w-4" />{uk ? 'Моя стратегія' : 'My strategy'}</h1>
      <div className="flex flex-wrap items-center gap-2">
      <button className={button} onClick={props.onDeepenDiscovery}>{uk ? 'Поглибити знайомство' : 'Get to know me better'}</button>
      <button className={`${button} bg-white text-black hover:bg-neutral-200`} onClick={() => discuss('')}>
        <MessageSquare className="h-4 w-4" />{discoveryReady ? (uk ? 'Відкрити ШІ-чат' : 'Open AI chat') : profile.onboardingStatus === 'new' ? (uk ? 'Познайомитися з ШІ' : 'Meet your assistant') : (uk ? 'Продовжити знайомство' : 'Continue introduction')}
      </button>
      </div>
    </header>
    {!discoveryReady && <p className="border-l border-neutral-700 pl-3 text-xs leading-relaxed text-neutral-400">{uk ? 'Знайомство проходить у ШІ-чаті: обговоріть свої цілі, мотиви й перешкоди у зручному темпі.' : 'Get to know your assistant in the AI chat: discuss your goals, motives and barriers at your own pace.'}</p>}

    <div className="grid gap-3 md:grid-cols-2">
      <section className={panel}>
        <h2 className={heading}>{uk ? 'Наступний крок' : 'Next step'}</h2>
        <p className="mt-2 whitespace-pre-wrap break-words text-[13px] leading-relaxed">{profile.latestStrategy?.nextAction || (uk ? 'Обговоріть із помічником, до якої цілі хочете рухатися зараз.' : 'Discuss which goal you want to work towards now.')}</p>
        {focus && <p className="mt-1 break-words text-xs text-neutral-400">{focus.title}</p>}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {focus && <button className={`${button} bg-white text-black hover:bg-neutral-200`} onClick={() => props.onStart(focus.id)}><Play className="h-4 w-4" />{uk ? 'Почати' : 'Start'}</button>}
          <button className={`${button} ${focus ? '' : 'bg-white text-black hover:bg-neutral-200'}`} onClick={() => discuss(uk ? 'Допоможи мені почати рух до поточної узгодженої цілі. Спершу зрозумій, що робить початок складним.' : 'Help me start working towards my agreed goal. First understand what makes starting difficult.')}>{uk ? 'Допоможи почати' : 'Help me start'}</button>
          {['Не хочу робити', 'Не почав', 'Я відволікся'].map((title, index) => <button key={title} className={button} onClick={() => discuss(uk ? `${title}${focus ? `: «${focus.title}»` : ''}. Запитай, що сталося, перш ніж перебудовувати план.` : `${['I do not want to do it', 'I did not start', 'I got distracted'][index]}${focus ? `: ${focus.title}` : ''}. Ask what happened before changing my plan.`)}>{uk ? title : ['Not now', 'Did not start', 'Got distracted'][index]}</button>)}
        </div>
      </section>
      <section className={panel}>
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className={heading}>{uk ? 'Стратегія від ШІ' : 'AI strategy'}</h2><button className={button} onClick={() => discuss(uk ? '@plan Переглянь наші узгоджені цілі, мої обставини й результати попередніх спроб. Запропонуй посильний наступний план.' : '@plan Review my agreed goals, circumstances and previous attempts. Adapt my next plan.')}>{uk ? 'Обговорити' : 'Discuss'}</button></div>
        <p className="mt-2 whitespace-pre-wrap break-words text-[13px] leading-relaxed">{profile.latestStrategy?.narrative || (uk ? 'Стратегія з’явиться після розмови про ваші цілі.' : 'Your strategy will appear after discussing your goals.')}</p>
        {profile.latestStrategy && <p className="mt-2 text-[11px] text-neutral-500">{new Date(profile.latestStrategy.updatedAt).toLocaleString(uk ? 'uk-UA' : 'en-GB')} · {profile.latestStrategy.source === 'rule-engine' ? (uk ? 'Локальна відповідь' : 'Local response') : (uk ? 'Збережена відповідь ШІ' : 'Saved AI response')}</p>}
      </section>
    </div>

    <section className={panel}>
      <h2 className={heading}>{uk ? 'Мої цілі' : 'My goals'}</h2>
      {!profile.goals.length && <p className="mt-2 text-xs text-neutral-400">{uk ? 'Цілі визначимо разом у чаті — незалежно від вашої професії.' : 'Define your goals together in chat, whatever your profession.'}</p>}
      {profile.goals.map(goal => <div key={goal.id} className="mt-2 border-t border-neutral-800 pt-2">
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="min-w-0 break-words text-[13px] font-semibold">{goal.title}</p><span className="text-[11px] text-neutral-500">{goal.agreed ? (uk ? 'Узгоджено' : 'Agreed') : (uk ? 'Потребує узгодження' : 'Needs agreement')}</span></div>
        {goal.motive && <p className="mt-1 truncate text-xs text-neutral-400" title={goal.motive}>{goal.motive}</p>}
        <details className="mt-1"><summary className="min-h-11 sm:min-h-8 cursor-pointer py-1.5 text-xs text-neutral-400">{uk ? 'Налаштувати ціль' : 'Edit goal'}</summary>
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            <label className="min-w-0 text-xs text-neutral-400">{uk ? 'Ціль' : 'Goal'}<input value={goal.title} onChange={event => changeGoal(goal.id, { title: event.target.value })} className={field} /></label>
            <label className="min-w-0 text-xs text-neutral-400">{uk ? 'Чому це важливо для мене' : 'Why it matters to me'}<textarea value={goal.motive} onChange={event => changeGoal(goal.id, { motive: event.target.value })} rows={2} className={field} /></label>
            <label className="flex min-h-11 sm:min-h-8 items-center gap-2 text-xs sm:col-span-2"><input type="checkbox" checked={goal.agreed} onChange={event => changeGoal(goal.id, { agreed: event.target.checked })} className="h-4 w-4 shrink-0 accent-white" />{uk ? 'Узгоджено: ШІ може адаптувати пов’язані завдання' : 'Agreed: AI may adapt related tasks'}</label>
            <details className="sm:col-span-2"><summary className="min-h-11 sm:min-h-8 cursor-pointer py-1.5 text-xs text-neutral-400">{uk ? 'Пов’язані категорії та завдання' : 'Related categories and tasks'}</summary><div className="mt-1 space-y-1">
              {tabs.map(tab => <label key={tab.id} className="flex min-h-11 sm:min-h-8 items-center gap-2 text-xs"><input type="checkbox" checked={goal.categoryIds.includes(tab.id)} onChange={event => changeGoal(goal.id, { categoryIds: event.target.checked ? [...goal.categoryIds, tab.id] : goal.categoryIds.filter(id => id !== tab.id) })} className="h-4 w-4 shrink-0 accent-white" />{tab.name}</label>)}
              <div className="max-h-48 overflow-auto border-t border-neutral-800 pt-1">{tasks.filter(task => !task.done).map(task => <label key={task.id} className="flex min-h-11 sm:min-h-8 items-center gap-2 text-xs"><input type="checkbox" checked={goal.taskIds.includes(task.id)} onChange={event => changeGoal(goal.id, { taskIds: event.target.checked ? [...goal.taskIds, task.id] : goal.taskIds.filter(id => id !== task.id) })} className="h-4 w-4 shrink-0 accent-white" /><span className="break-words">{task.title}</span></label>)}</div>
            </div></details>
          </div>
        </details>
      </div>)}
    </section>

    <section className={panel}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className={heading}>{uk ? 'ШІ-аудит періоду' : 'AI period review'}</h2>
        <div className="flex flex-wrap items-center gap-2"><label className="flex items-center gap-2 text-[11px] text-neutral-400"><span className="uppercase tracking-wider">{uk ? 'Період' : 'Period'}</span><select value={period} onChange={event => setPeriod(event.target.value as AnalyticsPeriod)} className="min-h-11 sm:min-h-8 min-w-0 border border-neutral-700 bg-[#09090b] px-2 text-xs text-neutral-200">{Object.entries(TRANSLATIONS[lang].dashboardAnalytics.periods).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          <button className={button} disabled={loading} onClick={refreshAudit}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />{loading ? (uk ? 'Аналізуємо…' : 'Analyzing…') : (uk ? 'Оновити аналіз' : 'Refresh analysis')}</button>
        </div>
      </div>
      <p className="mt-2 text-xs text-neutral-400">{periodLabel}: {selected.completedInPeriod.length + selected.deletedCompleted.length} {uk ? 'завершено' : 'completed'} · {selected.activeInPeriod.length} {uk ? 'активних' : 'active'}</p>
      {error && <p role="alert" className="mt-2 text-xs text-amber-300">{error}</p>}
      {audit ? <div className="mt-3 space-y-3 text-[13px] leading-relaxed">
        <p className="text-[11px] text-neutral-500">{new Date(audit.at).toLocaleString(uk ? 'uk-UA' : 'en-GB')} · {audit.value.source === 'gemini' ? 'AI' : (uk ? 'Локальний аналіз' : 'Local analysis')}{audit.context !== context && <span className="ml-2 text-amber-300">{uk ? 'Дані змінилися — аналіз потребує оновлення' : 'Data changed — refresh the analysis'}</span>}</p>
        {[['Підсумок', 'Review', audit.value.periodRetrospective || audit.value.focusAdvice], ['Перешкоди', 'Barriers', audit.value.dropoffAnalysis], ['Наступний підхід', 'Next approach', audit.value.futureStrategy || audit.value.optimizationTip]].map(([labelUk, labelEn, text]) => text && <div key={labelEn}><h3 className={heading}>{uk ? labelUk : labelEn}</h3><p className="mt-1 whitespace-pre-wrap break-words text-neutral-300">{text}</p></div>)}
        {audit.value.suggestedTasks.map((suggestion, index) => <div key={index} className="border-t border-neutral-800 pt-2"><p className="text-[13px] font-semibold">{suggestion.title}</p><p className="mt-1 text-xs text-neutral-400">{suggestion.reason}</p><button className={`${button} mt-2`} onClick={() => discuss(`@plan ${uk ? 'Обговорімо рекомендований крок' : 'Discuss this suggested step'}: ${suggestion.title}. ${suggestion.reason || ''}`)}>{uk ? 'Обговорити крок' : 'Discuss step'}</button></div>)}
      </div> : <p className="mt-2 text-[11px] text-neutral-500">{uk ? 'Оновіть аналіз, коли потрібен новий огляд.' : 'Refresh the analysis when you need a new review.'}</p>}
    </section>

    <WorkInsightsPanel insights={insights} tasks={tasks} lang={lang} remindersEnabled={props.remindersEnabled} onRemindersChange={props.onRemindersChange} onApplyPriority={props.onApplyPriority} onEditPlan={props.onEditPlan} onReviewAI={discuss} />

    <div className="grid items-start gap-3 md:grid-cols-2">
      <details className={accordion}>
        <summary className={summary}>{uk ? 'Персональні нагадування' : 'Personal reminders'}</summary>
        <div className="space-y-2 border-t border-neutral-800 p-3">
          <label className="flex min-h-11 sm:min-h-8 items-center gap-2 text-xs"><input type="checkbox" checked={profile.reminders.enabled} onChange={event => onProfileChange({ ...profile, reminders: { ...profile.reminders, enabled: event.target.checked } })} className="h-4 w-4 shrink-0 accent-white" />{uk ? 'Нагадувати за моїм графіком' : 'Remind me on my schedule'}</label>
          <div className="flex flex-wrap gap-2">{[0, 1].map(index => <label key={index} className="text-xs text-neutral-400">{uk ? 'Час' : 'Time'} {index + 1}<div className="mt-1 flex items-center gap-1"><input type="time" aria-label={`${uk ? 'Час нагадування' : 'Reminder time'} ${index + 1}`} value={profile.reminders.times[index] || ''} onChange={event => { const times = [...profile.reminders.times]; times[index] = event.target.value; onProfileChange({ ...profile, reminders: { ...profile.reminders, times: times.filter(Boolean) } }); }} className="min-h-11 sm:min-h-8 border border-neutral-700 bg-[#09090b] px-2 py-1.5 text-xs text-neutral-200" />{profile.reminders.times[index] && <button className="flex h-11 w-11 sm:h-8 sm:w-8 items-center justify-center border border-neutral-700 hover:border-white" aria-label={uk ? 'Прибрати час' : 'Remove time'} onClick={() => onProfileChange({ ...profile, reminders: { ...profile.reminders, times: profile.reminders.times.filter((_, i) => i !== index) } })}><X className="h-4 w-4" /></button>}</div></label>)}</div>
          <p className="text-[11px] leading-relaxed text-neutral-500">{uk ? 'До двох нагадувань на день, коли Karkas відкритий або в треї. Під час активного таймера додаткових спонукань немає.' : 'Up to two reminders daily while Karkas is open or in the tray. No additional nudges during an active timer.'}</p>
        </div>
      </details>
      <details className={accordion}>
        <summary className={summary}>{uk ? 'Що мені допомагає' : 'What helps me'}</summary>
        <div className="space-y-2 border-t border-neutral-800 p-3">
          <div className="flex flex-wrap gap-1.5">{['Допомогло', 'Не допомогло', 'Не спробував'].map((text, index) => <button key={text} className={button} onClick={() => discuss(uk ? `${text}. Давай обговоримо результат останнього підходу.` : `${['It helped', 'It did not help', 'I did not try it'][index]}. Let us discuss the latest approach.`)}>{uk ? text : ['Helped', 'Did not help', 'Did not try'][index]}</button>)}</div>
          <label className="block text-xs text-neutral-400">{uk ? 'Мій результат або спостереження' : 'My result or observation'}<textarea value={feedback} onChange={event => setFeedback(event.target.value)} rows={2} className={field} /></label>
          <button className={button} disabled={!feedback.trim()} onClick={() => { onProfileChange({ ...profile, feedback: [...profile.feedback, { id: `feedback-${Date.now()}`, text: feedback.trim(), createdAt: Date.now() }].slice(-200) }); setFeedback(''); }}>{uk ? 'Зберегти спостереження' : 'Save observation'}</button>
          {profile.feedback.slice(-5).reverse().map(item => <p key={item.id} className="break-words border-t border-neutral-800 pt-2 text-xs text-neutral-400">{item.text}</p>)}
        </div>
      </details>
      <details className={accordion}>
        <summary className={summary}>{uk ? 'Пам’ять помічника' : 'Assistant memory'}</summary>
        <div className="space-y-3 border-t border-neutral-800 p-3">
          <p className="text-[11px] leading-relaxed text-neutral-500">{uk ? 'На цьому пристрої, окремо для вашого акаунта. Припущення можна підтвердити редагуванням або видалити.' : 'Stored on this device for your account. Edit a hypothesis to confirm it, or remove it.'}</p>
          {profile.discovery && <div className="space-y-2"><h3 className={heading}>{uk ? 'Відповіді під час знайомства' : 'Getting-to-know-you answers'}</h3>
            {STRATEGY_DISCOVERY_TOPICS.map((topic, index) => {
              const answer = profile.discovery!.topics[topic];
              const latest = answer.evidence.at(-1);
              if (!latest) return null;
              const label = (uk ? ['Бажані зміни', 'Особистий сенс', 'Обставини', 'Перешкоди', 'Реальні можливості', 'Попередні спроби'] : ['Desired changes', 'Personal meaning', 'Circumstances', 'Obstacles', 'Actual capacity', 'Previous attempts'])[index];
              return <div key={topic}><label className="block text-[11px] text-neutral-500">{label}{answer.status === 'deferred' ? (uk ? ' · залишено приватним' : ' · kept private') : ''}
                <textarea rows={2} value={latest.quote} onChange={event => onProfileChange(updateDiscoveryEvidence(profile, topic, event.target.value))} className={field} /></label>
                <button className={`${button} mt-1`} onClick={() => onProfileChange(updateDiscoveryEvidence(profile, topic, ''))}>{uk ? 'Видалити відповідь' : 'Remove answer'}</button></div>;
            })}
          </div>}
          {(['facts', 'barriers', 'preferences'] as const).map((group, index) => <div key={group}><h3 className={heading}>{uk ? ['Ваші слова й обставини', 'Перешкоди', 'Робочі уподобання'][index] : ['Your statements and circumstances', 'Barriers', 'Working preferences'][index]}</h3>{!profile[group].length && <p className="mt-1 text-xs text-neutral-500">{uk ? 'Ще немає записів.' : 'No entries yet.'}</p>}{profile[group].map(entry => <div key={entry.id} className="mt-2"><label className="block text-[11px] text-neutral-500">{entry.source === 'user' ? (uk ? 'Ваша відповідь' : 'Your statement') : (uk ? 'Припущення ШІ' : 'AI hypothesis')}<textarea rows={2} value={entry.text} onChange={event => onProfileChange(updateStrategyMemoryEntry(profile, group, entry.id, event.target.value))} className={field} /></label><button className={`${button} mt-1`} onClick={() => onProfileChange(updateStrategyMemoryEntry(profile, group, entry.id, ''))}>{uk ? 'Видалити запис' : 'Remove entry'}</button></div>)}</div>)}
          <div className="border-t border-neutral-800 pt-2">{confirmReset ? <div className="space-y-2"><p className="text-xs leading-relaxed">{uk ? 'Очистити персональну пам’ять і почати знайомство заново? Завдання та історія чату збережуться.' : 'Clear personal memory and restart the introduction? Tasks and chat history will remain.'}</p><div className="flex flex-wrap gap-2"><button className={button} onClick={() => { props.onResetMemory(); setConfirmReset(false); }}>{uk ? 'Очистити пам’ять' : 'Clear memory'}</button><button className={button} onClick={() => setConfirmReset(false)}>{uk ? 'Скасувати' : 'Cancel'}</button></div></div> : <button className={button} onClick={() => setConfirmReset(true)}>{uk ? 'Очистити пам’ять і почати заново' : 'Clear memory and start again'}</button>}</div>
        </div>
      </details>
      <details className={accordion}>
        <summary className={summary}>{uk ? 'Історія змін плану' : 'Plan change history'} ({profile.actionHistory.length})</summary>
        <div className="space-y-2 border-t border-neutral-800 p-3">
          {!profile.actionHistory.length && <p className="text-xs text-neutral-500">{uk ? 'Автоматичних змін ще немає.' : 'No automatic changes yet.'}</p>}
          {profile.actionHistory.slice(-30).reverse().map(action => <div key={action.id} className="border-t border-neutral-800 pt-2 first:border-t-0 first:pt-0"><p className="break-words text-[13px] font-semibold">{action.after.title}</p><p className="mt-1 break-words text-xs text-neutral-400">{action.reason}</p><p className="mt-1 text-[11px] text-neutral-500">{new Date(action.appliedAt).toLocaleString(uk ? 'uk-UA' : 'en-GB')}</p>{action.undoneAt ? <p className="mt-1 text-[11px] text-neutral-500">{uk ? 'Скасовано' : 'Undone'}</p> : <button className={`${button} mt-2`} onClick={() => props.onUndo(action.id)}><RotateCcw className="h-4 w-4" />{uk ? 'Скасувати зміну' : 'Undo change'}</button>}</div>)}
        </div>
      </details>
    </div>
  </div>;
};
