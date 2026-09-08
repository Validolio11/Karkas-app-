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
  TrendingUp,
  BarChart3,
  Trash2,
  Award,
  AlertTriangle,
  Target,
} from 'lucide-react';
import { AIIcon, AIIconId } from './AIIconTemplates';

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

  // Calculate max height for velocity bars
  const maxBarValue = Math.max(
    ...analyticsData.velocityBars.map((b) => Math.max(b.delivered, b.dropped, b.created, 1)),
    5
  );

  return (
    <div className="space-y-4 font-mono">
      {/* ------------------------------------------------------------- */}
      {/* PERIOD SELECTOR & HEADER BAR */}
      {/* ------------------------------------------------------------- */}
      <div className="bg-[#08080a] border border-neutral-800 p-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2.5 mb-2.5 border-b border-neutral-800/80">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-white" />
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider text-white font-mono flex items-center gap-2">
                <span>{tAnalytics.title}</span>
                <span className="text-[10px] font-normal text-neutral-400 px-1.5 py-0.2 bg-neutral-900 border border-neutral-800">
                  {tAnalytics.subtitle}
                </span>
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
            className="self-start sm:self-auto flex items-center gap-1.5 text-[10px] font-mono tracking-wider uppercase px-2.5 py-1 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 hover:border-neutral-600 text-neutral-300 hover:text-white transition-all disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-3 h-3 text-neutral-400 ${isLoadingRecs ? 'animate-spin' : ''}`} />
            <span>{isLoadingRecs ? tAnalytics.analyzing : tAnalytics.recalculate}</span>
          </button>
        </div>

        {/* Period Selector Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          <span className="text-[10px] uppercase text-neutral-400 font-mono shrink-0 mr-1 flex items-center gap-1">
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
                className={`px-2.5 py-1 text-[10px] font-mono font-bold tracking-wider uppercase whitespace-nowrap transition-all border cursor-pointer ${
                  isSelected
                    ? 'bg-white text-black border-white shadow-sm'
                    : 'bg-neutral-900 text-neutral-400 hover:text-neutral-200 border-neutral-800 hover:border-neutral-700'
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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {/* Total Tracked Pool in Period */}
        <div className="bg-[#09090b] border border-neutral-800 p-3 flex flex-col justify-between">
          <div className="text-[10px] uppercase text-neutral-400 flex items-center justify-between font-mono">
            <span>{tAnalytics.totalPool}</span>
            <Layers className="w-3.5 h-3.5 text-neutral-500" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-xl font-bold text-white font-mono">{analyticsData.totalTracked}</span>
            <span className="text-[10px] text-neutral-400 font-mono">
              {analyticsData.totalTracked} / {analyticsData.targetVolume} {lang === 'uk' ? 'норми' : 'norm'}
            </span>
          </div>
        </div>

        {/* Successfully Delivered / Completed */}
        <div className="bg-[#09090b] border border-neutral-800 p-3 flex flex-col justify-between">
          <div className="text-[10px] uppercase text-neutral-400 flex items-center justify-between font-mono">
            <span>{tAnalytics.completed}</span>
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-xl font-bold text-white font-mono">{analyticsData.totalDelivered}</span>
            <span className="text-[10px] text-emerald-400 font-mono font-bold">
              {analyticsData.deliveredNormPercent}% {lang === 'uk' ? 'норми' : 'norm'} ({analyticsData.successRate}%)
            </span>
          </div>
        </div>

        {/* Dropped / Deleted in Period */}
        <div className="bg-[#09090b] border border-neutral-800 p-3 flex flex-col justify-between">
          <div className="text-[10px] uppercase text-neutral-400 flex items-center justify-between font-mono">
            <span>{tAnalytics.dropped}</span>
            <Trash2 className="w-3.5 h-3.5 text-neutral-500" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-xl font-bold text-neutral-300 font-mono">{analyticsData.totalDropped}</span>
            <span className="text-[10px] text-neutral-400 font-mono">
              {analyticsData.substepsCount} {tAnalytics.substepsCompleted.toLowerCase()}
            </span>
          </div>
        </div>

        {/* Productivity Grade & Velocity Index */}
        <div className="bg-[#09090b] border border-neutral-800 p-3 flex flex-col justify-between">
          <div className="text-[10px] uppercase text-neutral-400 flex items-center justify-between font-mono">
            <span>{tAnalytics.grade}</span>
            <Award className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            {(() => {
              const currentGrade = recommendation?.productivityGrade || analyticsData.grade;
              let gradeColor = 'text-emerald-300';
              if (currentGrade === 'S') gradeColor = 'text-amber-300';
              else if (currentGrade === 'A+' || currentGrade === 'A') gradeColor = 'text-emerald-400';
              else if (currentGrade === 'B') gradeColor = 'text-blue-400';
              else if (currentGrade === 'C') gradeColor = 'text-rose-400';

              return (
                <span className={`text-xl font-bold font-mono tracking-wider ${gradeColor}`}>
                  {currentGrade}
                </span>
              );
            })()}
            <div className="text-right">
              <span className="text-[10px] text-neutral-200 font-mono font-bold block">
                {analyticsData.successRate}% {tAnalytics.completionRate.toLowerCase()}
              </span>
              <span className="text-[8px] text-neutral-400 font-mono block">
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
      <div className="bg-[#08080a] border border-neutral-800 p-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 mb-2">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-amber-400" />
            <span className="text-xs font-bold uppercase font-mono tracking-wider text-neutral-200">
              {tAnalytics.volumeNorm}
            </span>
            <span className="text-[9px] font-mono text-neutral-400 px-1.5 py-0.5 bg-neutral-900 border border-neutral-800">
              {analyticsData.totalDelivered} / {analyticsData.targetVolume} {lang === 'uk' ? 'завдань' : 'tasks'} ({analyticsData.deliveredNormPercent}%)
            </span>
          </div>

          <div className="flex items-center gap-2 text-[9px] font-mono">
            <span className="text-neutral-500">
              {lang === 'uk'
                ? `Поріг грейдів: B ≥${analyticsData.minDeliveredForGrade.B} · A ≥${analyticsData.minDeliveredForGrade.A} · A+ ≥${analyticsData.minDeliveredForGrade.APlus} · S ≥${analyticsData.minDeliveredForGrade.S}`
                : `Cutoffs: B ≥${analyticsData.minDeliveredForGrade.B} · A ≥${analyticsData.minDeliveredForGrade.A} · A+ ≥${analyticsData.minDeliveredForGrade.APlus} · S ≥${analyticsData.minDeliveredForGrade.S}`}
            </span>
          </div>
        </div>

        {/* Progress Bar with Milestones */}
        <div className="w-full bg-neutral-900 h-2 border border-neutral-800 relative overflow-hidden">
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

        {/* Low Volume Advisory Callout if task count is critically low */}
        {analyticsData.isVolumeDeficit && (
          <div className="mt-2.5 px-2.5 py-1.5 bg-amber-950/20 border border-amber-800/40 text-[10px] font-mono text-amber-200/90 flex items-center justify-between gap-2">
            <span>
              {lang === 'uk'
                ? `⚠️ Зафіксовано лише ${analyticsData.totalDelivered} закритих завдань із місячної норми ${analyticsData.targetVolume}. 100% закриття на 1-3 завданнях не відображає реальної продуктивності. Додавайте щоденні атомарні справи для виходу на грейди A / S.`
                : `⚠️ Only ${analyticsData.totalDelivered} completed tasks recorded out of ${analyticsData.targetVolume} monthly target. 100% completion on 1-3 tasks does not reflect real productivity. Log daily atomic tasks to qualify for A / S grades.`}
            </span>
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------- */}
      {/* TIMELINE ACTIVITY & COMPLETION VELOCITY BAR CHART */}
      {/* ------------------------------------------------------------- */}
      <div className="bg-[#08080a] border border-neutral-800 p-3.5">
        <div className="flex items-center justify-between mb-3 border-b border-neutral-800/80 pb-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-3.5 h-3.5 text-neutral-300" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-200 font-mono">
              {tAnalytics.timelineVelocity}
            </h3>
          </div>
          <div className="flex items-center gap-3 text-[9px] font-mono text-neutral-400">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 bg-emerald-400 inline-block" />
              <span>{tAnalytics.completed}</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 bg-neutral-600 inline-block" />
              <span>{tAnalytics.dropped}</span>
            </span>
          </div>
        </div>

        {/* Velocity Bars Container */}
        <div className="grid grid-flow-col auto-cols-fr gap-1.5 items-end h-24 pt-4 px-1 bg-[#0c0c0e] border border-neutral-900">
          {analyticsData.velocityBars.map((bar, idx) => {
            const deliveredHeightPercent = Math.min(100, Math.round((bar.delivered / maxBarValue) * 100));
            const droppedHeightPercent = Math.min(100, Math.round((bar.dropped / maxBarValue) * 100));

            return (
              <div key={idx} className="flex flex-col items-center h-full justify-end group">
                <div className="w-full flex items-end justify-center gap-0.5 h-16 relative">
                  {/* Delivered Bar */}
                  <div
                    style={{ height: `${Math.max(deliveredHeightPercent, 4)}%` }}
                    className="w-full max-w-[14px] bg-emerald-500/80 group-hover:bg-emerald-400 transition-all rounded-none"
                    title={`${bar.label}: ${bar.delivered} ${tAnalytics.completed.toLowerCase()}`}
                  />
                  {/* Dropped Bar */}
                  {bar.dropped > 0 && (
                    <div
                      style={{ height: `${Math.max(droppedHeightPercent, 4)}%` }}
                      className="w-full max-w-[8px] bg-neutral-700 group-hover:bg-neutral-600 transition-all rounded-none"
                      title={`${bar.label}: ${bar.dropped} ${tAnalytics.dropped.toLowerCase()}`}
                    />
                  )}
                </div>
                <span className="text-[9px] font-mono text-neutral-400 group-hover:text-white mt-1">
                  {bar.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* CATEGORY PRODUCTIVITY BREAKDOWN & PRIORITY MATRIX */}
      {/* ------------------------------------------------------------- */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Category Breakdown in Period */}
        <div className="bg-[#08080a] border border-neutral-800 p-3.5">
          <div className="flex items-center justify-between mb-3 border-b border-neutral-800/80 pb-2">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-3.5 h-3.5 text-neutral-300" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-200">
                {tAnalytics.categoryDistribution}
              </h3>
            </div>
            <button
              id="dashboard-manage-tabs-period-btn"
              onClick={onOpenManageTabs}
              className="text-[10px] text-neutral-400 hover:text-white flex items-center gap-1 transition-colors font-mono"
            >
              <Sliders className="w-3 h-3" />
              <span>{t.manageTabs}</span>
            </button>
          </div>

          <div className="space-y-2">
            {analyticsData.categoryStats.map((tp) => (
              <div
                key={tp.id}
                onClick={() => {
                  sound.tick(600);
                  onSelectTab(tp.id);
                }}
                className="group cursor-pointer p-2 bg-[#0c0c0e] hover:bg-neutral-900 border border-neutral-800 hover:border-neutral-600 transition-all"
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
                    <span className="text-[10px] text-neutral-400">
                      ({tp.delivered}/{tp.total})
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-neutral-400">
                    <span className="font-bold text-neutral-300">{tp.percent}%</span>
                    <ArrowRight className="w-3 h-3 text-neutral-400 group-hover:text-white transition-transform group-hover:translate-x-0.5" />
                  </div>
                </div>

                {/* Micro Progress Bar */}
                <div className="w-full h-1 bg-neutral-900 overflow-hidden border border-neutral-800">
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
            className="w-full mt-3 py-1.5 px-3 bg-neutral-900 hover:bg-white text-neutral-300 hover:text-black border border-neutral-800 hover:border-white text-xs font-bold font-mono tracking-wider uppercase transition-all flex items-center justify-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t.injectNewOp}</span>
          </button>
        </div>

        {/* Priority Matrix & Urgent Action Queue */}
        <div className="bg-[#08080a] border border-neutral-800 p-3.5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3 border-b border-neutral-800/80 pb-2">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-rose-500" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-rose-300 font-mono">
                  {lang === 'uk' ? 'Фокус: Термінові справи' : 'Urgent Action Queue'}
                </h3>
              </div>
              <span className="text-[10px] font-mono text-neutral-400 px-1.5 py-0.5 bg-neutral-900 border border-neutral-800">
                {p1ActiveTasks.length + p2ActiveTasks.length} {lang === 'uk' ? 'активних' : 'queued'}
              </span>
            </div>

            {/* List of top priority active tasks */}
            <div className="space-y-1.5">
              {p1ActiveTasks.length === 0 && p2ActiveTasks.length === 0 ? (
                <div className="py-6 text-center border border-dashed border-neutral-800 p-4">
                  <CheckCircle2 className="w-5 h-5 mx-auto mb-2 text-emerald-400" />
                  <p className="text-xs text-neutral-300 font-bold uppercase font-mono">
                    {lang === 'uk' ? 'Всі термінові завдання закриті' : 'All urgent tasks cleared'}
                  </p>
                  <p className="text-[10px] text-neutral-400 mt-1 font-mono">
                    {lang === 'uk' ? 'Черга під повним контролем.' : 'Queue is fully under control.'}
                  </p>
                </div>
              ) : (
                [...p1ActiveTasks, ...p2ActiveTasks].slice(0, 4).map((task) => (
                  <div
                    key={task.id}
                    className={`flex items-start justify-between gap-2 p-2 border text-xs transition-colors font-mono ${
                      task.priority === 1
                        ? 'bg-rose-950/20 border-rose-900/40 text-neutral-200'
                        : 'bg-[#0c0c0e] border-neutral-800 text-neutral-300'
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
                        <p className="font-bold text-xs truncate text-white font-sans">{task.title}</p>
                        {task.note && (
                          <p className="text-[10px] text-neutral-400 truncate mt-0.5 font-mono">{task.note}</p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <span
                        className={`text-[9px] font-mono px-1.5 py-0.5 border ${
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
          <div className="mt-3 pt-3 border-t border-neutral-800">
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
              className="w-full py-2 px-3 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 hover:border-neutral-600 text-neutral-200 hover:text-white text-xs font-bold font-mono tracking-wider uppercase transition-all flex items-center justify-between cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <AIIcon id={aiIconVariant} className="w-3.5 h-3.5 text-neutral-300" />
                <span>{lang === 'uk' ? 'AI Тактичний розрахунок' : 'AI Tactical Plan'}</span>
              </div>
              <ArrowRight className="w-3 h-3 text-neutral-400" />
            </button>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* STRATEGIC AI PERIOD RETROSPECTIVE & RECOMMENDATIONS SECTION */}
      {/* ------------------------------------------------------------- */}
      <div className="bg-[#08080a] border border-neutral-800 p-3.5">
        {/* Header with Title, Status & Refresh */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 mb-2.5 border-b border-neutral-800">
          <div className="flex items-center gap-2 flex-wrap">
            <AIIcon id={aiIconVariant} className="w-4 h-4 text-neutral-300" />
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xs font-bold uppercase tracking-wider text-white font-mono">
                {tAnalytics.aiAuditTitle}
              </h2>
              <span className="text-[10px] font-mono px-1.5 py-0.5 bg-neutral-900 border border-neutral-800 text-neutral-300 flex items-center gap-1">
                <Clock className="w-3 h-3 text-neutral-400" />
                <span>{periodsList.find((p) => p.id === selectedPeriod)?.label || selectedPeriod}</span>
              </span>
              {recommendation?.workloadStatus && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 bg-neutral-900 border border-neutral-800 text-neutral-300">
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
              className="flex items-center gap-1.5 text-[10px] font-mono tracking-wider uppercase px-2 py-1 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 hover:border-neutral-600 text-neutral-300 hover:text-white transition-all disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-3 h-3 text-neutral-400 ${isLoadingRecs ? 'animate-spin' : ''}`} />
              <span>{isLoadingRecs ? tAnalytics.analyzing : tAnalytics.recalculate}</span>
            </button>
          </div>
        </div>

        {/* Schedule & Last Analysis Status Bar */}
        <div className="flex flex-wrap items-center justify-between gap-1 text-[10px] font-mono text-neutral-400 mb-3 px-2 py-1 bg-[#0c0c0e] border border-neutral-900">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>
              {lang === 'uk'
                ? `Враховано ${analyticsData.totalTracked} завдань (включно з архівом та видаленими) за ${periodsList.find((p) => p.id === selectedPeriod)?.label}`
                : `Analyzed ${analyticsData.totalTracked} tasks (active, completed & archived) for ${selectedPeriod}`}
            </span>
          </div>
          {lastAnalyzedAt && lastSlotType && (
            <span className="text-neutral-500">
              {lang === 'uk'
                ? `Останній аналіз: ${formatTimeShort(lastAnalyzedAt, lang)} (${getSlotLabel(lastSlotType, lang)})`
                : `Last analyzed: ${formatTimeShort(lastAnalyzedAt, lang)} (${getSlotLabel(lastSlotType, lang)})`}
            </span>
          )}
        </div>

        {/* 3 AI Analytics Insight Blocks */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-3">
          {/* Period Retrospective */}
          <div className="p-2.5 bg-[#0c0c0e] border border-neutral-850 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase text-neutral-400 mb-1">
                <Target className="w-3 h-3 text-emerald-400" />
                <span>{tAnalytics.aiRetrospective}</span>
              </div>
              <p className="text-xs text-neutral-200 leading-relaxed font-sans">
                {recommendation?.periodRetrospective ||
                  (lang === 'uk'
                    ? `Зафіксовано ${analyticsData.totalTracked} завдань із рівнем успішності ${analyticsData.successRate}%.`
                    : `Recorded ${analyticsData.totalTracked} tasks with ${analyticsData.successRate}% completion.`)}
              </p>
            </div>
          </div>

          {/* Dropoff & Bottlenecks Analysis */}
          <div className="p-2.5 bg-[#0c0c0e] border border-neutral-850 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase text-neutral-400 mb-1">
                <AlertTriangle className="w-3 h-3 text-amber-400" />
                <span>{tAnalytics.aiDropoffAnalysis}</span>
              </div>
              <p className="text-xs text-neutral-300 leading-relaxed font-sans">
                {recommendation?.dropoffAnalysis ||
                  (lang === 'uk'
                    ? `Утилізовано ${analyticsData.totalDropped} завдань для утримання високої концентрації на головному.`
                    : `${analyticsData.totalDropped} dropped items analyzed.`)}
              </p>
            </div>
          </div>

          {/* Future Strategic Guidance */}
          <div className="p-2.5 bg-[#0c0c0e] border border-neutral-850 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase text-neutral-400 mb-1">
                <Compass className="w-3 h-3 text-blue-400" />
                <span>{tAnalytics.aiFutureStrategy}</span>
              </div>
              <p className="text-xs text-neutral-300 leading-relaxed font-sans">
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
              <h3 className="text-xs font-bold font-mono uppercase tracking-wider text-neutral-300">
                {lang === 'uk' ? 'Рекомендовані наступні кроки' : 'Suggested Action Items'}
              </h3>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {(recommendation?.suggestedTasks || []).map((st, idx) => {
              const isAdded = addedTaskTitles.includes(st.title);
              const tabName = tabs.find((tb) => tb.id === st.phase)?.name || st.phase;

              return (
                <div
                  key={idx}
                  className="p-2.5 bg-[#0c0c0e] border border-neutral-850 hover:border-neutral-700 flex flex-col justify-between transition-colors"
                >
                  <div>
                    <div className="flex items-center justify-between gap-1 mb-1.5">
                      <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 bg-neutral-900 border border-neutral-800 text-neutral-400 truncate max-w-[100px]">
                        {tabName}
                      </span>
                      <span
                        className={`text-[9px] font-mono px-1.5 py-0.5 border ${
                          st.priority === 1
                            ? 'border-neutral-700 text-rose-300 bg-neutral-900'
                            : 'border-neutral-800 text-neutral-400 bg-neutral-900'
                        }`}
                      >
                        P{st.priority}
                      </span>
                    </div>

                    <h4 className="text-xs font-bold text-white mb-1 leading-snug line-clamp-2 font-sans">
                      {st.title}
                    </h4>

                    {st.reason && (
                      <p className="text-[10px] text-neutral-400 font-sans mb-2 line-clamp-2">
                        ↳ {st.reason}
                      </p>
                    )}
                  </div>

                  <div className="mt-2 pt-2 border-t border-neutral-800/80 flex items-center gap-1.5">
                    <button
                      onClick={() => handleAddSuggestedTask(st)}
                      disabled={isAdded}
                      className={`flex-1 py-1 px-2 text-[10px] font-mono font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-1 border cursor-pointer ${
                        isAdded
                          ? 'bg-neutral-900 border-neutral-800 text-neutral-500 cursor-default'
                          : 'bg-white hover:bg-neutral-200 text-black border-white hover:border-neutral-200'
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
                      className="p-1 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-400 hover:text-white cursor-pointer"
                    >
                      <AIIcon id={aiIconVariant} className="w-3 h-3 text-neutral-400 hover:text-white" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export const DashboardView = React.memo(DashboardViewComponent);
