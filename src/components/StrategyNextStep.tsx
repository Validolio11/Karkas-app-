import React, { useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, Pause, Play, Plus, Shuffle } from 'lucide-react';
import { AIIcon } from './AIIconTemplates';
import type { PSTask, TaskTab } from '../types';
import { TRANSLATIONS } from '../utils/i18n';
import { sound } from '../utils/audio';
import { getTaskRemainingSeconds, getTaskTimerMode, getTaskTotalSeconds } from '../utils/taskTimer';
import { formatDigitalDuration } from '../utils/taskTimeStats';
import { latestAttempt, LIMITED_START_CAPS, LIMITED_START_DEFAULT, LIMITED_START_MIN_CREDIT } from '../utils/limitedStart';
import { taskStepProgress, type NextStepCandidate, type NextStepReason } from './strategyViewModel';
import { btn, CategoryChip, Chip, chipBtn, DeadlineChip, ghostBtn, heroPanel, monoLabel, primaryBtn, PriorityBadge, Reveal, SectionTitle, SegmentBar } from './strategyUi';

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

const LIMITED_START_CAP_KEY = 'karkas.limited-start-cap.v1';
const RECENT_ATTEMPT_MS = 30 * 60 * 1000;

export const StrategyNextStep: React.FC<{
  candidates: NextStepCandidate[]; nextAction?: string; tabs: TaskTab[]; lang: 'uk' | 'en'; now: number;
  onStart: (id: string) => void; onPause: (id: string) => void; onChat: (text: string) => void;
  onOpenTask: (id: string) => void; onOpenAdd: () => void;
  onLimitedStart: (id: string, capSeconds: number, options?: { continued?: boolean }) => void;
  onFinishLimitedStart: (id: string) => void; attemptsSummary: { count: number; seconds: number };
}> = ({ candidates, nextAction, tabs, lang, now, onStart, onPause, onChat, onOpenTask, onOpenAdd, onLimitedStart, onFinishLimitedStart, attemptsSummary }) => {
  const uk = lang === 'uk';
  const [pickedId, setPickedId] = useState<string | null>(null);
  const index = Math.max(0, candidates.findIndex(candidate => candidate.task.id === pickedId));
  const current = candidates[index];
  const task = current?.task;
  const [tick, setTick] = useState(now);
  const [stuckOpen, setStuckOpen] = useState(false);
  const stuckId = useId();
  const [limitedCap, setLimitedCap] = useState(() => {
    try { const saved = Number(localStorage.getItem(LIMITED_START_CAP_KEY)); if (LIMITED_START_CAPS.some(cap => cap === saved)) return saved; } catch { /* Storage is optional. */ }
    return LIMITED_START_DEFAULT;
  });
  const [dismissedAttempts, setDismissedAttempts] = useState<string[]>([]);
  const [shortAttempts, setShortAttempts] = useState<Record<string, string>>({});
  const seenLimited = useRef<Record<string, NonNullable<PSTask['limitedStart']>>>({});
  useEffect(() => {
    const short: Record<string, string> = {};
    for (const { task: candidate } of candidates) {
      const previous = seenLimited.current[candidate.id];
      if (candidate.limitedStart) seenLimited.current[candidate.id] = candidate.limitedStart;
      else if (previous) {
        delete seenLimited.current[candidate.id];
        if (!candidate.activityTrail?.some(event => event.id === `attempt:${previous.id}`) &&
          getTaskTotalSeconds(candidate, now) - previous.baseSeconds < LIMITED_START_MIN_CREDIT) short[candidate.id] = previous.id;
      }
    }
    const runningIds = candidates.filter(candidate => candidate.task.timerRunning).map(candidate => candidate.task.id);
    if (Object.keys(short).length || runningIds.length) setShortAttempts(value => {
      if (!Object.keys(short).length && !runningIds.some(id => value[id])) return value;
      const next = { ...value, ...short };
      for (const id of runningIds) delete next[id];
      return next;
    });
  }, [candidates, now]);
  const chooseCap = (cap: number) => {
    setLimitedCap(cap);
    try { localStorage.setItem(LIMITED_START_CAP_KEY, String(cap)); } catch { /* Storage is optional. */ }
  };
  const beginLimited = (id: string, continued = false) => {
    setPickedId(id);
    setShortAttempts(value => { const next = { ...value }; delete next[id]; return next; });
    onLimitedStart(id, limitedCap, continued ? { continued: true } : undefined);
  };
  const attemptsNote = attemptsSummary.count > 0 && <p className="mt-4 text-[11px] text-neutral-500">
    {uk ? `Спроб за 7 днів: ${attemptsSummary.count} · ${Math.floor(attemptsSummary.seconds / 60)} хв` : `Attempts in 7 days: ${attemptsSummary.count} · ${Math.floor(attemptsSummary.seconds / 60)} min`}
  </p>;
  useEffect(() => {
    setTick(Date.now());
    if (!task?.timerRunning) return;
    const timer = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [task?.id, task?.timerRunning, now]);

  useEffect(() => { if (task?.limitedStart) setPickedId(task.id); }, [task?.id, task?.limitedStart?.id]);

  const helpPrompt = task
    ? (() => {
      const step = taskStepProgress(task);
      const stepText = step.nextIndex >= 0 ? (step.nextTitle || `${uk ? 'крок' : 'step'} ${step.nextIndex + 1}`) : '';
      return uk ? `Допоможи мені почати завдання «${task.title}»${stepText ? ` — зараз на черзі «${stepText}»` : ''}. Спершу зрозумій, що робить початок складним.`
        : `Help me start the task "${task.title}"${stepText ? ` — next up: "${stepText}"` : ''}. First understand what makes starting difficult.`;
    })()
    : (uk ? 'Допоможи мені почати рух до поточної узгодженої цілі. Спершу зрозумій, що робить початок складним.' : 'Help me start working towards my agreed goal. First understand what makes starting difficult.');
  // «Застряг?» stays one quiet button; its three options appear only on demand.
  const stuckToggle = <button type="button" id={`${stuckId}-toggle`} className={`${ghostBtn} ${stuckOpen ? 'text-white' : ''}`}
    aria-expanded={stuckOpen} aria-controls={`${stuckId}-options`} onClick={() => setStuckOpen(value => !value)}>
    {uk ? 'Застряг?' : 'Stuck?'}
  </button>;
  const stuckRow = <Reveal open={stuckOpen} id={`${stuckId}-options`} labelledBy={`${stuckId}-toggle`}>
    <div className="flex flex-wrap gap-2 pt-4">
      {STUCK.map(item => <button key={item.uk} type="button" className={chipBtn}
        onClick={() => onChat(uk ? `${item.uk}${task ? `: «${task.title}»` : ''}. Запитай, що сталося, перш ніж перебудовувати план.` : `${item.prompt}${task ? `: ${task.title}` : ''}. Ask what happened before changing my plan.`)}>
        {uk ? item.uk : item.en}
      </button>)}
    </div>
  </Reveal>;
  const advice = nextAction && <p className="mt-6 flex max-w-prose gap-2.5 text-sm leading-relaxed text-neutral-300">
    <AIIcon className="mt-[3px] h-4 w-4 text-neutral-400" />
    <span className="min-w-0 whitespace-pre-wrap break-words"><span className="sr-only">{uk ? 'Порада ШІ: ' : 'AI advice: '}</span>{nextAction}</span>
  </p>;
  const title = <SectionTitle id="strategy-next-step-title">{uk ? 'Наступний крок' : 'Next step'}</SectionTitle>;

  if (!task) return <section aria-labelledby="strategy-next-step-title" className={`${heroPanel} border-neutral-600`}>
    {title}
    {advice}
    <p className="mt-5 max-w-prose text-sm leading-relaxed text-neutral-400">{uk ? 'Активних завдань немає. Додайте одне — і тут з’явиться конкретний крок із таймером.' : 'No active tasks. Add one and a concrete step with a timer will appear here.'}</p>
    <div className="mt-6 flex flex-wrap items-center gap-2">
      <button type="button" className={primaryBtn} onClick={onOpenAdd}><Plus className="h-4 w-4" aria-hidden="true" />{uk ? 'Додати завдання' : 'Add task'}</button>
      <button type="button" className={btn} onClick={() => onChat(helpPrompt)}>{uk ? 'Допоможи почати' : 'Help me start'}</button>
      {stuckToggle}
    </div>
    {stuckRow}
    {attemptsNote}
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
  const limited = !!task.limitedStart;
  const attempt = latestAttempt(task);
  const recentAttempt = attempt && tick >= attempt.at && tick - attempt.at <= RECENT_ATTEMPT_MS ? attempt : undefined;
  const shortAttempt = shortAttempts[task.id];
  const showShortAttempt = !running && !limited && shortAttempt && !dismissedAttempts.includes(shortAttempt);
  const showAttempt = !running && !limited && !showShortAttempt && recentAttempt && !dismissedAttempts.includes(recentAttempt.id);
  const capMinutes = limitedCap / 60;

  return <section aria-labelledby="strategy-next-step-title"
    className={`${heroPanel} ${running && !limited ? 'border-emerald-500/90 task-timer-glow' : 'border-neutral-600'}`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {title}
        <Chip tone={limited ? 'neutral' : reason.tone}>{limited ? (uk ? 'Обмежена спроба' : 'Limited attempt') : (uk ? reason.uk : reason.en)}</Chip>
      </div>
      {candidates.length > 1 && <button type="button" className={`${ghostBtn} -mr-2`}
        aria-label={uk ? `Показати інше завдання (${index + 1} з ${candidates.length})` : `Show another task (${index + 1} of ${candidates.length})`}
        onClick={() => setPickedId(candidates[(index + 1) % candidates.length].task.id)}>
        <Shuffle className="h-3.5 w-3.5" aria-hidden="true" />{uk ? 'Інше завдання' : 'Another task'}
        <span className="font-mono text-neutral-500">{index + 1}/{candidates.length}</span>
      </button>}
    </div>

    <div className="mt-6 flex flex-wrap items-center gap-2">
      <CategoryChip name={phaseName} color={tab?.color} />
      <PriorityBadge priority={task.priority} lang={lang} />
      <DeadlineChip task={task} lang={lang} now={now} />
    </div>
    <button type="button" onClick={() => onOpenTask(task.id)} title={uk ? 'Відкрити завдання у списку' : 'Open the task in the list'}
      className="group mt-4 flex max-w-full items-start gap-2 text-left text-xl font-bold leading-tight text-white sm:text-2xl">
      <span className="min-w-0 break-words underline-offset-4 group-hover:underline">{task.title}</span>
      <ArrowRight aria-hidden="true" className="mt-1 h-5 w-5 shrink-0 text-neutral-500 transition-transform group-hover:translate-x-0.5 group-hover:text-white motion-reduce:transition-none sm:mt-1.5" />
    </button>

    <div className="mt-6 grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end sm:gap-8">
      <div className="min-w-0">
        {step.total > 0 ? <>
          <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className={monoLabel}>{step.nextIndex >= 0 ? `${uk ? 'Крок' : 'Step'} ${step.nextIndex + 1}/${step.total}` : `${step.total}/${step.total}`}</span>
            <span className="min-w-0 break-words text-neutral-200">{step.nextIndex >= 0 ? (step.nextTitle || `${uk ? 'Крок' : 'Step'} ${step.nextIndex + 1}`) : (uk ? 'Усі кроки виконано — можна завершувати' : 'All steps done — ready to complete')}</span>
          </p>
          <SegmentBar thick className="mt-3" segments={segments} label={uk ? 'Прогрес кроків' : 'Step progress'} valueText={`${step.done}/${step.total}`} />
        </> : <p className={monoLabel}>{uk ? 'Без підкроків' : 'No substeps'}</p>}
      </div>
      <div role="status" className="min-w-0 sm:text-right">
        <p className={`flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider sm:justify-end ${running && !limited ? 'text-emerald-300' : started ? 'text-neutral-300' : 'text-neutral-500'}`}>
          <span aria-hidden="true" className={`h-1.5 w-1.5 ${running && !limited ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]' : started ? 'bg-neutral-400' : 'bg-neutral-700'}`} />
          {limited ? (uk ? 'Спроба' : 'Attempt') : running ? (uk ? 'Таймер іде' : 'Timer running') : started ? (uk ? 'На паузі' : 'Paused') : (uk ? 'Не розпочато' : 'Not started')}
          {hasCountdown && <span className="text-neutral-500">· {uk ? 'залишилось' : 'left'}</span>}
        </p>
        <p className={`mt-1.5 font-mono text-2xl font-bold leading-none tabular-nums sm:text-3xl ${running ? 'text-white' : started || hasCountdown ? 'text-neutral-200' : 'text-neutral-600'}`}>{formatDigitalDuration(seconds)}</p>
      </div>
    </div>

    {limited && <p className="mt-3 text-xs leading-relaxed text-neutral-400">{uk ? 'Можна зупинитись будь-коли. Від 1 хв — спроба зараховується.' : 'You can stop any time. 1 min or more counts as an attempt.'}</p>}
    {advice}

    <div className="mt-6 flex flex-wrap items-center gap-2">
      {running
        ? <button type="button" className={primaryBtn} onClick={() => { sound.tick(500); if (limited) onFinishLimitedStart(task.id); else onPause(task.id); }}><Pause className="h-4 w-4" aria-hidden="true" />{limited ? (uk ? 'Досить' : 'Enough') : (uk ? 'Пауза' : 'Pause')}</button>
        : <button type="button" className={primaryBtn} onClick={() => { sound.activate(); onStart(task.id); }}><Play className="h-4 w-4" aria-hidden="true" />{started ? (uk ? 'Продовжити' : 'Resume') : (uk ? 'Почати' : 'Start')}</button>}
      <button type="button" className={btn} onClick={() => onChat(helpPrompt)}>{uk ? 'Допоможи почати' : 'Help me start'}</button>
      {stuckToggle}
      {!running && !limited && <div className="flex max-w-full flex-wrap items-center gap-2">
        <div role="group" aria-label={uk ? 'Тривалість обмеженої спроби' : 'Limited attempt duration'} className="inline-flex min-w-0">
          {LIMITED_START_CAPS.map(cap => <button key={cap} type="button" aria-pressed={limitedCap === cap}
            aria-label={uk ? `${cap / 60} хвилин` : `${cap / 60} minutes`}
            className={`${chipBtn} -ml-px first:ml-0 ${limitedCap === cap ? 'relative border-neutral-500 bg-neutral-800 text-white' : ''}`} onClick={() => chooseCap(cap)}>
            {cap / 60}{cap === LIMITED_START_CAPS[LIMITED_START_CAPS.length - 1] && (uk ? ' хв' : ' min')}
          </button>)}
        </div>
        <button type="button" className={btn} onClick={() => beginLimited(task.id)}>{uk ? `Лише ${capMinutes} хв` : `Just ${capMinutes} min`}</button>
      </div>}
    </div>
    {(showAttempt || showShortAttempt) && <div className="mt-4" role="status">
      <p className="text-sm leading-relaxed text-neutral-300">{showShortAttempt
        ? (uk ? 'Менше хвилини — це не рахую. Без проблем.' : 'Under a minute is not counted. No problem.')
        : (uk ? `Спробу зараховано: ${Math.floor((recentAttempt?.attemptSeconds || 0) / 60)} хв. Це вже рух.` : `Attempt counted: ${Math.floor((recentAttempt?.attemptSeconds || 0) / 60)} min. That is progress.`)}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {showAttempt && <button type="button" className={btn} onClick={() => beginLimited(task.id, true)}>{uk ? `Ще ${capMinutes} хв` : `${capMinutes} more min`}</button>}
        <button type="button" className={ghostBtn} onClick={() => { const id = showShortAttempt ? shortAttempt : recentAttempt?.id; if (id) setDismissedAttempts(value => [...value, id, ...(showShortAttempt && recentAttempt ? [recentAttempt.id] : [])]); }}>{uk ? 'Досить на зараз' : 'Enough for now'}</button>
      </div>
    </div>}
    {stuckRow}
    {attemptsNote}
  </section>;
};
