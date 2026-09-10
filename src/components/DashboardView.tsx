import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  PSTask,
  TaskTab,
  WorkflowStats,
  AIRecommendation,
  SuggestedTask,
  DeletedTask,
  AnalyticsPeriod,
} from '../types';
import { Language, TRANSLATIONS } from '../utils/i18n';
import { sound } from '../utils/audio';
import {
  CheckCircle2,
  Clock,
  Flame,
  Layers,
  ArrowRight,
  Plus,
  Sliders,
  Check,
  RefreshCw,
  Zap,
  Compass,
  Lightbulb,
  CheckCheck,
  Calendar,
  BarChart3,
  Trash2,
  Award,
  AlertTriangle,
  Target,
} from 'lucide-react';
import { AIIcon, AIIconId } from './AIIconTemplates';
import { ActivityChart } from './ActivityChart';

const AI_ANALYSIS_STORAGE_KEY_PREFIX = 'karkas_ai_dashboard_analysis_cache_';

export type DailySlotType = 'MORNING' | 'MIDDAY' | 'EVENING';

interface CachedAnalysis {
  recommendation: AIRecommendation;
  timestamp: number;
  slotId: string;
  slotType: DailySlotType;
  lang: Language;
  period: AnalyticsPeriod;
}

const getDailyAnalysisSlot = (d: Date = new Date()): { slotId: string; slotType: DailySlotType } => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hour = d.getHours();

  let slotType: DailySlotType = 'MORNING';
  if (hour >= 18) {
    slotType = 'EVENING';
  } else if (hour >= 12) {
    slotType = 'MIDDAY';
  } else {
    slotType = 'MORNING';
  }

  return {
    slotId: `${year}-${month}-${day}-${slotType}`,
    slotType,
  };
};

const getSlotLabel = (slotType: DailySlotType, lang: Language): string => {
  if (lang === 'uk') {
    switch (slotType) {
      case 'MORNING':
        return 'ранок';
      case 'MIDDAY':
        return 'день';
      case 'EVENING':
        return 'вечір';
    }
  } else {
    switch (slotType) {
      case 'MORNING':
        return 'Morning';
      case 'MIDDAY':
        return 'Midday';
      case 'EVENING':
        return 'Evening';
    }
  }
};

