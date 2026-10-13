import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare, RefreshCw } from 'lucide-react';
import type { AIRecommendation, AnalyticsPeriod, DeletedTask, PersonalStrategyProfile, PSTask, TaskTab } from '../types';
import { karkasApiFetch } from '../utils/desktopApi';
import { aiRequestErrorMessage } from './aiAssistantState';
import { TRANSLATIONS } from '../utils/i18n';
import { getPeriodBounds, selectPeriodTasks } from './workflowViewModel';
import { parseAIRecommendation } from '../utils/aiRecommendations';
import { formatRecordedDuration } from '../utils/taskTimeStats';
import { periodAuditStats } from './strategyViewModel';
import { btn, Chip, heading, Meter, monoLabel, panel, SectionTitle } from './strategyUi';

const PERIODS: AnalyticsPeriod[] = ['THIS_MONTH', 'LAST_30_DAYS', 'THIS_YEAR', 'LAST_YEAR', 'ALL_TIME'];
function fingerprint(value: unknown) {
  const input = JSON.stringify(value); let hash = 2166136261;
  for (let i = 0; i < input.length; i++) hash = Math.imul(hash ^ input.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(36);
}

/** Period stats are local; the AI review is requested only by «Оновити аналіз» and cached per period. */
export const StrategyAudit: React.FC<{
  ownerId: string | null; profile: PersonalStrategyProfile; tasks: PSTask[]; deletedTasks: DeletedTask[]; tabs: TaskTab[];
  lang: 'uk' | 'en'; clock: number; onChat: (text: string) => void;
}> = ({ ownerId, profile, tasks, deletedTasks, tabs, lang, clock, onChat }) => {
  const uk = lang === 'uk';
  const [period, setPeriod] = useState<AnalyticsPeriod>('THIS_MONTH');
  const [audit, setAudit] = useState<{ value: AIRecommendation; at: number; context: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const day = new Date(clock); day.setHours(0, 0, 0, 0);
  const dayBoundary = day.getTime();
  const calendarBounds = getPeriodBounds(period, day);
  const model = localStorage.getItem('karkas_custom_model') || 'default';
  const cacheKey = `karkas_strategy_audit_v1:${encodeURIComponent(ownerId === null ? 'guest' : `account:${ownerId}`)}:${period}:${lang}:${model}`;
  const context = useMemo(() => fingerprint([tasks, deletedTasks, tabs, profile.goals, profile.facts, profile.barriers, profile.preferences, profile.feedback, profile.discovery, calendarBounds.start, calendarBounds.end]),
    [tasks, deletedTasks, tabs, profile.goals, profile.facts, profile.barriers, profile.preferences, profile.feedback, profile.discovery, calendarBounds.start, calendarBounds.end]);
  const selected = useMemo(() => selectPeriodTasks(tasks, deletedTasks, period, new Date(clock)), [tasks, deletedTasks, period, clock]);
  const stats = periodAuditStats(selected, clock);
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
  const labels = TRANSLATIONS[lang].dashboardAnalytics.periods;
  const stale = !!audit && audit.context !== context;
  const tiles: { label: string; value: string; tone: string; hint?: string }[] = [
    { label: uk ? 'Завершено' : 'Completed', value: String(stats.completed), tone: stats.completed ? 'text-emerald-300' : 'text-white' },
    { label: uk ? 'Активні' : 'Active', value: String(stats.active), tone: 'text-white' },
    { label: uk ? 'Прострочені' : 'Overdue', value: String(stats.overdue), tone: stats.overdue ? 'text-red-400' : 'text-neutral-400' },
    { label: uk ? 'Витрачено часу' : 'Time spent', value: stats.trackedSeconds === null ? '—' : formatRecordedDuration(stats.trackedSeconds, lang), tone: 'text-white',
      hint: stats.trackedSeconds === null ? (uk ? 'таймер ще не вмикали' : 'no timer data yet') : undefined },
  ];

  return <section aria-labelledby="strategy-audit-title" className={panel}>
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <SectionTitle id="strategy-audit-title">{uk ? 'ШІ-аудит періоду' : 'AI period review'}</SectionTitle>
      <button type="button" className={btn} disabled={loading} aria-busy={loading} onClick={refreshAudit}>
        <RefreshCw aria-hidden="true" className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />{loading ? (uk ? 'Аналізуємо…' : 'Analyzing…') : audit ? (uk ? 'Оновити аналіз' : 'Refresh analysis') : (uk ? 'Запустити аналіз' : 'Run analysis')}
      </button>
    </div>

    <div role="group" aria-label={uk ? 'Період' : 'Period'} className="mt-3 grid grid-cols-2 gap-1 sm:flex sm:flex-wrap sm:items-center">
      {PERIODS.map((id, index) => <button key={id} type="button" aria-pressed={period === id} onClick={() => setPeriod(id)}
        className={`min-h-11 sm:min-h-8 min-w-0 border px-2.5 py-1.5 text-center text-[11px] font-bold uppercase leading-tight tracking-wider transition-colors motion-reduce:transition-none sm:whitespace-nowrap ${index === PERIODS.length - 1 ? 'col-span-2' : ''} ${period === id ? 'border-white bg-white text-black' : 'border-neutral-800 text-neutral-400 hover:border-neutral-600 hover:bg-neutral-900 hover:text-neutral-200'}`}>
        {labels[id]}
      </button>)}
    </div>

    <dl className="mt-3 grid grid-cols-2 gap-px overflow-hidden border border-neutral-800 bg-neutral-800 md:grid-cols-4">
      {tiles.map(tile => <div key={tile.label} className="min-w-0 bg-[#09090b] p-3">
        <dt className={monoLabel}>{tile.label}</dt>
        <dd className={`mt-1 break-words text-xl font-bold tabular-nums ${tile.tone}`}>{tile.value}</dd>
        {tile.hint && <dd className="mt-0.5 text-[11px] text-neutral-500">{tile.hint}</dd>}
      </div>)}
    </dl>
    <div className="mt-3">
      <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[11px] text-neutral-400">
        <span>{uk ? 'Частка завершених завдань періоду' : 'Share of period tasks completed'}</span>
        <span className="font-mono font-bold text-neutral-300">{stats.completionPercent}%</span>
      </div>
      <Meter value={stats.completionPercent} label={uk ? 'Частка завершених завдань періоду' : 'Share of period tasks completed'} />
    </div>

    {error && <p role="alert" className="mt-3 text-xs text-amber-300">{error}</p>}
    {audit ? <div className="mt-4 space-y-3 border-t border-neutral-800 pt-3 text-[13px] leading-relaxed">
      <p className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">
        <span>{new Date(audit.at).toLocaleString(uk ? 'uk-UA' : 'en-GB')} · {audit.value.source === 'gemini' ? 'AI' : (uk ? 'Локальний аналіз' : 'Local analysis')}</span>
        {stale && <Chip tone="amber">{uk ? 'Дані змінилися — оновіть аналіз' : 'Data changed — refresh the analysis'}</Chip>}
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        {([['Підсумок', 'Review', audit.value.periodRetrospective || audit.value.focusAdvice], ['Перешкоди', 'Barriers', audit.value.dropoffAnalysis], ['Наступний підхід', 'Next approach', audit.value.futureStrategy || audit.value.optimizationTip]] as const)
          .map(([labelUk, labelEn, text]) => text && <div key={labelEn} className="min-w-0 border-l-2 border-neutral-700 pl-3">
            <h3 className={heading}>{uk ? labelUk : labelEn}</h3><p className="mt-1 whitespace-pre-wrap break-words text-neutral-300">{text}</p>
          </div>)}
      </div>
      {audit.value.suggestedTasks.length > 0 && <div>
        <h3 className={heading}>{uk ? 'Рекомендовані кроки' : 'Suggested steps'} <span className="font-mono font-normal text-neutral-500">{audit.value.suggestedTasks.length}</span></h3>
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {audit.value.suggestedTasks.map((suggestion, index) => <li key={index} className="flex min-w-0 flex-col border border-neutral-800 p-3 transition-colors hover:border-neutral-700 motion-reduce:transition-none">
            <p className="break-words text-[13px] font-semibold text-white">{suggestion.title}</p>
            {suggestion.reason && <p className="mt-1 break-words text-xs text-neutral-400">{suggestion.reason}</p>}
            <div className="mt-auto pt-2"><button type="button" className={btn}
              onClick={() => onChat(`@plan ${uk ? 'Обговорімо рекомендований крок' : 'Discuss this suggested step'}: ${suggestion.title}. ${suggestion.reason || ''}`)}>
              <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />{uk ? 'Обговорити крок' : 'Discuss step'}
            </button></div>
          </li>)}
        </ul>
      </div>}
    </div> : !error && <p className="mt-3 text-[11px] text-neutral-500">{uk ? 'Цифри вище рахуються локально. ШІ-огляд запускається лише за вашим запитом.' : 'The numbers above are local. The AI review runs only when you ask.'}</p>}
  </section>;
};
