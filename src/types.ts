import type { WorkspaceSyncOperation } from './utils/syncOperations';

export interface TaskTab {
  id: string;
  name: string;
  color?: string;
}

export type PSPhase = string;

export interface TaskStepItem {
  id: string;
  title: string;
  done: boolean;
  timeSpentSeconds?: number; // Only work measured while this step was active; missing means unknown.
  estimatedDurationSeconds?: number; // Optional explicit estimate, never inferred from total task time.
}

export type TimerMode = 'none' | 'stopwatch' | 'countdown';

export interface AITimerSettings {
  timerMode?: TimerMode;
  countdownDurationSeconds?: number;
  timerAction?: 'start' | 'pause' | 'stop';
}

export interface TaskSchedule {
  startAt: string; // ISO timestamp with explicit UTC offset
  recurrence: 'once' | 'daily';
  timeZone: string; // IANA zone; daily occurrences preserve local wall-clock time
  leadMinutes: number; // Add the occurrence this many minutes before its start
}

export interface PSTask {
  id: string;
  title: string;
  phase: string; // Dynamic tab/category ID
  priority: 1 | 2 | 3; // 1: Urgent (Red), 2: Standard (Yellow), 3: Low (Green)
  steps: number; // Zero means the task has no subtasks
  currentStep: number; // 0 to steps
  stepList?: TaskStepItem[]; // Optional list of custom steps with descriptions
  done: boolean;
  pinned: boolean;
  note?: string;
  createdAt: number;
  schedule?: TaskSchedule;
  scheduledPending?: boolean; // Future plan template, excluded from work statistics
  scheduledFor?: number; // Planned start of materialized occurrence
  schedulePlanId?: string; // Stable parent template ID
  scheduleNextStartAt?: string; // Persisted daily cursor, original schedule remains the wall-time anchor
  startedAt?: number; // First explicit start of work; preserved through pauses and reopening
  completedAt?: number;
  timerMode?: TimerMode; // Missing on legacy tasks: countdown if configured, otherwise stopwatch
  timeSpentSeconds?: number; // Total accumulated seconds spent on this task
  timeResetAt?: number; // Epoch of the last explicit reset; older offline timer deltas do not restore reset time.
  timerSessionId?: string; // Stable across devices observing the same running timer.
  timeSessions?: Record<string, { seconds: number; stepId?: string }>; // Maximum banked duration of each session.
  plannedDurationSeconds?: number; // First explicit countdown estimate; extensions do not rewrite it.
  timerStepId?: string; // Step owning this measured session; legacy sessions have no attribution.
  timerRunning?: boolean; // Is stopwatch currently active
  timerStartedAt?: number; // Timestamp (ms) when current stopwatch session started
  countdownDurationSeconds?: number; // Configured focus session duration
  countdownRemainingSeconds?: number; // Remaining at the last start/pause; live elapsed is derived
  autoPausedOverdue?: boolean; // Timer was auto-paused due to session cap or inactivity safeguard
}

export type NewTaskInput = Pick<PSTask, 'title' | 'phase' | 'priority' | 'steps'> &
  Partial<Pick<PSTask, 'stepList' | 'note' | 'timerMode' | 'countdownDurationSeconds' | 'plannedDurationSeconds' | 'schedule'>>;

export interface DeletedTask extends PSTask {
  deletedAt: number;
  deletionReason?: 'accidental' | 'cancelled'; // Missing on legacy records: intent is unknown.
}

export interface NotepadNote {
  id: string;
  title: string;
  content: string;
  color?: string;
  createdAt: number;
  updatedAt?: number;
  pinned?: boolean;
}

export type NoteSortOption = 'NEWEST' | 'OLDEST' | 'DATE';

export type FilterMode = 'ALL' | 'ACTIVE' | 'DONE';

export interface WorkflowStats {
  total: number;
  completed: number;
  percent: number;
  phaseCounts: Record<string, number>;
}

