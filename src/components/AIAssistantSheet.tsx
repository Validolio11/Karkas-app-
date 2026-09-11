import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  PSTask,
  TaskTab,
  DeletedTask,
  WorkflowStats,
  TaskStepItem,
  AdaptiveProfile,
  AITaskUpdate,
  AIResponse,
} from '../types';
import { sound } from '../utils/audio';
import { Language, TRANSLATIONS, AI_PRESETS_UK, AI_PRESETS_EN } from '../utils/i18n';
import {
  X,
  Plus,
  CheckCircle2,
  ListTree,
  Sparkles,
  Layers,
  Lightbulb,
  Edit3,
  Trash2,
  CheckSquare,
  Activity,
  AlertTriangle,
  TrendingUp,
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
    newTasks: Omit<PSTask, 'id' | 'currentStep' | 'done' | 'pinned' | 'createdAt'>[],
    newTabs?: TaskTab[],
    taskUpdates?: AITaskUpdate[],
    deletedTaskIds?: string[],
  ) => void;
  accountId?: string | null;
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
  const [chatMessages, setChatMessages] = useState<AIChatMessage[]>(() => loadAIChatHistory(accountId));
  const hydratedAccountRef = useRef(accountId);
  const skipPersistRef = useRef(false);

  const [pendingChatTasks, setPendingChatTasks] = useState<NonNullable<AIResponse['tasks']>>([]);
  const [pendingChatTabs, setPendingChatTabs] = useState<TaskTab[]>([]);
  const [pendingChatUpdates, setPendingChatUpdates] = useState<AITaskUpdate[]>([]);
  const [pendingChatDeletions, setPendingChatDeletions] = useState<string[]>([]);

  const [awaitingApiKey, setAwaitingApiKey] = useState(false);
  const [keyStatus, setKeyStatus] = useState<string | null>(null);
  const pendingRequest = useRef<{ text: string; mode: AIMode } | null>(null);
  const requestInFlight = useRef(false);
  const awaitingKeyRef = useRef(false);
  const verificationController = useRef<AbortController | null>(null);
  const backgroundVerification = useRef<AbortController | null>(null);
  const [injectedIds, setInjectedIds] = useState<number[]>([]);
  const [appliedUpdateIds, setAppliedUpdateIds] = useState<string[]>([]);

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
    return availableModels.includes('gemini-3.1-flash-lite')
      ? 'gemini-3.1-flash-lite'
      : storedModel;
  });

  // Voice dictation state
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);

  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const promptBeforeRecordingRef = useRef<string>('');

  const stopVoiceInput = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        if (mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.requestData();
        }
        mediaRecorderRef.current.stop();
      } catch {}
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    setIsListening(false);
  };

  useEffect(() => {
    if (!isListening) {
      setRecordingDuration(0);
      return;
    }
    const interval = setInterval(() => {
      setRecordingDuration((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isListening]);

  useEffect(() => {
    if (!isOpen && isListening) {
      stopVoiceInput();
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      stopVoiceInput();
    };
  }, []);

  const transcribeRecordedAudio = async (blob: Blob) => {
    setIsTranscribing(true);
    try {
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onloadend = () => {
          const res = reader.result as string;
          resolve(res);
        };
        reader.onerror = reject;
      });
      reader.readAsDataURL(blob);
      const audioBase64 = await base64Promise;

      const customApiKey = localStorage.getItem('karkas_custom_api_key') || undefined;
      const res = await karkasApiFetch('/api/ai/transcribe-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioBase64,
          mimeType: blob.type,
          lang,
          customApiKey,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.text) {
          const spoken = data.text.trim();
          const base = promptBeforeRecordingRef.current.trim();
          const nextPrompt = base ? `${base} ${spoken}` : spoken;
          setPrompt(nextPrompt);
          sound.tick(800);
        } else {
          setVoiceNotice(lang === 'uk' ? 'Мовлення не виявлено. Спробуйте ще раз.' : 'No speech detected. Please try again.');
          sound.tick(300);
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        setVoiceNotice(errData.error || (lang === 'uk' ? 'Помилка транскрипції аудіо' : 'Audio transcription failed'));
        sound.tick(300);
      }
    } catch (err: any) {
      console.error('Audio transcription error:', err);
      setVoiceNotice(lang === 'uk' ? 'Помилка розпізнавання аудіо' : 'Audio recognition error');
      sound.tick(300);
    } finally {
      setIsTranscribing(false);
    }
  };

  const startMediaRecorderFallback = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setVoiceNotice(t.aiSheet.voiceNotSupported);
      sound.tick(300);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      audioChunksRef.current = [];

      let mimeType = '';
      if (typeof MediaRecorder !== 'undefined') {
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) mimeType = 'audio/webm;codecs=opus';
        else if (MediaRecorder.isTypeSupported('audio/webm')) mimeType = 'audio/webm';
        else if (MediaRecorder.isTypeSupported('audio/mp4')) mimeType = 'audio/mp4';
      }

      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        audioChunksRef.current = [];
        if (audioBlob.size > 200) {
          await transcribeRecordedAudio(audioBlob);
        } else {
          setVoiceNotice(lang === 'uk' ? 'Запис занадто короткий' : 'Recording too short');
          sound.tick(300);
        }
      };

      recorder.start(250);
      setIsListening(true);
      sound.tick(750);
    } catch (err: any) {
      console.error('Microphone access failed:', err);
      setVoiceNotice(t.aiSheet.voicePermissionDenied);
      sound.tick(300);
      setIsListening(false);
    }
  };

  const handleToggleVoiceInput = async () => {
    if (isListening) {
      sound.tick(400);
      stopVoiceInput();
      return;
    }

    setVoiceNotice(null);
    promptBeforeRecordingRef.current = prompt;

    const isDesktop = Boolean((window as any).karkasDesktop);

    // In Electron Desktop, Google Web Speech API is not supported by Chromium.
    // Use MediaRecorder with Gemini transcription directly.
    if (!isDesktop) {
      const SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

      if (SpeechRecognition) {
        try {
          const recognition = new SpeechRecognition();
          recognition.lang = lang === 'uk' ? 'uk-UA' : 'en-US';
          recognition.continuous = true;
          recognition.interimResults = true;
          recognition.maxAlternatives = 1;

          let accumulatedFinal = '';

          recognition.onstart = () => {
            setIsListening(true);
            sound.tick(750);
          };

          recognition.onresult = (event: any) => {
            let currentInterim = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
              const transcript = event.results[i][0].transcript;
              if (event.results[i].isFinal) {
                accumulatedFinal += (accumulatedFinal ? ' ' : '') + transcript.trim();
              } else {
                currentInterim += transcript;
              }
            }
            const spoken = (accumulatedFinal + (currentInterim ? ' ' + currentInterim : '')).trim();
            const base = promptBeforeRecordingRef.current.trim();
            const nextPrompt = base ? `${base} ${spoken}` : spoken;
            setPrompt(nextPrompt);
          };

          recognition.onerror = async (event: any) => {
            console.warn('SpeechRecognition error, trying MediaRecorder fallback:', event.error);
            stopVoiceInput();
            if (event.error !== 'no-speech') {
              startMediaRecorderFallback();
            }
          };

          recognition.onend = () => {
            setIsListening(false);
            recognitionRef.current = null;
          };

          recognitionRef.current = recognition;
          recognition.start();
          return;
        } catch (err) {
          console.warn('SpeechRecognition initialization error, falling back to MediaRecorder:', err);
        }
      }
    }

    // Fallback: MediaRecorder with Gemini transcription
    startMediaRecorderFallback();
  };

  // Keep conversation history synchronized per account
  useEffect(() => {
    if (hydratedAccountRef.current === accountId) return;
    hydratedAccountRef.current = accountId;
    skipPersistRef.current = true;
    setChatMessages(loadAIChatHistory(accountId));
  }, [accountId]);

  useEffect(() => {
    if (skipPersistRef.current) {
      skipPersistRef.current = false;
      return;
    }
    saveAIChatHistory(accountId, chatMessages as PersistedAIChatMessage[]);
  }, [accountId, chatMessages]);

  useEffect(() => {
    if (window.karkasDesktop) {
      let active = true;
      Promise.all([desktopHasAiKey(), window.karkasDesktop.preferences.get()]).then(([hasKey, preferences]) => {
        if (!active || !hasKey) return;
        const storedModels = preferences.ok ? preferences.value.karkas_available_models : null;
        const parsedModels = typeof storedModels === 'string' ? JSON.parse(storedModels) : storedModels;
        const models = Array.isArray(parsedModels) ? parsedModels.filter((m): m is string => typeof m === 'string' && isChatModel(m)) : [];
        const preferred = preferences.ok && typeof preferences.value.karkas_custom_model === 'string'
          ? preferences.value.karkas_custom_model : '';
        if (models.length) {
          setAvailableModels(models);
          setCustomModel(models.includes(preferred) ? preferred : models[0]);
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

  const pendingChangeCount =
    (pendingChatTasks?.length || 0) +
    (pendingChatTabs?.length || 0) +
    (pendingChatUpdates?.length || 0) +
    (pendingChatDeletions?.length || 0);

  const confirmChatChanges = () => {
    if (pendingChangeCount === 0) return;

    const tasks = (pendingChatTasks || []).map((task) => {
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

    onInjectTasks(tasks, pendingChatTabs, pendingChatUpdates, pendingChatDeletions);
    
    const summaryParts: string[] = [];
    if (tasks.length > 0) summaryParts.push(lang === 'uk' ? `завдань створено: ${tasks.length}` : `tasks created: ${tasks.length}`);
    if (pendingChatTabs.length > 0) summaryParts.push(lang === 'uk' ? `вкладок додано: ${pendingChatTabs.length}` : `tabs added: ${pendingChatTabs.length}`);
    if (pendingChatUpdates.length > 0) summaryParts.push(lang === 'uk' ? `завдань оновлено: ${pendingChatUpdates.length}` : `tasks updated: ${pendingChatUpdates.length}`);
    if (pendingChatDeletions.length > 0) summaryParts.push(lang === 'uk' ? `завдань видалено: ${pendingChatDeletions.length}` : `tasks deleted: ${pendingChatDeletions.length}`);

    setPendingChatTasks([]);
    setPendingChatTabs([]);
    setPendingChatUpdates([]);
    setPendingChatDeletions([]);

    setChatMessages((previous) => [
      ...previous,
      {
        role: 'assistant',
        content: lang === 'uk' ? `Готово. Зміни успішно застосовано (${summaryParts.join(', ')}).` : `Done. Changes applied (${summaryParts.join(', ')}).`,
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

  const handleGenerate = async (queryText?: string, selectedMode?: AIMode, resuming = false) => {
    const textToQuery = queryText !== undefined ? queryText : prompt;
    const currentMode = selectedMode || mode;
    const requestText = textToQuery.trim() || (
      currentMode === 'analyze'
        ? (lang === 'uk' ? 'Повний аудит робочого процесу, вузьких місць і аналітика категорій' : 'Comprehensive workflow audit, bottleneck analysis, and category metrics')
        : ''
    );

    if (!requestText) return;
    if (requestInFlight.current) return;

    const savedApiKey = localStorage.getItem('karkas_custom_api_key') || '';
    const desktopKeyAvailable = window.karkasDesktop ? await desktopHasAiKey() : false;
    const customAiEnabled = desktopKeyAvailable || localStorage.getItem('karkas_custom_ai_enabled') === 'true';

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
        setCustomModel(nextModel);
        setAwaitingApiKey(false);
        awaitingKeyRef.current = false;
        setKeyStatus(null);
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

    if (awaitingKeyRef.current && !resuming && ((!savedApiKey && !desktopKeyAvailable) || !customAiEnabled)) {
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

    if (currentMode === 'chat' && pendingChangeCount > 0 && /^(так|підтверджую|підтверджено|yes|confirm|ок|застосувати|зберегти)$/i.test(textToQuery.trim())) {
      setPrompt('');
      setChatMessages((previous) => [...previous, { role: 'user', content: textToQuery.trim() }]);
      confirmChatChanges();
      return;
    }

    sound.activate();
    setPrompt('');
    requestInFlight.current = true;
    setLoading(true);
    setResponse(null);
    setInjectedIds([]);
    setAppliedUpdateIds([]);
    if (currentMode === 'chat' && !resuming) {
      setChatMessages((previous) => [
        ...previous,
        { role: 'user', content: requestText },
      ]);
    }

    const isTabMutation = /(?:вкладк|категорі|напрямок|розділ|секці|tab|category|section)/iu.test(requestText);
    const activeList = currentTasks.filter((t) => !t.done);
    const doneList = currentTasks.filter((t) => t.done);

    try {
      const customKey = localStorage.getItem('karkas_custom_api_key') || '';
      const storedModel = localStorage.getItem('karkas_custom_model') || '';
      const customEnabled = localStorage.getItem('karkas_custom_ai_enabled') === 'true';

      const controller = new AbortController();
      const requestTimeout = window.setTimeout(() => controller.abort(), 35000);
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
          currentTasks,
          conversation: currentMode === 'chat' ? chatMessages : undefined,
          allowNewTabs: isTabMutation,
          customApiKey: customEnabled ? customKey : undefined,
          selectedModel: customEnabled ? (storedModel || customModel) : undefined,
          fullAppContext: {
            activeTasks: activeList.map((t) => ({
              id: t.id,
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
              id: t.id,
              title: t.title,
              phase: t.phase,
              completedAt: t.completedAt,
              timeSpentSeconds: t.timeSpentSeconds || 0,
              createdAt: t.createdAt,
            })),
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
      window.clearTimeout(requestTimeout);

      if (!res.ok) throw new Error('API request failed');
      const data: AIResponse = await res.json();
      if (currentMode === 'chat') {
        const hasMutations =
          (data.tasks && data.tasks.length > 0) ||
          (data.tabs && data.tabs.length > 0) ||
          (data.taskUpdates && data.taskUpdates.length > 0) ||
          (data.taskDeletions && data.taskDeletions.length > 0);

        if (hasMutations) {
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
      console.error('AI query error:', err);
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
              ? `Зараз працюю в локальному режимі. У вас ${activeCount} активних задач і ${completedCount} завершених. Напишіть конкретну дію, наприклад «додай задачу X» або «проаналізуй мої задачі».`
              : `Running in local mode. You have ${activeCount} active and ${completedCount} completed tasks. Try specific commands like "add task X" or "analyze my workflow".`,
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
                  { title: 'Аналіз вимог та підготовка', done: false },
                  { title: 'Виконання основної частини', done: false },
                  { title: 'Фінальна перевірка та закриття', done: false },
                ],
                note: 'Ключовий фокус',
              },
              {
                title: `${fallbackPrompt} — Супутній етап`,
                phase: secondaryPhase,
                priority: 2,
                steps: 2,
                stepList: [
                  { title: 'Узгодження деталей', done: false },
                  { title: 'Збереження результатів', done: false },
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
                  { title: 'Requirements review', done: false },
                  { title: 'Primary execution sprint', done: false },
                  { title: 'Quality check & finalize', done: false },
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
    if (!response) return;
    const taskList = response.tasks || [];
    const tabList: TaskTab[] = (response.tabs || []).map((t) => ({ id: t.id, name: t.name, color: t.color || '#6366f1' }));
    const updateList = response.taskUpdates || [];
    const deleteList = (response.taskDeletions || []).map((d) => d.id);

    if (!taskList.length && !tabList.length && !updateList.length && !deleteList.length) return;
    sound.activate();

    const formattedTasks = taskList.map((task) => {
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

    onInjectTasks(formattedTasks, tabList, updateList, deleteList);
    setInjectedIds(taskList.map((_, i) => i));
    setAppliedUpdateIds(updateList.map((u) => u.id));
    setTimeout(() => {
      onClose();
    }, 500);
  };

  const handleInjectSingle = (task: NonNullable<AIResponse['tasks']>[0], index: number) => {
    sound.tick(600);
    const stepItems: TaskStepItem[] | undefined = task.stepList && task.stepList.length > 0
      ? task.stepList.map((st, idx) => ({
          id: `s-${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 4)}`,
          title: typeof st === 'string' ? st : st.title,
          done: false,
        }))
      : undefined;

    const tabList: TaskTab[] = (response?.tabs || []).map((t) => ({ id: t.id, name: t.name, color: t.color || '#6366f1' }));

    onInjectTasks([
      {
        title: task.title,
        phase: task.phase,
        priority: task.priority,
        steps: stepItems ? stepItems.length : (task.steps || 1),
        stepList: stepItems,
        note: task.note,
      },
    ], tabList);
    setInjectedIds((prev) => [...prev, index]);
  };

  const handleApplySingleUpdate = (update: AITaskUpdate) => {
    sound.tick(650);
    onInjectTasks([], [], [update], []);
    setAppliedUpdateIds((prev) => [...prev, update.id]);
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
                <TrendingUp className="w-3.5 h-3.5 shrink-0" />
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

              {/* Chat View */}
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
                              <div key={idx} className="bg-black/60 border border-neutral-800 p-2 text-xs flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 truncate">
                                  <span className="text-[9px] text-emerald-400 font-bold">P{t.priority}</span>
                                  <span className="text-neutral-200 truncate">{t.title}</span>
                                  <span className="text-[10px] text-neutral-500">[{t.phase}]</span>
                                </div>
                                <span className="text-[10px] text-neutral-400 shrink-0">{t.steps} {lang === 'uk' ? 'кроків' : 'steps'}</span>
                              </div>
                            ))}
                          </div>
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
                                  <div className="truncate">
                                    <span className="text-neutral-400">{existing?.title || u.id} → </span>
                                    <span className="text-amber-300 font-bold">{u.title || (u.priority ? `P${u.priority}` : u.note || 'Змінено')}</span>
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

              {/* Structured Response Section */}
              {response && !loading && (
                <div className="border border-neutral-800 bg-[#0d0d10] p-4 flex flex-col gap-4">
                  {/* Strategy Summary & Inject All */}
                  <div className="flex items-start justify-between gap-3 border-b border-neutral-800 pb-3">
                    <div className="space-y-1">
                      <div className="text-[10px] font-mono uppercase text-neutral-400 tracking-widest flex items-center gap-1.5">
                        <Sparkles className="w-3 h-3 text-white" />
                        <span>{mode === 'analyze' ? (lang === 'uk' ? 'ДІАГНОСТИКА ПРОЦЕСУ' : 'WORKFLOW AUDIT') : t.aiSheet.strategyHeader}</span>
                      </div>
                      <p className="text-xs sm:text-sm font-bold text-neutral-100 leading-relaxed">
                        {response.summary}
                      </p>
                    </div>

                    {((response.tasks && response.tasks.length > 0) || (response.tabs && response.tabs.length > 0) || (response.taskUpdates && response.taskUpdates.length > 0)) && (
                      <button
                        id="ai-inject-all-btn"
                        onClick={handleInjectAll}
                        className="whitespace-nowrap px-3 py-1.5 bg-white text-black font-extrabold text-xs font-mono tracking-wider hover:bg-neutral-200 transition-colors flex items-center gap-1.5 shrink-0"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>{t.aiSheet.injectAll} ({(response.tasks?.length || 0) + (response.tabs?.length || 0) + (response.taskUpdates?.length || 0)})</span>
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
                        <Layers className="w-3.5 h-3.5 text-neutral-300" />
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
                                {isApplied ? t.aiSheet.added : (lang === 'uk' ? 'Застосувати' : 'Apply')}
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
            <div className="px-4 sm:px-5 py-3 bg-[#08080a] border-t border-neutral-800 space-y-2">
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
                    <div className="flex items-center justify-between w-full">
                      <div className="flex items-center gap-2.5">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                        </span>
                        {/* Audio wave bars */}
                        <div className="flex items-end gap-0.5 h-3.5">
                          <span className="w-0.5 bg-red-400 h-2 animate-pulse" style={{ animationDuration: '600ms' }} />
                          <span className="w-0.5 bg-red-400 h-3.5 animate-pulse" style={{ animationDuration: '400ms' }} />
                          <span className="w-0.5 bg-red-400 h-1.5 animate-pulse" style={{ animationDuration: '700ms' }} />
                          <span className="w-0.5 bg-red-400 h-3 animate-pulse" style={{ animationDuration: '500ms' }} />
                        </div>
                        <span className="text-[11px] text-red-300 font-bold uppercase tracking-wider">
                          {t.aiSheet.voiceListening}
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

              <div className="flex items-center gap-2">
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

                <div className="relative flex-1 flex items-center">
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
                        ? (lang === 'uk' ? 'Напишіть запитання або дію (напр. «додай задачу X», «зміни пріоритет Y»)...' : 'Ask a question or request action (e.g. "add task X", "change priority of Y")...')
                        : mode === 'analyze'
                        ? (lang === 'uk' ? 'Уточніть фокус аналізу (напр. перевірити пріоритети, дедлайни)...' : 'Refine audit focus (e.g. check priorities, deadlines)...')
                        : t.aiSheet.inputPlaceholder
                    }
                    className="w-full bg-[#050507] border border-neutral-800 text-white placeholder:text-neutral-500 text-xs font-mono pl-3.5 pr-10 py-2.5 focus:outline-none focus:border-white transition-colors"
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
                  className="w-[38px] h-[38px] bg-white text-black hover:bg-neutral-200 disabled:opacity-30 disabled:hover:bg-white transition-all flex items-center justify-center cursor-pointer shrink-0"
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
