import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { PSTask, TaskTab, DeletedTask, WorkflowStats, TaskStepItem, AdaptiveProfile } from '../types';
import { sound } from '../utils/audio';
import { Language, TRANSLATIONS, AI_PRESETS_UK, AI_PRESETS_EN } from '../utils/i18n';
import { X, CornerDownLeft, Plus, CheckCircle2, ListTree, Sparkles, Activity, Layers, ArrowRight, Lightbulb } from 'lucide-react';
import { AIIcon, AIIconId } from './AIIconTemplates';
import { shouldVerifyAsApiKey } from '../utils/apiKey';
import { verifyApiKey, keyVerificationMessage } from '../utils/verifyApiKey';

interface AIAssistantSheetProps {
  isOpen: boolean;
  lang: Language;
  tabs?: TaskTab[];
  onClose: () => void;
  currentTasks: PSTask[];
  deletedTasks?: DeletedTask[];
  stats?: WorkflowStats;
  adaptiveProfile?: AdaptiveProfile;
  initialPrompt?: string;
  aiIconVariant?: AIIconId;
  onInjectTasks: (newTasks: Omit<PSTask, 'id' | 'currentStep' | 'done' | 'pinned' | 'createdAt'>[]) => void;
}

type AIMode = 'chat' | 'breakdown' | 'analyze' | 'generate';

interface AIChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AIChatOption {
  label: string;
  text: string;
}

const parseChatOptions = (content: string): { body: string; options: AIChatOption[] } => {
  const lines = content.split('\n');
  const options: AIChatOption[] = [];
  const bodyLines: string[] = [];

  for (const line of lines) {
    const match = line.trim().match(/^(\d+|[А-Яа-яA-Za-z])\s*[.)\-:]\s+(.+)$/);
    if (match) {
      options.push({ label: match[1].toUpperCase(), text: match[2].trim() });
    } else {
      bodyLines.push(line);
    }
  }

  return { body: bodyLines.join('\n').replace(/\n{3,}/g, '\n\n').trim(), options };
};

interface AIResponse {
  summary: string;
  reply?: string;
  insights?: string[];
  tasks: {
    title: string;
    phase: string;
    priority: 1 | 2 | 3;
    steps: number;
    stepList?: { title: string; done?: boolean }[];
    note?: string;
    reason?: string;
  }[];
  source: string;
}

const isChatModel = (model: string) => {
  const name = model.toLowerCase();
  return name.includes('gemini') && !/(embedding|image|tts|transcrib|robotics|computer-use)/.test(name);
};

