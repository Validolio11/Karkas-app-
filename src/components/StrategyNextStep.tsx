import React, { useEffect, useState } from 'react';
import { ArrowRight, Pause, Play, Plus, Shuffle } from 'lucide-react';
import type { TaskTab } from '../types';
import { TRANSLATIONS } from '../utils/i18n';
import { sound } from '../utils/audio';
import { getTaskRemainingSeconds, getTaskTimerMode, getTaskTotalSeconds } from '../utils/taskTimer';
import { formatDigitalDuration } from '../utils/taskTimeStats';
import { taskStepProgress, type NextStepCandidate, type NextStepReason } from './strategyViewModel';
import { btn, CategoryChip, Chip, chipBtn, DeadlineChip, ghostBtn, monoLabel, primaryBtn, PriorityBadge, SectionTitle, SegmentBar } from './strategyUi';

const REASONS: Record<NextStepReason, { uk: string; en: string; tone: 'green' | 'amber' | 'red' | 'white' | 'neutral' }> = {
  focus: { uk: 'Фокус від ШІ', en: 'AI focus', tone: 'white' },
  running: { uk: 'Таймер іде', en: 'Timer running', tone: 'green' },
  inProgress: { uk: 'У роботі', en: 'In progress', tone: 'green' },
  pinned: { uk: 'Закріплене', en: 'Pinned', tone: 'neutral' },
  deadline: { uk: 'Близький дедлайн', en: 'Deadline soon', tone: 'amber' },
  priority: { uk: 'За пріоритетом', en: 'By priority', tone: 'neutral' },
};
const STUCK = [
  { uk: 'Не хочу робити', en: 'Not now', prompt: 'I do not want to do it' },
  { uk: 'Не почав', en: 'Did not start', prompt: 'I did not start' },
  { uk: 'Я відволікся', en: 'Got distracted', prompt: 'I got distracted' },
];

