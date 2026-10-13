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
  AlertTriangle,
  X,
  Timer,
} from 'lucide-react';
import { sound } from '../utils/audio';
import { isCompletedArchivedTask, selectArchivedTasks } from '../utils/taskArchive';
import { formatRecordedDuration } from '../utils/taskTimeStats';
import { btn, ghostBtn, panel } from './strategyUi';

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
  onClassifyDeleted: (taskId: string, reason?: DeletedTask['deletionReason']) => void;
}

type HistoryTabFilter = 'COMPLETED' | 'DELETED';

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
  onClassifyDeleted,
}) => {
  const t = TRANSLATIONS[lang];
  const hv = t.historyView;

  const [activeSubFilter, setActiveSubFilter] = useState<HistoryTabFilter>('COMPLETED');
  const [searchQuery, setSearchQuery] = useState('');
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const visibleDeletedTasks = useMemo(() => selectArchivedTasks(tasks, deletedTasks), [tasks, deletedTasks]);
  const clearableCount = visibleDeletedTasks.filter(task => !isCompletedArchivedTask(task)).length;

  // Completion history stays separate from the recoverable trash.
  const completedTasks = useMemo(() => {
    const completed = new Map(tasks.filter(t => t.done).map(task => [task.id, task]));
    for (const task of visibleDeletedTasks.filter(isCompletedArchivedTask)) {
      completed.set(task.id, task);
    }
    return [...completed.values()];
  }, [tasks, visibleDeletedTasks]);

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
    archived: boolean;
  }

  const allHistoryItems = useMemo<HistoryItem[]>(() => {
    const list: HistoryItem[] = [];

    if (activeSubFilter === 'COMPLETED') {
      completedTasks.forEach(task => list.push({
        type: 'COMPLETED', task, timestamp: task.completedAt || task.createdAt,
        archived: 'deletedAt' in task,
      }));
    } else {
      visibleDeletedTasks.forEach(task => list.push({
        type: 'DELETED', task, timestamp: task.deletedAt, archived: true,
      }));
    }

    // Sort newest timestamp first
    return list.sort((a, b) => b.timestamp - a.timestamp);
  }, [completedTasks, visibleDeletedTasks, activeSubFilter]);

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

  const uk = lang === 'uk';
  const pad = (value: number) => value.toString().padStart(2, '0');
  const formatTimestamp = (ms: number) => {
    const date = new Date(ms);
    return `${pad(date.getDate())}.${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };
  const formatTime = (ms: number) => { const date = new Date(ms); return `${pad(date.getHours())}:${pad(date.getMinutes())}`; };

  // A history log reads by day: «Сьогодні», «Вчора», then calendar dates.
  const dayGroups = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const groups: { key: string; label: string; items: HistoryItem[] }[] = [];
    for (const item of filteredItems) {
      const day = new Date(item.timestamp); day.setHours(0, 0, 0, 0);
      const key = String(day.getTime());
      let group = groups.at(-1);
      if (group?.key !== key) {
        const diff = Math.round((today.getTime() - day.getTime()) / 86_400_000);
        const label = diff === 0 ? (uk ? 'Сьогодні' : 'Today') : diff === 1 ? (uk ? 'Вчора' : 'Yesterday')
          : day.toLocaleDateString(uk ? 'uk-UA' : 'en-GB', { day: 'numeric', month: 'long', ...(day.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) });
        group = { key, label, items: [] };
        groups.push(group);
      }
      group.items.push(item);
    }
    return groups;
  }, [filteredItems, uk]);

  const iconBtn = 'inline-flex min-h-11 min-w-11 sm:min-h-8 sm:min-w-8 items-center justify-center gap-1.5 px-2 text-xs text-neutral-400 transition-colors hover:bg-neutral-900 hover:text-white motion-reduce:transition-none';
  const segment = (selected: boolean) => `inline-flex min-h-11 sm:min-h-8 items-center gap-2 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-colors motion-reduce:transition-none ${selected ? 'bg-neutral-800 text-white' : 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200'}`;

  return (
    <div className="space-y-6 text-sm text-neutral-200 animate-in fade-in duration-200">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-base font-bold uppercase tracking-wider text-white">
          <History className="h-[18px] w-[18px]" aria-hidden="true" />{hv.title}
        </h1>
        <button
          id="history-back-to-tasks-btn"
          type="button"
          onClick={() => { sound.tick(600); onBackToTasks(); }}
          className={`${ghostBtn} -mr-2`}
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />{uk ? 'До завдань' : 'Back to tasks'}
        </button>
      </header>

      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div role="group" aria-label={uk ? 'Розділ історії' : 'History section'} className="inline-flex self-start border border-neutral-800 p-0.5 gap-0.5">
            <button id="history-filter-completed" type="button" aria-pressed={activeSubFilter === 'COMPLETED'}
              onClick={() => { sound.tick(500); setActiveSubFilter('COMPLETED'); }} className={segment(activeSubFilter === 'COMPLETED')}>
              {hv.completed}<span className="font-mono font-normal tabular-nums text-neutral-500">{completedTasks.length}</span>
            </button>
            <button id="history-filter-deleted" type="button" aria-pressed={activeSubFilter === 'DELETED'}
              onClick={() => { sound.tick(500); setActiveSubFilter('DELETED'); }} className={segment(activeSubFilter === 'DELETED')}>
              {hv.deleted}<span className="font-mono font-normal tabular-nums text-neutral-500">{visibleDeletedTasks.length}</span>
            </button>
          </div>

          <div className="flex min-w-0 items-center gap-2">
            <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-500" aria-hidden="true" />
              <input
                type="search"
                aria-label={hv.searchPlaceholder}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={uk ? 'Пошук' : 'Search'}
                title={hv.searchPlaceholder}
                className="min-h-11 sm:min-h-9 w-full border border-neutral-800 bg-black/40 py-2 pl-8 pr-9 text-sm text-white outline-none transition-colors placeholder:text-neutral-500 focus:border-neutral-500 [&::-webkit-search-cancel-button]:hidden"
              />
              {searchQuery && (
                <button type="button" aria-label={uk ? 'Скинути пошук' : 'Clear search'} onClick={() => setSearchQuery('')}
                  className="absolute right-0 top-0 flex h-full w-9 items-center justify-center text-neutral-500 hover:text-white">
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
            {activeSubFilter === 'DELETED' && clearableCount > 0 && (
              <button
                id="clear-deleted-history-btn"
                type="button"
                onClick={() => { sound.tick(400); setShowClearConfirm(true); }}
                className={`${iconBtn} shrink-0 hover:text-red-400`}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /><span className="hidden sm:inline">{uk ? 'Очистити' : 'Clear'}</span>
                <span className="sr-only sm:hidden">{hv.clearDeleted}</span>
              </button>
            )}
          </div>
        </div>

        {activeSubFilter === 'DELETED' && (
          <p className="max-w-prose text-xs leading-relaxed text-neutral-500">
            {uk ? 'Додані помилково та видалені без причини не враховуються в статистиці й AI. Скасовані рахуються окремо.'
              : 'Accidental tasks and tasks removed without a reason are excluded from statistics and AI. Cancelled ones are counted separately.'}
          </p>
        )}
      </div>

      {showClearConfirm && activeSubFilter === 'DELETED' && clearableCount > 0 && (
        <div role="alert" className="flex flex-col gap-4 border border-red-900/70 bg-red-950/25 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex min-w-0 items-start gap-2.5 text-[13px] leading-relaxed text-red-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />{hv.clearConfirm}
          </p>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button type="button" onClick={() => { onClearDeleted(); setShowClearConfirm(false); }}
              className="min-h-11 sm:min-h-8 bg-red-600 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-red-500">
              {uk ? 'Так, очистити' : 'Yes, clear'}
            </button>
            <button type="button" onClick={() => setShowClearConfirm(false)} className={btn}>{uk ? 'Скасувати' : 'Cancel'}</button>
          </div>
        </div>
      )}

      {dayGroups.length === 0 ? (
        <div role="status" className={`${panel} py-12 text-center`}>
          <History className="mx-auto h-7 w-7 text-neutral-700" aria-hidden="true" />
          <h3 className="mt-4 text-[11px] font-bold uppercase tracking-wider text-neutral-300">
            {searchQuery.trim()
              ? (uk ? 'Нічого не знайдено' : 'No matching tasks')
              : activeSubFilter === 'COMPLETED' ? hv.emptyCompleted : hv.emptyDeleted}
          </h3>
          <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed text-neutral-500">
            {searchQuery.trim()
              ? (uk ? 'Спробуйте інший запит.' : 'Try another query.')
              : activeSubFilter === 'COMPLETED' ? hv.emptyCompletedDesc : hv.emptyDeletedDesc}
          </p>
          {searchQuery && (
            <button type="button" onClick={() => setSearchQuery('')} className={`${btn} mt-5`}>{uk ? 'Скинути пошук' : 'Clear search'}</button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {dayGroups.map(group => (
            <section key={group.key} aria-label={group.label}>
              <h2 className="mb-2 flex items-baseline justify-between gap-2 px-1">
                <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-400">{group.label}</span>
                <span className="font-mono text-[11px] tabular-nums text-neutral-600">{group.items.length}</span>
              </h2>
              <ul className="divide-y divide-neutral-800/80 border border-neutral-800 bg-[#09090b]/95 px-4 sm:px-5">
                {group.items.map(({ type, task, timestamp, archived }) => {
                  const isCompleted = type === 'COMPLETED';
                  const tabObj = tabMap.get(task.phase);
                  const tabName = (t.phases as Record<string, string>)[task.phase] || tabObj?.name || task.phase;
                  const completedSteps = task.stepList ? task.stepList.filter((s) => s.done).length : task.currentStep;
                  const totalSteps = task.steps || 1;
                  const reasonValue = (task as DeletedTask).deletionReason === 'accidental' ? 'accidental' : task.done ? 'completed' : (task as DeletedTask).deletionReason || 'unknown';
                  const restoreLabel = isCompleted ? hv.restoreToActive : hv.restoreDeleted;

                  return (
                    <li key={`${type}-${task.id}`} className="flex items-start gap-3 py-4 sm:gap-4">
                      {isCompleted
                        ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400/80" aria-hidden="true" />
                        : <Trash2 className="mt-0.5 h-4 w-4 shrink-0 text-neutral-600" aria-hidden="true" />}

                      <div className="min-w-0 flex-1">
                        <h3 className={`break-words leading-snug ${isCompleted ? 'text-neutral-200' : 'text-neutral-300'}`}>{task.title}</h3>
                        {task.note && <p title={task.note} className="mt-1 line-clamp-1 break-words text-xs text-neutral-500">{task.note}</p>}
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-500">
                          <span className="inline-flex min-w-0 items-center gap-1.5">
                            {tabObj?.color && <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: tabObj.color }} />}
                            <span className="min-w-0 break-words">{tabName}</span>
                          </span>
                          {task.priority === 1 && <span className="font-mono font-bold text-red-400" title={uk ? 'Пріоритет P1' : 'Priority P1'}>P1</span>}
                          {totalSteps > 1 && <span className="font-mono tabular-nums">{completedSteps}/{totalSteps} {uk ? 'кроків' : 'steps'}</span>}
                          {task.timeSpentSeconds && task.timeSpentSeconds > 0 ? (
                            <span className="inline-flex items-center gap-1" title={uk ? 'Витрачено часу на завдання' : 'Time spent on task'}>
                              <Timer className="h-3 w-3" aria-hidden="true" />{formatRecordedDuration(task.timeSpentSeconds, lang)}
                            </span>
                          ) : null}
                        </div>
                        {!isCompleted && (
                          <select
                            aria-label={`${uk ? 'Причина видалення' : 'Removal reason'}: ${task.title}`}
                            value={reasonValue}
                            onChange={event => {
                              const value = event.target.value;
                              onClassifyDeleted(task.id, value === 'accidental' || value === 'cancelled' ? value : undefined);
                            }}
                            className="mt-2.5 min-h-11 sm:min-h-8 max-w-full border border-neutral-800 bg-black px-2 py-1 text-xs text-neutral-300 outline-none transition-colors hover:border-neutral-600 focus:border-white"
                          >
                            <option value={task.done ? 'completed' : 'unknown'}>{task.done ? (uk ? 'Виконано' : 'Completed') : (uk ? 'Причину не уточнено' : 'Reason unknown')}</option>
                            <option value="accidental">{uk ? 'Додано помилково — не враховувати' : 'Added by mistake — exclude'}</option>
                            {!task.done && <option value="cancelled">{uk ? 'Скасовано — враховувати окремо' : 'Cancelled — track separately'}</option>}
                          </select>
                        )}
                      </div>

                      <div className="-mr-2 flex shrink-0 items-center gap-1 sm:-my-1">
                        <time dateTime={new Date(timestamp).toISOString()} className="mr-1 font-mono text-[11px] tabular-nums text-neutral-500"
                          title={`${isCompleted ? hv.completedAtPrefix : hv.deletedAtPrefix}: ${formatTimestamp(timestamp)} · ${hv.createdAtPrefix}: ${formatTimestamp(task.createdAt)}`}>
                          {formatTime(timestamp)}
                        </time>
                        <button
                          id={isCompleted ? `restore-completed-task-${task.id}` : `restore-deleted-task-${task.id}`}
                          type="button"
                          onClick={() => {
                            sound.activate();
                            if (isCompleted && !archived) onToggleDone(task.id);
                            else onRestoreDeleted(task as DeletedTask);
                          }}
                          title={restoreLabel}
                          aria-label={`${restoreLabel}: ${task.title}`}
                          className={iconBtn}
                        >
                          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /><span className="hidden sm:inline">{uk ? 'Відновити' : 'Restore'}</span>
                        </button>
                        {!isCompleted && (
                          <button
                            id={`permanent-delete-task-${task.id}`}
                            type="button"
                            onClick={() => { sound.tick(300); onPermanentDelete(task.id); }}
                            title={hv.permanentDelete}
                            aria-label={`${hv.permanentDelete}: ${task.title}`}
                            className={`${iconBtn} hover:text-red-400`}
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
};

export const HistoryView = React.memo(HistoryViewComponent);
