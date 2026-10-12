import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { TaskTab, NewTaskInput } from '../types';
import { sound } from '../utils/audio';
import { Language, TRANSLATIONS } from '../utils/i18n';
import { karkasApiFetch } from '../utils/desktopApi';
import { Plus, X, Timer, ChevronLeft, ChevronRight, Check } from 'lucide-react';
import { AIIcon } from './AIIconTemplates';
import { buildQuickAddSteps, hasQuickAddDraftContent, mergeQuickAddSuggestions, quickAddDraftKey, readQuickAddDraft, saveQuickAddDraft } from './quickAddDraft';
import { isTaskDate } from '../utils/taskDates';
import { TaskDateCalendar } from './TaskDateCalendar';

interface QuickAddDrawerProps {
  ownerId?: string | null;
  isOpen: boolean;
  lang: Language;
  tabs: TaskTab[];
  selectedPhase?: string;
  onClose: () => void;
  onAddTask: (task: NewTaskInput) => void | boolean;
}

// Remount the draft session on account changes so fields and in-flight AI results cannot cross accounts.
export const QuickAddDrawer: React.FC<QuickAddDrawerProps> = props =>
  <QuickAddDraftSession key={quickAddDraftKey(props.ownerId ?? null)} {...props} />;

const QuickAddDraftSession: React.FC<QuickAddDrawerProps> = ({ ownerId = null, isOpen, lang, tabs, selectedPhase, onClose, onAddTask }) => {
  const t = TRANSLATIONS[lang];
  const uk = lang === 'uk';
  const [savedDraft] = useState(() => { try { return readQuickAddDraft(localStorage, ownerId); } catch { return null; } });
  const [title, setTitle] = useState(savedDraft?.title || '');
  const [note, setNote] = useState(savedDraft?.note || '');
  const [phase, setPhase] = useState(() => {
    // Account tabs can still be hydrating; validate the saved category when the drawer opens.
    if (savedDraft?.phase) return savedDraft.phase;
    return tabs.some(tab => tab.id === selectedPhase) ? selectedPhase! : tabs[0]?.id || 'focus';
  });
  const [priority, setPriority] = useState<1 | 2 | 3>(savedDraft?.priority || 2);
  const [customSteps, setCustomSteps] = useState<string[]>(savedDraft?.customSteps || []);
  const [steps, setSteps] = useState(() => savedDraft?.timerMode === undefined && savedDraft?.customSteps.length
    ? Math.min(12, savedDraft.customSteps.length) : savedDraft?.steps ?? 0);
  const [timerMode, setTimerMode] = useState<'none' | 'stopwatch' | 'countdown'>(savedDraft?.timerMode ?? 'stopwatch');
  const [countdownMinutes, setCountdownMinutes] = useState(savedDraft?.countdownInput ?? String(savedDraft?.countdownMinutes || 25));
  const [plannedDate, setPlannedDate] = useState(savedDraft?.plannedDate || '');
  const [deadlineDate, setDeadlineDate] = useState(savedDraft?.deadlineDate || '');
  const [aiLoading, setAiLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [wizardStep, setWizardStep] = useState(savedDraft?.title.trim() ? savedDraft.wizardStep ?? 0 : 0);
  const stepLabels = uk ? ['Назва й опис', 'Категорія', 'Пріоритет', 'Дати', 'Облік часу', 'Підкроки'] : ['Title and description', 'Category', 'Priority', 'Dates', 'Time tracking', 'Substeps'];
  const stepHeadings = uk ? ['Що потрібно зробити?', 'До якої сфери належить?', 'Що важливе зараз?', 'Коли працюватимемо?', 'Як рахуватимемо час?', 'З яких кроків почнемо?'] : ['What needs to be done?', 'Which area does it belong to?', 'What matters right now?', 'When will we work?', 'How will we track time?', 'What steps will we take?'];
  const stepGuidance = uk ? ['Що потрібно зробити? Опис можна залишити порожнім.', 'Оберіть, до якої сфери належить завдання.', 'Наскільки важливе це завдання зараз?', 'Оберіть день роботи й дедлайн або просто продовжуйте без дат.', 'Оберіть облік часу. Він запуститься лише з картки завдання.', 'Розділіть завдання на кроки або залиште їх кількість нульовою.'] : ['What needs to be done? Description is optional.', 'Choose the area this task belongs to.', 'How important is this task right now?', 'Choose a working day and deadline, or continue without dates.', 'Choose time tracking. Start it later from the task card.', 'Break the task into steps, or leave the count at zero.'];
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const countdownRef = useRef<HTMLInputElement>(null);
  const plannedDateRef = useRef<HTMLInputElement>(null);
  const deadlineDateRef = useRef<HTMLInputElement>(null);
  const submitLock = useRef(false);
  const navigationLock = useRef(0);
  const nextFocus = useRef<'title' | 'countdown' | 'planned' | 'deadline' | null>(null);
  const requestGeneration = useRef(0);
  const aiRequest = useRef<AbortController | null>(null);
  const draftSnapshot = JSON.stringify({ title, note, phase, priority, steps, customSteps });
  const latestSnapshot = useRef(draftSnapshot);
  latestSnapshot.current = draftSnapshot;
  const minutes = Number(countdownMinutes);
  const validMinutes = countdownMinutes.trim() !== '' && Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440;
  const datesReversed = !!(plannedDate && deadlineDate && plannedDate > deadlineDate);
  const fieldClass = 'min-w-0 w-full bg-[#08080a] border border-neutral-800 text-white placeholder:text-neutral-500 px-3.5 py-3 text-sm leading-relaxed focus:outline-none focus:border-neutral-400 transition-colors';
  const priorityColor = priority === 1 ? '#f87171' : priority === 2 ? '#fbbf24' : '#34d399';

  useEffect(() => {
    try { saveQuickAddDraft(localStorage, { title, note, phase, priority, steps, customSteps, timerMode, countdownMinutes: validMinutes ? minutes : undefined, countdownInput: countdownMinutes, wizardStep, plannedDate: plannedDate || undefined, deadlineDate: deadlineDate || undefined }, ownerId); } catch { /* Keep the in-memory draft if storage is unavailable. */ }
  }, [title, note, phase, priority, steps, customSteps, timerMode, countdownMinutes, plannedDate, deadlineDate, wizardStep]);

  const cancelAi = () => {
    requestGeneration.current += 1;
    aiRequest.current?.abort();
    aiRequest.current = null;
    setAiLoading(false);
  };
  const closeDrawer = () => { cancelAi(); onClose(); };

  useEffect(() => {
    if (!isOpen) {
      requestGeneration.current += 1;
      aiRequest.current?.abort();
      aiRequest.current = null;
      setAiLoading(false);
      return;
    }
    submitLock.current = false;
    navigationLock.current = 0;
    const hasContent = hasQuickAddDraftContent({ title, note, customSteps, steps, timerMode: timerMode === 'countdown' ? timerMode : 'none', plannedDate, deadlineDate });
    const hasValidPhase = tabs.some(tab => tab.id === phase);
    if ((!hasContent || !hasValidPhase) && tabs.some(tab => tab.id === selectedPhase)) setPhase(selectedPhase!);
    else if (!hasValidPhase) setPhase(tabs[0]?.id || 'focus');

  }, [isOpen, selectedPhase, tabs]);

  useEffect(() => () => { requestGeneration.current += 1; aiRequest.current?.abort(); }, []);

  useEffect(() => {
    if (!isOpen) return;
    const focusTimer = window.setTimeout(() => {
      if (nextFocus.current) { ({ title: inputRef, countdown: countdownRef, planned: plannedDateRef, deadline: deadlineDateRef })[nextFocus.current].current?.focus(); nextFocus.current = null; }
      else if (wizardStep === 0) inputRef.current?.focus({ preventScroll: true });
      else document.getElementById('quick-add-step-heading')?.focus({ preventScroll: true });
    }, 50);
    return () => window.clearTimeout(focusTimer);
  }, [isOpen, wizardStep]);

  const validateDates = () => {
    if ((plannedDate && !isTaskDate(plannedDate)) || (deadlineDate && !isTaskDate(deadlineDate))) {
      nextFocus.current = plannedDate && !isTaskDate(plannedDate) ? 'planned' : 'deadline';
      setWizardStep(3);
      setError(uk ? 'Вкажіть коректну дату.' : 'Enter a valid date.');
      window.requestAnimationFrame(() => (plannedDate && !isTaskDate(plannedDate) ? plannedDateRef : deadlineDateRef).current?.focus());
      return false;
    }
    if (datesReversed) {
      nextFocus.current = 'planned';
      setWizardStep(3);
      setError(uk ? 'Дата роботи пізніша за дедлайн. Змініть одну з дат.' : 'The planned date is after the deadline. Change one of the dates.');
      window.requestAnimationFrame(() => plannedDateRef.current?.focus());
      return false;
    }
    return true;
  };

  const advanceStep = () => {
    if (Date.now() < navigationLock.current) return;
    if (!title.trim()) {
      nextFocus.current = 'title';
      setWizardStep(0);
      setError(uk ? 'Вкажіть назву завдання.' : 'Enter a task title.');
      window.requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    if (wizardStep === 3 && !validateDates()) return;
    if (wizardStep === 4 && timerMode === 'countdown' && !validMinutes) {
      setError(uk ? 'Вкажіть цілу кількість хвилин від 1 до 1440.' : 'Enter a whole number of minutes from 1 to 1440.');
      countdownRef.current?.focus();
      return;
    }
    setError('');
    nextFocus.current = null;
    navigationLock.current = Date.now() + 250;
    setWizardStep(previous => Math.min(5, previous + 1));
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (submitLock.current || Date.now() < navigationLock.current || aiLoading && wizardStep === 5) return;
    if (wizardStep < 5) { advanceStep(); return; }
    if (!title.trim()) {
      nextFocus.current = 'title';
      setWizardStep(0);
      setError(uk ? 'Вкажіть назву завдання.' : 'Enter a task title.');
      window.requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    if (timerMode === 'countdown' && !validMinutes) {
      nextFocus.current = 'countdown';
      setWizardStep(4);
      setError(uk ? 'Вкажіть цілу кількість хвилин від 1 до 1440.' : 'Enter a whole number of minutes from 1 to 1440.');
      window.requestAnimationFrame(() => countdownRef.current?.focus());
      return;
    }
    if (!validateDates()) return;
    submitLock.current = true;
    const stepList = buildQuickAddSteps(steps, customSteps, lang, `s-${Date.now()}`);
    try {
      const accepted = onAddTask({
        title: title.trim(), note: note.trim() || undefined,
        phase: tabs.some(tab => tab.id === phase) ? phase : tabs[0]?.id || 'focus', priority,
        steps, stepList: stepList.length ? stepList : undefined,
        timerMode, countdownDurationSeconds: timerMode === 'countdown' ? minutes * 60 : undefined,
        plannedDate: plannedDate || undefined, deadlineDate: deadlineDate || undefined,
      });
      if (accepted === false) {
        submitLock.current = false;
        setError(uk ? 'Не вдалося додати завдання. Чернетку збережено — спробуйте ще раз.' : 'Could not add the task. Your draft is saved — try again.');
        return;
      }
      sound.activate();
      cancelAi();
      try { saveQuickAddDraft(localStorage, { title: '', note: '', phase, priority, steps: 0, customSteps: [], timerMode: 'stopwatch', countdownMinutes: 25, wizardStep: 0 }, ownerId); } catch { /* Storage is optional. */ }
      setTitle(''); setNote(''); setCustomSteps([]); setSteps(0); setTimerMode('stopwatch'); setCountdownMinutes('25'); setPlannedDate(''); setDeadlineDate(''); setNotice(''); setError(''); setWizardStep(0);
      onClose();
    } catch {
      submitLock.current = false;
      setError(uk ? 'Не вдалося додати завдання. Ваші дані залишилися у формі.' : 'Could not add the task. Your entries are still in the form.');
    }
  };

  const handleGenerateSteps = async () => {
    if (!title.trim() || aiRequest.current) return;
    const controller = new AbortController();
    const generation = ++requestGeneration.current;
    const snapshot = latestSnapshot.current;
    aiRequest.current = controller;
    setAiLoading(true); setError(''); setNotice('');
    const timeout = window.setTimeout(() => {
      if (generation !== requestGeneration.current) return;
      controller.abort(); requestGeneration.current += 1; aiRequest.current = null; setAiLoading(false);
      setError(uk ? 'Створення кроків триває задовго. Чернетка збережена; спробуйте ще раз або додайте кроки вручну.' : 'Generating steps took too long. Your draft is safe; retry or add steps manually.');
    }, 35000);
    try {
      let customApiKey: string | undefined;
      let selectedModel: string | undefined;
      try {
        if (localStorage.getItem('karkas_custom_ai_enabled') === 'true') {
          customApiKey = localStorage.getItem('karkas_custom_api_key') || undefined;
          selectedModel = localStorage.getItem('karkas_custom_model') || undefined;
        }
      } catch { /* The basic step generator works without optional settings. */ }
      const response = await karkasApiFetch('/api/ai/breakdown-task', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ title: title.trim(), note: note.trim(), phase, priority, steps, currentSteps: customSteps.slice(0, steps).filter(text => text.trim()).map(text => ({ title: text.trim(), done: false })), tabs, lang, customApiKey, selectedModel }),
      });
      if (!response.ok) throw new Error('Generation failed');
      const body = await response.json();
      if (generation !== requestGeneration.current) return;
      if (latestSnapshot.current !== snapshot) {
        setNotice(uk ? 'Ви змінили чернетку під час генерації. Щоб зберегти ваші правки, повторіть створення кроків.' : 'You edited the draft during generation. Generate again to keep your changes.');
        return;
      }
      const suggestions = Array.isArray(body.stepList) ? body.stepList.flatMap((step: unknown) => {
        if (typeof step === 'string') return [step];
        return step && typeof step === 'object' && typeof (step as { title?: unknown }).title === 'string' ? [(step as { title: string }).title] : [];
      }) : [];
      if (!suggestions.some((text: string) => text.trim())) throw new Error('Empty suggestions');
      const merged = mergeQuickAddSuggestions(customSteps, suggestions);
      setCustomSteps(merged); setSteps(Math.min(12, Math.max(steps, merged.length)));
      setNotice(JSON.stringify(merged) === JSON.stringify(customSteps)
        ? (uk ? 'Ваші назви кроків збережено. Нові пропозиції вже є у списку або досягнуто межі 12 кроків.' : 'Your step names are preserved. Suggestions already exist or the 12-step limit was reached.')
        : body.source === 'gemini'
        ? (uk ? 'AI запропонував кроки. Перевірте назви та натисніть «Додати завдання».' : 'AI suggested steps. Review them, then add the task.')
        : (uk ? 'Кроки запропоновано базовим генератором. Перевірте назви перед додаванням.' : 'Steps were suggested by the basic generator. Review their names before adding.'));
    } catch {
      if (generation === requestGeneration.current) setError(uk ? 'Не вдалося створити кроки. Чернетка збережена; спробуйте ще раз або введіть їх вручну.' : 'Could not generate steps. Your draft is safe; retry or enter them manually.');
    } finally {
      window.clearTimeout(timeout);
      if (generation === requestGeneration.current) { aiRequest.current = null; setAiLoading(false); }
    }
  };

  const rangeClass = 'block w-full h-10 cursor-pointer accent-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';
  const footerButtonClass = 'min-h-11 min-w-28 inline-flex items-center justify-center gap-2 px-5 py-2 bg-white text-black font-semibold text-sm hover:bg-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors';
  return <AnimatePresence>{isOpen && <motion.div id="quick-add-drawer" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22, ease: 'easeOut' }} className="relative z-10 overflow-hidden border-b border-neutral-800 bg-[#08080a] font-sans">
    <form id="quick-add-task-form" noValidate onSubmit={handleSubmit} onKeyDown={event => { if (event.key === 'Enter' && event.target instanceof HTMLInputElement && event.target.type !== 'range' && !event.nativeEvent.isComposing) { event.preventDefault(); if (wizardStep < 5) handleSubmit(event); else { const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('#quick-add-steps-panel input[type=text]')); const nextInput = inputs[inputs.indexOf(event.target) + 1]; (nextInput || document.getElementById('quick-add-submit-btn'))?.focus(); } } if (event.key === 'Escape') { event.preventDefault(); closeDrawer(); } }} className="mx-auto my-3 sm:my-4 max-w-3xl max-h-[max(22rem,calc(100dvh-15rem))] overflow-y-auto overscroll-contain border border-neutral-800 bg-[#0c0c0d]">
      <div className="px-4 sm:px-6 pt-3 sm:pt-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-sm font-bold uppercase tracking-widest text-white">{uk ? 'Нове завдання' : 'New task'}</h2>
          <div className="flex items-center gap-3 sm:gap-5"><p className="text-xs font-mono tabular-nums text-neutral-400">{uk ? `Крок ${wizardStep + 1} із 6` : `Step ${wizardStep + 1} of 6`}</p><button type="button" id="quick-add-close-btn" aria-label={uk ? 'Закрити створення завдання — чернетка збережеться' : 'Close task creation — draft will be saved'} onClick={closeDrawer} className="min-h-11 min-w-11 flex items-center justify-center text-neutral-500 hover:text-white focus-visible:outline-2 focus-visible:outline-white"><X className="w-4 h-4" /></button></div>
        </div>
        <div role="progressbar" aria-label={uk ? 'Створення завдання' : 'Task creation'} aria-valuemin={1} aria-valuemax={6} aria-valuenow={wizardStep + 1} aria-valuetext={stepLabels[wizardStep]} className="mt-2 grid grid-cols-6 gap-1.5" >{stepLabels.map((label, index) => <span key={label} aria-hidden="true" className={`h-1 ${index <= wizardStep ? 'bg-white' : 'bg-neutral-700'}`} />)}</div>
      </div>
      <div className="px-4 sm:px-6 pt-5 sm:pt-6 pb-5 sm:pb-6">
        <div aria-live="polite" className="mb-5"><h3 id="quick-add-step-heading" tabIndex={-1} className="focus:outline-none text-xl sm:text-2xl leading-tight font-semibold tracking-tight text-white">{stepHeadings[wizardStep]}</h3><p className="mt-2 text-sm leading-relaxed text-neutral-400">{stepGuidance[wizardStep]}</p></div>
        <div id="quick-add-current-step" className="min-h-48 sm:min-h-56">
        {wizardStep === 0 && <section aria-labelledby="quick-add-basics-heading" className="max-w-3xl space-y-5">
          <h3 id="quick-add-basics-heading" className="sr-only">{uk ? 'Що потрібно зробити' : 'What needs to be done'}</h3>
          <label htmlFor="quick-add-title-input" className="block"><span className="block mb-2 text-xs text-neutral-400">{uk ? 'Назва завдання' : 'Task title'}</span><input ref={inputRef} id="quick-add-title-input" type="text" value={title} onChange={event => { setTitle(event.target.value); setError(''); }} placeholder={uk ? 'Наприклад, завершити важливу справу' : 'For example, finish an important task'} className="w-full min-w-0 min-h-11 bg-transparent border-b border-neutral-700 pb-2 text-base sm:text-lg font-medium tracking-tight text-white placeholder:text-neutral-600 focus:outline-none focus:border-white transition-colors" /></label>
          <label htmlFor="quick-add-note-input" className="block"><span className="block mb-2 text-xs text-neutral-400">{uk ? 'Опис' : 'Description'}<span className="ml-2 text-neutral-600">{uk ? 'необов’язково' : 'optional'}</span></span><textarea ref={noteRef} id="quick-add-note-input" rows={3} value={note} onChange={event => setNote(event.target.value)} placeholder={uk ? 'Деталі, які допоможуть почати' : 'Details that will help you get started'} className="block w-full min-h-20 resize-y bg-transparent py-2 text-sm leading-relaxed text-neutral-300 placeholder:text-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600" /></label>
        </section>}
        {wizardStep === 1 && <fieldset id="quick-add-category-options" className="min-w-0">
          <legend className="sr-only">{uk ? 'Категорія' : 'Category'}</legend>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3">{tabs.map(tab => <button type="button" key={tab.id} id={`quick-add-tab-${tab.id.toLowerCase()}`} aria-pressed={phase === tab.id} onClick={() => setPhase(tab.id)} className={`min-h-20 sm:min-h-24 min-w-0 text-left px-3 sm:px-4 py-3 border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${phase === tab.id ? 'border-white bg-white/5 text-white' : 'border-neutral-800 text-neutral-400 hover:border-neutral-500 hover:text-white'}`}><span className="mb-3 flex items-center justify-between gap-3"><span aria-hidden="true" className="h-2.5 w-2.5" style={{ backgroundColor: tab.color || '#a3a3a3' }} />{phase === tab.id && <Check aria-hidden="true" className="w-4 h-4 text-white" />}</span><span className="block break-words text-sm font-medium">{(t.phases as Record<string, string>)[tab.id] || tab.name}</span></button>)}</div>
        </fieldset>}
        {wizardStep === 2 && <fieldset id="quick-add-priority-options" className="min-w-0 max-w-3xl mx-auto py-3 sm:py-4">
          <legend className="sr-only">{uk ? 'Пріоритет' : 'Priority'}</legend>
          <div className="mb-5 text-center"><span className="inline-block mb-3 h-1 w-10" aria-hidden="true" style={{ backgroundColor: priorityColor }} /><p className="text-xl sm:text-2xl font-medium tracking-tight text-white">{uk ? ['Терміновий', 'Звичайний', 'Низький'][priority - 1] : ['Urgent', 'Standard', 'Low'][priority - 1]}</p><p className="mt-2 text-sm text-neutral-400">{uk ? ['Потребує уваги в першу чергу.', 'Важливо, але без зайвого поспіху.', 'Може зачекати, поки звільниться час.'][priority - 1] : ['Needs attention first.', 'Important, without unnecessary pressure.', 'Can wait until there is time.'][priority - 1]}</p></div>
          <input id="quick-add-priority-slider" aria-label={uk ? 'Пріоритет' : 'Priority'} type="range" min="0" max="2" step="1" value={3 - priority} onChange={event => setPriority((3 - Number(event.target.value)) as 1 | 2 | 3)} aria-valuetext={uk ? ['Терміновий', 'Звичайний', 'Низький'][priority - 1] : ['Urgent', 'Standard', 'Low'][priority - 1]} className={rangeClass} />
          <div className="flex justify-between mt-1 text-sm text-neutral-500">{([3, 2, 1] as const).map(value => <span key={value} className={priority === value ? 'font-medium text-white' : ''}>{uk ? ['Терміновий', 'Звичайний', 'Низький'][value - 1] : ['Urgent', 'Standard', 'Low'][value - 1]}</span>)}</div>
        </fieldset>}
        {wizardStep === 3 && <section id="quick-add-dates-panel" aria-label={uk ? 'Дати завдання' : 'Task dates'} className="min-w-0">
          <TaskDateCalendar plannedDate={plannedDate} deadlineDate={deadlineDate} onPlannedDateChange={value => { setPlannedDate(value); setError(''); }} onDeadlineDateChange={value => { setDeadlineDate(value); setError(''); }} lang={lang} plannedInputRef={plannedDateRef} deadlineInputRef={deadlineDateRef} invalid={datesReversed || !!plannedDate && !isTaskDate(plannedDate) || !!deadlineDate && !isTaskDate(deadlineDate)} />
        </section>}
        {wizardStep === 4 && <section id="quick-add-timer-panel" aria-labelledby="quick-add-timer-heading" className="min-w-0">
          <h4 id="quick-add-timer-heading" className="sr-only">{uk ? 'Облік часу' : 'Time tracking'}</h4>
          <fieldset className="min-w-0"><legend className="sr-only">{uk ? 'Режим таймера' : 'Timer mode'}</legend><div className="grid grid-cols-3 gap-2 sm:gap-4">{(['none', 'stopwatch', 'countdown'] as const).map((mode, index) => <button key={mode} type="button" id={`quick-add-timer-${mode}`} aria-pressed={timerMode === mode} onClick={() => { setTimerMode(mode); setError(''); }} className={`min-h-14 sm:min-h-16 px-2 sm:px-3 text-sm border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${timerMode === mode ? 'border-white text-white bg-white/5 font-medium' : 'border-neutral-800 text-neutral-400 hover:border-neutral-500 hover:text-white'}`}>{uk ? ['Без обліку', 'Облік часу', 'Відлік'][index] : ['No tracking', 'Track time', 'Countdown'][index]}</button>)}</div></fieldset>
          {timerMode === 'countdown' ? <div className="max-w-3xl mx-auto mt-5">
            <div className="flex items-center justify-between gap-3"><label htmlFor="quick-add-countdown-slider" className="text-sm text-neutral-400">{uk ? 'Тривалість' : 'Duration'}</label><label htmlFor="quick-add-countdown-minutes" className="flex items-center gap-2 text-sm text-neutral-400"><span className="sr-only">{uk ? 'Точна тривалість у хвилинах (1–1440)' : 'Exact duration in minutes (1–1440)'}</span><input ref={countdownRef} id="quick-add-countdown-minutes" type="number" inputMode="numeric" min="1" max="1440" step="1" required value={countdownMinutes} aria-invalid={!validMinutes} onChange={event => { setCountdownMinutes(event.target.value); setError(''); }} className="w-20 min-h-12 bg-transparent border-b border-neutral-600 text-white text-right text-2xl px-1 focus:outline-none focus:border-white" />{uk ? 'хв' : 'min'}</label></div>
            <input id="quick-add-countdown-slider" type="range" min="5" max="120" step="1" value={validMinutes ? Math.min(120, Math.max(5, minutes)) : 25} onChange={event => { setCountdownMinutes(event.target.value); setError(''); }} aria-valuetext={`${validMinutes ? Math.min(120, Math.max(5, minutes)) : 25} ${uk ? 'хвилин' : 'minutes'}`} className={rangeClass} />
            <div className="flex justify-between mt-1 text-sm text-neutral-500"><span>5 {uk ? 'хв' : 'min'}</span><span>60</span><span>120</span></div>
            <p className="mt-4 text-sm text-neutral-400">{uk ? 'Збережеться на паузі. Запустіть у картці, коли почнете.' : 'Saved paused. Start from the card when ready.'}</p>
          </div> : <div className="py-5 sm:py-6 text-center"><Timer aria-hidden="true" className="mx-auto mb-3 w-6 h-6 text-neutral-500" /><p className="text-xl sm:text-2xl font-medium text-white">{timerMode === 'stopwatch' ? '00:00' : (uk ? 'Без таймера' : 'No timer')}</p><p className="mt-2 text-sm leading-relaxed text-neutral-400">{timerMode === 'stopwatch' ? (uk ? 'Почнете працювати — запустіть облік у картці.' : 'Start tracking from the card when you begin working.') : (uk ? 'Зосередьтеся на завданні без обліку часу.' : 'Focus on the task without tracking time.')}</p></div>}
        </section>}
        {wizardStep === 5 && <section id="quick-add-steps-panel" aria-labelledby="quick-add-steps-label" className="min-w-0 max-w-3xl mx-auto">
          <div className="flex items-center justify-between gap-4"><label id="quick-add-steps-label" htmlFor="quick-add-step-count" className="flex items-baseline gap-3 text-sm text-neutral-400">{uk ? 'Кількість підкроків' : 'Number of substeps'}<strong className="font-mono text-2xl font-medium text-white">{steps}</strong></label><button type="button" id="quick-add-ai-generate-btn" disabled={!title.trim() || aiLoading} aria-busy={aiLoading} onClick={handleGenerateSteps} className="min-h-11 flex items-center gap-2 text-sm text-neutral-300 hover:text-white focus-visible:outline-2 focus-visible:outline-white disabled:text-neutral-500 disabled:cursor-not-allowed"><AIIcon className="w-4 h-4 shrink-0" /><span>{aiLoading ? (uk ? 'Генерую…' : 'Generating…') : (uk ? 'Запропонувати з ШІ' : 'Suggest with AI')}</span></button></div>
          <input id="quick-add-step-count" type="range" min="0" max="12" step="1" value={steps} onChange={event => setSteps(Number(event.target.value))} aria-valuetext={uk ? `${steps} підкроків` : `${steps} substeps`} className={rangeClass} />
          <div className="flex justify-between mt-1 mb-6 text-sm text-neutral-500"><span>{uk ? 'Без підкроків' : 'No substeps'}</span><span>6</span><span>12</span></div>
          {customSteps.slice(steps).some(text => text.trim()) && <p className="mb-3 text-sm text-amber-300">{uk ? 'Приховані назви збережено. Збільште кількість, щоб повернути їх.' : 'Hidden names are saved. Increase the count to restore them.'}</p>}
          {!steps && <p className="mt-9 text-center text-sm text-neutral-400">{uk ? 'Можна додати завдання без підкроків і розділити його пізніше.' : 'You can add the task without substeps and break it down later.'}</p>}
          <div className="max-h-60 overflow-y-auto overscroll-contain pr-1 space-y-2">{Array.from({ length: steps }, (_, index) => <label key={index} htmlFor={`custom-step-input-${index}`} className="flex items-center gap-4 text-sm text-neutral-500"><span className="w-5 shrink-0 font-mono">{String(index + 1).padStart(2, '0')}</span><input id={`custom-step-input-${index}`} type="text" aria-label={uk ? `Назва кроку ${index + 1}` : `Step ${index + 1} name`} value={customSteps[index] || ''} onChange={event => setCustomSteps(previous => { const next = Array.from({ length: Math.max(previous.length, index + 1) }, (_, row) => previous[row] || ''); next[index] = event.target.value; return next; })} placeholder={`${uk ? 'Крок' : 'Step'} ${index + 1}`} className={`${fieldClass} !bg-transparent !border-x-0 !border-t-0 !px-0 !py-2 !text-sm min-h-11`} /></label>)}</div>
        </section>}
        </div>
        {notice && <p role="status" className="mt-5 text-sm text-neutral-300 leading-relaxed">{notice}</p>}
        {(error || datesReversed && wizardStep === 3) && <p id={wizardStep === 3 ? 'quick-add-dates-warning' : undefined} role="alert" className="mt-5 text-sm text-rose-300 leading-relaxed">{error || (uk ? 'Дата роботи пізніша за дедлайн. Змініть одну з дат.' : 'The planned date is after the deadline. Change one of the dates.')}</p>}
      </div>
      <div className="sticky bottom-0 z-10 flex items-center justify-between gap-3 px-4 sm:px-6 py-3 border-t border-neutral-800 bg-[#0c0c0d]">
        {wizardStep > 0 ? <button type="button" id="quick-add-back-btn" onClick={() => { if (Date.now() < navigationLock.current) return; navigationLock.current = Date.now() + 250; nextFocus.current = null; setError(''); setWizardStep(previous => Math.max(0, previous - 1)); }} className="min-h-11 inline-flex items-center gap-2 pr-3 text-sm text-neutral-300 hover:text-white focus-visible:outline-2 focus-visible:outline-white"><ChevronLeft className="w-5 h-5" />{uk ? 'Назад' : 'Back'}</button> : <span className="max-w-36 sm:max-w-none text-xs sm:text-sm text-neutral-500">{uk ? 'Закриття не очищає форму' : 'Closing keeps your entries'}</span>}
        {wizardStep < 5 ? <button type="submit" id="quick-add-next-btn" disabled={wizardStep === 0 && !title.trim()} className={footerButtonClass}>{uk ? 'Далі' : 'Next'}<ChevronRight className="w-5 h-5" /></button> : <button type="submit" id="quick-add-submit-btn" disabled={!title.trim() || aiLoading} className={footerButtonClass}><Plus className="w-5 h-5" />{t.quickAdd.submitBtn}</button>}
      </div>
    </form>
  </motion.div>}</AnimatePresence>;
};