export interface AdaptiveProfile {
  trackedTasks: number;
  completedTasks: number;
  completionRate: number;
  averageCompletionMinutes: number | null;
  averageStepCount: number;
  preferredPhases: string[];
  overloadedPhases: string[];
  activeLoad: number;
  urgentLoad: number;
  recommendedActiveLimit: number;
}

export interface SuggestedTask {
  title: string;
  phase: string;
  priority: 1 | 2 | 3;
  steps: number;
  note: string;
  reason?: string;
}

export interface AITaskUpdate extends AITimerSettings {
  schedule?: TaskSchedule;
  id: string;
  title?: string;
  phase?: string;
  priority?: 1 | 2 | 3;
  steps?: number;
  stepList?: { id?: string; title: string; done?: boolean }[];
  done?: boolean;
  note?: string;
}

export interface AIDeletedTaskRef {
  id: string;
  reason?: string;
  deletionReason?: 'accidental' | 'cancelled';
}

export interface AIResponse {
  strategy?: AIStrategyResponse;
  summary: string;
  insights?: string[];
  reply?: string;
  tasks?: (AITimerSettings & {
    schedule?: TaskSchedule;
    title: string;
    phase: string;
    priority: 1 | 2 | 3;
    steps: number;
    stepList?: { id?: string; title: string; done?: boolean }[];
    note?: string;
  })[];
  tabs?: {
    id: string;
    name: string;
    color?: string;
  }[];
  taskUpdates?: AITaskUpdate[];
  taskDeletions?: AIDeletedTaskRef[];
  workloadDiagnosis?: {
    status?: string;
    bottlenecks?: string[];
    strengths?: string[];
    recommendedLimit?: number;
  };
  categoryHealth?: {
    phase: string;
    phaseName: string;
    taskCount: number;
    status: 'balanced' | 'overloaded' | 'empty' | 'stagnant';
    recommendation?: string;
  }[];
  source?: string;
  analyzedContext?: {
    activeCount: number;
    completedCount: number;
    tabsCount: number;
  };
}

export type AIIntent = 'auto' | 'plan' | 'analysis' | 'steps';
export interface StrategyMemoryEntry {
  id: string;
  text: string;
  source: 'user' | 'hypothesis';
  messageId?: string;
  /** Full user statement, retained so an extracted phrase cannot lose its negation. */
  quote?: string;
}
export type StrategyDiscoveryTopic = 'direction' | 'motivation' | 'circumstances' | 'barriers' | 'capacity' | 'attempts';
export interface StrategyDiscoveryEvidence { quote: string; messageId: string; }
export interface StrategyDiscoveryTopicState {
  status: 'unknown' | 'answered' | 'deferred';
  evidence: StrategyDiscoveryEvidence[];
}
export interface StrategyDiscoveryQuestion { id: string; topic: StrategyDiscoveryTopic; text: string; turnId?: string; }
export interface StrategyDiscoverySummary { id: string; goalIds: string[]; fingerprint: string; text: string; confirmed: boolean; }
export interface StrategyDiscoveryState {
  version: 1;
  topics: Record<StrategyDiscoveryTopic, StrategyDiscoveryTopicState>;
  selectedGoalIds: string[];
  pendingQuestion?: StrategyDiscoveryQuestion;
  pendingSummary?: StrategyDiscoverySummary;
  processedTurnIds: string[];
  /** Derived locally; never trusted from an AI response. */
  phase: 'exploring' | 'confirming' | 'ready';
}
export interface StrategyDiscoveryPatch {
  answers?: { topic: StrategyDiscoveryTopic; status: 'answered' | 'deferred'; quote: string }[];
  selectedGoalIds?: string[];
  question?: { topic: StrategyDiscoveryTopic; text: string };
  summary?: string;
}
export interface StrategyGoal {
  id: string;
  title: string;
  motive: string;
  agreed: boolean;
  taskIds: string[];
  categoryIds: string[];
}
export interface StrategyAction {
  id: string;
  goalId: string;
  reason: string;
  type: 'create' | 'update';
  taskId?: string;
  expectedTask?: Partial<PSTask>;
  changes: Partial<Pick<PSTask, 'title' | 'phase' | 'priority' | 'note' | 'schedule'>> & {
    stepTitles?: string[];
  };
}
export interface StrategyActionRecord {
  id: string;
  turnId: string;
  ownerId: string;
  goalId: string;
  reason: string;
  taskId: string;
  before: PSTask | null;
  after: PSTask;
  appliedAt: number;
  undoneAt?: number;
}
export interface StrategyMemoryPatch {
  goals?: StrategyGoal[];
  facts?: StrategyMemoryEntry[];
  barriers?: StrategyMemoryEntry[];
  preferences?: StrategyMemoryEntry[];
  onboardingStatus?: 'new' | 'in_progress' | 'complete';
  phase?: string;
  discovery?: StrategyDiscoveryPatch;
}
export interface AIStrategyResponse {
  status?: 'getting_to_know' | 'clarifying' | 'ready';
  question?: string;
  narrative?: string;
  nextAction?: string;
  focusTaskId?: string;
  memoryPatch?: StrategyMemoryPatch;
  actions?: StrategyAction[];
}
export interface PersonalStrategyProfile {
  version: 1;
  onboardingStatus: 'new' | 'in_progress' | 'complete';
  phase: string;
  goals: StrategyGoal[];
  facts: StrategyMemoryEntry[];
  barriers: StrategyMemoryEntry[];
  preferences: StrategyMemoryEntry[];
  latestStrategy?: AIStrategyResponse & { updatedAt: number; source?: string };
  feedback: { id: string; text: string; createdAt: number }[];
  actionHistory: StrategyActionRecord[];
  processedTurnIds: string[];
  discovery?: StrategyDiscoveryState;
  reminders: { enabled: boolean; times: string[]; maxPerDay: 2 };
}

