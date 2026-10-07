import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence, useDragControls } from 'motion/react';
import {
  PSTask,
  TaskTab,
  DeletedTask,
  WorkflowStats,
  AdaptiveProfile,
  AITaskUpdate,
  AIResponse,
  AITimerSettings,
} from '../types';
import { sound } from '../utils/audio';
import { createVoiceDictation, type VoicePhase } from '../utils/voiceDictation';
import { Language, TRANSLATIONS, AI_PRESETS_UK, AI_PRESETS_EN } from '../utils/i18n';
import {
  X,
  Plus,
  CheckCircle2,
  MessagesSquare,
  Workflow,
  ClipboardList,
  Lightbulb,
  Edit3,
  Trash2,
  CheckSquare,
  Activity,
  AlertTriangle,
  ChartNoAxesCombined,
  FolderPlus,
  Mic,
  MicOff,
  Loader2,
  Square,
  ArrowUp,
} from 'lucide-react';
import { AIIcon, AIIconId } from './AIIconTemplates';
import { shouldVerifyAsApiKey } from '../utils/apiKey';
import { verifyApiKey, keyVerificationMessage } from '../utils/verifyApiKey';
import { desktopHasAiKey, karkasApiFetch } from '../utils/desktopApi';
import { loadAIChatHistory, saveAIChatHistory } from '../services/chatHistory';
import type { PersistedAIChatMessage } from '../services/chatHistory';
import { getPendingTaskIndexes } from './workflowViewModel';
import { useDialogKeyboard } from './useDialogKeyboard';
import { describeAIApplyResult, describeAITimer, getAITimerContext, prepareAITask, type AIApplyResult } from './aiTaskProposal';
import { AIRequestError, aiRequestErrorMessage, appendChatRequest, readAIAssistantDraft, readAIResponse, responseRequestError, restoredAIRequestNotice, saveAIAssistantDraft, selectAIModel, type AIMode, type AIRequest } from './aiAssistantState';

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
  onInjectTasks: (
    newTasks: (Omit<PSTask, 'id' | 'currentStep' | 'done' | 'pinned' | 'createdAt'> & AITimerSettings)[],
    newTabs?: TaskTab[],
    taskUpdates?: AITaskUpdate[],
    deletedTaskIds?: string[],
  ) => AIApplyResult;
  accountId?: string | null;
}

interface AIChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AIChatOption {
  label: string;
  text: string;
}

