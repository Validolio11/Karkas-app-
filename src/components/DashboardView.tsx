import React, { useState, useMemo } from 'react';
import {
  PSTask,
  TaskTab,
  WorkflowStats,
  DeletedTask,
  AnalyticsPeriod,
} from '../types';
import { Language, TRANSLATIONS } from '../utils/i18n';
import { getRollingWindows, selectPeriodTasks } from './workflowViewModel';
import { sound } from '../utils/audio';
import {
  CheckCircle2,
  Clock,
  Layers,
  ArrowRight,
  Plus,
  Sliders,
  Check,
  Calendar,
  BarChart3,
  Trash2,
  Target,
} from 'lucide-react';
import { AIIcon, AIIconId } from './AIIconTemplates';
import { ActivityChart } from './ActivityChart';
import { selectRelevantArchivedTasks } from '../utils/taskArchive';
import { formatRecordedDuration, recordedTaskSeconds, summarizeTaskTime } from '../utils/taskTimeStats';

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
  lang,
  aiIconVariant,
  onSelectTab,
  onToggleDone,
  onOpenAI,
  onOpenAdd,
  onOpenManageTabs,
}) => {
  const t = TRANSLATIONS[lang];
  const tAnalytics = t.dashboardAnalytics || (TRANSLATIONS.uk.dashboardAnalytics as any);

  // Selected period for comprehensive historical analytics
  const [selectedPeriod, setSelectedPeriod] = useState<AnalyticsPeriod>('THIS_MONTH');
  const relevantDeletedTasks = useMemo(() => selectRelevantArchivedTasks(tasks, deletedTasks), [tasks, deletedTasks]);
  // -------------------------------------------------------------
  // Comprehensive Period Filtering & Math Calculations
  // -------------------------------------------------------------
  const analyticsData = useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    const { activeInPeriod, completedInPeriod, deletedCompleted, droppedInPeriod, createdInPeriod } =
      selectPeriodTasks(tasks, relevantDeletedTasks, selectedPeriod, now);

    const totalDelivered = completedInPeriod.length + deletedCompleted.length;
    const completedTimeTasks = [...completedInPeriod, ...deletedCompleted];
    const timeSummary = summarizeTaskTime(completedTimeTasks);
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
        const stepCount = Number.isFinite(t.steps) ? Math.max(0, Math.floor(t.steps)) : 0;
        const actualProgress = Number.isFinite(t.currentStep) ? Math.max(0, Math.floor(t.currentStep)) : 0;
        substepsCount += Math.min(stepCount, actualProgress);
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

        const mCreated = createdInPeriod.filter((t) => {
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
      const nowMs = now.getTime();
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
        const allTimestamps = [...tasks, ...relevantDeletedTasks]
          .map((t) => t.createdAt || 0)
          .filter((t) => t > 0);
        const earliest = allTimestamps.length > 0 ? Math.min(...allTimestamps) : nowMs - 30 * 24 * 60 * 60 * 1000;
        pStart = Math.min(earliest, nowMs - 7 * 24 * 60 * 60 * 1000);
        pEnd = nowMs;
      }

      const windows = getRollingWindows(pEnd, (pEnd - pStart) / (24 * 60 * 60 * 1000));

      for (let w = 1; w <= 4; w++) {
        const label = lang === 'uk' ? `Т-${w}` : `W${w}`;
        const window = windows[w - 1];
        const inWindow = (ts: number) =>
          (window.includeStart ? ts >= window.start : ts > window.start) && ts <= window.end;

        const wDelivered = [...completedInPeriod, ...deletedCompleted].filter((t) => {
          const ts = t.completedAt || t.createdAt || 0;
          return inWindow(ts);
        }).length;

        const wDropped = droppedInPeriod.filter((t) => {
          const ts = t.deletedAt || t.createdAt || 0;
          return inWindow(ts);
        }).length;

        const wCreated = createdInPeriod.filter((t) => {
          const ts = t.createdAt || 0;
          return inWindow(ts);
        }).length;

        velocityBars.push({
          label,
          delivered: wDelivered,
          dropped: wDropped,
          created: wCreated,
        });
      }
    }

    return {
      completedTimeTasks,
      timeSummary,
      totalTracked,
      totalCreated: createdInPeriod.length,
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
    };
  }, [tasks, relevantDeletedTasks, tabs, selectedPeriod, lang, t.phases]);

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

  const handleAnalyzeTime = () => {
    const periodLabel = periodsList.find(item => item.id === selectedPeriod)?.label || selectedPeriod;
    const summary = analyticsData.timeSummary;
    const examples = analyticsData.completedTimeTasks.filter(task => recordedTaskSeconds(task) !== null)
      .sort((a, b) => (recordedTaskSeconds(b) || 0) - (recordedTaskSeconds(a) || 0)).slice(0, 5)
      .map(task => `${task.title}: ${formatRecordedDuration(recordedTaskSeconds(task), lang)}`).join('; ');
    onOpenAI(lang === 'uk'
      ? `Проаналізуй час роботи за період «${periodLabel}», спираючись насамперед на ці дані періоду. Виміряно ${summary.measuredTasks} із ${analyticsData.totalDelivered} завершених завдань; всього ${formatRecordedDuration(summary.totalSeconds, lang)}, середнє ${formatRecordedDuration(summary.averageSeconds, lang)}. Найдовші виміряні завдання (до 5): ${examples}. Запропонуй зручні блоки роботи й резерв часу.`
      : `Analyze work time for "${periodLabel}", prioritizing these selected-period facts. Measured ${summary.measuredTasks} of ${analyticsData.totalDelivered} completed tasks; total ${formatRecordedDuration(summary.totalSeconds, lang)}, average ${formatRecordedDuration(summary.averageSeconds, lang)}. Longest measured tasks (up to 5): ${examples}. Suggest practical work blocks and buffer time.`);
  };

  return (
    <div className="space-y-8 font-sans leading-relaxed">
      {/* ------------------------------------------------------------- */}
      {/* PERIOD SELECTOR & HEADER BAR */}
      {/* ------------------------------------------------------------- */}
      <div className="border-b border-neutral-800/80 pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 mb-3">
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-1.5 bg-white" />
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-white font-sans flex flex-wrap items-center gap-2">
                <span>{tAnalytics.title}</span>
              </h2>
            </div>
          </div>

        </div>

        {/* Period Selector Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          <span className="text-[11px] uppercase text-neutral-400 font-sans shrink-0 mr-1 flex items-center gap-1">
            <Calendar className="w-3 h-3 text-neutral-400" />
            <span>{tAnalytics.periodLabel}:</span>
          </span>

          {periodsList.map((p) => {
            const isSelected = selectedPeriod === p.id;
            return (
              <button
                key={p.id}
                id={`period-btn-${p.id}`}
                aria-pressed={isSelected}
                onClick={() => {
                  sound.tick(550);
                  setSelectedPeriod(p.id);
                }}
                className={`shrink-0 px-3 py-2 text-xs font-sans font-bold tracking-wider uppercase whitespace-nowrap transition-colors cursor-pointer ${
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
          <div className="text-xs uppercase text-neutral-400 flex items-center justify-between gap-3 font-sans">
            <span>{tAnalytics.totalPool}</span>
            <Layers className="w-3.5 h-3.5 text-neutral-400" />
          </div>
          <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
            <span className="text-2xl font-bold text-white font-sans">{analyticsData.totalTracked}</span>
            <span className="text-xs text-neutral-400 font-sans">
              {lang === 'uk' ? 'за вибраний період' : 'in selected period'}
            </span>
          </div>
        </div>

        {/* Successfully Delivered / Completed */}
        <div className="bg-[#09090b] p-5 flex flex-col justify-between">
          <div className="text-xs uppercase text-neutral-400 flex items-center justify-between gap-3 font-sans">
            <span>{tAnalytics.completed}</span>
            <CheckCircle2 className="w-3.5 h-3.5 text-neutral-400" />
          </div>
          <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
            <span className="text-2xl font-bold text-white font-sans">{analyticsData.totalDelivered}</span>
            <span className="text-xs text-neutral-400 font-sans font-bold">
              {analyticsData.substepsCount} {tAnalytics.substepsCompleted.toLowerCase()}
            </span>
          </div>
        </div>

        {/* Dropped / Deleted in Period */}
        <div className="bg-[#09090b] p-5 flex flex-col justify-between">
          <div className="text-xs uppercase text-neutral-400 flex items-center justify-between gap-3 font-sans">
            <span>{tAnalytics.dropped}</span>
            <Trash2 className="w-3.5 h-3.5 text-neutral-400" />
          </div>
          <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
            <span className="text-2xl font-bold text-neutral-300 font-sans">{analyticsData.totalDropped}</span>
            <span className="text-xs text-neutral-400 font-sans">
              {analyticsData.substepsCount} {tAnalytics.substepsCompleted.toLowerCase()}
            </span>
          </div>
        </div>

        <div className="bg-[#09090b] p-5 flex flex-col justify-between"><div className="text-xs uppercase text-neutral-400 flex items-center justify-between gap-3"><span>{lang === 'uk' ? 'Активні завдання' : 'Active tasks'}</span><Target className="w-3.5 h-3.5" /></div><div className="mt-3 text-2xl font-bold text-white">{analyticsData.totalActive}</div></div>
      </div>

      <section className="border border-neutral-800/70 bg-[#09090b] p-5" aria-label={lang === 'uk' ? 'Час виконання завдань' : 'Task completion time'}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-base font-bold text-white"><Clock className="h-4 w-4" />{lang === 'uk' ? 'Час виконання завдань' : 'Task completion time'}</h2>
          <button type="button" disabled={analyticsData.timeSummary.measuredTasks === 0}
            onClick={handleAnalyzeTime}
            className="flex min-h-11 items-center gap-2 border border-neutral-700 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40">
            <AIIcon id={aiIconVariant} className="h-4 w-4" />{lang === 'uk' ? 'Аналіз часу AI' : 'AI time analysis'}
          </button>
        </div>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <div><dt className="text-sm text-neutral-400">{lang === 'uk' ? 'Всього за завершені завдання' : 'Total for completed tasks'}</dt><dd className="mt-1 text-2xl font-bold tabular-nums text-white">{formatRecordedDuration(analyticsData.timeSummary.measuredTasks ? analyticsData.timeSummary.totalSeconds : null, lang)}</dd></div>
          <div><dt className="text-sm text-neutral-400">{lang === 'uk' ? 'Середній час виміряного завдання' : 'Average per measured task'}</dt><dd className="mt-1 text-2xl font-bold tabular-nums text-white">{formatRecordedDuration(analyticsData.timeSummary.averageSeconds, lang)}</dd></div>
        </dl>
        <p className="mt-3 text-sm leading-relaxed text-neutral-400">{lang === 'uk'
          ? `Виміряно ${analyticsData.timeSummary.measuredTasks} із ${analyticsData.totalDelivered} завершених завдань. Враховано час роботи таймера, без пауз. Завдання без записаного часу не занижують середнє.`
          : `Measured ${analyticsData.timeSummary.measuredTasks} of ${analyticsData.totalDelivered} completed tasks. Includes recorded timer work, excluding pauses. Tasks without recorded time do not lower the average.`}</p>
        {analyticsData.completedTimeTasks.length > 0 && <details className="mt-3 border-t border-neutral-800">
          <summary className="flex min-h-11 cursor-pointer items-center py-2 text-sm font-semibold text-neutral-200">{lang === 'uk' ? 'Час кожного завдання' : 'Time per task'}</summary>
          <ul className="max-h-72 overflow-auto divide-y divide-neutral-800">{analyticsData.completedTimeTasks.map(task => <li key={task.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 text-sm"><span className="min-w-0 break-words text-neutral-200">{task.title}</span><span className="shrink-0 tabular-nums text-neutral-400">{formatRecordedDuration(recordedTaskSeconds(task), lang)}</span></li>)}</ul>
        </details>}
      </section>

      {/* Activity over the selected period */}
      <ActivityChart
        key={selectedPeriod}
        data={analyticsData.velocityBars}
        title={tAnalytics.timelineVelocity}
        period={periodsList.find(period => period.id === selectedPeriod)?.label || ''}
        completedLabel={tAnalytics.completed}
        deletedLabel={tAnalytics.dropped}
        unitLabel={lang === 'uk' ? '\u041a\u0456\u043b\u044c\u043a\u0456\u0441\u0442\u044c \u0437\u0430\u0432\u0434\u0430\u043d\u044c' : 'Task count'}
        emptyLabel={lang === 'uk' ? 'За цей період ще немає виконаних чи явно скасованих завдань.' : 'No completed or explicitly cancelled tasks in this period yet.'}
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
              className="text-xs text-neutral-400 hover:text-white flex items-center gap-1 transition-colors font-sans"
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
                <div className="flex items-center justify-between gap-2 text-xs mb-1.5 font-sans">
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    {tp.color && (
                      <span
                        className="w-2 h-2 shrink-0 border border-white/20 shadow-sm"
                        style={{ backgroundColor: tp.color }}
                      />
                    )}
                    <span className="font-bold text-white group-hover:text-neutral-200 transition-colors break-words min-w-0">
                      {tp.name}
                    </span>
                    <span className="text-xs text-neutral-400">
                      ({tp.delivered}/{tp.total})
                    </span>
                  </div>
                  <div className="flex items-center shrink-0 gap-1.5 text-xs text-neutral-400">
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
                <h3 className="text-sm font-bold uppercase tracking-wider text-neutral-200 font-sans">
                  {lang === 'uk' ? 'Фокус: Термінові справи' : 'Urgent Action Queue'}
                </h3>
              </div>
              <span className="text-xs font-sans text-neutral-400">
                {p1ActiveTasks.length + p2ActiveTasks.length} {lang === 'uk' ? 'активних' : 'queued'}
              </span>
            </div>

            {/* List of top priority active tasks */}
            <div className="space-y-3">
              {p1ActiveTasks.length === 0 && p2ActiveTasks.length === 0 ? (
                <div className="py-6 text-center">
                  <CheckCircle2 className="w-5 h-5 mx-auto mb-2 text-neutral-400" />
                  <p className="text-xs text-neutral-300 font-bold uppercase font-sans">
                    {lang === 'uk' ? 'Всі термінові завдання закриті' : 'All urgent tasks cleared'}
                  </p>
                </div>
              ) : (
                [...p1ActiveTasks, ...p2ActiveTasks].slice(0, 4).map((task) => (
                  <div
                    key={task.id}
                    className={`flex items-start justify-between gap-3 border-l-2 px-3 py-3 text-xs transition-colors font-sans ${
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
                          <p title={task.note} className="text-xs text-neutral-400 break-words line-clamp-2 mt-0.5 font-sans">{task.note}</p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <span
                        className={`text-[11px] font-sans px-1.5 py-0.5 border ${
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

        </section>
      </div>

      {/* ------------------------------------------------------------- */}
    </div>
  );
};

export const DashboardView = React.memo(DashboardViewComponent);
