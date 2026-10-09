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
  AIDeletedTaskRef,
} from '../types';
import { sound } from '../utils/audio';
import { createVoiceDictation, type VoicePhase } from '../utils/voiceDictation';
import { createVoiceDraft } from '../utils/voiceDraft';
import { AIModelSelect } from './AIModelSelect';
import { AIEmojiPicker } from './AIEmojiPicker';
import { AIChatText } from './AIChatText';
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
  RefreshCw,
} from 'lucide-react';
import { AIIcon, AIIconId } from './AIIconTemplates';
import { shouldVerifyAsApiKey } from '../utils/apiKey';
import { verifyApiKey, keyVerificationMessage } from '../utils/verifyApiKey';
import { desktopHasAiKey, karkasApiFetch } from '../utils/desktopApi';
import { selectRelevantArchivedTasks } from '../utils/taskArchive';
import { loadAIChatHistory, saveAIChatHistory } from '../services/chatHistory';
import type { PersistedAIChatMessage } from '../services/chatHistory';
import { getPendingTaskIndexes } from './workflowViewModel';
import { useDialogKeyboard } from './useDialogKeyboard';
import { describeAIApplyResult, describeAITimer, getAITimerContext, prepareAITask, type AIApplyResult } from './aiTaskProposal';
import { describeSchedule } from '../utils/schedulePresentation';
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
  initialPromptAsDraft?: boolean;
  aiIconVariant?: AIIconId;
  onInjectTasks: (
    newTasks: (Omit<PSTask, 'id' | 'currentStep' | 'done' | 'pinned' | 'createdAt'> & AITimerSettings)[],
    newTabs?: TaskTab[],
    taskUpdates?: AITaskUpdate[],
    deletedTaskIds?: (string | AIDeletedTaskRef)[],
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
  let choiceSection = false;
  let choicesStarted = false;
  let inCodeBlock = false;

  for (const line of lines) {
    if (/^\s{0,3}```/.test(line)) {
      inCodeBlock = !inCodeBlock;
      choiceSection = false;
      bodyLines.push(line);
      continue;
    }
    if (inCodeBlock) {
      bodyLines.push(line);
      continue;
    }
    const plain = line.trim().replace(/[*#]/g, '');
    if (/(?:оберіть|виберіть).*(?:варіант|відповідь)|(?:choose|select).*(?:option|response|one)|^(?:варіанти відповіді|response options)\s*:?$/i.test(plain)) {
      choiceSection = true;
      choicesStarted = false;
      bodyLines.push(line);
      continue;
    }
    const match = line.trim().match(/^(\d+|[А-Яа-яA-Za-z])\s*[.)\-:]\s+(.+)$/);
    if (match && choiceSection) {
      options.push({ label: match[1].toUpperCase(), text: match[2].trim() });
      choicesStarted = true;
    } else {
      bodyLines.push(line);
      if (plain || choicesStarted) choiceSection = false;
    }
  }

  return { body: bodyLines.join('\n').replace(/\n{3,}/g, '\n\n').trim(), options };
};

const isChatModel = (model: string) => {
  const name = model.toLowerCase();
  return name.includes('gemini') && !/(embedding|image|tts|transcrib|robotics|computer-use)/.test(name);
};

const TimerProposal: React.FC<{ settings: AITimerSettings & { schedule?: import('../types').TaskSchedule }; lang: Language }> = ({ settings, lang }) => {
  const description = describeAITimer(settings, lang);
  return <>{description && <div className="mt-1 text-base leading-[1.6] text-sky-300 whitespace-normal">{description}</div>}{settings.schedule && <div className="mt-2 text-base leading-relaxed text-emerald-300">{describeSchedule(settings.schedule, lang)}<p className="mt-1 text-sm text-neutral-400">{lang === 'uk' ? 'Сповіщення надходять, поки Karkas працює, зокрема в треї. Після повного закриття пропущене завдання з’явиться при відкритті.' : 'Notifications require Karkas running, including in the tray. Missed tasks appear when you reopen it.'}</p></div>}</>;
};

const deletionReasonLabel = (reason: AIDeletedTaskRef['deletionReason'], lang: Language) => reason === 'accidental'
  ? (lang === 'uk' ? 'Додано помилково — без статистики та AI' : 'Added by mistake — excluded from statistics and AI')
  : reason === 'cancelled' ? (lang === 'uk' ? 'Скасовано' : 'Cancelled')
  : (lang === 'uk' ? 'Прибрано без уточненої причини' : 'Removed without a specified reason');

const normalizedProposalText = (text: string | undefined) => (text || '').trim().replace(/\s+/g, ' ').toLowerCase();

const ProposalSteps: React.FC<{ steps: (string | { id?: string; title: string; done?: boolean })[]; lang: Language }> = ({ steps, lang }) => (
  <ol className="space-y-2">
    {steps.map((step, index) => {
      const title = typeof step === 'string' ? step : step.title;
      const done = typeof step !== 'string' && step.done;
      return <li key={typeof step === 'string' ? index : step.id || index} className="flex items-start gap-2 text-base leading-[1.6] text-neutral-300">
        <span className="shrink-0 text-neutral-400" aria-hidden="true">{done ? '✓' : `${index + 1}.`}</span>
        <span className="min-w-0 break-words">{title}{done && <span className="ml-2 text-sm text-neutral-400">{lang === 'uk' ? '(завершено)' : '(completed)'}</span>}</span>
      </li>;
    })}
  </ol>
);

const TaskUpdatePreview: React.FC<{ update: AITaskUpdate; existing?: PSTask; tabs: TaskTab[]; lang: Language }> = ({ update, existing, tabs, lang }) => {
  const phaseLabel = update.phase && ((TRANSLATIONS[lang].phases as any)[update.phase] || tabs.find(tab => tab.id === update.phase)?.name || update.phase);
  return <div className="min-w-0 space-y-2 text-base leading-[1.6]">
    {update.title && existing?.title && update.title !== existing.title && <p className="text-sm text-neutral-400 line-through break-words">{existing.title}</p>}
    <p className="font-semibold text-neutral-100 break-words">{update.title || existing?.title || update.id}</p>
    <TimerProposal settings={update} lang={lang} />
    {update.stepList !== undefined && <div className="space-y-2">
      <p className="text-sm font-semibold text-neutral-400">{lang === 'uk' ? 'Підзавдання' : 'Subtasks'} ({update.stepList.length})</p>
      {update.stepList.length ? <ProposalSteps steps={update.stepList} lang={lang} /> : <p className="text-neutral-300">{lang === 'uk' ? 'Підзавдання буде прибрано.' : 'The subtasks will be removed.'}</p>}
    </div>}
    {update.stepList === undefined && update.steps !== undefined && <p className="text-neutral-300">{lang === 'uk' ? 'Кількість підзавдань' : 'Subtask count'}: {update.steps}</p>}
    {update.done !== undefined && <p className="text-neutral-300">{lang === 'uk' ? 'Статус' : 'Status'}: {update.done ? (lang === 'uk' ? 'Завершено' : 'Completed') : (lang === 'uk' ? 'У роботі' : 'In progress')}</p>}
    {phaseLabel && <p className="text-sm text-neutral-400">{lang === 'uk' ? 'Категорія' : 'Category'}: {phaseLabel}</p>}
    {update.priority && <p className="text-sm text-amber-300">{lang === 'uk' ? 'Пріоритет' : 'Priority'}: P{update.priority}</p>}
    {update.note !== undefined && (!update.note || normalizedProposalText(update.note) !== normalizedProposalText(update.title || existing?.title)) && <p className="text-neutral-300 whitespace-pre-wrap break-words">{update.note || (lang === 'uk' ? 'Примітку буде прибрано.' : 'The note will be removed.')}</p>}
  </div>;
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
  initialPromptAsDraft = false,
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
  const [prompt, setPrompt] = useState(initialPrompt);
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [mode, setMode] = useState<AIMode>(initialDraft?.mode || 'chat');
  const [recoverableRequest, setRecoverableRequest] = useState<AIRequest | null>(initialDraft?.recoverableRequest || null);
  const [requestError, setRequestError] = useState<string | null>(restoredAIRequestNotice(initialDraft?.recoverableRequest, lang));
  const activeRequest = useRef<AIRequest | null>(null);
  const draftAccountRef = useRef(accountId);
  const skipDraftPersistRef = useRef(false);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<AIResponse | null>(null);
  const [responseRequest, setResponseRequest] = useState<AIRequest | null>(null);
  const planningSourceRef = useRef<AIRequest | null>(null);
  const preservedRequestDraftRef = useRef<string | null>(null);
  const [responseProposalReady, setResponseProposalReady] = useState(false);
  const responseProposalReadyRef = useRef(false);
  const readyResponseRef = useRef<AIResponse | null>(null);
  const setResponseProposalReadiness = (ready: boolean) => {
    responseProposalReadyRef.current = ready;
    if (!ready) readyResponseRef.current = null;
    setResponseProposalReady(ready);
  };
  const [applyNotice, setApplyNotice] = useState<string | null>(null);
  const [responsePartlyRejected, setResponsePartlyRejected] = useState(false);
  const [chatMessages, setChatMessages] = useState<AIChatMessage[]>(() => loadAIChatHistory(accountId));
  const hydratedAccountRef = useRef(accountId);
  const skipPersistRef = useRef(false);

  const [pendingChatTasks, setPendingChatTasks] = useState<NonNullable<AIResponse['tasks']>>([]);
  const [pendingChatTabs, setPendingChatTabs] = useState<TaskTab[]>([]);
  const [pendingChatUpdates, setPendingChatUpdates] = useState<AITaskUpdate[]>([]);
  const [pendingChatDeletions, setPendingChatDeletions] = useState<AIDeletedTaskRef[]>([]);
  const [chatProposalReady, setChatProposalReady] = useState(false);
  const chatProposalReadyRef = useRef(false);
  const setChatProposalReadiness = (ready: boolean) => {
    chatProposalReadyRef.current = ready;
    setChatProposalReady(ready);
  };
  const pendingChatConfirmed = useRef(false);
  const [chatPlanningRequest, setChatPlanningRequest] = useState<AIRequest | null>(null);
  const [chatPlanningResponse, setChatPlanningResponse] = useState<AIResponse | null>(null);

  const [awaitingApiKey, setAwaitingApiKey] = useState(false);
  const [keyStatus, setKeyStatus] = useState<string | null>(null);
  const pendingRequest = useRef<AIRequest | null>(null);
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
      setRecoverableRequest(interrupted);
      setRequestError(aiRequestErrorMessage(new AIRequestError('CANCELLED'), lang));
      setResponseProposalReadiness(false);
    }
    if (!isOpen) {
      setPrompt('');
      preservedRequestDraftRef.current = null;
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
  const [voiceReviewText, setVoiceReviewText] = useState('');
  const voiceRef = useRef<ReturnType<typeof createVoiceDictation> | null>(null);
  const voiceDraftRef = useRef<ReturnType<typeof createVoiceDraft> | null>(null);
  const isListening = ['starting', 'connecting', 'listening', 'recording'].includes(voicePhase);
  const isTranscribing = voicePhase === 'finishing';

  const stopVoiceInput = () => voiceRef.current?.stop();

  useEffect(() => {
    if (!isListening) { setRecordingDuration(0); return; }
    const interval = setInterval(() => setRecordingDuration(value => value + 1), 1000);
    return () => clearInterval(interval);
  }, [isListening]);

  useEffect(() => {
    voiceRef.current?.cancel();
    voiceRef.current = null;
    voiceDraftRef.current = null;
    setVoicePhase('idle');
    setVoiceLevel(0);
    setVoiceNotice(null);
    setVoiceReviewText('');
    return () => {
      voiceRef.current?.cancel();
      voiceRef.current = null;
      voiceDraftRef.current = null;
    };
  }, [isOpen, accountId]);

  useEffect(() => () => { voiceRef.current?.cancel(); }, []);

  const handleToggleVoiceInput = () => {
    if (requestInFlight.current) return;
    if (isListening) { stopVoiceInput(); return; }
    if (isTranscribing || voiceRef.current) return;
    setVoiceNotice(null);
    setVoiceReviewText('');
    const draft = createVoiceDraft(prompt);
    voiceDraftRef.current = draft;
    const dictation = createVoiceDictation({
      lang,
      onPhase: phase => {
        if (voiceDraftRef.current !== draft) return;
        setVoicePhase(phase);
        if (phase === 'idle') { voiceRef.current = null; voiceDraftRef.current = null; }
      },
      onLevel: level => { if (voiceDraftRef.current === draft) setVoiceLevel(level); },
      onText: spoken => {
        if (voiceDraftRef.current !== draft) return;
        const result = draft.receive(spoken);
        const field = promptInputRef.current;
        const selection = field && document.activeElement === field ? [field.selectionStart, field.selectionEnd] : null;
        const followEnd = field && selection && selection[0] === field.value.length && selection[1] === field.value.length;
        setPrompt(result.text);
        setVoiceReviewText(previous => previous ? spoken : previous);
        if (result.needsReview) {
          setVoiceReviewText(spoken);
          setVoiceNotice(lang === 'uk'
            ? 'Частину уточненого запису не вставлено, щоб зберегти ваші правки. Перевірте повний розпізнаний текст нижче.'
            : 'Part of the revised recording was not inserted to preserve your edits. Review the full recognized text below.');
        }
        if (selection) requestAnimationFrame(() => {
          if (promptInputRef.current === field && document.activeElement === field) field?.setSelectionRange(followEnd ? result.text.length : selection[0], followEnd ? result.text.length : selection[1]);
        });
      },
      onError: message => { if (voiceDraftRef.current === draft) setVoiceNotice(message); },
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
    setChatProposalReadiness(false);
    setPendingChatTasks([]);
    setPendingChatTabs([]);
    setPendingChatUpdates([]);
    setPendingChatDeletions([]);
    setChatPlanningRequest(null);
    setChatPlanningResponse(null);
    setResponse(null);
    setResponseRequest(null);
    planningSourceRef.current = null;
    preservedRequestDraftRef.current = null;
    setResponseProposalReadiness(false);
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
    setPrompt('');
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
    saveAIAssistantDraft(localStorage, { prompt: '', mode, recoverableRequest }, accountId);
  }, [accountId, mode, recoverableRequest]);

  useEffect(() => {
    const field = promptInputRef.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(160, Math.max(52, field.scrollHeight))}px`;
    field.style.overflowY = field.scrollHeight > 160 ? 'auto' : 'hidden';
  }, [prompt, isOpen, awaitingApiKey]);

  useEffect(() => {
    if (!isOpen) return;
    const frame = requestAnimationFrame(() => {
      if (contentRef.current) contentRef.current.scrollTop = mode === 'chat' || loading || awaitingApiKey ? contentRef.current.scrollHeight : 0;
    });
    return () => cancelAnimationFrame(frame);
  }, [isOpen, mode, chatMessages, loading, awaitingApiKey, keyStatus, requestError, response]);

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
    if (!chatProposalReadyRef.current || requestInFlight.current || requestError || pendingChangeCount === 0 || pendingChatConfirmed.current) return;
    pendingChatConfirmed.current = true;
    setChatProposalReadiness(false);

    const tasks = (pendingChatTasks || []).map(task => prepareAITask(task,
      index => `s-chat-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`));

    const result = onInjectTasks(tasks, pendingChatTabs, pendingChatUpdates, pendingChatDeletions);
    setRecoverableRequest(null);
    setRequestError(null);

    setPendingChatTasks([]);
    setPendingChatTabs([]);
    setPendingChatUpdates([]);
    setPendingChatDeletions([]);
    setChatPlanningRequest(null);
    setChatPlanningResponse(null);

    setChatMessages((previous) => [
      ...previous,
      {
        role: 'assistant',
        content: describeAIApplyResult(result, lang),
      },
    ]);
    sound.activate();
  };

  const activeCount = currentTasks.filter((t) => !t.done && !t.scheduledPending).length;
  const completedCount = currentTasks.filter((t) => t.done).length;

  // Sync initialPrompt
  useEffect(() => {
    if (initialPrompt) {
      const normalizedPrompt = initialPrompt.trim().toLowerCase().replace(/[!?.,]/g, '');
      const isGreeting = /^(привіт|вітаю|добрий день|доброго ранку|добрий вечір|hello|hi|hey)$/.test(normalizedPrompt);
      const initialMode: AIMode = initialPromptAsDraft || isGreeting ? 'chat' : 'breakdown';
      setPrompt(initialPrompt);
      setMode(initialMode);
      if (!initialPromptAsDraft) handleGenerate(initialPrompt, initialMode);
    }
  }, [initialPrompt, initialPromptAsDraft]);

  const handleGenerate = async (queryText?: string, selectedMode?: AIMode, resuming = false, preserveInput = false, planningSource?: AIRequest, internalAlternative = false) => {
    voiceRef.current?.cancel();
    voiceRef.current = null;
    voiceDraftRef.current = null;
    setVoicePhase('idle');
    const textToQuery = queryText !== undefined ? queryText : prompt;
    const currentMode = selectedMode || mode;
    const requestText = textToQuery.trim() || (
      currentMode === 'analyze'
        ? (lang === 'uk' ? 'Повний аудит робочого процесу, вузьких місць і аналітика категорій' : 'Comprehensive workflow audit, bottleneck analysis, and category metrics')
        : ''
    );
    const retryRequest = recoverableRequest?.text === requestText && recoverableRequest.mode === currentMode ? recoverableRequest : null;
    const isAlternativeRequest = internalAlternative || retryRequest?.internalAlternative === true;
    const keepDraft = preserveInput || isAlternativeRequest;
    const sourceRequest = planningSource || retryRequest?.planningSource || { text: requestText, mode: currentMode };
    const currentRequest: AIRequest = {
      text: requestText,
      mode: currentMode,
      ...(isAlternativeRequest ? { internalAlternative: true, planningSource: { text: sourceRequest.text, mode: sourceRequest.mode } } : {}),
    };

    if (!requestText) return;
    if (requestInFlight.current) return;
    if (currentMode === 'chat' && pendingChangeCount > 0 && /^(так|підтверджую|підтверджено|yes|confirm|ок|застосувати|зберегти)$/i.test(textToQuery.trim())) {
      if (!chatProposalReadyRef.current || requestError) {
        setRequestError(lang === 'uk'
          ? 'Спочатку повторіть останній запит, щоб підготувати актуальну пропозицію. Зміни до завдань не застосовано.'
          : 'Retry the last request first to prepare an up-to-date proposal. No task changes were applied.');
        return;
      }
      setPrompt('');
      setChatMessages(previous => appendChatRequest(previous, textToQuery.trim()));
      confirmChatChanges();
      return;
    }
    setChatProposalReadiness(false);
    setResponseProposalReadiness(false);
    setApplyNotice(null);
    if (closeAfterInject.current) { clearTimeout(closeAfterInject.current); closeAfterInject.current = null; }
    const generation = requestGeneration.current;
    const isKeyEntry = !resuming && shouldVerifyAsApiKey(requestText, awaitingKeyRef.current, queryText === undefined);
    if (!isKeyEntry) {
      if (!resuming) preservedRequestDraftRef.current = keepDraft ? prompt : null;
      planningSourceRef.current = sourceRequest;
      activeRequest.current = currentRequest;
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
      if (!isKeyEntry) { setRecoverableRequest(currentRequest); setPrompt(previous => preservedRequestDraftRef.current ?? (previous || requestText)); }
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
      let requestToResume: AIRequest | null = null;
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
        if (preservedRequestDraftRef.current !== null) setPrompt(preservedRequestDraftRef.current);
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
        setMode(requestToResume.mode);
        await handleGenerate(requestToResume.text, requestToResume.mode, true, preservedRequestDraftRef.current !== null, requestToResume.planningSource || planningSourceRef.current || undefined, requestToResume.internalAlternative);
      }
      return;
    }

    if (!resuming && (window.karkasDesktop ? !desktopKeyAvailable : !savedApiKey || !customAiEnabled)) {
      setPrompt('');
      setAwaitingApiKey(true);
      awaitingKeyRef.current = true;
      pendingRequest.current = currentRequest;
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
    if (!keepDraft) setPrompt('');
    setAwaitingApiKey(false);
    awaitingKeyRef.current = false;
    setKeyStatus(null);
    setRequestError(null);
    activeRequest.current = currentRequest;
    setRecoverableRequest(currentRequest);
    pendingRequest.current = null;
    requestInFlight.current = true;
    setLoading(true);
    if (currentMode === 'chat') setChatMessages(previous => appendChatRequest(previous,
      currentRequest.internalAlternative ? (lang === 'uk' ? 'Інший варіант планування' : 'Alternative plan') : requestText));

    const isTabMutation = /(?:вкладк|категорі|напрямок|розділ|секці|tab|category|section)/iu.test(requestText);
    const activeList = currentTasks.filter((t) => !t.done && !t.scheduledPending);
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
          clientClock: { now: new Date().toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' },
          action: currentMode,
          lang,
          tabs: tabs.map((tb) => tb.id),
          adaptiveProfile,
          currentTasks: currentTasks.map(task => ({ ...task, ...getAITimerContext(task) })),
          conversation: currentMode === 'chat' ? chatMessages.slice(-10) : undefined,
          pendingChanges: currentMode === 'chat' ? {
            tasks: pendingChatTasks, tabs: pendingChatTabs,
            taskUpdates: pendingChatUpdates,
            taskDeletions: pendingChatDeletions,
          } : undefined,
          allowNewTabs: isTabMutation,
          customApiKey: customEnabled ? customKey : undefined,
          selectedModel: customModelRef.current || undefined,
          fullAppContext: {
            scheduledPlans: currentTasks.filter(task => task.scheduledPending),
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
            deletedTasks: selectRelevantArchivedTasks(currentTasks, deletedTasks).slice(0, 15).map((t) => ({
              id: t.id,
              title: t.title,
              phase: t.phase,
              done: t.done,
              deletionReason: t.deletionReason,
              deletedAt: t.deletedAt,
              completedAt: t.completedAt,
              createdAt: t.createdAt,
              timeSpentSeconds: t.timeSpentSeconds,
              steps: t.steps,
              currentStep: t.currentStep,
            })),
            tabs: tabs.map((tb) => ({ id: tb.id, name: tb.name, color: tb.color })),
            stats: stats || {
              total: activeCount + completedCount,
              completed: completedCount,
              percent: activeCount + completedCount > 0 ? Math.round((completedCount / (activeCount + completedCount)) * 100) : 0,
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
      const hasPendingActions = [data.tasks, data.tabs, data.taskUpdates, data.taskDeletions].some(actions => (actions?.length || 0) > 0);
      const hasPendingChatActions = currentMode === 'chat' && hasPendingActions;
      setRecoverableRequest(hasPendingActions ? { ...currentRequest, purpose: 'proposal' } : null);
      setRequestError(null);
      if (preservedRequestDraftRef.current !== null) setPrompt(preservedRequestDraftRef.current);
      if (data.fallbackUsed && data.usedModel) setKeyStatus(lang === 'uk' ? `Відповідь підготувала доступна модель ${data.usedModel}.` : `The response was generated by the available model ${data.usedModel}.`);
      if (currentMode === 'chat') {
        const isPlanningResponse = !!data.tasks?.length || !!data.taskUpdates?.length || /план|\bplan(?:ning)?\b/iu.test((planningSourceRef.current || currentRequest).text);
        setChatPlanningRequest(isPlanningResponse ? planningSourceRef.current || currentRequest : null);
        setChatPlanningResponse(isPlanningResponse ? data : null);
        {
          pendingChatConfirmed.current = false;
          setChatProposalReadiness(hasPendingChatActions);
          setPendingChatTasks(data.tasks || []);
          setPendingChatTabs((data.tabs || []).map((tb) => ({ id: tb.id, name: tb.name, color: tb.color || '#6366f1' })));
          setPendingChatUpdates(data.taskUpdates || []);
          setPendingChatDeletions(data.taskDeletions || []);
        }

        setChatMessages((previous) => [
          ...previous,
          {
            role: 'assistant',
            content: data.reply || data.summary,
          },
        ]);
      } else {
        setResponsePartlyRejected(false);
        injectedIdsRef.current = [];
        appliedUpdateIdsRef.current = [];
        appliedTabIdsRef.current.clear();
        appliedDeletionIdsRef.current.clear();
        setInjectedIds([]);
        setAppliedUpdateIds([]);
        setResponse(data);
        setResponseRequest(planningSourceRef.current || currentRequest);
        readyResponseRef.current = data;
        setResponseProposalReadiness(true);
      }
      sound.activate();
    } catch (err) {
      if (assistController.current !== controller) return;
      const error = controller.signal.aborted ? new AIRequestError(timedOut ? 'TIMEOUT' : 'CANCELLED') : err;
      setRequestError(aiRequestErrorMessage(error, lang));
      setRecoverableRequest(currentRequest);
      setPrompt(previous => preservedRequestDraftRef.current ?? (previous || requestText));
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
    setChatProposalReadiness(false);
    setResponseProposalReadiness(false);
    requestGeneration.current += 1;
    assistController.current?.abort();
    assistController.current = null;
    verificationController.current?.abort();
    verificationController.current = null;
    requestInFlight.current = false;
    setLoading(false);
    if (activeRequest.current) {
      const interrupted = activeRequest.current;
      setPrompt(previous => preservedRequestDraftRef.current ?? (previous || interrupted.text));
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
    if (request) { setPrompt(preservedRequestDraftRef.current ?? (request.internalAlternative ? request.planningSource?.text || '' : request.text)); setMode(request.mode); }
  };

  const handleInjectAll = () => {
    if (!response || !responseProposalReadyRef.current || readyResponseRef.current !== response || requestInFlight.current || requestError || responseRequest?.mode !== mode) return;
    const taskList = getPendingTaskIndexes(response.tasks?.length || 0, injectedIdsRef.current).map(index => response.tasks![index]);
    const tabList: TaskTab[] = (response.tabs || []).filter(tab => !appliedTabIdsRef.current.has(tab.id)).map((t) => ({ id: t.id, name: t.name, color: t.color || '#6366f1' }));
    const updateList = (response.taskUpdates || []).filter(update => !appliedUpdateIdsRef.current.includes(update.id));
    const deleteList = (response.taskDeletions || []).filter(deletion => !appliedDeletionIdsRef.current.has(deletion.id));

    if (!taskList.length && !tabList.length && !updateList.length && !deleteList.length) return;
    sound.activate();

    const formattedTasks = taskList.map(task => prepareAITask(task,
      index => `s-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`));

    injectedIdsRef.current = (response.tasks || []).map((_, i) => i);
    appliedUpdateIdsRef.current = (response.taskUpdates || []).map((u) => u.id);
    tabList.forEach(tab => appliedTabIdsRef.current.add(tab.id));
    deleteList.forEach(deletion => appliedDeletionIdsRef.current.add(deletion.id));
    const result = onInjectTasks(formattedTasks, tabList, updateList, deleteList);
    if (!result.rejected) setRecoverableRequest(null);
    setApplyNotice(describeAIApplyResult(result, lang));
    setResponsePartlyRejected(result.rejected > 0);
    setInjectedIds(injectedIdsRef.current);
    setAppliedUpdateIds(appliedUpdateIdsRef.current);
    if (!result.rejected) closeAfterInject.current = setTimeout(() => {
      onClose();
    }, 500);
  };

  const handleInjectSingle = (task: NonNullable<AIResponse['tasks']>[0], index: number) => {
    if (!response || !responseProposalReadyRef.current || readyResponseRef.current !== response || requestInFlight.current || requestError || responseRequest?.mode !== mode || injectedIdsRef.current.includes(index)) return;
    sound.tick(600);
    const tabList: TaskTab[] = (response?.tabs || []).filter(tab => !appliedTabIdsRef.current.has(tab.id)).map((t) => ({ id: t.id, name: t.name, color: t.color || '#6366f1' }));
    const result = onInjectTasks([
      prepareAITask(task, stepIndex => `s-${Date.now()}-${stepIndex}-${Math.random().toString(36).slice(2, 6)}`),
    ], tabList);
    setApplyNotice(describeAIApplyResult(result, lang));
    if (result.created) injectedIdsRef.current = [...injectedIdsRef.current, index];
    if (result.tabs) tabList.forEach(tab => appliedTabIdsRef.current.add(tab.id));
    setInjectedIds(injectedIdsRef.current);
    if (!result.rejected && response && getPendingTaskIndexes(response.tasks?.length || 0, injectedIdsRef.current).length === 0
      && !(response.taskUpdates || []).some(update => !appliedUpdateIdsRef.current.includes(update.id))
      && !(response.tabs || []).some(tab => !appliedTabIdsRef.current.has(tab.id))
      && !(response.taskDeletions || []).some(deletion => !appliedDeletionIdsRef.current.has(deletion.id))) setRecoverableRequest(null);
  };

  const handleApplySingleUpdate = (update: AITaskUpdate) => {
    if (!response || !responseProposalReadyRef.current || readyResponseRef.current !== response || requestInFlight.current || requestError || responseRequest?.mode !== mode || appliedUpdateIdsRef.current.includes(update.id)) return;
    sound.tick(650);
    const result = onInjectTasks([], [], [update], []);
    setApplyNotice(describeAIApplyResult(result, lang));
    if (result.updated) appliedUpdateIdsRef.current = [...appliedUpdateIdsRef.current, update.id];
    setAppliedUpdateIds(appliedUpdateIdsRef.current);
    if (!result.rejected && response && getPendingTaskIndexes(response.tasks?.length || 0, injectedIdsRef.current).length === 0
      && !(response.taskUpdates || []).some(item => !appliedUpdateIdsRef.current.includes(item.id))
      && !(response.tabs || []).some(tab => !appliedTabIdsRef.current.has(tab.id))
      && !(response.taskDeletions || []).some(deletion => !appliedDeletionIdsRef.current.has(deletion.id))) setRecoverableRequest(null);
  };

  const remainingResponseActions = response
    ? getPendingTaskIndexes(response.tasks?.length || 0, injectedIds).length
      + (response.taskUpdates || []).filter(update => !appliedUpdateIds.includes(update.id)).length
      + (response.tabs || []).filter(tab => !appliedTabIdsRef.current.has(tab.id)).length
      + (response.taskDeletions || []).filter(deletion => !appliedDeletionIdsRef.current.has(deletion.id)).length
    : 0;

  const responseActionCount = response
    ? (response.tasks?.length || 0) + (response.tabs?.length || 0) + (response.taskUpdates?.length || 0) + (response.taskDeletions?.length || 0)
    : 0;
  const hasAppliedResponseActions = remainingResponseActions < responseActionCount;
  const responseMode = responseRequest?.mode;
  const showStructuredResponse = !!response && responseMode === mode;
  const canApplyResponse = responseProposalReady && !loading && !requestError && !awaitingApiKey;
  const hasPlanningProposal = !!response && (responseMode === 'breakdown' || responseMode === 'generate' || responseActionCount > 0);
  const seenInsights = new Set<string>();
  const displayedInsights = (response?.insights || []).filter(insight => {
    const normalized = normalizedProposalText(insight);
    if (!normalized || normalized === normalizedProposalText(response?.summary) || seenInsights.has(normalized)) return false;
    seenInsights.add(normalized);
    return true;
  });
  const displayedBottlenecks = (response?.workloadDiagnosis?.bottlenecks || []).filter(item => item.trim());
  const showResponseSummary = !!response?.summary.trim() && !(response?.tasks?.length === 1
    && [response.tasks[0].title, response.tasks[0].note].some(text => normalizedProposalText(text) === normalizedProposalText(response.summary)));

  const requestAlternativePlan = (source: AIRequest, previousResponse: AIResponse) => {
    if (requestInFlight.current || awaitingKeyRef.current) return;
    const previousPlan = JSON.stringify({
      summary: previousResponse.summary,
      reply: previousResponse.reply,
      tasks: previousResponse.tasks || [],
      taskUpdates: previousResponse.taskUpdates || [],
      insights: previousResponse.insights || [],
    });
    const alternativePrompt = lang === 'uk'
      ? `Початковий запит:\n${source.text}\n\nПопередня незастосована пропозиція, лише для порівняння:\n${previousPlan}\n\nЗапропонуй інший варіант планування того самого завдання або робочої мети. Зміни підхід, послідовність чи групування кроків; не повторюй попередній план іншими словами. Збережи вимоги початкового запиту й налаштування таймера. Для наявного завдання запропонуй оновлення за його точним id, не створюй дублікат. Попередня пропозиція ще не застосована — підготуй одну нову альтернативу, без застосування старих дій.`
      : `Original request:\n${source.text}\n\nPrevious unapplied proposal, for comparison only:\n${previousPlan}\n\nSuggest an alternative plan for the same task or work goal. Change the approach, sequence, or grouping of steps instead of rephrasing the previous plan. Keep the original requirements and timer settings. For an existing task, propose an update using its exact id instead of creating a duplicate. The previous proposal has not been applied: prepare one new alternative without applying previous actions.`;
    void handleGenerate(alternativePrompt, source.mode, false, true, source, true);
  };

  const handleAlternativePlan = () => {
    if (!response || !responseRequest || hasAppliedResponseActions) return;
    requestAlternativePlan(responseRequest, response);
  };

  const changePrompt = (value: string) => {
    voiceDraftRef.current?.edit(value);
    if (!awaitingKeyRef.current && preservedRequestDraftRef.current !== null) preservedRequestDraftRef.current = value;
    setPrompt(value);
  };
  const composerKeyDown = (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      if (prompt.trim() && !requestInFlight.current && !isTranscribing) void handleGenerate();
    }
  };
  const insertEmoji = (emoji: string) => {
    if (awaitingKeyRef.current) return;
    const field = promptInputRef.current;
    const start = field?.selectionStart ?? prompt.length;
    const end = field?.selectionEnd ?? start;
    changePrompt(`${prompt.slice(0, start)}${emoji}${prompt.slice(end)}`);
    requestAnimationFrame(() => {
      if (promptInputRef.current !== field || !field?.isConnected) return;
      field.focus();
      field.setSelectionRange(start + emoji.length, start + emoji.length);
    });
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
            className="relative z-10 w-full max-w-2xl bg-[#0c0c0e] border-t border-x border-neutral-800 max-h-[88dvh] flex flex-col shadow-2xl font-sans"
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
                <span className="min-w-0 break-words text-xs sm:text-sm font-bold uppercase tracking-wider font-sans text-white">
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
                className={`min-h-11 min-w-0 py-1.5 px-2 text-xs font-sans font-bold tracking-normal sm:tracking-wider uppercase border transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
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
                aria-label={t.aiSheet.modes.breakdown}
                title={t.aiSheet.modes.breakdown}
                aria-pressed={mode === 'breakdown'}
                type="button"
                disabled={loading}
                onClick={() => {
                  sound.tick(500);
                  setMode('breakdown');
                }}
                className={`min-h-11 min-w-0 py-1.5 px-2 text-xs font-sans font-bold tracking-normal sm:tracking-wider uppercase border transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  mode === 'breakdown'
                    ? 'bg-white text-black border-white'
                    : 'bg-[#08080a] text-neutral-400 border-neutral-800 hover:text-white hover:border-neutral-700'
                }`}
              >
                <Workflow aria-hidden="true" className="w-4 h-4 shrink-0" strokeWidth={1.75} />
                <span className="min-w-0 whitespace-normal break-words leading-snug">{lang === 'uk' ? 'Підзавдання' : 'Subtasks'}</span>
              </button>

              <button
                id="ai-mode-analyze-btn"
                aria-label={t.aiSheet.modes.analyze}
                title={t.aiSheet.modes.analyze}
                aria-pressed={mode === 'analyze'}
                type="button"
                disabled={loading}
                onClick={() => {
                  sound.tick(550);
                  setMode('analyze');
                  handleGenerate(prompt, 'analyze');
                }}
                className={`min-h-11 min-w-0 py-1.5 px-2 text-xs font-sans font-bold tracking-normal sm:tracking-wider uppercase border transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  mode === 'analyze'
                    ? 'bg-white text-black border-white'
                    : 'bg-[#08080a] text-neutral-400 border-neutral-800 hover:text-white hover:border-neutral-700'
                }`}
              >
                <ChartNoAxesCombined aria-hidden="true" className="w-4 h-4 shrink-0" strokeWidth={1.75} />
                <span className="min-w-0 whitespace-normal break-words leading-snug">{lang === 'uk' ? 'Аналіз і підказки' : 'Analysis'}</span>
              </button>

              <button
                id="ai-mode-generate-btn"
                aria-label={t.aiSheet.modes.generate}
                title={t.aiSheet.modes.generate}
                aria-pressed={mode === 'generate'}
                type="button"
                disabled={loading}
                onClick={() => {
                  sound.tick(600);
                  setMode('generate');
                }}
                className={`min-h-11 min-w-0 py-1.5 px-2 text-xs font-sans font-bold tracking-normal sm:tracking-wider uppercase border transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  mode === 'generate'
                    ? 'bg-white text-black border-white'
                    : 'bg-[#08080a] text-neutral-400 border-neutral-800 hover:text-white hover:border-neutral-700'
                }`}
              >
                <ClipboardList aria-hidden="true" className="w-4 h-4 shrink-0" strokeWidth={1.75} />
                <span className="min-w-0 whitespace-normal break-words leading-snug">{lang === 'uk' ? 'План' : 'Plan'}</span>
              </button>
            </div>

            {/* Content Container (Scrollable) */}
            <div ref={contentRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-5 flex flex-col gap-4">
              {/* Presets Chips */}
              {mode !== 'chat' && !showStructuredResponse && !loading && <div>
                {mode !== 'chat' && <p className="mb-3 text-base leading-[1.6] text-neutral-300">
                  {mode === 'breakdown' ? (lang === 'uk' ? 'Вкажіть завдання — AI запропонує послідовність підзавдань.' : 'Describe a task and AI will suggest a sequence of subtasks.')
                    : mode === 'analyze' ? (lang === 'uk' ? 'AI перегляне поточні завдання та підкаже, що допоможе рухатися далі.' : 'AI will review your current tasks and suggest ways to move forward.')
                    : (lang === 'uk' ? 'Опишіть мету — AI запропонує завдання й порядок роботи.' : 'Describe your goal and AI will suggest tasks and a working order.')}
                </p>}
                {mode === 'generate' && <><div className="text-sm font-sans font-semibold text-neutral-400 mb-2">
                  {lang === 'uk' ? 'Приклади запитів' : 'Example requests'}
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
                      className="min-h-11 text-sm leading-relaxed font-sans text-left px-3 py-2 bg-[#08080a] border border-neutral-800 text-neutral-300 hover:border-neutral-600 hover:text-white disabled:opacity-40 transition-colors cursor-pointer"
                    >
                      + {preset}
                    </button>
                  ))}
                </div></>}
              </div>}

              {/* Chat View */}
              {mode === 'chat' && chatMessages.length > 0 && (
                <div role="log" aria-label={lang === 'uk' ? 'Розмова з AI' : 'AI conversation'} aria-live="polite" aria-relevant="additions text" className="karkas-ai-conversation">
                  {chatMessages.map((message, index) => (
                    <div
                      key={`${message.role}-${index}`}
                      className={`karkas-ai-message ${
                        message.role === 'user'
                          ? 'is-user'
                          : 'is-assistant'
                      }`}
                    >
                      <div className="karkas-ai-message-author">
                        {message.role === 'user' ? (lang === 'uk' ? 'ВИ' : 'YOU') : 'KARKAS AI'}
                      </div>
                      {(() => {
                        const isCurrentPlanningReply = message.role === 'assistant' && chatPlanningResponse
                          && message.content === (chatPlanningResponse.reply || chatPlanningResponse.summary);
                        if (isCurrentPlanningReply) return pendingChangeCount > 0
                          ? <details><summary className="min-h-11 py-2 cursor-pointer text-neutral-300">{lang === 'uk' ? 'Пояснення AI' : 'AI explanation'}</summary><div className="pt-2"><AIChatText text={message.content} /></div></details>
                          : <AIChatText text={message.content} />;
                        const parsed = message.role === 'assistant' ? parseChatOptions(message.content) : { body: message.content, options: [] };
                        return (
                          <>
                            {message.role === 'assistant' ? <AIChatText text={parsed.body} /> : <div className="whitespace-pre-wrap">{parsed.body}</div>}
                            {parsed.options.length > 0 && (
                              <div className="flex flex-col gap-1.5 mt-3">
                                {parsed.options.map((option) => (
                                  <button
                                    key={`${index}-${option.label}-${option.text}`}
                                    type="button"
                                    disabled={loading}
                                    onClick={() => handleGenerate(option.text)}
                                    className="min-h-11 w-full text-left border border-neutral-700 bg-[#08080a] px-3 py-2 text-base leading-[1.6] text-neutral-200 hover:border-white hover:text-white disabled:opacity-40 transition-colors cursor-pointer"
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
                  {chatProposalReady && pendingChangeCount > 0 && !loading && !requestError && (
                    <div className="border border-emerald-800/80 bg-[#0a120c] p-3 space-y-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="text-sm font-semibold text-neutral-200 flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                          <span>{lang === 'uk' ? 'Запропоновані зміни' : 'Proposed changes'}</span>
                        </span>
                      </div>

                      {/* Pending Tabs */}
                      {pendingChatTabs.length > 0 && (
                        <div className="space-y-1">
                          <div className="text-sm font-semibold text-neutral-400 flex items-center gap-2">
                            <FolderPlus className="w-4 h-4 text-sky-400" aria-hidden="true" />
                            <span>{lang === 'uk' ? 'Нові категорії' : 'New categories'}</span>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {pendingChatTabs.map((tb) => (
                              <span key={tb.id} className="text-sm bg-sky-950/40 border border-sky-800 text-sky-300 px-2 py-1">
                                {tb.name}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Pending Tasks */}
                      {pendingChatTasks.length > 0 && (
                        <div className="space-y-1.5">
                          <div className="text-sm font-semibold text-neutral-400 flex items-center gap-2">
                            <Plus className="w-4 h-4 text-emerald-400" aria-hidden="true" />
                            <span>{lang === 'uk' ? 'Нові завдання' : 'New tasks'}</span>
                          </div>
                          <div className="space-y-1">
                            {pendingChatTasks.map((task, idx) => (
                              <div key={idx} className="bg-black/60 border border-neutral-800 p-3 space-y-2 text-base leading-[1.6]">
                                <div className="flex items-center gap-2 flex-wrap text-sm text-neutral-400">
                                  <span className="text-emerald-400 font-semibold">P{task.priority}</span>
                                  <span>{(t.phases as any)[task.phase] || tabs.find(tab => tab.id === task.phase)?.name || task.phase}</span>
                                </div>
                                <p className="font-semibold text-neutral-100 break-words">{task.title}</p>
                                {task.note && normalizedProposalText(task.note) !== normalizedProposalText(task.title) && <p className="text-neutral-300 whitespace-pre-wrap break-words">{task.note}</p>}
                                <TimerProposal settings={task} lang={lang} />
                                {!!task.stepList?.length && <div className="space-y-2">
                                  <p className="text-sm font-semibold text-neutral-400">{lang === 'uk' ? 'Підзавдання' : 'Subtasks'} ({task.stepList.length})</p>
                                  <ProposalSteps steps={task.stepList} lang={lang} />
                                </div>}
                                {!task.stepList?.length && task.steps > 0 && <p className="text-sm text-neutral-400">{lang === 'uk' ? 'Підзавдання' : 'Subtasks'}: {task.steps}</p>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {pendingChatDeletions.length > 0 && (
                        <div className="space-y-2 text-base leading-[1.6] text-red-300">
                          <div className="text-sm font-semibold">{lang === 'uk' ? 'Видалення завдань' : 'Tasks to delete'}</div>
                          {pendingChatDeletions.map(deletion => <div key={deletion.id}>
                            {currentTasks.find(task => task.id === deletion.id)?.title || deletion.id}
                            <div className="text-sm leading-relaxed text-neutral-400">{deletionReasonLabel(deletion.deletionReason, lang)}</div>
                          </div>)}
                        </div>
                      )}

                      {/* Pending Updates / Edits */}
                      {pendingChatUpdates.length > 0 && (
                        <div className="space-y-1.5">
                          <div className="text-sm font-semibold text-neutral-400 flex items-center gap-2">
                            <Edit3 className="w-4 h-4 text-amber-400" aria-hidden="true" />
                            <span>{lang === 'uk' ? 'Оновлення завдань' : 'Task updates'}</span>
                          </div>
                          <div className="space-y-1">
                            {pendingChatUpdates.map((u, idx) => {
                              const existing = currentTasks.find((ct) => ct.id === u.id);
                              return (
                                <div key={idx} className="bg-black/60 border border-neutral-800 p-3">
                                  <TaskUpdatePreview update={u} existing={existing} tabs={tabs} lang={lang} />
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      <button
                        id="ai-chat-apply-changes-btn"
                        type="button"
                        onClick={confirmChatChanges}
                        className="inline-flex min-h-11 items-center justify-center gap-2 border border-white bg-white hover:bg-neutral-200 text-black px-3 py-2 text-sm font-semibold transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                      >
                        <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                        {lang === 'uk' ? `Застосувати зміни (${pendingChangeCount})` : `Apply changes (${pendingChangeCount})`}
                      </button>
                    </div>
                  )}
                  {chatPlanningRequest && chatPlanningResponse && (pendingChangeCount === 0 || chatProposalReady) && !pendingChatConfirmed.current && !loading && !requestError && !awaitingApiKey && <button
                    id="ai-chat-alternative-plan-btn"
                    type="button"
                    onClick={() => {
                      if (pendingChangeCount > 0 && !chatProposalReadyRef.current) return;
                      requestAlternativePlan(chatPlanningRequest, chatPlanningResponse);
                    }}
                    className="self-start inline-flex min-h-11 items-center justify-center gap-2 border border-neutral-700 bg-[#08080a] px-3 py-2 text-sm font-semibold text-neutral-200 hover:border-white hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                  >
                    <RefreshCw className="w-4 h-4" aria-hidden="true" />
                    {lang === 'uk' ? 'Інший варіант планування' : 'Alternative plan'}
                  </button>}
                </div>
              )}

              {keyStatus && (
                <div role="status" aria-live="polite" className="border border-neutral-800 bg-[#111116] p-3 text-[15px] leading-[1.6] text-neutral-200 whitespace-pre-wrap">
                  <div className="mb-1 text-[9px] font-bold uppercase tracking-widest opacity-60">KARKAS AI</div>
                  {keyStatus}
                  {awaitingApiKey && <button id="ai-return-to-request-btn" type="button" onClick={returnToRequest} className="mt-3 min-h-11 block border border-neutral-700 px-3 py-2 hover:border-white">
                    {lang === 'uk' ? 'Повернутися до запиту' : 'Return to request'}
                  </button>}
                </div>
              )}

              {requestError && !awaitingApiKey && (
                <div id="ai-request-error" role="alert" className="border border-neutral-700 bg-[#111116] p-3 text-[15px] leading-[1.6] text-neutral-200">
                  <p>{requestError}</p>
                  {recoverableRequest && <button id="ai-retry-request-btn" type="button" disabled={loading} onClick={() => { setMode(recoverableRequest.mode); void handleGenerate(recoverableRequest.text, recoverableRequest.mode, false, !!prompt.trim() && prompt.trim() !== recoverableRequest.text.trim()); }} className="mt-3 min-h-11 border border-neutral-700 px-3 py-2 hover:border-white disabled:opacity-40">
                    {lang === 'uk' ? 'Повторити запит' : 'Retry request'}
                  </button>}
                </div>
              )}

              {applyNotice && <div role="status" aria-live="polite" className="border border-neutral-800 bg-[#111116] p-3 text-[15px] leading-[1.6] text-neutral-200">{applyNotice}</div>}

              {loading && (
                <div role="status" aria-live="polite" className="p-8 border border-neutral-800 bg-black/40 flex flex-col items-center justify-center gap-3 text-center">
                  <div className="w-6 h-6 border-2 border-white border-t-transparent animate-spin rounded-full" />
                  <span className="text-xs font-sans tracking-widest text-neutral-300 uppercase animate-pulse">
                    {mode === 'chat'
                      ? (lang === 'uk' ? 'KARKAS AI ФОРМУЄ ВІДПОВІДЬ...' : 'KARKAS AI IS RESPONDING...')
                      : t.aiSheet.thinking}
                  </span>
                  <span className="text-[10px] font-sans text-neutral-500">
                    {t.aiSheet.fullContextDesc}
                  </span>
                  <button id="ai-request-cancel-btn" type="button" onClick={cancelAIRequest} className="min-h-11 border border-neutral-700 px-3 py-2 text-xs text-neutral-300 hover:border-white hover:text-white">
                    {lang === 'uk' ? 'Скасувати запит' : 'Cancel request'}
                  </button>
                </div>
              )}

              {/* Structured Response Section */}
              {response && showStructuredResponse && !loading && (
                <div className="border border-neutral-800 bg-[#0d0d10] p-4 flex flex-col gap-4">
                  {/* Strategy Summary & Inject All */}
                  <div className="flex flex-col gap-3 border-b border-neutral-800 pb-3">
                    <div className="space-y-2 min-w-0">
                      <div className="text-sm font-sans font-semibold text-neutral-100 flex items-center gap-2">
                        <AIIcon className="w-4 h-4" />
                        <span>{responseMode === 'analyze' ? (lang === 'uk' ? 'Аналіз роботи' : 'Workflow analysis')
                          : responseMode === 'breakdown' ? (lang === 'uk' ? 'Підзавдання' : 'Subtasks') : (lang === 'uk' ? 'План дій' : 'Action plan')}</span>
                      </div>
                      {showResponseSummary && <p className="text-base text-neutral-300 leading-[1.6] break-words whitespace-pre-wrap">
                        {response.summary}
                      </p>}
                      {response.source === 'local-fallback' && (
                        <p role="status" className="text-xs text-amber-300">
                          {lang === 'uk' ? 'Локальні рекомендації: ШІ-запит не завершився.' : 'Local recommendations: the AI request did not complete.'}
                        </p>
                      )}
                    </div>

                    {!canApplyResponse && remainingResponseActions > 0 && <p className="text-sm leading-relaxed text-neutral-400">
                      {lang === 'uk' ? 'Попередня пропозиція доступна для перегляду. Щоб застосувати зміни, повторіть останній запит.' : 'The previous proposal is available for review. Retry the latest request before applying changes.'}
                    </p>}
                    {hasPlanningProposal && <div className="flex flex-wrap items-center gap-2">
                    <button
                      id="ai-alternative-plan-btn"
                      type="button"
                      disabled={loading || awaitingApiKey || hasAppliedResponseActions}
                      onClick={handleAlternativePlan}
                      title={hasAppliedResponseActions ? (lang === 'uk' ? 'Частину пропозиції вже застосовано. Для нового плану напишіть новий запит.' : 'Part of this proposal has already been applied. Start a new request for another plan.') : undefined}
                      className="inline-flex min-h-11 items-center justify-center gap-2 border border-neutral-600 px-3 py-2 text-sm font-semibold text-neutral-100 transition-colors hover:border-white hover:bg-neutral-900 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
                      <RefreshCw className="h-4 w-4" aria-hidden="true" />
                      {lang === 'uk' ? 'Інший варіант планування' : 'Alternative plan'}
                    </button>
                    </div>}
                  </div>

                  {/* Workload Diagnosis (in Analyze mode or when provided) */}
                  {response.workloadDiagnosis && (response.workloadDiagnosis.status || displayedBottlenecks.length > 0) && (
                    <div className="bg-[#101015] border border-neutral-800 p-3.5 space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-sans font-semibold text-neutral-300 flex items-center gap-2">
                          <Activity className="w-3.5 h-3.5 text-indigo-400" />
                          <span>{lang === 'uk' ? 'Навантаження' : 'Workload'}</span>
                        </span>
                        {response.workloadDiagnosis.status && (
                          <span className="text-sm leading-relaxed font-semibold px-2 py-0.5 bg-indigo-950/60 border border-indigo-700 text-indigo-300 break-words">
                            {response.workloadDiagnosis.status}
                          </span>
                        )}
                      </div>

                      {displayedBottlenecks.length > 0 && (
                        <div className="space-y-1">
                          <div className="text-sm text-amber-300 flex items-center gap-2 font-semibold">
                            <AlertTriangle className="w-3 h-3" />
                            <span>{lang === 'uk' ? 'Що заважає' : 'What gets in the way'}</span>
                          </div>
                          <ul className="space-y-1 pl-1">
                            {displayedBottlenecks.map((b, idx) => (
                              <li key={idx} className="text-base leading-[1.6] text-neutral-300 flex items-start gap-2">
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
                      <div className="text-sm font-sans font-semibold text-neutral-300 flex items-center gap-2">
                        <ClipboardList aria-hidden="true" className="w-4 h-4 text-neutral-300" strokeWidth={1.75} />
                        <span>{lang === 'uk' ? 'Категорії' : 'Categories'}</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {response.categoryHealth.map((ch, idx) => (
                          <div key={idx} className="p-2.5 bg-black/60 border border-neutral-800 space-y-1">
                            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                              <span className="font-bold text-neutral-200">{ch.phaseName}</span>
                              <span className={`text-xs font-semibold px-1.5 py-0.5 border ${
                                ch.status === 'overloaded'
                                  ? 'border-red-800 text-red-400 bg-red-950/30'
                                  : ch.status === 'stagnant'
                                  ? 'border-amber-800 text-amber-400 bg-amber-950/30'
                                  : 'border-emerald-800 text-emerald-400 bg-emerald-950/30'
                              }`}>
                                {lang === 'uk' ? ({ balanced: 'Баланс', overloaded: 'Перевантажено', empty: 'Порожньо', stagnant: 'Без прогресу' }[ch.status] || ch.status) : ch.status} ({ch.taskCount})
                              </span>
                            </div>
                            {ch.recommendation && (
                              <p className="text-base text-neutral-300 leading-[1.6] break-words">
                                {ch.recommendation}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Tactical Insights */}
                  {displayedInsights.length > 0 && (
                    <div className="bg-[#121216] border border-neutral-800 p-3 space-y-2">
                      <div className="text-sm font-sans text-neutral-300 font-semibold flex items-center gap-2">
                        <Lightbulb className="w-3.5 h-3.5 text-amber-400" />
                        <span>{lang === 'uk' ? 'Підказки' : 'Suggestions'}</span>
                      </div>
                      <ul className="space-y-1.5">
                        {displayedInsights.map((insight, idx) => (
                          <li key={idx} className="text-base leading-[1.6] font-sans text-neutral-300 flex items-start gap-2">
                            <span className="text-white font-bold shrink-0">›</span>
                            <span>{insight}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Proposed Tabs */}
                  {response.tabs && response.tabs.length > 0 && (
                    <div className="border border-sky-900/70 bg-sky-950/20 p-3 text-sm font-sans text-sky-200 space-y-2">
                      <span className="text-sm font-semibold text-sky-300 flex items-center gap-2">
                        <FolderPlus className="w-3.5 h-3.5" />
                        <span>{lang === 'uk' ? 'Нові категорії' : 'New categories'}</span>
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
                    <div className="space-y-2 text-base leading-[1.6] text-red-300">
                      <div className="text-sm font-semibold">{lang === 'uk' ? 'Прибрати завдання' : 'Remove tasks'}</div>
                      {response.taskDeletions.map(deletion => <div key={deletion.id}>
                        {currentTasks.find(task => task.id === deletion.id)?.title || deletion.id}
                        <div className="text-sm leading-relaxed text-neutral-400">{deletionReasonLabel(deletion.deletionReason, lang)}</div>
                      </div>)}
                    </div>
                  )}

                  {/* Proposed Task Edits / Updates */}
                  {response.taskUpdates && response.taskUpdates.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-sm font-sans font-semibold text-neutral-300 flex items-center gap-2">
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>{lang === 'uk' ? 'Оновлення завдань' : 'Task updates'}</span>
                      </div>
                      <div className="flex flex-col gap-2">
                        {response.taskUpdates.map((up) => {
                          const existing = currentTasks.find((ct) => ct.id === up.id);
                          const isApplied = appliedUpdateIds.includes(up.id);
                          return (
                            <div key={up.id} className="p-3 bg-black border border-neutral-800 flex flex-col items-start gap-3">
                              <TaskUpdatePreview update={up} existing={existing} tabs={tabs} lang={lang} />
                              <button
                                type="button"
                                onClick={() => handleApplySingleUpdate(up)}
                                disabled={!canApplyResponse || isApplied}
                                className={`min-h-11 px-3 py-2 text-sm font-semibold border shrink-0 transition-colors inline-flex items-center justify-center gap-2 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
                                  isApplied
                                    ? 'border-emerald-700 text-emerald-400 bg-emerald-950/40'
                                    : 'border-amber-700 text-amber-300 hover:border-white hover:text-white bg-amber-950/30'
                                }`}
                              >
                                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                                {isApplied ? (lang === 'uk' ? 'Опрацьовано' : 'Processed') : (lang === 'uk' ? 'Оновити завдання' : 'Update task')}
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
                      <div className="text-sm font-sans font-semibold text-neutral-300">
                        {lang === 'uk' ? 'Нові завдання' : 'New tasks'} ({response.tasks.length})
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
                            <div className="flex flex-col gap-3">
                              <div className="flex min-w-0 flex-col gap-2">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-sm font-sans text-neutral-400 font-semibold flex items-center gap-1">
                                    {matchedTab?.color && (
                                      <span
                                        className="w-1.5 h-1.5 rounded-full shrink-0 shadow-sm"
                                        style={{ backgroundColor: matchedTab.color }}
                                      />
                                    )}
                                    [{phaseLabel}]
                                  </span>
                                  <span
                                    className={`text-sm font-sans font-semibold px-1.5 py-0.5 border ${
                                      task.priority === 1
                                        ? 'border-red-900/70 text-red-400 bg-red-950/30'
                                        : task.priority === 2
                                        ? 'border-amber-900/70 text-amber-400 bg-amber-950/30'
                                        : 'border-emerald-900/70 text-emerald-400 bg-emerald-950/30'
                                    }`}
                                  >
                                    P{task.priority}
                                  </span>
                                  <span className="w-full text-base leading-[1.6] font-semibold text-neutral-100 break-words">
                                    {task.title}
                                  </span>
                                </div>
                                {task.note && normalizedProposalText(task.note) !== normalizedProposalText(task.title) && (
                                  <span className="text-base leading-[1.6] font-sans text-neutral-300 whitespace-pre-wrap break-words">
                                    {task.note}
                                  </span>
                                )}
                                <TimerProposal settings={task} lang={lang} />
                              </div>

                            </div>

                            {/* Sub-steps preview */}
                            {subSteps.length > 0 && (
                              <div className="pt-2 border-t border-neutral-900/80 space-y-2">
                                <div className="text-sm font-sans text-neutral-400 font-semibold">
                                  {lang === 'uk' ? 'Підзавдання' : 'Subtasks'} ({subSteps.length})
                                </div>
                                <ProposalSteps steps={subSteps} lang={lang} />
                              </div>
                            )}
                            <button
                              id={`ai-inject-single-btn-${i}`}
                              onClick={() => handleInjectSingle(task, i)}
                              type="button"
                              disabled={!canApplyResponse || isInjected}
                              className={`self-start inline-flex min-h-11 items-center justify-center gap-2 px-3 py-2 text-sm font-sans font-semibold border transition-colors shrink-0 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
                                isInjected
                                  ? 'border-emerald-700 text-emerald-400 bg-emerald-950/40'
                                  : 'border-neutral-700 text-neutral-300 hover:border-white hover:text-white bg-neutral-900'
                              }`}
                            >
                              <Plus className="h-4 w-4" aria-hidden="true" />
                              {isInjected ? (responsePartlyRejected ? (lang === 'uk' ? 'Опрацьовано' : 'Processed') : t.aiSheet.added) : (lang === 'uk' ? 'Додати завдання' : 'Add task')}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {(responseActionCount > 1 || !!response.tabs?.length || !!response.taskDeletions?.length) && <button
                    id="ai-inject-all-btn"
                    type="button"
                    disabled={!canApplyResponse || remainingResponseActions === 0}
                    onClick={handleInjectAll}
                    className="self-start min-h-11 px-3 py-2 bg-white text-black font-semibold text-sm font-sans hover:bg-neutral-200 transition-colors inline-flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-default focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                  >
                    <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                    <span>{remainingResponseActions === 0 ? (lang === 'uk' ? 'Опрацьовано' : 'Processed')
                      : `${lang === 'uk' ? 'Застосувати зміни' : 'Apply changes'} (${remainingResponseActions})`}</span>
                  </button>}
                </div>
              )}
            </div>

            {/* Custom Prompt Input at the bottom of the sheet */}
            <div className="shrink-0 px-4 sm:px-5 py-3 bg-[#08080a] border-t border-neutral-800 space-y-2">
              {/* Voice recording / transcription status indicator */}
              {voiceNotice && <div role="status" className="flex items-center gap-2 text-amber-400 text-xs">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span className="flex-1">{voiceNotice}</span>
                <button type="button" onClick={() => setVoiceNotice(null)} aria-label={lang === 'uk' ? 'Приховати повідомлення' : 'Dismiss message'} className="min-w-11 min-h-11 flex items-center justify-center text-neutral-400 hover:text-white"><X className="w-4 h-4" /></button>
              </div>}
              {(isListening || isTranscribing) && (
                <div className="flex items-center justify-between px-3 py-1.5 bg-[#050507] border border-neutral-800 text-xs font-sans">
                  {isTranscribing ? (
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
                        <span className="text-[10px] text-neutral-400 font-sans">
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

              {voiceReviewText && <details className="mb-3 text-sm text-neutral-300">
                <summary className="cursor-pointer min-h-11 flex items-center">{lang === 'uk' ? 'Переглянути розпізнаний текст' : 'Review recognized text'}</summary>
                <p className="whitespace-pre-wrap break-words max-h-32 overflow-auto py-2 select-text">{voiceReviewText}</p>
              </details>}
              <div className="karkas-ai-composer">
                {awaitingApiKey ? <input
                  id="ai-prompt-input"
                  type="password"
                  autoComplete="off"
                  aria-label={lang === 'uk' ? 'Gemini API-ключ' : 'Gemini API key'}
                  value={prompt}
                  onChange={event => changePrompt(event.target.value)}
                  onKeyDown={composerKeyDown}
                  placeholder={lang === 'uk' ? 'Вставте Gemini API-ключ сюди…' : 'Paste your Gemini API key here…'}
                  className="karkas-ai-composer-field"
                /> : <textarea
                  ref={promptInputRef}
                  id="ai-prompt-input"
                  rows={1}
                  aria-label={t.aiSheet.inputPlaceholder}
                  aria-describedby="ai-composer-hint"
                  value={prompt}
                  onChange={event => changePrompt(event.target.value)}
                  onKeyDown={composerKeyDown}
                  placeholder={lang === 'uk' ? 'Напишіть повідомлення…' : 'Write a message…'}
                  className="karkas-ai-composer-field"
                />}
                <div className="karkas-ai-composer-toolbar">
                <AIModelSelect
                  key={accountId || 'guest'}
                  models={availableModels}
                  label={lang === 'uk' ? 'Модель AI' : 'AI model'}
                  emptyLabel={lang === 'uk' ? 'Модель не налаштована' : 'Model not configured'}
                  value={customModel}
                  disabled={loading || availableModels.length === 0}
                  onChange={(model) => {
                    chooseCustomModel(model);
                    try { localStorage.setItem('karkas_custom_model', model); }
                    catch { setKeyStatus(lang === 'uk' ? 'Вибір моделі діє зараз, але його не вдалося зберегти на пристрої.' : 'This model is selected for now, but could not be saved on this device.'); }
                    if (window.karkasDesktop) {
                      void window.karkasDesktop.preferences.update({ karkas_custom_model: model }).then(result => {
                        if ('error' in result) setKeyStatus(lang === 'uk' ? 'Не вдалося зберегти вибір моделі. Вона діє для поточного запиту; виберіть її знову після перезапуску.' : 'Could not save the model selection. It applies to this session; select it again after restarting.');
                      }).catch(() => setKeyStatus(lang === 'uk' ? 'Не вдалося зберегти вибір моделі. Спробуйте вибрати її ще раз.' : 'Could not save the model selection. Try selecting it again.'));
                    }
                    sound.tick(400);
                  }}
                />

                <div className="flex-1" />
                  <AIEmojiPicker key={accountId || 'guest'} lang={lang} disabled={awaitingApiKey} onChoose={insertEmoji} />
                  {prompt && <button
                    type="button"
                    onClick={() => { changePrompt(''); document.getElementById('ai-prompt-input')?.focus(); }}
                    aria-label={lang === 'uk' ? 'Очистити введений текст' : 'Clear entered text'}
                    title={lang === 'uk' ? 'Очистити текст' : 'Clear text'}
                    className="min-w-11 min-h-11 flex items-center justify-center text-neutral-400 hover:text-white"
                  ><X className="w-4 h-4" /></button>}
                  <button
                    id="ai-voice-dictation-btn"
                    type="button"
                    onClick={handleToggleVoiceInput}
                    disabled={loading || awaitingApiKey || isTranscribing}
                    title={isListening ? t.aiSheet.voiceStop : t.aiSheet.voiceInput}
                    aria-label={isListening ? t.aiSheet.voiceStop : t.aiSheet.voiceInput}
                    className={`min-w-11 min-h-11 flex items-center justify-center rounded transition-all cursor-pointer ${
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
                <button
                  id="ai-generate-submit-btn"
                  type="button"
                  onClick={() => handleGenerate()}
                  disabled={loading || isTranscribing || !prompt.trim()}
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
              {!awaitingApiKey && <p id="ai-composer-hint" className="mt-2 text-xs text-neutral-500">{lang === 'uk' ? 'Enter — надіслати · Shift + Enter — новий рядок. Голосовий текст можна редагувати під час запису.' : 'Enter to send · Shift + Enter for a new line. Edit dictated text while recording.'}</p>}
            </div>

            {/* Bottom Footer Hint */}
            <div className="shrink-0 px-4 sm:px-5 py-2.5 bg-black border-t border-neutral-800 flex flex-wrap items-center justify-between gap-2 text-[10px] font-sans text-neutral-400">
              <span>{t.aiSheet.dismissHint}</span>
              <span>{t.aiSheet.footerTag}</span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
