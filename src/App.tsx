import { pauseTaskTimer, startTaskTimer, configureTaskCountdown, clearTaskCountdown, extendTaskCountdown, getTaskRemainingSeconds, expireTaskCountdown } from './utils/taskTimer';
import { continueAfterExpiry, finishAfterExpiry, countdownReminderIndex } from './utils/countdownOverrun';
import { planDelay } from './utils/dayPlanShift';
import { startLimitedStart, finishLimitedStart, needsLimitedStartFinish, latestAttempt, summarizeAttempts } from './utils/limitedStart';
import { applyAITaskUpdate } from './utils/aiTaskUpdates';
import { applyAgentAction, type AgentAction, type AgentWorkspace } from './utils/aiAgentActions';
import { captureAgentUndo, undoAgentTurn, type AgentUndoSnapshot } from './utils/agentUndo';
import { canonical } from './utils/canonical';
import type { AgentApplyOptions, AgentApplyResult } from './components/aiAgentClient';
import type { AppliedAgentAction, AgentView } from './types';
import { applyAITimerSettings, isAITimerSettingsValid } from './utils/aiTaskTimer';
import { isNewerAppVersion, isValidAppVersion } from './utils/appVersion';
import React, { useState, useEffect, useMemo } from 'react';
import { PSTask, DeletedTask, TaskTab, FilterMode, WorkflowStats, TaskStepItem, AdaptiveProfile, AITaskUpdate, AITimerSettings, AIDeletedTaskRef, NotepadNote, NewTaskInput } from './types';
import { isTaskDate, localTaskDate, taskDateEnd } from './utils/taskDates';
import { annotateTaskChanges } from './utils/taskActivity';
import { isCompletedArchivedTask, selectRelevantArchivedTasks, normalizeCompletedTaskHistory, retireCompletedTask, countCompletedTasks, mergeCompletionLedgers } from './utils/taskArchive';
import { TaskCard } from './components/TaskCard';
import { DashboardView } from './components/DashboardView';
import { NotepadView } from './components/NotepadView';
import { useAccountNotes } from './hooks/useAccountNotes';
import type { NotepadTaskCandidate, NotepadTaskConfig, NotepadTaskResult } from './utils/noteTaskConversion';
import { noteSourceHash } from './utils/noteTaskConversion';
import { applyNotepadBatch, prepareNotepadReplacement, notesOperationPrefix } from './utils/notepadStorage';
import { useAccountAvatar } from './hooks/useAccountAvatar';
import { growthStateFrom, useGrowth, type GrowthState } from './hooks/useGrowth';
import { normalizeQuickAddCategory } from './utils/quickAddParse';
import { useDialogKeyboard } from './components/useDialogKeyboard';
import { GrowthView } from './components/growth/GrowthView';
import { SkillSetup } from './components/growth/SkillSetup';
import { PracticeFinishDialog } from './components/growth/PracticeFinishDialog';
import { GrowthFeedback } from './components/growth/GrowthFeedback';
import { GROWTH_INTEGRATION_STRINGS } from './components/growth/growthIntegrationI18n';
import { isConfiguredSkill } from './utils/growth';
import type { GrowthSkill, Skill } from './types';
import { PulseHeader } from './components/pulse/PulseHeader';
import { AIIsland } from './components/pulse/AIIsland';
import { PageShell, PageHead, PageGrid } from './components/pulse/PageShell';
import { TodaySidebar } from './components/pulse/TodaySidebar';
import { CategorySwitcher } from './components/pulse/CategorySwitcher';
import { QuickAddDialog } from './components/pulse/QuickAddDialog';
import { SettingsView } from './components/pulse/SettingsView';
import { AccountView } from './components/pulse/AccountView';
import { TodayTaskRow } from './components/pulse/TodayTaskRow';
import { TaskCompletionNotice } from './components/pulse/TaskCompletionNotice';
import { CompletedTaskDeleteDialog } from './components/pulse/CompletedTaskDeleteDialog';
import type { TaskCompletionLedger } from './types';
import type { QuickAddPrefill } from './components/QuickAddDrawer';
import { TaskEditor, type TaskEditPatch } from './components/pulse/TaskEditor';
import { ArchiveView, type ArchiveItem } from './components/pulse/ArchiveView';
import { QuickAddLine } from './components/QuickAddLine';
import { NowStrip } from './components/NowStrip';
import { DayCloseDialog } from './components/DayCloseDialog';
import { OnboardingChecklist } from './components/OnboardingChecklist';
import { readOnboarding, writeOnboarding, shouldOfferOnboarding, type OnboardingState } from './utils/onboarding';
import { summarizeDay, dayCompletedCount, carryOverCandidates, dayCloseHour, shouldOfferDayClose, morningRecap, formatDayFocus, normalizeDayLog, type DayLog } from './utils/dayRecap';
import { AIAssistantSheet } from './components/AIAssistantSheet';
import { ManageTabsModal } from './components/ManageTabsModal';
import { sound } from './utils/audio';
import { detectEndedSessions, type EndedSession } from './utils/sessionSummary';
import { SessionSummaryCard } from './components/SessionSummaryCard';
import { useDesktopPresence, subscribeDesktopCommands, type DesktopCommandHandlers } from './components/useDesktopPresence';
import {
  Language,
  TRANSLATIONS,
  getRandomTabColor,
} from './utils/i18n';
import { Trash, Plus, Search, X, AlertTriangle, Sparkles } from 'lucide-react';
import { motion, AnimatePresence, MotionConfig } from 'motion/react';
import { AIIconId, getSavedAIIconId } from './components/AIIconTemplates';
import { 
  auth, 
  loginWithGoogle, 
  logoutUser, 
  saveUserCloudData, 
  fetchUserCloudData, 
  subscribeToUserCloudData,
  advanceUserCloudShadowMigration,
  verifyUserCloudShadowData,
  repairUserCloudShadowData,
  UserCloudState 
} from './services/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { UpdateModal } from './components/UpdateModal';
import { mergeWorkspace, normalizeWorkspaceForStorage, sameWorkspace, type WorkspaceState } from './utils/syncState';
import { diffWorkspaceOperations } from './utils/syncOperations';
import { karkasApiFetch, desktopHasAiKey } from './utils/desktopApi';
import { sanitizeTasksTimerSafeguard, completeTask, reopenTask, startTaskWork, createTask, setTaskProgress, toggleTaskStep, addTaskStep, deleteTaskStep, setTaskTimeSpent, setTaskSteps, materializeStepList } from './utils/taskOperations';
import packageMetadata from '../package.json';
import { readAccountStorage, writeAccountStorage, removeAccountStorage } from './utils/accountStorage';
import { taskBreakdownContext } from './utils/taskBreakdownContext';
import { materializeScheduledWorkspace, normalizeTaskSchedule } from './utils/taskScheduling';
import { calendarDateKey, compareTodayTimedFirst, describeSchedule } from './utils/schedulePresentation';
import { buildWorkInsights } from './utils/workInsights';
import { discardTaskStepAttribution } from './utils/taskWorkTelemetry';
import { TaskWorkPlanDialog } from './components/TaskWorkPlanDialog';
import { applyTaskWorkPlan, type WorkPlanEdit } from './utils/taskWorkPlan';
import { useWorkReminders } from './components/useWorkReminders';

import { useStrategyReminders } from './components/useStrategyReminders';
import { createPersonalStrategyProfile, readPersonalStrategy, savePersonalStrategy, clearPersonalStrategy, applyStrategyResponse, personalStrategyKey, intactStoredStrategy } from './utils/personalStrategy';
import { continueStrategyDiscovery, normalizeStrategyDiscovery, preparePersonalDiscoveryRequest, preserveDiscoveryAfterUserGoalEdit, preserveDiscoveryAfterTabMigration } from './utils/strategyDiscovery';
import { applyStrategyActions, undoStrategyTurn } from './utils/strategyActions';
import { claimPlanningNotice } from './utils/planningNotices';
import { stageStrategyTransaction, recoverStrategyTransaction, clearStrategyTransaction, completeStrategyTransaction, strategyTransactionKey, readStrategyTransaction, markStrategyTransactionConflict } from './utils/strategyTransaction';
import type { PersonalStrategyProfile, AIResponse, AIIntent } from './types';
import { isSystemView, migrateSystemCategories } from './utils/systemViews';
import { writeRecoverableJson, preserveRawStorage } from './utils/recoverableLocalStorage';
import { readLocalWorkspace, parseAccountRecord, readAccountRecovery } from './utils/localWorkspace';
import { parseWorkspace } from './utils/workspaceValidation';
import { remapWorkspaceTabs } from './utils/workspaceTabs';
import { claimGuestWorkspaceImport } from './utils/guestWorkspaceImport';
import { readWebApiKey } from './utils/webApiKey';
import { workspaceTabTransactionKey, stageWorkspaceTabTransaction, recoverWorkspaceTabTransaction, completeWorkspaceTabTransaction } from './utils/workspaceTabTransaction';

const STORAGE_KEY = 'life_todo_tasks_v2';
const DELETED_STORAGE_KEY = 'karkas_deleted_tasks_v2';
const COMPLETION_LEDGER_KEY = 'karkas_completion_ledger_v1';
const TABS_KEY = 'life_todo_tabs_v2';

const INITIAL_NOTES_UK: NotepadNote[] = [
  {
    id: 'note-welcome-1',
    title: 'Швидкі ідеї та нагадування',
    content: 'Тут зручно записувати все, що спадає на думку: списки покупок, думки для проектів або надиктовувати голосом через мікрофон.',
    color: '#38bdf8',
    createdAt: Date.now() - 3600000 * 2,
    pinned: true,
  },
  {
    id: 'note-welcome-2',
    title: 'Голосове введення нотаток',
    content: 'Натисніть на значок мікрофона біля форми запису, щоб надиктувати нотатку українською мовою без клавіатури.',
    color: '#34d399',
    createdAt: Date.now() - 3600000 * 24,
    pinned: false,
  },
];

const INITIAL_NOTES_EN: NotepadNote[] = [
  {
    id: 'note-welcome-1',
    title: 'Quick ideas and reminders',
    content: 'A handy place to jot down anything: project thoughts, quick reminders, or speak directly into the microphone.',
    color: '#38bdf8',
    createdAt: Date.now() - 3600000 * 2,
    pinned: true,
  },
  {
    id: 'note-welcome-2',
    title: 'Voice notes dictation',
    content: 'Click the microphone button to dictate notes hands-free using speech recognition.',
    color: '#34d399',
    createdAt: Date.now() - 3600000 * 24,
    pinned: false,
  },
];
const GROWTH_SKILLS_KEY = 'karkas_growth_skills_v1';
const GROWTH_MEASUREMENTS_KEY = 'karkas_growth_measurements_v1';
const GROWTH_SESSIONS_KEY = 'karkas_growth_sessions_v1';
const LANG_KEY = 'todo_app_lang';
const AI_ICON_KEY = 'karkas_ai_icon_variant';
const FIRE_ENABLED_KEY = 'karkas_fire_enabled';
const SOUND_ENABLED_KEY = 'karkas_sound_enabled';
const LAST_SYNC_KEY = 'karkas_last_sync_time';
const AUTO_SYNC_KEY = 'karkas_auto_sync_enabled';
const APP_ZOOM_KEY = 'karkas_app_zoom_percent';
const MIN_APP_ZOOM = 75;
const MAX_APP_ZOOM = 150;
const DEFAULT_APP_ZOOM = 100;

/** «2 хв тому» for the account card. */
function formatSyncAgo(at: number, lang: Language) {
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60000));
  if (minutes < 1) return lang === 'uk' ? 'щойно' : 'just now';
  if (minutes < 60) return lang === 'uk' ? minutes + ' хв тому' : minutes + ' min ago';
  const hours = Math.round(minutes / 60);
  if (hours < 24) return lang === 'uk' ? hours + ' год тому' : hours + ' h ago';
  return new Date(at).toLocaleDateString(lang === 'uk' ? 'uk-UA' : 'en-GB', { day: 'numeric', month: 'short' });
}
const APP_BUILD_VERSION = packageMetadata.version;
const STARTUP_REQUEST_TIMEOUT_MS = 10000;
const accountKeyForOwner = (uid: string | null) => 'karkas_workspace:' + (uid || 'guest');

function requestStartupWithDeadline<T>(request: () => Promise<T>): Promise<T> {
  let timeout: number | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = window.setTimeout(() => reject(new Error('Startup request timed out')), STARTUP_REQUEST_TIMEOUT_MS);
  });
  return Promise.race([Promise.resolve().then(request), deadline]).finally(() => {
    window.clearTimeout(timeout);
  });
}

