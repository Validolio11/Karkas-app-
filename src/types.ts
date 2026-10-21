import type { AgentAction } from './utils/aiAgentActions';
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

export type TaskActivityKind = 'created' | 'edited' | 'rescheduled' | 'started' | 'paused' | 'completed' | 'reopened' | 'progress' | 'time_adjusted' | 'attempt';

/** App-recorded history, never accepted as editable AI task fields. Missing legacy history is unknown. */
export interface TaskActivityEvent {
  id: string;
  at: number;
  kind: TaskActivityKind;
  attemptSeconds?: number;
  workedFrom?: number; // Explicit credited work interval.
  workedUntil?: number;
  attemptCapSeconds?: number;
  attemptOutcome?: 'stopped' | 'cap_reached';
  attemptContinued?: boolean;
  previousPlannedDate?: string | null;
  plannedDate?: string | null;
  previousDeadlineDate?: string | null;
  deadlineDate?: string | null;
  previousScheduledStartAt?: string | null;
  scheduledStartAt?: string | null;
  /** Deterministic state key prevents double recording a pre-annotated action. */
  changeKey?: string;
}

export interface Skill {
  id: string;
  title: string;
  metric: { label: string; unit: string; direction: 'up' | 'down' };
  start: { value: number; date: string };
  goal: { value: number; date: string; label?: string };
  measure: { weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6; minutes: number; how?: string; time?: string }; // time: local "HH:MM"
  subskills: { id: string; title: string }[];
  createdAt: number;
  updatedAt?: number;
  archivedAt?: number;
  deletedAt?: number;
  sourceGoalId?: string;
  needsSetup?: boolean;
}

/** Migrated goals remain incomplete until the user chooses a real outcome metric. */
export type SkillDraft = Pick<Skill, 'id' | 'title' | 'subskills' | 'createdAt' | 'updatedAt' | 'archivedAt' | 'deletedAt' | 'sourceGoalId'> & {
  needsSetup: true;
  metric?: never;
  start?: never;
  goal?: never;
  measure?: never;
};
export type GrowthSkill = Skill | SkillDraft;

export interface SkillMeasurement {
  id: string;
  skillId: string;
  value: number;
  at: number;
  note?: string;
  sessionId?: string;
  deletedAt?: number;
}

export interface PracticeSession {
  id: string;
  skillId: string;
  subskillId?: string;
  taskId?: string;
  at: number;
  durationSeconds?: number;
  difficulty: 'easy' | 'edge' | 'hard';
  result?: { done: number; of: number };
  lesson?: string;
  measurementId?: string;
  deletedAt?: number;
}

export interface PSTask {
  id: string;
  title: string;
  phase: string; // Dynamic tab/category ID
  skillId?: string;
  subskillId?: string;
  priority: 1 | 2 | 3; // 1: Urgent (Red), 2: Standard (Yellow), 3: Low (Green)
  steps: number; // Zero means the task has no subtasks
  currentStep: number; // 0 to steps
  stepList?: TaskStepItem[]; // Optional list of custom steps with descriptions
  done: boolean;
  pinned: boolean;
  note?: string;
  createdAt: number;
  updatedAt?: number;
  activityTrail?: TaskActivityEvent[]; // Most recent 64 app-recorded events, chronological.
  plannedDate?: string; // Local calendar day (YYYY-MM-DD), independent of timed scheduling.
  deadlineDate?: string; // Inclusive local calendar day (YYYY-MM-DD).
  schedule?: TaskSchedule;
  scheduledPending?: boolean; // Future plan template, excluded from work statistics
  scheduledFor?: number; // Planned start of materialized occurrence
  scheduledDurationSeconds?: number; // Fixed block length; timer extensions do not move its planned end.
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
  countdownExpiredAt?: number; // Exact zero crossing; awaiting an explicit overrun decision.
  limitedStart?: { // Temporary countdown ceiling; restore the user's timer after the attempt.
    id: string; capSeconds: number; startedAt: number; baseSeconds: number; continued?: boolean;
    restore: { timerMode?: TimerMode; countdownDurationSeconds?: number; countdownRemainingSeconds?: number };
  };
  autoPausedOverdue?: boolean; // Timer was auto-paused due to session cap or inactivity safeguard
}

