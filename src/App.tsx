import React, { useState, useEffect, useMemo } from 'react';
import { PSTask, DeletedTask, TaskTab, FilterMode, WorkflowStats, TaskStepItem, AdaptiveProfile } from './types';
import { TaskCard } from './components/TaskCard';
import { DashboardView } from './components/DashboardView';
import { HistoryView } from './components/HistoryView';
import { TopWorkflowMatrix } from './components/TopWorkflowMatrix';
import { QuickAddDrawer } from './components/QuickAddDrawer';
import { AIAssistantSheet } from './components/AIAssistantSheet';
import { ManageTabsModal } from './components/ManageTabsModal';
import { FireParticlesBackground } from './components/FireParticlesBackground';
import { sound } from './utils/audio';
import {
  Language,
  TRANSLATIONS,
  DEFAULT_TABS_UK,
  DEFAULT_TABS_EN,
  INITIAL_LIFE_TASKS_UK,
  INITIAL_LIFE_TASKS_EN,
  getRandomTabColor,
} from './utils/i18n';
import { SquareCode, Trash, Plus, RotateCcw, CheckCircle, Flame, RefreshCw, Search, X, AlertTriangle, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AIIcon, AIIconId, getSavedAIIconId } from './components/AIIconTemplates';
import { 
  auth, 
  loginWithGoogle, 
  logoutUser, 
  saveUserCloudData, 
  fetchUserCloudData, 
  subscribeToUserCloudData,
  UserCloudState 
} from './services/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { AccountModal } from './components/AccountModal';
import { UpdateModal } from './components/UpdateModal';
import { mergeWorkspace, sameWorkspace, type WorkspaceState } from './utils/syncState';

const STORAGE_KEY = 'life_todo_tasks_v2';
const DELETED_STORAGE_KEY = 'karkas_deleted_tasks_v2';
const TABS_KEY = 'life_todo_tabs_v2';
const LANG_KEY = 'todo_app_lang';
const AI_ICON_KEY = 'karkas_ai_icon_variant';
const FIRE_ENABLED_KEY = 'karkas_fire_enabled';
const SOUND_ENABLED_KEY = 'karkas_sound_enabled';
const LAST_SYNC_KEY = 'karkas_last_sync_time';
const AUTO_SYNC_KEY = 'karkas_auto_sync_enabled';
const APP_CURRENT_VERSION = '1.2.4';

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

function normalizeVersion(version: string): number[] {
  const cleaned = String(version || '').trim().replace(/^v/i, '').split('-')[0];
  const parts = cleaned.split('.').map((part) => Number.parseInt(part, 10) || 0);

  while (parts.length < 3) {
    parts.push(0);
  }

  return parts.slice(0, 3);
}

function compareVersions(a: string, b: string): number {
  const left = normalizeVersion(a);
  const right = normalizeVersion(b);

  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }

  return 0;
}

function sanitizeTasksTimerSafeguard(taskList: PSTask[]): PSTask[] {
  const now = Date.now();
  const todayStr = new Date(now).toDateString();
  return taskList.map((t) => {
    if (t.timerRunning && t.timerStartedAt) {
      const elapsedMs = now - t.timerStartedAt;
      const startedDateStr = new Date(t.timerStartedAt).toDateString();
      if (elapsedMs > TWO_HOURS_MS) {
        // Forgot to turn off timer! Auto-pause and cap session time at max 2 hours (7200s)
        const cappedSeconds = Math.min(Math.floor(elapsedMs / 1000), 7200);
        return {
          ...t,
          timeSpentSeconds: (t.timeSpentSeconds || 0) + cappedSeconds,
          timerRunning: false,
          timerStartedAt: undefined,
          autoPausedOverdue: true,
        };
      }
    }
    return t;
  });
}