const formatTimeShort = (timestamp: number, lang: Language): string => {
  try {
    const d = new Date(timestamp);
    return d.toLocaleTimeString(lang === 'uk' ? 'uk-UA' : 'en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
};

const MONTH_NAMES_UK = [
  'Січ', 'Лют', 'Бер', 'Кві', 'Тра', 'Чер',
  'Лип', 'Сер', 'Вер', 'Жов', 'Лис', 'Гру',
];
const MONTH_NAMES_EN = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

interface DashboardViewProps {
  tasks: PSTask[];
  deletedTasks?: DeletedTask[];
  tabs: TaskTab[];
  stats: WorkflowStats;
  lang: Language;
  aiIconVariant?: AIIconId;
  onSelectTab: (tabId: string) => void;
  onToggleDone: (taskId: string) => void;
  onOpenAI: (prompt?: string) => void;
  onOpenAdd: () => void;
  onOpenManageTabs: () => void;
  onAddTask?: (task: {
    title: string;
    phase: string;
    priority: 1 | 2 | 3;
    steps: number;
    note?: string;
  }) => void;
}

const DashboardViewComponent: React.FC<DashboardViewProps> = ({
  tasks,
  deletedTasks = [],
  tabs,
  stats,
  lang,
  aiIconVariant,
  onSelectTab,
  onToggleDone,
  onOpenAI,
  onOpenAdd,
  onOpenManageTabs,
  onAddTask,
}) => {
  const t = TRANSLATIONS[lang];
  const tAnalytics = t.dashboardAnalytics || (TRANSLATIONS.uk.dashboardAnalytics as any);

  // Selected period for comprehensive historical analytics
  const [selectedPeriod, setSelectedPeriod] = useState<AnalyticsPeriod>('THIS_MONTH');

  // Up-to-date refs for network calls
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const deletedTasksRef = useRef(deletedTasks);
  deletedTasksRef.current = deletedTasks;
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  // -------------------------------------------------------------
  // Comprehensive Period Filtering & Math Calculations
  // -------------------------------------------------------------
  const analyticsData = useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    // Determine timestamp range
    let isTimestampInPeriod = (_ts: number): boolean => true;

    if (selectedPeriod === 'THIS_YEAR') {
      const start = new Date(currentYear, 0, 1).getTime();
      const end = new Date(currentYear, 11, 31, 23, 59, 59, 999).getTime();
      isTimestampInPeriod = (ts) => ts >= start && ts <= end;
    } else if (selectedPeriod === 'LAST_YEAR') {
      const start = new Date(currentYear - 1, 0, 1).getTime();
      const end = new Date(currentYear - 1, 11, 31, 23, 59, 59, 999).getTime();
      isTimestampInPeriod = (ts) => ts >= start && ts <= end;
    } else if (selectedPeriod === 'THIS_MONTH') {
      const start = new Date(currentYear, currentMonth, 1).getTime();
      const end = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59, 999).getTime();
      isTimestampInPeriod = (ts) => ts >= start && ts <= end;
    } else if (selectedPeriod === 'LAST_30_DAYS') {
      const start = Date.now() - 30 * 24 * 60 * 60 * 1000;
      isTimestampInPeriod = (ts) => ts >= start;
    } else {
      // ALL_TIME
      isTimestampInPeriod = () => true;
    }

    // Helper to evaluate if task belongs to period
    const taskBelongsToPeriod = (task: PSTask | DeletedTask): boolean => {
      const c = task.createdAt || 0;
      const comp = task.completedAt || 0;
      const del = (task as DeletedTask).deletedAt || 0;
      return (
        (c > 0 && isTimestampInPeriod(c)) ||
        (comp > 0 && isTimestampInPeriod(comp)) ||
        (del > 0 && isTimestampInPeriod(del))
      );
    };

    const activeInPeriod = tasks.filter((t) => !t.done && taskBelongsToPeriod(t));
    const completedInPeriod = tasks.filter((t) => t.done && taskBelongsToPeriod(t));
    const deletedInPeriod = deletedTasks.filter((t) => taskBelongsToPeriod(t));

    // Distinguish deleted completed vs deleted uncompleted (dropped)
    const deletedCompleted = deletedInPeriod.filter((t) => t.done);
    const droppedInPeriod = deletedInPeriod.filter((t) => !t.done);

    const totalDelivered = completedInPeriod.length + deletedCompleted.length;
    const totalDropped = droppedInPeriod.length;
    const totalActive = activeInPeriod.length;
    const totalTracked = totalDelivered + totalDropped + totalActive;

    // Success / Completion rate %
    const successRate =
      totalDelivered + totalDropped > 0
        ? Math.round((totalDelivered / (totalDelivered + totalDropped)) * 100)
        : totalTracked > 0 && totalDelivered > 0
        ? Math.round((totalDelivered / totalTracked) * 100)
        : 0;

    // Sub-steps cleared count
    let substepsCount = 0;
    [...completedInPeriod, ...deletedCompleted].forEach((t) => {
      if (t.stepList && t.stepList.length > 0) {
        substepsCount += t.stepList.filter((s) => s.done).length;
      } else {
        substepsCount += Math.max(1, t.steps || 1);
      }
    });

    // Category breakdown for this period
    const categoryStats = tabs.map((tab) => {
      const catActive = activeInPeriod.filter((t) => t.phase === tab.id).length;
      const catDelivered =
        completedInPeriod.filter((t) => t.phase === tab.id).length +
        deletedCompleted.filter((t) => t.phase === tab.id).length;
      const catDropped = droppedInPeriod.filter((t) => t.phase === tab.id).length;
      const catTotal = catActive + catDelivered + catDropped;
      const catPercent =
        catDelivered + catDropped > 0
          ? Math.round((catDelivered / (catDelivered + catDropped)) * 100)
          : catTotal > 0
          ? Math.round((catDelivered / catTotal) * 100)
          : 0;
      const tabDisplayName = (t.phases as any)[tab.id] || tab.name;

      return {
        id: tab.id,
        name: tabDisplayName,
        color: tab.color || '#ffffff',
        total: catTotal,
        delivered: catDelivered,
        dropped: catDropped,
        active: catActive,
        percent: catPercent,
      };
    });

    // Priority breakdown
    const p1Delivered =
      completedInPeriod.filter((t) => t.priority === 1).length +
      deletedCompleted.filter((t) => t.priority === 1).length;
    const p1Total =
      p1Delivered +
      activeInPeriod.filter((t) => t.priority === 1).length +
      droppedInPeriod.filter((t) => t.priority === 1).length;

    const p2Delivered =
      completedInPeriod.filter((t) => t.priority === 2).length +
      deletedCompleted.filter((t) => t.priority === 2).length;
    const p2Total =
      p2Delivered +
      activeInPeriod.filter((t) => t.priority === 2).length +
      droppedInPeriod.filter((t) => t.priority === 2).length;

    const p3Delivered =
      completedInPeriod.filter((t) => t.priority === 3).length +
      deletedCompleted.filter((t) => t.priority === 3).length;
    const p3Total =
      p3Delivered +
      activeInPeriod.filter((t) => t.priority === 3).length +
      droppedInPeriod.filter((t) => t.priority === 3).length;

    // Timeline distribution (Velocity Bars)
    type BarItem = { label: string; delivered: number; dropped: number; created: number };
    const velocityBars: BarItem[] = [];

    if (selectedPeriod === 'THIS_YEAR' || selectedPeriod === 'LAST_YEAR') {
      const targetYear = selectedPeriod === 'THIS_YEAR' ? currentYear : currentYear - 1;
      const monthNames = lang === 'uk' ? MONTH_NAMES_UK : MONTH_NAMES_EN;

      for (let m = 0; m < 12; m++) {
        const mStart = new Date(targetYear, m, 1).getTime();
        const mEnd = new Date(targetYear, m + 1, 0, 23, 59, 59, 999).getTime();

        const mDelivered = [...completedInPeriod, ...deletedCompleted].filter((t) => {
          const ts = t.completedAt || t.createdAt || 0;
          return ts >= mStart && ts <= mEnd;
        }).length;

        const mDropped = droppedInPeriod.filter((t) => {
          const ts = t.deletedAt || t.createdAt || 0;
          return ts >= mStart && ts <= mEnd;
        }).length;

        const mCreated = [...activeInPeriod, ...completedInPeriod, ...deletedInPeriod].filter((t) => {
          const ts = t.createdAt || 0;
          return ts >= mStart && ts <= mEnd;
        }).length;

        velocityBars.push({
          label: monthNames[m],
          delivered: mDelivered,
          dropped: mDropped,
          created: mCreated,
        });
      }
    } else {
      // 4 Weekly intervals based on actual task timestamps
      const nowMs = Date.now();
      let pStart = nowMs - 30 * 24 * 60 * 60 * 1000;
      let pEnd = nowMs;

      if (selectedPeriod === 'THIS_MONTH') {
        pStart = new Date(currentYear, currentMonth, 1).getTime();
        pEnd = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59, 999).getTime();
      } else if (selectedPeriod === 'LAST_30_DAYS') {
        pStart = nowMs - 30 * 24 * 60 * 60 * 1000;
        pEnd = nowMs;
      } else {
        // ALL_TIME: find earliest task or default to 30 days
        const allTimestamps = [...tasks, ...deletedTasks]
          .map((t) => t.createdAt || 0)
          .filter((t) => t > 0);
        const earliest = allTimestamps.length > 0 ? Math.min(...allTimestamps) : nowMs - 30 * 24 * 60 * 60 * 1000;
        pStart = Math.min(earliest, nowMs - 7 * 24 * 60 * 60 * 1000);
        pEnd = nowMs;
      }

      const intervalDuration = (pEnd - pStart) / 4;

      for (let w = 1; w <= 4; w++) {
        const label = lang === 'uk' ? `Т-${w}` : `W${w}`;
        const wStart = pStart + (w - 1) * intervalDuration;
        const wEnd = pStart + w * intervalDuration;

        const wDelivered = [...completedInPeriod, ...deletedCompleted].filter((t) => {
          const ts = t.completedAt || t.createdAt || 0;
          return ts >= wStart && ts <= wEnd;
        }).length;

        const wDropped = droppedInPeriod.filter((t) => {
          const ts = t.deletedAt || t.createdAt || 0;
          return ts >= wStart && ts <= wEnd;
        }).length;

        const wCreated = [...activeInPeriod, ...completedInPeriod, ...deletedInPeriod].filter((t) => {
          const ts = t.createdAt || 0;
          return ts >= wStart && ts <= wEnd;
        }).length;

        velocityBars.push({
          label,
          delivered: wDelivered,
          dropped: wDropped,
          created: wCreated,
        });
      }
    }

    // -------------------------------------------------------------
    // Task Volume Norms & Quotas per period (Квота кількості завдань)
    // Month/30-days: ~25 tasks (range 20-30 tasks)
    // Year: ~200 tasks (~20 tasks/month)
    // All time: ~40 tasks base
    // -------------------------------------------------------------
    let targetVolume = 25;
    let minDeliveredForGrade = { S: 20, APlus: 15, A: 10, B: 6 };

    if (selectedPeriod === 'THIS_MONTH' || selectedPeriod === 'LAST_30_DAYS') {
      targetVolume = 25;
      minDeliveredForGrade = { S: 20, APlus: 15, A: 10, B: 6 };
    } else if (selectedPeriod === 'THIS_YEAR' || selectedPeriod === 'LAST_YEAR') {
      targetVolume = 200;
      minDeliveredForGrade = { S: 150, APlus: 100, A: 60, B: 30 };
    } else {
      targetVolume = 40;
      minDeliveredForGrade = { S: 30, APlus: 20, A: 12, B: 6 };
    }

    const volumeProgressPercent = Math.min(100, Math.round((totalTracked / targetVolume) * 100));
    const deliveredNormPercent = Math.min(100, Math.round((totalDelivered / targetVolume) * 100));
    const isVolumeDeficit = totalDelivered < minDeliveredForGrade.B;

    // Strict Multi-Factor Productivity Grade (requires BOTH high success rate AND volume quota)
    let grade = 'C';
    let gradeReason = '';

    if (isVolumeDeficit) {
      grade = 'C';
      gradeReason = lang === 'uk'
        ? `Дефіцит обсягу (${totalDelivered}/${minDeliveredForGrade.B} мін.)`
        : `Volume deficit (${totalDelivered}/${minDeliveredForGrade.B} min)`;
    } else if (successRate >= 90 && totalDelivered >= minDeliveredForGrade.S) {
      grade = 'S';
      gradeReason = lang === 'uk' ? 'Елітна дисципліна + норма' : 'Elite discipline & quota';
    } else if (successRate >= 80 && totalDelivered >= minDeliveredForGrade.APlus) {
      grade = 'A+';
      gradeReason = lang === 'uk' ? 'Високий темп + норма' : 'High cadence & quota';
    } else if (successRate >= 65 && totalDelivered >= minDeliveredForGrade.A) {
      grade = 'A';
      gradeReason = lang === 'uk' ? 'Стабільний темп' : 'Solid cadence';
    } else if (successRate >= 50 && totalDelivered >= minDeliveredForGrade.B) {
      grade = 'B';
      gradeReason = lang === 'uk' ? 'Базовий мінімум' : 'Baseline minimum';
    } else {
      grade = 'C';
      gradeReason = successRate < 50
        ? (lang === 'uk' ? 'Низька успішність (<50%)' : 'Low success rate (<50%)')
        : (lang === 'uk' ? 'Брак обсягу задач' : 'Insufficient volume');
    }

    return {
      totalTracked,
      totalDelivered,
      totalDropped,
      totalActive,
      successRate,
      substepsCount,
      categoryStats,
      p1Delivered,
      p1Total,
      p2Delivered,
      p2Total,
      p3Delivered,
      p3Total,
      velocityBars,
      targetVolume,
      minDeliveredForGrade,
      volumeProgressPercent,
      deliveredNormPercent,
      isVolumeDeficit,
      grade,
      gradeReason,
    };
  }, [tasks, deletedTasks, tabs, selectedPeriod, lang, t.phases]);

  // -------------------------------------------------------------
  // AI Recommendations & Period Strategic Retrospective
  // -------------------------------------------------------------
  const [recommendation, setRecommendation] = useState<AIRecommendation | null>(() => {
    try {
      const cacheKey = `${AI_ANALYSIS_STORAGE_KEY_PREFIX}${selectedPeriod}`;
      const raw = localStorage.getItem(cacheKey);
      if (raw) {
        const cached: CachedAnalysis = JSON.parse(raw);
        const { slotId } = getDailyAnalysisSlot();
        if (cached.slotId === slotId && cached.lang === lang && cached.recommendation) {
          return cached.recommendation;
        }
      }
    } catch {
      // ignore
    }
    return null;
  });

  const [lastAnalyzedAt, setLastAnalyzedAt] = useState<number | null>(null);
  const [lastSlotType, setLastSlotType] = useState<DailySlotType | null>(null);
  const [isLoadingRecs, setIsLoadingRecs] = useState<boolean>(false);
  const [addedTaskTitles, setAddedTaskTitles] = useState<string[]>([]);

  // Fetch AI Recommendations tailored to current period
  const fetchRecommendations = useCallback(
    async (force: boolean = false, periodToUse: AnalyticsPeriod = selectedPeriod) => {
      const { slotId, slotType } = getDailyAnalysisSlot();
      const cacheKey = `${AI_ANALYSIS_STORAGE_KEY_PREFIX}${periodToUse}`;

      if (!force) {
        try {
          const raw = localStorage.getItem(cacheKey);
          if (raw) {
            const cached: CachedAnalysis = JSON.parse(raw);
            const isSameSlot = cached.slotId === slotId;
            const isSameLang = cached.lang === lang;
            const isRecent = Date.now() - cached.timestamp < 14 * 60 * 60 * 1000;

            if (isSameSlot && isSameLang && isRecent && cached.recommendation) {
              setRecommendation(cached.recommendation);
              setLastAnalyzedAt(cached.timestamp);
              setLastSlotType(cached.slotType);
              return;
            }
          }
        } catch (err) {
          console.warn('Could not read cached AI analysis:', err);
        }
      }

      setIsLoadingRecs(true);
      const currentTasks = tasksRef.current;
      const currentDeleted = deletedTasksRef.current;
      const currentTabs = tabsRef.current;

      try {
        const customKey = localStorage.getItem('karkas_custom_api_key') || '';
        const customModel = localStorage.getItem('karkas_custom_model') || '';
        const customEnabled = localStorage.getItem('karkas_custom_ai_enabled') === 'true';

        const res = await fetch('/api/ai/recommendations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tasks: currentTasks,
            deletedTasks: currentDeleted,
            tabs: currentTabs,
            lang,
            period: periodToUse,
            customApiKey: customEnabled ? customKey : undefined,
            selectedModel: customEnabled ? customModel : undefined,
            periodMetrics: {
              totalCreated: analyticsData.totalTracked,
              totalCompleted: analyticsData.totalDelivered,
              totalDeleted: analyticsData.totalDropped,
              totalActive: analyticsData.totalActive,
              successRate: analyticsData.successRate,
              substepsCleared: analyticsData.substepsCount,
              grade: analyticsData.grade,
            },
          }),
        });

        if (!res.ok) throw new Error('Failed to fetch recommendations');
        const data: AIRecommendation = await res.json();
        setRecommendation(data);
        const timestamp = Date.now();
        setLastAnalyzedAt(timestamp);
        setLastSlotType(slotType);

        const cacheEntry: CachedAnalysis = {
          recommendation: data,
          timestamp,
          slotId,
          slotType,
          lang,
          period: periodToUse,
        };
        localStorage.setItem(cacheKey, JSON.stringify(cacheEntry));
      } catch (err) {
        console.warn('Could not load server AI recommendations, using local analytics fallback:', err);
        const isUk = lang === 'uk';
        const primaryTab = currentTabs[0]?.id || 'focus';

        const fallbackData: AIRecommendation = {
          focusAdvice: isUk
            ? analyticsData.p1Total > 0
              ? `Сфокусуйтеся на виконанні P1 задач. Закриття ключових блокерів підніме рівень успішності з ${analyticsData.successRate}% до максимуму.`
              : `Темп стабільний. Закрито ${analyticsData.totalDelivered} завдань за період. Продовжуйте ритмічну роботу.`
            : `Zero in on critical priority deliverables to elevate your ${analyticsData.successRate}% success rate.`,
          optimizationTip: isUk
            ? 'Розбивайте складні завдання на 2-3 підкроки для прискорення закриття.'
            : 'Break heavy items into 2-3 micro-steps to maintain cadence.',
          workloadStatus:
            analyticsData.totalActive > 5
              ? isUk
                ? '🔥 ВИСОКИЙ ТЕМП'
                : '🔥 HIGH LOAD'
              : isUk
              ? '⚡ ОПТИМАЛЬНИЙ БАЛАНС'
              : '⚡ OPTIMAL CADENCE',
          periodRetrospective: isUk
            ? `За вибраний період зафіксовано ${analyticsData.totalTracked} завдань (успішно закрито ${analyticsData.totalDelivered}, рівень успішності ${analyticsData.successRate}%).`
            : `Tracked ${analyticsData.totalTracked} tasks for this period (${analyticsData.totalDelivered} completed, ${analyticsData.successRate}% success rate).`,
          dropoffAnalysis: isUk
            ? analyticsData.totalDropped > 0
              ? `Утилізовано ${analyticsData.totalDropped} неактуальних завдань. Черга залишається чистий та сфокусованою.`
              : 'Мінімальні втрати завдань: висока точність планування та доведення справ до кінця.'
            : `${analyticsData.totalDropped} items pruned, keeping your focus tight.`,
          futureStrategy: isUk
            ? 'Зберігайте щотижневе рев’ю та декомпозицію складних завдань на підкроки.'
            : 'Maintain weekly retrospectives and clear stage milestones.',
          productivityGrade: analyticsData.grade,
          suggestedTasks: [
            {
              title: isUk ? 'Провести стратегічне рев’ю закритих результатів' : 'Review closed milestones & update priorities',
              phase: primaryTab,
              priority: 2,
              steps: 2,
              note: isUk ? 'Підсумок періоду' : 'Period recap',
              reason: isUk ? 'Фіксує прогрес та знімає ментальне навантаження' : 'Locks in momentum',
            },
            {
              title: isUk ? 'Швидка перевірка пріоритетів на наступний блок' : 'Align top deliverables for next sprint',
              phase: primaryTab,
              priority: 1,
              steps: 2,
              note: isUk ? 'Фокус P1' : 'P1 focus',
              reason: isUk ? 'Запобігає прокрастинації та перевантаженню' : 'Prevents task drift',
            },
          ],
          source: 'engine',
        };

        setRecommendation(fallbackData);
        const timestamp = Date.now();
        setLastAnalyzedAt(timestamp);
        setLastSlotType(slotType);

        const fallbackCache: CachedAnalysis = {
          recommendation: fallbackData,
          timestamp,
          slotId,
          slotType,
          lang,
          period: periodToUse,
        };
        localStorage.setItem(cacheKey, JSON.stringify(fallbackCache));
      } finally {
        setIsLoadingRecs(false);
      }
    },
    [lang, selectedPeriod, analyticsData]
  );

  useEffect(() => {
    fetchRecommendations(false, selectedPeriod);
  }, [selectedPeriod, lang]);

  const handleAddSuggestedTask = (st: SuggestedTask) => {
    if (!onAddTask) return;
    sound.activate();
    const effectivePhase =
      st.phase && st.phase !== 'DASHBOARD' && st.phase !== 'ALL' && tabs.some((tb) => tb.id === st.phase)
        ? st.phase
        : tabs[0]?.id || 'focus';

    onAddTask({
      title: st.title,
      phase: effectivePhase,
      priority: st.priority,
      steps: st.steps,
      note: st.note,
    });
    setAddedTaskTitles((prev) => [...prev, st.title]);
  };

  // Urgent active tasks list for Quick Action Queue
  const p1ActiveTasks = tasks.filter((t) => t.priority === 1 && !t.done);
  const p2ActiveTasks = tasks.filter((t) => t.priority === 2 && !t.done);

  // Period Selector Buttons definition
  const periodsList: { id: AnalyticsPeriod; label: string }[] = [
    { id: 'THIS_MONTH', label: tAnalytics.periods.THIS_MONTH },
    { id: 'THIS_YEAR', label: tAnalytics.periods.THIS_YEAR },
    { id: 'LAST_YEAR', label: tAnalytics.periods.LAST_YEAR },
    { id: 'LAST_30_DAYS', label: tAnalytics.periods.LAST_30_DAYS },
    { id: 'ALL_TIME', label: tAnalytics.periods.ALL_TIME },
  ];

  return (
    <div className="space-y-8 font-mono leading-relaxed">
      {/* ------------------------------------------------------------- */}
      {/* PERIOD SELECTOR & HEADER BAR */}
      {/* ------------------------------------------------------------- */}
      <div className="border-b border-neutral-800/80 pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 mb-3">
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-1.5 bg-white" />
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-white font-mono flex items-center gap-2">
                <span>{tAnalytics.title}</span>
              </h2>
            </div>
          </div>

          {/* Recalculate / Force Refresh button */}
          <button
            id="dashboard-recalculate-period-btn"
            onClick={() => {
              sound.tick(750);
              fetchRecommendations(true, selectedPeriod);
            }}
            disabled={isLoadingRecs}
            className="self-start sm:self-auto flex items-center gap-1.5 text-xs font-mono tracking-wider uppercase px-2 py-1 text-neutral-400 hover:text-white transition-colors disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-3 h-3 text-neutral-400 ${isLoadingRecs ? 'animate-spin' : ''}`} />
            <span>{isLoadingRecs ? tAnalytics.analyzing : tAnalytics.recalculate}</span>
          </button>
        </div>

        {/* Period Selector Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          <span className="text-[11px] uppercase text-neutral-400 font-mono shrink-0 mr-1 flex items-center gap-1">
            <Calendar className="w-3 h-3 text-neutral-400" />
            <span>{tAnalytics.periodLabel}:</span>
          </span>

          {periodsList.map((p) => {
            const isSelected = selectedPeriod === p.id;
            return (
              <button
                key={p.id}
                id={`period-btn-${p.id}`}
                onClick={() => {
                  sound.tick(550);
                  setSelectedPeriod(p.id);
                }}
                className={`px-3 py-2 text-xs font-mono font-bold tracking-wider uppercase whitespace-nowrap transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-white text-black'
                    : 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200'
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* KEY PERIOD PRODUCTIVITY METRICS (4 CARDS) */}
      {/* ------------------------------------------------------------- */}
      <div className="grid grid-cols-2 gap-px overflow-hidden border border-neutral-800/70 bg-neutral-800/70 xl:grid-cols-4">
        {/* Total Tracked Pool in Period */}
        <div className="bg-[#09090b] p-5 flex flex-col justify-between">
          <div className="text-xs uppercase text-neutral-400 flex items-center justify-between gap-3 font-mono">
            <span>{tAnalytics.totalPool}</span>
            <Layers className="w-3.5 h-3.5 text-neutral-400" />
          </div>
          <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
            <span className="text-2xl font-bold text-white font-mono">{analyticsData.totalTracked}</span>
            <span className="text-xs text-neutral-400 font-mono">
              {analyticsData.totalTracked} / {analyticsData.targetVolume} {lang === 'uk' ? 'норми' : 'norm'}
            </span>
          </div>
        </div>

        {/* Successfully Delivered / Completed */}
        <div className="bg-[#09090b] p-5 flex flex-col justify-between">
          <div className="text-xs uppercase text-neutral-400 flex items-center justify-between gap-3 font-mono">
            <span>{tAnalytics.completed}</span>
            <CheckCircle2 className="w-3.5 h-3.5 text-neutral-400" />
          </div>
          <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
            <span className="text-2xl font-bold text-white font-mono">{analyticsData.totalDelivered}</span>
            <span className="text-xs text-neutral-400 font-mono font-bold">
              {analyticsData.deliveredNormPercent}% {lang === 'uk' ? 'норми' : 'norm'} ({analyticsData.successRate}%)
            </span>
          </div>
        </div>

        {/* Dropped / Deleted in Period */}
        <div className="bg-[#09090b] p-5 flex flex-col justify-between">
          <div className="text-xs uppercase text-neutral-400 flex items-center justify-between gap-3 font-mono">
            <span>{tAnalytics.dropped}</span>
            <Trash2 className="w-3.5 h-3.5 text-neutral-400" />
          </div>
          <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
            <span className="text-2xl font-bold text-neutral-300 font-mono">{analyticsData.totalDropped}</span>
            <span className="text-xs text-neutral-400 font-mono">
              {analyticsData.substepsCount} {tAnalytics.substepsCompleted.toLowerCase()}
            </span>
          </div>
        </div>

        {/* Productivity Grade & Velocity Index */}
        <div className="bg-[#09090b] p-5 flex flex-col justify-between">
          <div className="text-xs uppercase text-neutral-400 flex items-center justify-between gap-3 font-mono">
            <span>{tAnalytics.grade}</span>
            <Award className="w-3.5 h-3.5 text-neutral-400" />
          </div>
          <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
            {(() => {
              const currentGrade = recommendation?.productivityGrade || analyticsData.grade;
              let gradeColor = 'text-emerald-300';
              if (currentGrade === 'S') gradeColor = 'text-amber-300';
              else if (currentGrade === 'A+' || currentGrade === 'A') gradeColor = 'text-emerald-400';
              else if (currentGrade === 'B') gradeColor = 'text-blue-400';
              else if (currentGrade === 'C') gradeColor = 'text-rose-400';

              return (
                <span className={`text-2xl font-bold font-mono tracking-wider ${gradeColor}`}>
                  {currentGrade}
                </span>
              );
            })()}
            <div className="text-right">
              <span className="text-xs text-neutral-200 font-mono font-bold block">
                {analyticsData.successRate}% {tAnalytics.completionRate.toLowerCase()}
              </span>
              <span className="text-[11px] text-neutral-400 font-mono block">
                {analyticsData.isVolumeDeficit
                  ? (lang === 'uk' ? `дефіцит: ${analyticsData.totalDelivered}/${analyticsData.minDeliveredForGrade.B} мін.` : `deficit: ${analyticsData.totalDelivered}/${analyticsData.minDeliveredForGrade.B} min`)
                  : (lang === 'uk' ? 'норма обсягу ✓' : 'quota met ✓')}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* TASK VOLUME QUOTA & DENSITY PROGRESS BAR */}
      {/* ------------------------------------------------------------- */}
      <div className="border-b border-neutral-800/70 pb-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 mb-2">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-neutral-500" />
            <span className="text-sm font-bold uppercase font-mono tracking-wider text-neutral-200">
              {tAnalytics.volumeNorm}
            </span>
            <span className="text-[11px] font-mono text-neutral-400">
              {analyticsData.totalDelivered} / {analyticsData.targetVolume} {lang === 'uk' ? 'завдань' : 'tasks'} ({analyticsData.deliveredNormPercent}%)
            </span>
          </div>

        </div>

        {/* Progress Bar with Milestones */}
        <div className="w-full bg-neutral-900 h-1.5 relative overflow-hidden">
          <div
            className={`h-full transition-all duration-500 ${
              analyticsData.isVolumeDeficit
                ? 'bg-amber-500/80'
                : analyticsData.deliveredNormPercent >= 80
                ? 'bg-emerald-400'
                : 'bg-neutral-300'
            }`}
            style={{ width: `${Math.min(100, analyticsData.deliveredNormPercent)}%` }}
          />
        </div>

      </div>

      {/* ------------------------------------------------------------- */}
      {/* Activity over the selected period */}
      <ActivityChart
        key={selectedPeriod}
        data={analyticsData.velocityBars}
        title={tAnalytics.timelineVelocity}
        period={periodsList.find(period => period.id === selectedPeriod)?.label || ''}
        completedLabel={tAnalytics.completed}
        deletedLabel={tAnalytics.dropped}
        unitLabel={lang === 'uk' ? '\u041a\u0456\u043b\u044c\u043a\u0456\u0441\u0442\u044c \u0437\u0430\u0432\u0434\u0430\u043d\u044c' : 'Task count'}
        emptyLabel={lang === 'uk' ? '\u0417\u0430 \u0446\u0435\u0439 \u043f\u0435\u0440\u0456\u043e\u0434 \u0449\u0435 \u043d\u0435\u043c\u0430\u0454 \u0432\u0438\u043a\u043e\u043d\u0430\u043d\u0438\u0445 \u0447\u0438 \u0432\u0438\u0434\u0430\u043b\u0435\u043d\u0438\u0445 \u0437\u0430\u0432\u0434\u0430\u043d\u044c.' : 'No completed or deleted tasks in this period yet.'}
      />

      {/* ------------------------------------------------------------- */}
      {/* CATEGORY PRODUCTIVITY BREAKDOWN & PRIORITY MATRIX */}
      {/* ------------------------------------------------------------- */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {/* Category Breakdown in Period */}
        <section className="border border-neutral-800/70 bg-[#08080a]/60 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-3.5 h-3.5 text-neutral-300" />
              <h3 className="text-sm font-bold uppercase tracking-wider text-neutral-200">
                {tAnalytics.categoryDistribution}
              </h3>
            </div>
            <button
              id="dashboard-manage-tabs-period-btn"
              onClick={onOpenManageTabs}
              className="text-xs text-neutral-400 hover:text-white flex items-center gap-1 transition-colors font-mono"
            >
              <Sliders className="w-3 h-3" />
              <span>{t.manageTabs}</span>
            </button>
          </div>

          <div className="divide-y divide-neutral-800/70">
            {analyticsData.categoryStats.map((tp) => (
              <div
                key={tp.id}
                onClick={() => {
                  sound.tick(600);
                  onSelectTab(tp.id);
                }}
                className="group cursor-pointer px-2 py-4 transition-colors hover:bg-white/[0.025]"
              >
                <div className="flex items-center justify-between text-xs mb-1.5 font-mono">
                  <div className="flex items-center gap-2">
                    {tp.color && (
                      <span
                        className="w-2 h-2 shrink-0 border border-white/20 shadow-sm"
                        style={{ backgroundColor: tp.color }}
                      />
                    )}
                    <span className="font-bold text-white group-hover:text-neutral-200 transition-colors">
                      {tp.name}
                    </span>
                    <span className="text-xs text-neutral-400">
                      ({tp.delivered}/{tp.total})
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-neutral-400">
                    <span className="font-bold text-neutral-300">{tp.percent}%</span>
                    <ArrowRight className="w-3 h-3 text-neutral-400 group-hover:text-white transition-transform group-hover:translate-x-0.5" />
                  </div>
                </div>

                {/* Micro Progress Bar */}
                <div className="w-full h-0.5 bg-neutral-800 overflow-hidden">
                  <div
                    className="h-full transition-all duration-300"
                    style={{
                      width: `${tp.percent}%`,
                      backgroundColor: tp.color || '#ffffff',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Quick Add Button */}
          <button
            id="dashboard-period-add-task-btn"
            onClick={onOpenAdd}
            className="mt-3 flex w-full items-center justify-center gap-1.5 border border-neutral-800 px-3 py-2.5 text-sm font-bold uppercase tracking-wider text-neutral-400 transition-colors hover:border-neutral-600 hover:text-white"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t.injectNewOp}</span>
          </button>
        </section>

        {/* Priority Matrix & Urgent Action Queue */}
        <section className="flex flex-col justify-between border border-neutral-800/70 bg-[#08080a]/60 p-5">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-neutral-500" />
                <h3 className="text-sm font-bold uppercase tracking-wider text-neutral-200 font-mono">
                  {lang === 'uk' ? 'Фокус: Термінові справи' : 'Urgent Action Queue'}
                </h3>
              </div>
              <span className="text-xs font-mono text-neutral-400">
                {p1ActiveTasks.length + p2ActiveTasks.length} {lang === 'uk' ? 'активних' : 'queued'}
              </span>
            </div>

            {/* List of top priority active tasks */}
            <div className="space-y-3">
              {p1ActiveTasks.length === 0 && p2ActiveTasks.length === 0 ? (
                <div className="py-6 text-center">
                  <CheckCircle2 className="w-5 h-5 mx-auto mb-2 text-neutral-400" />
                  <p className="text-xs text-neutral-300 font-bold uppercase font-mono">
                    {lang === 'uk' ? 'Всі термінові завдання закриті' : 'All urgent tasks cleared'}
                  </p>
                </div>
              ) : (
                [...p1ActiveTasks, ...p2ActiveTasks].slice(0, 4).map((task) => (
                  <div
                    key={task.id}
                    className={`flex items-start justify-between gap-3 border-l-2 px-3 py-3 text-xs transition-colors font-mono ${
                      task.priority === 1
                        ? 'border-rose-700/70 bg-white/[0.02] text-neutral-200'
                        : 'border-neutral-700 bg-white/[0.015] text-neutral-300'
                    }`}
                  >
                    <div className="flex items-start gap-2 flex-1 min-w-0">
                      <button
                        onClick={() => {
                          sound.tick(700);
                          onToggleDone(task.id);
                        }}
                        title={lang === 'uk' ? 'Позначити як виконане' : 'Mark done'}
                        className="mt-0.5 w-4 h-4 shrink-0 border border-neutral-700 hover:border-white bg-neutral-900 flex items-center justify-center transition-colors cursor-pointer"
                      >
                        {task.done && <Check className="w-3 h-3 text-white" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-sm break-words text-white font-sans">{task.title}</p>
                        {task.note && (
                          <p className="text-xs text-neutral-400 truncate mt-0.5 font-mono">{task.note}</p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <span
                        className={`text-[11px] font-mono px-1.5 py-0.5 border ${
                          task.priority === 1
                            ? 'border-rose-800 text-rose-300 bg-rose-950/40'
                            : 'border-neutral-700 text-amber-300 bg-neutral-900'
                        }`}
                      >
                        P{task.priority}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* AI Tactical Generator Shortcut */}
          <div className="mt-3 border-t border-neutral-800/70 pt-3">
            <button
              id="dashboard-ai-plan-period-btn"
              onClick={() => {
                sound.activate();
                onOpenAI(
                  lang === 'uk'
                    ? `Склади тактичний план продуктивності на основі аналізу за період «${periodsList.find((p) => p.id === selectedPeriod)?.label || ''}»`
                    : `Create a tactical productivity plan based on period "${selectedPeriod}"`
                );
              }}
              className="flex w-full items-center justify-between px-1 py-1 text-sm font-bold uppercase tracking-wider text-neutral-400 transition-colors hover:text-white cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <AIIcon id={aiIconVariant} className="w-3.5 h-3.5 text-neutral-300" />
                <span>{lang === 'uk' ? 'AI Тактичний розрахунок' : 'AI Tactical Plan'}</span>
              </div>
              <ArrowRight className="w-3 h-3 text-neutral-400" />
            </button>
          </div>
        </section>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* STRATEGIC AI PERIOD RETROSPECTIVE & RECOMMENDATIONS SECTION */}
      {/* ------------------------------------------------------------- */}
      <section className="border border-neutral-800/70 bg-[#08080a]/60 p-5">
        {/* Header with Title, Status & Refresh */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <AIIcon id={aiIconVariant} className="w-4 h-4 text-neutral-300" />
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm font-bold uppercase tracking-wider text-white font-mono">
                {tAnalytics.aiAuditTitle}
              </h2>
              <span className="flex items-center gap-1 text-xs font-mono text-neutral-400">
                <Clock className="w-3 h-3 text-neutral-400" />
                <span>{periodsList.find((p) => p.id === selectedPeriod)?.label || selectedPeriod}</span>
              </span>
              {recommendation?.workloadStatus && (
                <span className="text-xs font-mono text-neutral-400">
                  {recommendation.workloadStatus}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              id="refresh-ai-period-recommendations-btn"
              onClick={() => {
                sound.tick(800);
                fetchRecommendations(true, selectedPeriod);
              }}
              disabled={isLoadingRecs}
              title={lang === 'uk' ? 'Оновити аналіз періоду' : 'Refresh period analysis'}
              className="flex items-center gap-1.5 px-2 py-1 text-xs font-mono uppercase tracking-wider text-neutral-400 transition-colors hover:text-white disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-3 h-3 text-neutral-400 ${isLoadingRecs ? 'animate-spin' : ''}`} />
              <span>{isLoadingRecs ? tAnalytics.analyzing : tAnalytics.recalculate}</span>
            </button>
          </div>
        </div>

        {/* Schedule & Last Analysis Status Bar */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-1 border-b border-neutral-800/60 pb-3 text-xs font-mono text-neutral-400">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-neutral-600" />
            <span>
              {lang === 'uk'
                ? `Враховано ${analyticsData.totalTracked} завдань`
                : `Analyzed ${analyticsData.totalTracked} tasks`}
            </span>
          </div>
          {lastAnalyzedAt && lastSlotType && (
            <span className="text-neutral-400">
              {lang === 'uk'
                ? `Останній аналіз: ${formatTimeShort(lastAnalyzedAt, lang)} (${getSlotLabel(lastSlotType, lang)})`
                : `Last analyzed: ${formatTimeShort(lastAnalyzedAt, lang)} (${getSlotLabel(lastSlotType, lang)})`}
            </span>
          )}
        </div>

        {/* 3 AI Analytics Insight Blocks */}
        <div className="mb-5 grid grid-cols-1 divide-y divide-neutral-800/70 border-y border-neutral-800/70 md:grid-cols-3 md:divide-x md:divide-y-0">
          {/* Period Retrospective */}
          <div className="flex flex-col justify-between px-1 py-4 md:px-5">
            <div>
              <div className="flex items-center gap-1.5 text-xs font-mono uppercase text-neutral-400 mb-1">
                <Target className="w-3 h-3 text-neutral-400" />
                <span>{tAnalytics.aiRetrospective}</span>
              </div>
              <p className="text-sm text-neutral-200 leading-relaxed font-sans">
                {recommendation?.periodRetrospective ||
                  (lang === 'uk'
                    ? `Зафіксовано ${analyticsData.totalTracked} завдань із рівнем успішності ${analyticsData.successRate}%.`
                    : `Recorded ${analyticsData.totalTracked} tasks with ${analyticsData.successRate}% completion.`)}
              </p>
            </div>
          </div>

          {/* Dropoff & Bottlenecks Analysis */}
          <div className="flex flex-col justify-between px-1 py-4 md:px-5">
            <div>
              <div className="flex items-center gap-1.5 text-xs font-mono uppercase text-neutral-400 mb-1">
                <AlertTriangle className="w-3 h-3 text-neutral-400" />
                <span>{tAnalytics.aiDropoffAnalysis}</span>
              </div>
              <p className="text-sm text-neutral-300 leading-relaxed font-sans">
                {recommendation?.dropoffAnalysis ||
                  (lang === 'uk'
                    ? `Утилізовано ${analyticsData.totalDropped} завдань для утримання високої концентрації на головному.`
                    : `${analyticsData.totalDropped} dropped items analyzed.`)}
              </p>
            </div>
          </div>

          {/* Future Strategic Guidance */}
          <div className="flex flex-col justify-between px-1 py-4 md:px-5">
            <div>
              <div className="flex items-center gap-1.5 text-xs font-mono uppercase text-neutral-400 mb-1">
                <Compass className="w-3 h-3 text-neutral-400" />
                <span>{tAnalytics.aiFutureStrategy}</span>
              </div>
              <p className="text-sm text-neutral-300 leading-relaxed font-sans">
                {recommendation?.futureStrategy || recommendation?.optimizationTip ||
                  (lang === 'uk'
                    ? 'Плануйте дрібні спринти та закривайте ключові цілі у першій половині дня.'
                    : 'Plan focused sprints and tackle primary deliverables first.')}
              </p>
            </div>
          </div>
        </div>

        {/* Proactive Suggested Action Items */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <Zap className="w-3 h-3 text-neutral-400" />
              <h3 className="text-sm font-bold font-mono uppercase tracking-wider text-neutral-300">
                {lang === 'uk' ? 'Рекомендовані наступні кроки' : 'Suggested Action Items'}
              </h3>
            </div>
          </div>

          <div className="grid grid-cols-1 divide-y divide-neutral-800/70 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {(recommendation?.suggestedTasks || []).map((st, idx) => {
              const isAdded = addedTaskTitles.includes(st.title);
              const tabName = tabs.find((tb) => tb.id === st.phase)?.name || st.phase;

              return (
                <div
                  key={idx}
                  className="flex flex-col justify-between px-1 py-4 transition-colors hover:bg-white/[0.02] sm:px-3"
                >
                  <div>
                    <div className="flex items-center justify-between gap-1 mb-1.5">
                      <span className="max-w-[100px] truncate text-[11px] font-mono uppercase text-neutral-400">
                        {tabName}
                      </span>
                      <span
                        className={`text-[11px] font-mono ${
                          st.priority === 1
                            ? 'text-rose-300'
                            : 'text-neutral-400'
                        }`}
                      >
                        P{st.priority}
                      </span>
                    </div>

                    <h4 className="text-sm font-bold text-white mb-1 leading-snug line-clamp-2 font-sans">
                      {st.title}
                    </h4>

                    {st.reason && (
                      <p className="text-xs text-neutral-400 font-sans mb-2 line-clamp-2">
                        ↳ {st.reason}
                      </p>
                    )}
                  </div>

                  <div className="mt-2 flex items-center gap-1.5 pt-1">
                    <button
                      onClick={() => handleAddSuggestedTask(st)}
                      disabled={isAdded}
                      className={`flex flex-1 items-center justify-center gap-1 border px-2 py-1 text-xs font-mono font-bold uppercase tracking-wider transition-colors cursor-pointer ${
                        isAdded
                          ? 'bg-neutral-900 border-neutral-800 text-neutral-400 cursor-default'
                          : 'border-neutral-700 text-neutral-300 hover:border-white hover:text-white'
                      }`}
                    >
                      {isAdded ? (
                        <>
                          <CheckCheck className="w-3 h-3 text-neutral-400" />
                          <span>{lang === 'uk' ? 'Додано' : 'Added'}</span>
                        </>
                      ) : (
                        <>
                          <Plus className="w-3 h-3" />
                          <span>{lang === 'uk' ? 'Додати' : 'Add'}</span>
                        </>
                      )}
                    </button>

                    <button
                      onClick={() => {
                        sound.activate();
                        onOpenAI(
                          lang === 'uk'
                            ? `Як найкраще виконати: "${st.title}"? Склади детальний план дій.`
                            : `How to best execute: "${st.title}"? Provide a detailed action plan.`
                        );
                      }}
                      title={lang === 'uk' ? 'Розгорнути з AI' : 'Deep dive with AI'}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center self-center border border-neutral-800 bg-neutral-900 p-0 leading-none text-neutral-400 transition-colors hover:border-neutral-600 hover:bg-neutral-800 hover:text-white cursor-pointer"
                    >
                      <AIIcon id={aiIconVariant} className="h-3.5 w-3.5 text-neutral-400" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
};

export const DashboardView = React.memo(DashboardViewComponent);
