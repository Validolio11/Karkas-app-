import React, { useState, useMemo } from 'react';
import { PSTask, DeletedTask, TaskTab } from '../types';
import { Language, TRANSLATIONS } from '../utils/i18n';
import {
  History,
  RotateCcw,
  Trash2,
  CheckCircle2,
  ArrowLeft,
  Search,
  Calendar,
  AlertTriangle,
  X,
  Layers,
  ChevronRight,
  Timer,
} from 'lucide-react';
import { sound } from '../utils/audio';

interface HistoryViewProps {
  tasks: PSTask[];
  deletedTasks: DeletedTask[];
  tabs: TaskTab[];
  lang: Language;
  onBackToTasks: () => void;
  onToggleDone: (taskId: string) => void;
  onRestoreDeleted: (task: DeletedTask) => void;
  onPermanentDelete: (taskId: string) => void;
  onClearDeleted: () => void;
}

type HistoryTabFilter = 'ALL' | 'COMPLETED' | 'DELETED';

const HistoryViewComponent: React.FC<HistoryViewProps> = ({
  tasks,
  deletedTasks,
  tabs,
  lang,
  onBackToTasks,
  onToggleDone,
  onRestoreDeleted,
  onPermanentDelete,
  onClearDeleted,
}) => {
  const t = TRANSLATIONS[lang];
  const hv = t.historyView;

  const [activeSubFilter, setActiveSubFilter] = useState<HistoryTabFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Completed tasks from current active tasks
  const completedTasks = useMemo(() => {
    return tasks.filter((t) => t.done);
  }, [tasks]);

  // Tab lookup map for fast tab names & colors
  const tabMap = useMemo(() => {
    const map = new Map<string, TaskTab>();
    tabs.forEach((tab) => map.set(tab.id, tab));
    return map;
  }, [tabs]);

  // Unified items list with tag 'COMPLETED' or 'DELETED'
  interface HistoryItem {
    type: 'COMPLETED' | 'DELETED';
    task: PSTask | DeletedTask;
    timestamp: number;
  }

  const allHistoryItems = useMemo<HistoryItem[]>(() => {
    const list: HistoryItem[] = [];

    // Add completed tasks
    completedTasks.forEach((task) => {
      list.push({
        type: 'COMPLETED',
        task,
        timestamp: task.completedAt || task.createdAt,
      });
    });

    // Add deleted tasks
    deletedTasks.forEach((task) => {
      list.push({
        type: 'DELETED',
        task,
        timestamp: task.deletedAt,
      });
    });

    // Sort newest timestamp first
    return list.sort((a, b) => b.timestamp - a.timestamp);
  }, [completedTasks, deletedTasks]);

  // Filtered by sub-tab and search query
  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return allHistoryItems.filter((item) => {
      if (activeSubFilter === 'COMPLETED' && item.type !== 'COMPLETED') return false;
      if (activeSubFilter === 'DELETED' && item.type !== 'DELETED') return false;

      if (!query) return true;

      const titleMatch = item.task.title.toLowerCase().includes(query);
      const noteMatch = item.task.note?.toLowerCase().includes(query) ?? false;
      const stepMatch =
        item.task.stepList?.some((s) => s.title.toLowerCase().includes(query)) ?? false;
      const tabNameMatch = tabMap.get(item.task.phase)?.name.toLowerCase().includes(query) ?? false;

      return titleMatch || noteMatch || stepMatch || tabNameMatch;
    });
  }, [allHistoryItems, activeSubFilter, searchQuery, tabMap]);

  // Format date helper
  const formatTimestamp = (ms: number) => {
    const date = new Date(ms);
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${day}.${month} ${hours}:${minutes}`;
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* Top Navigation & Status Bar */}
      <div className="p-3.5 sm:p-4 bg-[#0a0a0c] border border-neutral-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            id="history-back-to-tasks-btn"
            onClick={() => {
              sound.tick(600);
              onBackToTasks();
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-900 hover:bg-white text-neutral-300 hover:text-black border border-neutral-700 hover:border-white text-xs font-mono font-bold tracking-wider uppercase transition-all cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>{hv.backToTasks}</span>
          </button>

          <div>
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-white" />
              <h1 className="text-sm font-mono font-bold tracking-wider uppercase text-white">
                {hv.title}
              </h1>
            </div>
            <p className="text-xs text-neutral-400 font-sans mt-2 leading-relaxed">
              {hv.subtitle}
            </p>
          </div>
        </div>

        {/* Counter Summary Pills */}
        <div className="flex items-center gap-2 text-xs font-mono flex-wrap">
          <div className="px-2 py-1 bg-black border border-neutral-800 text-neutral-300 flex items-center gap-1.5">
            <span className="text-neutral-500">{hv.totalCount}:</span>
            <span className="font-bold text-white">{allHistoryItems.length}</span>
          </div>
          <div className="px-2 py-1 bg-black border border-neutral-800 text-neutral-300 flex items-center gap-1.5">
            <CheckCircle2 className="w-3 h-3 text-neutral-300" />
            <span className="text-neutral-500">{hv.completedCount}:</span>
            <span className="font-bold text-white">{completedTasks.length}</span>
          </div>
          <div className="px-2 py-1 bg-black border border-neutral-800 text-neutral-300 flex items-center gap-1.5">
            <Trash2 className="w-3 h-3 text-neutral-400" />
            <span className="text-neutral-500">{hv.deletedCount}:</span>
            <span className="font-bold text-white">{deletedTasks.length}</span>
          </div>
        </div>
      </div>

      {/* Control Rail: Sub-filters, Search, and Clear Button */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 bg-[#09090b] border border-neutral-800 p-2.5">
        {/* Filter Switcher */}
        <div className="flex items-center gap-1">
          <button
            id="history-filter-all"
            onClick={() => {
              sound.tick(500);
              setActiveSubFilter('ALL');
            }}
            className={`px-2.5 py-1 text-xs font-mono tracking-wider border uppercase transition-all cursor-pointer ${
              activeSubFilter === 'ALL'
                ? 'border-white bg-white text-black font-extrabold'
                : 'border-neutral-800 bg-black text-neutral-400 hover:text-white hover:border-neutral-700'
            }`}
          >
            {hv.all} ({allHistoryItems.length})
          </button>

          <button
            id="history-filter-completed"
            onClick={() => {
              sound.tick(500);
              setActiveSubFilter('COMPLETED');
            }}
            className={`flex items-center gap-1 px-2.5 py-1 text-xs font-mono tracking-wider border uppercase transition-all cursor-pointer ${
              activeSubFilter === 'COMPLETED'
                ? 'border-white bg-white text-black font-extrabold'
                : 'border-neutral-800 bg-black text-neutral-400 hover:text-white hover:border-neutral-700'
            }`}
          >
            <CheckCircle2 className="w-3 h-3" />
            <span>{hv.completed} ({completedTasks.length})</span>
          </button>

          <button
            id="history-filter-deleted"
            onClick={() => {
              sound.tick(500);
              setActiveSubFilter('DELETED');
            }}
            className={`flex items-center gap-1 px-2.5 py-1 text-xs font-mono tracking-wider border uppercase transition-all cursor-pointer ${
              activeSubFilter === 'DELETED'
                ? 'border-white bg-white text-black font-extrabold'
                : 'border-neutral-800 bg-black text-neutral-400 hover:text-white hover:border-neutral-700'
            }`}
          >
            <Trash2 className="w-3 h-3" />
            <span>{hv.deleted} ({deletedTasks.length})</span>
          </button>
        </div>

        {/* Right side: Search & Clear Actions */}
        <div className="flex items-center gap-2">
          {/* Instant Search Bar */}
          <div className="relative flex-1 sm:w-56">
            <Search className="w-3 h-3 text-neutral-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={hv.searchPlaceholder}
              className="w-full bg-black border border-neutral-800 text-xs font-mono text-white placeholder:text-neutral-500 pl-7 pr-3 py-2.5 outline-none focus:border-neutral-500 transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Clear Deleted History Button */}
          {deletedTasks.length > 0 && (
            <button
              id="clear-deleted-history-btn"
              onClick={() => {
                sound.tick(400);
                setShowClearConfirm(true);
              }}
              title={hv.clearDeleted}
              className="px-2 py-1 bg-black border border-neutral-800 hover:border-red-600 hover:text-red-400 text-neutral-400 text-xs font-mono tracking-wider uppercase transition-colors whitespace-nowrap cursor-pointer flex items-center gap-1"
            >
              <Trash2 className="w-3 h-3" />
              <span>{hv.clearDeleted}</span>
            </button>
          )}
        </div>
      </div>

      {/* Confirmation Banner for Clearing Deleted Archive */}
      {showClearConfirm && (
        <div className="p-3 bg-red-950/40 border border-red-800/80 flex items-center justify-between gap-3 text-xs font-mono animate-in fade-in">
          <div className="flex items-center gap-2 text-red-300">
            <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
            <span>{hv.clearConfirm}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                onClearDeleted();
                setShowClearConfirm(false);
              }}
              className="px-2.5 py-1 bg-red-600 hover:bg-red-500 text-white font-bold uppercase transition-colors cursor-pointer"
            >
              {lang === 'uk' ? 'ТАК, ОЧИСТИТИ' : 'YES, CLEAR'}
            </button>
            <button
              onClick={() => setShowClearConfirm(false)}
              className="px-2.5 py-1 border border-neutral-700 bg-neutral-900 text-neutral-300 hover:text-white uppercase transition-colors cursor-pointer"
            >
              {lang === 'uk' ? 'СКАСУВАТИ' : 'CANCEL'}
            </button>
          </div>
        </div>
      )}

      {/* History Items List */}
      <div className="space-y-2">
        {filteredItems.length === 0 ? (
          /* Empty State */
          <div className="p-8 sm:p-12 text-center border border-dashed border-neutral-800 bg-[#0a0a0c]">
            <History className="w-8 h-8 text-neutral-600 mx-auto mb-3" />
            <h3 className="text-xs sm:text-sm font-mono font-bold tracking-wider text-neutral-300 uppercase">
              {activeSubFilter === 'COMPLETED'
                ? hv.emptyCompleted
                : activeSubFilter === 'DELETED'
                ? hv.emptyDeleted
                : hv.emptyAll}
            </h3>
            <p className="text-xs text-neutral-500 font-sans max-w-sm mx-auto mt-1">
              {activeSubFilter === 'COMPLETED'
                ? hv.emptyCompletedDesc
                : activeSubFilter === 'DELETED'
                ? hv.emptyDeletedDesc
                : hv.emptyAllDesc}
            </p>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="mt-3 text-xs font-mono text-white underline hover:text-neutral-300"
              >
                {lang === 'uk' ? 'Скинути пошук' : 'Clear search query'}
              </button>
            )}
          </div>
        ) : (
          filteredItems.map(({ type, task, timestamp }) => {
            const isCompleted = type === 'COMPLETED';
            const tabObj = tabMap.get(task.phase);
            const tabName = (t.phases as any)[task.phase] || tabObj?.name || task.phase;
            const completedSteps = task.stepList
              ? task.stepList.filter((s) => s.done).length
              : task.currentStep;
            const totalSteps = task.steps || 1;

            return (
              <div
                key={`${type}-${task.id}`}
                className={`p-3.5 sm:p-4 border transition-all bg-[#0a0a0c] ${
                  isCompleted
                    ? 'border-neutral-800 hover:border-neutral-700'
                    : 'border-neutral-800/80 hover:border-neutral-700 bg-neutral-950/70'
                }`}
              >
                {/* Header line: Badges & Timestamp */}
                <div className="flex items-center justify-between gap-2 flex-wrap text-xs font-mono mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Status Badge */}
                    {isCompleted ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 border border-white bg-white text-black font-extrabold uppercase">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>{hv.badgeCompleted}</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 border border-neutral-700 bg-neutral-900 text-neutral-300 font-extrabold uppercase">
                        <Trash2 className="w-3 h-3 text-neutral-400" />
                        <span>{hv.badgeDeleted}</span>
                      </span>
                    )}

                    {/* Tab Badge */}
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 border border-neutral-800 bg-black text-neutral-300 uppercase">
                      {tabObj?.color && (
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ backgroundColor: tabObj.color }}
                        />
                      )}
                      <span>{tabName}</span>
                    </span>

                    {/* Priority Badge */}
                    <span
                      className={`px-1.5 py-0.5 border text-xs uppercase font-bold ${
                        task.priority === 1
                          ? 'border-red-800 text-red-400 bg-red-950/20'
                          : task.priority === 2
                          ? 'border-yellow-800 text-yellow-400 bg-yellow-950/20'
                          : 'border-neutral-800 text-neutral-400 bg-black'
                      }`}
                    >
                      P{task.priority}
                    </span>

                    {/* Progress tag if multi-step */}
                    {totalSteps > 1 && (
                      <span className="text-neutral-500 font-mono">
                        [{completedSteps}/{totalSteps} {hv.stepsCompleted}]
                      </span>
                    )}

                    {/* Time spent duration pill */}
                    {task.timeSpentSeconds && task.timeSpentSeconds > 0 ? (
                      <span
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 border border-neutral-800 bg-black text-xs font-mono text-neutral-300"
                        title={lang === 'uk' ? 'Витрачено часу на завдання' : 'Time spent on task'}
                      >
                        <Timer className="w-2.5 h-2.5 text-neutral-400" />
                        <span>
                          {task.timeSpentSeconds >= 3600
                            ? `${Math.floor(task.timeSpentSeconds / 3600)}h ${Math.floor((task.timeSpentSeconds % 3600) / 60)}m`
                            : task.timeSpentSeconds >= 60
                            ? `${Math.floor(task.timeSpentSeconds / 60)}m ${task.timeSpentSeconds % 60}s`
                            : `${task.timeSpentSeconds}s`}
                        </span>
                      </span>
                    ) : null}
                  </div>

                  {/* Timestamp */}
                  <div className="flex items-center gap-1 text-neutral-400">
                    <Calendar className="w-3 h-3 text-neutral-400" />
                    <span>
                      {isCompleted ? hv.completedAtPrefix : hv.deletedAtPrefix}:{' '}
                      {formatTimestamp(timestamp)}
                    </span>
                  </div>
                </div>

                {/* Task Title */}
                <div className="mb-2">
                  <h3
                    className={`text-sm sm:text-base font-sans font-medium leading-snug ${
                      isCompleted
                        ? 'text-neutral-400 line-through'
                        : 'text-neutral-300'
                    }`}
                  >
                    {task.title}
                  </h3>

                  {/* Optional Note */}
                  {task.note && (
                    <p className="text-xs font-sans text-neutral-500 mt-1 line-clamp-2">
                      {task.note}
                    </p>
                  )}
                </div>

                {/* Sub-steps Preview (if any) */}
                {task.stepList && task.stepList.length > 0 && (
                  <div className="mb-3 pt-2 border-t border-neutral-900 space-y-1">
                    {task.stepList.map((st, idx) => (
                      <div
                        key={st.id || idx}
                        className="flex items-center gap-2 text-xs font-mono text-neutral-400"
                      >
                        <span
                          className={`w-1.5 h-1.5 ${
                            st.done ? 'bg-white' : 'border border-neutral-600'
                          }`}
                        />
                        <span className={st.done ? 'line-through text-neutral-500' : 'text-neutral-400'}>
                          {st.title}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Bottom Action Buttons */}
                <div className="pt-2 border-t border-neutral-900/80 flex items-center justify-between flex-wrap gap-2 text-xs font-mono">
                  <div className="text-xs text-neutral-400">
                    <span>{hv.createdAtPrefix}: {formatTimestamp(task.createdAt)}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    {isCompleted ? (
                      /* Restore Completed Task to Active Queue */
                      <button
                        id={`restore-completed-task-${task.id}`}
                        onClick={() => {
                          sound.activate();
                          onToggleDone(task.id);
                        }}
                        className="flex items-center gap-1.5 px-3 py-1 bg-white hover:bg-neutral-200 text-black border border-white text-xs font-mono font-bold uppercase transition-colors cursor-pointer"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>{hv.restoreToActive}</span>
                      </button>
                    ) : (
                      /* Restore Deleted Task & Permanent Delete */
                      <>
                        <button
                          id={`restore-deleted-task-${task.id}`}
                          onClick={() => {
                            sound.activate();
                            onRestoreDeleted(task as DeletedTask);
                          }}
                          className="flex items-center gap-1.5 px-3 py-1 bg-white hover:bg-neutral-200 text-black border border-white text-xs font-mono font-bold uppercase transition-colors cursor-pointer"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>{hv.restoreDeleted}</span>
                        </button>

                        <button
                          id={`permanent-delete-task-${task.id}`}
                          onClick={() => {
                            sound.tick(300);
                            onPermanentDelete(task.id);
                          }}
                          title={hv.permanentDelete}
                          className="p-1 border border-neutral-800 hover:border-red-600 text-neutral-500 hover:text-red-400 bg-black transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export const HistoryView = React.memo(HistoryViewComponent);