export type NewTaskInput = Pick<PSTask, 'title' | 'phase' | 'priority' | 'steps'> &
  Partial<Pick<PSTask, 'stepList' | 'note' | 'timerMode' | 'countdownDurationSeconds' | 'plannedDurationSeconds' | 'schedule' | 'plannedDate' | 'deadlineDate' | 'skillId' | 'subskillId'>>;

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
  kind?: 'lesson' | 'idea'; // Missing on legacy notes: an idea.
  doc?: NoteDoc; // Rich pages; valid only while its plain text equals content.
}

export interface NoteSegStyle { font?: string; size?: number; weight?: number }
/** One run of a note page: styled text, a line break, a numbering marker or a copy chip. */
export interface NoteSeg { t: 'text' | 'br' | 'num' | 'chip'; v: string; s?: NoteSegStyle }
export interface NoteDoc { pages: NoteSeg[][] }

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
  activeLoad: number;
  urgentLoad: number;
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
  /** Explicit replacement of the total recorded work, never a countdown or an added delta. */
  recordedWorkSeconds?: number;
  plannedDate?: string | null;
  deadlineDate?: string | null;
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

export type AgentView = Extract<AgentAction, { type: 'open_view' | 'reveal_task' }>;
export interface AppliedAgentAction {
  action: AgentAction;
  summary: { uk: string; en: string };
  changedTaskIds: string[];
  createdIds?: string[];
}
export interface AgentResponse {
  actions: AppliedAgentAction[];
  pendingConfirmations: AgentAction[];
  clarification?: { question: string; options: { label: string; message: string }[] };
  view?: AgentView;
  handoff?: 'personal';
}

export interface AIResponse {
  agent?: AgentResponse;
  /** Server decision about the current unapplied draft; prose alone cannot cancel it. */
  proposalDisposition?: 'cancelled' | 'clarification';
  strategy?: AIStrategyResponse;
  summary: string;
  insights?: string[];
  reply?: string;
  tasks?: (AITimerSettings & {
    plannedDate?: string;
    deadlineDate?: string;
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
    plannedDate?: string | null;
    deadlineDate?: string | null;
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

export type AnalyticsPeriod = 'ALL_TIME' | 'THIS_YEAR' | 'LAST_YEAR' | 'THIS_MONTH' | 'TODAY' | 'LAST_7_DAYS' | 'LAST_30_DAYS' | 'LAST_90_DAYS' | 'LAST_365_DAYS';

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
      skills?: GrowthSkill[];
      measurements?: SkillMeasurement[];
      practiceSessions?: PracticeSession[];
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
        onCommand: (callback: (command: 'new-task' | 'open-settings' | { type: 'toggle-timer' | 'complete-task' | 'start-task'; taskId: string }) => void) => () => void;
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
        /** Resolves with the final body; reply fragments arrive through onStreamDelta. */
        assistStream?: (input: unknown) => Promise<DesktopResult<{ status: number; body: any }>>;
        onStreamDelta?: (callback: (event: { requestId: string; text: string }) => void) => () => void;
        breakdown: (input: unknown) => Promise<DesktopResult<{ status: number; body: any }>>;
        recommendations: (input: unknown) => Promise<DesktopResult<{ status: number; body: any }>>;
        /** Missing in builds older than the tab suggestion feature. */
        suggestTabs?: (input: unknown) => Promise<DesktopResult<{ status: number; body: any }>>;
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
        setPresence?: (presence: unknown) => void;
        openExternal: (url: string) => Promise<DesktopResult<void>>;
        showNotification: (input: { title: string; body: string; target?: { view: 'STRATEGY'; ownerId: string | null; taskId?: string } }) => Promise<DesktopResult<void>>;
        onNotificationClick: (callback: (target: { view: 'STRATEGY'; ownerId: string | null; taskId?: string }) => void) => () => void;
        getStartupEnabled: () => Promise<DesktopResult<boolean>>;
        setStartupEnabled: (enabled: boolean) => Promise<DesktopResult<boolean>>;
      };
    };
  }
}

