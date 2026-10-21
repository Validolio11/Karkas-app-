import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { PSTask } from '../types';
import { deriveSteps, type OnboardingState } from '../utils/onboarding';

export interface OnboardingChecklistProps {
  lang: 'uk' | 'en';
  state: OnboardingState;
  tasks: PSTask[];
  isDesktop: boolean;
  onChange(next: OnboardingState): void;
  onFocusQuickAdd(): void;
  onStartTrial(taskId: string): void;
  onTestNotification(): Promise<boolean>;
  onOpenAI(): void;
  hasAiKey(): Promise<boolean>;
  onSkip(): void;
}

const action = 'min-h-9 [@media(pointer:coarse)]:min-h-11 focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-2';
const primary = action + ' max-w-full bg-white px-3 py-2 text-left text-xs font-semibold text-black hover:bg-neutral-200 disabled:cursor-wait disabled:opacity-50';
const quiet = action + ' px-2 text-xs text-neutral-400 hover:text-white';

function resolveState(state: OnboardingState, tasks: PSTask[], isDesktop: boolean): OnboardingState {
  return deriveSteps(state.status === 'active' && !isDesktop && state.steps.notify === 'pending'
    ? { ...state, steps: { ...state.steps, notify: 'skipped' } } : state, tasks);
}

