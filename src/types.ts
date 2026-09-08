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

export type FilterMode = 'ALL' | 'ACTIVE' | 'DONE';

export interface WorkflowStats {
  total: number;
  completed: number;
  percent: number;
  phaseCounts: Record<string, number>;
}

export interface SuggestedTask {
  title: string;
  phase: string;
  priority: 1 | 2 | 3;
  steps: number;
  note: string;
  reason?: string;
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
  interface Window {
    electronAPI?: {
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      isElectron: boolean;
      downloadAndInstallUpdate?: (url: string, fileName?: string) => Promise<{ success: boolean; message?: string }>;
      openExternal?: (url: string) => void;
    };
  }
}