export type AnalyticsPeriod = 'ALL_TIME' | 'THIS_YEAR' | 'LAST_YEAR' | 'THIS_MONTH' | 'LAST_30_DAYS';

export interface AIRecommendation {
  focusAdvice: string;
  optimizationTip: string;
  workloadStatus: string;
  suggestedTasks: SuggestedTask[];
  source?: 'gemini' | 'engine';
  periodRetrospective?: string;
  dropoffAnalysis?: string;
  futureStrategy?: string;
  productivityGrade?: string;
}

declare global {
  type DesktopResult<T> =
    | { ok: true; value: T }
    | { ok: false; error: { code: string; message: string } };

  interface DesktopWindowState {
    maximized: boolean;
    visible: boolean;
  }

  interface DesktopAccountSnapshot {
    workspace: {
      tasks: PSTask[];
      tabs: TaskTab[];
      deletedTasks: DeletedTask[];
      settings: { soundEnabled: boolean; fireEnabled: boolean; lang: string; aiIconVariant: string };
    };
    base?: DesktopAccountSnapshot['workspace'] | null;
    operations?: WorkspaceSyncOperation[];
    lastSyncTime?: number | null;
    recovery?: DesktopAccountSnapshot['workspace'] | null;
    syncClientId?: string;
    nextSyncSequence?: number;
    pendingSync?: DesktopPendingSync | null;
    inFlightSync?: DesktopPendingSync | null;
  }

  interface DesktopPendingSync {
    mutationId: string;
    clientId: string;
    sequence: number;
    createdAt: number;
    attempts: number;
    nextAttemptAt: number;
    lastError?: string;
    workspace: DesktopAccountSnapshot['workspace'];
    base?: DesktopAccountSnapshot['workspace'] | null;
  }

  interface DesktopPreferences {
    zoomPercent?: number;
    launchAtStartup?: boolean;
    window?: { bounds?: { x: number; y: number; width: number; height: number }; maximized?: boolean };
    [key: string]: unknown;
  }

  interface Window {
    karkasDesktop?: {
      isDesktop: true;
      window: {
        minimize: () => void;
        toggleMaximize: () => void;
        hide: () => void;
        quit: () => Promise<DesktopResult<void>>;
        getState: () => Promise<DesktopResult<DesktopWindowState>>;
        setZoomFactor: (factor: number) => void;
        onStateChanged: (callback: (state: DesktopWindowState) => void) => () => void;
        onCommand: (callback: (command: 'new-task' | 'open-settings') => void) => () => void;
      };
      workspace: {
        loadAccount: (ownerId: string | null) => Promise<DesktopResult<DesktopAccountSnapshot | null>>;
        saveAccount: (input: { ownerId: string | null; record: DesktopAccountSnapshot }) => Promise<DesktopResult<void>>;
        getActiveOwner: () => Promise<DesktopResult<string | null>>;
        setActiveOwner: (ownerId: string | null) => Promise<DesktopResult<void>>;
        createRecoveryPoint: (ownerId: string | null) => Promise<DesktopResult<void>>;
        stageSync: (input: { ownerId: string; workspace: DesktopAccountSnapshot['workspace']; base?: DesktopAccountSnapshot['workspace'] | null; operations?: WorkspaceSyncOperation[] }) => Promise<DesktopResult<DesktopPendingSync>>;
        claimSync: (ownerId: string, bypassBackoff?: boolean) => Promise<DesktopResult<DesktopPendingSync | null>>;
        markSyncFailed: (input: { ownerId: string; mutationId: string; message: string }) => Promise<DesktopResult<DesktopPendingSync | null>>;
        acknowledgeSync: (input: { ownerId: string; mutationId: string; base: DesktopAccountSnapshot['workspace']; lastSyncTime: number }) => Promise<DesktopResult<{ acknowledged: boolean; pending: DesktopPendingSync | null }>>;
        replaceWithCloud: (input: { ownerId: string; workspace: DesktopAccountSnapshot['workspace']; lastSyncTime: number }) => Promise<DesktopResult<DesktopAccountSnapshot>>;
      };
      preferences: {
        get: () => Promise<DesktopResult<DesktopPreferences>>;
        update: (changes: DesktopPreferences) => Promise<DesktopResult<DesktopPreferences>>;
      };
      auth: {
        loginWithGoogle: () => Promise<DesktopResult<{ success: boolean; idToken?: string; accessToken?: string; error?: string }>>;
      };
      ai: {
        hasKey: () => Promise<DesktopResult<boolean>>;
        verifyAndStoreKey: (apiKey: string) => Promise<DesktopResult<{ models: string[] }>>;
        clearKey: () => Promise<DesktopResult<void>>;
        assist: (input: unknown) => Promise<DesktopResult<{ status: number; body: any }>>;
        breakdown: (input: unknown) => Promise<DesktopResult<{ status: number; body: any }>>;
        recommendations: (input: unknown) => Promise<DesktopResult<{ status: number; body: any }>>;
        voiceToken: (input: unknown) => Promise<DesktopResult<{ status: number; body: any }>>;
        transcribeAudio: (input: unknown) => Promise<DesktopResult<{ status: number; body: any }>>;
        cancelRequest: (requestId: string) => Promise<DesktopResult<{ cancelled: boolean }>>;
      };
      updates: {
        checkLatest: () => Promise<DesktopResult<{ status: number; body: any }>>;
        downloadAndInstall: (input: { url: string; fileName?: string; requestId: string }) => Promise<DesktopResult<void>>;
        cancelDownload: (requestId: string) => Promise<DesktopResult<{ cancelled: boolean; phase: 'idle' | 'installing' }>>;
        onInstallStateChanged: (callback: (state: { requestId: string; phase: 'downloading' | 'installing' }) => void) => () => void;
      };
      system: {
        getAppVersion: () => Promise<DesktopResult<string>>;
        openExternal: (url: string) => Promise<DesktopResult<void>>;
        showNotification: (input: { title: string; body: string; target?: { view: 'STRATEGY'; ownerId: string | null; taskId?: string } }) => Promise<DesktopResult<void>>;
        onNotificationClick: (callback: (target: { view: 'STRATEGY'; ownerId: string | null; taskId?: string }) => void) => () => void;
        getStartupEnabled: () => Promise<DesktopResult<boolean>>;
        setStartupEnabled: (enabled: boolean) => Promise<DesktopResult<boolean>>;
      };
    };
  }
}