export const OnboardingChecklist: React.FC<OnboardingChecklistProps> = props => {
  const { lang, state, tasks, isDesktop, onChange, onFocusQuickAdd, onStartTrial, onTestNotification, onOpenAI, onSkip } = props;
  const headingId = useId();
  const [dismissed, setDismissed] = useState(false);
  const [notification, setNotification] = useState<'idle' | 'sending' | 'confirm' | 'help'>('idle');
  const [aiCheck, setAiCheck] = useState<'checking' | 'missing' | 'error'>('checking');
  const latest = useRef(props);
  const closed = useRef(false);
  const mounted = useRef(false);
  const sending = useRef(false);
  const derived = resolveState(state, tasks, isDesktop);
  const steps = [
    { id: 'task', title: lang === 'uk' ? 'Перше завдання' : 'First task', done: derived.steps.task },
    { id: 'session', title: lang === 'uk' ? '5 хвилин фокусу' : '5 minutes of focus', done: derived.steps.session },
    { id: 'notify', title: lang === 'uk' ? 'Сповіщення' : 'Notifications', done: derived.steps.notify !== 'pending' },
    { id: 'ai', title: lang === 'uk' ? "ШІ-помічник (необов'язково)" : 'AI assistant (optional)', done: derived.steps.ai !== 'pending' },
  ];
  // The web build has no Windows notifications, so that step is neither shown nor counted there.
  const visibleSteps = steps.filter(step => step.id !== 'notify' || isDesktop);
  const completed = visibleSteps.filter(step => step.done).length;
  const current = steps.find(step => !step.done)?.id;
  const aiExpanded = derived.status === 'active' && current === 'ai';
  const firstTask = tasks.find(task => !task.done && !task.scheduledPending);
  const running = tasks.some(task => task.timerRunning);
  const success = lang === 'uk' ? 'Готово' : 'All set';
  const connected = lang === 'uk' ? 'Ключ уже підключено.' : 'Key already connected.';

  useEffect(() => { latest.current = props; });
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    closed.current = false;
    sending.current = false;
    setDismissed(false);
    setNotification('idle');
  }, [state.startedAt]);

  // Keep automatic progress in the integrator's persisted state.
  useEffect(() => {
    if (state.status !== 'active' || closed.current) return;
    const next = resolveState(state, tasks, isDesktop);
    if (next.status !== state.status || Object.keys(next.steps).some(key => {
      const step = key as keyof OnboardingState['steps'];
      return next.steps[step] !== state.steps[step];
    })) {
      latest.current = { ...latest.current, state: next };
      onChange(next);
    }
  }, [state, tasks, isDesktop, onChange]);

  const updateSteps = useCallback((changes: Partial<OnboardingState['steps']>) => {
    const snapshot = latest.current;
    if (!mounted.current || closed.current || snapshot.state.status !== 'active') return;
    const next = resolveState({ ...snapshot.state, steps: { ...snapshot.state.steps, ...changes } }, snapshot.tasks, snapshot.isDesktop);
    latest.current = { ...snapshot, state: next };
    snapshot.onChange(next);
  }, []);

  useEffect(() => {
    if (!aiExpanded || dismissed) return;
    let cancelled = false;
    let inFlight = false;
    let checkAgain = false;
    const check = async () => {
      if (cancelled || closed.current || latest.current.state.steps.ai !== 'pending') return;
      if (inFlight) { checkAgain = true; return; }
      inFlight = true;
      setAiCheck('checking');
      try {
        const connected = await latest.current.hasAiKey();
        if (!cancelled && !closed.current) {
          if (connected) updateSteps({ ai: 'ok' });
          else setAiCheck('missing');
        }
      } catch {
        if (!cancelled && !closed.current) setAiCheck('error');
      } finally {
        inFlight = false;
        if (checkAgain && !cancelled) { checkAgain = false; void check(); }
      }
    };
    const visible = () => { if (document.visibilityState === 'visible') void check(); };
    const focus = () => { void check(); };
    void check();
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', visible);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [aiExpanded, dismissed, state.startedAt, updateSteps]);

  const testNotification = async () => {
    if (sending.current) return;
    sending.current = true;
    setNotification('sending');
    const startedAt = state.startedAt;
    const stillActive = () => mounted.current && !closed.current && latest.current.state.startedAt === startedAt
      && latest.current.state.status === 'active' && latest.current.isDesktop && latest.current.state.steps.notify === 'pending';
    try {
      const ok = await onTestNotification();
      if (stillActive()) setNotification(ok ? 'confirm' : 'help');
    } catch {
      if (stillActive()) setNotification('help');
    } finally {
      if (latest.current.state.startedAt === startedAt) sending.current = false;
    }
  };

  if (dismissed || state.status === 'skipped') return null;

  return <section aria-labelledby={headingId} className="pulse-onboarding text-sm text-white">
    <p className="sr-only" aria-live="polite" aria-atomic="true">{derived.status === 'done' ? (derived.steps.ai === 'ok' ? connected + ' ' : '') + success : (lang === 'uk' ? 'Поточний крок: ' : 'Current step: ') + steps.find(step => step.id === current)?.title}</p>
    {derived.status === 'done' ? <div className="flex items-center gap-2">
      <span aria-hidden="true" className="text-emerald-400">✓</span>
      <h2 id={headingId} className="flex-1 text-xs text-neutral-200">{success}{derived.steps.ai === 'ok' && <span className="ml-2 text-neutral-400">{connected}</span>}</h2>
      <button type="button" className={quiet + ' text-xl'} aria-label={lang === 'uk' ? 'Закрити знайомство' : 'Dismiss onboarding'} onClick={() => { closed.current = true; setDismissed(true); }}>×</button>
    </div> : <>
      <div className="flex items-center gap-3">
        <h2 id={headingId} className="min-w-0 flex-1 text-xs font-semibold">{lang === 'uk' ? `Знайомство з Karkas · ${completed} з ${visibleSteps.length}` : `Getting started with Karkas · ${completed} of ${visibleSteps.length}`}</h2>
        <button type="button" className={quiet} onClick={() => { closed.current = true; setDismissed(true); onSkip(); }}>{lang === 'uk' ? 'Пропустити' : 'Skip'}</button>
      </div>
      <div role="progressbar" aria-label={lang === 'uk' ? 'Прогрес знайомства' : 'Onboarding progress'} aria-valuemin={0} aria-valuemax={visibleSteps.length} aria-valuenow={completed} className={'mb-2 mt-1 grid gap-1 ' + (visibleSteps.length === 4 ? 'grid-cols-4' : 'grid-cols-3')}>
        {visibleSteps.map(step => <span key={step.id} aria-hidden="true" className={'h-1 ' + (step.done ? 'bg-emerald-400' : 'bg-neutral-800')} />)}
      </div>
      <ol className="divide-y divide-neutral-800">
        {visibleSteps.map((step, index) => <li key={step.id} aria-current={step.id === current ? 'step' : undefined} className="py-2">
          <div className="flex min-w-0 items-center gap-2 text-xs">
            <span aria-hidden="true" className={'w-4 shrink-0 text-center ' + (step.done ? 'text-emerald-400' : 'text-neutral-500')}>{step.done ? '✓' : index + 1}</span>
            <span className={step.id === current ? 'font-semibold text-white' : 'text-neutral-400'}>{step.title}</span>
            {step.done && <span className="sr-only">{lang === 'uk' ? 'Виконано' : 'Complete'}</span>}
            {step.id === 'ai' && derived.steps.ai === 'ok' && <span className="text-neutral-400">{connected}</span>}
          </div>
          {step.id === current && <div className="ml-6 mt-2 space-y-2 text-xs leading-relaxed text-neutral-400">
            {step.id === 'task' && <>
              <button type="button" className={primary} onClick={onFocusQuickAdd}>{lang === 'uk' ? 'Написати' : 'Write a task'}</button>
            </>}
            {step.id === 'session' && <>
              {!running && (firstTask ? <button type="button" className={primary + ' break-words'} onClick={() => onStartTrial(firstTask.id)}>{lang === 'uk' ? 'Почати 5 хв' : 'Start 5 min'}</button>
                : <button type="button" className={primary} onClick={onFocusQuickAdd}>{lang === 'uk' ? 'Написати ще одне завдання' : 'Write another task'}</button>)}
            </>}
            {step.id === 'notify' && <>
              <div aria-live="polite" aria-atomic="true">
                {(notification === 'idle' || notification === 'sending') && <button type="button" className={primary} disabled={notification === 'sending'} onClick={() => { void testNotification(); }}>{notification === 'sending' ? (lang === 'uk' ? 'Надсилаємо…' : 'Sending…') : (lang === 'uk' ? 'Надіслати тестове' : 'Send a test')}</button>}
                {notification === 'confirm' && <>
                  <p className="mb-2 text-neutral-200">{lang === 'uk' ? 'Бачите сповіщення?' : 'Can you see the notification?'}</p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={primary} onClick={() => updateSteps({ notify: 'ok' })}>{lang === 'uk' ? 'Так' : 'Yes'}</button>
                    <button type="button" className={quiet} onClick={() => setNotification('help')}>{lang === 'uk' ? 'Ні' : 'No'}</button>
                  </div>
                </>}
                {notification === 'help' && <>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={primary} onClick={() => { void testNotification(); }}>{lang === 'uk' ? 'Перевірити ще раз' : 'Test again'}</button>
                    <button type="button" className={quiet} onClick={() => updateSteps({ notify: 'unavailable' })}>{lang === 'uk' ? 'Пропустити' : 'Skip'}</button>
                  </div>
                </>}
              </div>
            </>}
            {step.id === 'ai' && <>
              <p role="status" className="text-neutral-300">{aiCheck === 'checking' ? (lang === 'uk' ? 'Перевіряємо ключ…' : 'Checking for a key…') : aiCheck === 'error' ? (lang === 'uk' ? 'Помилка підключення' : 'Connection error') : null}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={primary} onClick={onOpenAI}>{lang === 'uk' ? 'Підключити' : 'Connect'}</button>
                <button type="button" className={quiet} onClick={() => updateSteps({ ai: 'skipped' })}>{lang === 'uk' ? 'Без ШІ' : 'Without AI'}</button>
              </div>
            </>}
          </div>}
        </li>)}
      </ol>
    </>}
  </section>;
};
