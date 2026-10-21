import React, { useEffect, useMemo, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { AIIcon } from './AIIconTemplates';
import type { DeletedTask, PersonalStrategyProfile, PSTask, TaskTab } from '../types';
import type { WorkInsights } from '../utils/workInsights';
import { readDiscoveryMode } from './aiDiscoveryMode';
import { isPersonalStrategyReady } from '../utils/strategyDiscovery';
import { discoveryCta, discoveryProgress, needsStrategyOnboarding, rankNextStepCandidates } from './strategyViewModel';
import { btn, Chip, ghostBtn, monoLabel, panel, primaryBtn, SectionTitle, SegmentBar } from './strategyUi';
import { StrategyNextStep } from './StrategyNextStep';
import type { CountdownExpiryActions } from './CountdownExpiryNotice';
import { StrategyGoals } from './StrategyGoals';
import { StrategyAudit } from './StrategyAudit';
import { StrategyMore } from './StrategyMore';
import { PageGrid, PageHead } from './pulse/PageShell';

interface StrategyViewProps extends CountdownExpiryActions {
  ownerId: string | null; profile: PersonalStrategyProfile; tasks: PSTask[]; deletedTasks: DeletedTask[]; tabs: TaskTab[];
  lang: 'uk' | 'en'; insights: WorkInsights; remindersEnabled: boolean;
  onProfileChange: (profile: PersonalStrategyProfile) => void;
  onResetMemory: () => void; onChat: (text: string) => void; onStart: (id: string) => void; onDeepenDiscovery: () => void;
  onPauseTimer: (id: string) => void; onOpenTask: (id: string) => void; onOpenAdd: () => void;
  onLimitedStart: (id: string, capSeconds: number, options?: { continued?: boolean }) => void;
  onFinishLimitedStart: (id: string) => void; attemptsSummary: { count: number; seconds: number };
  onUndo: (id: string) => void; onRemindersChange: (value: boolean) => void;
  onApplyPriority: (id: string, from: 1 | 2 | 3, to: 1 | 2 | 3) => void; onEditPlan: (id: string) => void;
}

const LONG_NARRATIVE = 320;

export const StrategyView: React.FC<StrategyViewProps> = (props: StrategyViewProps) => {
  const { profile, tasks, tabs, lang, ownerId, onProfileChange, onChat } = props;
  const uk = lang === 'uk';
  const [confirmReset, setConfirmReset] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [narrativeOpen, setNarrativeOpen] = useState(false);
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

  const ready = isPersonalStrategyReady(profile);
  const onboarding = needsStrategyOnboarding(profile);
  const progress = discoveryProgress(profile);
  let interviewActive = false;
  try { interviewActive = readDiscoveryMode(localStorage, ownerId).active; } catch { /* Storage is optional. */ }
  const cta = discoveryCta(profile, interviewActive);
  const runDiscovery = () => cta === 'continue' ? onChat('') : props.onDeepenDiscovery();
  const ctaLabel = cta === 'continue' ? (uk ? 'Продовжити знайомство' : 'Continue introduction') : (uk ? 'Поглибити знайомство' : 'Get to know me better');
  const candidates = useMemo(() => rankNextStepCandidates(tasks, profile.latestStrategy?.focusTaskId, clock), [tasks, profile.latestStrategy?.focusTaskId, clock]);
  const changeGoal = (id: string, patch: Partial<PersonalStrategyProfile['goals'][number]>) => onProfileChange({ ...profile, goals: profile.goals.map(goal => goal.id === id ? { ...goal, ...patch } : goal) });
  const discoveryBar = <div className="flex items-center gap-3">
    <span className="text-xs text-neutral-400">{uk ? 'Знайомство' : 'Introduction'}</span>
    <SegmentBar className="w-28" segments={progress.statuses.map(status => status === 'answered' ? 'on' : status === 'deferred' ? 'partial' : 'off')}
      label={uk ? 'Теми знайомства' : 'Introduction topics'} valueText={`${progress.answered}/${progress.total}`} />
    <span className={`${monoLabel} tabular-nums`}>{progress.answered}/{progress.total}</span>
  </div>;
  const planPrompt = uk ? '@plan Переглянь наші узгоджені цілі, мої обставини й результати попередніх спроб. Запропонуй посильний наступний план.' : '@plan Review my agreed goals, circumstances and previous attempts. Adapt my next plan.';
  const narrative = profile.latestStrategy?.narrative;
  const longNarrative = !!narrative && narrative.length > LONG_NARRATIVE;

  const sideCard = onboarding
    ? <section aria-labelledby="strategy-onboarding-title" className={`${panel} flex flex-col`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle id="strategy-onboarding-title">{uk ? 'Стратегія під вас' : 'A strategy that fits you'}</SectionTitle>
        {cta === 'continue' ? <Chip tone="green">{uk ? 'Режим знайомства' : 'Getting to know you'}</Chip> : <Chip>{uk ? 'Почніть тут' : 'Start here'}</Chip>}
      </div>
      <p className="mt-5 max-w-prose text-sm leading-relaxed text-neutral-200">{uk ? 'Коротка розмова з помічником — і Karkas підлаштує план під ваші цілі, ритм і обмеження.' : 'A short talk with the assistant lets Karkas fit your plan to your goals, pace and limits.'}</p>
      <ul className="mt-5 space-y-2.5">
        {(uk ? ['Цілі, до яких справді хочеться рухатися', 'Реалістичний темп без перевантаження', 'Конкретний наступний крок щодня']
          : ['Goals you actually want to move towards', 'A realistic pace without overload', 'A concrete next step every day']).map(text =>
          <li key={text} className="flex items-start gap-2.5 text-xs leading-relaxed text-neutral-300"><span aria-hidden="true" className="mt-[0.45rem] h-1.5 w-1.5 shrink-0 bg-neutral-500" />{text}</li>)}
      </ul>
      {progress.answered > 0 && <div className="mt-5">{discoveryBar}</div>}
      <div className="mt-6 sm:mt-auto sm:pt-6">
        <button type="button" className={`${primaryBtn} w-full sm:w-auto`} onClick={runDiscovery}><MessageSquare className="h-4 w-4" aria-hidden="true" />{ctaLabel}</button>
        <p className="mt-3 text-[11px] leading-relaxed text-neutral-500">{uk ? 'У зручному темпі; можна зупинитися будь-коли. Відповіді зберігаються на цьому пристрої.' : 'At your own pace; stop any time. Answers stay on this device.'}</p>
      </div>
    </section>
    : <section aria-labelledby="strategy-plan-title" className={`${panel} flex flex-col`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle id="strategy-plan-title">{uk ? 'Стратегія від ШІ' : 'AI strategy'}</SectionTitle>
        {profile.latestStrategy && <span className={`${monoLabel} tabular-nums`}>{profile.latestStrategy.source === 'rule-engine' ? (uk ? 'Локально' : 'Local') : 'AI'}
          {' · '}{new Date(profile.latestStrategy.updatedAt).toLocaleString(uk ? 'uk-UA' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' })}</span>}
      </div>
      {narrative ? <>
        <p id="strategy-narrative" className={`mt-5 max-w-prose whitespace-pre-wrap break-words text-sm leading-7 text-neutral-200 ${longNarrative && !narrativeOpen ? 'line-clamp-6' : ''}`}>{narrative}</p>
        {longNarrative && <button type="button" className={`${ghostBtn} self-start px-0`} aria-expanded={narrativeOpen} aria-controls="strategy-narrative" onClick={() => setNarrativeOpen(value => !value)}>
          {narrativeOpen ? (uk ? 'Згорнути' : 'Show less') : (uk ? 'Читати повністю' : 'Read more')}</button>}
      </> : <p className="mt-5 max-w-prose text-sm leading-relaxed text-neutral-400">{uk ? 'Цілі вже є, а план ще не сформовано. Попросіть помічника скласти посильний план.' : 'You have goals but no plan yet. Ask the assistant to draft a manageable plan.'}</p>}
      <div className="mt-6 sm:mt-auto sm:pt-6">
        <button type="button" className={btn} onClick={() => onChat(planPrompt)}><AIIcon className="h-3.5 w-3.5" />{narrative ? (uk ? 'Обговорити план' : 'Discuss plan') : (uk ? 'Сформувати план' : 'Draft a plan')}</button>
      </div>
    </section>;

  return <div className="w-full text-sm text-neutral-200">
    <PageHead firstLine={uk ? 'Мій' : 'My'} secondLine={uk ? 'Ріст' : 'Growth'}
      switcher={!onboarding ? <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {ready ? <Chip tone="green">{uk ? 'Знайомство завершено' : 'Introduction complete'}</Chip> : discoveryBar}
        {!ready && cta === 'continue' && <Chip tone="green">{uk ? 'Режим знайомства' : 'Getting to know you'}</Chip>}
      </div> : undefined}
      actions={!onboarding ? <button type="button" className={cta === 'continue' ? primaryBtn : btn} onClick={runDiscovery}>
        <MessageSquare className="h-4 w-4" aria-hidden="true" />{ctaLabel}
      </button> : undefined} />

    <PageGrid sidebar={sideCard} sidebarLabel={uk ? 'Мій план' : 'My plan'}>
      <StrategyNextStep candidates={candidates} nextAction={profile.latestStrategy?.nextAction} tabs={tabs} lang={lang} now={clock}
        onContinueAfterExpiry={props.onContinueAfterExpiry} onFinishAfterExpiry={props.onFinishAfterExpiry}
        onStart={props.onStart} onPause={props.onPauseTimer} onChat={onChat} onOpenTask={props.onOpenTask} onOpenAdd={props.onOpenAdd}
        onLimitedStart={props.onLimitedStart} onFinishLimitedStart={props.onFinishLimitedStart} attemptsSummary={props.attemptsSummary} />

      <StrategyGoals deletedTasks={props.deletedTasks} goals={profile.goals} tasks={tasks} tabs={tabs} lang={lang} onChangeGoal={changeGoal} onOpenTask={props.onOpenTask} onChat={onChat} />

      <StrategyAudit ownerId={ownerId} profile={profile} tasks={tasks} deletedTasks={props.deletedTasks} tabs={tabs} lang={lang} clock={clock} onChat={onChat} />

      <StrategyMore profile={profile} tasks={tasks} insights={props.insights} lang={lang} remindersEnabled={props.remindersEnabled}
      feedback={feedback} onFeedbackChange={setFeedback} confirmReset={confirmReset} onConfirmResetChange={setConfirmReset}
      onProfileChange={onProfileChange} onResetMemory={props.onResetMemory} onUndo={props.onUndo} onChat={onChat} onOpenTask={props.onOpenTask}
      onRemindersChange={props.onRemindersChange} onApplyPriority={props.onApplyPriority} onEditPlan={props.onEditPlan} />
    </PageGrid>
  </div>;
};