function normalizeAppZoom(value: unknown): number {
  if (value === null || value === undefined || value === '') return DEFAULT_APP_ZOOM;
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return DEFAULT_APP_ZOOM;
  const clamped = Math.min(MAX_APP_ZOOM, Math.max(MIN_APP_ZOOM, numericValue));
  return Math.round(clamped / 5) * 5;
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

  const [initialWorkspace] = useState(() => readLocalWorkspace(localStorage,
    { tasks: STORAGE_KEY, tabs: TABS_KEY, deletedTasks: DELETED_STORAGE_KEY, completionLedger: COMPLETION_LEDGER_KEY,
      skills: GROWTH_SKILLS_KEY, measurements: GROWTH_MEASUREMENTS_KEY, practiceSessions: GROWTH_SESSIONS_KEY },
    { soundEnabled: true, fireEnabled: true, lang, aiIconVariant: 'quantum' }));
  const [growthSetup, setGrowthSetup] = useState<{ skillId?: string; initialTitle?: string } | null>(null);
  const [practiceFinish, setPracticeFinish] = useState<{ skillId: string; taskId?: string; measurementMode?: boolean; completeTask?: boolean; ownerId: string | null; generation: number } | null>(null);
  const practiceFinishRef = React.useRef(practiceFinish);
  practiceFinishRef.current = practiceFinish;
  const [growthState, setGrowthState] = useState<GrowthState>(() => growthStateFrom(initialWorkspace.workspace));
  const growthRef = React.useRef(growthState);
  const growthFields = ['skills', 'measurements', 'practiceSessions'] as const;
  const growthPresenceRef = React.useRef(new Set(growthFields.filter(key => initialWorkspace.workspace[key] !== undefined)));
  const canPersistWorkspaceRef = React.useRef(initialWorkspace.canPersist);
  const [workspaceStorageError, setWorkspaceStorageError] = useState(false);
  const [workspaceReloadToken, setWorkspaceReloadToken] = useState(0);
  const tabMigrationBusyRef = React.useRef(false);
  const t = TRANSLATIONS[lang];
  const [actionNotice, setActionNotice] = useState<string | null>(initialWorkspace.recovered
    ? (initialWorkspace.backupPreserved
      ? (lang === 'uk' ? 'Локальні дані потребують відновлення. Початкові записи збережено в резервній копії; пошкоджені дані не застосовано.' : 'Local data needs recovery. Original records were backed up; invalid data was not applied.')
      : (lang === 'uk' ? 'Не вдалося створити резервну копію пошкоджених даних. Збереження заблоковано. Звільніть місце на пристрої та перезапустіть застосунок; початкові записи не перезаписано.' : 'Could not back up damaged data. Saving is blocked. Free device storage and restart the app; original records were not overwritten.')) : null);
  const [dayShiftNotice, setDayShiftNotice] = useState<{ ownerId: string | null; text: string; undoToken?: string } | null>(null);
  const dayShiftBusyRef = React.useRef(false);
  const [completedNoticeId, setCompletedNoticeId] = useState<string | null>(null);
  const [completedTaskToDelete, setCompletedTaskToDelete] = useState<string | null>(null);
  const breakdownRequestRef = React.useRef<AbortController | null>(null);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  useEffect(() => () => breakdownRequestRef.current?.abort(), []);

  // Tabs state: supports adding, deleting, and renaming tabs
  const [tabs, setTabs] = useState<TaskTab[]>(() => initialWorkspace.workspace.tabs.map((tab, index, all) => ({
    ...tab, color: tab.color || getRandomTabColor(all.slice(0, index)),
  })));
  const [tasks, setTaskState] = useState<PSTask[]>(() => sanitizeTasksTimerSafeguard(initialWorkspace.workspace.tasks.map(task =>
    isSystemView(task.phase) && !initialWorkspace.workspace.tabs.some(tab => tab.id === task.phase) ? { ...task, phase: 'focus' } : task)));
  const setTasks = React.useCallback<React.Dispatch<React.SetStateAction<PSTask[]>>>((action) => {
    const now = Date.now();
    setTaskState(previous => annotateTaskChanges(previous, typeof action === 'function' ? action(previous) : action, now));
  }, []);
  const latestTasksRef = React.useRef(tasks);
  latestTasksRef.current = tasks;
  const notifiedTimersRef = React.useRef(new Set<string>());
  const timerNoticeScopeRef = React.useRef(0);
  const timerWorkspaceReadyRef = React.useRef(false);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const shownDeletedRef = React.useRef(new Set<string>());
  const previousSessionTasksRef = React.useRef<{ tasks: PSTask[]; ownerId: string | null; ready: boolean } | null>(null);
  const [sessionSummary, setSessionSummary] = useState<{ session: EndedSession; task: PSTask; ownerId: string | null; shownAt: number } | null>(null);
  const dismissSessionSummary = React.useCallback(() => setSessionSummary(null), []);
  const [timerNotice, setTimerNotice] = useState<string | null>(null);
  const [timerNoticeCalm, setTimerNoticeCalm] = useState(false);
  const notifiedSchedulesRef = React.useRef(new Set<string>());
  const archivedScheduleIdsRef = React.useRef<string[]>([]);

  // Reconcile deadlines globally, including tasks hidden by filters or tabs.
  useEffect(() => {
    const interval = setInterval(() => {
      if (!timerWorkspaceReadyRef.current) return;
      const now = Date.now();
      const scheduled = materializeScheduledWorkspace(latestTasksRef.current, archivedScheduleIdsRef.current, now);
      if (scheduled.records !== latestTasksRef.current) {
        latestTasksRef.current = scheduled.records;
        setTasks(previous => materializeScheduledWorkspace(previous, archivedScheduleIdsRef.current, now).records);
      }
      const liveDue = latestTasksRef.current.filter(task => !task.done && !task.scheduledPending && !task.startedAt && task.scheduledFor && now >= task.scheduledFor && now - task.scheduledFor < 10 * 60000).map(task => ({ taskId: task.id, title: task.title, scheduledFor: task.scheduledFor! }));
      const due = [...scheduled.notifications, ...liveDue].filter(occurrence => {
        const key = occurrence.taskId + ':' + occurrence.scheduledFor;
        if (notifiedSchedulesRef.current.has(key)) return false;
        notifiedSchedulesRef.current.add(key);
        return claimPlanningNotice(localStorage, workspaceOwnerRef.current, 'scheduled:' + key, now, true);
      });
      if (due.length) {
        const title = lang === 'uk' ? 'Karkas · Запланована робота' : 'Karkas · Scheduled work';
        const body = due.map(occurrence => {
          const at = new Intl.DateTimeFormat(lang === 'uk' ? 'uk-UA' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(occurrence.scheduledFor);
          return occurrence.title + ' · ' + (lang === 'uk' ? 'Заплановано на' : 'Planned for') + ' ' + at;
        }).join('\n');
        const scope = timerNoticeScopeRef.current;
        setTimerNoticeCalm(false);
        setTimerNotice(body);
        if (window.karkasDesktop) void window.karkasDesktop.system.showNotification({ title, body, target: { view: 'STRATEGY', ownerId: workspaceOwnerRef.current, taskId: due[0].taskId } }).then(result => {
          if (!result.ok && scope === timerNoticeScopeRef.current) setTimerNotice(body + ' ' + (lang === 'uk' ? 'Сповіщення Windows недоступне.' : 'Windows notification unavailable.'));
        }).catch(() => { if (scope === timerNoticeScopeRef.current) setTimerNotice(body); });
      }
      const countdownTasks = latestTasksRef.current.map(task => expireTaskCountdown(task, now));
      const expired = latestTasksRef.current.filter(task => !task.done && task.limitedStart && task.timerRunning && getTaskRemainingSeconds(task, now) === 0);
      for (const task of expired) {
        const key = `${task.id}:${task.timerStartedAt}`;
        if (notifiedTimersRef.current.has(key)) continue;
        notifiedTimersRef.current.add(key);
        const limited = task.limitedStart!;
        const title = lang === 'uk' ? 'Karkas · Спробу зараховано' : 'Karkas · Attempt counted';
        const body = lang === 'uk' ? `«${task.title}»: ${limited.capSeconds / 60} хв роботи. Можна зупинитись або продовжити.` : `“${task.title}”: ${limited.capSeconds / 60} min of work. You can stop or continue.`;
        const noticeScope = timerNoticeScopeRef.current;
        setTimerNoticeCalm(true);
        setTimerNotice(body);
        if (window.karkasDesktop) void window.karkasDesktop.system.showNotification({ title, body }).then(result => {
          if (!result.ok && noticeScope === timerNoticeScopeRef.current) setTimerNotice(body + ' ' + (lang === 'uk' ? 'Сповіщення Windows недоступне.' : 'Windows notification unavailable.'));
        }).catch(() => { if (noticeScope === timerNoticeScopeRef.current) setTimerNotice(body); });
      }
      for (const task of countdownTasks) {
        const reminder = countdownReminderIndex(task, now);
        if (reminder === undefined) continue;
        const key = `countdown:${task.id}:${task.countdownExpiredAt}:${reminder}`;
        if (notifiedTimersRef.current.has(key)) continue;
        notifiedTimersRef.current.add(key);
        if (!claimPlanningNotice(localStorage, workspaceOwnerRef.current, key, now, true)) continue;
        const minutes = Number.isFinite(task.countdownDurationSeconds) && task.countdownDurationSeconds! >= 60 ? Math.floor(task.countdownDurationSeconds! / 60) : null;
        const title = 'Karkas · ' + (minutes === null ? (lang === 'uk' ? 'Сесія фокусу' : 'Focus session') : (lang === 'uk' ? minutes + ' хв фокусу' : minutes + ' min of focus'));
        const body = lang === 'uk' ? '«' + task.title + '»: час сесії вийшов. Відкрий Karkas — запишемо результат.'
          : '“' + task.title + '”: the session is over. Open Karkas — let’s record the result.';
        const noticeScope = timerNoticeScopeRef.current;
        setTimerNoticeCalm(true);
        setTimerNotice(body);
        if (window.karkasDesktop) void window.karkasDesktop.system.showNotification({ title, body }).then(result => {
          if (!result.ok && noticeScope === timerNoticeScopeRef.current) setTimerNotice(body + ' ' + (lang === 'uk' ? 'Сповіщення Windows недоступне.' : 'Windows notification unavailable.'));
        }).catch(() => { if (noticeScope === timerNoticeScopeRef.current) setTimerNotice(body); });
      }
      setTasks(previous => {
        const normalized = previous.map(task => needsLimitedStartFinish(task, now) ? finishLimitedStart(task, now) : task);
        const updated = sanitizeTasksTimerSafeguard(normalized, now).map(task => needsLimitedStartFinish(task, now) ? finishLimitedStart(task, now) : task);
        return updated.some((task, index) => task !== previous[index]) ? updated : previous;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [lang]);

  const [activeFilter, setActiveFilter] = useState<FilterMode>('ALL');
  const [selectedPhase, setSelectedPhase] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const hash = window.location.hash;
      if (hash === '#today') return 'ALL';
      if (hash === '#dashboard') return 'DASHBOARD';
      if (hash === '#strategy' || hash === '#growth') return 'STRATEGY';
      if (hash === '#notes' || hash === '#notepad') return 'NOTES';
      if (hash === '#history' || hash === '#archive') return 'ALL';
    }
    return 'ALL';
  });

  const { notes, deletedNotes, notesOwner, storageError: notesStorageError, switchOwner: switchNotesOwner,
    addNote: handleAddNote, updateNote: handleUpdateNote, deleteNote: handleDeleteNote,
    restoreNote: handleRestoreNote, purgeNote: handlePurgeNote, getNotes: getCurrentNotes, getDeletedNotes: getCurrentDeletedNotes, replaceNotes: replaceAgentNotes, refreshNotes } = useAccountNotes(localStorage.getItem('karkas_workspace_owner'),
      lang === 'uk' ? INITIAL_NOTES_UK : INITIAL_NOTES_EN);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [quickAddPrefill, setQuickAddPrefill] = useState<QuickAddPrefill>();
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [revealNoteId, setRevealNoteId] = useState<string | null>(null);
  const [revealGrowthSkillId, setRevealGrowthSkillId] = useState<string | null>(null);
  const [taskUndo, setTaskUndo] = useState<{ ownerId: string | null; expiresAt: number; before: PSTask; after: PSTask; keys: (keyof PSTask)[]; label: string;
    prunedTasks: PSTask[]; prunedDeleted: DeletedTask[]; prunedReceipts: TaskCompletionLedger; retiredTargetReceipt?: TaskCompletionLedger[string] } | null>(null);
  useEffect(() => {
    if (!taskUndo) return;
    const timer = window.setTimeout(() => setTaskUndo(null), Math.max(0, taskUndo.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [taskUndo]);
  useEffect(() => {
    if (editingTaskId && workspaceReady && !tasks.some(task => task.id === editingTaskId)) {
      setEditingTaskId(null);
      setActionNotice(lang === 'uk' ? 'Завдання більше не доступне для редагування. Перевірте Архів.' : 'This task is no longer available for editing. Check Archive.');
    }
  }, [editingTaskId, tasks, workspaceReady]);
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [motionEnabled, setMotionEnabled] = useState(() => { try { return localStorage.getItem('karkas_motion') !== 'off'; } catch { return true; } });
  useEffect(() => {
    document.documentElement.classList.toggle('karkas-reduce-motion', !motionEnabled);
    try { localStorage.setItem('karkas_motion', motionEnabled ? 'on' : 'off'); } catch { /* the choice still applies to this session */ }
  }, [motionEnabled]);
  const quickAddPrefillKey = React.useRef(0);
  const [isAIOpen, setIsAIOpen] = useState(false);
  const [isManageTabsOpen, setIsManageTabsOpen] = useState(false);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [isUpdateOpen, setIsUpdateOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  useEffect(() => { if (selectedPhase === 'HISTORY') { setSelectedPhase('ALL'); setIsSettingsOpen(true); setArchiveOpen(true); } }, [selectedPhase]);
  useEffect(() => {
    if (window.location.hash === '#history' || window.location.hash === '#archive') { setIsSettingsOpen(true); setArchiveOpen(true); }
  }, []);
  const [launchAtStartup, setLaunchAtStartup] = useState<boolean | null>(null);
  const [startupPending, setStartupPending] = useState(() => Boolean(window.karkasDesktop));
  const [startupError, setStartupError] = useState<'read' | 'write' | 'unchanged' | null>(null);
  const startupPendingRef = React.useRef(Boolean(window.karkasDesktop));
  const [desktopPreferencesReady, setDesktopPreferencesReady] = useState(() => !window.karkasDesktop);
  const [appZoomPercent, setAppZoomPercent] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_APP_ZOOM;
    try {
      return normalizeAppZoom(localStorage.getItem(APP_ZOOM_KEY));
    } catch {
      return DEFAULT_APP_ZOOM;
    }
  });
  const [availableNewRelease, setAvailableNewRelease] = useState<{ tag_name: string; name?: string } | null>(null);
  const [appCurrentVersion, setAppCurrentVersion] = useState(APP_BUILD_VERSION);
  const [isAppVersionKnown, setIsAppVersionKnown] = useState(() => !window.karkasDesktop);

  useEffect(() => {
    const desktop = window.karkasDesktop;
    if (!desktop) return;
    let active = true;
    startupPendingRef.current = true;
    setStartupPending(true);
    requestStartupWithDeadline(() => desktop.system.getStartupEnabled()).then((startup) => {
      if (!active) return;
      if (startup.ok && typeof startup.value === 'boolean') {
        setLaunchAtStartup(startup.value);
        setStartupError(null);
      } else {
        setStartupError('read');
      }
    }).catch(() => {
      if (active) setStartupError('read');
    }).finally(() => {
      if (!active) return;
      startupPendingRef.current = false;
      setStartupPending(false);
    });
    Promise.allSettled([desktop.preferences.get(), desktop.system.getAppVersion()]).then(([preferencesResult, versionResult]) => {
      if (!active) return;
      const preferences = preferencesResult.status === 'fulfilled' ? preferencesResult.value : null;
      const version = versionResult.status === 'fulfilled' ? versionResult.value : null;
      if (preferences?.ok && preferences.value.zoomPercent != null) {
        setAppZoomPercent(normalizeAppZoom(preferences.value.zoomPercent));
      }
      if (version?.ok && typeof version.value === 'string' && isValidAppVersion(version.value)) {
        setAppCurrentVersion(version.value.trim());
        setIsAppVersionKnown(true);
      }
      setDesktopPreferencesReady(true);
    }).catch(() => {
      if (!active) return;
      setDesktopPreferencesReady(true);
    });
    const unsubscribe = desktop.window.onCommand((command) => {
      if (command === 'new-task') setIsQuickAddOpen(true);
      if (command === 'open-settings') setIsSettingsOpen(true);
    });
    return () => { active = false; unsubscribe(); };
  }, []);

  const handleRefreshStartup = async () => {
    const desktop = window.karkasDesktop;
    if (!desktop || startupPendingRef.current) return;
    startupPendingRef.current = true;
    setStartupPending(true);
    setStartupError(null);
    try {
      const result = await requestStartupWithDeadline(() => desktop.system.getStartupEnabled());
      if (result.ok && typeof result.value === 'boolean') setLaunchAtStartup(result.value);
      else setStartupError('read');
    } catch {
      setStartupError('read');
    } finally {
      startupPendingRef.current = false;
      setStartupPending(false);
    }
  };

  const handleLaunchAtStartupChange = async (enabled: boolean) => {
    const desktop = window.karkasDesktop;
    if (!desktop || launchAtStartup === null || startupPendingRef.current) return;
    startupPendingRef.current = true;
    setStartupPending(true);
    setStartupError(null);
    try {
      const result = await requestStartupWithDeadline(() => desktop.system.setStartupEnabled(enabled));
      if (result.ok && typeof result.value === 'boolean') {
        setLaunchAtStartup(result.value);
        if (result.value !== enabled) setStartupError('unchanged');
      } else {
        throw new Error('Startup change was not confirmed');
      }
    } catch {
      setStartupError('write');
      try {
        const confirmed = await requestStartupWithDeadline(() => desktop.system.getStartupEnabled());
        if (confirmed.ok && typeof confirmed.value === 'boolean') setLaunchAtStartup(confirmed.value);
      } catch {
        // Retain the last confirmed state when Windows cannot be read back.
      }
    } finally {
      startupPendingRef.current = false;
      setStartupPending(false);
    }
  };

  useEffect(() => {
    if (window.karkasDesktop && !desktopPreferencesReady) return;
    const normalizedZoom = normalizeAppZoom(appZoomPercent);
    try {
      localStorage.setItem(APP_ZOOM_KEY, String(normalizedZoom));
    } catch (error) {
      console.error('Failed to save app zoom', error);
    }

    const zoomFactor = normalizedZoom / 100;
    if (window.karkasDesktop) {
      document.documentElement.style.zoom = '';
      window.karkasDesktop.window.setZoomFactor(zoomFactor);
      void window.karkasDesktop.preferences.update({ zoomPercent: normalizedZoom });
    } else {
      document.documentElement.style.zoom = String(zoomFactor);
    }
  }, [appZoomPercent, desktopPreferencesReady]);

  // Background automated version analyzer: checks if a newer version exists
  useEffect(() => {
    let cancelled = false;
    setAvailableNewRelease(null);
    if (!isAppVersionKnown) return;
    const timer = setTimeout(async () => {
      try {
        const res = await karkasApiFetch('/api/check-update');
        if (res.ok) {
          const data = await res.json();
          if (!cancelled && data && data.tag_name && !data.draft && !data.prerelease) {
            if (isNewerAppVersion(data.tag_name, appCurrentVersion)) {
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

    return () => { cancelled = true; clearTimeout(timer); };
  }, [appCurrentVersion, isAppVersionKnown]);
  const [aiIconVariant, setAiIconVariant] = useState<AIIconId>(() => {
    return getSavedAIIconId();
  });
  const [aiPromptSeed, setAiPromptSeed] = useState('');
  const [aiSeedAsDraft, setAiSeedAsDraft] = useState(false);
  useEffect(() => {
    if (!isAIOpen) { setAiPromptSeed(''); setAiSeedAsDraft(false); }
  }, [isAIOpen]);
  const [breakingDownTaskId, setBreakingDownTaskId] = useState<string | null>(null);
  const [isWindowMinimized, setIsWindowMinimized] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [noteSearchQuery, setNoteSearchQuery] = useState('');
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const [tabToDeleteConfirm, setTabToDeleteConfirm] = useState<TaskTab | null>(null);
  useDialogKeyboard(!!tabToDeleteConfirm, () => setTabToDeleteConfirm(null), 'tab-delete-confirm-dialog');
  const searchInputRef = React.useRef<HTMLInputElement | null>(null);
  const openHeaderSearch = () => {
    setIsSettingsOpen(false); setIsAccountOpen(false);
    if (selectedPhase !== 'NOTES') setSelectedPhase('ALL');
    setSearchVisible(true);
    setSearchFocusToken(value => value + 1);
  };
  const closeHeaderSearch = () => {
    setSearchVisible(false); setSearchQuery(''); setNoteSearchQuery('');
  };
  const quickAddInputRef = React.useRef<HTMLInputElement | null>(null);
  const quickAddVisible = workspaceReady && activeFilter !== 'DONE'
    && !['DASHBOARD', 'STRATEGY', 'NOTES', 'HISTORY'].includes(selectedPhase);

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
      if (e.defaultPrevented || e.isComposing) return;
      if ((e.target as HTMLElement)?.closest('dialog[open], [aria-modal="true"]')) return;
      const targetTag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      const isInputFocused =
        targetTag === 'input' || targetTag === 'textarea' || (e.target as HTMLElement)?.isContentEditable;

      if (e.key === 'Escape') {
        if (isAIOpen) setIsAIOpen(false);
        else if (isAccountOpen) setIsAccountOpen(false);
        else if (isManageTabsOpen) setIsManageTabsOpen(false);
        else if (isUpdateOpen) setIsUpdateOpen(false);
        else if (isSettingsOpen) setIsSettingsOpen(false);
        else if (isAddOpen) setIsAddOpen(false);
        else if (isWindowMinimized) setIsWindowMinimized(false);
        else if (searchQuery || noteSearchQuery || searchVisible) closeHeaderSearch();
        return;
      }

      // Ctrl + Shift + F / Cmd + Shift + F -> Toggle Fire Animation
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        sound.tick(600);
        setFireEnabled((prev) => !prev);
        return;
      }

      const shortcut = e.code || e.key;
      if ((e.ctrlKey || e.metaKey) && (shortcut === 'KeyK' || e.key.toLowerCase() === 'k')) {
        e.preventDefault();
        if (!isAccountOpen && !isSettingsOpen && !isUpdateOpen && !isManageTabsOpen && !isAddOpen && !isQuickAddOpen) setIsAIOpen(true);
        return;
      }
      if (((e.ctrlKey || e.metaKey) && (shortcut === 'KeyF' || e.key.toLowerCase() === 'f') && !e.shiftKey) || e.key === '/' && !isInputFocused) {
        if (isAIOpen || isAccountOpen || isSettingsOpen || isUpdateOpen || isManageTabsOpen || isAddOpen || isQuickAddOpen) return;
        e.preventDefault();
        openHeaderSearch();
        return;
      }

      // Ctrl + N / Cmd + N -> Focus quick add or open the drawer
      if ((e.ctrlKey || e.metaKey) && (shortcut === 'KeyN' || e.key.toLowerCase() === 'n') && !isInputFocused && !isAIOpen && !isAccountOpen && !isSettingsOpen && !isUpdateOpen && !isManageTabsOpen && !isAddOpen && !isQuickAddOpen) {
        e.preventDefault();
        sound.tick(600);
        if (!['DASHBOARD', 'STRATEGY', 'NOTES', 'HISTORY'].includes(selectedPhase)) {
          setActiveFilter('ALL');
          setIsAddOpen(false);
          requestAnimationFrame(() => quickAddInputRef.current?.focus());
        } else setIsQuickAddOpen(true);
        return;
      }


    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isAIOpen, isAccountOpen, isManageTabsOpen, isUpdateOpen, isSettingsOpen, isAddOpen, isQuickAddOpen, isWindowMinimized, searchQuery, noteSearchQuery, searchVisible, quickAddVisible, selectedPhase]);

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
    if (!targetTask || breakingDownTaskId || breakdownRequestRef.current) return;

    setBreakingDownTaskId(taskId);
    sound.activate();

    const requestController = new AbortController();
    breakdownRequestRef.current = requestController;
    const requestGeneration = authGenerationRef.current;
    const targetSnapshot = taskBreakdownContext(targetTask);
    const requestTimeout = window.setTimeout(() => requestController.abort(), 35_000);

    try {
      const activeTasks = tasks.filter((t) => !t.done && !t.scheduledPending);
      const completedTasks = tasks.filter((t) => t.done);

      const customKey = readWebApiKey();
      const customModel = localStorage.getItem('karkas_custom_model') || '';
      const customEnabled = localStorage.getItem('karkas_custom_ai_enabled') === 'true';

      const res = await karkasApiFetch('/api/ai/breakdown-task', {
        method: 'POST',
        signal: requestController.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: targetTask.id,
          clientClock: { now: new Date().toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' },
          title: targetTask.title,
          task: targetTask,
          note: targetTask.note,
          currentSteps: targetTask.stepList?.map((s) => s.title) || [],
          lang,
          customApiKey: customEnabled ? customKey : undefined,
          selectedModel: customEnabled ? customModel : undefined,
          fullAppContext: {
            activeTasks,
            completedTasks,
            deletedTasks: selectRelevantArchivedTasks(tasks, deletedTasks).slice(0, 10),
            tabs: tabs.map((tb) => ({ id: tb.id, name: tb.name })),
            stats,
          },
        }),
      });

      if (!res.ok) throw new Error('API breakdown failed');
      const data = await res.json();
      const rawSteps = Array.isArray(data.stepList) ? data.stepList : Array.isArray(data.steps) ? data.steps : [];

      if (rawSteps.length === 0) {
        throw new Error('AI breakdown returned no steps');
      }

      const newStepItems: TaskStepItem[] = rawSteps.map((st: any, idx: number) => ({
          id: st.id || `s-${taskId}-${Date.now()}-${idx}`,
          title: typeof st === 'string' ? st : st.title || `Крок ${idx + 1}`,
          done: false,
        }));

      if (requestController.signal.aborted || requestGeneration !== authGenerationRef.current) return;
      const latestTarget = latestTasksRef.current.find(task => task.id === taskId);
      if (!latestTarget || taskBreakdownContext(latestTarget) !== targetSnapshot) {
        setActionNotice(lang === 'uk' ? 'Завдання змінилося під час генерації. Ваші правки збережено; повторіть створення кроків.' : 'The task changed during generation. Your edits are preserved; generate steps again.');
        return;
      }
      setTasks(prev => prev.map(task => {
        if (task.id !== taskId || taskBreakdownContext(task) !== targetSnapshot) return task;
        const existing = materializeStepList(task, lang === 'uk' ? 'Крок' : 'Step');
        const titles = new Set(existing.map(step => step.title.trim().toLowerCase()));
        const additions = newStepItems.filter(step => {
          const key = step.title.trim().toLowerCase();
          if (!key || titles.has(key)) return false;
          titles.add(key); return true;
        });
        return setTaskSteps(task, [...existing, ...additions], Date.now());
      }));
      if (data.source === 'engine' || data.source === 'heuristic-engine') setActionNotice(lang === 'uk' ? 'Кроки запропоновано за локальними правилами; перевірте їх.' : 'Steps use local rules; review them.');
      sound.activate();
    } catch (err) {
      if (requestGeneration !== authGenerationRef.current) return;
      console.error('Task breakdown error:', err);
      setActionNotice(lang === 'uk' ? 'Не вдалося створити кроки. Ваші дані збережено; повторіть спробу.' : 'Could not create steps. Your work is preserved; retry.');
    } finally {
      window.clearTimeout(requestTimeout);
      breakdownRequestRef.current = null;
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

  // The durable deletedAt deadline survives reload; it never blocks subsequent work.
  useEffect(() => {
    if (!recentlyDeleted) return;
    const archived = deletedTasks.find(task => task.id === recentlyDeleted.id);
    const remaining = (archived?.deletedAt ?? Date.now()) + 8000 - Date.now();
    const timer = setTimeout(() => {
      setRecentlyDeleted(null);
    }, Math.max(0, remaining));
    return () => clearTimeout(timer);
  }, [recentlyDeleted]);

  // Google Cloud Auth & Sync state
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [accountAvatarUrl, setAccountAvatarUrl] = useAccountAvatar(currentUser?.uid ?? null, currentUser?.photoURL);
  const strategyOwner = currentUser?.uid ?? null;
  useEffect(() => { setTaskUndo(null); setEditingTaskId(null); setArchiveOpen(false); setRevealNoteId(null); setRevealGrowthSkillId(null); setRecentlyDeleted(null); }, [strategyOwner]);
  const [personalProfile, setPersonalProfile] = useState(() => readPersonalStrategy(localStorage, localStorage.getItem('karkas_workspace_owner')));
  const [profileOwner, setProfileOwner] = useState<string | null>(() => localStorage.getItem('karkas_workspace_owner'));
  const personalProfileRef = React.useRef(personalProfile);
  personalProfileRef.current = personalProfile;
  useEffect(() => {
    const next = readPersonalStrategy(localStorage, strategyOwner);
    personalProfileRef.current = next; setPersonalProfile(next); setProfileOwner(strategyOwner);
  }, [strategyOwner]);

  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<number | null>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(LAST_SYNC_KEY);
      return saved ? Number(saved) : null;
    }
    return null;
  });
  const lastSyncTimeRef = React.useRef(lastSyncTime);
  lastSyncTimeRef.current = lastSyncTime;
  const updateLastSyncTime = (value: number | null) => {
    lastSyncTimeRef.current = value;
    setLastSyncTime(value);
    if (value === null) localStorage.removeItem(LAST_SYNC_KEY);
    else localStorage.setItem(LAST_SYNC_KEY, String(value));
  };
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
  const [syncStatus, setSyncStatus] = useState<'idle' | 'pending' | 'syncing' | 'synced' | 'offline' | 'error'>(
    () => navigator.onLine ? 'idle' : 'offline',
  );
  const [syncError, setSyncError] = useState<string | null>(null);
  const [nextSyncRetryAt, setNextSyncRetryAt] = useState<number | null>(null);

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
  const [deletedTasks, setDeletedTasks] = useState<DeletedTask[]>(initialWorkspace.workspace.deletedTasks);
  const [completionLedger, setCompletionLedger] = useState<TaskCompletionLedger | undefined>(initialWorkspace.workspace.settings.completionLedger);
  useEffect(() => {
    if (!workspaceReady || workspaceOwnerRef.current !== strategyOwner) return;
    const pending = deletedTasks.filter(task => task.deletedAt + 8000 > Date.now()).sort((a, b) => b.deletedAt - a.deletedAt)[0];
    if (!pending) return;
    const key = (strategyOwner ?? 'guest') + ':' + pending.id + ':' + pending.deletedAt;
    if (!shownDeletedRef.current.has(key)) { shownDeletedRef.current.add(key); setRecentlyDeleted(pending); }
  }, [deletedTasks, workspaceReady, strategyOwner]);
  const currentCompletionLedgerRef = React.useRef(completionLedger);
  currentCompletionLedgerRef.current = completionLedger;
  const completionLedgerOwnerRef = React.useRef(localStorage.getItem('karkas_workspace_owner'));

  // Track state values inside refs to avoid re-subscribing Firestore listener unnecessarily
  const currentTasksRef = React.useRef(tasks);
  currentTasksRef.current = tasks;
  const currentTabsRef = React.useRef(tabs);
  currentTabsRef.current = tabs;
  const currentDeletedTasksRef = React.useRef(deletedTasks);
  currentDeletedTasksRef.current = deletedTasks;
  archivedScheduleIdsRef.current = deletedTasks.map(task => task.id);
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
      if (!canPersistWorkspaceRef.current) return;
      writeRecoverableJson(localStorage, STORAGE_KEY, JSON.stringify(tasks));
    } catch (e) {
      console.error('Failed to save tasks to localStorage', e);
      setWorkspaceStorageError(true);
    }
  }, [tasks]);

  // Sync deletedTasks with localStorage
  useEffect(() => {
    try {
      if (!canPersistWorkspaceRef.current) return;
      writeRecoverableJson(localStorage, DELETED_STORAGE_KEY, JSON.stringify(deletedTasks));
    } catch (e) {
      console.error('Failed to save deleted tasks to localStorage', e);
      setWorkspaceStorageError(true);
    }
  }, [deletedTasks]);

  // Sync tabs with localStorage
  useEffect(() => {
    try {
      if (!canPersistWorkspaceRef.current) return;
      writeRecoverableJson(localStorage, TABS_KEY, JSON.stringify(tabs));
    } catch (e) {
      console.error('Failed to save tabs to localStorage', e);
      setWorkspaceStorageError(true);
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

  // Hash synchronization for Dashboard, Notes and History views
  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (selectedPhase === 'DASHBOARD') {
        window.location.hash = '#dashboard';
      } else if (selectedPhase === 'STRATEGY') {
        window.location.hash = '#growth';
      } else if (selectedPhase === 'NOTES') {
        window.location.hash = '#notes';
      } else if (selectedPhase === 'HISTORY') {
        window.location.hash = '#history';
      } else if (window.location.hash === '#dashboard' || window.location.hash === '#strategy' || window.location.hash === '#growth' || window.location.hash === '#notes' || window.location.hash === '#notepad' || window.location.hash === '#history') {
        history.replaceState(null, '', window.location.pathname);
      }
    }
  }, [selectedPhase]);

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;
      if (hash === '#today') setSelectedPhase('ALL');
      else if (hash === '#dashboard') setSelectedPhase('DASHBOARD');
      else if (hash === '#strategy' || hash === '#growth') setSelectedPhase('STRATEGY');
      else if (hash === '#notes' || hash === '#notepad') setSelectedPhase('NOTES');
      else if (hash === '#history' || hash === '#archive') { setIsSettingsOpen(true); setArchiveOpen(true); }
      else if (isSystemView(selectedPhase) && selectedPhase !== 'ALL') setSelectedPhase('ALL');
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [selectedPhase]);

  // Account snapshots retain unsent edits across reloads and sign-out.
  const workspaceOwnerRef = React.useRef<string | null>(localStorage.getItem('karkas_workspace_owner'));
  useEffect(() => {
    const ownerId = workspaceOwnerRef.current;
    const previous = previousSessionTasksRef.current;
    const ready = workspaceReady && timerWorkspaceReadyRef.current && ownerId === (currentUser?.uid ?? null);
    previousSessionTasksRef.current = { tasks, ownerId, ready };
    if (!ready || !previous?.ready || previous.ownerId !== ownerId) {
      setSessionSummary(null);
      return;
    }
    const now = Date.now();
    const ended = detectEndedSessions(previous.tasks, tasks, now).at(-1);
    const task = ended && tasks.find(item => item.id === ended.taskId);
    if (!ended || !task) {
      setSessionSummary(current => {
        if (!current) return current;
        const live = tasks.find(item => item.id === current.session.taskId);
        return !live || live.timerRunning || live.done !== current.task.done
          || current.session.reason === 'countdownEnded' && live.countdownExpiredAt !== current.task.countdownExpiredAt ? null : current;
      });
      return;
    }
    setSessionSummary({ session: ended, task, ownerId, shownAt: now });
    sound.sessionComplete();
  }, [tasks, workspaceReady, currentUser?.uid]);

  const desktopWorkspaceReadyRef = React.useRef(!window.karkasDesktop);
  const desktopMirrorSequenceRef = React.useRef(new Map<string | null, number>());
  const baseWorkspaceRef = React.useRef<(WorkspaceState & { revision?: number }) | null>(undefined);
  if (baseWorkspaceRef.current === undefined) {
    try {
      const cached = localStorage.getItem('karkas_workspace:' + (workspaceOwnerRef.current || 'guest'));
      baseWorkspaceRef.current = cached ? parseAccountRecord(cached, localStorage, accountKeyForOwner(workspaceOwnerRef.current)).base || null : null;
    } catch { baseWorkspaceRef.current = null; canPersistWorkspaceRef.current = false; }
  }
  const authGenerationRef = React.useRef(0);
  const strategyPersistenceGenerationRef = React.useRef(0);
  const savingRef = React.useRef<number | null>(null);
  const queuedRemoteRef = React.useRef<UserCloudState | null>(null);
  const autoSyncEnabledRef = React.useRef(autoSyncEnabled);
  autoSyncEnabledRef.current = autoSyncEnabled;
  const accountKey = accountKeyForOwner;
  const readWorkspace = (): WorkspaceState => normalizeWorkspaceForStorage({
    ...Object.fromEntries(growthFields.flatMap(key => {
      const value = growthPresenceRef.current.has(key) ? growthRef.current[key] : baseWorkspaceRef.current?.[key];
      return value === undefined ? [] : [[key, value]];
    })),
    tasks: currentTasksRef.current,
    tabs: currentTabsRef.current,
    deletedTasks: currentDeletedTasksRef.current,
    settings: {
      soundEnabled: currentSoundEnabledRef.current,
      fireEnabled: currentFireEnabledRef.current,
      lang: currentLangRef.current,
      aiIconVariant: currentAiIconVariantRef.current,
      ...(currentCompletionLedgerRef.current !== undefined ? { completionLedger: currentCompletionLedgerRef.current } : {}),
    },
  });
  const persistWorkspace = (): Promise<boolean> => {
    if (!canPersistWorkspaceRef.current) return Promise.resolve(false);
    const ownerId = workspaceOwnerRef.current;
    const mirrorSequence = (desktopMirrorSequenceRef.current.get(ownerId) ?? 0) + 1;
    desktopMirrorSequenceRef.current.set(ownerId, mirrorSequence);
    const record = {
      workspace: readWorkspace(),
      base: baseWorkspaceRef.current,
      lastSyncTime: lastSyncTimeRef.current,
      desktopMirrorPending: !!window.karkasDesktop,
    };
    const serialized = JSON.stringify(record);
    writeRecoverableJson(localStorage, accountKey(ownerId), serialized);
    if (!window.karkasDesktop) return Promise.resolve(true);
    if (!desktopWorkspaceReadyRef.current) return Promise.resolve(false);
    // Capture an immutable record: refs and base can change while IPC is pending.
    const { desktopMirrorPending: _pendingMirror, ...capturedRecord } = JSON.parse(serialized);
    try {
      return window.karkasDesktop.workspace.saveAccount({ ownerId, record: capturedRecord })
        .then(result => {
          if (result.ok) {
            try {
              // Clear only this exact acknowledged snapshot; a newer commit keeps its own pending marker.
              if (desktopMirrorSequenceRef.current.get(ownerId) === mirrorSequence && localStorage.getItem(accountKey(ownerId)) === serialized) writeRecoverableJson(localStorage, accountKey(ownerId),
                JSON.stringify({ ...record, desktopMirrorPending: false }));
            } catch { /* Keeping the marker simply replays the same authoritative local snapshot on reload. */ }
          }
          return result.ok;
        }).catch(() => false);
    } catch { return Promise.resolve(false); }
  };
  const applyWorkspace = (input: WorkspaceState, localSessionChange = false) => {
    if (!canPersistWorkspaceRef.current) throw new Error('Recovery backup failed; workspace writes are blocked');
    // Missing legacy fields are unknown, not deletions of an acknowledged record.
    const hydrated = { ...input, settings: { ...input.settings } };
    // Legacy copies of this account cannot erase credits for retired history.
    // A different account must start from its own ledger.
    if (completionLedgerOwnerRef.current === workspaceOwnerRef.current && currentCompletionLedgerRef.current !== undefined) {
      hydrated.settings.completionLedger = mergeCompletionLedgers(currentCompletionLedgerRef.current, input.settings.completionLedger);
    }
    for (const key of growthFields) {
      if (hydrated[key] === undefined && baseWorkspaceRef.current?.[key] !== undefined) {
        Object.assign(hydrated, { [key]: baseWorkspaceRef.current[key] });
      }
    }
    const value = normalizeCompletedTaskHistory(migrateSystemCategories(parseWorkspace(hydrated)));
    // Persist the owned authoritative snapshot before publishing success to the UI.
    writeRecoverableJson(localStorage, accountKey(workspaceOwnerRef.current), JSON.stringify({
      workspace: value, base: baseWorkspaceRef.current, lastSyncTime: lastSyncTimeRef.current,
      desktopMirrorPending: !!window.karkasDesktop,
    }));
    // Store compact completion credits before dropping any full history records.
    // The owned account above is the commit point. Optional compatibility mirrors
    // must never turn an already committed create into a failed, retryable create.
    let mirrorFailed = false;
    const mirror = (key: string, data: unknown) => {
      try { writeRecoverableJson(localStorage, key, JSON.stringify(data)); }
      catch { mirrorFailed = true; }
    };
    mirror(COMPLETION_LEDGER_KEY, value.settings.completionLedger ?? {});
    currentCompletionLedgerRef.current = value.settings.completionLedger;
    completionLedgerOwnerRef.current = workspaceOwnerRef.current;
    setCompletionLedger(value.settings.completionLedger);
    // A loaded or merged snapshot becomes the baseline, never a local session ending.
    if (!localSessionChange) previousSessionTasksRef.current = { tasks: value.tasks, ownerId: workspaceOwnerRef.current, ready: timerWorkspaceReadyRef.current };
    ++timerNoticeScopeRef.current;
    setTimerNotice(null);
    latestTasksRef.current = value.tasks;
    archivedScheduleIdsRef.current = value.deletedTasks.map(task => task.id);
    currentTasksRef.current = value.tasks;
    currentTabsRef.current = value.tabs;
    currentDeletedTasksRef.current = value.deletedTasks;
    growthPresenceRef.current = new Set(growthFields.filter(key => value[key] !== undefined));
    growthRef.current = growthStateFrom(value);
    setGrowthState(growthRef.current);
    currentSoundEnabledRef.current = value.settings.soundEnabled;
    currentFireEnabledRef.current = value.settings.fireEnabled;
    currentLangRef.current = value.settings.lang as Language;
    currentAiIconVariantRef.current = value.settings.aiIconVariant as AIIconId;
    setTaskState(value.tasks);
    setTabs(value.tabs);
    setDeletedTasks(value.deletedTasks);
    setSoundEnabled(value.settings.soundEnabled);
    sound.enabled = value.settings.soundEnabled;
    setFireEnabled(value.settings.fireEnabled);
    setLang(value.settings.lang as Language);
    setAiIconVariant(value.settings.aiIconVariant as AIIconId);
    mirror(STORAGE_KEY, value.tasks);
    mirror(TABS_KEY, value.tabs);
    mirror(DELETED_STORAGE_KEY, value.deletedTasks);
    mirror(GROWTH_SKILLS_KEY, growthRef.current.skills);
    mirror(GROWTH_MEASUREMENTS_KEY, growthRef.current.measurements);
    mirror(GROWTH_SESSIONS_KEY, growthRef.current.practiceSessions);
    try { localStorage.setItem(AI_ICON_KEY, value.settings.aiIconVariant); } catch { mirrorFailed = true; }
    const owner = workspaceOwnerRef.current;
    try {
      void persistWorkspace().then(saved => {
        if (owner === workspaceOwnerRef.current) {
          if (!saved || mirrorFailed) setActionNotice(lang === 'uk' ? 'Зміни збережено локально. Додаткову резервну копію поки не оновлено.' : 'Changes are saved locally. The additional backup has not been updated yet.');
          setWorkspaceStorageError(false);
        }
      });
    } catch {
      setActionNotice(lang === 'uk' ? 'Зміни збережено локально. Додаткову резервну копію поки не оновлено.' : 'Changes are saved locally. The additional backup has not been updated yet.');
    }
  };

  const commitTaskChange = (before: PSTask, after: PSTask, label: string): boolean => {
    if (!timerWorkspaceReadyRef.current || !canPersistWorkspaceRef.current || workspaceOwnerRef.current !== strategyOwner
      || (auth.currentUser?.uid ?? null) !== strategyOwner || tabMigrationBusyRef.current) return false;
    const live = latestTasksRef.current.find(task => task.id === before.id);
    if (!live) return false;
    const now = Math.max(Date.now(), (live.updatedAt ?? 0) + 1);
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key =>
      key !== 'updatedAt' && key !== 'activityTrail' && canonical(before[key as keyof PSTask]) !== canonical(after[key as keyof PSTask])) as (keyof PSTask)[];
    if (!keys.length) return true;
    if (keys.some(key => canonical(live[key]) !== canonical(before[key]))) return false;
    const next = annotateTaskChanges([live], [{ ...live, ...Object.fromEntries(keys.map(key => [key, after[key]])), updatedAt: now }], now)[0];
    const workspace = readWorkspace();
    try {
      applyWorkspace(normalizeWorkspaceForStorage({ ...workspace, tasks: workspace.tasks.map(task => task.id === live.id ? next : task) }), true);
      const retained = new Set([...currentTasksRef.current, ...currentDeletedTasksRef.current].map(task => task.id));
      const prunedTasks = workspace.tasks.filter(task => task.id !== live.id && !retained.has(task.id));
      const prunedDeleted = workspace.deletedTasks.filter(task => task.id !== live.id && !retained.has(task.id));
      const prunedReceipts: TaskCompletionLedger = Object.create(null);
      for (const task of [...prunedTasks, ...prunedDeleted]) {
        const receipt = currentCompletionLedgerRef.current?.[task.id];
        if (receipt) prunedReceipts[task.id] = receipt;
      }
      const retiredTargetReceipt = !retained.has(live.id) ? currentCompletionLedgerRef.current?.[live.id] : undefined;
      setTaskUndo({ ownerId: strategyOwner, expiresAt: Date.now() + 8000, before: before.timerRunning ? pauseTaskTimer(before, before.done !== after.done ? after.completedAt ?? Date.now() : Date.now()) : before, after: next, keys, label,
        prunedTasks, prunedDeleted, prunedReceipts, retiredTargetReceipt });
      setCompletedNoticeId(null);
      return true;
    } catch { setWorkspaceStorageError(true); return false; }
  };
  const handleUndoTaskChange = (): boolean => {
    if (!taskUndo || taskUndo.ownerId !== strategyOwner || Date.now() >= taskUndo.expiresAt || !timerWorkspaceReadyRef.current
      || workspaceOwnerRef.current !== strategyOwner || (auth.currentUser?.uid ?? null) !== strategyOwner) return false;
    const workspace = readWorkspace();
    // A backdated 51st completion can itself fall outside retained history.
    // Its exact receipt is sufficient only when this action retired it.
    const retiredTarget = !!taskUndo.retiredTargetReceipt
      && !workspace.tasks.some(task => task.id === taskUndo.after.id)
      && !workspace.deletedTasks.some(task => task.id === taskUndo.after.id)
      && canonical(workspace.settings.completionLedger?.[taskUndo.after.id]) === canonical(taskUndo.retiredTargetReceipt);
    const live = workspace.tasks.find(task => task.id === taskUndo.after.id) ?? (retiredTarget ? taskUndo.after : undefined);
    if (!live || taskUndo.keys.some(key => canonical(live[key]) !== canonical(taskUndo.after[key]))) {
      setActionNotice(lang === 'uk' ? 'Запис уже змінився. Скасування не перезапише нові правки.' : 'The record changed. Undo will not overwrite newer edits.'); return false;
    }
    if ([...taskUndo.prunedTasks, ...taskUndo.prunedDeleted].some(task => workspace.tasks.some(value => value.id === task.id)
      || workspace.deletedTasks.some(value => value.id === task.id)
      || canonical(workspace.settings.completionLedger?.[task.id]) !== canonical(taskUndo.prunedReceipts[task.id]))) {
      setActionNotice(lang === 'uk' ? 'Архів уже змінився. Скасування не перезапише нові дані.' : 'Archive changed. Undo will not overwrite newer data.'); return false;
    }
    const now = Math.max(Date.now(), (live.updatedAt ?? 0) + 1, (workspace.settings.completionLedger?.[live.id]?.updatedAt ?? 0) + 1,
      (workspace.settings.completionLedger?.[live.id]?.retiredAt ?? 0) + 1);
    const restored: PSTask = { ...live, ...Object.fromEntries(taskUndo.keys.map(key => [key, taskUndo.before[key]])), updatedAt: now };
    // Undo never restarts a timer. Banking preserves actual work measured up to the original action.
    const changesTimer = taskUndo.keys.some(key => ['done', 'timerRunning', 'timerStartedAt', 'timerMode', 'countdownRemainingSeconds', 'timeSpentSeconds'].includes(key));
    const paused = changesTimer ? pauseTaskTimer(restored, Date.now()) : restored;
    const ledger = { ...workspace.settings.completionLedger };
    if (live.done !== paused.done || live.completedAt !== paused.completedAt) ledger[live.id] = {
      completedAt: paused.completedAt ?? ledger[live.id]?.completedAt ?? paused.createdAt, updatedAt: now,
      counted: paused.done && !paused.scheduledPending,
    };
    const restoreRetained = <T extends PSTask>(task: T): T => ({ ...task, updatedAt: Math.max(now, (ledger[task.id]?.retiredAt ?? 0) + 1, (ledger[task.id]?.updatedAt ?? 0) + 1) });
    try {
      applyWorkspace(normalizeWorkspaceForStorage({ ...workspace, tasks: [...workspace.tasks.map(task => task.id === live.id ? paused : task), ...(retiredTarget ? [paused] : []), ...taskUndo.prunedTasks.map(restoreRetained)],
        deletedTasks: [...workspace.deletedTasks, ...taskUndo.prunedDeleted.map(restoreRetained)],
        settings: { ...workspace.settings, completionLedger: ledger } }), true);
      setTaskUndo(null); setCompletedNoticeId(null); return true;
    } catch { setWorkspaceStorageError(true); return false; }
  };

  React.useLayoutEffect(() => {
    if (!workspaceReady || !canPersistWorkspaceRef.current || !timerWorkspaceReadyRef.current
      || tabMigrationBusyRef.current || workspaceOwnerRef.current !== (auth.currentUser?.uid ?? null)) return;
    const current = readWorkspace();
    const normalized = normalizeCompletedTaskHistory(current);
    if (sameWorkspace(current, normalized)) return;
    try { applyWorkspace(normalized, true); }
    catch (error) {
      console.error('Could not retain completion history:', error);
      setWorkspaceStorageError(true);
    }
  }, [tasks, deletedTasks, completionLedger, workspaceReady]);

  const recoveryCandidate = useMemo(() => {
    if (tasks.length || tabs.length || deletedTasks.length || Object.keys(completionLedger ?? {}).length || growthState.skills.length || growthState.measurements.length || growthState.practiceSessions.length) return null;
    try { return readAccountRecovery(localStorage, accountKey(strategyOwner)); } catch { return null; }
  }, [strategyOwner, workspaceReady, tasks.length, tabs.length, deletedTasks.length, completionLedger, growthState]);
  const restoreRetainedWorkspace = () => {
    if (!recoveryCandidate || workspaceOwnerRef.current !== strategyOwner || (auth.currentUser?.uid ?? null) !== strategyOwner
      || currentTasksRef.current.length || currentTabsRef.current.length || currentDeletedTasksRef.current.length
      || growthRef.current.skills.length || growthRef.current.measurements.length || growthRef.current.practiceSessions.length || !initialWorkspace.backupPreserved) return;
    try {
      // Restore only the validated workspace; obsolete sync journals are not replayed.
      const recoveredWorkspace = parseWorkspace(recoveryCandidate.workspace);
      const existing = localStorage.getItem(accountKey(strategyOwner));
      if (existing !== null) preserveRawStorage(localStorage, accountKey(strategyOwner), existing);
      canPersistWorkspaceRef.current = true;
      // Restore the workspace only; old requests and sync retries must not replay.
      baseWorkspaceRef.current = null;
      lastSyncTimeRef.current = 0;
      applyWorkspace(recoveredWorkspace);
      timerWorkspaceReadyRef.current = true;
      setWorkspaceReady(true);
      setSyncError(null);
      setActionNotice(lang === 'uk' ? 'Простір відновлено. Початкові резервні копії збережено.' : 'Workspace restored. Original backups retained.');
    } catch {
      canPersistWorkspaceRef.current = false;
      setActionNotice(lang === 'uk' ? 'Не вдалося відновити простір. Резервні копії збережено.' : 'Could not restore the workspace. Backups retained.');
    }
  };

  React.useLayoutEffect(() => {
    if (!timerWorkspaceReadyRef.current) return;
    const owner = workspaceOwnerRef.current;
    let cancelled = false;
    try {
      void persistWorkspace().then(saved => {
        if (!cancelled && owner === workspaceOwnerRef.current) setWorkspaceStorageError(!saved || localStorage.getItem(workspaceTabTransactionKey(owner)) !== null);
      });
    } catch (error) {
      console.error('Local account backup failed:', error);
      setWorkspaceStorageError(true);
    }
    return () => { cancelled = true; };
  }, [tasks, tabs, deletedTasks, growthState, soundEnabled, fireEnabled, lang, aiIconVariant, completionLedger]);

  useEffect(() => {
    if (!workspaceStorageError) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [workspaceStorageError]);

  const retryWorkspaceSave = async () => {
    try {
      if (!canPersistWorkspaceRef.current || tabMigrationBusyRef.current) return;
      const owner = workspaceOwnerRef.current;
      const generation = authGenerationRef.current;
      const journal = localStorage.getItem(workspaceTabTransactionKey(owner));
      const recovery = recoverTabMigration(owner, readWorkspace(), personalProfileRef.current);
      if (recovery.status === 'invalid' || recovery.status === 'conflict') {
        setActionNotice(lang === 'uk' ? 'Перенесення вкладок конфліктує з новішими даними. Поточні дані та журнал збережено для окремого відновлення.' : 'The tab migration conflicts with newer data. Current data and the journal were retained for separate recovery.');
        return;
      }
      if (recovery.status === 'recovered') {
        if (!savePersonalStrategy(localStorage, owner, recovery.profile)) throw new Error('Goal recovery could not be saved');
        personalProfileRef.current = recovery.profile;
        setPersonalProfile(recovery.profile);
        applyWorkspace(recovery.workspace);
      }
      writeRecoverableJson(localStorage, STORAGE_KEY, JSON.stringify(currentTasksRef.current));
      writeRecoverableJson(localStorage, TABS_KEY, JSON.stringify(currentTabsRef.current));
      writeRecoverableJson(localStorage, DELETED_STORAGE_KEY, JSON.stringify(currentDeletedTasksRef.current));
      const saved = await persistWorkspace();
      if (generation !== authGenerationRef.current || owner !== workspaceOwnerRef.current) return;
      const completed = journal === null || await completeWorkspaceTabTransaction(localStorage, owner, journal, Promise.resolve(saved),
        () => generation === authGenerationRef.current && owner === workspaceOwnerRef.current && (auth.currentUser?.uid ?? null) === owner);
      if (generation === authGenerationRef.current && owner === workspaceOwnerRef.current) {
        const pending = localStorage.getItem(workspaceTabTransactionKey(owner)) !== null;
        setWorkspaceStorageError(!saved || !completed || pending);
        if (saved && completed && !pending && (journal !== null || queuedRemoteRef.current !== null)) setWorkspaceReloadToken(value => value + 1);
      }
    } catch { setWorkspaceStorageError(true); }
  };

  const recoverTabMigration = (owner: string | null, workspace: WorkspaceState, profile: PersonalStrategyProfile) => {
    const recovery = recoverWorkspaceTabTransaction(localStorage, owner, workspace, profile);
    if (recovery.status === 'recovered') refreshNotes(owner);
    if (recovery.status !== 'conflict' || !recovery.conflictParts.includes('profile')) return recovery;
    // Hydration trims user text; the stored raw profile can still match the exact journal.
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(personalStrategyKey(owner)) || 'null');
      if (intactStoredStrategy(raw)) {
        const retried = recoverWorkspaceTabTransaction(localStorage, owner, workspace, raw as PersonalStrategyProfile);
        if (retried.status === 'recovered') refreshNotes(owner);
        return retried;
      }
    } catch { /* Retain the original conflict without discarding any data. */ }
    return recovery;
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      const generation = ++authGenerationRef.current;
      ++timerNoticeScopeRef.current;
      setTimerNotice(null);
      notifiedTimersRef.current.clear();
      notifiedSchedulesRef.current.clear();
      latestTasksRef.current = [];
      timerWorkspaceReadyRef.current = false;
      setWorkspaceReady(false);
      setSessionSummary(null);
      previousSessionTasksRef.current = null;
      setIsAIOpen(false);
      setIsAddOpen(false);
      setIsManageTabsOpen(false);
      setTabToDeleteConfirm(null);
      setCompletedTaskToDelete(null);
      setCompletedNoticeId(null);
      setSearchVisible(false); setSearchQuery(''); setNoteSearchQuery('');
      savingRef.current = null;
      queuedRemoteRef.current = null;
      const uid = user?.uid || null;
      let localAccountLoaded = false;
      window.dispatchEvent(new Event('karkas:flush-notepad'));
      switchNotesOwner(uid);
      cloudSyncReadyRef.current = false;
      setIsCloudSyncReady(false);
      setCurrentUser(user);
      setCloudData(null);
      updateLastSyncTime(null);
      setSyncError(null);
      setSyncStatus(user ? (navigator.onLine ? 'syncing' : 'offline') : 'idle');
      try {
        const previousOwner = workspaceOwnerRef.current;
        const cachedText = localStorage.getItem(accountKey(uid));
        let cached = cachedText ? parseAccountRecord(cachedText, localStorage, accountKey(uid)) : null;
        if (window.karkasDesktop) {
          const desktopCached = await window.karkasDesktop.workspace.loadAccount(uid);
          if (generation !== authGenerationRef.current || (auth.currentUser?.uid ?? null) !== uid) return;
          if (!desktopCached.ok) throw new Error('Local account data could not be validated or loaded');
          if (desktopCached.value) {
            const original = JSON.stringify(desktopCached.value);
            for (const field of ['workspace', 'base'] as const) {
              if (!desktopCached.value[field]) continue;
              const parsed = parseWorkspace(desktopCached.value[field]);
              if (parsed !== desktopCached.value[field]) preserveRawStorage(localStorage, accountKey(uid), original);
              desktopCached.value[field] = parsed;
            }
            // A pending paired commit makes its local snapshot authoritative until recovery finishes.
            const recoverLocal = cached?.workspace && (cached.desktopMirrorPending === true || readStrategyTransaction(localStorage, uid)
              || localStorage.getItem(workspaceTabTransactionKey(uid)) !== null);
            if (recoverLocal && !sameWorkspace(cached.workspace, desktopCached.value.workspace)) {
              preserveRawStorage(localStorage, accountKey(uid) + ':desktop-mirror', original);
            }
            // An unacknowledged local commit outranks an older device mirror. Keep
            // the desktop-owned queue metadata while restoring its paired local baseline.
            cached = recoverLocal ? { ...desktopCached.value, workspace: cached.workspace, base: cached.base ?? null,
              lastSyncTime: cached.lastSyncTime ?? null, desktopMirrorPending: true } : desktopCached.value;
          }
          const activeOwner = await window.karkasDesktop.workspace.setActiveOwner(uid);
          if ('error' in activeOwner) throw new Error(activeOwner.error.message);
          if (generation !== authGenerationRef.current || (auth.currentUser?.uid ?? null) !== uid) return;
          desktopWorkspaceReadyRef.current = true;
        }
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
        updateLastSyncTime(typeof cached?.lastSyncTime === 'number' ? cached.lastSyncTime : null);
        if (cached?.inFlightSync || cached?.pendingSync) {
          const pending = cached.inFlightSync || cached.pendingSync;
          setNextSyncRetryAt(pending?.nextAttemptAt ?? null);
          setSyncError(pending?.lastError || null);
          setSyncStatus(navigator.onLine ? 'pending' : 'offline');
        }
        if (cached?.workspace) {
          // A validated account snapshot may recover the failed initial cache,
          // but only after every original raw record has a verified backup.
          if (initialWorkspace.backupPreserved) canPersistWorkspaceRef.current = true;
          applyWorkspace(cached.workspace);
        } else if (previousOwner !== uid && (previousOwner !== null || !uid
          || !claimGuestWorkspaceImport(localStorage, uid))) {
          applyWorkspace({
            tasks: [], tabs: [], deletedTasks: [], skills: [], measurements: [], practiceSessions: [],
            settings: { soundEnabled: true, fireEnabled: true, lang: 'uk', aiIconVariant: 'quantum' },
          });
        } else {
          completionLedgerOwnerRef.current = uid;
          persistWorkspace();
        }
        const tabRecovery = recoverTabMigration(uid, readWorkspace(), readPersonalStrategy(localStorage, uid));
        if (tabRecovery.status === 'recovered') {
          const journal = localStorage.getItem(workspaceTabTransactionKey(uid));
          if (!savePersonalStrategy(localStorage, uid, tabRecovery.profile)) throw new Error('Tab goal recovery could not be saved');
          personalProfileRef.current = tabRecovery.profile;
          setPersonalProfile(tabRecovery.profile);
          setProfileOwner(uid);
          applyWorkspace(tabRecovery.workspace);
          const completed = await completeWorkspaceTabTransaction(localStorage, uid, journal, persistWorkspace(),
            () => generation === authGenerationRef.current && workspaceOwnerRef.current === uid && (auth.currentUser?.uid ?? null) === uid);
          if (generation !== authGenerationRef.current || (auth.currentUser?.uid ?? null) !== uid) return;
          if (!completed) { setWorkspaceStorageError(true); return; }
        } else if (tabRecovery.status === 'conflict' || tabRecovery.status === 'invalid') {
          setActionNotice(lang === 'uk' ? 'Незавершене перенесення вкладок потребує відновлення. Поточні дані й журнал збережено; нові зміни вкладок заблоковано.' : 'A pending tab migration needs recovery. Current data and the journal were retained; new tab changes are blocked.');
          setWorkspaceStorageError(true);
          return;
        }
        localAccountLoaded = canPersistWorkspaceRef.current;
        timerWorkspaceReadyRef.current = localAccountLoaded;
        setWorkspaceReady(localAccountLoaded);
        if (!user) return;
        setIsSyncing(true);
        const data = await fetchUserCloudData(user.uid);
        if (generation !== authGenerationRef.current || auth.currentUser?.uid !== user.uid) return;
        if (data) {
          if (data.shadowStatus === 'deferred' || data.shadowStatus === 'migrating') {
            void advanceUserCloudShadowMigration(user.uid).catch((error) =>
              console.warn('Cloud schema migration will resume later:', error));
          }
          if (data.shadowStatus === 'ready' && data.shadowRevision === data.revision) {
            void verifyUserCloudShadowData(user.uid, data).then((valid) => {
              if (!valid) {
                console.warn('Cloud schema v2 shadow does not match the legacy workspace; scheduling repair.');
                void repairUserCloudShadowData(user.uid, data.revision || 0).catch((error) =>
                  console.warn('Cloud schema v2 repair will resume later:', error));
              }
            });
          }
          if ((data.revision || 0) < (baseWorkspaceRef.current?.revision || 0)) {
            setSyncStatus(navigator.onLine ? 'pending' : 'offline');
            return;
          }
          if (cached?.workspace && !autoSyncEnabledRef.current) {
            setCloudData(data);
            setSyncStatus(cached?.inFlightSync || cached?.pendingSync ? (navigator.onLine ? 'pending' : 'offline') : 'idle');
            return;
          }
          const merged = mergeWorkspace(baseWorkspaceRef.current, readWorkspace(), data, {
            preferRemoteSettingsOnFirstSync: !cached?.workspace,
          });
          baseWorkspaceRef.current = data;
          applyWorkspace(merged);
          setCloudData(data);
          if (sameWorkspace(merged, data)) {
            updateLastSyncTime(data.updatedAt);
            setSyncStatus('synced');
          } else {
            setSyncStatus(navigator.onLine ? 'pending' : 'offline');
          }
        } else {
          persistWorkspace();
          setSyncStatus(navigator.onLine ? 'pending' : 'offline');
        }
      } catch (error) {
        if (generation !== authGenerationRef.current || (auth.currentUser?.uid ?? null) !== uid) return;
        console.error('Cloud initialization failed; local account data retained:', error);
        setSyncError(error instanceof Error ? error.message : 'Cloud initialization failed');
        setSyncStatus(navigator.onLine ? 'error' : 'offline');
      } finally {
        if (generation === authGenerationRef.current) {
          if (localAccountLoaded && workspaceOwnerRef.current === uid) {
            latestTasksRef.current = currentTasksRef.current;
            timerWorkspaceReadyRef.current = true;
          }
          cloudSyncReadyRef.current = Boolean(user) && localAccountLoaded;
          setIsCloudSyncReady(Boolean(user) && localAccountLoaded);
          setIsSyncing(false);
        }
      }
    });
    return () => { ++authGenerationRef.current; unsubscribe(); };
  }, [workspaceReloadToken]);

  useEffect(() => {
    if (!currentUser || !autoSyncEnabled || !isCloudSyncReady) return;
    const uid = currentUser.uid;
    return subscribeToUserCloudData(uid, (remote) => {
      if (auth.currentUser?.uid !== uid || workspaceOwnerRef.current !== uid) return;
      if ((remote.revision || 0) < (baseWorkspaceRef.current?.revision || 0)) return;
      if (savingRef.current !== null || tabMigrationBusyRef.current || localStorage.getItem(workspaceTabTransactionKey(uid)) !== null) {
        queuedRemoteRef.current = remote;
        return;
      }
      const merged = mergeWorkspace(baseWorkspaceRef.current, readWorkspace(), remote);
      baseWorkspaceRef.current = remote;
      const hasPendingLocalChanges = !sameWorkspace(merged, remote);
      if (!sameWorkspace(readWorkspace(), merged)) applyWorkspace(merged);
      else persistWorkspace();
      setCloudData(remote);
      setSyncError(null);
      if (hasPendingLocalChanges) setSyncStatus(navigator.onLine ? 'pending' : 'offline');
      else {
        updateLastSyncTime(remote.updatedAt);
        setSyncStatus('synced');
      }
    }, (error) => {
      console.warn('Cloud listener failed; local data retained:', error);
      setSyncError(error.message);
      setSyncStatus(navigator.onLine ? 'error' : 'offline');
    });
  }, [currentUser, autoSyncEnabled, isCloudSyncReady]);

  const stagingRef = React.useRef<Promise<void>>(Promise.resolve());
  const stageCurrentDesktopSync = async (
    ownerId = workspaceOwnerRef.current,
    workspace = readWorkspace(),
    base = baseWorkspaceRef.current,
  ) => {
    const desktop = window.karkasDesktop;
    if (!desktop || !ownerId) return null;
    if (base && sameWorkspace(base, workspace)) return null;
    const previous = stagingRef.current.catch(() => undefined);
    let resolveResult: (value: DesktopPendingSync | null) => void;
    let rejectResult: (error: unknown) => void;
    const resultPromise = new Promise<DesktopPendingSync | null>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    stagingRef.current = previous.then(async () => {
      const result = await desktop.workspace.stageSync({
        ownerId,
        workspace,
        base,
        ...(base ? { operations: diffWorkspaceOperations(base, workspace) } : {}),
      });
      if ('error' in result) throw new Error(result.error.message);
      resolveResult(result.value);
    }).catch((error) => {
      rejectResult(error);
    });
    return resultPromise;
  };

  const runAutoSave = React.useCallback(async (manual = false): Promise<boolean> => {
    const uid = currentUser?.uid;
    const generation = authGenerationRef.current;
    if (!uid || auth.currentUser?.uid !== uid || workspaceOwnerRef.current !== uid ||
        !cloudSyncReadyRef.current || (!manual && !autoSyncEnabledRef.current) || savingRef.current !== null
        || tabMigrationBusyRef.current || localStorage.getItem(workspaceTabTransactionKey(uid)) !== null) {
      if (manual) throw new Error('Synchronization is not ready or already in progress');
      return false;
    }
    try {
      await stageCurrentDesktopSync(uid, readWorkspace(), baseWorkspaceRef.current);
    } catch (error) {
      if (generation === authGenerationRef.current && auth.currentUser?.uid === uid) {
        setSyncError(error instanceof Error ? error.message : 'Could not queue local changes');
        setSyncStatus('error');
      }
      throw error;
    }
    if (generation !== authGenerationRef.current || auth.currentUser?.uid !== uid) return false;
    if (!navigator.onLine) {
      setSyncStatus('offline');
      if (manual) throw new Error('No network connection');
      return false;
    }
    let submitted = readWorkspace();
    let submittedBase = baseWorkspaceRef.current;
    let mutation: { clientId: string; sequence: number } | undefined;
    let mutationId: string | null = null;
    if (window.karkasDesktop) {
      const claimed = await window.karkasDesktop.workspace.claimSync(uid, manual);
      if (generation !== authGenerationRef.current || auth.currentUser?.uid !== uid) return false;
      if ('error' in claimed) {
        setSyncError(claimed.error.message);
        setSyncStatus('error');
        throw new Error(claimed.error.message);
      }
      if (!claimed.value) {
        if (!baseWorkspaceRef.current || !sameWorkspace(baseWorkspaceRef.current, submitted)) setSyncStatus('pending');
        return false;
      }
      submitted = claimed.value.workspace;
      submittedBase = claimed.value.base || null;
      mutation = { clientId: claimed.value.clientId, sequence: claimed.value.sequence };
      mutationId = claimed.value.mutationId;
    }
    persistWorkspace();
    if (!mutationId && baseWorkspaceRef.current && sameWorkspace(baseWorkspaceRef.current, submitted)) {
      setSyncError(null);
      setSyncStatus('synced');
      return false;
    }
    savingRef.current = generation;
    setIsSyncing(true);
    setSyncError(null);
    setSyncStatus('syncing');
    try {
      const saved = await saveUserCloudData(uid, submitted, submittedBase, mutation);
      if (generation !== authGenerationRef.current || auth.currentUser?.uid !== uid) return;
      // Keep edits made while the transaction was in flight.
      const queued = queuedRemoteRef.current;
      queuedRemoteRef.current = null;
      const latest = queued && (queued.revision || 0) > (saved.revision || 0) ? queued : saved;
      let remainingPending: DesktopPendingSync | null = null;
      if (window.karkasDesktop && mutationId) {
        const acknowledged = await window.karkasDesktop.workspace.acknowledgeSync({
          ownerId: uid, mutationId, base: latest, lastSyncTime: latest.updatedAt,
        });
        if (generation !== authGenerationRef.current || auth.currentUser?.uid !== uid || workspaceOwnerRef.current !== uid) return false;
        if ('error' in acknowledged) throw new Error(acknowledged.error.message);
        if (!acknowledged.value.acknowledged) throw new Error('Stale sync acknowledgement rejected');
        remainingPending = acknowledged.value.pending;
      }
      if (generation !== authGenerationRef.current || auth.currentUser?.uid !== uid || workspaceOwnerRef.current !== uid) return false;
      const merged = mergeWorkspace(submitted, readWorkspace(), latest);
      baseWorkspaceRef.current = latest;
      applyWorkspace(merged);
      setCloudData(latest);
      updateLastSyncTime(latest.updatedAt);
      setNextSyncRetryAt(remainingPending?.nextAttemptAt ?? null);
      setSyncStatus(remainingPending ? 'pending' : 'synced');
      return Boolean(remainingPending);
    } catch (error) {
      if (window.karkasDesktop && mutationId && generation === authGenerationRef.current) {
        const failed = await window.karkasDesktop.workspace.markSyncFailed({
          ownerId: uid,
          mutationId,
          message: error instanceof Error ? error.message : 'Cloud save failed',
        });
        if (generation === authGenerationRef.current && auth.currentUser?.uid === uid && failed.ok) setNextSyncRetryAt(failed.value?.nextAttemptAt ?? null);
      }
      if (generation === authGenerationRef.current && auth.currentUser?.uid === uid) {
        setSyncError(error instanceof Error ? error.message : 'Cloud save failed');
        setSyncStatus(navigator.onLine ? 'error' : 'offline');
      }
      throw error;
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

  const syncDrainPromiseRef = React.useRef<Promise<void> | null>(null);
  const performAutoSave = React.useCallback((manual = false): Promise<void> => {
    if (syncDrainPromiseRef.current) {
      const activeDrain = syncDrainPromiseRef.current;
      // A manual request means "everything is synced", even if it arrived while
      // a background drain was only sending the first coalesced mutation.
      return manual ? activeDrain.then(() => performAutoSave(true)) : Promise.resolve();
    }
    const drain = (async () => {
      let hasMore = false;
      do {
        hasMore = await runAutoSave(manual);
      } while (manual && hasMore);
    })();
    syncDrainPromiseRef.current = drain;
    void drain.finally(() => {
      if (syncDrainPromiseRef.current === drain) syncDrainPromiseRef.current = null;
    }).catch(() => undefined);
    return drain;
  }, [runAutoSave]);

  useEffect(() => {
    if (!currentUser || !isCloudSyncReady) return;
    if (baseWorkspaceRef.current && sameWorkspace(baseWorkspaceRef.current, readWorkspace())) return;
    setSyncStatus(navigator.onLine ? 'pending' : 'offline');
    const generation = authGenerationRef.current;
    const uid = currentUser.uid;
    stageCurrentDesktopSync(uid, readWorkspace(), baseWorkspaceRef.current).catch((error) => {
      if (generation !== authGenerationRef.current || auth.currentUser?.uid !== uid) return;
      setSyncError(error instanceof Error ? error.message : 'Could not queue local changes');
      setSyncStatus('error');
    });
  }, [currentUser, autoSyncEnabled, isCloudSyncReady, tasks, tabs, deletedTasks, growthState,
      soundEnabled, fireEnabled, lang, aiIconVariant, completionLedger]);

  useEffect(() => {
    if (!currentUser || !autoSyncEnabled || !isCloudSyncReady || !nextSyncRetryAt || !navigator.onLine) return;
    const delay = Math.max(0, nextSyncRetryAt - Date.now());
    const timer = window.setTimeout(() => {
      performAutoSave().catch((error) => console.error('Scheduled cloud retry failed:', error));
    }, delay);
    return () => window.clearTimeout(timer);
  }, [currentUser, autoSyncEnabled, isCloudSyncReady, nextSyncRetryAt, performAutoSave]);

  useEffect(() => {
    if (!currentUser || !autoSyncEnabled || !isCloudSyncReady) return;
    const timer = setTimeout(() => {
      performAutoSave().catch((error) => console.error('Cloud save failed; local changes retained:', error));
    }, 800);
    return () => clearTimeout(timer);
  }, [currentUser, autoSyncEnabled, isCloudSyncReady, tasks, tabs, deletedTasks, growthState,
      soundEnabled, fireEnabled, lang, aiIconVariant, completionLedger, cloudData, performAutoSave]);

  useEffect(() => {
    const flushLocal = () => {
      try { persistWorkspace(); } catch (error) { console.error('Local backup failed:', error); }
    };
    const retry = () => {
      if (!auth.currentUser || !autoSyncEnabledRef.current) return;
      setSyncStatus('pending');
      performAutoSave().catch((error) => console.error('Cloud retry failed:', error));
    };
    const offline = () => setSyncStatus(auth.currentUser && autoSyncEnabledRef.current ? 'offline' : 'idle');
    const hidden = () => { if (document.visibilityState === 'hidden') { flushLocal(); void retry(); } };
    window.addEventListener('pagehide', flushLocal);
    window.addEventListener('beforeunload', flushLocal);
    window.addEventListener('online', retry);
    window.addEventListener('offline', offline);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('pagehide', flushLocal);
      window.removeEventListener('beforeunload', flushLocal);
      window.removeEventListener('online', retry);
      window.removeEventListener('offline', offline);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [performAutoSave]);

  const handleToggleAutoSync = () => {
    const next = !autoSyncEnabled;
    autoSyncEnabledRef.current = next;
    setAutoSyncEnabled(next);
    localStorage.setItem(AUTO_SYNC_KEY, String(next));
    setSyncStatus(next ? (navigator.onLine ? 'pending' : 'offline') : 'idle');
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
      if (window.karkasDesktop) {
        const recovery = await window.karkasDesktop.workspace.createRecoveryPoint(uid);
        if (generation !== authGenerationRef.current || auth.currentUser?.uid !== uid || workspaceOwnerRef.current !== uid) return;
        if ('error' in recovery) throw new Error(recovery.error.message);
        const replaced = await window.karkasDesktop.workspace.replaceWithCloud({
          ownerId: uid,
          workspace: data,
          lastSyncTime: data.updatedAt,
        });
        if (generation !== authGenerationRef.current || auth.currentUser?.uid !== uid || workspaceOwnerRef.current !== uid) return;
        if ('error' in replaced) throw new Error(replaced.error.message);
      }
      baseWorkspaceRef.current = data;
      applyWorkspace(data);
      setCloudData(data);
      updateLastSyncTime(data.updatedAt);
      setNextSyncRetryAt(null);
      setSyncError(null);
      setSyncStatus('synced');
    } catch (error) {
      if (generation === authGenerationRef.current && auth.currentUser?.uid === uid) {
        setSyncError(error instanceof Error ? error.message : 'Cloud restore failed');
        setSyncStatus(navigator.onLine ? 'error' : 'offline');
      }
      throw error;
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

  const operationalTasks = useMemo(() => tasks.filter(task => !task.scheduledPending), [tasks]);
  const scheduledPlans = useMemo(() => tasks.filter(task => task.scheduledPending), [tasks]);
  const [insightNow, setInsightNow] = useState(() => Date.now());
  const [workPlanTaskId, setWorkPlanTaskId] = useState<string | null>(null);
  useEffect(() => {
    const interval = setInterval(() => setInsightNow(Date.now()), 30000);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => { setWorkPlanTaskId(null); setDayShiftNotice(null); setGrowthSetup(null); setPracticeFinish(null); }, [currentUser?.uid]);
  const workInsights = useMemo(() => buildWorkInsights(tasks, deletedTasks, {
    now: insightNow, lang, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Kyiv',
  }), [tasks, deletedTasks, insightNow, lang]);
  const strategyReady = profileOwner === strategyOwner && timerWorkspaceReadyRef.current && workspaceOwnerRef.current === strategyOwner;
  const growthGeneration = authGenerationRef.current;
  const growth = useGrowth(growthState, readWorkspace, next => {
    try { parseWorkspace(next); } catch { return false; }
    try { applyWorkspace(next, true); return true; }
    catch { setWorkspaceStorageError(true); return false; }
  }, () => growthGeneration === authGenerationRef.current && strategyReady && timerWorkspaceReadyRef.current && workspaceOwnerRef.current === strategyOwner && (auth.currentUser?.uid ?? null) === strategyOwner
    && canPersistWorkspaceRef.current && !tabMigrationBusyRef.current
    && localStorage.getItem(workspaceTabTransactionKey(strategyOwner)) === null
    && localStorage.getItem(strategyTransactionKey(strategyOwner)) === null, JSON.stringify([strategyOwner, growthGeneration]));
  useEffect(() => {
    if (!practiceFinish) return;
    const skill = growthState.skills.find(value => value.id === practiceFinish.skillId && value.deletedAt === undefined && value.archivedAt === undefined);
    const task = practiceFinish.taskId ? tasks.find(value => value.id === practiceFinish.taskId && value.skillId === practiceFinish.skillId) : undefined;
    if (practiceFinish.ownerId !== strategyOwner || practiceFinish.generation !== authGenerationRef.current || !skill || practiceFinish.taskId && !task) {
      practiceFinishRef.current = null;
      setPracticeFinish(null);
    }
  }, [practiceFinish, growthState.skills, tasks, strategyOwner]);
  const growthMigrationRunRef = React.useRef<string | null>(null);
  useEffect(() => {
    if (!strategyReady || workspaceStorageError || currentUser && !isCloudSyncReady) return;
    if (localStorage.getItem(strategyTransactionKey(strategyOwner)) !== null
      || localStorage.getItem(workspaceTabTransactionKey(strategyOwner)) !== null) return;
    const scope = JSON.stringify([strategyOwner, authGenerationRef.current, personalProfile.goals.map(goal => goal.id).sort()]);
    if (growthMigrationRunRef.current === scope) return;
    if (!personalProfile.goals.length || growth.migrateGoals(personalProfile.goals)
      || personalProfile.goals.every(goal => growthRef.current.skills.some(skill => skill.sourceGoalId === goal.id))) {
      growthMigrationRunRef.current = scope;
    }
  }, [strategyReady, strategyOwner, workspaceStorageError, isCloudSyncReady, personalProfile.goals]);
  const updatePersonalProfile = (next: PersonalStrategyProfile): boolean => {
    if (!strategyReady || workspaceOwnerRef.current !== strategyOwner) return false;
    if (localStorage.getItem(strategyTransactionKey(strategyOwner)) !== null
      || localStorage.getItem(workspaceTabTransactionKey(strategyOwner)) !== null) {
      setTimerNotice(lang === 'uk' ? 'Спершу потрібно завершити відновлення зміни плану. Нову пам’ять поки не збережено.' : 'Finish recovering the plan change first. New memory has not been saved.'); return false;
    }
    const discovery = normalizeStrategyDiscovery(next);
    const normalized: PersonalStrategyProfile = { ...next, discovery, phase: discovery.phase,
      onboardingStatus: discovery.phase === 'ready' ? 'complete' : next.onboardingStatus === 'new' ? 'new' : 'in_progress' };
    const stored = savePersonalStrategy(localStorage, strategyOwner, normalized);
    personalProfileRef.current = normalized; setPersonalProfile(normalized);
    if (!stored) setTimerNotice(lang === 'uk' ? 'Пам’ять діє в цьому сеансі, але її не вдалося зберегти на пристрої.' : 'Memory applies in this session but could not be saved on this device.');
    return stored;
  };
  const openStrategyChat = (text: string) => {
    setAiPromptSeed(text); setAiSeedAsDraft(true); setIsAIOpen(true);
  };
  /** recentUserTexts: the person's latest chat messages, so the opening question uses their "ти"/"ви". */
  const deepenPersonalDiscovery = (owner: string | null = strategyOwner, recentUserTexts: string[] = []): boolean => {
    if (!strategyReady || owner !== strategyOwner || workspaceOwnerRef.current !== owner) return false;
    const before = personalProfileRef.current;
    updatePersonalProfile(continueStrategyDiscovery(personalProfileRef.current, lang, Date.now(), recentUserTexts));
    if (before === personalProfileRef.current) return false;
    setAiPromptSeed(''); setAiSeedAsDraft(true); setIsAIOpen(true);
    return true;
  };
  const resetPersonalMemory = () => {
    if (!strategyReady) return;
    // Invalidate pending acknowledgements before removing the old journal/profile.
    ++strategyPersistenceGenerationRef.current;
    if (!clearStrategyTransaction(localStorage, strategyOwner)) {
      setTimerNotice(lang === 'uk' ? 'Не вдалося очистити журнал стратегії. Спробуйте ще раз.' : 'Could not clear the strategy journal. Please try again.'); return;
    }
    if (!clearPersonalStrategy(localStorage, strategyOwner)) {
      setTimerNotice(lang === 'uk' ? 'Не вдалося очистити пам’ять. Спробуйте ще раз.' : 'Could not clear memory. Please try again.'); return;
    }
    try {
      removeAccountStorage(localStorage, 'karkas_ai_chat_welcome', strategyOwner);
      removeAccountStorage(localStorage, 'karkas_ai_discovery_mode', strategyOwner);
      const prefix = `karkas_strategy_audit_v1:${encodeURIComponent(strategyOwner === null ? 'guest' : `account:${strategyOwner}`)}:`;
      Object.keys(localStorage).filter(key => key.startsWith(prefix)).forEach(key => localStorage.removeItem(key));
    } catch { /* The new empty profile still replaces the current in-memory view. */ }
    // A fresh paired snapshot also protects existing tasks if an earlier desktop save is still pending.
    const emptyProfile = createPersonalStrategyProfile();
    if (!commitStrategyState(latestTasksRef.current, emptyProfile)) updatePersonalProfile(emptyProfile);
    setIsAIOpen(false);
    setAiPromptSeed('');
    setAiSeedAsDraft(false);
  };
  const handleChatWelcome = (owner: string | null) => {
    if (!strategyReady || owner !== strategyOwner || personalProfileRef.current.onboardingStatus !== 'new') return;
    updatePersonalProfile({ ...personalProfileRef.current, onboardingStatus: 'in_progress' });
  };
  const commitStrategyState = (nextTasks: PSTask[], nextProfile: PersonalStrategyProfile): boolean => {
    if (!strategyReady || workspaceOwnerRef.current !== strategyOwner) return false;
    if (localStorage.getItem(workspaceTabTransactionKey(strategyOwner)) !== null) {
      setTimerNotice(lang === 'uk' ? 'Спершу завершіть відновлення перенесення вкладок.' : 'Finish recovering the tab migration first.');
      return false;
    }
    if (!stageStrategyTransaction(localStorage, strategyOwner, latestTasksRef.current, nextTasks, nextProfile)) {
      setTimerNotice(lang === 'uk' ? 'Не вдалося зберегти зміну плану. Завдання не змінено; перевірте незавершене відновлення.' : 'Could not persist the plan change. Tasks were not changed; check pending recovery.'); return false;
    }
    latestTasksRef.current = nextTasks; currentTasksRef.current = nextTasks; setTaskState(nextTasks);
    personalProfileRef.current = nextProfile; setPersonalProfile(nextProfile);
    try {
      const owner = strategyOwner;
      const generation = authGenerationRef.current;
      const persistenceGeneration = ++strategyPersistenceGenerationRef.current;
      const journal = localStorage.getItem(strategyTransactionKey(owner));
      const workspaceSaved = persistWorkspace();
      writeRecoverableJson(localStorage, STORAGE_KEY, JSON.stringify(nextTasks));
      if (savePersonalStrategy(localStorage, owner, nextProfile)) {
        const isCurrent = () => generation === authGenerationRef.current
          && persistenceGeneration === strategyPersistenceGenerationRef.current
          && owner === workspaceOwnerRef.current && owner === (auth.currentUser?.uid ?? null);
        void completeStrategyTransaction(localStorage, owner, journal, workspaceSaved, isCurrent).then(completed => {
          if (!completed && isCurrent()) setTimerNotice(lang === 'uk' ? 'Зміну збережено для відновлення; запис на пристрій ще не підтверджено.' : 'The change is journaled for recovery; device storage has not been confirmed.');
        });
      }
      else setTimerNotice(lang === 'uk' ? 'Зміну збережено для відновлення; запис пам’яті поки недоступний.' : 'The change is journaled for recovery; memory storage is currently unavailable.');
    } catch { setTimerNotice(lang === 'uk' ? 'Зміну збережено в журналі відновлення. Не вдалося завершити локальний запис.' : 'The change is in the recovery journal. Local persistence could not be completed.'); }
    return true;
  };
  const handleStrategyResponse = (response: AIResponse, userText: string, turnId: string, intent: AIIntent, owner: string | null, requestProfile?: PersonalStrategyProfile, discoveryConfirmationId?: string) => {
    if (!strategyReady || owner !== strategyOwner || workspaceOwnerRef.current !== owner) return;
    if (requestProfile && requestProfile !== personalProfileRef.current) return { notice: lang === 'uk' ? 'Профіль змінився під час відповіді. Пораду показано, автоматичних змін немає.' : 'Your profile changed while awaiting the reply. Advice is shown; no automatic changes applied.' };
    // Ordinary chat and task proposals do not advance or reset the personal interview.
    if (!response.strategy) {
      if (discoveryConfirmationId) {
        const confirmation = preparePersonalDiscoveryRequest(personalProfileRef.current, userText, discoveryConfirmationId);
        if (confirmation.confirmedSummaryId) updatePersonalProfile(confirmation.profile);
      }
      return;
    }
    const prepared = preparePersonalDiscoveryRequest(personalProfileRef.current, userText, discoveryConfirmationId);
    const strategyResponse = intent === 'analysis'
      ? { ...response.strategy, status: 'clarifying' as const, narrative: undefined, nextAction: undefined, focusTaskId: undefined, actions: [] }
      : response.strategy;
    const profile = applyStrategyResponse(prepared.profile, strategyResponse, userText, turnId, Date.now(), response.source);
    if (intent === 'analysis' || response.strategy.status !== 'ready' || response.strategy.question?.trim()
      || response.strategy.memoryPatch?.discovery?.question || !response.strategy.actions?.length) { updatePersonalProfile(profile); return; }
    const result = applyStrategyActions({ tasks: latestTasksRef.current, profile, actions: response.strategy.actions,
      ownerId: owner, currentOwnerId: workspaceOwnerRef.current, turnId, tabs: currentTabsRef.current });
    if (!result.applied.length) {
      updatePersonalProfile(result.profile);
      return result.rejected.length ? { notice: lang === 'uk' ? 'Автоматичні зміни не застосовано: ціль або пов’язані завдання потребують узгодження, чи дані вже змінилися.' : 'Automatic changes were not applied: agree the goal and related tasks, or review newer changes.' } : undefined;
    }
    if (!commitStrategyState(result.tasks, result.profile)) return { notice: lang === 'uk' ? 'План не змінено: не вдалося зберегти дію.' : 'Plan unchanged: the action could not be persisted.' };
    return { notice: `${lang === 'uk' ? 'План адаптовано' : 'Plan adapted'} (${result.applied.length}). ${result.applied.map(action => action.reason).join(' ')}`,
      actionId: result.applied[result.applied.length - 1].id };
  };
  const handleUndoStrategy = (actionId: string) => {
    if (!strategyReady) return false;
    const result = undoStrategyTurn({ tasks: latestTasksRef.current, profile: personalProfileRef.current, actionId,
      ownerId: strategyOwner, currentOwnerId: workspaceOwnerRef.current });
    if (!result.undone) { setTimerNotice(lang === 'uk' ? 'Завдання вже змінилося після цієї дії. Автоматичне скасування не перезапише ваші нові зміни.' : 'The task changed after this action. Undo will not overwrite your newer changes.'); return false; }
    const profile = preserveDiscoveryAfterTabMigration(personalProfileRef.current, result.profile);
    if (commitStrategyState(result.tasks, profile)) { setTimerNotice(lang === 'uk' ? 'Усі зміни цього плану скасовано.' : 'All changes from this plan were undone.'); return true; }
    return false;
  };
  useEffect(() => {
    if (!strategyReady) return;
    const recovered = recoverStrategyTransaction(localStorage, strategyOwner, latestTasksRef.current);
    if (recovered.status === 'recovered' && recovered.profile) {
      latestTasksRef.current = recovered.tasks; currentTasksRef.current = recovered.tasks; setTaskState(recovered.tasks);
      personalProfileRef.current = recovered.profile; setPersonalProfile(recovered.profile);
      try {
        const owner = strategyOwner;
        const generation = authGenerationRef.current;
        const persistenceGeneration = ++strategyPersistenceGenerationRef.current;
        const journal = localStorage.getItem(strategyTransactionKey(owner));
        const workspaceSaved = persistWorkspace(); writeRecoverableJson(localStorage, STORAGE_KEY, JSON.stringify(recovered.tasks));
        if (savePersonalStrategy(localStorage, owner, recovered.profile)) {
          const isCurrent = () => generation === authGenerationRef.current
            && persistenceGeneration === strategyPersistenceGenerationRef.current
            && owner === workspaceOwnerRef.current && owner === (auth.currentUser?.uid ?? null);
          void completeStrategyTransaction(localStorage, owner, journal, workspaceSaved, isCurrent);
        }
      } catch { /* Leave journal available for another recovery attempt. */ }
    } else if (recovered.status === 'conflict' || recovered.status === 'invalid') {
      if (recovered.status === 'conflict') markStrategyTransactionConflict(localStorage, strategyOwner, recovered.conflictTaskIds);
      setTimerNotice(lang === 'uk' ? 'Незавершена зміна стратегії конфліктує з новішими даними. Поточні завдання збережено; журнал можна скинути очищенням пам’яті.' : 'A pending strategy change conflicts with newer data. Current tasks are preserved; clear memory to discard its journal.');
    }
  }, [strategyReady, strategyOwner]);
  useEffect(() => {
    if (timerWorkspaceReadyRef.current && tabs.some(tab => isSystemView(tab.id))) applyWorkspace(readWorkspace());
  }, [tabs]);
  useEffect(() => {
    if (!isSystemView(selectedPhase) && !tabs.some(tab => tab.id === selectedPhase)) setSelectedPhase('ALL');
  }, [tabs, selectedPhase]);
  useStrategyReminders(strategyOwner, strategyReady, personalProfile, tasks, lang, setTimerNotice);
  useEffect(() => window.karkasDesktop?.system.onNotificationClick(target => {
    if (target.view !== 'STRATEGY' || target.ownerId !== workspaceOwnerRef.current || target.ownerId !== (auth.currentUser?.uid ?? null) || !timerWorkspaceReadyRef.current) return;
    setSelectedPhase('STRATEGY');
    const task = target.taskId && latestTasksRef.current.find(item => item.id === target.taskId);
    setAiPromptSeed(task ? (lang === 'uk' ? `Обговорімо запланований крок «${task.title}». Запитай, що зараз заважає почати.` : `Discuss the planned step “${task.title}”. Ask what makes starting difficult right now.`) : '');
    setAiSeedAsDraft(true); setIsAIOpen(true);
  }), [lang]);
  const workReminders = useWorkReminders(currentUser?.uid || null,
    timerWorkspaceReadyRef.current && workspaceOwnerRef.current === (currentUser?.uid || null),
    workInsights, tasks, lang, setTimerNotice);
  const workPlanTask = workPlanTaskId ? tasks.find(task => task.id === workPlanTaskId && !task.done && !task.scheduledPending) : undefined;
  const saveWorkPlan = (id: string, edit: WorkPlanEdit): boolean => {
    if (!timerWorkspaceReadyRef.current || workspaceOwnerRef.current !== (currentUser?.uid || null)) return false;
    const current = latestTasksRef.current.find(task => task.id === id && !task.done && !task.scheduledPending);
    if (!current) return false;
    const now = Date.now();
    const stepLabel = lang === 'uk' ? 'Крок' : 'Step';
    if (!applyTaskWorkPlan(current, edit, now, stepLabel)) return false;
    setTasks(previous => previous.map(task => {
      if (task.id !== id) return task;
      return applyTaskWorkPlan(task, edit, now, stepLabel) || task;
    }));
    return true;
  };
  const applySuggestedPriority = (id: string, from: 1 | 2 | 3, to: 1 | 2 | 3) => {
    if (!timerWorkspaceReadyRef.current || workspaceOwnerRef.current !== (currentUser?.uid || null)) return;
    const proposal = workInsights.prioritySuggestions.find(item => item.taskId === id && item.currentPriority === from && item.suggestedPriority === to);
    if (!proposal) return;
    setTasks(previous => previous.map(task => task.id === id && task.priority === from && !task.done && !task.scheduledPending && !task.startedAt && !task.timerRunning ? { ...task, priority: to } : task));
  };
  // Compute live stats per tab
  const stats: WorkflowStats = useMemo(() => {
    const total = operationalTasks.length;
    const completed = operationalTasks.filter((t) => t.done).length;
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

    const phaseCounts: Record<string, number> = {};
    tabs.forEach((tb) => {
      phaseCounts[tb.id] = 0;
    });

    operationalTasks.forEach((t) => {
      phaseCounts[t.phase] = (phaseCounts[t.phase] || 0) + 1;
    });

    return { total, completed, percent, phaseCounts };
  }, [operationalTasks, tabs]);

  const adaptiveProfile: AdaptiveProfile = useMemo(() => {
    const archivedRelevant = selectRelevantArchivedTasks(operationalTasks, deletedTasks);
    const tracked = [...operationalTasks, ...archivedRelevant];
    const completedTasks = tracked.filter((task) => task.done);
    const trackedTasks = tracked.length;
    const completionRate = trackedTasks > 0 ? Math.round((completedTasks.length / trackedTasks) * 100) : 0;
    const timedCompletedTasks = completedTasks.filter(task => Number.isFinite(task.timeSpentSeconds) && task.timeSpentSeconds! > 0);
    const averageCompletionMinutes = timedCompletedTasks.length > 0
      ? Math.round(timedCompletedTasks.reduce((total, task) => total + task.timeSpentSeconds!, 0) / timedCompletedTasks.length / 60)
      : null;
    const tasksWithSteps = tracked.filter((task) => task.steps > 0);
    const averageStepCount = tasksWithSteps.length > 0
      ? Math.round((tasksWithSteps.reduce((total, task) => total + task.steps, 0) / tasksWithSteps.length) * 10) / 10
      : 0;
    const completedByPhase = new Map<string, number>();
    completedTasks.forEach(task => completedByPhase.set(task.phase, (completedByPhase.get(task.phase) || 0) + 1));
    const preferredPhases = [...completedByPhase.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([phase]) => phase);
    const activeLoad = operationalTasks.filter((task) => !task.done).length;
    const urgentLoad = operationalTasks.filter((task) => !task.done && task.priority === 1).length;

    return {
      trackedTasks,
      completedTasks: completedTasks.length,
      completionRate,
      averageCompletionMinutes,
      averageStepCount,
      preferredPhases,
      activeLoad,
      urgentLoad,
    };
  }, [operationalTasks, deletedTasks]);

  const completedHistoryCount = useMemo(() => {
    return countCompletedTasks(readWorkspace());
  }, [tasks, deletedTasks, completionLedger]);
  const retainedCompletedTasks = useMemo(() => [
    ...operationalTasks.filter(task => task.done),
    ...selectRelevantArchivedTasks(operationalTasks, deletedTasks).filter(isCompletedArchivedTask),
  ].sort((a, b) => (b.completedAt ?? b.createdAt) - (a.completedAt ?? a.createdAt)).slice(0, 50), [operationalTasks, deletedTasks]);
  const visibleCompletedTasks = useMemo(() => retainedCompletedTasks.filter(task => {
    if (selectedPhase !== 'ALL' && task.phase !== selectedPhase) return false;
    const query = searchQuery.trim().toLocaleLowerCase();
    return !query || [task.title, task.note ?? '', ...(task.stepList?.map(step => step.title) ?? [])]
      .some(text => text.toLocaleLowerCase().includes(query));
  }), [retainedCompletedTasks, selectedPhase, searchQuery]);

  // Today's timed tasks only change place when the calendar day changes, not on every clock tick.
  const listTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Kyiv';
  const listDayKey = calendarDateKey(insightNow, listTimeZone);
  const dayDelay = useMemo(() => planDelay(tasks, insightNow, listTimeZone), [tasks, insightNow, listTimeZone]);
  const missedBlockCount = dayDelay.missedTasks?.length ?? 0;
  const [dayLogState, setDayLogState] = useState<{ owner: string | null | undefined; value: DayLog }>({ owner: undefined, value: { closed: {} } });
  const [dayClose, setDayClose] = useState<{ owner: string | null; date: string } | null>(null);
  useEffect(() => {
    setDayClose(null);
    let value: DayLog = { closed: {} };
    try { value = normalizeDayLog(JSON.parse(readAccountStorage(localStorage, 'karkas_day_log_v1', strategyOwner) || 'null')); }
    catch { /* A missing local log never blocks work. */ }
    setDayLogState({ owner: strategyOwner, value });
  }, [strategyOwner]);
  const dayRecapReady = workspaceReady && timerWorkspaceReadyRef.current && workspaceOwnerRef.current === strategyOwner
    && dayLogState.owner === strategyOwner && (auth.currentUser?.uid ?? null) === strategyOwner;
  const daySummaries = useMemo(() => {
    const now = Math.max(insightNow, Date.now());
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    return { today: summarizeDay(tasks, deletedTasks, localTaskDate(now), now, completionLedger),
      yesterday: summarizeDay(tasks, deletedTasks, localTaskDate(yesterday.getTime()), now, completionLedger) };
  }, [tasks, deletedTasks, completionLedger, listDayKey, insightNow]);
  const closeHour = useMemo(() => dayCloseHour(workInsights.workingPattern), [workInsights.workingPattern]);
  const offerDayClose = useMemo(() => dayRecapReady && shouldOfferDayClose({ now: insightNow, closeHour,
    summary: daySummaries.today, closedDates: dayLogState.value.closed }), [dayRecapReady, insightNow, closeHour, daySummaries.today, dayLogState.value]);
  const yesterdayRecap = useMemo(() => dayRecapReady && daySummaries.today.focusSeconds < 60 && daySummaries.today.startedCount === 0
    && !tasks.some(task => !task.done && !task.scheduledPending && task.timerRunning)
    && dayLogState.value.recapDismissed !== daySummaries.today.date ? morningRecap(daySummaries.yesterday) : null,
  [dayRecapReady, daySummaries, tasks, dayLogState.value.recapDismissed]);
  const dayCarryOver = useMemo(() => carryOverCandidates(tasks, daySummaries.today.date), [tasks, daySummaries.today.date]);
  const saveDayLog = (value: DayLog): boolean => {
    if (!dayRecapReady || workspaceOwnerRef.current !== strategyOwner || (auth.currentUser?.uid ?? null) !== strategyOwner) return false;
    const next = normalizeDayLog(value);
    try { writeAccountStorage(localStorage, 'karkas_day_log_v1', strategyOwner, JSON.stringify(next)); }
    catch { setActionNotice(lang === 'uk' ? 'Не вдалося зберегти підсумок на цьому пристрої. Спробуйте ще раз.' : 'Could not save the recap on this device. Try again.'); return false; }
    setDayLogState({ owner: strategyOwner, value: next });
    return true;
  };
  const isDayClosed = dayRecapReady && !!dayLogState.value.closed[daySummaries.today.date]
    && (dayLogState.value.resumed?.[daySummaries.today.date] ?? 0) <= dayLogState.value.closed[daySummaries.today.date].closedAt;
  const continueDayIfClosed = (): boolean => {
    if (!isDayClosed) return true;
    return saveDayLog({ ...dayLogState.value, resumed: { ...dayLogState.value.resumed, [daySummaries.today.date]: Date.now() } });
  };
  useEffect(() => {
    if (!dayRecapReady || !workReminders.enabled || !offerDayClose || dayClose || !window.karkasDesktop) return;
    const now = Date.now();
    if (localTaskDate(now) !== daySummaries.today.date || new Date(now).getHours() !== closeHour
      || latestTasksRef.current.some(task => !task.done && !task.scheduledPending && task.timerRunning)) return;
    if (!claimPlanningNotice(localStorage, strategyOwner, 'day-close:' + daySummaries.today.date, now)) return;
    const title = lang === 'uk' ? 'Karkas · Закрити день?' : 'Karkas · Close the day?';
    const body = lang === 'uk' ? 'Сьогодні: ' + formatDayFocus(daySummaries.today.focusSeconds, lang) + ', закрито ' + dayCompletedCount(daySummaries.today) + '. Підсумок займе пів хвилини.'
      : 'Today: ' + formatDayFocus(daySummaries.today.focusSeconds, lang) + ', completed ' + dayCompletedCount(daySummaries.today) + '. A recap takes half a minute.';
    void window.karkasDesktop.system.showNotification({ title, body }).catch(() => { /* The in-app action remains available. */ });
  }, [dayRecapReady, workReminders.enabled, offerDayClose, dayClose, daySummaries.today, closeHour, strategyOwner, lang]);

  // First-run onboarding: four real actions, offered only to a genuinely empty workspace of this account.
  const [onboarding, setOnboarding] = useState<{ owner: string | null | undefined; value: OnboardingState | null }>({ owner: undefined, value: null });
  useEffect(() => {
    let value: OnboardingState | null = null;
    try { value = readOnboarding(localStorage, strategyOwner); } catch { /* Onboarding is optional. */ }
    setOnboarding({ owner: strategyOwner, value });
  }, [strategyOwner]);
  const onboardingVisible = dayRecapReady && onboarding.owner === strategyOwner
    && shouldOfferOnboarding({ stored: onboarding.value, tasks, deletedTasks });
  const onboardingState: OnboardingState = onboarding.value
    ?? { status: 'active', steps: { task: false, session: false, notify: 'pending', ai: 'pending' }, startedAt: insightNow };
  const saveOnboarding = (value: OnboardingState) => {
    if (onboarding.owner !== strategyOwner) return;
    try { writeOnboarding(localStorage, strategyOwner, value); } catch { /* Keep the in-memory state. */ }
    setOnboarding({ owner: strategyOwner, value });
  };

  // Filtered & Sorted Tasks (Running timers, then today's timed tasks by start, then pinned, priority, creation)
  const filteredTasks = useMemo(() => {
    return operationalTasks
      .filter((t) => {
        if (activeFilter !== 'DONE' && t.done && !(activeFilter === 'ALL' && t.completedAt && localTaskDate(t.completedAt) === localTaskDate(insightNow))) return false;
        if (activeFilter === 'DONE' && !t.done) return false;
        if (!isSystemView(selectedPhase) && t.phase !== selectedPhase) return false;
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
        // Active timer running operationalTasks pinned on very top!
        if (a.timerRunning && !b.timerRunning) return -1;
        if (!a.timerRunning && b.timerRunning) return 1;
        // Today's planned blocks in start order, like a day schedule
        const timedToday = compareTodayTimedFirst(a, b, insightNow, listTimeZone);
        if (timedToday !== 0) return timedToday;
        // Pinned first
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        // Incomplete first
        if (!a.done && b.done) return -1;
        if (a.done && !b.done) return 1;
        // Missed deadlines surface before fresh work of the same urgency
        const overdueA = !a.done && !!a.deadlineDate && (taskDateEnd(a.deadlineDate) ?? Infinity) < insightNow;
        const overdueB = !b.done && !!b.deadlineDate && (taskDateEnd(b.deadlineDate) ?? Infinity) < insightNow;
        if (overdueA !== overdueB) return overdueA ? -1 : 1;
        // Priority (1 is high, 2 standard, 3 low)
        if (a.priority !== b.priority) return a.priority - b.priority;
        if ((a.deadlineDate || '') !== (b.deadlineDate || '')) return !a.deadlineDate ? 1 : !b.deadlineDate ? -1 : a.deadlineDate.localeCompare(b.deadlineDate);
        return b.createdAt - a.createdAt;
      });
  }, [operationalTasks, activeFilter, selectedPhase, searchQuery, listDayKey, listTimeZone]);

  // Strategy view task links: show the task in the full list, then scroll to it and flash its frame.
  const [revealTaskId, setRevealTaskId] = useState<string | null>(null);
  const handleRevealTask = (id: string) => {
    const task = latestTasksRef.current.find(item => item.id === id && !item.scheduledPending);
    if (!task) return;
    setSelectedPhase('ALL');
    setActiveFilter('ALL');
    setSearchQuery('');
    setRevealTaskId(id);
  };
  useEffect(() => {
    if (!revealTaskId || selectedPhase !== 'ALL') return;
    const frame = requestAnimationFrame(() => {
      const wrapper = document.getElementById(`task-wrapper-${revealTaskId}`);
      setRevealTaskId(null);
      if (!wrapper) return;
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      wrapper.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
      wrapper.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
      if (!reduce) wrapper.animate?.([{ boxShadow: '0 0 0 2px rgba(255,255,255,0.85)' }, { boxShadow: '0 0 0 2px rgba(255,255,255,0)' }], { duration: 1600, easing: 'ease-out' });
    });
    return () => cancelAnimationFrame(frame);
  }, [revealTaskId, selectedPhase, filteredTasks]);

  const listCounts = useMemo(() => {
    const visible = operationalTasks.filter(task => activeFilter === 'DONE' ? task.done : !task.done);
    const phaseCounts: Record<string, number> = {};
    visible.forEach(task => { phaseCounts[task.phase] = (phaseCounts[task.phase] || 0) + 1; });
    return { total: visible.length, phaseCounts };
  }, [operationalTasks, activeFilter]);

  // Edit Task Title and Note
  const handleEditTask = (id: string, updatedTitle: string, updatedNote: string, expected: { title: string; note: string; plannedDate?: string; deadlineDate?: string }, dates?: { plannedDate?: string; deadlineDate?: string }): boolean => {
    if (!timerWorkspaceReadyRef.current || workspaceOwnerRef.current !== strategyOwner || (auth.currentUser?.uid ?? null) !== strategyOwner) return false;
    const current = latestTasksRef.current.find(task => task.id === id);
    const titleChanged = updatedTitle.trim() !== expected.title;
    const noteChanged = updatedNote.trim() !== expected.note;
    if (dates && (dates.plannedDate !== undefined && !isTaskDate(dates.plannedDate) || dates.deadlineDate !== undefined && !isTaskDate(dates.deadlineDate))) return false;
    const plannedChanged = dates !== undefined && dates.plannedDate !== expected.plannedDate;
    const deadlineChanged = dates !== undefined && dates.deadlineDate !== expected.deadlineDate;
    const datesMatch = (task: PSTask) => (!plannedChanged || task.plannedDate === expected.plannedDate) && (!deadlineChanged || task.deadlineDate === expected.deadlineDate);
    if (!current || !updatedTitle.trim() || titleChanged && current.title !== expected.title || noteChanged && (current.note || '') !== expected.note) return false;
    if (!datesMatch(current)) return false;
    const patch = { ...(titleChanged ? { title: updatedTitle.trim() } : {}), ...(noteChanged ? { note: updatedNote.trim() || undefined } : {}), ...(plannedChanged ? { plannedDate: dates?.plannedDate } : {}), ...(deadlineChanged ? { deadlineDate: dates?.deadlineDate } : {}) };
    const datesInOrder = (task: PSTask) => { const candidate = { ...task, ...patch }; return !candidate.plannedDate || !candidate.deadlineDate || candidate.plannedDate <= candidate.deadlineDate; };
    if (!datesInOrder(current)) return false;
    return commitTaskChange(current, { ...current, ...patch }, lang === 'uk' ? 'Зміни збережено' : 'Changes saved');
  };

  const handlePatchTask = (id: string, patch: TaskEditPatch, expected: TaskEditPatch): PSTask | false => {
    const current = latestTasksRef.current.find(task => task.id === id);
    if (!current || (Object.keys(patch) as (keyof TaskEditPatch)[]).some(key => canonical(current[key]) !== canonical(expected[key]))) return false;
    if (patch.title !== undefined && !patch.title.trim() || patch.phase !== undefined && !tabs.some(tab => tab.id === patch.phase)) return false;
    const candidate = { ...current, ...patch };
    if (candidate.plannedDate && !isTaskDate(candidate.plannedDate) || candidate.deadlineDate && !isTaskDate(candidate.deadlineDate)
      || candidate.plannedDate && candidate.deadlineDate && candidate.plannedDate > candidate.deadlineDate) return false;
    let next = patch.stepList !== undefined ? setTaskSteps(candidate, patch.stepList, Date.now()) : candidate;
    if (patch.timerMode !== undefined || Object.hasOwn(patch, 'countdownDurationSeconds')) {
      next = next.timerMode === 'countdown' ? configureTaskCountdown(next, next.countdownDurationSeconds ?? 1500, Date.now())
        : { ...pauseTaskTimer(next, Date.now()), countdownDurationSeconds: undefined, countdownRemainingSeconds: undefined, countdownExpiredAt: undefined };
    }
    if (Object.hasOwn(patch, 'schedule')) {
      if (current.done && patch.schedule !== undefined) return false;
      const schedule = patch.schedule === undefined ? undefined : normalizeTaskSchedule(patch.schedule);
      if (schedule === null) return false;
      const pending = !!schedule && (current.scheduledPending || !current.startedAt && !current.done);
      next = { ...next, schedule, scheduledPending: pending || undefined,
        scheduleNextStartAt: pending ? schedule?.startAt : undefined,
        scheduledFor: schedule && !pending ? Date.parse(schedule.startAt) : undefined,
        ...(schedule ? {} : { schedulePlanId: undefined, scheduledDurationSeconds: undefined }) };
    }
    return commitTaskChange(current, next, lang === 'uk' ? 'Зміни збережено' : 'Changes saved') ? latestTasksRef.current.find(task => task.id === id) ?? false : false;
  };

  // Tab management handlers
  const handleAddTab = (name: string, customColor?: string) => {
    if (!strategyReady || tabMigrationBusyRef.current || localStorage.getItem(workspaceTabTransactionKey(strategyOwner)) !== null) return false;
    const trimmed = name.trim();
    if (!trimmed) return false;
    const baseId = trimmed.toLowerCase().replace(/[^a-zа-яіїєґ0-9]+/gi, '_');
    const id = baseId.length > 0 ? `${baseId}_${Date.now().toString(36).slice(-3)}` : `tab_${Date.now()}`;
    const color = customColor || getRandomTabColor(tabs);
    const newTab: TaskTab = { id, name: trimmed, color };
    const workspace = readWorkspace();
    try { applyWorkspace({ ...workspace, tabs: [...workspace.tabs, newTab] }, true); }
    catch { setWorkspaceStorageError(true); return false; }
    setSelectedPhase(id);
    return true;
  };
  const handleRenameTab = (id: string, name: string): boolean => {
    const title = name.trim();
    if (!title || !strategyReady || tabMigrationBusyRef.current || workspaceOwnerRef.current !== strategyOwner
      || tabs.some(tab => tab.id !== id && tab.name.toLocaleLowerCase() === title.toLocaleLowerCase())) return false;
    const workspace = readWorkspace();
    if (!workspace.tabs.some(tab => tab.id === id)) return false;
    try { applyWorkspace({ ...workspace, tabs: workspace.tabs.map(tab => tab.id === id ? { ...tab, name: title } : tab) }, true); return true; }
    catch { setWorkspaceStorageError(true); return false; }
  };

  const handleDeleteTab = (tabId: string) => {
    if (tabs.length <= 1) return;
    const tabToDel = tabs.find((tb) => tb.id === tabId);
    if (tabToDel) {
      sound.tick(400);
      setTabToDeleteConfirm(tabToDel);
    }
  };

  const handleConfirmDeleteTab = async () => {
    if (!tabToDeleteConfirm || tabs.length <= 1) return;
    const tabId = tabToDeleteConfirm.id;
    const remaining = tabs.filter((tb) => tb.id !== tabId);
    if (!await applyTabSet(remaining)) return;

    sound.tick(300);
    setTabToDeleteConfirm(null);
  };

  const handleUpdateTabColor = (tabId: string, color: string) => {
    if (!strategyReady || tabMigrationBusyRef.current || localStorage.getItem(workspaceTabTransactionKey(strategyOwner)) !== null) return;
    setTabs((prev) => prev.map((tab) => (tab.id === tabId ? { ...tab, color } : tab)));
  };

  /** `moveTo` maps old tab ids to tabs of the new set; unmapped tasks go to its first tab. */
  const handleSetPresetTabs = (preset: TaskTab[], moveTo: Record<string, string> = {}) => {
    void applyTabSet(preset, moveTo);
  };

  const applyTabSet = async (nextTabs: TaskTab[], moveTo: Record<string, string> = {}, agentCommit?: {
    workspace: AgentWorkspace; beforeNotes: NotepadNote[]; isCurrent: () => boolean; profile?: PersonalStrategyProfile; expectedRestores?: Record<string, NotepadNote>;
  }): Promise<boolean> => {
    if (!strategyReady || tabMigrationBusyRef.current || savingRef.current !== null
      || localStorage.getItem(strategyTransactionKey(strategyOwner)) !== null
      || localStorage.getItem(workspaceTabTransactionKey(strategyOwner)) !== null) return false;
    const owner = strategyOwner;
    const generation = authGenerationRef.current;
    const ownsWorkspace = () => generation === authGenerationRef.current && owner === workspaceOwnerRef.current && (auth.currentUser?.uid ?? null) === owner;
    const isCurrent = () => ownsWorkspace() && (!agentCommit || agentCommit.isCurrent());
    if (!isCurrent()) return false;
    const beforeWorkspace = readWorkspace();
    const beforeProfile = personalProfileRef.current;
    const remapped = remapWorkspaceTabs(beforeWorkspace, beforeProfile, nextTabs, moveTo);
    if (!remapped) return false;
    if (agentCommit) {
      remapped.workspace = { ...remapped.workspace, tasks: agentCommit.workspace.tasks, deletedTasks: agentCommit.workspace.deletedTasks };
      if (agentCommit.profile) remapped.profile = agentCommit.profile;
    }
    remapped.profile = preserveDiscoveryAfterTabMigration(beforeProfile, remapped.profile);
    const discovery = normalizeStrategyDiscovery(remapped.profile);
    remapped.profile = { ...remapped.profile, discovery, phase: discovery.phase,
      onboardingStatus: discovery.phase === 'ready' ? 'complete' : remapped.profile.onboardingStatus === 'new' ? 'new' : 'in_progress' };
    const now = Date.now();
    if (!agentCommit) remapped.workspace.tasks = annotateTaskChanges(currentTasksRef.current, remapped.workspace.tasks, now);
    remapped.workspace = normalizeCompletedTaskHistory(normalizeWorkspaceForStorage(remapped.workspace), now);
    tabMigrationBusyRef.current = true;
    timerWorkspaceReadyRef.current = false;
    setWorkspaceReady(false);
    let staged = false;
    let committed = false;
    try {
      // Establish a durable baseline, including earlier in-memory profile edits.
      if (!savePersonalStrategy(localStorage, owner, beforeProfile) || !await persistWorkspace()) throw new Error('Migration baseline could not be saved');
      if (!isCurrent() || !sameWorkspace(beforeWorkspace, readWorkspace()) || personalProfileRef.current !== beforeProfile) return false;
      if (agentCommit) {
        const liveNotes = getCurrentNotes();
        if (!liveNotes || canonical(liveNotes) !== canonical(agentCommit.beforeNotes)) return false;
      }
      // Retain the exact notes operation with the workspace, so interrupted paired edits can resume together.
      const notesOperation = agentCommit
        ? prepareNotepadReplacement(localStorage, owner, agentCommit.beforeNotes, agentCommit.workspace.notes, agentCommit.expectedRestores) ?? undefined
        : undefined;
      if (!stageWorkspaceTabTransaction(localStorage, owner, beforeWorkspace, remapped.workspace, beforeProfile, remapped.profile, notesOperation)) {
        setActionNotice(lang === 'uk' ? 'Не вдалося зберегти перенесення вкладок або попереднє перенесення ще не завершено. Вкладки не змінено.' : 'Could not save the tab migration or an earlier migration is still pending. Tabs were not changed.');
        return false;
      }
      staged = true;
      const journal = localStorage.getItem(workspaceTabTransactionKey(owner));
      if (!savePersonalStrategy(localStorage, owner, remapped.profile)) throw new Error('Goal links could not be saved');
      if (notesOperation && !applyNotepadBatch(localStorage, owner, notesOperation)) {
        // Once the note operation exists, retain the paired journal even if a later read failed.
        if (localStorage.getItem(notesOperationPrefix(owner) + notesOperation.id) === null
          && savePersonalStrategy(localStorage, owner, beforeProfile) && localStorage.getItem(workspaceTabTransactionKey(owner)) === journal) {
          localStorage.removeItem(workspaceTabTransactionKey(owner));
          staged = false;
        }
        throw new Error('Notes could not be saved');
      }
      if (notesOperation) refreshNotes(owner);
      personalProfileRef.current = remapped.profile;
      setPersonalProfile(remapped.profile);
      applyWorkspace(remapped.workspace);
      committed = true;
      if (!isSystemView(selectedPhase) && !nextTabs.some(tab => tab.id === selectedPhase)) setSelectedPhase('ALL');
      const completed = await completeWorkspaceTabTransaction(localStorage, owner, journal, persistWorkspace(), ownsWorkspace);
      if (isCurrent()) setWorkspaceStorageError(!completed);
      if (!ownsWorkspace()) return false;
      // A retained persistence journal must not hide an already committed live agent turn.
      return agentCommit ? true : completed;
    } catch {
      if (isCurrent()) {
        setWorkspaceStorageError(true);
        setActionNotice(staged
          ? (lang === 'uk' ? 'Перенесення вкладок збережено для відновлення. Звільніть місце й натисніть «Повторити збереження».' : 'The tab migration was retained for recovery. Free storage and choose Retry saving.')
          : (lang === 'uk' ? 'Не вдалося зберегти початкові дані. Вкладки не змінено; звільніть місце й повторіть.' : 'Could not save the original data. Tabs were not changed; free storage and retry.'));
      }
      return !!agentCommit && committed && ownsWorkspace();
    } finally {
      tabMigrationBusyRef.current = false;
      if (ownsWorkspace() && localStorage.getItem(workspaceTabTransactionKey(owner)) === null) {
        timerWorkspaceReadyRef.current = true;
        setWorkspaceReady(true);
        if (staged || queuedRemoteRef.current !== null) setWorkspaceReloadToken(value => value + 1);
      }
    }
  };

  const agentAppliedTurnsRef = React.useRef(new Map<string, Promise<AgentApplyResult>>());
  const agentUndoTurnsRef = React.useRef(new Map<string, {
    ownerId: string | null; undo: AgentUndoSnapshot; used: boolean; noteTombstones: Record<string, NotepadNote>;
    goalLinks: { id: string; before: string[]; after: string[] }[];
  }>());
  const agentOwnerIsCurrent = (owner: string | null) => workspaceOwnerRef.current === owner
    && (auth.currentUser?.uid ?? null) === owner && notesOwner === owner && canPersistWorkspaceRef.current;
  const handleGetAgentWorkspace = (): AgentWorkspace | null => {
    const owner = workspaceOwnerRef.current;
    if (!timerWorkspaceReadyRef.current || tabMigrationBusyRef.current || !agentOwnerIsCurrent(owner)
      || localStorage.getItem(strategyTransactionKey(owner)) !== null
      || localStorage.getItem(workspaceTabTransactionKey(owner)) !== null) return null;
    const liveNotes = getCurrentNotes();
    return liveNotes ? { tasks: latestTasksRef.current, deletedTasks: currentDeletedTasksRef.current,
      tabs: currentTabsRef.current, notes: liveNotes } : null;
  };
  const commitAgentWorkspace = async (before: AgentWorkspace, after: AgentWorkspace, isCurrent: () => boolean,
    profile?: PersonalStrategyProfile, expectedRestores?: Record<string, NotepadNote>): Promise<boolean> => {
    if (!isCurrent()) return false;
    // Deleting a category also migrates historical records and strategy goal links.
    if (before.tabs.some(tab => !after.tabs.some(next => next.id === tab.id)) || profile || canonical(before.notes) !== canonical(after.notes)) {
      return applyTabSet(after.tabs, {}, { workspace: after, beforeNotes: before.notes, isCurrent, profile, expectedRestores });
    }
    const workspace = migrateSystemCategories(parseWorkspace({ ...readWorkspace(), tasks: after.tasks,
      deletedTasks: after.deletedTasks, tabs: after.tabs }));
    if (!isCurrent() || !replaceAgentNotes(before.notes, after.notes, expectedRestores)) return false;
    // applyWorkspace synchronously commits every live ref, setter and existing persistence slot.
    try {
      applyWorkspace(workspace, true);
      return true;
    } catch {
      setWorkspaceStorageError(true);
      return canonical({ tasks: latestTasksRef.current, deletedTasks: currentDeletedTasksRef.current, tabs: currentTabsRef.current })
        === canonical({ tasks: workspace.tasks, deletedTasks: workspace.deletedTasks, tabs: workspace.tabs });
    }
  };
  const applyAgentView = (view: AgentView) => {
    if (view.type === 'reveal_task') { handleRevealTask(view.taskId); return; }
    if (view.view === 'history') { setIsSettingsOpen(true); setArchiveOpen(true); return; }
    const phases = { dashboard: 'DASHBOARD', strategy: 'STRATEGY', notes: 'NOTES', history: 'HISTORY', tasks: 'ALL' };
    setSelectedPhase(phases[view.view]);
  };
  const handleApplyAgentActions = (input: AgentApplyOptions & { actions: AppliedAgentAction[] }): Promise<AgentApplyResult> => {
    const key = JSON.stringify([input.ownerId, input.messageId]);
    const previous = agentAppliedTurnsRef.current.get(key);
    if (previous) return previous;
    const pending = (async (): Promise<AgentApplyResult> => {
      const failed: AgentApplyResult['failed'] = [];
      const applied: AgentApplyResult['applied'] = [];
      const isCurrent = () => agentOwnerIsCurrent(input.ownerId) && (!input.isCurrent || input.isCurrent());
      const before = isCurrent() ? handleGetAgentWorkspace() : null;
      const unavailable = () => ({ applied: [], failed: input.actions.map(({ action }) => ({ action,
        error: lang === 'uk' ? 'Робочий простір змінився або ще не готовий. Дію не застосовано.' : 'The workspace changed or is not ready. The action was not applied.' })) });
      if (!before) return unavailable();
      const beforeProfile = personalProfileRef.current;
      let workspace = before;
      const views: AgentView[] = [];
      for (const entry of input.actions) {
        let createdIndex = 0;
        const replay = applyAgentAction(workspace, entry.action, { now: Date.parse(input.clientClock.now),
          timeZone: input.clientClock.timeZone, confirmed: input.confirmed === true,
          newId: () => entry.createdIds?.[createdIndex++] ?? crypto.randomUUID() });
        if (!replay.result.ok) { failed.push({ action: entry.action, error: replay.result.error }); continue; }
        workspace = replay.workspace;
        applied.push(replay.result.summary);
        if (entry.action.type === 'open_view' || entry.action.type === 'reveal_task') views.push(entry.action);
      }
      const changed = canonical(before) !== canonical(workspace);
      if (changed && !await commitAgentWorkspace(before, workspace, isCurrent)) return unavailable();
      if (!isCurrent() && !changed) return unavailable();
      let undoToken: string | undefined;
      if (changed) {
        undoToken = crypto.randomUUID();
        const afterProfile = personalProfileRef.current;
        const goalLinks = beforeProfile.goals.flatMap(goal => {
          const afterGoal = afterProfile.goals.find(item => item.id === goal.id);
          return afterGoal && canonical(goal.categoryIds) !== canonical(afterGoal.categoryIds)
            ? [{ id: goal.id, before: goal.categoryIds, after: afterGoal.categoryIds }] : [];
        });
        agentUndoTurnsRef.current.set(undoToken, { ownerId: input.ownerId,
          undo: captureAgentUndo(before, workspace), used: false, goalLinks,
          noteTombstones: Object.fromEntries((getCurrentDeletedNotes() ?? []).filter(note => before.notes.some(value => value.id === note.id) && !workspace.notes.some(value => value.id === note.id)).map(note => [note.id, note])) });
      }
      if (agentOwnerIsCurrent(input.ownerId)) {
        for (const view of views) applyAgentView(view);
        if (input.view) applyAgentView(input.view);
      }
      return { applied, failed, undoToken };
    })();
    agentAppliedTurnsRef.current.set(key, pending);
    return pending;
  };
  const handleUndoAgentActions = async (token: string): Promise<{ undone: boolean; conflicts: string[] }> => {
    const turn = agentUndoTurnsRef.current.get(token);
    if (!turn || turn.used || !agentOwnerIsCurrent(turn.ownerId)) return { undone: false, conflicts: ['workspace'] };
    turn.used = true;
    const before = handleGetAgentWorkspace();
    if (!before) { turn.used = false; return { undone: false, conflicts: ['workspace'] }; }
    const result = undoAgentTurn(before, turn.undo);
    if (!result.undone) { turn.used = false; return { undone: false, conflicts: result.conflicts.map(conflict => conflict.collection + ':' + conflict.id) }; }
    let profile: PersonalStrategyProfile | undefined;
    if (turn.goalLinks.length) {
      const currentProfile = personalProfileRef.current;
      const conflicts = turn.goalLinks.filter(link => canonical(currentProfile.goals.find(goal => goal.id === link.id)?.categoryIds)
        !== canonical(link.after)).map(link => 'strategy:' + link.id);
      if (conflicts.length) { turn.used = false; return { undone: false, conflicts }; }
      profile = { ...currentProfile, goals: currentProfile.goals.map(goal => {
        const link = turn.goalLinks.find(item => item.id === goal.id);
        return link ? { ...goal, categoryIds: link.before } : goal;
      }) };
    }
    const undone = await commitAgentWorkspace(before, result.workspace, () => agentOwnerIsCurrent(turn.ownerId), profile, turn.noteTombstones);
    if (!undone) turn.used = false;
    return { undone, conflicts: undone ? [] : ['workspace'] };
  };

  const handleScheduleActions = async (actions: AgentAction[]): Promise<void> => {
    if (dayShiftBusyRef.current) throw new Error(lang === 'uk' ? 'План уже оновлюється. Спробуйте ще раз.' : 'The plan is being updated. Please try again.');
    const now = Date.now(), ownerId = workspaceOwnerRef.current;
    dayShiftBusyRef.current = true;
    let noticeWritten = false;
    try {
      const result = await handleApplyAgentActions({ messageId: 'schedule:' + crypto.randomUUID(), ownerId,
        clientClock: { now: new Date(now).toISOString(), timeZone: listTimeZone },
        actions: actions.map(action => ({ action, summary: { uk: '', en: '' }, changedTaskIds: [] })) });
      if (!agentOwnerIsCurrent(ownerId)) throw new Error(lang === 'uk' ? 'Робочий простір змінився. Відкрийте завдання ще раз.' : 'The workspace changed. Open the task again.');
      setDayShiftNotice({ ownerId, undoToken: result.undoToken,
        text: [...result.applied.map(summary => summary[lang]), ...result.failed.map(item => item.error)].join('\n') });
      noticeWritten = true;
      setInsightNow(Date.now());
      if (result.failed.length) throw new Error(result.failed.map(item => item.error).join('\n'));
    } catch (error) {
      if (!noticeWritten && agentOwnerIsCurrent(ownerId)) setDayShiftNotice({ ownerId,
        text: error instanceof Error ? error.message : lang === 'uk' ? 'Не вдалося оновити план. Спробуйте ще раз.' : 'Could not update the plan. Please try again.' });
      throw error;
    } finally { dayShiftBusyRef.current = false; }
  };
  const handleShiftDay = async () => {
    const delay = planDelay(latestTasksRef.current, Date.now(), listTimeZone);
    if (!delay.minutes || !delay.tasks.length || dayShiftBusyRef.current) return;
    try { await handleScheduleActions([{ type: 'shift_day', minutes: delay.minutes }]); } catch { /* The schedule notice contains the failure. */ }
  };
  const handleReplanDay = async () => {
    if (dayShiftBusyRef.current) return;
    try { await handleScheduleActions([{ type: 'replan_day' }]); } catch { /* The schedule notice contains the failure. */ }
  };
  const handleUndoDayShift = async () => {
    const notice = dayShiftNotice;
    if (!notice?.undoToken || dayShiftBusyRef.current) return;
    dayShiftBusyRef.current = true;
    try {
      const result = await handleUndoAgentActions(notice.undoToken);
      if (!agentOwnerIsCurrent(notice.ownerId)) return;
      setDayShiftNotice(result.undone ? null : { ownerId: notice.ownerId,
        text: lang === 'uk' ? 'План уже змінився. Не вдалося скасувати зміну; перегляньте блоки.' : 'The plan has changed. Could not undo the change; review the blocks.' });
    } catch {
      if (agentOwnerIsCurrent(notice.ownerId)) setDayShiftNotice({ ownerId: notice.ownerId, text: lang === 'uk' ? 'Не вдалося скасувати зміну. Перегляньте план.' : 'Could not undo the change. Review the plan.' });
    } finally { dayShiftBusyRef.current = false; }
  };

  // Task Actions
  const handleToggleDone = (id: string) => {
    const now = Date.now();
    const current = latestTasksRef.current.find(task => task.id === id);
    if (!current) return;
    const shouldComplete = !current.done;
    const next = shouldComplete ? completeTask(finishLimitedStart(current, now), now) : reopenTask(current, now);
    if (!commitTaskChange(current, next, lang === 'uk' ? (shouldComplete ? 'Завдання виконане' : 'Повернуто в роботу') : (shouldComplete ? 'Task completed' : 'Task reopened'))) return;
    setCompletedNoticeId(shouldComplete ? id : null);
    if (shouldComplete && current.measurementMode) openPracticeFinish(next, false);
    if (!shouldComplete) {
      setSelectedPhase('ALL');
      setActiveFilter('ALL');
      setSearchQuery('');
    }
  };

  const handleReopenCompletedTask = (id: string): boolean => {
    const task = latestTasksRef.current.find(task => task.id === id)
      ?? currentDeletedTasksRef.current.find(task => task.id === id && isCompletedArchivedTask(task));
    if (!task || !timerWorkspaceReadyRef.current || workspaceOwnerRef.current !== strategyOwner || (auth.currentUser?.uid ?? null) !== strategyOwner) return false;
    const receipt = currentCompletionLedgerRef.current?.[id];
    const now = Math.max(Date.now(), (task.updatedAt ?? 0) + 1, (receipt?.updatedAt ?? 0) + 1, (receipt?.retiredAt ?? 0) + 1);
    const { deletedAt, deletionReason, ...restored } = task as DeletedTask;
    const reopened = { ...reopenTask(restored, now), updatedAt: now,
      phase: tabs.some(tab => tab.id === restored.phase) ? restored.phase : tabs[0]?.id || 'focus' };
    const workspace = readWorkspace();
    try { applyWorkspace({ ...workspace, tasks: [...workspace.tasks.filter(task => task.id !== id), reopened], deletedTasks: workspace.deletedTasks.filter(task => task.id !== id) }, true); }
    catch { setWorkspaceStorageError(true); return false; }
    setCompletedNoticeId(null);
    setSelectedPhase('ALL');
    setActiveFilter('ALL');
    setSearchQuery('');
    return true;
  };

  const handlePlanTomorrow = (id: string) => {
    const task = latestTasksRef.current.find(item => item.id === id);
    if (!task || task.done) return;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const date = localTaskDate(tomorrow.getTime());
    if (task.deadlineDate && task.deadlineDate < date) return;
    handleEditTask(id, task.title, task.note || '', {
      title: task.title, note: task.note || '', plannedDate: task.plannedDate, deadlineDate: task.deadlineDate,
    }, { plannedDate: date, deadlineDate: task.deadlineDate });
  };

  const handleCloseDay = ({ moveTaskIds, note }: { moveTaskIds: string[]; note: string }) => {
    const now = Date.now(), date = localTaskDate(now);
    if (!dayClose || dayClose.owner !== strategyOwner || dayClose.date !== date || !dayRecapReady) return false;
    const summary = summarizeDay(latestTasksRef.current, deletedTasks, date, now, currentCompletionLedgerRef.current);
    if (!saveDayLog({ ...dayLogState.value, closed: { ...dayLogState.value.closed, [date]: {
      closedAt: now, focusSeconds: summary.focusSeconds, sessions: summary.sessions, completed: dayCompletedCount(summary),
      ...(note.trim() ? { note: note.trim() } : {}),
    } } })) return false;
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDate = localTaskDate(tomorrow.getTime());
    const selected = new Set(moveTaskIds);
    for (const task of carryOverCandidates(latestTasksRef.current, date)) {
      if (!selected.has(task.id) || task.deadlineDate && task.deadlineDate < tomorrowDate) continue;
      handleEditTask(task.id, task.title, task.note || '', {
        title: task.title, note: task.note || '', plannedDate: task.plannedDate, deadlineDate: task.deadlineDate,
      }, { plannedDate: tomorrowDate, deadlineDate: task.deadlineDate });
    }
    setDayClose(null);
    requestAnimationFrame(() => quickAddInputRef.current?.focus());
    sound.sessionComplete();
    return true;
  };

  const handleContinueSummaryCountdown = (id: string) => {
    const now = Date.now();
    setTasks(previous => previous.map(task => {
      if (task.id !== id || task.done || !Number.isFinite(task.countdownExpiredAt)) return task;
      const settled = finishAfterExpiry(task, now);
      const paused = Number.isFinite(task.scheduledFor) && task.scheduledDurationSeconds === undefined
        ? { ...settled, scheduledDurationSeconds: task.countdownDurationSeconds } : settled;
      const extended = extendTaskCountdown(paused, 600, now);
      // A consumed 24h budget needs a fresh interval instead of an extension.
      return extended === paused ? configureTaskCountdown(paused, 600, now) : startTaskTimer(extended, now);
    }));
  };

  const handleContinueAfterExpiry = (id: string) => {
    const now = Date.now();
    setTasks(previous => previous.map(task => task.id === id ? continueAfterExpiry(task, now) : task));
  };
  // workedUntilNow credits the gap since zero (capped); without it the person was not working.
  const handleFinishAfterExpiry = (id: string, workedUntilNow = false) => {
    const now = Date.now();
    const current = latestTasksRef.current.find(task => task.id === id);
    setTasks(previous => previous.map(task => task.id === id ? finishAfterExpiry(task, now, workedUntilNow ? now : undefined) : task));
    if (current && !current.done) openPracticeFinish(current, false);
  };
  const handleStartTask = (id: string): boolean => {
    if (!timerWorkspaceReadyRef.current || !canPersistWorkspaceRef.current || tabMigrationBusyRef.current
      || workspaceOwnerRef.current !== strategyOwner || (auth.currentUser?.uid ?? null) !== strategyOwner) return false;
    const now = Date.now();
    const current = latestTasksRef.current.find(task => task.id === id);
    if (!current || current.done || !continueDayIfClosed()) return false;
    const next = Number.isFinite(current.countdownExpiredAt) ? continueAfterExpiry(current, now) : startTaskWork(finishLimitedStart(current, now), now);
    const workspace = readWorkspace();
    try { applyWorkspace({ ...workspace, tasks: annotateTaskChanges(workspace.tasks, workspace.tasks.map(task => task.id === id ? next : task), now) }, true); return true; }
    catch { setWorkspaceStorageError(true); return false; }
  };

  const handleLimitedStart = (id: string, capSeconds: number, options?: { continued?: boolean }) => {
    sound.activate();
    const now = Date.now();
    setTasks(previous => previous.map(task => {
      if (task.id !== id) return task;
      const attempt = latestAttempt(task);
      const recent = !!attempt && now >= attempt.at && now - attempt.at <= 30 * 60000;
      return startLimitedStart(task, capSeconds, now, { continued: options?.continued ?? recent });
    }));
  };

  const handleFinishLimitedStart = (id: string) => {
    const now = Date.now();
    setTasks(previous => previous.map(task => task.id === id ? finishLimitedStart(task, now) : task));
  };

  const handleToggleTimer = (id: string) => {
    sound.tick(500);
    const now = Date.now();
    const shouldPause = tasks.find(task => task.id === id)?.timerRunning;
    setTasks(previous => previous.map(task => task.id === id
      ? shouldPause ? task.limitedStart ? finishLimitedStart(task, now) : pauseTaskTimer(task, now) : task.done ? task : Number.isFinite(task.countdownExpiredAt) ? continueAfterExpiry(task, now) : startTaskTimer(finishLimitedStart(task, now), now)
      : task));
  };

  const handleConfigureCountdown = (id: string, seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 60 || seconds > 86400) return;
    const now = Date.now();
    setTasks(previous => previous.map(task => task.id === id && !task.done ? configureTaskCountdown(finishLimitedStart(task, now), seconds, now) : task));
  };

  const handleStopTimer = (id: string) => {
    const now = Date.now();
    setTasks(previous => previous.map(task => task.id === id ? task.limitedStart ? finishLimitedStart(task, now) : pauseTaskTimer(task, now) : task));
  };

  const handleExtendCountdown = (id: string, extraSeconds: number) => {
    const now = Date.now();
    setTasks(previous => previous.map(task => task.id === id ? extendTaskCountdown(finishLimitedStart(task, now), extraSeconds, now) : task));
  };

  const handleClearCountdown = (id: string) => {
    const now = Date.now();
    setTasks(previous => previous.map(task => task.id === id ? clearTaskCountdown(finishLimitedStart(task, now), now) : task));
  };

  const handleResetTimer = (id: string) => {
    const task = tasks.find(task => task.id === id);
    if ((task?.timeSpentSeconds || task?.timerRunning) && !window.confirm(lang === 'uk' ? 'Скинути весь записаний час цього завдання до нуля?' : 'Reset all recorded time for this task to zero?')) return;
    sound.tick(300);
    const now = Date.now();
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id === id) {
          return {
            ...discardTaskStepAttribution(t.limitedStart ? finishLimitedStart(t, now) : pauseTaskTimer(t, now)),
            timeSpentSeconds: 0,
            timeResetAt: Math.max(now, (t.timeResetAt || 0) + 1),
            timerRunning: false,
            timerStartedAt: undefined,
          };
        }
        return t;
      })
    );
  };

  const handleUpdateTimeSpent = (id: string, seconds: number) => {
    sound.tick(500);
    const now = Date.now();
    setTasks(prev => prev.map(task => task.id === id ? { ...setTaskTimeSpent(finishAfterExpiry(finishLimitedStart(task, now), now), seconds, now), timeResetAt: Math.max(now, (task.timeResetAt || 0) + 1) } : task));
  };

  const handleUpdateStep = (id: string, step: number) => {
    const now = Date.now();
    const label = lang === 'uk' ? 'Крок' : 'Step';
    setTasks(prev => prev.map(task => task.id === id ? setTaskProgress(task, step, now, label) : task));
  };

  const handleToggleStepItem = (taskId: string, stepIndex: number) => {
    const now = Date.now();
    const label = lang === 'uk' ? 'Крок' : 'Step';
    const task = latestTasksRef.current.find(task => task.id === taskId);
    if (task) commitTaskChange(task, toggleTaskStep(task, stepIndex, now, label), lang === 'uk' ? 'Підкрок оновлено' : 'Substep updated');
  };

  const handleAddStepItem = (taskId: string, stepTitle: string) => {
    const now = Date.now();
    const label = lang === 'uk' ? 'Крок' : 'Step';
    setTasks(prev => prev.map(task => task.id === taskId ? addTaskStep(task, { id: `s-${now}-${Math.random().toString(36).slice(2, 6)}`, title: stepTitle, done: false }, now, label) : task));
  };

  const handleDeleteStepItem = (taskId: string, stepIndex: number) => {
    const now = Date.now();
    const label = lang === 'uk' ? 'Крок' : 'Step';
    setTasks(prev => prev.map(task => task.id === taskId ? deleteTaskStep(task, stepIndex, now, label) : task));
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
    const taskToDelete = latestTasksRef.current.find((t) => t.id === id)
      ?? currentDeletedTasksRef.current.find(task => task.id === id && isCompletedArchivedTask(task));
    if (taskToDelete && timerWorkspaceReadyRef.current && workspaceOwnerRef.current === strategyOwner && (auth.currentUser?.uid ?? null) === strategyOwner) {
      const now = Date.now();
      const sanitizedToDelete = annotateTaskChanges([taskToDelete], [pauseTaskTimer(taskToDelete, now)], now)[0];
      const deletedItem: DeletedTask = {
        ...sanitizedToDelete,
        deletedAt: now,
      };
      const workspace = readWorkspace();
      try {
        applyWorkspace({ ...workspace, tasks: workspace.tasks.filter(task => task.id !== id), deletedTasks: [deletedItem, ...workspace.deletedTasks.filter(task => task.id !== id)] }, true);
        setRecentlyDeleted(sanitizedToDelete); setCompletedNoticeId(null); setTaskUndo(null);
      } catch { setWorkspaceStorageError(true); }
    }
  };

  const handleUndoDelete = () => {
    if (!timerWorkspaceReadyRef.current || workspaceOwnerRef.current !== strategyOwner || (auth.currentUser?.uid ?? null) !== strategyOwner) return;
    if (recentlyDeleted) {
      const currentArchived = currentDeletedTasksRef.current.find(task => task.id === recentlyDeleted.id);
      if (!currentArchived || latestTasksRef.current.some(task => task.id === recentlyDeleted.id)) {
        setRecentlyDeleted(null);
        return;
      }
      if (Date.now() >= currentArchived.deletedAt + 8000) { setRecentlyDeleted(null); return; }
      const { deletedAt, deletionReason, ...restored } = currentArchived;
      sound.activate();
      const receipt = currentCompletionLedgerRef.current?.[restored.id];
      const safeTask = { ...restored, updatedAt: Math.max(Date.now(), (restored.updatedAt ?? 0) + 1, (receipt?.updatedAt ?? 0) + 1, (receipt?.retiredAt ?? 0) + 1),
        phase: tabs.some(tab => tab.id === restored.phase) ? restored.phase : tabs[0]?.id || 'focus' };
      const workspace = readWorkspace();
      try {
        applyWorkspace({ ...workspace, tasks: [safeTask, ...workspace.tasks.filter(task => task.id !== restored.id)], deletedTasks: workspace.deletedTasks.filter(task => task.id !== restored.id),
          settings: deletionReason === 'accidental' && receipt ? { ...workspace.settings, completionLedger: { ...workspace.settings.completionLedger,
            [restored.id]: { ...receipt, counted: false, updatedAt: safeTask.updatedAt } } } : workspace.settings }, true);
        setRecentlyDeleted(null);
      } catch { setWorkspaceStorageError(true); }
    }
  };

  const handleClassifyDeletedTask = (id: string, deletionReason?: DeletedTask['deletionReason']) => {
    setDeletedTasks(prev => prev.map(task => {
      if (task.id !== id) return task;
      const { deletionReason: previousReason, ...rest } = task;
      const updatedAt = Math.max(Date.now(), (task.updatedAt ?? 0) + 1, (currentCompletionLedgerRef.current?.[id]?.updatedAt ?? 0) + 1);
      return deletionReason ? { ...rest, deletionReason, updatedAt } : { ...rest, updatedAt };
    }));
  };

  const handleRestoreDeletedTask = (task: DeletedTask) => {
    if (!timerWorkspaceReadyRef.current || workspaceOwnerRef.current !== strategyOwner || (auth.currentUser?.uid ?? null) !== strategyOwner) return false;
    const currentArchived = currentDeletedTasksRef.current.find(item => item.id === task.id);
    if (!currentArchived || latestTasksRef.current.some(item => item.id === task.id)) {
      setRecentlyDeleted(prev => prev?.id === task.id ? null : prev);
      return false;
    }
    sound.activate();
    const { deletedAt, deletionReason, ...restTask } = currentArchived;
    const fallbackTab = tabs[0]?.id || 'focus';
    const receipt = currentCompletionLedgerRef.current?.[task.id];
    const now = Math.max(Date.now(), (restTask.updatedAt ?? 0) + 1, (receipt?.updatedAt ?? 0) + 1, (receipt?.retiredAt ?? 0) + 1);
    const safeTask = annotateTaskChanges([restTask], [{
      ...restTask,
      updatedAt: now,
      phase: tabs.some((tb) => tb.id === restTask.phase) ? restTask.phase : fallbackTab,
    }], now)[0];
    const workspace = readWorkspace();
    try { applyWorkspace({ ...workspace, tasks: [safeTask, ...workspace.tasks.filter(existing => existing.id !== task.id)], deletedTasks: workspace.deletedTasks.filter(item => item.id !== task.id),
      settings: deletionReason === 'accidental' && receipt ? { ...workspace.settings, completionLedger: { ...workspace.settings.completionLedger,
        [task.id]: { ...receipt, counted: false, updatedAt: now } } } : workspace.settings }, true); }
    catch { setWorkspaceStorageError(true); return false; }
    setRecentlyDeleted(prev => prev?.id === task.id ? null : prev);
    setSelectedPhase('ALL');
    setActiveFilter('ALL');
    setSearchQuery('');
    setRevealTaskId(task.id);
    if (safeTask.done) setEditingTaskId(task.id);
    return true;
  };

  const handlePermanentDeleteTask = (id: string) => {
    const task = currentDeletedTasksRef.current.find(item => item.id === id);
    if (!task) return;
    if (isCompletedArchivedTask(task)) { setCompletedTaskToDelete(id); return; }
    const confirmation = lang === 'uk' ? 'Назавжди видалити це завдання з кошика? Відновити його буде неможливо.' : 'Permanently delete this task from trash? It cannot be restored.';
    if (!window.confirm(confirmation)) return;
    sound.tick(300);
    if (task.done && !task.scheduledPending) {
      applyWorkspace(retireCompletedTask(readWorkspace(), id, { accidental: task.deletionReason === 'accidental' }), true);
      setRecentlyDeleted(prev => prev?.id === id ? null : prev);
      return;
    }
    setDeletedTasks((prev) => prev.filter((d) => d.id !== id));
    setRecentlyDeleted(prev => prev?.id === id ? null : prev);
  };

  const handleDeleteCompletedTask = (accidental: boolean) => {
    const id = completedTaskToDelete;
    if (!id || !timerWorkspaceReadyRef.current || workspaceOwnerRef.current !== (auth.currentUser?.uid ?? null)) return;
    const workspace = readWorkspace();
    const next = retireCompletedTask(workspace, id, { accidental });
    try {
      if (next !== workspace) applyWorkspace(next, true);
      setCompletedTaskToDelete(null);
      setCompletedNoticeId(previous => previous === id ? null : previous);
      setRecentlyDeleted(previous => previous?.id === id ? null : previous);
    } catch (error) {
      console.error('Could not save completed task removal:', error);
      setWorkspaceStorageError(true);
    }
  };

  const handleClearDeletedHistory = () => {
    // HistoryView shows the single explicit confirmation; completed milestones stay intact.
    sound.tick(250);
    setDeletedTasks(prev => selectRelevantArchivedTasks(latestTasksRef.current, prev).filter(isCompletedArchivedTask));
    setRecentlyDeleted(null);
  };

  const handleAddTask = (newTask: NewTaskInput, proposedCategoryName?: string) => {
    if (!timerWorkspaceReadyRef.current || tabMigrationBusyRef.current
      || workspaceOwnerRef.current !== (auth.currentUser?.uid ?? null)
      || localStorage.getItem(workspaceTabTransactionKey(workspaceOwnerRef.current)) !== null) return false;
    const categoryName = proposedCategoryName?.trim().slice(0, 32);
    const existing = categoryName ? currentTabsRef.current.find(tab => normalizeQuickAddCategory(tab.name) === normalizeQuickAddCategory(categoryName)) : undefined;
    const proposedTab: TaskTab | undefined = categoryName && !existing
      ? { id: `category-${crypto.randomUUID()}`, name: categoryName, color: getRandomTabColor(currentTabsRef.current) } : undefined;
    let effectivePhase = existing?.id ?? proposedTab?.id ?? newTask.phase;
    if (!proposedTab && !currentTabsRef.current.some(tab => tab.id === effectivePhase)) {
      effectivePhase = currentTabsRef.current[0]?.id || 'focus';
    }
    const now = Date.now();
    const task = createTask({ ...newTask, phase: effectivePhase }, `task-${now}-${Math.random().toString(36).slice(2, 8)}`, now);
    if (!task) return false;
    const workspace = readWorkspace();
    try { applyWorkspace({ ...workspace, tasks: annotateTaskChanges(workspace.tasks, [task, ...workspace.tasks], now), tabs: proposedTab ? [...workspace.tabs, proposedTab] : workspace.tabs }, true); }
    catch { setWorkspaceStorageError(true); return false; }
    setActiveFilter('ALL');
    setSearchQuery('');
    setCompletedNoticeId(null);
    return true;
  };

  const openPracticeFinish = (task: PSTask, finishTask: boolean): boolean => {
    const skill = growthRef.current.skills.find(value => value.id === task.skillId && value.deletedAt === undefined && value.archivedAt === undefined);
    if (!strategyReady || !skill) {
      setActionNotice(lang === 'uk' ? 'Спершу відновіть навичку з Архіву, щоб записати новий результат.' : 'Restore the skill from Archive before recording a new result.');
      return false;
    }
    const current = latestTasksRef.current.find(value => value.id === task.id);
    if (!current) return false;
    if (current.timerRunning || current.limitedStart) {
      const now = Date.now(), workspace = readWorkspace();
      const paused = pauseTaskTimer(finishLimitedStart(current, now), now);
      try { applyWorkspace({ ...workspace, tasks: annotateTaskChanges(workspace.tasks, workspace.tasks.map(value => value.id === current.id ? paused : value), now) }, true); }
      catch { setWorkspaceStorageError(true); return false; }
    }
    const pending = { skillId: skill.id, taskId: task.id, measurementMode: task.measurementMode, completeTask: finishTask, ownerId: strategyOwner, generation: authGenerationRef.current };
    practiceFinishRef.current = pending;
    setPracticeFinish(pending);
    setSessionSummary(null);
    return true;
  };
  const closePracticeFinish = () => { practiceFinishRef.current = null; setPracticeFinish(null); };
  const finishPracticeTask = () => {
    const pending = practiceFinishRef.current;
    if (!pending || pending.ownerId !== workspaceOwnerRef.current || pending.generation !== authGenerationRef.current) return;
    if (pending.taskId && pending.completeTask) {
      const now = Date.now();
      const current = latestTasksRef.current.find(task => task.id === pending.taskId);
      if (!current || !commitTaskChange(current, completeTask(finishLimitedStart(current, now), now), lang === 'uk' ? 'Завдання виконане' : 'Task completed')) return;
      setCompletedNoticeId(pending.taskId);
    }
    closePracticeFinish();
  };
  const savePracticeResult = (input: Parameters<typeof growth.addPracticeSession>[0], measurement?: Parameters<typeof growth.addPracticeSession>[1]): boolean => {
    const pending = practiceFinishRef.current;
    if (!pending || pending.ownerId !== workspaceOwnerRef.current || pending.generation !== authGenerationRef.current
      || input.skillId !== pending.skillId || input.taskId !== pending.taskId) return false;
    if (!growth.addPracticeSession(input, measurement)) return false;
    finishPracticeTask();
    return true;
  };
  const handleGrowthPractice = (skill: GrowthSkill, subskillId?: string, title?: string, start = false, measurementMode?: boolean): boolean => {
    if (!strategyReady || !timerWorkspaceReadyRef.current || !canPersistWorkspaceRef.current || tabMigrationBusyRef.current
      || workspaceOwnerRef.current !== (auth.currentUser?.uid ?? null)
      || localStorage.getItem(workspaceTabTransactionKey(strategyOwner)) !== null
      || localStorage.getItem(strategyTransactionKey(strategyOwner)) !== null) return false;
    const active = growthRef.current.skills.find(value => value.id === skill.id && value.archivedAt === undefined && value.deletedAt === undefined);
    if (!active || subskillId && !active.subskills.some(value => value.id === subskillId)) return false;
    if (start && !continueDayIfClosed()) return false;
    const now = Date.now(), today = localTaskDate(now);
    const existing = latestTasksRef.current.find(task => !task.done && !task.scheduledPending && task.skillId === skill.id
      && task.subskillId === subskillId && !!task.measurementMode === !!measurementMode && (!task.plannedDate || task.plannedDate === today) && (!title || task.title === title));
    let taskId = existing?.id;
    if (existing) { if (start && !handleStartTask(existing.id)) return false; }
    else {
      const task = createTask({ title: title || active.subskills.find(value => value.id === subskillId)?.title || active.title,
        phase: currentTabsRef.current[0]?.id || 'focus', priority: 2, steps: 0, skillId: active.id, ...(measurementMode ? { measurementMode: true } : {}),
        ...(subskillId ? { subskillId } : {}), plannedDate: today, timerMode: 'stopwatch' }, 'task-' + crypto.randomUUID(), now);
      if (!task) return false;
      const before = readWorkspace();
      const records = annotateTaskChanges(before.tasks, [start ? startTaskWork(task, now) : task, ...before.tasks], now);
      try { applyWorkspace({ ...before, tasks: records }, true); } catch { setWorkspaceStorageError(true); return false; }
      taskId = task.id;
    }
    if (start && taskId) { setGrowthSetup(null); handleRevealTask(taskId); }
    return true;
  };

  const handleInjectAITasks = (
    newTasks: (Omit<PSTask, 'id' | 'currentStep' | 'done' | 'pinned' | 'createdAt'> & AITimerSettings)[] = [],
    requestedTabs: TaskTab[] = [],
    taskUpdates: AITaskUpdate[] = [],
    deletedTaskRefs: (string | AIDeletedTaskRef)[] = [],
  ) => {
    if (!timerWorkspaceReadyRef.current || tabMigrationBusyRef.current
      || workspaceOwnerRef.current !== (auth.currentUser?.uid ?? null)
      || localStorage.getItem(workspaceTabTransactionKey(workspaceOwnerRef.current)) !== null) {
      return { created: 0, updated: 0, deleted: 0, tabs: 0,
        rejected: newTasks.length + taskUpdates.length + deletedTaskRefs.length + requestedTabs.length };
    }
    const currentTaskIds = new Set(latestTasksRef.current.map(task => task.id));
    const knownIds = new Set(tabs.map((tab) => tab.id));
    const knownNames = new Set(tabs.map((tab) => tab.name.trim().toLocaleLowerCase()));
    const tabsToAdd: TaskTab[] = [];
    for (const requestedTab of requestedTabs) {
      const name = typeof requestedTab?.name === 'string' ? requestedTab.name.trim().slice(0, 32) : '';
      const id = typeof requestedTab?.id === 'string' ? requestedTab.id.trim().slice(0, 40) : '';
      if (!name || !id || knownIds.has(id) || knownNames.has(name.toLocaleLowerCase())) continue;
      knownIds.add(id);
      knownNames.add(name.toLocaleLowerCase());
      tabsToAdd.push({ id, name, color: requestedTab.color || getRandomTabColor([...tabs, ...tabsToAdd]) });
    }
    const availableTabIds = new Set([...tabs.map((tab) => tab.id), ...tabsToAdd.map((tab) => tab.id)]);
    if (tabsToAdd.length > 0) {
      setTabs((previous) => [...previous, ...tabsToAdd]);
    }

    // Process Task Updates and Task Deletions
    const updatesMap = new Map<string, AITaskUpdate>();
    let rejectedUpdates = 0;
    for (const up of taskUpdates) {
      const current = latestTasksRef.current.find(task => task.id === up?.id);
      if (up && (up.plannedDate !== undefined && up.plannedDate !== null && !isTaskDate(up.plannedDate) || up.deadlineDate !== undefined && up.deadlineDate !== null && !isTaskDate(up.deadlineDate))) { rejectedUpdates++; continue; }
      const candidatePlanned = up?.plannedDate === null ? undefined : up?.plannedDate ?? current?.plannedDate;
      const candidateDeadline = up?.deadlineDate === null ? undefined : up?.deadlineDate ?? current?.deadlineDate;
      if (candidatePlanned && candidateDeadline && candidatePlanned > candidateDeadline) { rejectedUpdates++; continue; }
      if (!current || (up.schedule !== undefined && (!normalizeTaskSchedule(up.schedule) || current.done || current.timerRunning || current.startedAt || (current.timeSpentSeconds ?? 0) > 0)) || ((current.scheduledPending || up.schedule) && (up.timerAction === 'start' || up.done === true)) || !isAITimerSettingsValid({ ...current, done: typeof up.done === 'boolean' ? up.done : current.done }, up)) {
        rejectedUpdates++;
        continue;
      }
      updatesMap.set(up.id, up);
    }
    const toDeleteSet = new Set(deletedTaskRefs.map(ref => typeof ref === 'string' ? ref : ref.id));
    const deletionReasons = new Map<string, DeletedTask['deletionReason']>();
    for (const ref of deletedTaskRefs) {
      if (typeof ref !== 'string' && (ref.deletionReason === 'accidental' || ref.deletionReason === 'cancelled')) {
        deletionReasons.set(ref.id, ref.deletionReason);
      }
    }

    if (updatesMap.size > 0 || toDeleteSet.size > 0) {
      setTasks((prev) => {
        const deletedToArchive: DeletedTask[] = [];
        const nextList = prev
          .filter((t) => {
            if (toDeleteSet.has(t.id)) {
              const deletionReason = deletionReasons.get(t.id);
              deletedToArchive.push({ ...pauseTaskTimer(finishLimitedStart(t, Date.now())), deletedAt: Date.now(), ...(deletionReason ? { deletionReason } : {}) });
              return false;
            }
            return true;
          })
          .map((t) => {
            const update = updatesMap.get(t.id);
            if (!update) return t;
            // AI timer changes replace the attempt's temporary ceiling, so credit the attempt first.
            const timerChange = update.timerMode !== undefined || update.countdownDurationSeconds !== undefined || update.timerAction !== undefined || update.recordedWorkSeconds !== undefined;
            return applyAITaskUpdate(timerChange ? finishLimitedStart(t, Date.now()) : t, update, availableTabIds);
          });

        if (deletedToArchive.length > 0) {
          const archivedIds = new Set(deletedToArchive.map(task => task.id));
          setDeletedTasks((prevDeleted) => [...deletedToArchive, ...prevDeleted.filter(task => !archivedIds.has(task.id))]);
        }
        return nextList;
      });
    }

    const items: PSTask[] = (newTasks || []).map((t, i) => {
      let phase = t.phase;
      if (isSystemView(phase) || !availableTabIds.has(phase)) {
        phase = tabs[0]?.id || 'focus';
      }
      const stepCount = t.stepList && t.stepList.length > 0 ? t.stepList.length : (Number.isInteger(t.steps) && t.steps >= 0 ? t.steps : 0);
      const now = Date.now();
      const created = createTask({
        ...t,
        phase,
        steps: stepCount,
        stepList: t.stepList,
        timerMode: t.timerMode || (t.countdownDurationSeconds !== undefined ? 'countdown' : 'none'),
      }, `task-${now}-${i}-${Math.random().toString(36).substr(2, 4)}`, now + i);
      return created && !(created.scheduledPending && t.timerAction === 'start') && isAITimerSettingsValid(created, t) ? applyAITimerSettings(created, t, now) : null;
    }).filter((task): task is PSTask => task !== null);
    if (items.length > 0) setTasks((prev) => [...items, ...prev]);
    if (tabsToAdd.length > 0 && items.length === 0) setSelectedPhase(tabsToAdd[0].id);
    const updated = [...updatesMap.keys()].filter(id => currentTaskIds.has(id) && !toDeleteSet.has(id)).length;
    const deleted = [...toDeleteSet].filter(id => currentTaskIds.has(id)).length;
    return { created: items.length, updated, deleted, tabs: tabsToAdd.length,
      rejected: rejectedUpdates + newTasks.length - items.length + [...updatesMap.keys()].filter(id => !currentTaskIds.has(id)).length
        + [...toDeleteSet].filter(id => !currentTaskIds.has(id)).length };
  };

  const handleClearCompleted = () => {
    if (!tasks.some(task => task.done)) return;
    if (!window.confirm(lang === 'uk'
      ? 'Перенести виконані завдання до історії? Їхні результати, час і дата завершення збережуться.'
      : 'Move completed tasks to history? Their results, time and completion date will be preserved.')) return;
    sound.tick(350);
    const completedToArchive: DeletedTask[] = tasks
      .filter((t) => t.done)
      .map((t) => ({ ...t, deletedAt: Date.now() }));
    if (completedToArchive.length > 0) {
      const archivedIds = new Set(completedToArchive.map(task => task.id));
      setDeletedTasks((prev) => [...completedToArchive, ...prev.filter(task => !archivedIds.has(task.id))]);
    }
    setTasks((prev) => prev.filter((t) => !t.done));
  };

  const handleCreateNoteTasks = (items: NotepadTaskCandidate[], config: NotepadTaskConfig): NotepadTaskResult[] => {
    if (notesOwner !== strategyOwner || !strategyReady || !timerWorkspaceReadyRef.current || workspaceOwnerRef.current !== strategyOwner) {
      return items.map(item => ({ id: item.id, status: 'error', error: lang === 'uk' ? 'Простір ще не готовий. Повторіть.' : 'Workspace is not ready. Retry.' }));
    }
    const workspace = readWorkspace();
    const liveNotes = getCurrentNotes();
    if (!liveNotes || !workspace.tabs.some(tab => tab.id === config.phase) || config.plannedDate && !isTaskDate(config.plannedDate)) {
      return items.map(item => ({ id: item.id, status: 'error', error: lang === 'uk' ? 'Перевірте нотатку, категорію та дату.' : 'Check the note, category and date.' }));
    }
    const records = [...workspace.tasks], results: NotepadTaskResult[] = [];
    const retained = [...workspace.tasks, ...workspace.deletedTasks];
    for (const item of items) {
      const existing = [...records, ...retained].find(task => task.sourceNoteKey === item.sourceKey);
      if (existing) { results.push({ id: item.id, status: 'existing', taskId: existing.id }); continue; }
      const source = liveNotes.find(note => note.id === item.noteId && note.deletedAt === undefined);
      if (!source || noteSourceHash(source.content) !== item.sourceContentHash || !item.title.trim()) {
        results.push({ id: item.id, status: 'error', error: lang === 'uk' ? 'Нотатка змінилася або назва порожня. Оновіть перегляд.' : 'The note changed or the title is empty. Refresh the preview.' }); continue;
      }
      const task = createTask({ title: item.title.trim(), phase: config.phase, priority: 2, steps: 0, timerMode: 'stopwatch',
        plannedDate: config.plannedDate, note: item.sourceText, sourceNoteId: item.noteId, sourceNotePage: item.page,
        sourceNoteText: item.sourceText, sourceNoteKey: item.sourceKey }, 'task-' + crypto.randomUUID(), Date.now());
      if (!task) { results.push({ id: item.id, status: 'error', error: lang === 'uk' ? 'Не вдалося створити запис.' : 'Could not create the record.' }); continue; }
      records.push(task); results.push({ id: item.id, status: 'created', taskId: task.id });
    }
    if (results.some(result => result.status === 'created')) try {
      applyWorkspace({ ...workspace, tasks: annotateTaskChanges(workspace.tasks, records, Date.now()) }, true);
    } catch {
      setWorkspaceStorageError(true);
      const addedIds = new Set(results.filter(result => result.status === 'created').map(result => result.taskId));
      return results.map(result => result.status === 'created' || result.status === 'existing' && addedIds.has(result.taskId) ? { id: result.id, status: 'error', error: lang === 'uk' ? 'Не збережено. Повторіть без повторного введення.' : 'Not saved. Retry without retyping.' } : result);
    }
    return results;
  };

  const archiveItems: ArchiveItem[] = [
    ...tasks.filter(task => task.done && !task.scheduledPending).map(task => ({ id: task.id, kind: 'task' as const, title: task.title,
      at: task.completedAt ?? task.createdAt, status: 'completed' as const, restoreLabel: lang === 'uk' ? 'Відкрити' : 'Open',
      countsAsCompleted: completionLedger?.[task.id]?.counted !== false, canDeletePermanently: true, detail: tabs.find(tab => tab.id === task.phase)?.name,
      deleteImpact: lang === 'uk' ? 'Деталі завдання буде видалено. Загальний облік завершень можна зберегти.' : 'Full task details will be removed. The lifetime completion credit can be kept.' })),
    ...deletedTasks.map(task => ({ id: task.id, kind: 'task' as const, title: task.title, at: task.deletedAt, status: 'deleted' as const,
      countsAsCompleted: task.done && !task.scheduledPending && task.deletionReason !== 'accidental' && completionLedger?.[task.id]?.counted !== false, canDeletePermanently: true,
      detail: task.done ? (lang === 'uk' ? 'Виконане завдання' : 'Completed task') : (lang === 'uk' ? 'Незавершене завдання' : 'Unfinished task'),
      deleteImpact: lang === 'uk' ? 'Остаточно видалити деталі цього завдання. Відновлення стане недоступним.' : 'Permanently remove these task details. Restoration will be unavailable.' })),
    ...(notesOwner === strategyOwner ? deletedNotes : []).map(note => ({ id: note.id, kind: 'note' as const, title: note.title || note.content.split('\n')[0] || (lang === 'uk' ? 'Без назви' : 'Untitled'),
      at: note.deletedAt!, status: 'deleted' as const, undoUntil: note.undoUntil, canDeletePermanently: true,
      deleteImpact: lang === 'uk' ? 'Нотатку та її сторінки буде остаточно видалено. Створені з неї завдання залишаться.' : 'The note and its pages will be permanently removed. Tasks created from it will remain.' })),
    ...growth.skills.filter(skill => skill.archivedAt !== undefined || skill.deletedAt !== undefined).map(skill => ({ id: skill.id, kind: 'skill' as const, title: skill.title,
      at: skill.deletedAt ?? skill.archivedAt!, status: skill.deletedAt !== undefined ? 'deleted' as const : 'archived' as const, canDeletePermanently: true,
      deleteImpact: lang === 'uk' ? 'Навичку та всі її заміри й практики буде остаточно видалено. Завдання залишаться без прив’язки до навички.' : 'The skill and all its measurements and practices will be permanently removed. Tasks will remain without the skill link.' })),
    ...growth.measurements.filter(item => item.deletedAt !== undefined).map(item => ({ id: item.id, kind: 'measurement' as const,
      title: (growth.skills.find(skill => skill.id === item.skillId)?.title ?? (lang === 'uk' ? 'Замір' : 'Measurement')) + ' · ' + item.value,
      at: item.deletedAt!, status: 'deleted' as const, canDeletePermanently: true,
      deleteImpact: lang === 'uk' ? 'Замір буде остаточно видалено; пов’язана практика залишиться без цього заміру.' : 'The measurement will be permanently removed; its practice will remain without this measurement.' })),
    ...growth.sessions.filter(item => item.deletedAt !== undefined).map(item => ({ id: item.id, kind: 'practice' as const,
      title: growth.skills.find(skill => skill.id === item.skillId)?.title ?? (lang === 'uk' ? 'Практика' : 'Practice'),
      at: item.deletedAt!, status: 'deleted' as const, canDeletePermanently: true,
      deleteImpact: lang === 'uk' ? 'Запис практики й пов’язаний замір буде остаточно видалено. Облік виконаних завдань не зміниться.' : 'The practice record and its linked measurement will be permanently removed. Task completion counts will stay unchanged.' })),
  ];
  const closeArchive = () => { setArchiveOpen(false); setIsSettingsOpen(false); };
  const handleRestoreArchive = (item: ArchiveItem): boolean => {
    if (!strategyReady || workspaceOwnerRef.current !== strategyOwner || notesOwner !== strategyOwner) return false;
    let restored = false;
    if (item.kind === 'task') {
      const deleted = currentDeletedTasksRef.current.find(task => task.id === item.id);
      if (deleted) restored = handleRestoreDeletedTask(deleted);
      else if (latestTasksRef.current.some(task => task.id === item.id)) { setSelectedPhase('ALL'); setActiveFilter('ALL'); setSearchQuery(''); setEditingTaskId(item.id); restored = true; }
    } else if (item.kind === 'note') {
      restored = handleRestoreNote(item.id);
      if (restored) { setSelectedPhase('NOTES'); setNoteSearchQuery(''); setRevealNoteId(item.id); }
    } else {
      const skillId = item.kind === 'skill' ? item.id : (item.kind === 'measurement' ? growth.measurements : growth.sessions).find(record => record.id === item.id)?.skillId;
      restored = item.kind === 'skill' ? growth.restoreSkill(item.id) : item.kind === 'measurement' ? growth.restoreMeasurement(item.id) : growth.restorePracticeSession(item.id);
      if (restored) { setSelectedPhase('STRATEGY'); setGrowthSetup(null); setRevealGrowthSkillId(skillId ?? null); }
    }
    if (restored) closeArchive();
    return restored;
  };
  const handlePurgeArchive = (item: ArchiveItem, options?: { accidental?: boolean }): boolean => {
    if (!strategyReady || workspaceOwnerRef.current !== strategyOwner || (auth.currentUser?.uid ?? null) !== strategyOwner) return false;
    if (item.kind === 'note') return notesOwner === strategyOwner && handlePurgeNote(item.id, item.at);
    const workspace = readWorkspace();
    let next = workspace;
    if (item.kind === 'task') {
      if (item.status === 'deleted' && !workspace.deletedTasks.some(task => task.id === item.id && task.deletedAt === item.at)) return false;
      if (item.status === 'completed' && !workspace.tasks.some(task => task.id === item.id && task.done && (task.completedAt ?? task.createdAt) === item.at)) return false;
      const task = workspace.tasks.find(task => task.id === item.id) ?? workspace.deletedTasks.find(task => task.id === item.id);
      if (!task) return false;
      next = task.done ? retireCompletedTask(workspace, item.id, options) : { ...workspace, deletedTasks: workspace.deletedTasks.filter(task => task.id !== item.id) };
    } else if (item.kind === 'skill') {
      const skill = workspace.skills?.find(skill => skill.id === item.id);
      if (!skill || (skill.deletedAt ?? skill.archivedAt) !== item.at) return false;
      const unlink = <T extends PSTask>(task: T): T => task.skillId === item.id ? { ...task, skillId: undefined, subskillId: undefined, measurementMode: undefined, updatedAt: Date.now() } : task;
      next = { ...workspace, skills: workspace.skills?.filter(skill => skill.id !== item.id), measurements: workspace.measurements?.filter(record => record.skillId !== item.id),
        practiceSessions: workspace.practiceSessions?.filter(record => record.skillId !== item.id), tasks: workspace.tasks.map(unlink), deletedTasks: workspace.deletedTasks.map(unlink) };
    } else if (item.kind === 'measurement') {
      if (!workspace.measurements?.some(record => record.id === item.id && record.deletedAt === item.at)) return false;
      next = { ...workspace, measurements: workspace.measurements?.filter(record => record.id !== item.id),
        practiceSessions: workspace.practiceSessions?.map(record => record.measurementId === item.id ? { ...record, measurementId: undefined, updatedAt: Date.now() } : record) };
    } else {
      const session = workspace.practiceSessions?.find(record => record.id === item.id);
      if (!session || session.deletedAt !== item.at) return false;
      next = { ...workspace, practiceSessions: workspace.practiceSessions?.filter(record => record.id !== item.id),
        measurements: workspace.measurements?.filter(record => record.id !== session?.measurementId && record.sessionId !== item.id) };
    }
    try { applyWorkspace(normalizeWorkspaceForStorage(next), true); return true; }
    catch { setWorkspaceStorageError(true); return false; }
  };

  // «бачить 3 навички · 14 замірів»: what Karkas AI can see, shown under its name.
  const aiContextLine = useMemo(() => {
    const skills = growth.skills.filter(skill => skill.deletedAt === undefined && skill.archivedAt === undefined).length;
    const measurements = growth.measurements.filter(item => item.deletedAt === undefined).length;
    const plural = (count: number, one: string, few: string, many: string) => count % 10 === 1 && count % 100 !== 11 ? one : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? few : many;
    if (lang === 'en') return skills ? `sees ${skills} skill${skills === 1 ? '' : 's'} · ${measurements} measurement${measurements === 1 ? '' : 's'}` : `sees ${tasks.length} task${tasks.length === 1 ? '' : 's'}`;
    return skills ? `бачить ${skills} ${plural(skills, 'навичку', 'навички', 'навичок')} · ${measurements} ${plural(measurements, 'замір', 'заміри', 'замірів')}`
      : `бачить ${tasks.length} ${plural(tasks.length, 'задачу', 'задачі', 'задач')}`;
  }, [growth.skills, growth.measurements, tasks.length, lang]);
  const handleToggleSound = () => {
    sound.enabled = !soundEnabled;
    setSoundEnabled(!soundEnabled);
  };

  // Taskbar progress and the live tray mirror the running session; tray quick actions use the latest handlers.
  useDesktopPresence(tasks, lang, workspaceReady);
  const desktopCommandHandlersRef = React.useRef<DesktopCommandHandlers | null>(null);
  desktopCommandHandlersRef.current = {
    toggleTimer: id => { if (latestTasksRef.current.some(task => task.id === id && !task.done)) handleToggleTimer(id); },
    completeTask: id => { if (latestTasksRef.current.some(task => task.id === id && !task.done)) handleToggleDone(id); },
    startTask: id => { if (latestTasksRef.current.some(task => task.id === id && !task.done)) handleStartTask(id); },
  };
  useEffect(() => subscribeDesktopCommands({
    toggleTimer: id => desktopCommandHandlersRef.current?.toggleTimer(id),
    completeTask: id => desktopCommandHandlersRef.current?.completeTask(id),
    startTask: id => desktopCommandHandlersRef.current?.startTask(id),
  }), []);

  const summaryTask = sessionSummary && tasks.find(task => task.id === sessionSummary.session.taskId);
  const showSessionSummary = workspaceReady && sessionSummary && summaryTask && !summaryTask.timerRunning
    && sessionSummary.ownerId === workspaceOwnerRef.current && sessionSummary.ownerId === (currentUser?.uid ?? null)
    && !practiceFinish && summaryTask.done === sessionSummary.task.done
    && (sessionSummary.session.reason !== 'countdownEnded' || summaryTask.countdownExpiredAt === sessionSummary.task.countdownExpiredAt);

  const isPracticeTask = (task: PSTask) => !!task.skillId;
  const todayFirstRun = operationalTasks.length === 0 && !growth.skills.some(skill => skill.deletedAt === undefined);
  const pulseTasks = [...filteredTasks.filter(task => isPracticeTask(task) && !task.done), ...filteredTasks.filter(task => !isPracticeTask(task) && !task.done)];

  const recentlyDeletedArchive = recentlyDeleted ? deletedTasks.find(task => task.id === recentlyDeleted.id) : undefined;

  return (
    <MotionConfig reducedMotion="user"><div className="pulse-app min-h-screen flex flex-col relative overflow-x-clip">

      <PulseHeader
        lang={lang} activeTab={selectedPhase === 'STRATEGY' || selectedPhase === 'DASHBOARD' || selectedPhase === 'HISTORY' ? 'growth' : selectedPhase === 'NOTES' ? 'notes' : 'today'}
        onTabChange={tab => { setIsSettingsOpen(false); setIsAccountOpen(false); setGrowthSetup(null); setSelectedPhase(tab === 'growth' ? 'STRATEGY' : tab === 'notes' ? 'NOTES' : 'ALL'); closeHeaderSearch(); }}
        onSearch={openHeaderSearch}
        searchOpen={searchVisible}
        searchValue={selectedPhase === 'NOTES' ? noteSearchQuery : searchQuery}
        searchPlaceholder={selectedPhase === 'NOTES' ? (lang === 'uk' ? 'Пошук нотаток…' : 'Search notes…') : (lang === 'uk' ? 'Пошук завдань…' : 'Search tasks…')}
        searchInputRef={searchInputRef} searchFocusToken={searchFocusToken}
        onSearchChange={value => {
          setIsSettingsOpen(false); setIsAccountOpen(false);
          if (selectedPhase === 'NOTES') setNoteSearchQuery(value); else setSearchQuery(value);
        }}
        onSearchClose={closeHeaderSearch}
        onSettings={() => { setIsAccountOpen(false); setIsSettingsOpen(true); }} onAdd={() => setIsQuickAddOpen(true)} onAccount={() => { setIsSettingsOpen(false); setIsAccountOpen(true); }}
        accountName={currentUser?.displayName || currentUser?.email || (lang === 'uk' ? 'Гість' : 'Guest')}
        accountAvatarUrl={accountAvatarUrl}
        syncLabel={!currentUser ? (lang === 'uk' ? 'локально' : 'local') : !autoSyncEnabled ? (lang === 'uk' ? 'автосинхронізацію вимкнено' : 'auto sync off') : undefined}
        syncStatus={syncStatus} isFullscreen={isFullscreen}
        onMinimize={handleMinimizeWindow} onToggleFullscreen={handleToggleFullscreen} onCloseWindow={handleCloseWindow}
      />

      {actionNotice && <div role="status" className="relative z-20 max-w-6xl w-full mx-auto px-4 py-3 text-sm bg-amber-950/40 border border-amber-800 text-amber-100">
        {actionNotice}<button className="underline ml-3" onClick={() => setActionNotice(null)}>{lang === 'uk' ? 'Закрити' : 'Dismiss'}</button>
      </div>}
      {workspaceStorageError && <div role="alert" className="relative z-20 max-w-6xl w-full mx-auto px-4 py-3 text-sm bg-amber-950/40 border border-amber-800 text-amber-100">
        {lang === 'uk' ? 'Не вдалося зберегти останні зміни на пристрої. Вони залишаються у відкритому застосунку. Звільніть місце й повторіть збереження перед виходом.' : 'The latest changes could not be saved on this device. They remain in the open app. Free storage and retry saving before leaving.'}
        <button type="button" className="min-h-11 underline ml-3" onClick={() => void retryWorkspaceSave()}>{lang === 'uk' ? 'Повторити збереження' : 'Retry saving'}</button>
      </div>}
      {completedNoticeId && tasks.some(task => task.id === completedNoticeId && task.done) && (
        <TaskCompletionNotice taskId={completedNoticeId} lang={lang}
          canUndo={taskUndo?.after.id === completedNoticeId}
          onReopen={() => { if (taskUndo?.after.id === completedNoticeId) handleUndoTaskChange(); }} onDismiss={() => { setCompletedNoticeId(null); setTaskUndo(null); }}
          onRecordResult={tasks.find(task => task.id === completedNoticeId)?.skillId ? () => { const task = latestTasksRef.current.find(task => task.id === completedNoticeId); if (task) openPracticeFinish(task, false); } : undefined} />
      )}
      {taskUndo && taskUndo.ownerId === strategyOwner && !completedNoticeId && <div className="pulse-task-change-toast" role="status">
        <span>{taskUndo.label}</span><button type="button" onClick={() => { handleUndoTaskChange(); }}>{lang === 'uk' ? 'Скасувати' : 'Undo'}</button>
        <button type="button" onClick={() => setTaskUndo(null)} aria-label={lang === 'uk' ? 'Закрити' : 'Dismiss'}><X size={17} /></button>
      </div>}
      {completedTaskToDelete && <CompletedTaskDeleteDialog lang={lang}
        title={(tasks.find(task => task.id === completedTaskToDelete) ?? deletedTasks.find(task => task.id === completedTaskToDelete))?.title ?? ''}
        onClose={() => setCompletedTaskToDelete(null)} onDelete={handleDeleteCompletedTask} />}
      {/* Minimized Window Taskbar Floating Notification */}
      {isWindowMinimized && (
        <div
          id="win-minimized-taskbar-banner"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-[#0d0d12]/95 border border-neutral-700 shadow-2xl px-4 py-2 flex items-center gap-3 backdrop-blur-md animate-in fade-in slide-in-from-bottom-3 duration-200"
        >
          <img
            src="/icon.png?v=karkas-app-icon-3"
            alt="KARKAS Logo"
            className="w-4 h-4 rounded-[2px] object-cover shrink-0 shadow-sm"
            onError={(e) => {
              (e.currentTarget as HTMLElement).style.display = 'none';
            }}
          />
          <span className="text-xs font-sans text-neutral-300">
            {t.winTitlebar?.minimizedNotice || 'KARKAS window is minimized. Click to restore.'}
          </span>
          <button
            id="win-restore-taskbar-btn"
            onClick={() => {
              sound.tick(600);
              setIsWindowMinimized(false);
            }}
            className="px-2.5 py-1 bg-white text-black font-sans font-extrabold text-xs tracking-wider hover:bg-neutral-200 transition-colors uppercase cursor-pointer"
          >
            {t.winTitlebar?.restoreBtn || 'RESTORE WINDOW'}
          </button>
        </div>
      )}

      {isQuickAddOpen && timerWorkspaceReadyRef.current && <QuickAddDialog tabs={tabs} skills={growth.skills} selectedPhase={selectedPhase} lang={lang} now={insightNow}
        onAdd={handleAddTask} onClose={() => setIsQuickAddOpen(false)}
        onMoreOptions={values => { setQuickAddPrefill({ ...values, key: ++quickAddPrefillKey.current }); setIsAddOpen(true); }} />}

      {(isAddOpen || editingTaskId && tasks.some(task => task.id === editingTaskId)) && timerWorkspaceReadyRef.current && workspaceOwnerRef.current === strategyOwner && <TaskEditor
        key={(strategyOwner ?? 'guest') + ':' + (editingTaskId ?? 'new-' + (quickAddPrefill?.key ?? 0))}
        ownerId={strategyOwner} task={editingTaskId ? tasks.find(task => task.id === editingTaskId) : undefined}
        prefill={editingTaskId ? undefined : quickAddPrefill} tabs={tabs} skills={growth.skills} lang={lang}
        onCreate={(input, category) => handleAddTask(input, category) ? latestTasksRef.current[0] ?? true : false} onPatch={handlePatchTask}
        onReopenTask={id => { if (!handleReopenCompletedTask(id)) return false; setEditingTaskId(null); setIsAddOpen(false); return true; }}
        onRecordResult={id => { const task = latestTasksRef.current.find(task => task.id === id); if (!task || !openPracticeFinish(task, false)) return false; setEditingTaskId(null); setIsAddOpen(false); return true; }}
        onClose={() => { setIsAddOpen(false); setEditingTaskId(null); }} />}

      {/* Main Content Area */}
      <PageShell role="main" className="relative z-10 flex-1">
        {practiceFinish && practiceFinish.ownerId === strategyOwner && practiceFinish.generation === authGenerationRef.current && strategyReady && (() => {
          const skill = growth.skills.find(value => value.id === practiceFinish.skillId && value.deletedAt === undefined && value.archivedAt === undefined);
          const task = practiceFinish.taskId ? tasks.find(value => value.id === practiceFinish.taskId) : undefined;
          const session = task ? growth.sessions.filter(record => record.taskId === task.id && record.deletedAt === undefined).sort((a, b) => b.at - a.at)[0] : undefined;
          const measurement = session?.measurementId ? growth.measurements.find(record => record.id === session.measurementId && record.deletedAt === undefined) : undefined;
          return skill && (!practiceFinish.taskId || task) ? <div id="active-practice-result" className="pulse-inline-result"><PracticeFinishDialog
            key={strategyOwner + ':' + skill.id + ':' + (task?.id ?? 'measurement')}
            lang={lang} skill={skill} growth={growth} inline session={session} measurement={measurement}
            measurements={growth.measurements} task={task} measurementMode={practiceFinish.measurementMode}
            onSave={savePracticeResult} onClose={closePracticeFinish} onSkip={finishPracticeTask} /></div> : null;
        })()}
        {recoveryCandidate && <div role="status" className="mb-5 border border-amber-800 bg-amber-950/20 p-3 text-sm text-amber-200">
          <p>{lang === 'uk' ? `Знайдено збережений простір: ${recoveryCandidate.workspace.tasks.length} завдань, ${recoveryCandidate.workspace.tabs.length} категорій, ${recoveryCandidate.workspace.deletedTasks.length} в архіві.` : `Retained workspace found: ${recoveryCandidate.workspace.tasks.length} tasks, ${recoveryCandidate.workspace.tabs.length} categories, ${recoveryCandidate.workspace.deletedTasks.length} archived.`}</p>
          <button type="button" onClick={restoreRetainedWorkspace} className="mt-3 min-h-11 border border-amber-800 px-3">{lang === 'uk' ? 'Відновити збережений простір' : 'Restore retained workspace'}</button>
        </div>}
        {timerNotice && !(showSessionSummary && sessionSummary?.session.reason === 'countdownEnded') && <div role="status" className={`mb-5 flex flex-wrap items-center gap-3 border p-3 text-sm leading-relaxed ${timerNoticeCalm ? 'border-neutral-700 bg-neutral-950/80 text-neutral-200' : 'border-amber-800 bg-amber-950/20 text-amber-200'}`}>
          <span className="min-w-0 flex-1 break-words">{timerNotice}</span>
          <button type="button" onClick={() => openStrategyChat(lang === 'uk' ? `Обговорімо це повідомлення: ${timerNotice}` : `Discuss this notice: ${timerNotice}`)} className={`min-h-11 shrink-0 border px-3 text-xs ${timerNoticeCalm ? 'border-neutral-700' : 'border-amber-800'}`}>{lang === 'uk' ? 'ШІ-чат' : 'AI chat'}</button>
          <button type="button" aria-label={lang === 'uk' ? 'Закрити сповіщення' : 'Dismiss notification'} onClick={() => setTimerNotice(null)} className="flex h-11 w-11 shrink-0 items-center justify-center hover:bg-white/10"><X className="h-5 w-5" /></button>
        </div>}
        {!workspaceReady ? <p role="status" className="text-sm text-neutral-400">{syncError
          ? (lang === 'uk' ? 'Не вдалося безпечно завантажити простір. Дані збережено для відновлення.' : 'Could not safely load the workspace. Data was retained for recovery.')
          : (lang === 'uk' ? 'Завантажуємо ваш простір…' : 'Loading your workspace…')}</p> : selectedPhase === 'DASHBOARD' ? (
          <DashboardView
            tasks={operationalTasks}
            deletedTasks={deletedTasks}
            tabs={tabs}
            stats={stats}
            lang={lang}
            aiIconVariant={aiIconVariant}
            onSelectTab={(tabId) => setSelectedPhase(tabId)}
            onToggleDone={handleToggleDone}
            onOpenAI={(prompt) => {
              if (prompt) setAiPromptSeed(prompt);
              setAiSeedAsDraft(true);
              setIsAIOpen(true);
            }}
            onOpenAdd={() => setIsQuickAddOpen(true)}
            onOpenManageTabs={() => setIsManageTabsOpen(true)}
            onAddTask={handleAddTask}
          />
        ) : selectedPhase === 'STRATEGY' || selectedPhase === 'HISTORY' ? (
          strategyReady ? growthSetup ? <SkillSetup
            key={strategyOwner + ':' + (growthSetup.skillId ?? 'new')}
            lang={lang} growth={growth} skill={growth.skills.find(skill => skill.id === growthSetup.skillId)}
            initialTitle={growthSetup.initialTitle} onClose={() => setGrowthSetup(null)}
            onSaved={id => { setGrowthSetup(null); if (id) setRevealGrowthSkillId(id); }} />
          : <GrowthView key={strategyOwner + ':' + selectedPhase} lang={lang} growth={growth}
            tasks={[...tasks, ...deletedTasks]} initialTab="skills" revealSkillId={revealGrowthSkillId}
            onSetup={(skill, initialTitle) => { if (skill) setRevealGrowthSkillId(skill.id); setGrowthSetup({ skillId: skill?.id, initialTitle }); }}
            onPractice={(skill, subskillId, title, measurementMode) => { if (!handleGrowthPractice(skill, subskillId, title, true, measurementMode)) setActionNotice(GROWTH_INTEGRATION_STRINGS[lang].planFailed); }}
            onAddPractice={(skill, subskillId, title, measurementMode) => handleGrowthPractice(skill, subskillId, title, false, measurementMode)}
            onMeasure={skill => setPracticeFinish({ skillId: skill.id, measurementMode: true, ownerId: strategyOwner, generation: authGenerationRef.current })} />
          : <p role="status" className="text-sm text-neutral-400">{lang === 'uk' ? 'Завантажуємо ваш простір…' : 'Loading your workspace…'}</p>
        ) : selectedPhase === 'NOTES' ? (
          <NotepadView
            lang={lang}
            key={notesOwner === null ? 'guest' : `account:${notesOwner}`}
            ownerId={notesOwner}
            notes={notesOwner === strategyOwner ? notes : []}
            deletedNotes={notesOwner === strategyOwner ? deletedNotes : []}
            revealNoteId={revealNoteId}
            taskCategories={tabs}
            existingTaskSources={[...tasks, ...deletedTasks].flatMap(task => task.sourceNoteKey ? [task.sourceNoteKey] : [])}
            onCreateTasks={handleCreateNoteTasks}
            onOpenTasks={ids => { const first = ids.find(id => latestTasksRef.current.some(task => task.id === id)); if (first) handleRevealTask(first); }}
            searchQuery={noteSearchQuery} onSearchQueryChange={setNoteSearchQuery}
            onAddNote={handleAddNote}
            onUpdateNote={handleUpdateNote}
            onDeleteNote={handleDeleteNote}
            onRestoreNote={handleRestoreNote}
            onMakeTasks={note => openStrategyChat((lang === 'uk' ? 'Зроби задачі з нотатки «' : 'Make tasks from the note “') + (note.title || (lang === 'uk' ? 'Без назви' : 'Untitled')) + (lang === 'uk' ? '»:' : '”:') + '\n' + note.content)}
            storageError={notesStorageError}
          />
        ) : (
          <>
            <PageHead firstLine={new Date(insightNow).toLocaleDateString(lang === 'uk' ? 'uk-UA' : 'en-GB', { weekday: 'long' })}
              secondLine={new Date(insightNow).toLocaleDateString(lang === 'uk' ? 'uk-UA' : 'en-GB', { day: 'numeric', month: 'long' })}
              switcher={<CategorySwitcher tabs={tabs} lang={lang} selected={selectedPhase} total={listCounts.total} counts={listCounts.phaseCounts}
                labelOf={tab => tab.name || (t.phases as Record<string,string>)[tab.id]} onSelect={setSelectedPhase} onAdd={name => handleAddTab(name)} onManage={() => setIsManageTabsOpen(true)} />}
            />
            <PageGrid sidebarClassName="pulse-today-side" contentClassName="pulse-today-main" sidebar={<TodaySidebar tasks={operationalTasks} tabs={tabs} now={insightNow} lang={lang} summary={daySummaries.today}
              suggestion={strategyReady ? personalProfile.latestStrategy?.nextAction : undefined}
              skills={growth.skills} measurements={growth.measurements} sessions={growth.sessions} firstRun={todayFirstRun}
              onReveal={handleRevealTask} onDiscuss={openStrategyChat}
              onAddPractice={(skill, subskillId, title) => { if (!handleGrowthPractice(skill, subskillId, title, false)) setActionNotice(GROWTH_INTEGRATION_STRINGS[lang].planFailed); }}
              onSetupSkill={initialTitle => { setSelectedPhase('STRATEGY'); setGrowthSetup({ initialTitle }); }}
              onCloseDay={() => { if (dayRecapReady) setDayClose({ owner: strategyOwner, date: daySummaries.today.date }); }} />}>
              {todayFirstRun && quickAddVisible && <section className="pulse-first-card"><span>{lang === 'uk' ? 'Почнімо' : 'Let’s begin'}</span><h2>{lang === 'uk' ? 'Що зробите сьогодні?' : 'What will you do today?'}</h2></section>}
              {quickAddVisible && <>              {!searchQuery && !todayFirstRun && <NowStrip
                key={`now:${currentUser?.uid ?? 'guest'}`}
                tasks={operationalTasks}
                lang={lang}
                now={insightNow}
                todaySummary={daySummaries.today} dayClosed={isDayClosed} offerDayClose={offerDayClose} recap={yesterdayRecap}
                onContinueDay={() => { if (continueDayIfClosed()) quickAddInputRef.current?.focus({ preventScroll: true }); }}
                recapNote={dayRecapReady ? dayLogState.value.closed[daySummaries.yesterday.date]?.note : undefined}
                onOpenDayClose={() => { if (dayRecapReady) setDayClose({ owner: strategyOwner, date: daySummaries.today.date }); }}
                onDismissRecap={() => saveDayLog({ ...dayLogState.value, recapDismissed: daySummaries.today.date })}
                onReveal={handleRevealTask}
                onStart={handleStartTask} onPause={handleToggleTimer} onComplete={handleToggleDone} tabs={tabs}
                onMoveDeadline={(task, newDate) => handleEditTask(task.id, task.title, task.note || '', {
                  title: task.title, note: task.note || '', plannedDate: task.plannedDate, deadlineDate: task.deadlineDate,
                }, {
                  plannedDate: task.plannedDate && task.plannedDate <= newDate ? task.plannedDate : undefined,
                  deadlineDate: newDate,
                })}
              />}
              <QuickAddLine
                key={`quick-add:${currentUser?.uid ?? 'guest'}`}
                tabs={tabs}
                skills={growth.skills}
                selectedPhase={selectedPhase}
                lang={lang}
                now={insightNow}
                inputRef={quickAddInputRef}
                onAdd={handleAddTask}
                onMoreOptions={values => {
                  setQuickAddPrefill({ ...values, key: ++quickAddPrefillKey.current });
                  setIsAddOpen(true);
                }}
              />

</>}
                          {scheduledPlans.length > 0 && <details className="pulse-scheduled-plans" open>
              <summary className="cursor-pointer text-sm font-semibold text-neutral-200">{lang === 'uk' ? 'Заплановані завдання' : 'Scheduled tasks'} ({scheduledPlans.length})</summary>
              <p className="mt-2 text-sm leading-relaxed text-neutral-400">{lang === 'uk' ? 'З’являться в черзі перед зазначеним часом. Сповіщення працюють, поки Karkas відкритий або в треї.' : 'Added to the queue before the scheduled time. Notifications require Karkas open or running in the tray.'}</p>
              <div className="mt-3 divide-y divide-neutral-800">{scheduledPlans.map(plan => <div key={plan.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1"><p className="break-words text-base font-semibold text-neutral-100">{plan.title}</p><p className="mt-1 break-words text-sm leading-relaxed text-emerald-300">{plan.schedule ? describeSchedule(plan.schedule, lang, plan.scheduleNextStartAt) : (lang === 'uk' ? 'Розклад некоректний — уточніть його через AI' : 'Invalid schedule — update it through AI')}</p></div>
                <button type="button" onClick={() => { handleDelete(plan.id); setActionNotice(lang === 'uk' ? 'Розклад скасовано. Його можна відновити з кошика.' : 'Schedule cancelled. You can restore it from trash.'); }} className="min-h-11 border border-neutral-700 px-3 text-sm text-neutral-300 hover:border-neutral-400 hover:text-white">{lang === 'uk' ? 'Скасувати розклад' : 'Cancel schedule'}</button>
              </div>)}</div>
            </details>}

            {/* Empty State */}
            {filteredTasks.length === 0 && !!searchQuery && (
              <div className="pulse-empty-state">
                <div className="pulse-empty-icon" aria-hidden="true">
                  <Search size={28} aria-hidden="true" />
                </div>
                <div className="pulse-empty-copy">
                  <h2>{lang === 'uk' ? 'Завдань не знайдено' : 'No tasks found'}</h2>
                  <p>{lang === 'uk' ? `За запитом "${searchQuery}" нічого не знайдено` : `No tasks matching "${searchQuery}"`}</p>
                </div>
                <div className="pulse-empty-actions">
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="pulse-empty-button"
                  >
                    {lang === 'uk' ? 'Очистити пошук' : 'Clear search'}
                  </button>
                  {activeFilter !== 'ALL' && (
                    <button
                      type="button"
                      id="empty-show-all-filter-btn"
                      onClick={() => {
                        sound.tick(600);
                        setActiveFilter('ALL');
                      }}
                      className="pulse-empty-button"
                    >
                      {lang === 'uk' ? 'Показати всі завдання' : 'Show all tasks'}
                    </button>
                  )}
                  {selectedPhase !== 'ALL' && (
                    <button
                      type="button"
                      id="empty-show-all-phase-btn"
                      onClick={() => {
                        sound.tick(600);
                        setSelectedPhase('ALL');
                      }}
                      className="pulse-empty-button"
                    >
                      {lang === 'uk' ? 'Усі категорії' : 'All categories'} ({stats.total})
                    </button>
                  )}
                  <button
                    type="button"
                    id="empty-add-btn"
                    onClick={() => setIsQuickAddOpen(true)}
                    className="pulse-empty-button pulse-empty-button--primary"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{lang === 'uk' ? 'Додати завдання' : 'Add task'}</span>
                  </button>
                </div>
              </div>
            )}

            {dayShiftNotice && dayShiftNotice.ownerId === workspaceOwnerRef.current ? <div role="status" className="mb-4 flex flex-wrap items-center gap-3 border border-neutral-700 bg-neutral-900/70 px-4 py-3 text-sm text-neutral-200">
              <span className="min-w-0 whitespace-pre-line break-words">{dayShiftNotice.text}</span>
              {dayShiftNotice.undoToken && <button type="button" onClick={() => void handleUndoDayShift()} className="min-h-11 px-3 underline focus-visible:outline-2 focus-visible:outline-white">{lang === 'uk' ? 'Скасувати' : 'Undo'}</button>}
              <button type="button" onClick={() => setDayShiftNotice(null)} className="min-h-11 px-3 text-neutral-400 hover:text-white">{lang === 'uk' ? 'Закрити' : 'Dismiss'}</button>
            </div> : dayDelay.minutes > 0 && <div className="pulse-delay-card flex flex-wrap items-center justify-between gap-3 text-sm">
              <p className="text-amber-200">{missedBlockCount > 1
                ? lang === 'uk' ? `${missedBlockCount} ${missedBlockCount % 10 === 1 && missedBlockCount % 100 !== 11 ? 'блок' : missedBlockCount % 10 >= 2 && missedBlockCount % 10 <= 4 && (missedBlockCount % 100 < 12 || missedBlockCount % 100 > 14) ? 'блоки' : 'блоків'} вже в минулому` : `${missedBlockCount} blocks are already in the past`
                : lang === 'uk' ? `Ти відстаєш від плану на ${dayDelay.minutes} хв` : `Your plan is ${dayDelay.minutes} min behind`}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void handleReplanDay()} className="min-h-11 bg-white px-3 py-2 font-medium text-black hover:bg-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
                  {lang === 'uk' ? 'Перебудувати решту дня від зараз' : 'Replan the rest of today from now'}
                </button>
                {dayDelay.tasks.length > 0 && <button type="button" onClick={() => void handleShiftDay()} className="min-h-11 border border-neutral-700 px-3 py-2 text-neutral-200 hover:border-white hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
                  {lang === 'uk' ? `Посунути на +${dayDelay.minutes} хв` : `Shift by +${dayDelay.minutes} min`}
                </button>}
              </div>
            </div>}
            {/* Tasks List */}
            <div className="flex flex-col gap-2.5">
              <AnimatePresence initial={false}>
                {pulseTasks.map((task, index) => (
                  <motion.div
                    key={task.id}
                    id={'task-wrapper-' + task.id}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -100, transition: { duration: 0.18 } }}
                    transition={{ duration: 0.2 }}
                  >
                    {(index === 0 || (isPracticeTask(task) && !task.done) !== (isPracticeTask(pulseTasks[index - 1]) && !pulseTasks[index - 1].done)) && <h2 className="pulse-list-title">{isPracticeTask(task) && !task.done ? (lang === 'uk' ? 'Практика' : 'Practice') : (lang === 'uk' ? 'Справи' : 'Tasks')}</h2>}
                    <TodayTaskRow task={task} tabs={tabs} lang={lang} now={insightNow}
                      skillName={task.skillId ? growth.skills.find(skill => skill.id === task.skillId)?.title : undefined}
                      onToggleDone={handleToggleDone} onStart={handleStartTask} onDelete={handleDelete}
                      onPause={handleToggleTimer} onEdit={setEditingTaskId} onToggleStep={handleToggleStepItem}
                      onRecordResult={id => { const record = latestTasksRef.current.find(task => task.id === id); if (record) openPracticeFinish(record, false); }}
                      onOpenSource={id => { setRevealNoteId(id); setNoteSearchQuery(''); setSelectedPhase('NOTES'); }}
                      onRename={(id, title) => { const current = latestTasksRef.current.find(item => item.id === id); return !!current && handleEditTask(id, title, current.note || '', { title: current.title, note: current.note || '', plannedDate: current.plannedDate, deadlineDate: current.deadlineDate }); }}
                      onMove={(moved, date) => {
                        if (!moved.scheduledFor) {
                          if (!handlePatchTask(moved.id, { plannedDate: date }, { plannedDate: moved.plannedDate })) {
                            setActionNotice(lang === 'uk' ? 'Дату не збережено. Перевірте дедлайн або новіші зміни завдання.' : 'Date not saved. Check the deadline or newer task changes.');
                          }
                          return;
                        }
                        // A timed task keeps its clock time on the new day.
                        const at = moved.scheduledFor ? new Date(moved.scheduledFor) : null;
                        const startTime = at ? String(at.getHours()).padStart(2, '0') + ':' + String(at.getMinutes()).padStart(2, '0') : undefined;
                        void handleScheduleActions([{ type: 'update_task', taskId: moved.id, plannedDate: date, ...(startTime ? { date, startTime } : {}) }])
                          .catch(error => setActionNotice(error instanceof Error ? error.message : (lang === 'uk' ? 'Не вдалося перенести задачу.' : 'Could not move the task.')));
                      }} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
            <div className="pulse-archive-shortcut"><button type="button" onClick={() => { setIsSettingsOpen(true); setArchiveOpen(true); }}>{lang === 'uk' ? 'Архів у налаштуваннях' : 'Archive in settings'} · {retainedCompletedTasks.length}</button></div>
            </PageGrid>
          </>
        )}

        {/* Undo Toast if item was deleted */}
        <AnimatePresence>
          {recentlyDeleted && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20, transition: { duration: 0.15 } }}
              className="pulse-delete-toast"
            >
              <div className="flex items-start justify-between gap-3">
              <span className="text-neutral-300 break-words" role="status">
                {t.opRemoved} "{recentlyDeleted.title.slice(0, 26)}{recentlyDeleted.title.length > 26 ? '...' : ''}"
              </span>
              <button
                type="button"
                onClick={() => setRecentlyDeleted(null)}
                className="min-w-11 min-h-11 shrink-0 text-neutral-400 hover:text-white cursor-pointer transition-colors"
                aria-label={lang === 'uk' ? 'Закрити повідомлення' : 'Dismiss notification'}
              >
                <X className="w-5 h-5 mx-auto" />
              </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
              <button
                id="undo-delete-btn"
                onClick={handleUndoDelete}
                className="min-h-11 px-3 text-white font-bold underline hover:text-neutral-300 cursor-pointer"
              >
                {lang === 'uk' ? 'Скасувати' : 'Undo'}
              </button>
              <span className="pulse-delete-hint">{lang === 'uk' ? 'Далі — Налаштування → Архів' : 'Then — Settings → Archive'}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </PageShell>
      {workPlanTask && timerWorkspaceReadyRef.current && workspaceOwnerRef.current === (currentUser?.uid || null) && <TaskWorkPlanDialog key={`${currentUser?.uid || 'guest'}:${workPlanTask.id}`} task={workPlanTask} lang={lang} onClose={() => setWorkPlanTaskId(null)} onSave={saveWorkPlan} />}

      {dayClose && dayRecapReady && dayClose.owner === strategyOwner && dayClose.date === daySummaries.today.date && <DayCloseDialog
        key={strategyOwner + ':' + dayClose.date} summary={daySummaries.today} candidates={dayCarryOver} lang={lang}
        onClose={() => setDayClose(null)} onConfirm={handleCloseDay} />}

      {showSessionSummary && sessionSummary && summaryTask && <SessionSummaryCard
        key={sessionSummary.session.taskId + ':' + sessionSummary.session.endedAt + ':' + (sessionSummary.session.sessionId ?? '')}
        session={sessionSummary.session} task={summaryTask} allTasks={tasks} now={sessionSummary.shownAt} lang={lang}
        onDismiss={dismissSessionSummary} onStart={handleStartTask} onResume={handleStartTask}
        onPlanTomorrow={handlePlanTomorrow} onFinishAfterExpiry={id => { setTimerNotice(null); handleFinishAfterExpiry(id); }}
        onContinueTenMinutes={id => { setTimerNotice(null); handleContinueSummaryCountdown(id); }} onReopen={handleReopenCompletedTask} onComplete={handleToggleDone} />}

      <AIIsland lang={lang} isOpen={isAIOpen} onOpen={() => { sound.activate(); setAiPromptSeed(''); setIsAIOpen(true); }} />
      {strategyReady && <GrowthFeedback key={strategyOwner ?? 'guest'} growth={growth} lang={lang}
        onNewSkill={skill => { setSelectedPhase('STRATEGY'); setGrowthSetup({ initialTitle: skill.title }); }} />}

      {/* AI Assistant HUD Sheet */}
      <AIAssistantSheet
        isOpen={isAIOpen && strategyReady}
        contextLine={aiContextLine}
        lang={lang}
        tabs={tabs}
        onClose={() => setIsAIOpen(false)}
        currentTasks={tasks}
        deletedTasks={deletedTasks}
        notes={notesOwner === strategyOwner ? notes : []}
        onGetAgentWorkspace={handleGetAgentWorkspace}
        onApplyAgentActions={handleApplyAgentActions}
        onUndoAgentActions={handleUndoAgentActions}
        stats={stats}
        adaptiveProfile={adaptiveProfile}
        initialPrompt={aiPromptSeed}
        initialPromptAsDraft={aiSeedAsDraft}
        aiIconVariant={aiIconVariant}
        accountId={currentUser?.uid ?? null}
        strategyProfile={strategyReady ? personalProfile : undefined}
        onChatWelcome={handleChatWelcome} onStrategyResponse={handleStrategyResponse} onUndoStrategy={handleUndoStrategy}
        onDeepenDiscovery={deepenPersonalDiscovery}
        onInjectTasks={handleInjectAITasks}
      />

      {/* Manage Tabs Modal */}
      <ManageTabsModal
        isOpen={isManageTabsOpen}
        keyboardEnabled={!tabToDeleteConfirm}
        tabs={tabs}
        lang={lang}
        onClose={() => setIsManageTabsOpen(false)}
        onAddTab={handleAddTab}
        onDeleteTab={handleDeleteTab}
        onSetPresetTabs={handleSetPresetTabs}
        onUpdateTabColor={handleUpdateTabColor}
        onRenameTab={handleRenameTab}
        tabCounts={stats.phaseCounts}
        aiContext={{
          goals: personalProfile.goals.map((goal) => goal.title).filter(Boolean),
          facts: [...personalProfile.facts, ...personalProfile.preferences].map((entry) => entry.text).filter(Boolean),
          taskTitles: tasks.filter((task) => !task.done && !task.scheduledPending).map((task) => task.title),
        }}
      />

      {/* Google Account & Cloud Backup Modal */}
      {isAccountOpen && <div className="ac-overlay" role="region" aria-label={lang === 'uk' ? 'Акаунт' : 'Account'}>
        <AccountView key={currentUser?.uid ?? 'guest'} lang={lang}
          completedTaskCount={completedHistoryCount}
          user={currentUser ? { id: currentUser.uid, name: currentUser.displayName || currentUser.email || (lang === 'uk' ? 'Акаунт' : 'Account'), email: currentUser.email, avatarUrl: accountAvatarUrl } : null}
          onAvatarChange={setAccountAvatarUrl}
          isSyncing={isSyncing} syncStatus={syncStatus} syncError={syncError} autoSyncEnabled={autoSyncEnabled}
          counts={{ tasks: tasks.length, skills: growth.skills.filter(skill => skill.deletedAt === undefined).length,
            measurements: growth.measurements.filter(item => item.deletedAt === undefined).length, notes: notes.length }}
          onLogin={handleLoginWithGoogle} onLogout={handleLogout} onSyncNow={handleSyncNow} onRestoreFromCloud={handleRestoreFromCloud}
          onToggleAutoSync={handleToggleAutoSync} onClose={() => setIsAccountOpen(false)} />
      </div>}

      {/* System Update Modal */}
      <UpdateModal
        isOpen={isUpdateOpen}
        onClose={() => setIsUpdateOpen(false)}
        lang={lang}
        currentVersion={appCurrentVersion}
        isVersionKnown={isAppVersionKnown}
        onCheckAgain={async () => {
          const desktop = window.karkasDesktop;
          if (!desktop) return;
          try {
            const version = await desktop.system.getAppVersion();
            if (version.ok && isValidAppVersion(version.value)) {
              setAppCurrentVersion(version.value.trim());
              setIsAppVersionKnown(true);
            } else setIsAppVersionKnown(false);
          } catch { setIsAppVersionKnown(false); }
        }}
      />

      {/* Device-local application settings */}
      {isSettingsOpen && <div className="st-overlay" role="region" aria-label={lang === 'uk' ? 'Налаштування' : 'Settings'}>
        {archiveOpen ? <ArchiveView lang={lang} items={archiveItems} onBack={() => setArchiveOpen(false)} onRestore={handleRestoreArchive} onDeletePermanently={handlePurgeArchive} />
        : <SettingsView lang={lang} zoomPercent={appZoomPercent} minZoom={MIN_APP_ZOOM} maxZoom={MAX_APP_ZOOM} defaultZoom={DEFAULT_APP_ZOOM}
          onOpenArchive={() => setArchiveOpen(true)} archiveCount={archiveItems.filter(item => item.status !== 'deleted' || (item.undoUntil ?? item.at + 8000) <= insightNow).length}
          onZoomChange={value => setAppZoomPercent(normalizeAppZoom(value))}
          launchAtStartup={launchAtStartup} startupPending={startupPending} onLaunchAtStartupChange={handleLaunchAtStartupChange}
          soundEnabled={soundEnabled} onToggleSound={handleToggleSound} motionEnabled={motionEnabled} onToggleMotion={() => setMotionEnabled(value => !value)}
          onSetLang={next => { if (next !== lang) handleToggleLang(); }}
          appVersion={appCurrentVersion}
          onCheckUpdate={async () => {
            const res = await karkasApiFetch('/api/check-update');
            if (!res.ok) throw new Error('update check failed');
            const data = await res.json();
            return data && data.tag_name && !data.draft && !data.prerelease && isNewerAppVersion(data.tag_name, appCurrentVersion) ? String(data.tag_name) : null;
          }}
          onOpenUpdates={() => { setIsSettingsOpen(false); setIsUpdateOpen(true); }}
          aiConnected={(() => { try { return localStorage.getItem('karkas_custom_ai_enabled') === 'true'; } catch { return false; } })()}
          onOpenAI={() => { setIsSettingsOpen(false); setIsAIOpen(true); }}
          account={currentUser ? { name: currentUser.displayName || currentUser.email || (lang === 'uk' ? 'Акаунт' : 'Account'),
            avatarUrl: accountAvatarUrl,
            detail: [currentUser.email, lastSyncTime ? (lang === 'uk' ? 'синхронізовано ' : 'synced ') + formatSyncAgo(lastSyncTime, lang) : ''].filter(Boolean).join(' · ') } : null}
          onSync={() => { void handleSyncNow(); }} onLogout={() => { void handleLogout(); }}
          onLogin={() => { setIsSettingsOpen(false); setIsAccountOpen(true); }}
          onClose={() => { setIsSettingsOpen(false); setArchiveOpen(false); }} />}
      </div>}

      {/* Automated Update Detection Prompt Banner */}
      <AnimatePresence>
        {availableNewRelease && !isUpdateOpen && (
          <motion.div
            initial={{ opacity: 0, y: -25 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -25 }}
            className="fixed top-3.5 left-1/2 -translate-x-1/2 z-50 bg-[#09090c]/95 border border-emerald-500/70 shadow-2xl px-4 py-2.5 flex items-center gap-3 font-sans text-xs backdrop-blur-md app-no-drag"
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
              id="tab-delete-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="tab-delete-confirm-title"
              className="w-full max-w-md bg-[#0c0c0e] border border-neutral-800 shadow-2xl p-5 sm:p-6 flex flex-col gap-4 text-neutral-100 font-sans"
            >
              <div className="flex items-center justify-between border-b border-neutral-800/80 pb-3">
                <div className="flex items-center gap-2">
                  <Trash className="w-4 h-4 text-red-400 shrink-0" />
                  <h3 id="tab-delete-confirm-title" className="text-xs font-bold tracking-wider uppercase text-neutral-200">
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
    </div></MotionConfig>
  );
}