export const AIAssistantSheet: React.FC<AIAssistantSheetProps> = ({
  isOpen,
  lang,
  tabs = [],
  onClose,
  currentTasks,
  deletedTasks = [],
  stats,
  adaptiveProfile,
  initialPrompt = '',
  aiIconVariant,
  onInjectTasks,
}) => {
  const t = TRANSLATIONS[lang];
  const presets = lang === 'uk' ? AI_PRESETS_UK : AI_PRESETS_EN;
  const personalizedPresets = useMemo(() => {
    if (!adaptiveProfile || adaptiveProfile.trackedTasks === 0) return presets;

    const preferredPhase = adaptiveProfile.preferredPhases[0];
    const preferredTab = tabs.find((tab) => tab.id === preferredPhase)?.name || preferredPhase;
    const scenarioList: string[] = [];

    if (lang === 'uk') {
      if (adaptiveProfile.overloadedPhases.length > 0 || adaptiveProfile.activeLoad > adaptiveProfile.recommendedActiveLimit) {
        scenarioList.push('Розвантажити чергу та залишити 3 головні задачі');
      }
      if (adaptiveProfile.urgentLoad > 0) {
        scenarioList.push('Скласти план закриття термінових задач без перемикання контексту');
      }
      if (adaptiveProfile.averageCompletionMinutes > 0 && adaptiveProfile.averageCompletionMinutes <= 30) {
        scenarioList.push('Сформувати план із коротких 25-хвилинних спринтів');
      } else {
        scenarioList.push('Розбити найбільшу задачу на реалістичні етапи');
      }
      if (preferredTab) {
        scenarioList.push(`Скласти наступний робочий цикл для категорії «${preferredTab}»`);
      }
      scenarioList.push('Проаналізувати мій темп і скоригувати план на тиждень');
    } else {
      if (adaptiveProfile.overloadedPhases.length > 0 || adaptiveProfile.activeLoad > adaptiveProfile.recommendedActiveLimit) {
        scenarioList.push('Reduce the queue to three essential tasks');
      }
      if (adaptiveProfile.urgentLoad > 0) {
        scenarioList.push('Plan urgent tasks without context switching');
      }
      if (adaptiveProfile.averageCompletionMinutes > 0 && adaptiveProfile.averageCompletionMinutes <= 30) {
        scenarioList.push('Build a plan from focused 25-minute sprints');
      } else {
        scenarioList.push('Break the largest task into realistic stages');
      }
      if (preferredTab) {
        scenarioList.push(`Plan the next work cycle for ${preferredTab}`);
      }
      scenarioList.push('Analyze my pace and adjust the weekly plan');
    }

    return scenarioList.slice(0, 5);
  }, [adaptiveProfile, lang, presets, tabs]);
  const [prompt, setPrompt] = useState(initialPrompt);
  const [mode, setMode] = useState<AIMode>('chat');
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<AIResponse | null>(null);
  const [chatMessages, setChatMessages] = useState<AIChatMessage[]>([]);
  const [pendingChatTasks, setPendingChatTasks] = useState<AIResponse['tasks'] | null>(null);
  const [awaitingApiKey, setAwaitingApiKey] = useState(false);
  const [keyStatus, setKeyStatus] = useState<string | null>(null);
  const pendingRequest = useRef<{ text: string; mode: AIMode } | null>(null);
  const requestInFlight = useRef(false);
  const awaitingKeyRef = useRef(false);
  const verificationController = useRef<AbortController | null>(null);
  const backgroundVerification = useRef<AbortController | null>(null);
  const [injectedIds, setInjectedIds] = useState<number[]>([]);
  const [availableModels, setAvailableModels] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('karkas_available_models');
      const models = stored ? JSON.parse(stored) : [];
      return Array.isArray(models) ? models.filter((model): model is string => typeof model === 'string' && isChatModel(model)) : [];
    } catch {
      return [];
    }
  });
  const [customModel, setCustomModel] = useState(() => {
    const storedModel = localStorage.getItem('karkas_custom_model') || '';
    return availableModels.includes('gemini-3.1-flash-lite')
      ? 'gemini-3.1-flash-lite'
      : storedModel;
  });

  useEffect(() => {
    const apiKey = localStorage.getItem('karkas_custom_api_key') || '';
    if (!apiKey) return;

    const controller = new AbortController();
    backgroundVerification.current = controller;
    verifyApiKey(apiKey, { signal: controller.signal })
      .then((models) => {
        if (controller.signal.aborted) return;
        setAvailableModels(models);
        const nextModel = models.includes(customModel) ? customModel : models[0];
        setCustomModel(nextModel);
        localStorage.setItem('karkas_custom_model', nextModel);
        localStorage.setItem('karkas_available_models', JSON.stringify(models));
        localStorage.setItem('karkas_custom_ai_enabled', 'true');
        setAwaitingApiKey(false);
        awaitingKeyRef.current = false;
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => () => verificationController.current?.abort(), []);

  const confirmChatTasks = () => {
    if (!pendingChatTasks?.length) return;

    const tasks = pendingChatTasks.map((task) => {
      const stepItems = task.stepList?.map((step, index) => ({
        id: `s-chat-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`,
        title: typeof step === 'string' ? step : step.title,
        done: false,
      }));

      return {
        title: task.title,
        phase: task.phase,
        priority: task.priority,
        steps: stepItems?.length || task.steps || 1,
        stepList: stepItems,
        note: task.note,
      };
    });

    onInjectTasks(tasks);
    setPendingChatTasks(null);
    setChatMessages((previous) => [
      ...previous,
      {
        role: 'assistant',
        content: lang === 'uk' ? `Готово. Додано завдань: ${tasks.length}.` : `Done. Added tasks: ${tasks.length}.`,
      },
    ]);
    sound.activate();
  };

  const activeCount = currentTasks.filter((t) => !t.done).length;
  const completedCount = currentTasks.filter((t) => t.done).length;
  const deletedCount = deletedTasks.length;

  // Sync initialPrompt
  useEffect(() => {
    if (initialPrompt) {
      const normalizedPrompt = initialPrompt.trim().toLowerCase().replace(/[!?.,]/g, '');
      const isGreeting = /^(привіт|вітаю|добрий день|доброго ранку|добрий вечір|hello|hi|hey)$/.test(normalizedPrompt);
      const initialMode: AIMode = isGreeting ? 'chat' : 'breakdown';
      setPrompt(initialPrompt);
      setMode(initialMode);
      handleGenerate(initialPrompt, initialMode);
    }
  }, [initialPrompt]);

  const handleGenerate = async (queryText?: string, selectedMode?: AIMode, resuming = false) => {
    const textToQuery = queryText !== undefined ? queryText : prompt;
    const currentMode = selectedMode || mode;
    const requestText = textToQuery.trim() || (
      currentMode === 'analyze'
        ? (lang === 'uk' ? 'Повний аналіз поточних завдань та рекомендації щодо оптимізації' : 'Full analysis of current tasks and optimization recommendations')
        : ''
    );

    if (!requestText) return;
    if (requestInFlight.current) return;

    const savedApiKey = localStorage.getItem('karkas_custom_api_key') || '';
    const customAiEnabled = localStorage.getItem('karkas_custom_ai_enabled') === 'true';

    if (!resuming && shouldVerifyAsApiKey(requestText, awaitingKeyRef.current, queryText === undefined)) {
      requestInFlight.current = true;
      backgroundVerification.current?.abort();
      const controller = new AbortController();
      verificationController.current = controller;
      setPrompt('');
      setLoading(true);
      setKeyStatus(lang === 'uk' ? 'Перевіряю API-ключ…' : 'Verifying API key…');
      let requestToResume: { text: string; mode: AIMode } | null = null;
      try {
        const models = await verifyApiKey(requestText, { signal: controller.signal });
        if (controller.signal.aborted) return;
        const nextModel = models.includes('gemini-3.1-flash-lite')
          ? 'gemini-3.1-flash-lite'
          : models[0];
        localStorage.setItem('karkas_custom_api_key', requestText.trim());
        localStorage.setItem('karkas_custom_ai_enabled', 'true');
        localStorage.setItem('karkas_custom_model', nextModel);
        localStorage.setItem('karkas_available_models', JSON.stringify(models));
        setAvailableModels(models);
        setCustomModel(nextModel);
        setAwaitingApiKey(false);
        awaitingKeyRef.current = false;
        setKeyStatus(lang === 'uk'
              ? `API-ключ підключено. Автоматично обрано модель ${nextModel}.`
              : `API key connected. Model ${nextModel} was selected automatically.`);
        sound.activate();
        requestToResume = pendingRequest.current;
        pendingRequest.current = null;
      } catch (error) {
        if (controller.signal.aborted) return;
        setAwaitingApiKey(true);
        awaitingKeyRef.current = true;
        setKeyStatus(keyVerificationMessage(error, lang));
      } finally {
        requestInFlight.current = false;
        setLoading(false);
      }
      if (requestToResume) {
        await handleGenerate(requestToResume.text, requestToResume.mode, true);
      }
      return;
    }

    if (!savedApiKey || !customAiEnabled) {
      setPrompt('');
      setAwaitingApiKey(true);
      awaitingKeyRef.current = true;
      pendingRequest.current = { text: requestText, mode: currentMode };
      setKeyStatus(lang === 'uk'
        ? 'Щоб підключити AI, вставте свій Gemini API-ключ у рядок нижче. Я перевірю його, збережу на цьому пристрої та автоматично продовжу ваш запит.'
        : 'To connect AI, paste your Gemini API key into the input below. I will verify it, save it on this device, and automatically continue your request.');
      if (currentMode === 'chat') {
        setChatMessages((previous) => [
          ...previous,
          { role: 'user', content: requestText },
        ]);
      }
      return;
    }

    if (currentMode === 'chat' && pendingChatTasks && /^(так|підтверджую|підтверджено|yes|confirm|ок)$/i.test(textToQuery.trim())) {
      setPrompt('');
      setChatMessages((previous) => [...previous, { role: 'user', content: textToQuery.trim() }]);
      confirmChatTasks();
      return;
    }

    sound.activate();
    setPrompt('');
    requestInFlight.current = true;
    setLoading(true);
    setResponse(null);
    setInjectedIds([]);
    if (currentMode === 'chat' && !resuming) {
      setChatMessages((previous) => [
        ...previous,
        { role: 'user', content: requestText },
      ]);
    }

    const isTaskMutationRequest = currentMode === 'chat' && (
      /\b(додай|додати|створи|створити|запиши|записати|add|create|make)\b/i.test(requestText) ||
      /роз[іи]б|підзадач|break\s+down|subtasks?/i.test(requestText)
    );

    const activeList = currentTasks.filter((t) => !t.done);
    const doneList = currentTasks.filter((t) => t.done);

    try {
      const customKey = localStorage.getItem('karkas_custom_api_key') || '';
      const storedModel = localStorage.getItem('karkas_custom_model') || '';
      const customEnabled = localStorage.getItem('karkas_custom_ai_enabled') === 'true';

      const controller = new AbortController();
      const requestTimeout = window.setTimeout(() => controller.abort(), 30000);
      const res = await fetch('/api/ai/assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          prompt: requestText,
          action: isTaskMutationRequest ? 'generate' : currentMode === 'chat' ? 'chat' : currentMode === 'analyze' ? 'analyze' : currentMode === 'generate' ? 'generate' : 'breakdown',
          lang,
          tabs: tabs.map((tb) => tb.id),
          adaptiveProfile,
          currentTasks,
          conversation: currentMode === 'chat' ? chatMessages : undefined,
          customApiKey: customEnabled ? customKey : undefined,
          selectedModel: customEnabled ? (storedModel || customModel) : undefined,
          fullAppContext: {
            activeTasks: activeList.map((t) => ({
              title: t.title,
              phase: t.phase,
              priority: t.priority,
              currentStep: t.currentStep,
              steps: t.steps,
              timeSpentSeconds: t.timeSpentSeconds || 0,
              createdAt: t.createdAt,
              timerRunning: Boolean(t.timerRunning),
              stepList: t.stepList?.map((s) => s.title) || [],
              note: t.note,
            })),
            completedTasks: doneList.map((t) => ({
              title: t.title,
              phase: t.phase,
              completedAt: t.completedAt,
              timeSpentSeconds: t.timeSpentSeconds || 0,
              createdAt: t.createdAt,
            })),
            deletedTasks: deletedTasks.slice(0, 15).map((t) => ({
              title: t.title,
              phase: t.phase,
            })),
            tabs: tabs.map((tb) => ({ id: tb.id, name: tb.name, color: tb.color })),
            stats: stats || {
              total: currentTasks.length,
              completed: completedCount,
              percent: currentTasks.length > 0 ? Math.round((completedCount / currentTasks.length) * 100) : 0,
            },
            adaptiveProfile,
          },
        }),
      });
      window.clearTimeout(requestTimeout);

      if (!res.ok) throw new Error('API request failed');
      const data: AIResponse & { reply?: string } = await res.json();
      if (currentMode === 'chat') {
        if (isTaskMutationRequest && Array.isArray(data.tasks) && data.tasks.length > 0) {
          setPendingChatTasks(data.tasks);
        }

        setChatMessages((previous) => [
          ...previous,
          {
            role: 'assistant',
            content: isTaskMutationRequest && data.tasks?.length
              ? `${data.summary || 'Готово.'}\n\nПідтвердити створення ${data.tasks.length} задач кнопкою нижче.`
              : data.reply || data.summary,
          },
        ]);
      } else {
        setResponse(data);
      }
      sound.activate();
    } catch (err) {
      console.error('AI query error:', err);
      // Fallback
      const isUk = lang === 'uk';
      const mainPhase = tabs[0]?.id || 'focus';
      const secondaryPhase = tabs[1]?.id || mainPhase;

      const fallbackPrompt = requestText || (isUk ? 'Оптимізація завдань' : 'Task Optimization');

      if (currentMode === 'chat') {
        setChatMessages((previous) => [
          ...previous,
          {
            role: 'assistant',
            content: isUk
              ? `Зараз не можу підключитися до моделі. У вас ${activeCount} активних задач і ${completedCount} завершених. Спробуйте повторити запит або перевірте API-ключ.`
              : `I cannot reach the model right now. You have ${activeCount} active and ${completedCount} completed tasks. Try again or check the API key.`,
          },
        ]);
        return;
      }

      setResponse({
        summary: isUk
          ? `Аналіз сформовано на основі ${activeCount} активних завдань для «${fallbackPrompt}».`
          : `Analysis formulated based on ${activeCount} active tasks for "${fallbackPrompt}".`,
        insights: isUk
          ? [
              `Зосередьтеся на P1 завданнях перед відкриттям нових етапів.`,
              `Розбивайте великі завдання на 2-4 конкретних підкроки для прискорення прогресу.`,
            ]
          : [
              `Focus on urgent P1 items before starting secondary tabs.`,
              `Decompose multi-stage operations into smaller micro-steps.`,
            ],
        tasks: isUk
          ? [
              {
                title: `${fallbackPrompt} — Головний пріоритет`,
                phase: mainPhase,
                priority: 1,
                steps: 3,
                stepList: [
                  { title: 'Аналіз вимог та підготовка' },
                  { title: 'Виконання основної частини' },
                  { title: 'Фінальна перевірка та закриття' },
                ],
                note: 'Ключовий фокус',
              },
              {
                title: `${fallbackPrompt} — Супутній етап`,
                phase: secondaryPhase,
                priority: 2,
                steps: 2,
                stepList: [
                  { title: 'Узгодження деталей' },
                  { title: 'Збереження результатів' },
                ],
                note: 'Стандартний пріоритет',
              },
            ]
          : [
              {
                title: `${fallbackPrompt} - Core Milestone`,
                phase: mainPhase,
                priority: 1,
                steps: 3,
                stepList: [
                  { title: 'Requirements review' },
                  { title: 'Primary execution sprint' },
                  { title: 'Quality check & finalize' },
                ],
                note: 'Primary focus',
              },
            ],
        source: 'local-fallback',
      });
    } finally {
      requestInFlight.current = false;
      setLoading(false);
    }
  };

  const handleInjectAll = () => {
    if (!response || !response.tasks.length) return;
    sound.activate();

    const formattedTasks = response.tasks.map((task) => {
      const stepItems: TaskStepItem[] | undefined = task.stepList && task.stepList.length > 0
        ? task.stepList.map((st, idx) => ({
            id: `s-${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 4)}`,
            title: typeof st === 'string' ? st : st.title,
            done: false,
          }))
        : undefined;

      return {
        title: task.title,
        phase: task.phase,
        priority: task.priority,
        steps: stepItems ? stepItems.length : (task.steps || 1),
        stepList: stepItems,
        note: task.note,
      };
    });

    onInjectTasks(formattedTasks);
    setInjectedIds(response.tasks.map((_, i) => i));
    setTimeout(() => {
      onClose();
    }, 500);
  };

  const handleInjectSingle = (task: AIResponse['tasks'][0], index: number) => {
    sound.tick(600);
    const stepItems: TaskStepItem[] | undefined = task.stepList && task.stepList.length > 0
      ? task.stepList.map((st, idx) => ({
          id: `s-${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 4)}`,
          title: typeof st === 'string' ? st : st.title,
          done: false,
        }))
      : undefined;

    onInjectTasks([
      {
        title: task.title,
        phase: task.phase,
        priority: task.priority,
        steps: stepItems ? stepItems.length : (task.steps || 1),
        stepList: stepItems,
        note: task.note,
      },
    ]);
    setInjectedIds((prev) => [...prev, index]);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center pointer-events-auto">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm"
          />

          {/* Sheet Surface */}
          <motion.div
            id="ps-ai-sheet"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            drag="y"
            dragConstraints={{ top: 0 }}
            dragElastic={0.2}
            onDragEnd={(_, info) => {
              if (info.offset.y > 100) {
                onClose();
              }
            }}
            className="relative z-10 w-full max-w-2xl bg-[#0c0c0e] border-t border-x border-neutral-800 max-h-[88vh] flex flex-col shadow-2xl font-mono"
          >
            {/* Drag Handle */}
            <div className="w-full flex items-center justify-center pt-2.5 pb-1 cursor-grab active:cursor-grabbing">
              <div className="w-10 h-1 bg-neutral-700 rounded-full" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-neutral-800">
              <div className="flex items-center gap-2">
                <AIIcon id={aiIconVariant} className="w-4 h-4 text-white" />
                <span className="text-xs sm:text-sm font-bold uppercase tracking-wider font-mono text-white">
                  {t.aiSheet.header}
                </span>
              </div>
              <button
                id="close-ai-sheet-btn"
                onClick={onClose}
                className="p-1.5 text-neutral-400 hover:text-white border border-neutral-800 hover:border-neutral-600 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Action Modes Selector */}
            <div className="grid grid-cols-4 gap-1 px-4 sm:px-5 pt-3 pb-2 border-b border-neutral-800">
              <button
                id="ai-mode-chat-btn"
                type="button"
                onClick={() => {
                  sound.tick(450);
                  setMode('chat');
                }}
                className={`py-1.5 px-2 text-[10px] sm:text-xs font-mono font-bold tracking-wider uppercase border transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  mode === 'chat'
                    ? 'bg-white text-black border-white'
                    : 'bg-[#08080a] text-neutral-400 border-neutral-800 hover:text-white hover:border-neutral-700'
                }`}
              >
                <span className="text-sm leading-none">◌</span>
                <span className="truncate">{lang === 'uk' ? 'ЧАТ' : 'CHAT'}</span>
              </button>

              <button
                id="ai-mode-breakdown-btn"
                type="button"
                onClick={() => {
                  sound.tick(500);
                  setMode('breakdown');
                }}
                className={`py-1.5 px-2 text-[10px] sm:text-xs font-mono font-bold tracking-wider uppercase border transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  mode === 'breakdown'
                    ? 'bg-white text-black border-white'
                    : 'bg-[#08080a] text-neutral-400 border-neutral-800 hover:text-white hover:border-neutral-700'
                }`}
              >
                <ListTree className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{t.aiSheet.modes.breakdown}</span>
              </button>

              <button
                id="ai-mode-analyze-btn"
                type="button"
                onClick={() => {
                  sound.tick(550);
                  setMode('analyze');
                  handleGenerate(prompt, 'analyze');
                }}
                className={`py-1.5 px-2 text-[10px] sm:text-xs font-mono font-bold tracking-wider uppercase border transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  mode === 'analyze'
                    ? 'bg-white text-black border-white'
                    : 'bg-[#08080a] text-neutral-400 border-neutral-800 hover:text-white hover:border-neutral-700'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{t.aiSheet.modes.analyze}</span>
              </button>

              <button
                id="ai-mode-generate-btn"
                type="button"
                onClick={() => {
                  sound.tick(600);
                  setMode('generate');
                }}
                className={`py-1.5 px-2 text-[10px] sm:text-xs font-mono font-bold tracking-wider uppercase border transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  mode === 'generate'
                    ? 'bg-white text-black border-white'
                    : 'bg-[#08080a] text-neutral-400 border-neutral-800 hover:text-white hover:border-neutral-700'
                }`}
              >
                <Layers className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{t.aiSheet.modes.generate}</span>
              </button>
            </div>

            {/* Content Container (Scrollable) */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 flex flex-col gap-4">
              
              {/* Presets Chips */}
              <div>
                <div className="text-[10px] font-mono uppercase tracking-widest text-neutral-400 mb-2">
                  {t.aiSheet.blueprints}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {personalizedPresets.map((preset, i) => (
                    <button
                      key={i}
                      id={`ai-preset-chip-${i}`}
                      onClick={() => {
                        setPrompt(preset);
                        handleGenerate(preset);
                      }}
                      className="text-[11px] font-mono text-left px-2 py-1 bg-[#08080a] border border-neutral-800 text-neutral-400 hover:border-neutral-600 hover:text-neutral-200 transition-colors cursor-pointer"
                    >
                      + {preset}
                    </button>
                  ))}
                </div>
              </div>

              {/* Response Section */}
              {mode === 'chat' && chatMessages.length > 0 && (
                <div className="flex flex-col gap-3">
                  {chatMessages.map((message, index) => (
                    <div
                      key={`${message.role}-${index}`}
                      className={`max-w-[92%] border p-3 text-xs leading-relaxed whitespace-pre-wrap ${
                        message.role === 'user'
                          ? 'self-end bg-white text-black border-white'
                          : 'self-start bg-[#111116] text-neutral-200 border-neutral-800'
                      }`}
                    >
                      <div className="mb-1 text-[9px] font-bold uppercase tracking-widest opacity-60">
                        {message.role === 'user' ? (lang === 'uk' ? 'ВИ' : 'YOU') : 'KARKAS AI'}
                      </div>
                      {(() => {
                        const parsed = message.role === 'assistant' ? parseChatOptions(message.content) : { body: message.content, options: [] };
                        return (
                          <>
                            <div>{parsed.body}</div>
                            {parsed.options.length > 0 && (
                              <div className="flex flex-col gap-1.5 mt-3">
                                {parsed.options.map((option) => (
                                  <button
                                    key={`${index}-${option.label}-${option.text}`}
                                    type="button"
                                    disabled={loading}
                                    onClick={() => handleGenerate(option.text)}
                                    className="w-full text-left border border-neutral-700 bg-[#08080a] px-3 py-2 text-xs text-neutral-200 hover:border-white hover:text-white disabled:opacity-40 transition-colors cursor-pointer"
                                  >
                                    <span className="inline-flex min-w-5 h-5 items-center justify-center mr-2 border border-neutral-600 text-[10px] font-bold text-neutral-400">
                                      {option.label}
                                    </span>
                                    {option.text}
                                  </button>
                                ))}
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  ))}
                  {pendingChatTasks && !loading && (
                    <button
                      type="button"
                      onClick={confirmChatTasks}
                      className="self-start border border-emerald-700 bg-emerald-950/30 px-3 py-2 text-[10px] font-mono font-bold uppercase tracking-wider text-emerald-300 hover:border-emerald-400 hover:text-white transition-colors cursor-pointer"
                    >
                      {lang === 'uk'
                        ? `Підтвердити створення (${pendingChatTasks.length})`
                        : `Confirm creation (${pendingChatTasks.length})`}
                    </button>
                  )}
                </div>
              )}

              {keyStatus && (
                <div role="status" aria-live="polite" className="border border-neutral-800 bg-[#111116] p-3 text-xs leading-relaxed text-neutral-200 whitespace-pre-wrap">
                  <div className="mb-1 text-[9px] font-bold uppercase tracking-widest opacity-60">KARKAS AI</div>
                  {keyStatus}
                </div>
              )}

              {loading && (
                <div className="p-8 border border-neutral-800 bg-black/40 flex flex-col items-center justify-center gap-3">
                  <div className="w-6 h-6 border-2 border-white border-t-transparent animate-spin rounded-full" />
                  <span className="text-xs font-mono tracking-widest text-neutral-300 uppercase animate-pulse">
                    {mode === 'chat'
                      ? (lang === 'uk' ? 'KARKAS AI ФОРМУЄ ВІДПОВІДЬ...' : 'KARKAS AI IS RESPONDING...')
                      : t.aiSheet.thinking}
                  </span>
                  <span className="text-[10px] font-mono text-neutral-500">
                    {t.aiSheet.fullContextDesc}
                  </span>
                </div>
              )}

              {response && !loading && (
                <div className="border border-neutral-800 bg-[#0d0d10] p-4 flex flex-col gap-4">
                  {/* Strategy Summary */}
                  <div className="flex items-start justify-between gap-3 border-b border-neutral-800 pb-3">
                    <div className="space-y-1">
                      <div className="text-[10px] font-mono uppercase text-neutral-400 tracking-widest flex items-center gap-1.5">
                        <Sparkles className="w-3 h-3 text-white" />
                        <span>{t.aiSheet.strategyHeader}</span>
                      </div>
                      <p className="text-xs sm:text-sm font-bold text-neutral-100 leading-relaxed">
                        {response.summary}
                      </p>
                    </div>

                    {response.tasks.length > 0 && (
                      <button
                        id="ai-inject-all-btn"
                        onClick={handleInjectAll}
                        className="whitespace-nowrap px-3 py-1.5 bg-white text-black font-extrabold text-xs font-mono tracking-wider hover:bg-neutral-200 transition-colors flex items-center gap-1.5 shrink-0"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>{t.aiSheet.injectAll} ({response.tasks.length})</span>
                      </button>
                    )}
                  </div>

                  {/* Tactical Insights / Tips (if available) */}
                  {response.insights && response.insights.length > 0 && (
                    <div className="bg-[#121216] border border-neutral-800 p-3 space-y-2">
                      <div className="text-[10px] font-mono text-neutral-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
                        <Lightbulb className="w-3.5 h-3.5 text-amber-400" />
                        <span>{t.aiSheet.insightsHeader}</span>
                      </div>
                      <ul className="space-y-1.5">
                        {response.insights.map((insight, idx) => (
                          <li key={idx} className="text-xs font-mono text-neutral-300 flex items-start gap-2">
                            <span className="text-white font-bold shrink-0">›</span>
                            <span>{insight}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Generated Tasks List with Sub-Steps */}
                  {response.tasks.length > 0 && (
                    <div className="flex flex-col gap-2.5">
                      {response.tasks.map((task, i) => {
                        const isInjected = injectedIds.includes(i);
                        const matchedTab = tabs.find((tb) => tb.id === task.phase);
                        const phaseLabel = (t.phases as any)[task.phase] || matchedTab?.name || task.phase;
                        const subSteps = task.stepList || [];

                        return (
                          <div
                            key={i}
                            id={`ai-suggested-task-${i}`}
                            className="flex flex-col gap-2 p-3 bg-black border border-neutral-800 hover:border-neutral-700 transition-colors"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex flex-col gap-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-[10px] font-mono text-neutral-400 font-bold flex items-center gap-1">
                                    {matchedTab?.color && (
                                      <span
                                        className="w-1.5 h-1.5 rounded-full shrink-0 shadow-sm"
                                        style={{ backgroundColor: matchedTab.color }}
                                      />
                                    )}
                                    [{phaseLabel}]
                                  </span>
                                  <span
                                    className={`text-[9px] font-mono font-bold px-1 py-0.2 border ${
                                      task.priority === 1
                                        ? 'border-red-900/70 text-red-400 bg-red-950/30'
                                        : task.priority === 2
                                        ? 'border-amber-900/70 text-amber-400 bg-amber-950/30'
                                        : 'border-emerald-900/70 text-emerald-400 bg-emerald-950/30'
                                    }`}
                                  >
                                    P{task.priority}
                                  </span>
                                  <span className="text-xs sm:text-sm font-bold text-neutral-100">
                                    {task.title}
                                  </span>
                                </div>
                                {task.note && (
                                  <span className="text-[10px] font-mono text-neutral-400">
                                    // {task.note}
                                  </span>
                                )}
                              </div>

                              <button
                                id={`ai-inject-single-btn-${i}`}
                                onClick={() => handleInjectSingle(task, i)}
                                disabled={isInjected}
                                className={`px-2.5 py-1 text-[10px] font-mono uppercase font-bold border transition-all shrink-0 ${
                                  isInjected
                                    ? 'border-emerald-700 text-emerald-400 bg-emerald-950/40'
                                    : 'border-neutral-700 text-neutral-300 hover:border-white hover:text-white bg-neutral-900'
                                }`}
                              >
                                {isInjected ? t.aiSheet.added : t.aiSheet.injectSingle}
                              </button>
                            </div>

                            {/* Sub-steps preview */}
                            {subSteps.length > 0 && (
                              <div className="pt-2 border-t border-neutral-900/80 space-y-1">
                                <div className="text-[9px] font-mono text-neutral-500 uppercase font-bold">
                                  {t.aiSheet.subStepsTitle} ({subSteps.length})
                                </div>
                                <div className="grid grid-cols-1 gap-1">
                                  {subSteps.map((st, sIdx) => {
                                    const titleText = typeof st === 'string' ? st : st.title;
                                    return (
                                      <div
                                        key={sIdx}
                                        className="text-[10px] font-mono text-neutral-300 bg-[#0c0c0f] border border-neutral-900 px-2 py-1 flex items-center gap-1.5"
                                      >
                                        <span className="text-neutral-500 font-bold">{sIdx + 1}.</span>
                                        <span>{titleText}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Custom Prompt Input at the bottom of the sheet */}
            <div className="px-4 sm:px-5 py-3 bg-[#08080a] border-t border-neutral-800 flex items-center gap-2">
              <select
                aria-label={lang === 'uk' ? 'Модель AI' : 'AI model'}
                value={customModel}
                disabled={availableModels.length === 0}
                onChange={(e) => {
                  const model = e.target.value;
                  setCustomModel(model);
                  localStorage.setItem('karkas_custom_model', model);
                  sound.tick(400);
                }}
                className="max-w-[150px] bg-[#050507] border border-neutral-800 text-neutral-300 text-[10px] font-mono px-2 py-2.5 focus:outline-none focus:border-white disabled:opacity-50"
              >
                {availableModels.length === 0 ? (
                  <option value="">Модель не налаштована</option>
                ) : (
                  availableModels.map((model) => (
                    <option key={model} value={model}>{model}</option>
                  ))
                )}
              </select>
              <input
                id="ai-prompt-input"
                type={awaitingApiKey ? 'password' : 'text'}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleGenerate();
                }}
                placeholder={
                  awaitingApiKey
                    ? (lang === 'uk' ? 'Вставте Gemini API-ключ сюди...' : 'Paste your Gemini API key here...')
                    : mode === 'chat'
                    ? (lang === 'uk' ? 'Напишіть, що відбувається або що потрібно вирішити...' : 'Tell me what is happening or what you need to solve...')
                    : mode === 'analyze'
                    ? (lang === 'uk' ? 'Уточніть фокус аналізу (напр. пріоритети на сьогодні, перевірити дедлайни)...' : 'Refine audit focus (e.g. today priorities, bottlenecks)...')
                    : t.aiSheet.inputPlaceholder
                }
                className="flex-1 bg-[#050507] border border-neutral-800 text-white placeholder:text-neutral-500 text-xs font-mono px-3.5 py-2.5 focus:outline-none focus:border-white transition-colors"
              />
              <button
                id="ai-generate-submit-btn"
                onClick={() => handleGenerate()}
                disabled={loading || !prompt.trim()}
                className="px-4 py-2.5 bg-white text-black font-bold text-xs font-mono uppercase tracking-wider hover:bg-neutral-200 disabled:opacity-40 transition-all flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                {loading ? (
                  <span>...</span>
                ) : (
                  <>
                    <span>{t.aiSheet.execute}</span>
                    <CornerDownLeft className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </div>

            {/* Bottom Footer Hint */}
            <div className="px-4 sm:px-5 py-2.5 bg-black border-t border-neutral-800 flex items-center justify-between text-[10px] font-mono text-neutral-400">
              <span>{t.aiSheet.dismissHint}</span>
              <span>{t.aiSheet.footerTag}</span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
