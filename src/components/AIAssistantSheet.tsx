import React, { useState, useEffect, useRef } from 'react';
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
  PersonalStrategyProfile,
  AIIntent,
} from '../types';
import { sound } from '../utils/audio';
import { createVoiceDictation, type VoicePhase } from '../utils/voiceDictation';
import { createVoiceDraft } from '../utils/voiceDraft';
import { AIModelSelect } from './AIModelSelect';
import { AIEmojiPicker } from './AIEmojiPicker';
import { AIChatText } from './AIChatText';
import { Language, TRANSLATIONS } from '../utils/i18n';
import {
  X,
  AlertTriangle,
  Mic,
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
import { loadAIChatHistory, saveAIChatHistory, ensureAIChatWelcome, recentAIChatContext, visibleAIChatMessages } from '../services/chatHistory';
import type { PersistedAIChatMessage } from '../services/chatHistory';
import { AICommandMenu } from './AICommandMenu';
import { proposalTargetsUnchanged } from './aiProposalGuard';
import { AI_COMMANDS, intentMode, migrateAIComposer, modeIntent, parseAICommand } from './aiCommands';
import { strategyGreeting } from '../utils/personalStrategy';
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
  strategyProfile?: PersonalStrategyProfile;
  onStrategyResponse?: (response: AIResponse, userText: string, turnId: string, intent: AIIntent, ownerId: string | null, requestProfile?: PersonalStrategyProfile) => void | { notice?: string; actionId?: string };
  onChatWelcome?: (ownerId: string | null) => void;
  onUndoStrategy?: (actionId: string) => boolean;
}

type AIChatMessage = PersistedAIChatMessage;

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

