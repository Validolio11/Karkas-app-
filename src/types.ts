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
}

export interface PSTask {
  id: string;
  title: string;
  phase: string; // Dynamic tab/category ID
  priority: 1 | 2 | 3; // 1: Urgent (Red), 2: Standard (Yellow), 3: Low (Green)
  steps: number; // 1 to 4+ stages
  currentStep: number; // 0 to steps
  stepList?: TaskStepItem[]; // Optional list of custom steps with descriptions
  done: boolean;
  pinned: boolean;
  note?: string;
  createdAt: number;
  completedAt?: number;
  timeSpentSeconds?: number; // Total accumulated seconds spent on this task
  timerRunning?: boolean; // Is stopwatch currently active
  timerStartedAt?: number; // Timestamp (ms) when current stopwatch session started
  autoPausedOverdue?: boolean; // Timer was auto-paused due to session cap or inactivity safeguard
}

export interface DeletedTask extends PSTask {
  deletedAt: number;
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
  averageCompletionMinutes: number;
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

export interface AITaskUpdate {
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
}

export interface AIResponse {
  summary: string;
  insights?: string[];
  reply?: string;
  tasks?: {
    title: string;
    phase: string;
    priority: 1 | 2 | 3;
    steps: number;
    stepList?: { id?: string; title: string; done?: boolean }[];
    note?: string;
  }[];
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
      };
      updates: {
        checkLatest: () => Promise<DesktopResult<{ status: number; body: any }>>;
        downloadAndInstall: (input: { url: string; fileName?: string }) => Promise<DesktopResult<void>>;
      };
      system: {
        openExternal: (url: string) => Promise<DesktopResult<void>>;
        showNotification: (input: { title: string; body: string }) => Promise<DesktopResult<void>>;
        getStartupEnabled: () => Promise<DesktopResult<boolean>>;
        setStartupEnabled: (enabled: boolean) => Promise<DesktopResult<boolean>>;
      };
    };
  }
}

