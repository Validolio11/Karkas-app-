import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { TaskTab, NewTaskInput } from '../types';
import { sound } from '../utils/audio';
import { Language, TRANSLATIONS } from '../utils/i18n';
import { karkasApiFetch } from '../utils/desktopApi';
import { Plus, X } from 'lucide-react';
import { AIIcon } from './AIIconTemplates';
import { buildQuickAddSteps, hasQuickAddDraftContent, mergeQuickAddSuggestions, readQuickAddDraft, saveQuickAddDraft } from './quickAddDraft';

interface QuickAddDrawerProps {
  isOpen: boolean;
  lang: Language;
  tabs: TaskTab[];
  selectedPhase?: string;
  onClose: () => void;
  onAddTask: (task: NewTaskInput) => void | boolean;
  onOpenAIWithPrompt?: (prompt: string) => void;
}

export const QuickAddDrawer: React.FC<QuickAddDrawerProps> = ({ isOpen, lang, tabs, selectedPhase, onClose, onAddTask }) => {
  const t = TRANSLATIONS[lang];
  const uk = lang === 'uk';
  const [savedDraft] = useState(() => { try { return readQuickAddDraft(localStorage); } catch { return null; } });
  const [title, setTitle] = useState(savedDraft?.title || '');
  const [note, setNote] = useState(savedDraft?.note || '');
  const [phase, setPhase] = useState(() => {
    if (savedDraft?.phase && tabs.some(tab => tab.id === savedDraft.phase)) return savedDraft.phase;
    return tabs.some(tab => tab.id === selectedPhase) ? selectedPhase! : tabs[0]?.id || 'focus';
  });
  const [priority, setPriority] = useState<1 | 2 | 3>(savedDraft?.priority || 2);
  const [customSteps, setCustomSteps] = useState<string[]>(savedDraft?.customSteps || []);
  const [steps, setSteps] = useState(() => savedDraft?.timerMode === undefined && savedDraft?.customSteps.length
    ? Math.min(12, savedDraft.customSteps.length) : savedDraft?.steps ?? 0);
  const [timerMode, setTimerMode] = useState<'none' | 'stopwatch' | 'countdown'>(savedDraft?.timerMode || 'none');
  const [countdownMinutes, setCountdownMinutes] = useState(savedDraft?.countdownInput ?? String(savedDraft?.countdownMinutes || 25));
  const [aiLoading, setAiLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const countdownRef = useRef<HTMLInputElement>(null);
  const submitLock = useRef(false);
  const requestGeneration = useRef(0);
  const aiRequest = useRef<AbortController | null>(null);
  const draftSnapshot = JSON.stringify({ title, note, phase, priority, steps, customSteps });
  const latestSnapshot = useRef(draftSnapshot);
  latestSnapshot.current = draftSnapshot;
  const minutes = Number(countdownMinutes);
  const validMinutes = countdownMinutes.trim() !== '' && Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440;
  const fieldClass = 'min-w-0 w-full bg-[#08080a] border border-neutral-800 text-white placeholder:text-neutral-500 px-3.5 py-3 text-sm leading-relaxed focus:outline-none focus:border-neutral-400 transition-colors';
  const buttonClass = 'min-h-11 px-3 py-2 text-xs border transition-colors';

  useEffect(() => {
    try { saveQuickAddDraft(localStorage, { title, note, phase, priority, steps, customSteps, timerMode, countdownMinutes: validMinutes ? minutes : undefined, countdownInput: countdownMinutes }); } catch { /* Keep the in-memory draft if storage is unavailable. */ }
  }, [title, note, phase, priority, steps, customSteps, timerMode, countdownMinutes]);

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
    const hasContent = hasQuickAddDraftContent({ title, note, customSteps, steps, timerMode });
    const hasValidPhase = tabs.some(tab => tab.id === phase);
    if ((!hasContent || !hasValidPhase) && tabs.some(tab => tab.id === selectedPhase)) setPhase(selectedPhase!);
    else if (!hasValidPhase) setPhase(tabs[0]?.id || 'focus');
    const focusTimer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(focusTimer);
  }, [isOpen, selectedPhase, tabs]);

  useEffect(() => () => { requestGeneration.current += 1; aiRequest.current?.abort(); }, []);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (submitLock.current) return;
    if (!title.trim()) {
      setError(uk ? 'Вкажіть назву завдання.' : 'Enter a task title.');
      inputRef.current?.focus();
      return;
    }
    if (timerMode === 'countdown' && !validMinutes) {
      setError(uk ? 'Вкажіть цілу кількість хвилин від 1 до 1440.' : 'Enter a whole number of minutes from 1 to 1440.');
      countdownRef.current?.focus();
      return;
    }
    submitLock.current = true;
    const stepList = buildQuickAddSteps(steps, customSteps, lang, `s-${Date.now()}`);
    try {
      const accepted = onAddTask({
        title: title.trim(), note: note.trim() || undefined,
        phase: tabs.some(tab => tab.id === phase) ? phase : tabs[0]?.id || 'focus', priority,
        steps, stepList: stepList.length ? stepList : undefined,
        timerMode, countdownDurationSeconds: timerMode === 'countdown' ? minutes * 60 : undefined,
      });
      if (accepted === false) {
        submitLock.current = false;
        setError(uk ? 'Не вдалося додати завдання. Чернетку збережено — спробуйте ще раз.' : 'Could not add the task. Your draft is saved — try again.');
        return;
      }
      sound.activate();
      cancelAi();
      try { saveQuickAddDraft(localStorage, { title: '', note: '', phase, priority, steps: 0, customSteps: [], timerMode: 'none', countdownMinutes: 25 }); } catch { /* Storage is optional. */ }
      setTitle(''); setNote(''); setCustomSteps([]); setSteps(0); setTimerMode('none'); setCountdownMinutes('25'); setNotice(''); setError('');
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

  return <AnimatePresence>{isOpen && <motion.div id="quick-add-drawer" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22, ease: 'easeOut' }} className="relative z-10 overflow-hidden bg-[#0c0c0e] border-b border-neutral-800 font-sans">
    <form id="quick-add-task-form" noValidate onSubmit={handleSubmit} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); closeDrawer(); } }} className="p-5 sm:p-6 max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-x-6 md:gap-y-4 [&_button]:min-h-11 [&_input]:min-h-11">
      <div className="flex items-end gap-2 md:col-span-2">
        <label className="min-w-0 flex-1 text-xs text-neutral-400" htmlFor="quick-add-title-input">{uk ? 'Назва завдання' : 'Task title'}
          <input ref={inputRef} id="quick-add-title-input" type="text" value={title} onChange={event => { setTitle(event.target.value); setError(''); }} placeholder={t.quickAdd.titlePlaceholder} className={`${fieldClass} mt-2 border-neutral-700`} />
        </label>
        <button type="button" id="quick-add-close-btn" aria-label={uk ? 'Закрити створення завдання — чернетка збережеться' : 'Close task creation — draft will be saved'} onClick={closeDrawer} className="min-w-11 p-3 border border-neutral-800 text-neutral-400 hover:text-white shrink-0"><X className="w-4 h-4" /></button>
      </div>
      <label htmlFor="quick-add-note-input" className="text-xs text-neutral-400 md:col-span-2">{uk ? 'Нотатка (необов’язково)' : 'Note (optional)'}<input id="quick-add-note-input" type="text" value={note} onChange={event => setNote(event.target.value)} placeholder={t.quickAdd.notePlaceholder} className={`${fieldClass} mt-2`} /></label>
      <fieldset className="min-w-0"><legend className="mb-2 text-xs text-neutral-400">{uk ? 'Вкладка' : 'Tab'}</legend><div className="flex flex-wrap gap-2">
        {tabs.length ? tabs.map(tab => <button key={tab.id} type="button" id={`quick-add-tab-${tab.id.toLowerCase()}`} aria-pressed={phase === tab.id} onClick={() => setPhase(tab.id)} className={`${buttonClass} max-w-full min-w-0 flex items-center gap-2 ${phase === tab.id ? 'border-white bg-white text-black font-bold' : 'border-neutral-800 text-neutral-300 bg-neutral-900/60'}`}>{tab.color && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: tab.color }} />}<span className="[overflow-wrap:anywhere]">{(t.phases as Record<string, string>)[tab.id] || tab.name}</span></button>) : <span className="text-xs text-neutral-400">{uk ? 'Усі завдання' : 'All tasks'}</span>}
      </div></fieldset>
      <fieldset className="min-w-0"><legend className="mb-2 text-xs text-neutral-400">{uk ? 'Пріоритет' : 'Priority'}</legend><div className="flex flex-wrap gap-2">
        {([1, 2, 3] as const).map(value => <button key={value} type="button" id={`quick-add-pri-${value}`} aria-pressed={priority === value} onClick={() => setPriority(value)} className={`${buttonClass} ${priority === value ? value === 1 ? 'border-red-400 bg-red-400 text-black font-bold' : value === 2 ? 'border-amber-400 bg-amber-400 text-black font-bold' : 'border-emerald-400 bg-emerald-400 text-black font-bold' : 'border-neutral-800 text-neutral-300 bg-neutral-900/60'}`}>{uk ? ['Терміновий', 'Звичайний', 'Низький'][value - 1] : ['Urgent', 'Standard', 'Low'][value - 1]}</button>)}
      </div></fieldset>
      <section aria-labelledby="quick-add-steps-label" className="min-w-0 pt-4 border-t border-neutral-800">
        <div className="flex flex-wrap items-center justify-between gap-3"><label id="quick-add-steps-label" htmlFor="quick-add-step-count" className="text-xs text-neutral-300">{uk ? 'Підкроки' : 'Substeps'}: <strong>{steps}</strong></label>
          <button type="button" id="quick-add-ai-generate-btn" disabled={!title.trim() || aiLoading} aria-busy={aiLoading} onClick={handleGenerateSteps} className={`${buttonClass} flex items-center justify-center gap-2 border-neutral-700 text-neutral-200 disabled:opacity-40 disabled:cursor-not-allowed`}><AIIcon className="w-4 h-4" /><span>{aiLoading ? (uk ? 'Створення кроків…' : 'Generating steps…') : (uk ? 'Створити кроки з AI' : 'Generate steps with AI')}</span></button>
        </div>
        <input id="quick-add-step-count" type="range" min="0" max="12" step="1" value={steps} onChange={event => setSteps(Number(event.target.value))} aria-valuetext={uk ? `${steps} підкроків` : `${steps} substeps`} className="w-full accent-white cursor-pointer" />
        <p className="mb-3 text-xs leading-relaxed text-neutral-400">{steps === 0 ? (uk ? 'Без підкроків: завдання можна виконати однією дією.' : 'No substeps: complete this task in one action.') : (uk ? 'Назви можна залишити порожніми — будуть «Крок 1», «Крок 2»…' : 'Blank names will become “Step 1”, “Step 2”…')}</p>
        {customSteps.slice(steps).some(text => text.trim()) && <p className="mb-3 text-xs text-amber-300">{uk ? 'Приховані назви збережено в чернетці. Збільште кількість, щоб повернути їх; до нового завдання потраплять лише видимі кроки.' : 'Hidden names remain in your draft. Increase the count to restore them; only visible steps will be added.'}</p>}
        <div className="space-y-3">{Array.from({ length: steps }, (_, index) => <label key={index} className="flex items-center gap-2 text-xs text-neutral-400" htmlFor={`custom-step-input-${index}`}><span className="shrink-0">{index + 1}.</span><input type="text" id={`custom-step-input-${index}`} aria-label={uk ? `Назва кроку ${index + 1}` : `Step ${index + 1} name`} value={customSteps[index] || ''} onChange={event => setCustomSteps(previous => { const next = Array.from({ length: Math.max(previous.length, index + 1) }, (_, row) => previous[row] || ''); next[index] = event.target.value; return next; })} placeholder={`${uk ? 'Крок' : 'Step'} ${index + 1}`} className={fieldClass} /></label>)}</div>
      </section>
      <fieldset className="min-w-0 pt-4 border-t border-neutral-800"><legend className="text-xs text-neutral-300">{uk ? 'Таймер' : 'Timer'}</legend><div className="flex flex-wrap gap-2 mb-3">
        {(['none', 'stopwatch', 'countdown'] as const).map((mode, index) => <button type="button" key={mode} id={`quick-add-timer-${mode}`} aria-pressed={timerMode === mode} onClick={() => { setTimerMode(mode); setError(''); }} className={`${buttonClass} ${timerMode === mode ? 'border-white bg-white text-black font-bold' : 'border-neutral-800 text-neutral-300 bg-neutral-900/60'}`}>{uk ? ['Без таймера', 'Секундомір', 'Зворотний відлік'][index] : ['No timer', 'Stopwatch', 'Countdown'][index]}</button>)}
      </div>
      {timerMode === 'countdown' && <div className="space-y-3">
        <div className="flex flex-wrap gap-2">{[15, 25, 45, 60].map(value => <button type="button" key={value} id={`quick-add-countdown-preset-${value}`} aria-pressed={validMinutes && minutes === value} onClick={() => { setCountdownMinutes(String(value)); setError(''); }} className={`${buttonClass} ${minutes === value ? 'border-white text-white' : 'border-neutral-800 text-neutral-400'}`}>{value} {uk ? 'хв' : 'min'}</button>)}</div>
        <label htmlFor="quick-add-countdown-slider" className="block text-xs text-neutral-400">{uk ? 'Швидкий вибір: 5–120 хв' : 'Quick selection: 5–120 min'}<input id="quick-add-countdown-slider" type="range" min="5" max="120" step="1" value={validMinutes ? Math.min(120, Math.max(5, minutes)) : 25} onChange={event => { setCountdownMinutes(event.target.value); setError(''); }} aria-valuetext={`${validMinutes ? Math.min(120, Math.max(5, minutes)) : 25} ${uk ? 'хвилин' : 'minutes'}`} className="block w-full accent-white cursor-pointer" /></label>
        <label htmlFor="quick-add-countdown-minutes" className="block text-xs text-neutral-400">{uk ? 'Точна тривалість у хвилинах (1–1440)' : 'Exact duration in minutes (1–1440)'}<input ref={countdownRef} id="quick-add-countdown-minutes" type="number" inputMode="numeric" min="1" max="1440" step="1" required value={countdownMinutes} aria-invalid={!validMinutes} onChange={event => { setCountdownMinutes(event.target.value); setError(''); }} className={`${fieldClass} mt-2 max-w-48`} /></label>
      </div>}
      <p className="mt-3 text-xs leading-relaxed text-neutral-400">{timerMode === 'none' ? (uk ? 'Таймер не налаштовано.' : 'No timer configured.') : timerMode === 'stopwatch' ? (uk ? 'Секундомір почне рахувати лише після натискання «Старт» у завданні.' : 'The stopwatch will start only when you press Start on the task.') : validMinutes ? (uk ? `Зворотний відлік: ${minutes} хв. Збережеться на паузі — запустіть, коли будете готові.` : `Countdown: ${minutes} min. Saved paused — start it when you are ready.`) : (uk ? 'Вкажіть тривалість від 1 до 1440 хв.' : 'Enter a duration between 1 and 1440 min.')}</p>
      </fieldset>
      {notice && <p role="status" className="text-xs leading-relaxed text-neutral-300 md:col-span-2">{notice}</p>}
      {error && <p role="alert" className="text-xs leading-relaxed text-rose-300 md:col-span-2">{error}</p>}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2 md:col-span-2"><p className="text-xs leading-relaxed text-neutral-500">{uk ? 'Чернетка збережеться після закриття.' : 'Your draft is saved when you close this form.'}</p><button type="submit" id="quick-add-submit-btn" disabled={!title.trim()} className="min-h-11 flex items-center justify-center gap-2 px-4 py-3 bg-white text-black font-bold text-xs hover:bg-neutral-200 disabled:opacity-40 disabled:cursor-not-allowed"><Plus className="w-4 h-4" /><span>{t.quickAdd.submitBtn}</span></button></div>
    </form>
  </motion.div>}</AnimatePresence>;
};