export const StrategyNextStep: React.FC<{
  candidates: NextStepCandidate[]; nextAction?: string; tabs: TaskTab[]; lang: 'uk' | 'en'; now: number;
  onStart: (id: string) => void; onPause: (id: string) => void; onChat: (text: string) => void;
  onOpenTask: (id: string) => void; onOpenAdd: () => void;
}> = ({ candidates, nextAction, tabs, lang, now, onStart, onPause, onChat, onOpenTask, onOpenAdd }) => {
  const uk = lang === 'uk';
  const [pickedId, setPickedId] = useState<string | null>(null);
  const index = Math.max(0, candidates.findIndex(candidate => candidate.task.id === pickedId));
  const current = candidates[index];
  const task = current?.task;
  const [tick, setTick] = useState(now);
  useEffect(() => {
    setTick(Date.now());
    if (!task?.timerRunning) return;
    const timer = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [task?.id, task?.timerRunning, now]);

  const helpPrompt = task
    ? (() => {
      const step = taskStepProgress(task);
      const stepText = step.nextIndex >= 0 ? (step.nextTitle || `${uk ? 'крок' : 'step'} ${step.nextIndex + 1}`) : '';
      return uk ? `Допоможи мені почати завдання «${task.title}»${stepText ? ` — зараз на черзі «${stepText}»` : ''}. Спершу зрозумій, що робить початок складним.`
        : `Help me start the task "${task.title}"${stepText ? ` — next up: "${stepText}"` : ''}. First understand what makes starting difficult.`;
    })()
    : (uk ? 'Допоможи мені почати рух до поточної узгодженої цілі. Спершу зрозумій, що робить початок складним.' : 'Help me start working towards my agreed goal. First understand what makes starting difficult.');
  const stuckRow = <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-neutral-800/70 pt-3">
    <span className={`${monoLabel} mr-1`}>{uk ? 'Застряг?' : 'Stuck?'}</span>
    {STUCK.map(item => <button key={item.uk} type="button" className={chipBtn}
      onClick={() => onChat(uk ? `${item.uk}${task ? `: «${task.title}»` : ''}. Запитай, що сталося, перш ніж перебудовувати план.` : `${item.prompt}${task ? `: ${task.title}` : ''}. Ask what happened before changing my plan.`)}>
      {uk ? item.uk : item.en}
    </button>)}
  </div>;
  const advice = nextAction && <p className="mt-3 border-l-2 border-neutral-600 pl-3 text-[13px] leading-relaxed text-neutral-300">
    <span className={`${monoLabel} mb-0.5 block`}>{uk ? 'Порада ШІ' : 'AI advice'}</span>
    <span className="whitespace-pre-wrap break-words">{nextAction}</span>
  </p>;

  if (!task) return <section aria-labelledby="strategy-next-step-title" className={`min-w-0 border border-neutral-700 bg-[#0c0c0d] p-4 sm:p-5`}>
    <SectionTitle id="strategy-next-step-title">{uk ? 'Наступний крок' : 'Next step'}</SectionTitle>
    {advice}
    <p className="mt-3 text-[13px] leading-relaxed text-neutral-400">{uk ? 'Активних завдань немає. Додайте одне — і тут з’явиться конкретний крок із таймером.' : 'No active tasks. Add one and a concrete step with a timer will appear here.'}</p>
    <div className="mt-4 flex flex-wrap gap-2">
      <button type="button" className={primaryBtn} onClick={onOpenAdd}><Plus className="h-4 w-4" aria-hidden="true" />{uk ? 'Додати завдання' : 'Add task'}</button>
      <button type="button" className={btn} onClick={() => onChat(helpPrompt)}>{uk ? 'Допоможи почати' : 'Help me start'}</button>
    </div>
    {stuckRow}
  </section>;

  const tab = tabs.find(item => item.id === task.phase);
  const phaseName = (TRANSLATIONS[lang].phases as Record<string, string>)[task.phase] || tab?.name || task.phase;
  const step = taskStepProgress(task);
  const shownSteps = Math.min(step.total, 24);
  const segments = Array.from({ length: shownSteps }, (_, i) => (task.stepList?.length ? task.stepList[i].done : i < step.done) ? 'on' as const : i === step.nextIndex ? 'partial' as const : 'off' as const);
  const started = Number.isFinite(task.startedAt) || !!task.timerRunning || (task.timeSpentSeconds || 0) > 0;
  const hasCountdown = getTaskTimerMode(task) === 'countdown' && (task.countdownDurationSeconds || 0) > 0;
  const seconds = hasCountdown ? getTaskRemainingSeconds(task, tick) ?? 0 : getTaskTotalSeconds(task, tick);
  const reason = REASONS[current.reason];
  const running = !!task.timerRunning;

  return <section aria-labelledby="strategy-next-step-title"
    className={`relative min-w-0 border bg-[#0c0c0d] p-4 transition-colors sm:p-5 motion-reduce:transition-none ${running ? 'border-emerald-500/90 task-timer-glow' : 'border-neutral-700'}`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <SectionTitle id="strategy-next-step-title">{uk ? 'Наступний крок' : 'Next step'}</SectionTitle>
        <Chip tone={reason.tone}>{uk ? reason.uk : reason.en}</Chip>
      </div>
      {candidates.length > 1 && <button type="button" className={ghostBtn}
        aria-label={uk ? `Показати інше завдання (${index + 1} з ${candidates.length})` : `Show another task (${index + 1} of ${candidates.length})`}
        onClick={() => setPickedId(candidates[(index + 1) % candidates.length].task.id)}>
        <Shuffle className="h-3.5 w-3.5" aria-hidden="true" />{uk ? 'Інше завдання' : 'Another task'}
        <span className="font-mono text-neutral-500">{index + 1}/{candidates.length}</span>
      </button>}
    </div>
    {advice}

    <div className="mt-4 flex flex-wrap items-center gap-2">
      <CategoryChip name={phaseName} color={tab?.color} />
      <PriorityBadge priority={task.priority} lang={lang} />
      <DeadlineChip task={task} lang={lang} now={now} />
    </div>
    <button type="button" onClick={() => onOpenTask(task.id)} title={uk ? 'Відкрити завдання у списку' : 'Open the task in the list'}
      className="group mt-2 flex max-w-full items-start gap-2 text-left text-lg font-bold leading-snug text-white">
      <span className="min-w-0 break-words underline-offset-4 group-hover:underline">{task.title}</span>
      <ArrowRight aria-hidden="true" className="mt-1.5 h-4 w-4 shrink-0 text-neutral-500 transition-transform group-hover:translate-x-0.5 group-hover:text-white motion-reduce:transition-none" />
    </button>

    <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
      <div className="min-w-0">
        {step.total > 0 ? <>
          <p className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
            <span className={monoLabel}>{step.nextIndex >= 0 ? `${uk ? 'Крок' : 'Step'} ${step.nextIndex + 1}/${step.total}` : `${step.total}/${step.total}`}</span>
            <span className="min-w-0 break-words text-neutral-200">{step.nextIndex >= 0 ? (step.nextTitle || `${uk ? 'Крок' : 'Step'} ${step.nextIndex + 1}`) : (uk ? 'Усі кроки виконано — можна завершувати' : 'All steps done — ready to complete')}</span>
          </p>
          <SegmentBar className="mt-2" segments={segments} label={uk ? 'Прогрес кроків' : 'Step progress'} valueText={`${step.done}/${step.total}`} />
        </> : <p className={monoLabel}>{uk ? 'Без підкроків' : 'No substeps'}</p>}
      </div>
      <p role="status" className={`flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider ${running ? 'text-emerald-300' : started ? 'text-neutral-300' : 'text-neutral-500'}`}>
        <span aria-hidden="true" className={`h-1.5 w-1.5 ${running ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]' : started ? 'bg-neutral-400' : 'bg-neutral-700'}`} />
        {running ? (uk ? 'Таймер іде' : 'Timer running') : started ? (uk ? 'На паузі' : 'Paused') : (uk ? 'Не розпочато' : 'Not started')}
        {(started || hasCountdown) && <span className="tabular-nums text-neutral-200">{hasCountdown ? (uk ? 'ЗАЛИШИЛОСЬ ' : 'LEFT ') : ''}{formatDigitalDuration(seconds)}</span>}
      </p>
    </div>

    <div className="mt-4 flex flex-wrap items-center gap-2">
      {running
        ? <button type="button" className={primaryBtn} onClick={() => { sound.tick(500); onPause(task.id); }}><Pause className="h-4 w-4" aria-hidden="true" />{uk ? 'Пауза' : 'Pause'}</button>
        : <button type="button" className={primaryBtn} onClick={() => { sound.activate(); onStart(task.id); }}><Play className="h-4 w-4" aria-hidden="true" />{started ? (uk ? 'Продовжити' : 'Resume') : (uk ? 'Почати' : 'Start')}</button>}
      <button type="button" className={btn} onClick={() => onChat(helpPrompt)}>{uk ? 'Допоможи почати' : 'Help me start'}</button>
      <button type="button" className={ghostBtn} onClick={() => onOpenTask(task.id)}>{uk ? 'До завдання' : 'Go to task'}<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></button>
    </div>
    {stuckRow}
  </section>;
};