const parseChatOptions = (content: string): { body: string; options: AIChatOption[] } => {
  const lines = (content || '').split('\n');
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

const isChatModel = (model: string) => {
  const name = model.toLowerCase();
  return name.includes('gemini') && !/(embedding|image|tts|transcrib|robotics|computer-use)/.test(name);
};

const TimerProposal: React.FC<{ settings: AITimerSettings; lang: Language }> = ({ settings, lang }) => {
  const description = describeAITimer(settings, lang);
  return description ? <div className="mt-1 text-xs text-sky-300 whitespace-normal">{description}</div> : null;
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
  accountId = null,
}) => {
  const t = TRANSLATIONS[lang];
  const dragControls = useDragControls();
  useDialogKeyboard(isOpen, onClose, 'ps-ai-sheet');
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

  const [initialDraft] = useState(() => readAIAssistantDraft(localStorage, accountId));
  const [prompt, setPrompt] = useState(initialPrompt || initialDraft?.prompt || initialDraft?.recoverableRequest?.text || '');
  const [mode, setMode] = useState<AIMode>(initialDraft?.mode || 'chat');
  const [recoverableRequest, setRecoverableRequest] = useState<AIRequest | null>(initialDraft?.recoverableRequest || null);
  const [requestError, setRequestError] = useState<string | null>(restoredAIRequestNotice(initialDraft?.recoverableRequest, lang));
  const activeRequest = useRef<AIRequest | null>(null);
  const draftAccountRef = useRef(accountId);
  const skipDraftPersistRef = useRef(false);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<AIResponse | null>(null);
  const [applyNotice, setApplyNotice] = useState<string | null>(null);
  const [responsePartlyRejected, setResponsePartlyRejected] = useState(false);
  const [chatMessages, setChatMessages] = useState<AIChatMessage[]>(() => loadAIChatHistory(accountId));
  const hydratedAccountRef = useRef(accountId);
  const skipPersistRef = useRef(false);

  const [pendingChatTasks, setPendingChatTasks] = useState<NonNullable<AIResponse['tasks']>>([]);
  const [pendingChatTabs, setPendingChatTabs] = useState<TaskTab[]>([]);
  const [pendingChatUpdates, setPendingChatUpdates] = useState<AITaskUpdate[]>([]);
  const [pendingChatDeletions, setPendingChatDeletions] = useState<string[]>([]);
  const pendingChatConfirmed = useRef(false);

  const [awaitingApiKey, setAwaitingApiKey] = useState(false);
  const [keyStatus, setKeyStatus] = useState<string | null>(null);
  const pendingRequest = useRef<{ text: string; mode: AIMode } | null>(null);
  const requestInFlight = useRef(false);
  const awaitingKeyRef = useRef(false);
  const verificationController = useRef<AbortController | null>(null);
  const backgroundVerification = useRef<AbortController | null>(null);
  const [injectedIds, setInjectedIds] = useState<number[]>([]);
  const injectedIdsRef = useRef<number[]>([]);
  const [appliedUpdateIds, setAppliedUpdateIds] = useState<string[]>([]);
  const appliedUpdateIdsRef = useRef<string[]>([]);
  const appliedTabIdsRef = useRef(new Set<string>());
  const appliedDeletionIdsRef = useRef(new Set<string>());
  const assistController = useRef<AbortController | null>(null);
  const requestGeneration = useRef(0);
  const closeAfterInject = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isOpen && verificationController.current) {
      setPrompt('');
      setKeyStatus(lang === 'uk' ? 'Перевірку ключа перервано. Вставте його ще раз, щоб продовжити.' : 'Key verification was interrupted. Paste the key again to continue.');
    }
    if (!isOpen && activeRequest.current && draftAccountRef.current === accountId) {
      const interrupted = activeRequest.current;
      setPrompt(previous => previous || interrupted.text);
      setRecoverableRequest(interrupted);
      setRequestError(aiRequestErrorMessage(new AIRequestError('CANCELLED'), lang));
    }
    activeRequest.current = null;
    requestGeneration.current += 1;
    assistController.current?.abort();
    assistController.current = null;
    verificationController.current?.abort();
    requestInFlight.current = false;
    setLoading(false);
    return () => {
      requestGeneration.current += 1;
      assistController.current?.abort();
      assistController.current = null;
      verificationController.current?.abort();
      requestInFlight.current = false;
      if (closeAfterInject.current) clearTimeout(closeAfterInject.current);
    };
  }, [isOpen, accountId]);

  const [availableModels, setAvailableModels] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('karkas_available_models');
      const models = stored ? JSON.parse(stored) : [];
      return Array.isArray(models) ? models.filter((m): m is string => typeof m === 'string' && isChatModel(m)) : [];
    } catch {
      return [];
    }
  });
  const [customModel, setCustomModel] = useState(() => {
    const storedModel = localStorage.getItem('karkas_custom_model') || '';
    return selectAIModel(availableModels, storedModel);
  });
  const customModelRef = useRef(customModel);
  const chooseCustomModel = (model: string) => { customModelRef.current = model; setCustomModel(model); };

  // Each dictation owns its microphone, socket, buffered audio and cancellation.
  const [voicePhase, setVoicePhase] = useState<VoicePhase>('idle');
  const [voiceLevel, setVoiceLevel] = useState(0);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const voiceRef = useRef<ReturnType<typeof createVoiceDictation> | null>(null);
  const isListening = ['starting', 'connecting', 'listening', 'recording'].includes(voicePhase);
  const isTranscribing = voicePhase === 'finishing';

  const stopVoiceInput = () => voiceRef.current?.stop();

  useEffect(() => {
    if (!isListening) { setRecordingDuration(0); return; }
    const interval = setInterval(() => setRecordingDuration(value => value + 1), 1000);
    return () => clearInterval(interval);
  }, [isListening]);

  useEffect(() => {
    if (!isOpen) {
      voiceRef.current?.cancel();
      voiceRef.current = null;
      setVoicePhase('idle');
      setVoiceLevel(0);
    }
  }, [isOpen]);

  useEffect(() => () => { voiceRef.current?.cancel(); }, []);

  const handleToggleVoiceInput = () => {
    if (isListening) { stopVoiceInput(); return; }
    if (isTranscribing || voiceRef.current) return;
    setVoiceNotice(null);
    const base = prompt.trim();
    const dictation = createVoiceDictation({
      lang,
      onPhase: phase => {
        setVoicePhase(phase);
        if (phase === 'idle') voiceRef.current = null;
      },
      onLevel: setVoiceLevel,
      onText: spoken => setPrompt(base ? `${base} ${spoken}` : spoken),
      onError: setVoiceNotice,
    });
    voiceRef.current = dictation;
    void dictation.start();
  };

  // Keep conversation history synchronized per account
  useEffect(() => {
    if (hydratedAccountRef.current === accountId) return;
    hydratedAccountRef.current = accountId;
    skipPersistRef.current = true;
    setChatMessages(loadAIChatHistory(accountId));
    pendingRequest.current = null;
    pendingChatConfirmed.current = false;
    setPendingChatTasks([]);
    setPendingChatTabs([]);
    setPendingChatUpdates([]);
    setPendingChatDeletions([]);
    setResponse(null);
    setApplyNotice(null);
    setResponsePartlyRejected(false);
    injectedIdsRef.current = [];
    appliedUpdateIdsRef.current = [];
    appliedTabIdsRef.current.clear();
    appliedDeletionIdsRef.current.clear();
    setInjectedIds([]);
    setAppliedUpdateIds([]);
  }, [accountId]);

  useEffect(() => {
    if (skipPersistRef.current) {
      skipPersistRef.current = false;
      return;
    }
    saveAIChatHistory(accountId, chatMessages as PersistedAIChatMessage[]);
  }, [accountId, chatMessages]);

  useEffect(() => {
    if (draftAccountRef.current === accountId) return;
    draftAccountRef.current = accountId;
    skipDraftPersistRef.current = true;
    const draft = readAIAssistantDraft(localStorage, accountId);
    setPrompt(draft?.prompt || draft?.recoverableRequest?.text || '');
    setMode(draft?.mode || 'chat');
    setRecoverableRequest(draft?.recoverableRequest || null);
    setRequestError(restoredAIRequestNotice(draft?.recoverableRequest, lang));
    setAwaitingApiKey(false);
    awaitingKeyRef.current = false;
    setKeyStatus(null);
  }, [accountId]);

  useEffect(() => {
    if (skipDraftPersistRef.current) { skipDraftPersistRef.current = false; return; }
    // A key is entered in the same field, but must never enter draft storage.
    saveAIAssistantDraft(localStorage, { prompt: awaitingApiKey ? '' : prompt, mode, recoverableRequest }, accountId);
  }, [accountId, prompt, mode, awaitingApiKey, recoverableRequest]);

  useEffect(() => {
    if (!isOpen) return;
    const frame = requestAnimationFrame(() => {
      if (contentRef.current) contentRef.current.scrollTop = contentRef.current.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [isOpen, chatMessages, loading, keyStatus, requestError, response]);

  useEffect(() => {
    if (!isOpen) return;
    const frame = requestAnimationFrame(() => document.getElementById('ai-prompt-input')?.focus());
    return () => cancelAnimationFrame(frame);
  }, [isOpen, awaitingApiKey]);

  useEffect(() => {
    if (window.karkasDesktop) {
      let active = true;
      Promise.allSettled([desktopHasAiKey(), window.karkasDesktop.preferences.get()]).then(([keyResult, preferenceResult]) => {
        if (!active || keyResult.status !== 'fulfilled' || !keyResult.value) return;
        const preferences = preferenceResult.status === 'fulfilled' && preferenceResult.value.ok ? preferenceResult.value.value : {};
        const storedModels = preferences.karkas_available_models;
        let parsedModels: unknown = storedModels;
        if (typeof storedModels === 'string') { try { parsedModels = JSON.parse(storedModels); } catch { parsedModels = null; } }
        const models = Array.isArray(parsedModels) ? parsedModels.filter((m): m is string => typeof m === 'string' && isChatModel(m)) : availableModels;
        const preferred = typeof preferences.karkas_custom_model === 'string'
          ? preferences.karkas_custom_model : customModel;
        if (models.length) {
          setAvailableModels(models);
          const nextModel = selectAIModel(models, preferred);
          chooseCustomModel(nextModel);
          localStorage.setItem('karkas_available_models', JSON.stringify(models));
          localStorage.setItem('karkas_custom_model', nextModel);
        }
        localStorage.setItem('karkas_custom_ai_enabled', 'true');
        setAwaitingApiKey(false);
        awaitingKeyRef.current = false;
      }).catch(() => undefined);
      return () => { active = false; };
    }
    const apiKey = localStorage.getItem('karkas_custom_api_key') || '';
    if (!apiKey) return;

    const controller = new AbortController();
    backgroundVerification.current = controller;
    verifyApiKey(apiKey, { signal: controller.signal })
      .then((models) => {
        if (controller.signal.aborted) return;
        setAvailableModels(models);
        const nextModel = selectAIModel(models, localStorage.getItem('karkas_custom_model') || customModel);
        chooseCustomModel(nextModel);
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

  const pendingChangeCount =
    (pendingChatTasks?.length || 0) +
    (pendingChatTabs?.length || 0) +
    (pendingChatUpdates?.length || 0) +
    (pendingChatDeletions?.length || 0);

  const confirmChatChanges = () => {
    if (pendingChangeCount === 0 || pendingChatConfirmed.current) return;
    pendingChatConfirmed.current = true;

    const tasks = (pendingChatTasks || []).map(task => prepareAITask(task,
      index => `s-chat-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`));

    const result = onInjectTasks(tasks, pendingChatTabs, pendingChatUpdates, pendingChatDeletions);
    setRecoverableRequest(null);
    setRequestError(null);

    setPendingChatTasks([]);
    setPendingChatTabs([]);
    setPendingChatUpdates([]);
    setPendingChatDeletions([]);

    setChatMessages((previous) => [
      ...previous,
      {
        role: 'assistant',
        content: describeAIApplyResult(result, lang),
      },
    ]);
    sound.activate();
  };

  const activeCount = currentTasks.filter((t) => !t.done).length;
  const completedCount = currentTasks.filter((t) => t.done).length;

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

  const handleGenerate = async (queryText?: string, selectedMode?: AIMode, resuming = false, preserveInput = false) => {
    voiceRef.current?.cancel();
    voiceRef.current = null;
    setVoicePhase('idle');
    const textToQuery = queryText !== undefined ? queryText : prompt;
    const currentMode = selectedMode || mode;
    const requestText = textToQuery.trim() || (
      currentMode === 'analyze'
        ? (lang === 'uk' ? 'Повний аудит робочого процесу, вузьких місць і аналітика категорій' : 'Comprehensive workflow audit, bottleneck analysis, and category metrics')
        : ''
    );

    if (!requestText) return;
    if (requestInFlight.current) return;
    if (currentMode === 'chat' && pendingChangeCount > 0 && /^(так|підтверджую|підтверджено|yes|confirm|ок|застосувати|зберегти)$/i.test(textToQuery.trim())) {
      setPrompt('');
      setChatMessages(previous => appendChatRequest(previous, textToQuery.trim()));
      confirmChatChanges();
      return;
    }
    setApplyNotice(null);
    const generation = requestGeneration.current;
    const isKeyEntry = !resuming && shouldVerifyAsApiKey(requestText, awaitingKeyRef.current, queryText === undefined);
    if (!isKeyEntry) {
      activeRequest.current = { text: requestText, mode: currentMode };
      setRecoverableRequest(activeRequest.current);
    }
    requestInFlight.current = true;
    setLoading(true);

    const savedApiKey = localStorage.getItem('karkas_custom_api_key') || '';
    let desktopKeyAvailable = false;
    try { desktopKeyAvailable = window.karkasDesktop ? await desktopHasAiKey() : false; }
    catch {
      if (generation !== requestGeneration.current) return;
      requestInFlight.current = false;
      setLoading(false);
      setRequestError(aiRequestErrorMessage(new AIRequestError('PROVIDER_ERROR'), lang));
      activeRequest.current = null;
      if (!isKeyEntry) { setRecoverableRequest({ text: requestText, mode: currentMode }); setPrompt(previous => previous || requestText); }
      else { setAwaitingApiKey(true); awaitingKeyRef.current = true; setKeyStatus(aiRequestErrorMessage(new AIRequestError('PROVIDER_ERROR'), lang)); }
      return;
    }
    if (generation !== requestGeneration.current) return;
    const customAiEnabled = desktopKeyAvailable || localStorage.getItem('karkas_custom_ai_enabled') === 'true';

    if (isKeyEntry) {
      requestInFlight.current = true;
      backgroundVerification.current?.abort();
      const controller = new AbortController();
      verificationController.current = controller;
      setAwaitingApiKey(true);
      awaitingKeyRef.current = true;
      setPrompt('');
      setLoading(true);
      setKeyStatus(lang === 'uk' ? 'Перевіряю API-ключ…' : 'Verifying API key…');
      let requestToResume: { text: string; mode: AIMode } | null = null;
      try {
        const models = await verifyApiKey(requestText, { signal: controller.signal });
        if (controller.signal.aborted) return;
        const nextModel = selectAIModel(models, customModelRef.current);
        if (!window.karkasDesktop) localStorage.setItem('karkas_custom_api_key', requestText.trim());
        localStorage.setItem('karkas_custom_ai_enabled', 'true');
        localStorage.setItem('karkas_custom_model', nextModel);
        localStorage.setItem('karkas_available_models', JSON.stringify(models));
        if (window.karkasDesktop) {
          void window.karkasDesktop.preferences.update({
            karkas_custom_ai_enabled: 'true',
            karkas_custom_model: nextModel,
            karkas_available_models: JSON.stringify(models),
          });
        }
        setAvailableModels(models);
        chooseCustomModel(nextModel);
        setAwaitingApiKey(false);
        awaitingKeyRef.current = false;
        setKeyStatus(null);
        setRequestError(null);
        sound.activate();
        requestToResume = pendingRequest.current;
        pendingRequest.current = null;
      } catch (error) {
        if (controller.signal.aborted) return;
        setAwaitingApiKey(true);
        awaitingKeyRef.current = true;
        setKeyStatus(keyVerificationMessage(error, lang));
      } finally {
        if (verificationController.current === controller) verificationController.current = null;
        if (generation === requestGeneration.current) {
          requestInFlight.current = false;
          setLoading(false);
        }
      }
      if (requestToResume && generation === requestGeneration.current) {
        await handleGenerate(requestToResume.text, requestToResume.mode, true);
      }
      return;
    }

    if (!resuming && (window.karkasDesktop ? !desktopKeyAvailable : !savedApiKey || !customAiEnabled)) {
      setPrompt('');
      setAwaitingApiKey(true);
      awaitingKeyRef.current = true;
      pendingRequest.current = { text: requestText, mode: currentMode };
      activeRequest.current = null;
      setRecoverableRequest(pendingRequest.current);
      setRequestError(null);
      requestInFlight.current = false;
      setLoading(false);
      setKeyStatus(lang === 'uk'
        ? 'Щоб підключити AI, вставте свій Gemini API-ключ у рядок нижче. Я перевірю його, збережу на цьому пристрої та автоматично продовжу ваш запит.'
        : 'To connect AI, paste your Gemini API key into the input below. I will verify it, save it on this device, and automatically continue your request.');
      return;
    }

    sound.activate();
    if (!preserveInput) setPrompt('');
    setAwaitingApiKey(false);
    awaitingKeyRef.current = false;
    setKeyStatus(null);
    setRequestError(null);
    const currentRequest = { text: requestText, mode: currentMode };
    activeRequest.current = currentRequest;
    setRecoverableRequest(currentRequest);
    pendingRequest.current = null;
    requestInFlight.current = true;
    setLoading(true);
    setResponse(null);
    setResponsePartlyRejected(false);
    injectedIdsRef.current = [];
    appliedUpdateIdsRef.current = [];
    appliedTabIdsRef.current.clear();
    appliedDeletionIdsRef.current.clear();
    setInjectedIds([]);
    setAppliedUpdateIds([]);
    if (currentMode === 'chat') setChatMessages(previous => appendChatRequest(previous, requestText));

    const isTabMutation = /(?:вкладк|категорі|напрямок|розділ|секці|tab|category|section)/iu.test(requestText);
    const activeList = currentTasks.filter((t) => !t.done);
    const doneList = currentTasks.filter((t) => t.done);

    let requestTimeout: number | undefined;
    let timedOut = false;
    const controller = new AbortController();
    assistController.current?.abort();
    assistController.current = controller;
    try {
      const customKey = localStorage.getItem('karkas_custom_api_key') || '';
      const customEnabled = localStorage.getItem('karkas_custom_ai_enabled') === 'true';

      requestTimeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 35000);
      const res = await karkasApiFetch('/api/ai/assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          prompt: requestText,
          action: currentMode,
          lang,
          tabs: tabs.map((tb) => tb.id),
          adaptiveProfile,
          currentTasks: currentTasks.map(task => ({ ...task, ...getAITimerContext(task) })),
          conversation: currentMode === 'chat' ? chatMessages.slice(-10) : undefined,
          pendingChanges: currentMode === 'chat' ? {
            tasks: pendingChatTasks, tabs: pendingChatTabs,
            taskUpdates: pendingChatUpdates,
            taskDeletions: pendingChatDeletions.map(id => ({ id })),
          } : undefined,
          allowNewTabs: isTabMutation,
          customApiKey: customEnabled ? customKey : undefined,
          selectedModel: customModelRef.current || undefined,
          fullAppContext: {
            activeTasks: activeList.map((t) => ({
              id: t.id,
              title: t.title,
              phase: t.phase,
              priority: t.priority,
              currentStep: t.currentStep,
              steps: t.steps,
              createdAt: t.createdAt,
              ...getAITimerContext(t),
              stepList: t.stepList || [],
              note: t.note,
            })),
            completedTasks: doneList.map(task => ({ ...task, ...getAITimerContext(task) })),
            deletedTasks: deletedTasks.slice(0, 15).map((t) => ({
              id: t.id,
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
      const rawData: unknown = await res.json().catch(() => { throw new AIRequestError('INVALID_RESPONSE'); });
      if (assistController.current !== controller) return;
      if (controller.signal.aborted) throw new AIRequestError(timedOut ? 'TIMEOUT' : 'CANCELLED');
      if (!res.ok) throw responseRequestError(rawData, res.status);
      const data = readAIResponse(rawData, currentMode);
      activeRequest.current = null;
      const hasPendingChatActions = currentMode === 'chat' && [data.tasks, data.tabs, data.taskUpdates, data.taskDeletions].some(actions => (actions?.length || 0) > 0);
      setRecoverableRequest(hasPendingChatActions ? { ...currentRequest, purpose: 'proposal' } : null);
      setRequestError(null);
      if (data.fallbackUsed && data.usedModel) setKeyStatus(lang === 'uk' ? `Відповідь підготувала доступна модель ${data.usedModel}.` : `The response was generated by the available model ${data.usedModel}.`);
      if (currentMode === 'chat') {
        {
          pendingChatConfirmed.current = false;
          setPendingChatTasks(data.tasks || []);
          setPendingChatTabs((data.tabs || []).map((tb) => ({ id: tb.id, name: tb.name, color: tb.color || '#6366f1' })));
          setPendingChatUpdates(data.taskUpdates || []);
          setPendingChatDeletions((data.taskDeletions || []).map((d) => d.id));
        }

        setChatMessages((previous) => [
          ...previous,
          {
            role: 'assistant',
            content: data.reply || data.summary,
          },
        ]);
      } else {
        setResponse(data);
      }
      sound.activate();
    } catch (err) {
      if (assistController.current !== controller) return;
      const error = controller.signal.aborted ? new AIRequestError(timedOut ? 'TIMEOUT' : 'CANCELLED') : err;
      setRequestError(aiRequestErrorMessage(error, lang));
      setRecoverableRequest(currentRequest);
      setPrompt(previous => previous || requestText);
      activeRequest.current = null;
      if (error instanceof AIRequestError && (error.code === 'INVALID_API_KEY' || error.code === 'MISSING_API_KEY')) {
        pendingRequest.current = currentRequest;
        setAwaitingApiKey(true);
        awaitingKeyRef.current = true;
        setPrompt('');
        setKeyStatus(aiRequestErrorMessage(error, lang));
      }
    } finally {
      window.clearTimeout(requestTimeout);
      if (assistController.current === controller) {
        requestInFlight.current = false;
        setLoading(false);
      }
    }
  };

  const cancelAIRequest = () => {
    requestGeneration.current += 1;
    assistController.current?.abort();
    assistController.current = null;
    verificationController.current?.abort();
    verificationController.current = null;
    requestInFlight.current = false;
    setLoading(false);
    if (activeRequest.current) {
      const interrupted = activeRequest.current;
      setPrompt(previous => previous || interrupted.text);
      setRecoverableRequest(interrupted);
      setRequestError(aiRequestErrorMessage(new AIRequestError('CANCELLED'), lang));
      activeRequest.current = null;
    } else if (awaitingKeyRef.current) {
      setPrompt('');
      setKeyStatus(lang === 'uk' ? 'Перевірку ключа перервано. Вставте його ще раз, щоб продовжити.' : 'Key verification was interrupted. Paste the key again to continue.');
    }
  };

  const returnToRequest = () => {
    cancelAIRequest();
    const request = pendingRequest.current || recoverableRequest;
    setAwaitingApiKey(false);
    awaitingKeyRef.current = false;
    setKeyStatus(null);
    if (request) { setPrompt(request.text); setMode(request.mode); }
  };

  const handleInjectAll = () => {
    if (!response) return;
    const taskList = getPendingTaskIndexes(response.tasks?.length || 0, injectedIdsRef.current).map(index => response.tasks![index]);
    const tabList: TaskTab[] = (response.tabs || []).filter(tab => !appliedTabIdsRef.current.has(tab.id)).map((t) => ({ id: t.id, name: t.name, color: t.color || '#6366f1' }));
    const updateList = (response.taskUpdates || []).filter(update => !appliedUpdateIdsRef.current.includes(update.id));
    const deleteList = (response.taskDeletions || []).map((d) => d.id).filter(id => !appliedDeletionIdsRef.current.has(id));

    if (!taskList.length && !tabList.length && !updateList.length && !deleteList.length) return;
    sound.activate();

    const formattedTasks = taskList.map(task => prepareAITask(task,
      index => `s-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`));

    injectedIdsRef.current = (response.tasks || []).map((_, i) => i);
    appliedUpdateIdsRef.current = (response.taskUpdates || []).map((u) => u.id);
    tabList.forEach(tab => appliedTabIdsRef.current.add(tab.id));
    deleteList.forEach(id => appliedDeletionIdsRef.current.add(id));
    const result = onInjectTasks(formattedTasks, tabList, updateList, deleteList);
    setApplyNotice(describeAIApplyResult(result, lang));
    setResponsePartlyRejected(result.rejected > 0);
    setInjectedIds(injectedIdsRef.current);
    setAppliedUpdateIds(appliedUpdateIdsRef.current);
    if (!result.rejected) closeAfterInject.current = setTimeout(() => {
      onClose();
    }, 500);
  };

  const handleInjectSingle = (task: NonNullable<AIResponse['tasks']>[0], index: number) => {
    if (injectedIdsRef.current.includes(index)) return;
    sound.tick(600);
    const tabList: TaskTab[] = (response?.tabs || []).filter(tab => !appliedTabIdsRef.current.has(tab.id)).map((t) => ({ id: t.id, name: t.name, color: t.color || '#6366f1' }));
    const result = onInjectTasks([
      prepareAITask(task, stepIndex => `s-${Date.now()}-${stepIndex}-${Math.random().toString(36).slice(2, 6)}`),
    ], tabList);
    setApplyNotice(describeAIApplyResult(result, lang));
    if (result.created) injectedIdsRef.current = [...injectedIdsRef.current, index];
    if (result.tabs) tabList.forEach(tab => appliedTabIdsRef.current.add(tab.id));
    setInjectedIds(injectedIdsRef.current);
  };

  const handleApplySingleUpdate = (update: AITaskUpdate) => {
    if (appliedUpdateIdsRef.current.includes(update.id)) return;
    sound.tick(650);
    const result = onInjectTasks([], [], [update], []);
    setApplyNotice(describeAIApplyResult(result, lang));
    if (result.updated) appliedUpdateIdsRef.current = [...appliedUpdateIdsRef.current, update.id];
    setAppliedUpdateIds(appliedUpdateIdsRef.current);
  };

  const remainingResponseActions = response
    ? getPendingTaskIndexes(response.tasks?.length || 0, injectedIds).length
      + (response.taskUpdates || []).filter(update => !appliedUpdateIds.includes(update.id)).length
      + (response.tabs || []).filter(tab => !appliedTabIdsRef.current.has(tab.id)).length
      + (response.taskDeletions || []).filter(deletion => !appliedDeletionIdsRef.current.has(deletion.id)).length
    : 0;

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
            role="dialog"
            aria-modal="true"
            aria-label={t.aiSheet.header}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            drag="y"
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={{ top: 0 }}
            dragElastic={0.2}
            onDragEnd={(_, info) => {
              if (info.offset.y > 100) {
                onClose();
              }
            }}
            className="relative z-10 w-full max-w-2xl bg-[#0c0c0e] border-t border-x border-neutral-800 max-h-[88dvh] flex flex-col shadow-2xl font-mono"
          >
            {/* Drag Handle */}
            <div
              aria-hidden="true"
              onPointerDown={(event) => dragControls.start(event)}
              style={{ touchAction: 'none' }}
              className="w-full shrink-0 flex items-center justify-center pt-2.5 pb-2 cursor-grab active:cursor-grabbing"
            >
              <div className="w-10 h-1 bg-neutral-700 rounded-full" />
            </div>

            {/* Header */}
            <div className="flex shrink-0 items-center justify-between gap-2 px-4 sm:px-5 py-3 border-b border-neutral-800">
              <div className="min-w-0 flex items-center gap-2">
                <AIIcon id={aiIconVariant} className="w-4 h-4 shrink-0 text-white" />
                <span className="min-w-0 break-words text-xs sm:text-sm font-bold uppercase tracking-wider font-mono text-white">
                  {t.aiSheet.header}
                </span>
              </div>
              <button
                id="close-ai-sheet-btn"
                aria-label={lang === 'uk' ? 'Закрити ШІ-помічника' : 'Close AI assistant'}
                onClick={onClose}
                className="shrink-0 min-w-11 min-h-11 flex items-center justify-center p-1.5 text-neutral-400 hover:text-white border border-neutral-800 hover:border-neutral-600 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Action Modes Selector */}
            <div className="shrink-0 grid grid-cols-2 sm:grid-cols-4 gap-1 px-4 sm:px-5 pt-3 pb-2 border-b border-neutral-800">
              <button
                id="ai-mode-chat-btn"
                aria-pressed={mode === 'chat'}
                type="button"
                disabled={loading}
                onClick={() => {
                  sound.tick(450);
                  setMode('chat');
                }}
                className={`min-h-11 min-w-0 py-1.5 px-2 text-xs font-mono font-bold tracking-normal sm:tracking-wider uppercase border transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  mode === 'chat'
                    ? 'bg-white text-black border-white'
                    : 'bg-[#08080a] text-neutral-400 border-neutral-800 hover:text-white hover:border-neutral-700'
                }`}
              >
                <MessagesSquare aria-hidden="true" className="w-4 h-4 shrink-0" strokeWidth={1.75} />
                <span className="min-w-0 whitespace-normal break-words leading-snug">{lang === 'uk' ? 'ЧАТ' : 'CHAT'}</span>
              </button>

              <button
                id="ai-mode-breakdown-btn"
                aria-pressed={mode === 'breakdown'}
                type="button"
                disabled={loading}
                onClick={() => {
                  sound.tick(500);
                  setMode('breakdown');
                }}
                className={`min-h-11 min-w-0 py-1.5 px-2 text-xs font-mono font-bold tracking-normal sm:tracking-wider uppercase border transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  mode === 'breakdown'
                    ? 'bg-white text-black border-white'
                    : 'bg-[#08080a] text-neutral-400 border-neutral-800 hover:text-white hover:border-neutral-700'
                }`}
              >
                <Workflow aria-hidden="true" className="w-4 h-4 shrink-0" strokeWidth={1.75} />
                <span className="min-w-0 whitespace-normal break-words leading-snug">{t.aiSheet.modes.breakdown}</span>
              </button>

              <button
                id="ai-mode-analyze-btn"
                aria-pressed={mode === 'analyze'}
                type="button"
                disabled={loading}
                onClick={() => {
                  sound.tick(550);
                  setMode('analyze');
                  handleGenerate(prompt, 'analyze');
                }}
                className={`min-h-11 min-w-0 py-1.5 px-2 text-xs font-mono font-bold tracking-normal sm:tracking-wider uppercase border transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  mode === 'analyze'
                    ? 'bg-white text-black border-white'
                    : 'bg-[#08080a] text-neutral-400 border-neutral-800 hover:text-white hover:border-neutral-700'
                }`}
              >
                <ChartNoAxesCombined aria-hidden="true" className="w-4 h-4 shrink-0" strokeWidth={1.75} />
                <span className="min-w-0 whitespace-normal break-words leading-snug">{t.aiSheet.modes.analyze}</span>
              </button>

              <button
                id="ai-mode-generate-btn"
                aria-pressed={mode === 'generate'}
                type="button"
                disabled={loading}
                onClick={() => {
                  sound.tick(600);
                  setMode('generate');
                }}
                className={`min-h-11 min-w-0 py-1.5 px-2 text-xs font-mono font-bold tracking-normal sm:tracking-wider uppercase border transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  mode === 'generate'
                    ? 'bg-white text-black border-white'
                    : 'bg-[#08080a] text-neutral-400 border-neutral-800 hover:text-white hover:border-neutral-700'
                }`}
              >
                <ClipboardList aria-hidden="true" className="w-4 h-4 shrink-0" strokeWidth={1.75} />
                <span className="min-w-0 whitespace-normal break-words leading-snug">{t.aiSheet.modes.generate}</span>
              </button>
            </div>

            {/* Content Container (Scrollable) */}
            <div ref={contentRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-5 flex flex-col gap-4">
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
                      disabled={loading || awaitingApiKey}
                      onClick={() => {
                        setPrompt(preset);
                        handleGenerate(preset);
                      }}
                      className="text-[11px] font-mono text-left px-2 py-1 bg-[#08080a] border border-neutral-800 text-neutral-400 hover:border-neutral-600 hover:text-neutral-200 disabled:opacity-40 transition-colors cursor-pointer"
                    >
                      + {preset}
                    </button>
                  ))}
                </div>
              </div>

              {/* Chat View */}
              {mode === 'chat' && chatMessages.length > 0 && (
                <div role="log" aria-label={lang === 'uk' ? 'Розмова з AI' : 'AI conversation'} aria-live="polite" aria-relevant="additions text" className="flex flex-col gap-3">
                  {chatMessages.map((message, index) => (
                    <div
                      key={`${message.role}-${index}`}
                      className={`max-w-[92%] border p-3 text-xs leading-relaxed whitespace-pre-wrap break-words ${
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

                  {/* Proposed Workspace Actions in Chat */}
                  {pendingChangeCount > 0 && !loading && (
                    <div className="border border-emerald-800/80 bg-[#0a120c] p-3 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>{lang === 'uk' ? 'Запропоновані зміни робочого простору' : 'Proposed Workspace Changes'}</span>
                        </span>
                        <button
                          type="button"
                          onClick={confirmChatChanges}
                          className="border border-emerald-600 bg-emerald-500 hover:bg-emerald-400 text-black px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider transition-colors cursor-pointer"
                        >
                          {lang === 'uk'
                            ? `Підтвердити всі зміни (${pendingChangeCount})`
                            : `Confirm all changes (${pendingChangeCount})`}
                        </button>
                      </div>

                      {/* Pending Tabs */}
                      {pendingChatTabs.length > 0 && (
                        <div className="space-y-1">
                          <div className="text-[9px] uppercase tracking-wider text-neutral-400 flex items-center gap-1">
                            <FolderPlus className="w-3 h-3 text-sky-400" />
                            <span>{lang === 'uk' ? 'Нові вкладки:' : 'New tabs:'}</span>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {pendingChatTabs.map((tb) => (
                              <span key={tb.id} className="text-xs bg-sky-950/40 border border-sky-800 text-sky-300 px-2 py-0.5">
                                {tb.name}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Pending Tasks */}
                      {pendingChatTasks.length > 0 && (
                        <div className="space-y-1.5">
                          <div className="text-[9px] uppercase tracking-wider text-neutral-400 flex items-center gap-1">
                            <Plus className="w-3 h-3 text-emerald-400" />
                            <span>{lang === 'uk' ? 'Нові завдання:' : 'New tasks:'}</span>
                          </div>
                          <div className="space-y-1">
                            {pendingChatTasks.map((t, idx) => (
                              <div key={idx} className="bg-black/60 border border-neutral-800 p-2 text-xs flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-[9px] text-emerald-400 font-bold">P{t.priority}</span>
                                    <span className="text-neutral-200 break-words">{t.title}</span>
                                    <span className="text-[10px] text-neutral-500">[{t.phase}]</span>
                                  </div>
                                  <TimerProposal settings={t} lang={lang} />
                                </div>
                                <span className="text-[10px] text-neutral-400 shrink-0">{t.steps} {lang === 'uk' ? 'кроків' : 'steps'}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {pendingChatDeletions.length > 0 && (
                        <div className="space-y-1 text-xs text-red-300">
                          <div>{lang === 'uk' ? 'Видалення завдань:' : 'Tasks to delete:'}</div>
                          {pendingChatDeletions.map(id => <div key={id}>{currentTasks.find(task => task.id === id)?.title || id}</div>)}
                        </div>
                      )}

                      {/* Pending Updates / Edits */}
                      {pendingChatUpdates.length > 0 && (
                        <div className="space-y-1.5">
                          <div className="text-[9px] uppercase tracking-wider text-neutral-400 flex items-center gap-1">
                            <Edit3 className="w-3 h-3 text-amber-400" />
                            <span>{lang === 'uk' ? 'Редагування існуючих завдань:' : 'Updates to existing tasks:'}</span>
                          </div>
                          <div className="space-y-1">
                            {pendingChatUpdates.map((u, idx) => {
                              const existing = currentTasks.find((ct) => ct.id === u.id);
                              return (
                                <div key={idx} className="bg-black/60 border border-neutral-800 p-2 text-xs flex items-center justify-between gap-2">
                                  <div className="min-w-0 break-words">
                                    <span className="text-neutral-400">{existing?.title || u.id} → </span>
                                    <span className="text-amber-300 font-bold">{u.title || (u.priority ? `P${u.priority}` : u.note || (lang === 'uk' ? 'Зміна параметрів' : 'Settings update'))}</span>
                                    <TimerProposal settings={u} lang={lang} />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {keyStatus && (
                <div role="status" aria-live="polite" className="border border-neutral-800 bg-[#111116] p-3 text-xs leading-relaxed text-neutral-200 whitespace-pre-wrap">
                  <div className="mb-1 text-[9px] font-bold uppercase tracking-widest opacity-60">KARKAS AI</div>
                  {keyStatus}
                  {awaitingApiKey && <button id="ai-return-to-request-btn" type="button" onClick={returnToRequest} className="mt-3 min-h-11 block border border-neutral-700 px-3 py-2 hover:border-white">
                    {lang === 'uk' ? 'Повернутися до запиту' : 'Return to request'}
                  </button>}
                </div>
              )}

              {requestError && !awaitingApiKey && (
                <div id="ai-request-error" role="alert" className="border border-neutral-700 bg-[#111116] p-3 text-xs leading-relaxed text-neutral-200">
                  <p>{requestError}</p>
                  {recoverableRequest && <button id="ai-retry-request-btn" type="button" disabled={loading} onClick={() => { setMode(recoverableRequest.mode); void handleGenerate(recoverableRequest.text, recoverableRequest.mode, false, !!prompt.trim() && prompt.trim() !== recoverableRequest.text.trim()); }} className="mt-3 min-h-11 border border-neutral-700 px-3 py-2 hover:border-white disabled:opacity-40">
                    {lang === 'uk' ? 'Повторити запит' : 'Retry request'}
                  </button>}
                </div>
              )}

              {applyNotice && <div role="status" aria-live="polite" className="border border-neutral-800 bg-[#111116] p-3 text-xs leading-relaxed text-neutral-200">{applyNotice}</div>}

              {loading && (
                <div role="status" aria-live="polite" className="p-8 border border-neutral-800 bg-black/40 flex flex-col items-center justify-center gap-3 text-center">
                  <div className="w-6 h-6 border-2 border-white border-t-transparent animate-spin rounded-full" />
                  <span className="text-xs font-mono tracking-widest text-neutral-300 uppercase animate-pulse">
                    {mode === 'chat'
                      ? (lang === 'uk' ? 'KARKAS AI ФОРМУЄ ВІДПОВІДЬ...' : 'KARKAS AI IS RESPONDING...')
                      : t.aiSheet.thinking}
                  </span>
                  <span className="text-[10px] font-mono text-neutral-500">
                    {t.aiSheet.fullContextDesc}
                  </span>
                  <button id="ai-request-cancel-btn" type="button" onClick={cancelAIRequest} className="min-h-11 border border-neutral-700 px-3 py-2 text-xs text-neutral-300 hover:border-white hover:text-white">
                    {lang === 'uk' ? 'Скасувати запит' : 'Cancel request'}
                  </button>
                </div>
              )}

              {/* Structured Response Section */}
              {response && !loading && (
                <div className="border border-neutral-800 bg-[#0d0d10] p-4 flex flex-col gap-4">
                  {/* Strategy Summary & Inject All */}
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-800 pb-3">
                    <div className="space-y-1">
                      <div className="text-[10px] font-mono uppercase text-neutral-400 tracking-widest flex items-center gap-1.5">
                        <AIIcon className="w-3 h-3" />
                        <span>{mode === 'analyze' ? (lang === 'uk' ? 'ДІАГНОСТИКА ПРОЦЕСУ' : 'WORKFLOW AUDIT') : t.aiSheet.strategyHeader}</span>
                      </div>
                      <p className="text-xs sm:text-sm font-bold text-neutral-100 leading-relaxed">
                        {response.summary}
                      </p>
                      {response.source === 'local-fallback' && (
                        <p role="status" className="text-xs text-amber-300">
                          {lang === 'uk' ? 'Локальні рекомендації: ШІ-запит не завершився.' : 'Local recommendations: the AI request did not complete.'}
                        </p>
                      )}
                    </div>

                    {((response.tasks && response.tasks.length > 0) || (response.tabs && response.tabs.length > 0) || (response.taskUpdates && response.taskUpdates.length > 0) || (response.taskDeletions && response.taskDeletions.length > 0)) && (
                      <button
                        id="ai-inject-all-btn"
                        disabled={remainingResponseActions === 0}
                        onClick={handleInjectAll}
                        className="whitespace-nowrap px-3 py-1.5 bg-white text-black font-extrabold text-xs font-mono tracking-wider hover:bg-neutral-200 transition-colors flex items-center gap-1.5 shrink-0 disabled:opacity-50 disabled:cursor-default"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>{remainingResponseActions === 0 ? t.aiSheet.added : `${t.aiSheet.injectAll} (${remainingResponseActions})`}</span>
                      </button>
                    )}
                  </div>

                  {/* Workload Diagnosis (in Analyze mode or when provided) */}
                  {response.workloadDiagnosis && (
                    <div className="bg-[#101015] border border-neutral-800 p-3.5 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-mono text-neutral-400 uppercase tracking-wider flex items-center gap-1.5">
                          <Activity className="w-3.5 h-3.5 text-indigo-400" />
                          <span>{lang === 'uk' ? 'Стан робочого навантаження' : 'Workload Status'}</span>
                        </span>
                        {response.workloadDiagnosis.status && (
                          <span className="text-[10px] font-bold px-2 py-0.5 bg-indigo-950/60 border border-indigo-700 text-indigo-300">
                            {response.workloadDiagnosis.status}
                          </span>
                        )}
                      </div>

                      {response.workloadDiagnosis.bottlenecks && response.workloadDiagnosis.bottlenecks.length > 0 && (
                        <div className="space-y-1">
                          <div className="text-[9px] uppercase tracking-wider text-amber-400 flex items-center gap-1 font-bold">
                            <AlertTriangle className="w-3 h-3" />
                            <span>{lang === 'uk' ? 'Виявлені вузькі місця:' : 'Identified Bottlenecks:'}</span>
                          </div>
                          <ul className="space-y-1 pl-1">
                            {response.workloadDiagnosis.bottlenecks.map((b, idx) => (
                              <li key={idx} className="text-xs text-neutral-300 flex items-start gap-1.5">
                                <span className="text-amber-400">›</span>
                                <span>{b}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Category Health Matrix */}
                  {response.categoryHealth && response.categoryHealth.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 flex items-center gap-1.5">
                        <ClipboardList aria-hidden="true" className="w-4 h-4 text-neutral-300" strokeWidth={1.75} />
                        <span>{lang === 'uk' ? 'Аналітика балансу категорій' : 'Category Balance Matrix'}</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {response.categoryHealth.map((ch, idx) => (
                          <div key={idx} className="p-2.5 bg-black/60 border border-neutral-800 space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-bold text-neutral-200">{ch.phaseName}</span>
                              <span className={`text-[9px] uppercase font-bold px-1.5 py-0.2 border ${
                                ch.status === 'overloaded'
                                  ? 'border-red-800 text-red-400 bg-red-950/30'
                                  : ch.status === 'stagnant'
                                  ? 'border-amber-800 text-amber-400 bg-amber-950/30'
                                  : 'border-emerald-800 text-emerald-400 bg-emerald-950/30'
                              }`}>
                                {ch.status} ({ch.taskCount})
                              </span>
                            </div>
                            {ch.recommendation && (
                              <p className="text-[11px] text-neutral-400 leading-tight">
                                {ch.recommendation}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Tactical Insights */}
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

                  {/* Proposed Tabs */}
                  {response.tabs && response.tabs.length > 0 && (
                    <div className="border border-sky-900/70 bg-sky-950/20 p-3 text-xs font-mono text-sky-200 space-y-2">
                      <span className="text-[10px] uppercase tracking-wider text-sky-400 flex items-center gap-1.5">
                        <FolderPlus className="w-3.5 h-3.5" />
                        <span>{lang === 'uk' ? 'Запропоновані нові вкладки' : 'Suggested new tabs'}</span>
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {response.tabs.map((tab) => (
                          <span key={tab.id} className="border border-sky-800 bg-black/40 px-2 py-1 text-sky-300 font-bold">
                            {tab.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {!!response.taskDeletions?.length && (
                    <div className="space-y-1 text-xs text-red-300">
                      <div>{lang === 'uk' ? 'Видалення завдань:' : 'Tasks to delete:'}</div>
                      {response.taskDeletions.map(({ id }) => <div key={id}>{currentTasks.find(task => task.id === id)?.title || id}</div>)}
                    </div>
                  )}

                  {/* Proposed Task Edits / Updates */}
                  {response.taskUpdates && response.taskUpdates.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-[10px] font-mono uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>{lang === 'uk' ? 'Редагування завдань' : 'Task Modifications'}</span>
                      </div>
                      <div className="flex flex-col gap-2">
                        {response.taskUpdates.map((up) => {
                          const existing = currentTasks.find((ct) => ct.id === up.id);
                          const isApplied = appliedUpdateIds.includes(up.id);
                          return (
                            <div key={up.id} className="p-3 bg-black border border-neutral-800 flex items-center justify-between gap-3">
                              <div className="space-y-0.5 text-xs">
                                <div className="text-neutral-400 line-through text-[11px]">{existing?.title || up.id}</div>
                                <div className="text-white font-bold">{up.title || existing?.title}</div>
                                <TimerProposal settings={up} lang={lang} />
                                {up.stepList !== undefined && <div className="text-neutral-300">
                                  {lang === 'uk' ? 'Підзавдання після зміни' : 'Subtasks after update'}: {up.stepList.length}
                                  {up.stepList.map((step, index) => <div key={step.id || index}>{step.done ? '?' : '?'} {step.title}</div>)}
                                </div>}
                                {up.priority && <span className="text-[10px] text-amber-400">P{up.priority} </span>}
                                {up.note && <span className="text-[10px] text-neutral-400">// {up.note}</span>}
                              </div>
                              <button
                                type="button"
                                onClick={() => handleApplySingleUpdate(up)}
                                disabled={isApplied}
                                className={`px-2.5 py-1 text-[10px] font-bold uppercase border shrink-0 transition-colors ${
                                  isApplied
                                    ? 'border-emerald-700 text-emerald-400 bg-emerald-950/40'
                                    : 'border-amber-700 text-amber-300 hover:border-white hover:text-white bg-amber-950/30'
                                }`}
                              >
                                {isApplied ? (responsePartlyRejected ? (lang === 'uk' ? 'Опрацьовано' : 'Processed') : t.aiSheet.added) : (lang === 'uk' ? 'Застосувати' : 'Apply')}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Generated Tasks List with Sub-Steps */}
                  {response.tasks && response.tasks.length > 0 && (
                    <div className="flex flex-col gap-2.5">
                      <div className="text-[10px] font-mono uppercase tracking-wider text-neutral-400">
                        {lang === 'uk' ? 'Заплановані завдання' : 'Actionable Tasks'} ({response.tasks.length})
                      </div>
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
                                <TimerProposal settings={task} lang={lang} />
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
                                {isInjected ? (responsePartlyRejected ? (lang === 'uk' ? 'Опрацьовано' : 'Processed') : t.aiSheet.added) : t.aiSheet.injectSingle}
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
            <div className="shrink-0 px-4 sm:px-5 py-3 bg-[#08080a] border-t border-neutral-800 space-y-2">
              {/* Voice recording / transcription status indicator */}
              {(isListening || isTranscribing || voiceNotice) && (
                <div className="flex items-center justify-between px-3 py-1.5 bg-[#050507] border border-neutral-800 text-xs font-mono">
                  {voiceNotice ? (
                    <div className="flex items-center gap-2 text-amber-400 w-full justify-between">
                      <div className="flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span className="text-[11px]">{voiceNotice}</span>
                      </div>
                      <button
                        onClick={() => setVoiceNotice(null)}
                        className="text-neutral-500 hover:text-white text-[10px] uppercase font-bold"
                      >
                        ✕
                      </button>
                    </div>
                  ) : isTranscribing ? (
                    <div className="flex items-center gap-2 text-neutral-300">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-neutral-400" />
                      <span className="text-[11px] text-neutral-300">{t.aiSheet.voiceTranscribing}</span>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-2 w-full">
                      <div className="min-w-0 flex flex-wrap items-center gap-2.5">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                        </span>
                        {/* Audio wave bars */}
                        <div className="flex items-end gap-0.5 h-3.5" role="meter" aria-label={lang === 'uk' ? 'Рівень мікрофона' : 'Microphone level'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(voiceLevel * 100)}>
                          {[0.65, 1, 0.8, 0.55].map((scale, index) => (
                            <span key={index} className="w-0.5 bg-red-400 transition-[height] duration-75" style={{ height: `${Math.max(2, voiceLevel * 14 * scale)}px` }} />
                          ))}
                        </div>
                        <span className="text-[11px] text-red-300 font-bold uppercase tracking-wider">
                          {voicePhase === 'starting'
                            ? (lang === 'uk' ? 'Запускаю мікрофон…' : 'Starting microphone…')
                            : voicePhase === 'connecting'
                              ? (lang === 'uk' ? 'Слухаю · підключаю розпізнавання…' : 'Listening · connecting…')
                              : voicePhase === 'recording'
                                ? (lang === 'uk' ? 'Записую · текст після зупинки' : 'Recording · text after stop')
                                : t.aiSheet.voiceListening}
                        </span>
                        <span className="text-[10px] text-neutral-400 font-mono">
                          {Math.floor(recordingDuration / 60).toString().padStart(2, '0')}:
                          {(recordingDuration % 60).toString().padStart(2, '0')}
                        </span>
                      </div>
                      <button
                        onClick={stopVoiceInput}
                        className="px-2 py-0.5 text-[10px] uppercase font-bold text-red-400 hover:text-white border border-red-900/60 hover:border-red-500 bg-red-950/40 transition-colors"
                      >
                        {t.aiSheet.voiceStop}
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label={lang === 'uk' ? 'Модель AI' : 'AI model'}
                  value={customModel}
                  disabled={loading || availableModels.length === 0}
                  onChange={(e) => {
                    const model = e.target.value;
                    chooseCustomModel(model);
                    localStorage.setItem('karkas_custom_model', model);
                    if (window.karkasDesktop) {
                      void window.karkasDesktop.preferences.update({ karkas_custom_model: model }).then(result => {
                        if ('error' in result) setKeyStatus(lang === 'uk' ? 'Не вдалося зберегти вибір моделі. Вона діє для поточного запиту; виберіть її знову після перезапуску.' : 'Could not save the model selection. It applies to this session; select it again after restarting.');
                      }).catch(() => setKeyStatus(lang === 'uk' ? 'Не вдалося зберегти вибір моделі. Спробуйте вибрати її ще раз.' : 'Could not save the model selection. Try selecting it again.'));
                    }
                    sound.tick(400);
                  }}
                  className="w-full sm:w-auto sm:max-w-[150px] bg-[#050507] border border-neutral-800 text-neutral-300 text-xs font-mono px-2 py-2.5 focus:outline-none focus:border-white disabled:opacity-50"
                >
                  {availableModels.length === 0 ? (
                    <option value="">{lang === 'uk' ? 'Модель не налаштована' : 'Model not configured'}</option>
                  ) : (
                    availableModels.map((model) => (
                      <option key={model} value={model}>{model}</option>
                    ))
                  )}
                </select>

                <div className="relative flex-1 min-w-0 flex items-center">
                  <input
                    id="ai-prompt-input"
                    aria-label={awaitingApiKey ? (lang === 'uk' ? 'Gemini API-ключ' : 'Gemini API key') : t.aiSheet.inputPlaceholder}
                    type={awaitingApiKey ? 'password' : 'text'}
                    value={prompt}
                    onChange={(e) => {
                      voiceRef.current?.cancel();
                      voiceRef.current = null;
                      setVoicePhase('idle');
                      setPrompt(e.target.value);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void handleGenerate(); }
                    }}
                    placeholder={
                      awaitingApiKey
                        ? (lang === 'uk' ? 'Вставте Gemini API-ключ сюди...' : 'Paste your Gemini API key here...')
                        : mode === 'chat'
                        ? (lang === 'uk' ? 'Напишіть запитання або дію (напр. «додай задачу X», «зміни пріоритет Y»)...' : 'Ask a question or request action (e.g. "add task X", "change priority of Y")...')
                        : mode === 'analyze'
                        ? (lang === 'uk' ? 'Уточніть фокус аналізу (напр. перевірити пріоритети, дедлайни)...' : 'Refine audit focus (e.g. check priorities, deadlines)...')
                        : t.aiSheet.inputPlaceholder
                    }
                    className="w-full min-h-11 bg-[#050507] border border-neutral-800 text-white placeholder:text-neutral-500 text-xs font-mono pl-3.5 pr-10 py-2.5 focus:outline-none focus:border-white transition-colors"
                  />
                  {/* Voice dictation button embedded in input field */}
                  <button
                    id="ai-voice-dictation-btn"
                    type="button"
                    onClick={handleToggleVoiceInput}
                    disabled={awaitingApiKey || isTranscribing}
                    title={isListening ? t.aiSheet.voiceStop : t.aiSheet.voiceInput}
                    aria-label={isListening ? t.aiSheet.voiceStop : t.aiSheet.voiceInput}
                    className={`absolute right-1.5 p-1.5 rounded transition-all cursor-pointer ${
                      isListening
                        ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                        : isTranscribing
                        ? 'text-neutral-500 cursor-wait'
                        : 'text-neutral-400 hover:text-white hover:bg-neutral-800/60'
                    }`}
                  >
                    {isTranscribing ? (
                      <Loader2 className="w-4 h-4 animate-spin text-neutral-300" />
                    ) : isListening ? (
                      <Square className="w-3.5 h-3.5 fill-current text-red-400" />
                    ) : (
                      <Mic className="w-4 h-4" />
                    )}
                  </button>
                </div>

                <button
                  id="ai-generate-submit-btn"
                  type="button"
                  onClick={() => handleGenerate()}
                  disabled={loading || !prompt.trim()}
                  title={t.aiSheet.execute}
                  aria-label={t.aiSheet.execute}
                  className="w-11 h-11 bg-white text-black hover:bg-neutral-200 disabled:opacity-30 disabled:hover:bg-white transition-all flex items-center justify-center cursor-pointer shrink-0"
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin text-black" />
                  ) : (
                    <ArrowUp className="w-4 h-4 stroke-[2.5]" />
                  )}
                </button>
              </div>
            </div>

            {/* Bottom Footer Hint */}
            <div className="shrink-0 px-4 sm:px-5 py-2.5 bg-black border-t border-neutral-800 flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono text-neutral-400">
              <span>{t.aiSheet.dismissHint}</span>
              <span>{t.aiSheet.footerTag}</span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