const ChatResponseCards: React.FC<{ response: AIResponse; currentTasks: PSTask[]; tabs: TaskTab[]; lang: Language }> = ({ response, currentTasks, tabs, lang }) => {
  const diagnosis = response.workloadDiagnosis;
  const insights = [...new Set<string>(response.insights || [])].filter(text => normalizedProposalText(text) !== normalizedProposalText(response.reply || response.summary));
  return <div className="mt-3 space-y-3">
    {response.summary && normalizedProposalText(response.summary) !== normalizedProposalText(response.reply || response.summary) && <AIChatText text={response.summary} />}
    {!!insights.length && <ul className="list-disc pl-5 space-y-2">{insights.map(text => <li key={text}><AIChatText text={text} /></li>)}</ul>}
    {diagnosis && <div className="border border-neutral-700 p-3 space-y-2">
      {diagnosis.status && <AIChatText text={diagnosis.status} />}
      {!!diagnosis.bottlenecks?.length && <div><p className="text-sm text-amber-300">{lang === 'uk' ? 'Що заважає' : 'Bottlenecks'}</p>{diagnosis.bottlenecks.map(text => <p key={text}>{text}</p>)}</div>}
      {!!diagnosis.strengths?.length && <div><p className="text-sm text-emerald-300">{lang === 'uk' ? 'Що допомагає' : 'Strengths'}</p>{diagnosis.strengths.map(text => <p key={text}>{text}</p>)}</div>}
    </div>}
    {!!response.categoryHealth?.length && <div className="space-y-2">{response.categoryHealth.map((item, index) => <div key={index} className="border border-neutral-700 p-3"><p className="font-semibold">{item.phaseName || tabs.find(tab => tab.id === item.phase)?.name || item.phase}</p><p>{item.status}</p><p>{item.recommendation}</p></div>)}</div>}
    {!!response.tabs?.length && <div className="flex flex-wrap gap-2">{response.tabs.map(tab => <span key={tab.id} className="border border-sky-800 px-2 py-1 text-sm text-sky-300">{tab.name}</span>)}</div>}
    {response.tasks?.map((task, index) => <div key={`task-${index}`} className="border border-neutral-700 bg-black/40 p-3 space-y-2">
      <p className="text-sm text-emerald-300">{lang === 'uk' ? 'Нове завдання' : 'New task'} · P{task.priority}</p><p className="font-semibold">{task.title}</p>
      {task.note && normalizedProposalText(task.note) !== normalizedProposalText(task.title) && <AIChatText text={task.note} />}
      <TimerProposal settings={task} lang={lang} />
      {!!task.stepList?.length && <ProposalSteps steps={task.stepList} lang={lang} />}
      {!task.stepList?.length && task.steps > 0 && <p className="text-sm text-neutral-400">{lang === 'uk' ? 'Підзавдання' : 'Subtasks'}: {task.steps}</p>}
    </div>)}
    {response.taskUpdates?.map(update => <div key={update.id} className="border border-neutral-700 bg-black/40 p-3"><TaskUpdatePreview update={update} existing={currentTasks.find(task => task.id === update.id)} tabs={tabs} lang={lang} /></div>)}
    {response.taskDeletions?.map(deletion => <div key={deletion.id} className="border border-red-900 p-3 text-red-300"><p>{lang === 'uk' ? 'Видалення' : 'Delete'}: {currentTasks.find(task => task.id === deletion.id)?.title || deletion.id}</p><p className="text-sm">{deletion.reason || deletionReasonLabel(deletion.deletionReason, lang)}</p></div>)}
    {response.strategy?.narrative && normalizedProposalText(response.strategy.narrative) !== normalizedProposalText(response.reply || response.summary) && <AIChatText text={response.strategy.narrative} />}
    {response.strategy?.nextAction && <p className="border-l-2 border-emerald-600 pl-3">{response.strategy.nextAction}</p>}
    {response.strategy?.actions?.map(action => <div key={action.id} className="border border-emerald-900 p-3"><p className="font-semibold">{action.changes.title || currentTasks.find(task => task.id === action.taskId)?.title}</p><p className="text-sm text-neutral-300">{action.reason}</p></div>)}
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
  strategyProfile,
  onStrategyResponse,
  onChatWelcome,
  onUndoStrategy,
}) => {
  const t = TRANSLATIONS[lang];
  const dragControls = useDragControls();
  useDialogKeyboard(isOpen, onClose, 'ps-ai-sheet');
  const [initialDraft] = useState(() => readAIAssistantDraft(localStorage, accountId));
  const [prompt, setPrompt] = useState(() => initialPrompt || migrateAIComposer(initialDraft?.prompt || '', initialDraft?.mode || 'chat').prompt);
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [mode, setMode] = useState<AIMode>(migrateAIComposer(initialDraft?.prompt || '', initialDraft?.mode || 'chat').mode);
  const [recoverableRequest, setRecoverableRequest] = useState<AIRequest | null>(initialDraft?.recoverableRequest || null);
  const [requestError, setRequestError] = useState<string | null>(restoredAIRequestNotice(initialDraft?.recoverableRequest, lang));
  const activeRequest = useRef<AIRequest | null>(null);
  const draftAccountRef = useRef(accountId);
  const skipDraftPersistRef = useRef(false);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(false);
  const planningSourceRef = useRef<AIRequest | null>(null);
  const preservedRequestDraftRef = useRef<string | null>(null);
  const [applyNotice, setApplyNotice] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<AIChatMessage[]>(() => loadAIChatHistory(accountId));
  const [introductionId, setIntroductionId] = useState<string | null>(null);
  const visibleConversation = visibleAIChatMessages(chatMessages, introductionId);
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
  const assistController = useRef<AbortController | null>(null);
  const requestGeneration = useRef(0);
  const latestProposalMessageId = useRef<string | null>(null);
  const welcomeScrollRef = useRef(false);
  const welcomeAccountRef = useRef(accountId);
  const pendingTaskSnapshotRef = useRef<PSTask[]>([]);
  useEffect(() => {
    if (!isOpen && verificationController.current) {
      setPrompt('');
      setKeyStatus(lang === 'uk' ? 'Перевірку ключа перервано. Вставте його ще раз, щоб продовжити.' : 'Key verification was interrupted. Paste the key again to continue.');
    }
    if (!isOpen && activeRequest.current && draftAccountRef.current === accountId) {
      const interrupted = activeRequest.current;
      setRecoverableRequest(interrupted);
      setRequestError(aiRequestErrorMessage(new AIRequestError('CANCELLED'), lang));
      setChatProposalReadiness(false);
    }
    if (!isOpen) { preservedRequestDraftRef.current = null; setIntroductionId(null); }
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
    setIntroductionId(null);
    pendingRequest.current = null;
    pendingChatConfirmed.current = false;
    setChatProposalReadiness(false);
    setPendingChatTasks([]);
    setPendingChatTabs([]);
    setPendingChatUpdates([]);
    setPendingChatDeletions([]);
    setChatPlanningRequest(null);
    setChatPlanningResponse(null);
    planningSourceRef.current = null;
    preservedRequestDraftRef.current = null;
    latestProposalMessageId.current = null;
    setApplyNotice(null);
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
    const migrated = migrateAIComposer(draft?.prompt || '', draft?.mode || 'chat');
    setPrompt(migrated.prompt);
    setMode(migrated.mode);
    setRecoverableRequest(draft?.recoverableRequest || null);
    setRequestError(restoredAIRequestNotice(draft?.recoverableRequest, lang));
    setAwaitingApiKey(false);
    awaitingKeyRef.current = false;
    setKeyStatus(null);
  }, [accountId]);

  useEffect(() => {
    if (skipDraftPersistRef.current) { skipDraftPersistRef.current = false; return; }
    // A key is entered in the same field, but must never enter draft storage.
    saveAIAssistantDraft(localStorage, { prompt: awaitingKeyRef.current ? '' : prompt, mode, recoverableRequest }, accountId);
  }, [accountId, prompt, mode, recoverableRequest]);

  useEffect(() => {
    const field = promptInputRef.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(160, Math.max(52, field.scrollHeight))}px`;
    field.style.overflowY = field.scrollHeight > 160 ? 'auto' : 'hidden';
  }, [prompt, isOpen, awaitingApiKey]);

  useEffect(() => {
    if (!isOpen || hydratedAccountRef.current !== accountId) return;
    const previous = welcomeAccountRef.current === accountId ? chatMessages : loadAIChatHistory(accountId);
    welcomeAccountRef.current = accountId;
    const result = ensureAIChatWelcome(accountId, previous, strategyGreeting(lang), !!strategyProfile && strategyProfile.onboardingStatus !== 'new');
    if (result.added) {
      welcomeScrollRef.current = true;
      setIntroductionId(result.messages.at(-1)?.id || null);
      setChatMessages(result.messages);
      onChatWelcome?.(accountId);
    }
  }, [isOpen, accountId, strategyProfile?.onboardingStatus]);

  useEffect(() => {
    if (!isOpen) return;
    const frame = requestAnimationFrame(() => {
      if (contentRef.current) {
        if (welcomeScrollRef.current) {
          const greetings = contentRef.current.querySelectorAll('[data-ai-greeting]');
          greetings[greetings.length - 1]?.scrollIntoView({ block: 'start' });
          welcomeScrollRef.current = false;
        } else contentRef.current.scrollTop = contentRef.current.scrollHeight;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [isOpen, chatMessages, loading, awaitingApiKey, keyStatus, requestError]);

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
    const targets = [...pendingChatUpdates.map(update => update.id), ...pendingChatDeletions.map(deletion => deletion.id)];
    if (!proposalTargetsUnchanged(pendingTaskSnapshotRef.current, currentTasks, targets)) {
      setChatProposalReadiness(false);
      setRequestError(lang === 'uk' ? 'Завдання змінилися після цього запиту. Повторіть запит, щоб зберегти новіший прогрес і правки.' : 'Tasks changed after this request. Retry to preserve newer progress and edits.');
      return;
    }
    pendingChatConfirmed.current = true;
    setChatProposalReadiness(false);

    const tasks = (pendingChatTasks || []).map(task => prepareAITask(task,
      index => `s-chat-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`));

    const result = onInjectTasks(tasks, pendingChatTabs, pendingChatUpdates, pendingChatDeletions);
    const appliedId = latestProposalMessageId.current;
    setChatMessages(previous => previous.map(message => message.id === appliedId ? { ...message, proposalStatus: 'applied', notice: describeAIApplyResult(result, lang) } : message));

    setRecoverableRequest(null);
    setRequestError(null);

    setPendingChatTasks([]);
    setPendingChatTabs([]);
    setPendingChatUpdates([]);
    setPendingChatDeletions([]);
    setChatPlanningRequest(null);
    setChatPlanningResponse(null);

    sound.activate();
  };

  const activeCount = currentTasks.filter((t) => !t.done && !t.scheduledPending).length;
  const completedCount = currentTasks.filter((t) => t.done).length;

  // Opening from a task or strategy never sends a request automatically.
  useEffect(() => {
    if (isOpen && initialPrompt) {
      const migrated = migrateAIComposer(initialPrompt, 'chat');
      setPrompt(migrated.prompt);
      setMode(migrated.mode);
    }
  }, [initialPrompt, isOpen]);

  const handleGenerate = async (queryText?: string, selectedMode?: AIMode, resuming = false, preserveInput = false, planningSource?: AIRequest, internalAlternative = false) => {
    voiceRef.current?.cancel();
    voiceRef.current = null;
    voiceDraftRef.current = null;
    setVoicePhase('idle');
    const textToQuery = queryText !== undefined ? queryText : prompt;
    const requestProfile = strategyProfile;
    const requestOwner = accountId;
    const parsedCommand = parseAICommand(textToQuery, modeIntent(selectedMode || mode));
    const currentMode = intentMode(parsedCommand.intent);
    const requestText = parsedCommand.text || (
      currentMode === 'analyze'
        ? (lang === 'uk' ? 'Повний аудит робочого процесу, вузьких місць і аналітика категорій' : 'Comprehensive workflow audit, bottleneck analysis, and category metrics')
        : currentMode === 'generate' ? (lang === 'uk' ? 'Допоможи спланувати роботу над моєю узгодженою ціллю. Якщо ціль не визначена, спочатку уточни її.' : 'Help plan work toward my agreed goal. If no goal is clear, ask me first.')
        : currentMode === 'breakdown' ? (lang === 'uk' ? 'Допоможи розбити конкретне завдання на підзавдання. Якщо завдання не визначене, спочатку запитай яке.' : 'Help break down a specific task into subtasks. If the task is unclear, ask which task first.') : ''
    );
    const retryRequest = recoverableRequest?.text === requestText && recoverableRequest.mode === currentMode ? recoverableRequest : null;
    const isAlternativeRequest = internalAlternative || retryRequest?.internalAlternative === true;
    const keepDraft = preserveInput || isAlternativeRequest;
    const sourceRequest = planningSource || retryRequest?.planningSource || { text: requestText, mode: currentMode };
    const currentRequest: AIRequest = {
      text: requestText,
      mode: currentMode,
      intent: parsedCommand.intent,
      turnId: retryRequest?.turnId || `turn-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      ...(isAlternativeRequest ? { internalAlternative: true, planningSource: { text: sourceRequest.text, mode: sourceRequest.mode } } : {}),
    };

    if (!requestText) return;
    if (requestInFlight.current) return;
    if (parsedCommand.intent === 'auto' && pendingChangeCount > 0 && /^(так|підтверджую|підтверджено|yes|confirm|ок|застосувати|зберегти)$/i.test(textToQuery.trim())) {
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
    setChatMessages(previous => previous.map(message => message.proposalStatus === 'pending' ? { ...message, proposalStatus: 'stale' } : message));
    setApplyNotice(null);

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
    if (!keepDraft) { setPrompt(''); setMode('chat'); }
    setAwaitingApiKey(false);
    awaitingKeyRef.current = false;
    setKeyStatus(null);
    setRequestError(null);
    activeRequest.current = currentRequest;
    setRecoverableRequest(currentRequest);
    pendingRequest.current = null;
    requestInFlight.current = true;
    setLoading(true);
    setChatMessages(previous => previous.some(message => message.id === currentRequest.turnId) ? previous : [...previous, {
      id: currentRequest.turnId,
      role: 'user',
      content: currentRequest.internalAlternative ? (lang === 'uk' ? 'Інший варіант планування' : 'Alternative plan') : `${currentRequest.intent !== 'auto' ? `@${currentRequest.intent} ` : ''}${requestText}`,
    }]);

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
          action: 'chat',
          intent: currentRequest.intent || modeIntent(currentMode),
          strategyContext: strategyProfile,
          messageId: currentRequest.turnId,
          requestId: currentRequest.turnId,
          turnId: currentRequest.turnId,
          lang,
          tabs: tabs.map((tb) => tb.id),
          adaptiveProfile,
          currentTasks: currentTasks.map(task => ({ ...task, ...getAITimerContext(task) })),
          conversation: recentAIChatContext(chatMessages),
          pendingChanges: {
            tasks: pendingChatTasks, tabs: pendingChatTabs,
            taskUpdates: pendingChatUpdates,
            taskDeletions: pendingChatDeletions,
          },
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
      const data = readAIResponse(rawData, 'chat');
      activeRequest.current = null;
      const hasPendingActions = [data.tasks, data.tabs, data.taskUpdates, data.taskDeletions].some(actions => (actions?.length || 0) > 0);
      const hasPendingChatActions = hasPendingActions;
      setRecoverableRequest(hasPendingActions ? { ...currentRequest, purpose: 'proposal' } : null);
      setRequestError(null);
      if (preservedRequestDraftRef.current !== null) setPrompt(preservedRequestDraftRef.current);
      if (data.fallbackUsed && data.usedModel) setKeyStatus(lang === 'uk' ? `Відповідь підготувала доступна модель ${data.usedModel}.` : `The response was generated by the available model ${data.usedModel}.`);
      const isPlanningResponse = !!data.tasks?.length || !!data.taskUpdates?.length || currentRequest.intent === 'plan' || currentRequest.intent === 'steps' || /план|\bplan(?:ning)?\b/iu.test((planningSourceRef.current || currentRequest).text);
      setChatPlanningRequest(isPlanningResponse ? planningSourceRef.current || currentRequest : null);
      setChatPlanningResponse(isPlanningResponse ? data : null);
      pendingChatConfirmed.current = false;
      setChatProposalReadiness(hasPendingChatActions);
      setPendingChatTasks(data.tasks || []);
      setPendingChatTabs((data.tabs || []).map(tb => ({ id: tb.id, name: tb.name, color: tb.color || '#6366f1' })));
      setPendingChatUpdates(data.taskUpdates || []);
      setPendingChatDeletions(data.taskDeletions || []);
      const messageId = `reply-${currentRequest.turnId}`;
      latestProposalMessageId.current = messageId;
      pendingTaskSnapshotRef.current = currentTasks;
      const strategyResult = data.strategy ? onStrategyResponse?.(data, currentRequest.text, currentRequest.turnId!, currentRequest.intent || 'auto', requestOwner, requestProfile) : undefined;
      const strategyNotice = strategyResult && typeof strategyResult === 'object' ? strategyResult : undefined;
      setChatMessages(previous => [...previous, {
        id: messageId,
        role: 'assistant',
        content: data.reply || data.summary,
        response: data,
        proposalStatus: hasPendingActions ? 'pending' : undefined,
        notice: strategyNotice?.notice,
        actionId: strategyNotice?.actionId,
      }]);
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
    setChatMessages(previous => previous.map(message => message.proposalStatus === 'pending' ? { ...message, proposalStatus: 'stale' } : message));
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

  const changePrompt = (value: string) => {
    if (!awaitingKeyRef.current && /^\s*@(plan|analysis|steps)\s/i.test(value)) {
      const parsed = parseAICommand(value);
      setMode(intentMode(parsed.intent));
      value = parsed.text;
    }
    voiceDraftRef.current?.edit(value);
    if (!awaitingKeyRef.current && preservedRequestDraftRef.current !== null) preservedRequestDraftRef.current = value;
    setPrompt(value);
  };
  const composerKeyDown = (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      if ((prompt.trim() || (!awaitingApiKey && mode !== 'chat')) && !requestInFlight.current && !isTranscribing) void handleGenerate();
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
            aria-label={lang === 'uk' ? 'ШІ-чат Karkas' : 'Karkas AI chat'}
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
            className="relative z-10 w-full max-w-[1100px] h-[95dvh] max-sm:h-[100dvh] bg-[#0c0c0e] border-t border-x border-neutral-800 flex flex-col shadow-2xl font-sans"
          >
            {/* Drag Handle */}
            <div
              aria-hidden="true"
              onPointerDown={(event) => dragControls.start(event)}
              style={{ touchAction: 'none' }}
              className="w-full shrink-0 flex items-center justify-center pt-1.5 pb-1 cursor-grab active:cursor-grabbing"
            >
              <div className="w-10 h-1 bg-neutral-700 rounded-full" />
            </div>

            {/* Header */}
            <div className="flex shrink-0 items-center justify-between gap-2 px-4 sm:px-5 py-1 border-b border-neutral-800">
              <div className="min-w-0 flex items-center gap-2">
                <AIIcon id={aiIconVariant} className="w-4 h-4 shrink-0 text-white" />
                <span className="min-w-0 break-words text-xs sm:text-sm font-bold uppercase tracking-wider font-sans text-white">
                  KARKAS AI
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

            {/* Content Container (Scrollable) */}
            <div ref={contentRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-5 flex flex-col gap-4">
              {/* All replies, analyses and proposals share one persisted conversation. */}
              {visibleConversation.previousCount > 0 && <button id="ai-reveal-previous-history-btn" type="button" onClick={() => setIntroductionId(null)} className="self-start min-h-11 border border-neutral-700 px-3 py-2 text-sm text-neutral-300 hover:border-white">{lang === 'uk' ? 'Попередня історія' : 'Previous history'} ({visibleConversation.previousCount})</button>}
              {visibleConversation.messages.length > 0 && <div role="log" aria-label={lang === 'uk' ? 'Розмова з AI' : 'AI conversation'} aria-live="polite" aria-relevant="additions text" className="karkas-ai-conversation">
                {visibleConversation.messages.map((message, index) => {
                  const parsed = message.role === 'assistant' ? parseChatOptions(message.content) : { body: message.content, options: [] };
                  return <div key={message.id || `${message.role}-${index}`} data-ai-greeting={message.greeting || undefined} className={`karkas-ai-message ${message.role === 'user' ? 'is-user' : 'is-assistant'}`}>
                    <div className="karkas-ai-message-author">{message.role === 'user' ? (lang === 'uk' ? 'ВИ' : 'YOU') : 'KARKAS AI'}</div>
                    {message.role === 'assistant' ? <AIChatText text={parsed.body} /> : <div className="whitespace-pre-wrap">{parsed.body}</div>}
                    {!!parsed.options.length && <div className="flex flex-col gap-2 mt-3">{parsed.options.map(option => <button key={option.text} type="button" disabled={loading} onClick={() => handleGenerate(option.text, 'chat')} className="min-h-11 w-full text-left border border-neutral-700 px-3 py-2 hover:border-white disabled:opacity-40">{option.label}. {option.text}</button>)}</div>}
                    {message.response && <ChatResponseCards response={message.response} currentTasks={currentTasks} tabs={tabs} lang={lang} />}
                    {message.proposalStatus === 'stale' && <p className="mt-3 text-sm text-neutral-400">{lang === 'uk' ? 'Попередня пропозиція. Повторіть запит, щоб підготувати актуальні зміни.' : 'Previous proposal. Repeat the request to prepare current changes.'}</p>}
                    {message.proposalStatus === 'pending' && message.id === latestProposalMessageId.current && chatProposalReady && pendingChangeCount > 0 && !loading && !requestError && <button id="ai-chat-apply-changes-btn" type="button" onClick={confirmChatChanges} className="mt-3 min-h-11 bg-white text-black px-3 py-2 font-semibold hover:bg-neutral-200">{lang === 'uk' ? `Застосувати зміни (${pendingChangeCount})` : `Apply changes (${pendingChangeCount})`}</button>}
                    {message.notice && <p role="status" className="mt-3 text-sm text-emerald-300">{message.notice}</p>}
                    {message.actionId && onUndoStrategy && <button type="button" onClick={() => { if (onUndoStrategy(message.actionId!) === true) setChatMessages(previous => previous.map(item => item.id === message.id ? { ...item, actionId: undefined, notice: lang === 'uk' ? 'Зміну плану скасовано.' : 'Plan change undone.' } : item)); }} className="mt-2 min-h-11 border border-neutral-700 px-3 py-2 hover:border-white">{lang === 'uk' ? 'Скасувати зміни стратегії' : 'Undo strategy changes'}</button>}
                    {message.id === latestProposalMessageId.current && chatPlanningRequest && chatPlanningResponse && !pendingChatConfirmed.current && !loading && !requestError && !awaitingApiKey && <button id="ai-chat-alternative-plan-btn" type="button" onClick={() => requestAlternativePlan(chatPlanningRequest, chatPlanningResponse)} className="mt-3 ml-2 min-h-11 inline-flex items-center gap-2 border border-neutral-700 px-3 py-2 hover:border-white"><RefreshCw size={16} />{lang === 'uk' ? 'Інший варіант планування' : 'Alternative plan'}</button>}
                  </div>;
                })}
              </div>}

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
                <div role="status" aria-live="polite" className="p-3 border border-neutral-800 bg-black/40 flex flex-col items-center justify-center gap-3 text-center">
                  <div className="w-6 h-6 border-2 border-white border-t-transparent animate-spin rounded-full" />
                  <span className="text-xs font-sans tracking-widest text-neutral-300 uppercase animate-pulse">
                    {mode === 'chat'
                      ? (lang === 'uk' ? 'KARKAS AI ФОРМУЄ ВІДПОВІДЬ...' : 'KARKAS AI IS RESPONDING...')
                      : t.aiSheet.thinking}
                  </span>
                  <button id="ai-request-cancel-btn" type="button" onClick={cancelAIRequest} className="min-h-11 border border-neutral-700 px-3 py-2 text-xs text-neutral-300 hover:border-white hover:text-white">
                    {lang === 'uk' ? 'Скасувати запит' : 'Cancel request'}
                  </button>
                </div>
              )}

            </div>

            {/* Custom Prompt Input at the bottom of the sheet */}
            <div className="shrink-0 px-3 sm:px-4 py-2 bg-[#08080a] border-t border-neutral-800 space-y-2">
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
                {!awaitingApiKey && mode !== 'chat' && <div className="karkas-ai-command-chip"><span>{AI_COMMANDS.find(action => action.intent === modeIntent(mode))?.command}</span><button type="button" aria-label={lang === 'uk' ? 'Прибрати дію' : 'Remove action'} onClick={() => { setMode('chat'); promptInputRef.current?.focus(); }}><X size={14} /></button></div>}
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
                  value={prompt}
                  onChange={event => changePrompt(event.target.value)}
                  onKeyDown={composerKeyDown}
                  placeholder={lang === 'uk' ? 'Напишіть повідомлення…' : 'Write a message…'}
                  className="karkas-ai-composer-field"
                />}
                <div className="karkas-ai-composer-toolbar">
                <AICommandMenu key={accountId || 'guest'} lang={lang} disabled={loading || awaitingApiKey} onChoose={intent => { setMode(intentMode(intent)); promptInputRef.current?.focus(); }} />
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
                  disabled={loading || isTranscribing || (!prompt.trim() && (awaitingApiKey || mode === 'chat'))}
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
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
