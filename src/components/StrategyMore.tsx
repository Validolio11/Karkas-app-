import React from 'react';
import { ArrowRight, RotateCcw, X } from 'lucide-react';
import type { PersonalStrategyProfile, PSTask } from '../types';
import type { WorkInsights } from '../utils/workInsights';
import { WorkInsightsPanel } from './WorkInsightsPanel';
import { updateStrategyMemoryEntry } from '../utils/personalStrategy';
import { STRATEGY_DISCOVERY_TOPICS, updateDiscoveryEvidence } from '../utils/strategyDiscovery';
import { memoryEntryCount } from './strategyViewModel';
import { btn, chipBtn, Collapsible, field, heading, monoLabel } from './strategyUi';

/** Secondary tools of «Моя стратегія»; empty sections stay hidden. */
export const StrategyMore: React.FC<{
  profile: PersonalStrategyProfile; tasks: PSTask[]; insights: WorkInsights; lang: 'uk' | 'en'; remindersEnabled: boolean;
  feedback: string; onFeedbackChange: (value: string) => void; confirmReset: boolean; onConfirmResetChange: (value: boolean) => void;
  onProfileChange: (profile: PersonalStrategyProfile) => void; onResetMemory: () => void; onUndo: (id: string) => void;
  onChat: (text: string) => void; onOpenTask: (id: string) => void; onRemindersChange: (value: boolean) => void;
  onApplyPriority: (id: string, from: 1 | 2 | 3, to: 1 | 2 | 3) => void; onEditPlan: (id: string) => void;
}> = props => {
  const { profile, lang, onProfileChange, onChat, feedback, onFeedbackChange, confirmReset, onConfirmResetChange } = props;
  const uk = lang === 'uk';
  const memoryCount = memoryEntryCount(profile);
  const showMemory = memoryCount > 0 || profile.goals.length > 0 || !!profile.latestStrategy || profile.onboardingStatus !== 'new';
  const history = profile.actionHistory;
  const pendingUndo = history.filter(action => !action.undoneAt).length;
  const taskIds = new Set(props.tasks.map(task => task.id));
  const reminders = profile.reminders;
  const reminderHint = reminders.enabled ? `${uk ? 'Увімк.' : 'On'}${reminders.times.length ? ` · ${reminders.times.join(' · ')}` : ''}` : (uk ? 'Вимк.' : 'Off');

  const parts = [uk ? 'Підказки' : 'Insights', uk ? 'Нагадування' : 'Reminders', uk ? 'Що допомагає' : 'What helps',
    ...(showMemory ? [uk ? 'Пам’ять' : 'Memory'] : []), ...(history.length ? [uk ? 'Історія' : 'History'] : [])];
  const hint = props.insights.prioritySuggestions.length > 0
    ? <span className="text-amber-300">{uk ? 'Варто переглянути пріоритети' : 'Review priorities'}</span> : parts.join(' · ');

  return <Collapsible title={uk ? 'Пам’ять і налаштування' : 'Memory and settings'} hint={hint} bodyClassName="space-y-2 p-2 sm:p-3">
    <WorkInsightsPanel insights={props.insights} tasks={props.tasks} lang={lang} remindersEnabled={props.remindersEnabled} onRemindersChange={props.onRemindersChange}
      onApplyPriority={props.onApplyPriority} onEditPlan={props.onEditPlan} onReviewAI={onChat} />
    <div className="grid items-start gap-2 md:grid-cols-2">
      <Collapsible title={uk ? 'Персональні нагадування' : 'Personal reminders'} hint={<span className={reminders.enabled ? 'text-emerald-300' : ''}>{reminderHint}</span>}>
        <div className="space-y-2">
          <label className="flex min-h-11 sm:min-h-8 items-center gap-2 text-xs"><input type="checkbox" checked={reminders.enabled} onChange={event => onProfileChange({ ...profile, reminders: { ...reminders, enabled: event.target.checked } })} className="h-4 w-4 shrink-0 accent-white" />{uk ? 'Нагадувати за моїм графіком' : 'Remind me on my schedule'}</label>
          <div className="flex flex-wrap gap-2">{[0, 1].map(index => <label key={index} className="text-xs text-neutral-400">{uk ? 'Час' : 'Time'} {index + 1}<div className="mt-1 flex items-center gap-1">
            <input type="time" aria-label={`${uk ? 'Час нагадування' : 'Reminder time'} ${index + 1}`} value={reminders.times[index] || ''} onChange={event => { const times = [...reminders.times]; times[index] = event.target.value; onProfileChange({ ...profile, reminders: { ...reminders, times: times.filter(Boolean) } }); }} className="min-h-11 sm:min-h-8 border border-neutral-700 bg-[#09090b] px-2 py-1.5 text-xs text-neutral-200" />
            {reminders.times[index] && <button type="button" className="flex h-11 w-11 sm:h-8 sm:w-8 items-center justify-center border border-neutral-700 hover:border-white" aria-label={uk ? 'Прибрати час' : 'Remove time'} onClick={() => onProfileChange({ ...profile, reminders: { ...reminders, times: reminders.times.filter((_, i) => i !== index) } })}><X className="h-4 w-4" /></button>}
          </div></label>)}</div>
          <p className="text-[11px] leading-relaxed text-neutral-500">{uk ? 'До двох нагадувань на день, коли Karkas відкритий або в треї. Під час активного таймера додаткових спонукань немає.' : 'Up to two reminders daily while Karkas is open or in the tray. No additional nudges during an active timer.'}</p>
        </div>
      </Collapsible>

      <Collapsible title={uk ? 'Що мені допомагає' : 'What helps me'} count={profile.feedback.length || undefined}>
        <div className="space-y-2">
          <p className={monoLabel}>{uk ? 'Як пройшов останній підхід?' : 'How did the last approach go?'}</p>
          <div className="flex flex-wrap gap-1.5">{['Допомогло', 'Не допомогло', 'Не спробував'].map((text, index) => <button key={text} type="button" className={chipBtn} onClick={() => onChat(uk ? `${text}. Давай обговоримо результат останнього підходу.` : `${['It helped', 'It did not help', 'I did not try it'][index]}. Let us discuss the latest approach.`)}>{uk ? text : ['Helped', 'Did not help', 'Did not try'][index]}</button>)}</div>
          <label className="block text-xs text-neutral-400">{uk ? 'Мій результат або спостереження' : 'My result or observation'}<textarea value={feedback} onChange={event => onFeedbackChange(event.target.value)} rows={2} className={field} /></label>
          <button type="button" className={btn} disabled={!feedback.trim()} onClick={() => { onProfileChange({ ...profile, feedback: [...profile.feedback, { id: `feedback-${Date.now()}`, text: feedback.trim(), createdAt: Date.now() }].slice(-200) }); onFeedbackChange(''); }}>{uk ? 'Зберегти спостереження' : 'Save observation'}</button>
          {profile.feedback.slice(-5).reverse().map(item => <p key={item.id} className="break-words border-t border-neutral-800 pt-2 text-xs text-neutral-400">{item.text}</p>)}
        </div>
      </Collapsible>

      {showMemory && <Collapsible title={uk ? 'Пам’ять помічника' : 'Assistant memory'} count={memoryCount}>
        <div className="space-y-3">
          <p className="text-[11px] leading-relaxed text-neutral-500">{uk ? 'На цьому пристрої, окремо для вашого акаунта. Припущення можна підтвердити редагуванням або видалити.' : 'Stored on this device for your account. Edit a hypothesis to confirm it, or remove it.'}</p>
          {profile.discovery && STRATEGY_DISCOVERY_TOPICS.some(topic => profile.discovery!.topics[topic]?.evidence.length) && <div className="space-y-2"><h4 className={heading}>{uk ? 'Відповіді під час знайомства' : 'Getting-to-know-you answers'}</h4>
            {STRATEGY_DISCOVERY_TOPICS.map((topic, index) => {
              const answer = profile.discovery!.topics[topic];
              const latest = answer?.evidence.at(-1);
              if (!latest) return null;
              const label = (uk ? ['Бажані зміни', 'Особистий сенс', 'Обставини', 'Перешкоди', 'Реальні можливості', 'Попередні спроби'] : ['Desired changes', 'Personal meaning', 'Circumstances', 'Obstacles', 'Actual capacity', 'Previous attempts'])[index];
              return <div key={topic}><label className="block text-[11px] text-neutral-500">{label}{answer.status === 'deferred' ? (uk ? ' · залишено приватним' : ' · kept private') : ''}
                <textarea rows={2} value={latest.quote} onChange={event => onProfileChange(updateDiscoveryEvidence(profile, topic, event.target.value))} className={field} /></label>
                <button type="button" className={`${btn} mt-1`} onClick={() => onProfileChange(updateDiscoveryEvidence(profile, topic, ''))}>{uk ? 'Видалити відповідь' : 'Remove answer'}</button></div>;
            })}
          </div>}
          {(['facts', 'barriers', 'preferences'] as const).filter(group => profile[group].length).map(group => <div key={group}>
            <h4 className={heading}>{uk ? { facts: 'Ваші слова й обставини', barriers: 'Перешкоди', preferences: 'Робочі уподобання' }[group] : { facts: 'Your statements and circumstances', barriers: 'Barriers', preferences: 'Working preferences' }[group]} <span className="font-mono font-normal text-neutral-500">{profile[group].length}</span></h4>
            {profile[group].map(entry => <div key={entry.id} className="mt-2"><label className="block text-[11px] text-neutral-500">{entry.source === 'user' ? (uk ? 'Ваша відповідь' : 'Your statement') : (uk ? 'Припущення ШІ' : 'AI hypothesis')}<textarea rows={2} value={entry.text} onChange={event => onProfileChange(updateStrategyMemoryEntry(profile, group, entry.id, event.target.value))} className={field} /></label><button type="button" className={`${btn} mt-1`} onClick={() => onProfileChange(updateStrategyMemoryEntry(profile, group, entry.id, ''))}>{uk ? 'Видалити запис' : 'Remove entry'}</button></div>)}
          </div>)}
          {memoryCount === 0 && <p className="text-xs text-neutral-500">{uk ? 'Ще немає записів.' : 'No entries yet.'}</p>}
          <div className="border-t border-neutral-800 pt-2">{confirmReset ? <div className="space-y-2"><p className="text-xs leading-relaxed">{uk ? 'Очистити персональну пам’ять і почати знайомство заново? Завдання та історія чату збережуться.' : 'Clear personal memory and restart the introduction? Tasks and chat history will remain.'}</p><div className="flex flex-wrap gap-2"><button type="button" className={`${btn} border-red-900/70 text-red-300 hover:border-red-500`} onClick={() => { props.onResetMemory(); onConfirmResetChange(false); }}>{uk ? 'Очистити пам’ять' : 'Clear memory'}</button><button type="button" className={btn} onClick={() => onConfirmResetChange(false)}>{uk ? 'Скасувати' : 'Cancel'}</button></div></div> : <button type="button" className={btn} onClick={() => onConfirmResetChange(true)}>{uk ? 'Очистити пам’ять і почати заново' : 'Clear memory and start again'}</button>}</div>
        </div>
      </Collapsible>}

      {history.length > 0 && <Collapsible title={uk ? 'Історія змін плану' : 'Plan change history'} count={history.length} hint={pendingUndo ? `${pendingUndo} ${uk ? 'можна скасувати' : 'can be undone'}` : undefined}>
        <ol className="space-y-2">
          {history.slice(-30).reverse().map(action => <li key={action.id} className="border-t border-neutral-800 pt-2 first:border-t-0 first:pt-0">
            {taskIds.has(action.taskId) ? <button type="button" onClick={() => props.onOpenTask(action.taskId)} className="group flex max-w-full items-start gap-1.5 text-left text-[13px] font-semibold text-white"><span className="break-words group-hover:underline">{action.after.title}</span><ArrowRight aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-500 group-hover:text-white" /></button>
              : <p className="break-words text-[13px] font-semibold">{action.after.title}</p>}
            <p className="mt-1 break-words text-xs text-neutral-400">{action.reason}</p>
            <p className="mt-1 font-mono text-[11px] text-neutral-500">{new Date(action.appliedAt).toLocaleString(uk ? 'uk-UA' : 'en-GB')}</p>
            {action.undoneAt ? <p className="mt-1 text-[11px] text-neutral-500">{uk ? 'Скасовано' : 'Undone'}</p> : <button type="button" className={`${btn} mt-2`} onClick={() => props.onUndo(action.id)}><RotateCcw className="h-4 w-4" />{uk ? 'Скасувати зміну' : 'Undo change'}</button>}
          </li>)}
        </ol>
      </Collapsible>}
    </div>
  </Collapsible>;
};