export default function App() {
  // Language state: defaults to Ukrainian ('uk')
  const [lang, setLang] = useState<Language>(() => {
    if (typeof window !== 'undefined') {
      try {
        const savedLang = localStorage.getItem(LANG_KEY) as Language;
        if (savedLang === 'uk' || savedLang === 'en') return savedLang;
      } catch (e) {
        console.error(e);
      }
    }
    return 'uk';
  });

  const t = TRANSLATIONS[lang];

  // Tabs state: supports adding, deleting, and renaming tabs
  const [tabs, setTabs] = useState<TaskTab[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(TABS_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            // Ensure all tabs have a color
            return parsed.map((tab: TaskTab, idx: number) => ({
              ...tab,
              color: tab.color || getRandomTabColor(parsed.slice(0, idx)),
            }));
          }
        }
      } catch (e) {
        console.error('Failed to load tabs from localStorage', e);
      }
    }
    return [];
  });

  // Load tasks from localStorage. A new installation starts with an empty workspace.
  const [tasks, setTasks] = useState<PSTask[]>(() => {
    let loaded: PSTask[] = [];
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            loaded = parsed.map((t: PSTask) => {
              if (t.phase === 'DASHBOARD' || t.phase === 'ALL') {
                return { ...t, phase: 'focus' };
              }
              return t;
            });
          }
        } else {
          // Check legacy key
          const legacy = localStorage.getItem('ps_todo_tasks_v1');
          if (legacy) {
            const parsedLegacy = JSON.parse(legacy);
            if (Array.isArray(parsedLegacy) && parsedLegacy.length > 0) {
              loaded = parsedLegacy.map((t: PSTask) => {
                if (t.phase === 'DASHBOARD' || t.phase === 'ALL') {
                  return { ...t, phase: 'focus' };
                }
                return t;
              });
            }
          }
        }
      } catch (e) {
        console.error('Failed to load tasks from localStorage', e);
      }
    }
    return sanitizeTasksTimerSafeguard(loaded);
  });

  // Periodic safeguard check for forgotten running timers (e.g., left running overnight)
  useEffect(() => {
    const interval = setInterval(() => {
      setTasks((prev) => {
        let hasChanges = false;
        const now = Date.now();
        const todayStr = new Date(now).toDateString();
        const updated = prev.map((t) => {
          if (t.timerRunning && t.timerStartedAt) {
            const elapsedMs = now - t.timerStartedAt;
            const startedDateStr = new Date(t.timerStartedAt).toDateString();
            if (elapsedMs > TWO_HOURS_MS) {
              hasChanges = true;
              const cappedSeconds = Math.min(Math.floor(elapsedMs / 1000), 7200);
              return {
                ...t,
                timeSpentSeconds: (t.timeSpentSeconds || 0) + cappedSeconds,
                timerRunning: false,
                timerStartedAt: undefined,
                autoPausedOverdue: true,
              };
            }
          }
          return t;
        });
        return hasChanges ? updated : prev;
      });
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const [activeFilter, setActiveFilter] = useState<FilterMode>('ALL');
  const [selectedPhase, setSelectedPhase] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const hash = window.location.hash;
      if (hash === '#dashboard') return 'DASHBOARD';
      if (hash === '#history') return 'HISTORY';
    }
    return 'ALL';
  });
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isAIOpen, setIsAIOpen] = useState(false);
  const [isManageTabsOpen, setIsManageTabsOpen] = useState(false);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [isUpdateOpen, setIsUpdateOpen] = useState(false);
  const [availableNewRelease, setAvailableNewRelease] = useState<{ tag_name: string; name?: string } | null>(null);

  // Background automated version analyzer: checks if a newer version exists
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/check-update');
        if (res.ok) {
          const data = await res.json();
          if (data && data.tag_name) {
            if (compareVersions(data.tag_name, APP_CURRENT_VERSION) > 0) {
              const dismissed = sessionStorage.getItem('karkas_dismissed_update');
              if (dismissed !== data.tag_name) {
                setAvailableNewRelease(data);
              }
            }
          }
        }
      } catch {
        // Silent background check fallback
      }
    }, 2500);

    return () => clearTimeout(timer);
  }, []);
  const [aiIconVariant, setAiIconVariant] = useState<AIIconId>(() => {
    return getSavedAIIconId();
  });
  const [aiPromptSeed, setAiPromptSeed] = useState('');
  const [breakingDownTaskId, setBreakingDownTaskId] = useState<string | null>(null);
  const [isWindowMinimized, setIsWindowMinimized] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [tabToDeleteConfirm, setTabToDeleteConfirm] = useState<TaskTab | null>(null);
  const [showGesturesLegend, setShowGesturesLegend] = useState(() => localStorage.getItem('karkas_show_gestures_legend') !== 'false');
  const searchInputRef = React.useRef<HTMLInputElement | null>(null);

  // Sync fullscreen state with browser fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Global Keyboard Shortcuts (Escape, Ctrl+N, Ctrl+Shift+F, '/')
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const targetTag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      const isInputFocused =
        targetTag === 'input' || targetTag === 'textarea' || (e.target as HTMLElement)?.isContentEditable;

      if (e.key === 'Escape') {
        if (isAIOpen) setIsAIOpen(false);
        else if (isAccountOpen) setIsAccountOpen(false);
        else if (isManageTabsOpen) setIsManageTabsOpen(false);
        else if (isUpdateOpen) setIsUpdateOpen(false);
        else if (isAddOpen) setIsAddOpen(false);
        else if (isWindowMinimized) setIsWindowMinimized(false);
        else if (searchQuery) setSearchQuery('');
        return;
      }

      // Ctrl + Shift + F / Cmd + Shift + F -> Toggle Fire Animation
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        sound.tick(600);
        setFireEnabled((prev) => !prev);
        return;
      }

      // Ctrl + N / Cmd + N -> Open Quick Add Drawer
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        sound.tick(600);
        setIsAddOpen(true);
        return;
      }

      // '/' (Slash) -> Focus Search Input
      if (e.key === '/' && !isInputFocused) {
        e.preventDefault();
        sound.tick(500);
        searchInputRef.current?.focus();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isAIOpen, isAccountOpen, isManageTabsOpen, isUpdateOpen, isAddOpen, isWindowMinimized, searchQuery]);

  const handleToggleFullscreen = () => {
    sound.tick(500);
    if (!document.fullscreenElement) {
      if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {
          setIsFullscreen((prev) => !prev);
        });
      } else {
        setIsFullscreen((prev) => !prev);
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {
          setIsFullscreen(false);
        });
      } else {
        setIsFullscreen(false);
      }
    }
  };

  const handleMinimizeWindow = () => {
    sound.tick(400);
    setIsWindowMinimized(true);
  };

  const handleCloseWindow = () => {
    sound.tick(300);
    setIsWindowMinimized(true);
  };

  // Auto-break down a specific task via AI
  const handleAIBreakdownTask = async (taskId: string) => {
    const targetTask = tasks.find((t) => t.id === taskId);
    if (!targetTask || breakingDownTaskId) return;

    setBreakingDownTaskId(taskId);
    sound.activate();

    try {
      const activeTasks = tasks.filter((t) => !t.done);
      const completedTasks = tasks.filter((t) => t.done);

      const customKey = localStorage.getItem('karkas_custom_api_key') || '';
      const customModel = localStorage.getItem('karkas_custom_model') || '';
      const customEnabled = localStorage.getItem('karkas_custom_ai_enabled') === 'true';

      const res = await fetch('/api/ai/breakdown-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: targetTask.id,
          title: targetTask.title,
          note: targetTask.note,
          currentSteps: targetTask.stepList?.map((s) => s.title) || [],
          lang,
          customApiKey: customEnabled ? customKey : undefined,
          selectedModel: customEnabled ? customModel : undefined,
          fullAppContext: {
            activeTasks: activeTasks.map((t) => ({ title: t.title, phase: t.phase, priority: t.priority })),
            completedTasks: completedTasks.map((t) => ({ title: t.title, phase: t.phase })),
            deletedTasks: deletedTasks.slice(0, 10).map((t) => ({ title: t.title })),
            tabs: tabs.map((tb) => ({ id: tb.id, name: tb.name })),
            stats,
          },
        }),
      });

      if (!res.ok) throw new Error('API breakdown failed');
      const data = await res.json();
      const rawSteps = Array.isArray(data.stepList) ? data.stepList : Array.isArray(data.steps) ? data.steps : [];

      if (rawSteps.length > 0) {
        const newStepItems: TaskStepItem[] = rawSteps.map((st: any, idx: number) => ({
          id: st.id || `s-${taskId}-${Date.now()}-${idx}`,
          title: typeof st === 'string' ? st : st.title || `Крок ${idx + 1}`,
          done: false,
        }));

        setTasks((prev) =>
          prev.map((t) => {
            if (t.id === taskId) {
              return {
                ...t,
                stepList: newStepItems,
                steps: newStepItems.length,
                currentStep: 0,
                done: false,
                note: data.note || t.note,
                priority: data.suggestedPriority === 1 || data.suggestedPriority === 2 || data.suggestedPriority === 3
                  ? data.suggestedPriority
                  : t.priority,
              };
            }
            return t;
          })
        );
        sound.activate();
      }
    } catch (err) {
      console.error('Task breakdown error:', err);
      // Resilient fallback breakdown if network or API key is absent
      const isUk = lang === 'uk';
      const fallbackSteps: TaskStepItem[] = [
        {
          id: `s-${taskId}-${Date.now()}-0`,
          title: isUk ? `Підготовка та збір контексту` : `Preparation & context review`,
          done: false,
        },
        {
          id: `s-${taskId}-${Date.now()}-1`,
          title: isUk ? `Основне виконання завдання` : `Primary execution phase`,
          done: false,
        },
        {
          id: `s-${taskId}-${Date.now()}-2`,
          title: isUk ? `Фінальна перевірка та закриття` : `Verification & completion`,
          done: false,
        },
      ];
      setTasks((prev) =>
        prev.map((t) => {
          if (t.id === taskId) {
            return {
              ...t,
              stepList: fallbackSteps,
              steps: fallbackSteps.length,
              currentStep: 0,
              done: false,
            };
          }
          return t;
        })
      );
      sound.activate();
    } finally {
      setBreakingDownTaskId(null);
    }
  };
  const [soundEnabled, setSoundEnabled] = useState(() => {
    try {
      return localStorage.getItem(SOUND_ENABLED_KEY) !== 'false';
    } catch (e) {
      console.error('Failed to load sound state', e);
      return true;
    }
  });
  React.useLayoutEffect(() => {
    sound.enabled = soundEnabled;
    try {
      localStorage.setItem(SOUND_ENABLED_KEY, String(soundEnabled));
    } catch (e) {
      console.error('Failed to save sound state', e);
    }
  }, [soundEnabled]);
  const [recentlyDeleted, setRecentlyDeleted] = useState<PSTask | null>(null);

  // Auto-dismiss "Task deleted" undo toast after 10 seconds
  useEffect(() => {
    if (!recentlyDeleted) return;
    const timer = setTimeout(() => {
      setRecentlyDeleted(null);
    }, 10000);
    return () => clearTimeout(timer);
  }, [recentlyDeleted]);

  // Google Cloud Auth & Sync state
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<number | null>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(LAST_SYNC_KEY);
      return saved ? Number(saved) : null;
    }
    return null;
  });
  const [autoSyncEnabled, setAutoSyncEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(AUTO_SYNC_KEY);
        if (saved !== null) return saved === 'true';
      } catch (e) {
        console.error('Failed to load auto sync state', e);
      }
    }
    return true;
  });
  const [cloudData, setCloudData] = useState<UserCloudState | null>(null);
  const [isCloudSyncReady, setIsCloudSyncReady] = useState(false);

  const cloudSyncReadyRef = React.useRef(false);

  // Fire particles background toggle state
  const [fireEnabled, setFireEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(FIRE_ENABLED_KEY);
        if (saved !== null) return saved === 'true';
      } catch (e) {
        console.error('Failed to load fire animation state', e);
      }
    }
    return true;
  });

  // Sync fireEnabled with localStorage
  useEffect(() => {
    try {
      localStorage.setItem(FIRE_ENABLED_KEY, String(fireEnabled));
    } catch (e) {
      console.error('Failed to save fire animation state', e);
    }
  }, [fireEnabled]);

  // Deleted tasks archive state
  const [deletedTasks, setDeletedTasks] = useState<DeletedTask[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(DELETED_STORAGE_KEY);
        if (saved) return JSON.parse(saved);
      } catch (e) {
        console.error('Failed to load deleted tasks from localStorage', e);
      }
    }
    return [];
  });

  // Track state values inside refs to avoid re-subscribing Firestore listener unnecessarily
  const currentTasksRef = React.useRef(tasks);
  currentTasksRef.current = tasks;
  const currentTabsRef = React.useRef(tabs);
  currentTabsRef.current = tabs;
  const currentDeletedTasksRef = React.useRef(deletedTasks);
  currentDeletedTasksRef.current = deletedTasks;
  const currentSoundEnabledRef = React.useRef(soundEnabled);
  currentSoundEnabledRef.current = soundEnabled;
  const currentFireEnabledRef = React.useRef(fireEnabled);
  currentFireEnabledRef.current = fireEnabled;
  const currentLangRef = React.useRef(lang);
  currentLangRef.current = lang;
  const currentAiIconVariantRef = React.useRef(aiIconVariant);
  currentAiIconVariantRef.current = aiIconVariant;

  // Persist each committed change before paint, with no pending timer on close.
  React.useLayoutEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    } catch (e) {
      console.error('Failed to save tasks to localStorage', e);
    }
  }, [tasks]);

  // Sync deletedTasks with localStorage
  useEffect(() => {
    try {
      localStorage.setItem(DELETED_STORAGE_KEY, JSON.stringify(deletedTasks));
    } catch (e) {
      console.error('Failed to save deleted tasks to localStorage', e);
    }
  }, [deletedTasks]);

  // Sync tabs with localStorage
  useEffect(() => {
    try {
      localStorage.setItem(TABS_KEY, JSON.stringify(tabs));
    } catch (e) {
      console.error('Failed to save tabs to localStorage', e);
    }
  }, [tabs]);

  // Sync lang with localStorage
  useEffect(() => {
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch (e) {
      console.error('Failed to save lang to localStorage', e);
    }
  }, [lang]);

  // Hash synchronization for Dashboard and History views
  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (selectedPhase === 'DASHBOARD') {
        window.location.hash = '#dashboard';
      } else if (selectedPhase === 'HISTORY') {
        window.location.hash = '#history';
      } else if (window.location.hash === '#dashboard' || window.location.hash === '#history') {
        history.replaceState(null, '', window.location.pathname);
      }
    }
  }, [selectedPhase]);

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;
      if (hash === '#dashboard') setSelectedPhase('DASHBOARD');
      else if (hash === '#history') setSelectedPhase('HISTORY');
      else if (selectedPhase === 'DASHBOARD' || selectedPhase === 'HISTORY') setSelectedPhase('ALL');
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [selectedPhase]);

  // Account snapshots retain unsent edits across reloads and sign-out.
  const workspaceOwnerRef = React.useRef<string | null>(localStorage.getItem('karkas_workspace_owner'));
  const baseWorkspaceRef = React.useRef<(WorkspaceState & { revision?: number }) | null>(undefined);
  if (baseWorkspaceRef.current === undefined) {
    try {
      const cached = localStorage.getItem('karkas_workspace:' + (workspaceOwnerRef.current || 'guest'));
      baseWorkspaceRef.current = cached ? JSON.parse(cached).base || null : null;
    } catch { baseWorkspaceRef.current = null; }
  }
  const authGenerationRef = React.useRef(0);
  const savingRef = React.useRef<number | null>(null);
  const queuedRemoteRef = React.useRef<UserCloudState | null>(null);
  const autoSyncEnabledRef = React.useRef(autoSyncEnabled);
  autoSyncEnabledRef.current = autoSyncEnabled;
  const accountKey = (uid: string | null) => 'karkas_workspace:' + (uid || 'guest');
  const readWorkspace = (): WorkspaceState => ({
    tasks: currentTasksRef.current,
    tabs: currentTabsRef.current,
    deletedTasks: currentDeletedTasksRef.current,
    settings: {
      soundEnabled: currentSoundEnabledRef.current,
      fireEnabled: currentFireEnabledRef.current,
      lang: currentLangRef.current,
      aiIconVariant: currentAiIconVariantRef.current,
    },
  });
  const persistWorkspace = () => {
    localStorage.setItem(accountKey(workspaceOwnerRef.current), JSON.stringify({
      workspace: readWorkspace(), base: baseWorkspaceRef.current,
    }));
  };
  const applyWorkspace = (value: WorkspaceState) => {
    currentTasksRef.current = value.tasks;
    currentTabsRef.current = value.tabs;
    currentDeletedTasksRef.current = value.deletedTasks;
    currentSoundEnabledRef.current = value.settings.soundEnabled;
    currentFireEnabledRef.current = value.settings.fireEnabled;
    currentLangRef.current = value.settings.lang as Language;
    currentAiIconVariantRef.current = value.settings.aiIconVariant as AIIconId;
    setTasks(value.tasks);
    setTabs(value.tabs);
    setDeletedTasks(value.deletedTasks);
    setSoundEnabled(value.settings.soundEnabled);
    sound.enabled = value.settings.soundEnabled;
    setFireEnabled(value.settings.fireEnabled);
    setLang(value.settings.lang as Language);
    setAiIconVariant(value.settings.aiIconVariant as AIIconId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value.tasks));
    localStorage.setItem(TABS_KEY, JSON.stringify(value.tabs));
    localStorage.setItem(DELETED_STORAGE_KEY, JSON.stringify(value.deletedTasks));
    localStorage.setItem(AI_ICON_KEY, value.settings.aiIconVariant);
    persistWorkspace();
  };

  React.useLayoutEffect(() => {
    try { persistWorkspace(); } catch (error) {
      console.error('Local account backup failed:', error);
    }
  }, [tasks, tabs, deletedTasks, soundEnabled, fireEnabled, lang, aiIconVariant]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      const generation = ++authGenerationRef.current;
      savingRef.current = null;
      queuedRemoteRef.current = null;
      const uid = user?.uid || null;
      cloudSyncReadyRef.current = false;
      setIsCloudSyncReady(false);
      setCurrentUser(user);
      setCloudData(null);
      setLastSyncTime(null);
      try {
        const previousOwner = workspaceOwnerRef.current;
        const cachedText = localStorage.getItem(accountKey(uid));
        const cached = cachedText ? JSON.parse(cachedText) : null;
        if (previousOwner !== uid) {
          persistWorkspace();
          setRecentlyDeleted(null);
          setTabToDeleteConfirm(null);
          setSelectedPhase('ALL');
          setIsAIOpen(false);
          setIsAddOpen(false);
          setIsManageTabsOpen(false);
        }
        workspaceOwnerRef.current = uid;
        if (uid) localStorage.setItem('karkas_workspace_owner', uid);
        else localStorage.removeItem('karkas_workspace_owner');
        baseWorkspaceRef.current = cached?.base || null;
        if (cached?.workspace) {
          applyWorkspace(cached.workspace);
        } else if (previousOwner !== uid && previousOwner !== null) {
          applyWorkspace({
            tasks: [], tabs: [], deletedTasks: [],
            settings: { soundEnabled: true, fireEnabled: true, lang: 'uk', aiIconVariant: 'quantum' },
          });
        }
        if (!user) return;
        setIsSyncing(true);
        const data = await fetchUserCloudData(user.uid);
        if (generation !== authGenerationRef.current || auth.currentUser?.uid !== user.uid) return;
        if (data) {
          if ((data.revision || 0) < (baseWorkspaceRef.current?.revision || 0)) return;
          if (cached?.workspace && !autoSyncEnabledRef.current) {
            setCloudData(data);
            return;
          }
          const merged = mergeWorkspace(baseWorkspaceRef.current, readWorkspace(), data);
          baseWorkspaceRef.current = data;
          applyWorkspace(merged);
          setCloudData(data);
          setLastSyncTime(data.updatedAt);
          localStorage.setItem(LAST_SYNC_KEY, String(data.updatedAt));
        } else {
          persistWorkspace();
        }
      } catch (error) {
        console.error('Cloud initialization failed; local account data retained:', error);
      } finally {
        if (generation === authGenerationRef.current) {
          cloudSyncReadyRef.current = Boolean(user);
          setIsCloudSyncReady(Boolean(user));
          setIsSyncing(false);
        }
      }
    });
    return () => { ++authGenerationRef.current; unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!currentUser || !autoSyncEnabled || !isCloudSyncReady) return;
    const uid = currentUser.uid;
    return subscribeToUserCloudData(uid, (remote) => {
      if (auth.currentUser?.uid !== uid || workspaceOwnerRef.current !== uid) return;
      if ((remote.revision || 0) < (baseWorkspaceRef.current?.revision || 0)) return;
      if (savingRef.current !== null) {
        queuedRemoteRef.current = remote;
        return;
      }
      const merged = mergeWorkspace(baseWorkspaceRef.current, readWorkspace(), remote);
      baseWorkspaceRef.current = remote;
      if (!sameWorkspace(readWorkspace(), merged)) applyWorkspace(merged);
      else persistWorkspace();
      setCloudData(remote);
      setLastSyncTime(remote.updatedAt);
    }, (error) => console.warn('Cloud listener failed; local data retained:', error));
  }, [currentUser, autoSyncEnabled, isCloudSyncReady]);

  const performAutoSave = React.useCallback(async (manual = false) => {
    const uid = currentUser?.uid;
    if (!uid || auth.currentUser?.uid !== uid || workspaceOwnerRef.current !== uid ||
        !cloudSyncReadyRef.current || (!manual && !autoSyncEnabledRef.current) || savingRef.current !== null) {
      if (manual) throw new Error('Synchronization is not ready or already in progress');
      return;
    }
    const submitted = readWorkspace();
    persistWorkspace();
    if (baseWorkspaceRef.current && sameWorkspace(baseWorkspaceRef.current, submitted)) return;
    const generation = authGenerationRef.current;
    savingRef.current = generation;
    setIsSyncing(true);
    try {
      const saved = await saveUserCloudData(uid, submitted, baseWorkspaceRef.current);
      if (generation !== authGenerationRef.current || auth.currentUser?.uid !== uid) return;
      // Keep edits made while the transaction was in flight.
      const queued = queuedRemoteRef.current;
      queuedRemoteRef.current = null;
      const latest = queued && (queued.revision || 0) > (saved.revision || 0) ? queued : saved;
      const merged = mergeWorkspace(submitted, readWorkspace(), latest);
      baseWorkspaceRef.current = latest;
      applyWorkspace(merged);
      setCloudData(latest);
      setLastSyncTime(latest.updatedAt);
      localStorage.setItem(LAST_SYNC_KEY, String(latest.updatedAt));
    } finally {
      if (generation === authGenerationRef.current) {
        savingRef.current = null;
        const queued = queuedRemoteRef.current;
        queuedRemoteRef.current = null;
        if (queued) {
          const merged = mergeWorkspace(baseWorkspaceRef.current, readWorkspace(), queued);
          baseWorkspaceRef.current = queued;
          applyWorkspace(merged);
          setCloudData(queued);
        }
        setIsSyncing(false);
      }
    }
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser || !autoSyncEnabled || !isCloudSyncReady) return;
    const timer = setTimeout(() => {
      performAutoSave().catch((error) => console.error('Cloud save failed; local changes retained:', error));
    }, 800);
    return () => clearTimeout(timer);
  }, [currentUser, autoSyncEnabled, isCloudSyncReady, tasks, tabs, deletedTasks,
      soundEnabled, fireEnabled, lang, aiIconVariant, cloudData, performAutoSave]);

  useEffect(() => {
    const flushLocal = () => {
      try { persistWorkspace(); } catch (error) { console.error('Local backup failed:', error); }
    };
    const retry = () => performAutoSave().catch((error) => console.error('Cloud retry failed:', error));
    const hidden = () => { if (document.visibilityState === 'hidden') { flushLocal(); void retry(); } };
    window.addEventListener('pagehide', flushLocal);
    window.addEventListener('beforeunload', flushLocal);
    window.addEventListener('online', retry);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('pagehide', flushLocal);
      window.removeEventListener('beforeunload', flushLocal);
      window.removeEventListener('online', retry);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [performAutoSave]);

  const handleToggleAutoSync = () => {
    const next = !autoSyncEnabled;
    autoSyncEnabledRef.current = next;
    setAutoSyncEnabled(next);
    localStorage.setItem(AUTO_SYNC_KEY, String(next));
  };

  const handleLoginWithGoogle = async () => { await loginWithGoogle(); };

  const handleLogout = async () => {
    // A synchronous account-specific backup also works offline or with sync disabled.
    persistWorkspace();
    await logoutUser();
    setSelectedPhase('ALL');
  };

  const handleSyncNow = async () => { await performAutoSave(true); };

  const handleRestoreFromCloud = async () => {
    const uid = currentUser?.uid;
    if (!uid || savingRef.current !== null) throw new Error('Synchronization is already in progress');
    const generation = authGenerationRef.current;
    savingRef.current = generation;
    setIsSyncing(true);
    try {
      const data = await fetchUserCloudData(uid);
      if (generation !== authGenerationRef.current || auth.currentUser?.uid !== uid) return;
      if (!data) throw new Error('No cloud backup exists');
      // Retain a recovery copy before an explicitly requested restore.
      localStorage.setItem(accountKey(uid) + ':before-restore', JSON.stringify(readWorkspace()));
      baseWorkspaceRef.current = data;
      applyWorkspace(data);
      setCloudData(data);
      setLastSyncTime(data.updatedAt);
    } finally {
      if (generation === authGenerationRef.current) {
        savingRef.current = null;
        const queued = queuedRemoteRef.current;
        queuedRemoteRef.current = null;
        if (queued && (queued.revision || 0) > (baseWorkspaceRef.current?.revision || 0)) {
          const merged = mergeWorkspace(baseWorkspaceRef.current, readWorkspace(), queued);
          baseWorkspaceRef.current = queued;
          applyWorkspace(merged);
          setCloudData(queued);
        }
        setIsSyncing(false);
      }
    }
  };

  const handleToggleLang = () => {
    const nextLang: Language = lang === 'uk' ? 'en' : 'uk';
    setLang(nextLang);
    sound.tick(650);
  };

  // Compute live stats per tab
  const stats: WorkflowStats = useMemo(() => {
    const total = tasks.length;
    const completed = tasks.filter((t) => t.done).length;
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

    const phaseCounts: Record<string, number> = {};
    tabs.forEach((tb) => {
      phaseCounts[tb.id] = 0;
    });

    tasks.forEach((t) => {
      phaseCounts[t.phase] = (phaseCounts[t.phase] || 0) + 1;
    });

    return { total, completed, percent, phaseCounts };
  }, [tasks, tabs]);

  const adaptiveProfile: AdaptiveProfile = useMemo(() => {
    const completedTasks = tasks.filter((task) => task.done && task.completedAt);
    const trackedTasks = tasks.length + deletedTasks.length;
    const completionRate = trackedTasks > 0 ? Math.round((completedTasks.length / trackedTasks) * 100) : 0;
    const averageCompletionMinutes = completedTasks.length > 0
      ? Math.round(completedTasks.reduce((total, task) => total + (task.timeSpentSeconds || 0), 0) / completedTasks.length / 60)
      : 0;
    const tasksWithSteps = tasks.filter((task) => task.steps > 0);
    const averageStepCount = tasksWithSteps.length > 0
      ? Math.round((tasksWithSteps.reduce((total, task) => total + task.steps, 0) / tasksWithSteps.length) * 10) / 10
      : 0;
    const completedByPhase = new Map<string, number>();
    const activeByPhase = new Map<string, number>();
    tasks.forEach((task) => {
      const bucket = task.done ? completedByPhase : activeByPhase;
      bucket.set(task.phase, (bucket.get(task.phase) || 0) + 1);
    });
    const preferredPhases = [...completedByPhase.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([phase]) => phase);
    const overloadedPhases = [...activeByPhase.entries()]
      .filter(([, count]) => count >= 4)
      .sort((a, b) => b[1] - a[1])
      .map(([phase]) => phase);
    const activeLoad = tasks.filter((task) => !task.done).length;
    const urgentLoad = tasks.filter((task) => !task.done && task.priority === 1).length;

    return {
      trackedTasks,
      completedTasks: completedTasks.length,
      completionRate,
      averageCompletionMinutes,
      averageStepCount,
      preferredPhases,
      overloadedPhases,
      activeLoad,
      urgentLoad,
      recommendedActiveLimit: urgentLoad >= 3 || activeLoad >= 8 ? 3 : 5,
    };
  }, [tasks, deletedTasks]);

  // Filtered & Sorted Tasks (Running timers & Pinned on top, then by search, priority, creation)
  const filteredTasks = useMemo(() => {
    return tasks
      .filter((t) => {
        if (activeFilter === 'ACTIVE' && t.done) return false;
        if (activeFilter === 'DONE' && !t.done) return false;
        if (selectedPhase !== 'ALL' && selectedPhase !== 'DASHBOARD' && t.phase !== selectedPhase) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase().trim();
          const titleMatch = t.title.toLowerCase().includes(q);
          const noteMatch = t.note ? t.note.toLowerCase().includes(q) : false;
          const stepMatch = t.stepList ? t.stepList.some((s) => s.title.toLowerCase().includes(q)) : false;
          return titleMatch || noteMatch || stepMatch;
        }
        return true;
      })
      .sort((a, b) => {
        // Active timer running tasks pinned on very top!
        if (a.timerRunning && !b.timerRunning) return -1;
        if (!a.timerRunning && b.timerRunning) return 1;
        // Pinned first
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        // Incomplete first
        if (!a.done && b.done) return -1;
        if (a.done && !b.done) return 1;
        // Priority (1 is high, 2 standard, 3 low)
        if (a.priority !== b.priority) return a.priority - b.priority;
        return b.createdAt - a.createdAt;
      });
  }, [tasks, activeFilter, selectedPhase, searchQuery]);

  // Edit Task Title and Note
  const handleEditTask = (id: string, updatedTitle: string, updatedNote?: string) => {
    sound.activate();
    setTasks((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, title: updatedTitle.trim(), note: updatedNote?.trim() || undefined } : t
      )
    );
  };

  // Tab management handlers
  const handleAddTab = (name: string, customColor?: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const baseId = trimmed.toLowerCase().replace(/[^a-zа-яіїєґ0-9]+/gi, '_');
    const id = baseId.length > 0 ? `${baseId}_${Date.now().toString(36).slice(-3)}` : `tab_${Date.now()}`;
    const color = customColor || getRandomTabColor(tabs);
    const newTab: TaskTab = { id, name: trimmed, color };
    setTabs((prev) => [...prev, newTab]);
    setSelectedPhase(id);
  };

  const handleDeleteTab = (tabId: string) => {
    if (tabs.length <= 1) return;
    const tabToDel = tabs.find((tb) => tb.id === tabId);
    if (tabToDel) {
      sound.tick(400);
      setTabToDeleteConfirm(tabToDel);
    }
  };

  const handleConfirmDeleteTab = () => {
    if (!tabToDeleteConfirm || tabs.length <= 1) return;
    const tabId = tabToDeleteConfirm.id;
    const remaining = tabs.filter((tb) => tb.id !== tabId);
    setTabs(remaining);

    if (selectedPhase === tabId) {
      setSelectedPhase('ALL');
    }

    // Safely migrate tasks from deleted tab to the first remaining tab
    const fallbackTabId = remaining[0]?.id || 'focus';
    setTasks((prev) =>
      prev.map((t) => (t.phase === tabId ? { ...t, phase: fallbackTabId } : t))
    );

    sound.tick(300);
    setTabToDeleteConfirm(null);
  };

  const handleSetPresetTabs = (preset: TaskTab[]) => {
    setTabs(preset);
    const validTabIds = new Set(preset.map((t) => t.id));
    const fallbackTabId = preset[0]?.id || 'focus';
    setTasks((prev) =>
      prev.map((t) => (validTabIds.has(t.phase) ? t : { ...t, phase: fallbackTabId }))
    );
    if (
      selectedPhase !== 'ALL' &&
      selectedPhase !== 'DASHBOARD' &&
      selectedPhase !== 'HISTORY' &&
      !validTabIds.has(selectedPhase)
    ) {
      setSelectedPhase('ALL');
    }
  };

  // Task Actions
  const handleToggleDone = (id: string) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id === id) {
          const nextDone = !t.done;
          let updatedStepList: { id: string; title: string; done: boolean }[] | undefined = undefined;

          if (t.stepList && t.stepList.length > 0) {
            if (nextDone) {
              updatedStepList = t.stepList.map((s) => ({ ...s, done: true }));
            } else {
              // Reopening: uncheck the last completed step so progress accurately reflects reopening
              const lastDoneIdx = t.stepList.map((s) => s.done).lastIndexOf(true);
              if (lastDoneIdx >= 0) {
                updatedStepList = t.stepList.map((s, idx) => ({
                  ...s,
                  done: idx === lastDoneIdx ? false : s.done,
                }));
              } else {
                updatedStepList = t.stepList.map((s) => ({ ...s, done: false }));
              }
            }
          }

          const completedCount = updatedStepList
            ? updatedStepList.filter((s) => s.done).length
            : nextDone
            ? t.steps
            : Math.max(0, t.steps - 1);

          // If completing task while timer is running, bank elapsed time and pause
          let updatedTimeSpent = t.timeSpentSeconds || 0;
          let timerRunning = t.timerRunning;
          let timerStartedAt = t.timerStartedAt;
          if (nextDone && t.timerRunning && t.timerStartedAt) {
            const elapsed = Math.floor((Date.now() - t.timerStartedAt) / 1000);
            updatedTimeSpent += Math.max(0, elapsed);
            timerRunning = false;
            timerStartedAt = undefined;
          }

          return {
            ...t,
            done: nextDone,
            stepList: updatedStepList,
            currentStep: completedCount,
            completedAt: nextDone ? (t.completedAt || Date.now()) : undefined,
            timeSpentSeconds: updatedTimeSpent,
            timerRunning,
            timerStartedAt,
          };
        }
        return t;
      })
    );
  };

  const handleToggleTimer = (id: string) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id === id) {
          const isCurrentlyRunning = !!t.timerRunning;
          if (isCurrentlyRunning) {
            // Pause timer and bank elapsed seconds
            const sessionElapsed = t.timerStartedAt ? Math.floor((Date.now() - t.timerStartedAt) / 1000) : 0;
            const newTotal = (t.timeSpentSeconds || 0) + Math.max(0, sessionElapsed);
            sound.tick(400);
            return {
              ...t,
              timeSpentSeconds: newTotal,
              timerRunning: false,
              timerStartedAt: undefined,
            };
          } else {
            // Start / resume timer
            sound.tick(650);
            return {
              ...t,
              timerRunning: true,
              timerStartedAt: Date.now(),
            };
          }
        }
        return t;
      })
    );
  };

  const handleResetTimer = (id: string) => {
    sound.tick(300);
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id === id) {
          return {
            ...t,
            timeSpentSeconds: 0,
            timerRunning: false,
            timerStartedAt: undefined,
          };
        }
        return t;
      })
    );
  };

  const handleUpdateTimeSpent = (id: string, newTotalSeconds: number) => {
    sound.tick(500);
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id === id) {
          return {
            ...t,
            timeSpentSeconds: Math.max(0, newTotalSeconds),
            timerStartedAt: t.timerRunning ? Date.now() : undefined,
            autoPausedOverdue: false,
          };
        }
        return t;
      })
    );
  };

  const handleUpdateStep = (id: string, step: number) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id === id) {
          const nextDone = step >= t.steps;
          const updatedStepList = t.stepList
            ? t.stepList.map((s, idx) => ({ ...s, done: idx < step }))
            : undefined;

          let updatedTimeSpent = t.timeSpentSeconds || 0;
          let timerRunning = t.timerRunning;
          let timerStartedAt = t.timerStartedAt;
          if (nextDone && t.timerRunning && t.timerStartedAt) {
            const elapsed = Math.floor((Date.now() - t.timerStartedAt) / 1000);
            updatedTimeSpent += Math.max(0, elapsed);
            timerRunning = false;
            timerStartedAt = undefined;
          }

          return {
            ...t,
            currentStep: step,
            stepList: updatedStepList,
            done: nextDone,
            completedAt: nextDone ? (t.completedAt || Date.now()) : undefined,
            timeSpentSeconds: updatedTimeSpent,
            timerRunning,
            timerStartedAt,
          };
        }
        return t;
      })
    );
  };

  const handleToggleStepItem = (taskId: string, stepIndex: number) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id === taskId) {
          const defaultCount = Math.max(1, t.steps || 1);
          // If task doesn't have custom stepList yet, create from count
          const currentList =
            t.stepList && t.stepList.length > 0
              ? [...t.stepList]
              : Array.from({ length: defaultCount }, (_, idx) => ({
                  id: `s-${t.id}-${idx}`,
                  title: `${lang === 'uk' ? 'Крок' : 'Step'} ${idx + 1}`,
                  done: idx < t.currentStep,
                }));

          while (stepIndex >= currentList.length) {
            const idx = currentList.length;
            currentList.push({
              id: `s-${t.id}-${idx}-${Date.now()}`,
              title: `${lang === 'uk' ? 'Крок' : 'Step'} ${idx + 1}`,
              done: false,
            });
          }

          const updatedStepList = currentList.map((item, idx) =>
            idx === stepIndex ? { ...item, done: !item.done } : item
          );
          const completedCount = updatedStepList.filter((s) => s.done).length;
          const isAllDone = completedCount === updatedStepList.length && updatedStepList.length > 0;

          let updatedTimeSpent = t.timeSpentSeconds || 0;
          let timerRunning = t.timerRunning;
          let timerStartedAt = t.timerStartedAt;
          if (isAllDone && !t.done && t.timerRunning && t.timerStartedAt) {
            const elapsed = Math.floor((Date.now() - t.timerStartedAt) / 1000);
            updatedTimeSpent += Math.max(0, elapsed);
            timerRunning = false;
            timerStartedAt = undefined;
          }

          return {
            ...t,
            stepList: updatedStepList,
            steps: updatedStepList.length,
            currentStep: completedCount,
            done: isAllDone,
            completedAt: isAllDone ? (t.completedAt || Date.now()) : undefined,
            timeSpentSeconds: updatedTimeSpent,
            timerRunning,
            timerStartedAt,
          };
        }
        return t;
      })
    );
  };

  const handleAddStepItem = (taskId: string, stepTitle: string) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id === taskId) {
          const currentList = t.stepList || [];
          const newStepItem = {
            id: `s-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            title: stepTitle,
            done: false,
          };
          const nextList = [...currentList, newStepItem];
          return {
            ...t,
            stepList: nextList,
            steps: nextList.length,
            done: false,
          };
        }
        return t;
      })
    );
  };

  const handleDeleteStepItem = (taskId: string, stepIndex: number) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id === taskId && t.stepList) {
          const nextList = t.stepList.filter((_, idx) => idx !== stepIndex);
          const completedCount = nextList.filter((s) => s.done).length;
          const isAllDone = nextList.length > 0 && completedCount === nextList.length;

          let updatedTimeSpent = t.timeSpentSeconds || 0;
          let timerRunning = t.timerRunning;
          let timerStartedAt = t.timerStartedAt;
          if (isAllDone && !t.done && t.timerRunning && t.timerStartedAt) {
            const elapsed = Math.floor((Date.now() - t.timerStartedAt) / 1000);
            updatedTimeSpent += Math.max(0, elapsed);
            timerRunning = false;
            timerStartedAt = undefined;
          }

          return {
            ...t,
            stepList: nextList,
            steps: Math.max(1, nextList.length),
            currentStep: completedCount,
            done: isAllDone,
            completedAt: isAllDone ? (t.completedAt || Date.now()) : undefined,
            timeSpentSeconds: updatedTimeSpent,
            timerRunning,
            timerStartedAt,
          };
        }
        return t;
      })
    );
  };

  const handleCyclePriority = (id: string) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id === id) {
          const nextPri: 1 | 2 | 3 = t.priority === 1 ? 2 : t.priority === 2 ? 3 : 1;
          return { ...t, priority: nextPri };
        }
        return t;
      })
    );
  };

  const handleCyclePhase = (id: string) => {
    if (tabs.length === 0) return;
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id === id) {
          const activeIds = tabs.map((tb) => tb.id);
          const curIdx = activeIds.indexOf(t.phase);
          const nextPhase = curIdx >= 0 ? activeIds[(curIdx + 1) % activeIds.length] : activeIds[0];
          return { ...t, phase: nextPhase };
        }
        return t;
      })
    );
  };

  const handleTogglePin = (id: string) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id === id) {
          return { ...t, pinned: !t.pinned };
        }
        return t;
      })
    );
  };

  const handleDelete = (id: string) => {
    const taskToDelete = tasks.find((t) => t.id === id);
    if (taskToDelete) {
      let finalTimeSpent = taskToDelete.timeSpentSeconds || 0;
      if (taskToDelete.timerRunning && taskToDelete.timerStartedAt) {
        finalTimeSpent += Math.max(0, Math.floor((Date.now() - taskToDelete.timerStartedAt) / 1000));
      }
      const sanitizedToDelete: PSTask = {
        ...taskToDelete,
        timeSpentSeconds: finalTimeSpent,
        timerRunning: false,
        timerStartedAt: undefined,
      };
      setRecentlyDeleted(sanitizedToDelete);
      const deletedItem: DeletedTask = {
        ...sanitizedToDelete,
        deletedAt: Date.now(),
      };
      setDeletedTasks((prev) => [deletedItem, ...prev.filter((d) => d.id !== id)]);
    }
    setTasks((prev) => prev.filter((t) => t.id !== id));
  };

  const handleUndoDelete = () => {
    if (recentlyDeleted) {
      sound.activate();
      setTasks((prev) => [recentlyDeleted, ...prev]);
      setDeletedTasks((prev) => prev.filter((d) => d.id !== recentlyDeleted.id));
      setRecentlyDeleted(null);
    }
  };

  const handleRestoreDeletedTask = (task: DeletedTask) => {
    sound.activate();
    const { deletedAt, ...restTask } = task;
    const fallbackTab = tabs[0]?.id || 'focus';
    const safeTask: PSTask = {
      ...restTask,
      phase: tabs.some((tb) => tb.id === restTask.phase) ? restTask.phase : fallbackTab,
    };
    setTasks((prev) => [safeTask, ...prev]);
    setDeletedTasks((prev) => prev.filter((d) => d.id !== task.id));
  };

  const handlePermanentDeleteTask = (id: string) => {
    sound.tick(300);
    setDeletedTasks((prev) => prev.filter((d) => d.id !== id));
  };

  const handleClearDeletedHistory = () => {
    sound.tick(250);
    setDeletedTasks([]);
  };

  const handleAddTask = (newTask: {
    title: string;
    phase: string;
    priority: 1 | 2 | 3;
    steps: number;
    stepList?: { id: string; title: string; done: boolean }[];
    note?: string;
  }) => {
    let effectivePhase = newTask.phase;
    if (
      effectivePhase === 'DASHBOARD' ||
      effectivePhase === 'ALL' ||
      !tabs.some((tb) => tb.id === effectivePhase)
    ) {
      effectivePhase = tabs[0]?.id || 'focus';
    }

    const task: PSTask = {
      id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      ...newTask,
      phase: effectivePhase,
      currentStep: 0,
      done: false,
      pinned: false,
      createdAt: Date.now(),
    };
    setTasks((prev) => [task, ...prev]);
  };

  const handleInjectAITasks = (
    newTasks: Omit<PSTask, 'id' | 'currentStep' | 'done' | 'pinned' | 'createdAt'>[]
  ) => {
    const items: PSTask[] = newTasks.map((t, i) => {
      let phase = t.phase;
      if (phase === 'DASHBOARD' || phase === 'ALL' || !tabs.some((tb) => tb.id === phase)) {
        phase = tabs[0]?.id || 'focus';
      }
      const stepCount = t.stepList && t.stepList.length > 0 ? t.stepList.length : (t.steps || 1);
      return {
        ...t,
        phase,
        steps: stepCount,
        stepList: t.stepList,
        id: `task-${Date.now()}-${i}-${Math.random().toString(36).substr(2, 4)}`,
        currentStep: 0,
        done: false,
        pinned: false,
        createdAt: Date.now() + i,
      };
    });
    setTasks((prev) => [...items, ...prev]);
  };

  const handleClearCompleted = () => {
    sound.tick(350);
    const completedToArchive: DeletedTask[] = tasks
      .filter((t) => t.done)
      .map((t) => ({ ...t, deletedAt: Date.now() }));
    if (completedToArchive.length > 0) {
      setDeletedTasks((prev) => [...completedToArchive, ...prev]);
    }
    setTasks((prev) => prev.filter((t) => !t.done));
  };

  const handleResetDefaults = () => {
    sound.activate();
    setTabs(lang === 'uk' ? DEFAULT_TABS_UK : DEFAULT_TABS_EN);
    setTasks(lang === 'uk' ? INITIAL_LIFE_TASKS_UK : INITIAL_LIFE_TASKS_EN);
    setSelectedPhase('ALL');
  };

  const handleToggleSound = () => {
    sound.enabled = !soundEnabled;
    setSoundEnabled(!soundEnabled);
  };

  return (
    <div className="min-h-screen bg-[#030303] text-[#f4f4f5] flex flex-col selection:bg-white selection:text-black relative overflow-x-hidden">
      {/* Dynamic Fire Embers & Sparks Background */}
      <FireParticlesBackground enabled={fireEnabled} />

      {/* Top Header & Interactive Dynamic Tab Matrix with Windows Titlebar */}
      <TopWorkflowMatrix
        stats={stats}
        tabs={tabs}
        activeFilter={activeFilter}
        selectedPhase={selectedPhase}
        soundEnabled={soundEnabled}
        isAddOpen={isAddOpen}
        lang={lang}
        aiIconVariant={aiIconVariant}
        historyCount={tasks.filter((t) => t.done).length + deletedTasks.length}
        user={currentUser}
        isSyncing={isSyncing}
        autoSyncEnabled={autoSyncEnabled}
        isMinimized={isWindowMinimized}
        isFullscreen={isFullscreen}
        onMinimize={handleMinimizeWindow}
        onToggleFullscreen={handleToggleFullscreen}
        onCloseWindow={handleCloseWindow}
        onToggleSound={handleToggleSound}
        onToggleLang={handleToggleLang}
        onSetFilter={setActiveFilter}
        onSelectPhase={setSelectedPhase}
        onToggleAdd={() => setIsAddOpen((prev) => !prev)}
        onOpenAI={() => {
          setAiPromptSeed('');
          setIsAIOpen(true);
        }}
        onAddTab={handleAddTab}
        onDeleteTab={handleDeleteTab}
        onOpenManageTabs={() => setIsManageTabsOpen(true)}
        onOpenAccount={() => setIsAccountOpen(true)}
      />

      {/* Minimized Window Taskbar Floating Notification */}
      {isWindowMinimized && (
        <div
          id="win-minimized-taskbar-banner"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-[#0d0d12]/95 border border-neutral-700 shadow-2xl px-4 py-2 flex items-center gap-3 backdrop-blur-md animate-in fade-in slide-in-from-bottom-3 duration-200"
        >
          <div className="grid grid-cols-2 gap-[1.5px] w-3 h-3 text-neutral-300">
            <div className="w-1.5 h-1.5 bg-neutral-300 rounded-[0.5px]" />
            <div className="w-1.5 h-1.5 bg-neutral-300 rounded-[0.5px]" />
            <div className="w-1.5 h-1.5 bg-neutral-300 rounded-[0.5px]" />
            <div className="w-1.5 h-1.5 bg-neutral-300 rounded-[0.5px]" />
          </div>
          <span className="text-xs font-mono text-neutral-300">
            {t.winTitlebar?.minimizedNotice || 'KARKAS window is minimized. Click to restore.'}
          </span>
          <button
            id="win-restore-taskbar-btn"
            onClick={() => {
              sound.tick(600);
              setIsWindowMinimized(false);
            }}
            className="px-2.5 py-1 bg-white text-black font-mono font-extrabold text-[10px] tracking-wider hover:bg-neutral-200 transition-colors uppercase cursor-pointer"
          >
            {t.winTitlebar?.restoreBtn || 'RESTORE WINDOW'}
          </button>
        </div>
      )}

      {/* Quick Add Pull-Down Drawer with Dynamic Tabs */}
      <QuickAddDrawer
        isOpen={isAddOpen}
        lang={lang}
        tabs={tabs}
        selectedPhase={selectedPhase}
        onClose={() => setIsAddOpen(false)}
        onAddTask={handleAddTask}
        onOpenAIWithPrompt={(prompt) => {
          setAiPromptSeed(prompt);
          setIsAIOpen(true);
        }}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-6 py-4 pb-28 relative z-10">
        {selectedPhase === 'DASHBOARD' ? (
          <DashboardView
            tasks={tasks}
            deletedTasks={deletedTasks}
            tabs={tabs}
            stats={stats}
            lang={lang}
            aiIconVariant={aiIconVariant}
            onSelectTab={(tabId) => setSelectedPhase(tabId)}
            onToggleDone={handleToggleDone}
            onOpenAI={(prompt) => {
              if (prompt) setAiPromptSeed(prompt);
              setIsAIOpen(true);
            }}
            onOpenAdd={() => setIsAddOpen(true)}
            onOpenManageTabs={() => setIsManageTabsOpen(true)}
            onAddTask={handleAddTask}
          />
        ) : selectedPhase === 'HISTORY' ? (
          <HistoryView
            tasks={tasks}
            deletedTasks={deletedTasks}
            tabs={tabs}
            lang={lang}
            onBackToTasks={() => setSelectedPhase('ALL')}
            onToggleDone={handleToggleDone}
            onRestoreDeleted={handleRestoreDeletedTask}
            onPermanentDelete={handlePermanentDeleteTask}
            onClearDeleted={handleClearDeletedHistory}
          />
        ) : (
          <>
            {/* Search Input Bar with Hotkeys Badge */}
            <div className="mb-3 flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={
                    lang === 'uk'
                      ? 'Пошук завдань... (Натисніть "/" або Ctrl+N)'
                      : 'Search tasks... (Press "/" or Ctrl+N)'
                  }
                  className="w-full pl-9 pr-8 py-2 bg-[#09090d] border border-neutral-800 text-neutral-200 placeholder-neutral-500 text-xs font-mono focus:outline-none focus:border-neutral-500 transition-colors shadow-inner"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white p-0.5 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
              <div className="hidden sm:flex items-center gap-1.5 text-[9px] font-mono text-neutral-400 bg-[#0a0a0d] border border-neutral-800 px-2.5 py-2 shrink-0">
                <span className="px-1 bg-neutral-800 border border-neutral-700 text-neutral-200 font-bold">/</span>
                <span>{lang === 'uk' ? 'Пошук' : 'Search'}</span>
                <span className="mx-0.5 text-neutral-700">|</span>
                <span className="px-1 bg-neutral-800 border border-neutral-700 text-neutral-200 font-bold">Ctrl+N</span>
                <span>{lang === 'uk' ? 'Створити' : 'New'}</span>
              </div>
            </div>

            {/* Gestures Navigation Legend Bar (Dismissible) */}
            {showGesturesLegend && (
              <div className="flex items-center justify-between py-1 px-3 mb-2 bg-[#09090b] border border-neutral-900 text-[10px] font-mono text-neutral-400 animate-in fade-in duration-200">
                <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                  <span>{t.gesturesLegend.swipeLeft}</span>
                  <span className="text-neutral-700">|</span>
                  <span>{t.gesturesLegend.swipeRight}</span>
                  <span className="text-neutral-700 hidden sm:inline">|</span>
                  <span className="hidden sm:inline">{t.gesturesLegend.tapScrubber}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    sound.tick(300);
                    setShowGesturesLegend(false);
                    localStorage.setItem('karkas_show_gestures_legend', 'false');
                  }}
                  title={lang === 'uk' ? 'Сховати підказки' : 'Hide shortcuts legend'}
                  className="p-0.5 text-neutral-500 hover:text-white transition-colors cursor-pointer shrink-0 ml-2"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* Empty State */}
            {filteredTasks.length === 0 && (
              <div className="py-16 text-center border border-dashed border-neutral-800 bg-[#08080a] p-8 my-4 animate-in fade-in duration-200">
                <div className="w-8 h-8 mx-auto mb-3 border border-neutral-700 flex items-center justify-center text-neutral-400">
                  <CheckCircle className="w-4 h-4 text-neutral-400" />
                </div>
                <h2 className="text-sm font-extrabold uppercase tracking-wider text-neutral-200 mb-1">
                  {searchQuery
                    ? (lang === 'uk' ? 'Завдань не знайдено' : 'No tasks found')
                    : activeFilter === 'DONE'
                    ? t.emptyDoneTitle
                    : activeFilter === 'ACTIVE' && stats.total > 0 && stats.completed === stats.total
                    ? t.emptyActiveTitle
                    : t.emptyQueueTitle}
                </h2>
                <p className="text-xs text-neutral-400 font-mono max-w-sm mx-auto mb-4">
                  {searchQuery
                    ? (lang === 'uk' ? `За запитом "${searchQuery}" нічого не знайдено` : `No tasks matching "${searchQuery}"`)
                    : activeFilter === 'DONE'
                    ? t.emptyDoneDesc
                    : activeFilter === 'ACTIVE' && stats.total > 0 && stats.completed === stats.total
                    ? t.emptyActiveDesc
                    : t.emptyQueueDesc}
                </p>
                <div className="flex items-center justify-center gap-2 flex-wrap">
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="px-3.5 py-1.5 bg-neutral-800 border border-neutral-600 text-white font-bold text-xs font-mono tracking-wider hover:bg-neutral-700 transition-colors"
                    >
                      {lang === 'uk' ? 'Очистити пошук' : 'Clear search'}
                    </button>
                  )}
                  {activeFilter !== 'ALL' && (
                    <button
                      id="empty-show-all-filter-btn"
                      onClick={() => {
                        sound.tick(600);
                        setActiveFilter('ALL');
                      }}
                      className="px-3.5 py-1.5 bg-neutral-800 border border-neutral-600 text-white font-bold text-xs font-mono tracking-wider hover:bg-neutral-700 transition-colors"
                    >
                      {t.showAllTasks}
                    </button>
                  )}
                  {selectedPhase !== 'ALL' && (
                    <button
                      id="empty-show-all-phase-btn"
                      onClick={() => {
                        sound.tick(600);
                        setSelectedPhase('ALL');
                      }}
                      className="px-3.5 py-1.5 bg-neutral-900 border border-neutral-700 text-neutral-300 font-bold text-xs font-mono tracking-wider hover:text-white hover:border-neutral-500 transition-colors"
                    >
                      {t.phases.ALL} ({stats.total})
                    </button>
                  )}
                  <button
                    id="empty-add-btn"
                    onClick={() => setIsAddOpen(true)}
                    className="px-3.5 py-1.5 bg-white text-black font-extrabold text-xs font-mono tracking-wider hover:bg-neutral-200 transition-colors"
                  >
                    {t.injectNewOp}
                  </button>
                </div>
              </div>
            )}

            {/* Tasks List */}
            <div className="flex flex-col">
              <AnimatePresence initial={false}>
                {filteredTasks.map((task, index) => (
                  <motion.div
                    key={task.id}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -100, transition: { duration: 0.18 } }}
                    transition={{ duration: 0.2 }}
                  >
                    <TaskCard
                      task={task}
                      index={index}
                      lang={lang}
                      tabs={tabs}
                      onToggleDone={handleToggleDone}
                      onUpdateStep={handleUpdateStep}
                      onCyclePriority={handleCyclePriority}
                      onCyclePhase={handleCyclePhase}
                      onTogglePin={handleTogglePin}
                      onDelete={handleDelete}
                      onEditTask={handleEditTask}
                      onToggleStepItem={handleToggleStepItem}
                      onAddStepItem={handleAddStepItem}
                      onDeleteStepItem={handleDeleteStepItem}
                      onAIBreakdown={handleAIBreakdownTask}
                      isBreakingDown={breakingDownTaskId === task.id}
                      onToggleTimer={handleToggleTimer}
                      onResetTimer={handleResetTimer}
                      onUpdateTimeSpent={handleUpdateTimeSpent}
                      onAskAIAboutTask={(taskTitle) => {
                        const prompt =
                          lang === 'uk'
                            ? `Як найкраще розпланувати та виконати задачу: "${taskTitle}"?`
                            : `How to best plan and execute task: "${taskTitle}"?`;
                        setAiPromptSeed(prompt);
                        setIsAIOpen(true);
                      }}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </>
        )}

        {/* Undo Toast if item was deleted */}
        <AnimatePresence>
          {recentlyDeleted && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20, transition: { duration: 0.15 } }}
              className="fixed bottom-20 left-1/2 -translate-x-1/2 z-40 bg-neutral-900 border border-neutral-700 px-4 py-2.5 flex items-center gap-3 shadow-2xl text-xs font-mono"
            >
              <span className="text-neutral-300">
                {t.opRemoved} "{recentlyDeleted.title.slice(0, 26)}{recentlyDeleted.title.length > 26 ? '...' : ''}"
              </span>
              <button
                id="undo-delete-btn"
                onClick={handleUndoDelete}
                className="text-white font-extrabold underline hover:text-neutral-300 cursor-pointer"
              >
                {t.undo}
              </button>
              <button
                type="button"
                onClick={() => setRecentlyDeleted(null)}
                className="text-neutral-500 hover:text-white ml-1 font-bold text-xs p-0.5 cursor-pointer transition-colors"
                title={lang === 'uk' ? 'Закрити' : 'Close'}
              >
                ✕
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* All bottom controls share the same responsive layout. */}
      <footer className="fixed bottom-0 left-0 right-0 z-30 bg-[#060608]/95 backdrop-blur-md border-t border-neutral-800/80 px-3 sm:px-4 py-2.5 app-no-drag pointer-events-auto">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center gap-2 sm:gap-3 app-no-drag">
      <div className="order-0 shrink-0 flex items-center app-no-drag pointer-events-auto">
        <button
          id="toggle-fire-animation-btn"
          type="button"
          onClick={() => {
            sound.tick(fireEnabled ? 350 : 650);
            setFireEnabled((prev) => !prev);
          }}
          title={
            fireEnabled
              ? (lang === 'uk' ? 'Вимкнути анімацію вогню' : 'Turn off fire animation')
              : (lang === 'uk' ? 'Увімкнути анімацію вогню' : 'Turn on fire animation')
          }
          className={`px-2 py-1 border transition-all cursor-pointer flex items-center gap-1.5 text-[10px] font-mono tracking-wider uppercase backdrop-blur-md shadow-md app-no-drag pointer-events-auto ${
            fireEnabled
              ? 'border-neutral-700 bg-neutral-900/95 text-neutral-200 hover:border-white hover:text-white'
              : 'border-neutral-800 bg-[#08080a]/95 text-neutral-500 hover:text-neutral-300 hover:border-neutral-700'
          }`}
        >
          <div className="relative w-3.5 h-3.5 flex items-center justify-center shrink-0">
            <Flame className={`w-3.5 h-3.5 transition-colors ${fireEnabled ? 'text-white' : 'text-neutral-600'}`} />
            {!fireEnabled && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-4 h-[1.5px] bg-red-500 rotate-45" />
              </div>
            )}
          </div>
          <span className="hidden sm:inline font-bold">
            {fireEnabled ? t.fireOn : t.fireOff}
          </span>
        </button>
      </div>

      {/* System Update Trigger Button */}
      <div className="order-4 shrink-0 flex items-center app-no-drag pointer-events-auto">
        <button
          id="toggle-update-modal-btn"
          type="button"
          onClick={() => {
            sound.tick(600);
            setIsUpdateOpen(true);
          }}
          title={lang === 'uk' ? `Центр оновлень (v${APP_CURRENT_VERSION})` : `System update center (v${APP_CURRENT_VERSION})`}
          className="px-2 py-1 border border-neutral-800 bg-[#08080a]/95 text-neutral-400 hover:text-white hover:border-neutral-600 transition-all cursor-pointer flex items-center gap-1.5 text-[10px] font-mono tracking-wider uppercase backdrop-blur-md shadow-md app-no-drag pointer-events-auto"
        >
          <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />
          <span className="hidden sm:inline font-bold text-neutral-300">
            v{APP_CURRENT_VERSION}
          </span>
        </button>
      </div>

          {/* Left: Quick Filter Status */}
          <div className="order-5 basis-full lg:order-1 lg:basis-auto flex flex-wrap items-center justify-center gap-2 text-[10px] font-mono text-neutral-400 app-no-drag">
            <span className="text-neutral-200 font-bold">
              {filteredTasks.length} {t.shownCount}
            </span>
            {tasks.some((t) => t.done) && (
              <button
                id="clear-completed-bottom-btn"
                onClick={handleClearCompleted}
                className="hover:text-rose-400 transition-colors flex items-center gap-1 border-l border-neutral-800 pl-2 app-no-drag"
              >
                <Trash className="w-3 h-3" />
                <span>{t.purgeDelivered}</span>
              </button>
            )}
          </div>

          {/* Center: Main AI Summon Pill */}
          <button
            id="bottom-summon-ai-btn"
            onClick={() => {
              sound.activate();
              setAiPromptSeed('');
              setIsAIOpen(true);
            }}
            title={t.swipeUpAI}
            className="order-2 min-w-0 flex-1 flex items-center justify-center gap-2 px-2 sm:px-3.5 py-1.5 bg-neutral-900 border border-neutral-700 hover:border-white text-white font-mono text-xs font-bold tracking-wider transition-all active:scale-95 app-no-drag"
          >
            <AIIcon id={aiIconVariant} className="w-3.5 h-3.5 shrink-0 text-neutral-300" />
            <span className="sm:hidden truncate">KARKAS AI</span>
            <span className="hidden sm:inline truncate">{t.swipeUpAI}</span>
          </button>

          {/* Right: Quick Add Button */}
          <button
            id="bottom-quick-add-btn"
            onClick={() => {
              sound.tick(600);
              setIsAddOpen((prev) => !prev);
            }}
            className="order-3 shrink-0 flex items-center gap-1 px-3 py-1.5 bg-white text-black font-extrabold font-mono text-xs tracking-wider hover:bg-neutral-200 transition-all active:scale-95 app-no-drag"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t.addOp}</span>
          </button>
        </div>
      </footer>

      {/* AI Assistant HUD Sheet */}
      <AIAssistantSheet
        isOpen={isAIOpen}
        lang={lang}
        tabs={tabs}
        onClose={() => setIsAIOpen(false)}
        currentTasks={tasks}
        deletedTasks={deletedTasks}
        stats={stats}
        adaptiveProfile={adaptiveProfile}
        initialPrompt={aiPromptSeed}
        aiIconVariant={aiIconVariant}
        onInjectTasks={handleInjectAITasks}
      />

      {/* Manage Tabs Modal */}
      <ManageTabsModal
        isOpen={isManageTabsOpen}
        tabs={tabs}
        lang={lang}
        onClose={() => setIsManageTabsOpen(false)}
        onAddTab={handleAddTab}
        onDeleteTab={handleDeleteTab}
        onSetPresetTabs={handleSetPresetTabs}
        tabCounts={stats.phaseCounts}
      />

      {/* Google Account & Cloud Backup Modal */}
      <AccountModal
        isOpen={isAccountOpen}
        lang={lang}
        user={currentUser}
        cloudData={cloudData}
        isSyncing={isSyncing}
        lastSyncTime={lastSyncTime}
        autoSyncEnabled={autoSyncEnabled}
        onClose={() => setIsAccountOpen(false)}
        onLoginWithGoogle={handleLoginWithGoogle}
        onLogout={handleLogout}
        onSyncNow={handleSyncNow}
        onRestoreFromCloud={handleRestoreFromCloud}
        onToggleAutoSync={handleToggleAutoSync}
      />

      {/* System Update Modal */}
      <UpdateModal
        isOpen={isUpdateOpen}
        onClose={() => setIsUpdateOpen(false)}
        lang={lang}
        currentVersion={APP_CURRENT_VERSION}
      />

      {/* Automated Update Detection Prompt Banner */}
      <AnimatePresence>
        {availableNewRelease && !isUpdateOpen && (
          <motion.div
            initial={{ opacity: 0, y: -25 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -25 }}
            className="fixed top-3.5 left-1/2 -translate-x-1/2 z-50 bg-[#09090c]/95 border border-emerald-500/70 shadow-2xl px-4 py-2.5 flex items-center gap-3 font-mono text-xs backdrop-blur-md app-no-drag"
          >
            <Sparkles className="w-4 h-4 text-emerald-400 shrink-0 animate-pulse" />
            <span className="text-neutral-200">
              {lang === 'uk'
                ? `Виявлено нову версію ${availableNewRelease.tag_name}. Встановити оновлення зараз?`
                : `New version ${availableNewRelease.tag_name} available. Install update now?`}
            </span>
            <button
              type="button"
              onClick={() => {
                sound.activate();
                setIsUpdateOpen(true);
              }}
              className="px-3 py-1 bg-white text-black font-extrabold uppercase text-[11px] hover:bg-neutral-200 transition-all cursor-pointer shadow-sm active:scale-95"
            >
              {lang === 'uk' ? 'Встановити' : 'Install'}
            </button>
            <button
              type="button"
              onClick={() => {
                sound.tick(300);
                sessionStorage.setItem('karkas_dismissed_update', availableNewRelease.tag_name);
                setAvailableNewRelease(null);
              }}
              className="text-neutral-500 hover:text-white p-1 transition-colors cursor-pointer"
              title={lang === 'uk' ? 'Пізніше' : 'Later'}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tab Deletion Confirmation Safeguard Modal */}
      <AnimatePresence>
        {tabToDeleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="w-full max-w-md bg-[#0c0c0e] border border-neutral-800 shadow-2xl p-5 sm:p-6 flex flex-col gap-4 text-neutral-100 font-mono"
            >
              <div className="flex items-center justify-between border-b border-neutral-800/80 pb-3">
                <div className="flex items-center gap-2">
                  <Trash className="w-4 h-4 text-red-400 shrink-0" />
                  <h3 className="text-xs font-bold tracking-wider uppercase text-neutral-200">
                    {(t as any).tabDeleteModal?.title || (lang === 'uk' ? 'ПІДТВЕРДЖЕННЯ ВИДАЛЕННЯ ВКЛАДКИ' : 'CONFIRM TAB DELETION')}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    sound.tick(400);
                    setTabToDeleteConfirm(null);
                  }}
                  className="p-1 text-neutral-400 hover:text-white transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3 text-xs leading-relaxed text-neutral-300">
                <p>
                  {lang === 'uk' ? 'Ви дійсно хочете видалити вкладку' : 'Are you sure you want to delete tab'}{' '}
                  <span className="text-white font-bold bg-[#141418] px-2 py-0.5 border border-neutral-700">
                    "{tabToDeleteConfirm.name}"
                  </span>
                  ?
                </p>

                {(() => {
                  const count = stats.phaseCounts[tabToDeleteConfirm.id] || 0;
                  const remaining = tabs.filter((tb) => tb.id !== tabToDeleteConfirm.id);
                  const fallbackTab = remaining[0];
                  const fallbackName = fallbackTab ? ((t.phases as any)[fallbackTab.id] || fallbackTab.name) : '';

                  if (count > 0) {
                    return (
                      <div className="p-3 bg-[#111116] border border-neutral-800 text-neutral-300 text-xs leading-normal flex flex-col gap-1.5">
                        <span className="font-bold flex items-center gap-1.5 text-neutral-200">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-500" />
                          <span>
                            {lang === 'uk'
                              ? `У цій вкладці є ${count} завдань`
                              : `There are ${count} tasks in this tab`}
                          </span>
                        </span>
                        <p className="text-[11px] text-neutral-400">
                          {lang === 'uk'
                            ? `При видаленні всі завдання збережуться та автоматично перенесуться у вкладку "${fallbackName}".`
                            : `All tasks will be preserved and automatically moved to "${fallbackName}".`}
                        </p>
                      </div>
                    );
                  }
                  return (
                    <p className="text-neutral-400 text-xs bg-[#111116] p-2.5 border border-neutral-800">
                      {lang === 'uk' ? 'У цій вкладці зараз немає завдань.' : 'There are no tasks in this tab.'}
                    </p>
                  );
                })()}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-neutral-800/80">
                <button
                  type="button"
                  onClick={() => {
                    sound.tick(400);
                    setTabToDeleteConfirm(null);
                  }}
                  className="px-4 py-2 bg-[#121216] border border-neutral-700 text-neutral-300 font-bold text-xs hover:border-white hover:text-white transition-all cursor-pointer"
                >
                  {(t as any).tabDeleteModal?.cancel || (lang === 'uk' ? 'СКАСУВАТИ' : 'CANCEL')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleConfirmDeleteTab();
                  }}
                  className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white font-extrabold text-xs tracking-wider transition-all cursor-pointer shadow-md flex items-center gap-1.5"
                >
                  <Trash className="w-3.5 h-3.5" />
                  <span>
                    {(t as any).tabDeleteModal?.confirmDelete || (lang === 'uk' ? 'ВИДАЛИТИ ВКЛАДКУ' : 'DELETE TAB')}
                  </span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
