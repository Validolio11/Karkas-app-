import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform, useDragControls } from 'motion/react';
import { PSTask, TaskTab } from '../types';
import { sound } from '../utils/audio';
import { getTaskTotalSeconds, getTaskRemainingSeconds, getTaskTimerMode } from '../utils/taskTimer';
import { formatDigitalDuration as formatTime, formatDurationFull } from '../utils/taskTimeStats';
import { Language, TRANSLATIONS } from '../utils/i18n';
import { AIIcon } from './AIIconTemplates';
import { TaskTimeDialog } from './TaskTimeDialog';
import { TaskScheduleDialog } from './TaskScheduleDialog';
import type { AgentAction } from '../utils/aiAgentActions';
import { missedBlock } from '../utils/dayPlanShift';
import { CountdownExpiryNotice, type CountdownExpiryActions } from './CountdownExpiryNotice';
import { formatTaskDate, getDeadlineProgress, isTaskDate, taskDateEnd } from '../utils/taskDates';
import { taskTimeRange } from '../utils/schedulePresentation';
import {
  Pin,
  Trash2,
  Check,
  ChevronDown,
  ChevronUp,
  Plus,
  X,
  LoaderCircle,
  Play,
  Pause,
  Square,
  RotateCcw,
  AlertTriangle,
  Pencil,
  MoreHorizontal,
} from 'lucide-react';

interface TaskCardProps extends CountdownExpiryActions {
  task: PSTask;
  index: number;
  lang: Language;
  tabs?: TaskTab[];
  timeZone?: string;
  onApplyAgentActions?: (actions: AgentAction[]) => void | Promise<void>;
  onReplanDay?: () => void;
  onToggleDone: (id: string) => void;
  onStartTask?: (id: string) => void;
  onUpdateStep: (id: string, step: number) => void;
  onCyclePriority: (id: string) => void;
  onCyclePhase: (id: string) => void;
  onTogglePin: (id: string) => void;
  onDelete: (id: string) => void;
  onEditTask?: (taskId: string, updatedTitle: string, updatedNote: string, expected: { title: string; note: string; plannedDate?: string; deadlineDate?: string }, dates?: { plannedDate?: string; deadlineDate?: string }) => boolean;
  onAskAIAboutTask: (taskTitle: string) => void;
  onToggleStepItem?: (taskId: string, stepIndex: number) => void;
  onAddStepItem?: (taskId: string, stepTitle: string) => void;
  onDeleteStepItem?: (taskId: string, stepIndex: number) => void;
  onAIBreakdown?: (taskId: string) => void;
  isBreakingDown?: boolean;
  onToggleTimer?: (taskId: string) => void;
  onStopTimer?: (taskId: string) => void;
  onResetTimer?: (taskId: string) => void;
  onUpdateTimeSpent?: (taskId: string, newTotalSeconds: number) => void;
  onConfigureCountdown?: (taskId: string, seconds: number) => void;
  onExtendCountdown?: (taskId: string, extraSeconds: number) => void;
  onClearCountdown?: (taskId: string) => void;
}

const KNOWN_PHASE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  focus: { bg: 'bg-rose-950/30', text: 'text-rose-300', border: 'border-rose-800/60' },
  work: { bg: 'bg-sky-950/30', text: 'text-sky-300', border: 'border-sky-800/60' },
  home: { bg: 'bg-emerald-950/30', text: 'text-emerald-300', border: 'border-emerald-800/60' },
  health: { bg: 'bg-teal-950/30', text: 'text-teal-300', border: 'border-teal-800/60' },
  buy: { bg: 'bg-amber-950/30', text: 'text-amber-300', border: 'border-amber-800/60' },
  study: { bg: 'bg-violet-950/30', text: 'text-violet-300', border: 'border-violet-800/60' },
  // PS compatibility
  PREP: { bg: 'bg-neutral-900', text: 'text-neutral-300', border: 'border-neutral-700' },
  MASK: { bg: 'bg-zinc-950', text: 'text-emerald-400', border: 'border-emerald-800/60' },
  RETOUCH: { bg: 'bg-zinc-950', text: 'text-sky-300', border: 'border-sky-800/60' },
  GRADE: { bg: 'bg-zinc-950', text: 'text-amber-300', border: 'border-amber-800/60' },
  COMP: { bg: 'bg-zinc-950', text: 'text-violet-300', border: 'border-violet-800/60' },
  EXPORT: { bg: 'bg-zinc-950', text: 'text-rose-300', border: 'border-rose-800/60' },
};

const TaskCardComponent: React.FC<TaskCardProps> = ({
  task,
  lang,
  tabs = [],
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Kyiv',
  onApplyAgentActions,
  onReplanDay,
  onToggleDone,
  onStartTask,
  onUpdateStep,
  onCyclePriority,
  onCyclePhase,
  onTogglePin,
  onDelete,
  onEditTask,
  onAskAIAboutTask,
  onToggleStepItem,
  onAddStepItem,
  onDeleteStepItem,
  onAIBreakdown,
  isBreakingDown = false,
  onToggleTimer,
  onStopTimer,
  onResetTimer,
  onUpdateTimeSpent,
  onConfigureCountdown,
  onExtendCountdown,
  onClearCountdown,
  onContinueAfterExpiry,
  onFinishAfterExpiry,
}) => {
  const t = TRANSLATIONS[lang];
  const [isSlashing, setIsSlashing] = useState(false);
  const completionTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep the guard across rerenders, including the stop button becoming resume
  // and a removed step being replaced by the next step at the same index.
  const lastAction = useRef<Record<string, number>>({});
  const allowAction = (group: 'timer' | 'delete-step') => {
    const now = Date.now();
    if (now - (lastAction.current[group] || 0) < 500) return false;
    lastAction.current[group] = now;
    return true;
  };
  const [isExpanded, setIsExpanded] = useState(false);
  const [isAddingStep, setIsAddingStep] = useState(false);
  const [newStepText, setNewStepText] = useState('');
  const [isEditingTask, setIsEditingTask] = useState(false);
  const [editTitleText, setEditTitleText] = useState(task.title);
  const [editNoteText, setEditNoteText] = useState(task.note || '');
  const [editPlannedDate, setEditPlannedDate] = useState(task.plannedDate || '');
  const [editDeadlineDate, setEditDeadlineDate] = useState(task.deadlineDate || '');
  const editDatesInvalid = !!((editPlannedDate && !isTaskDate(editPlannedDate)) || (editDeadlineDate && !isTaskDate(editDeadlineDate)));
  const editDatesReversed = !!(editPlannedDate && editDeadlineDate && editPlannedDate > editDeadlineDate);
  const editBase = useRef({ title: task.title, note: task.note || '', plannedDate: task.plannedDate, deadlineDate: task.deadlineDate });
  const [editConflict, setEditConflict] = useState(false);
  const beginEditingTask = () => {
    editBase.current = { title: task.title, note: task.note || '', plannedDate: task.plannedDate, deadlineDate: task.deadlineDate };
    setEditConflict(false);
    setEditTitleText(task.title);
    setEditNoteText(task.note || '');
    setEditPlannedDate(task.plannedDate || '');
    setEditDeadlineDate(task.deadlineDate || '');
    setIsEditingTask(true);
  };
  const [isConfiguringTimer, setIsConfiguringTimer] = useState(false);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const scheduleTriggerRef = useRef<HTMLElement | null>(null);
  const openSchedule = (trigger: HTMLElement) => { scheduleTriggerRef.current = trigger; setScheduleOpen(true); };
  const [now, setNow] = useState(Date.now());
  const timeTriggerRef = useRef<HTMLButtonElement>(null);
  const openTimeSettings = (trigger: HTMLButtonElement, correction = false) => {
    timeTriggerRef.current = trigger;
    setCorrectionOpen(correction);
    setIsConfiguringTimer(true);
  };
  const x = useMotionValue(0);
  const dragControls = useDragControls();

  // One clock per card: second precision for running timers, minute precision for dates.
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    refresh();
    if (!task.timerRunning && !task.plannedDate && !task.deadlineDate && !Number.isFinite(task.scheduledFor)) return;
    const interval = setInterval(refresh, task.timerRunning ? 1000 : 60000);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(interval); window.removeEventListener('focus', refresh); };
  }, [task.timerRunning, task.timerStartedAt, task.plannedDate, task.deadlineDate, task.scheduledFor]);

  // Compute live seconds spent on task
  const currentElapsedSeconds = getTaskTotalSeconds(task, now);
  const timerMode = getTaskTimerMode(task);
  const hasCountdown = timerMode === 'countdown' && (task.countdownDurationSeconds || 0) > 0;
  const remainingSeconds = getTaskRemainingSeconds(task, now) ?? 0;
  const showTimerWidget = timerMode !== 'none' || !!task.timerRunning;
  const timerValue = formatTime(hasCountdown ? remainingSeconds : currentElapsedSeconds);
  const countdownFinished = hasCountdown && remainingSeconds === 0;
  const scheduledRange = taskTimeRange(task, now, timeZone, lang);
  const missed = missedBlock(task, now, timeZone);
  const missedSince = missed ? new Intl.DateTimeFormat(lang === 'uk' ? 'uk-UA' : 'en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(missed.since) : '';
  const hasStarted = Number.isFinite(task.startedAt) || !!task.timerRunning || currentElapsedSeconds > 0;
  const countdownProgress = hasCountdown
    ? Math.min(100, Math.max(0, (1 - remainingSeconds / task.countdownDurationSeconds!) * 100)) : 0;
  const timerToggleLabel = task.timerRunning
    ? t.timer.pause
    : task.done ? (lang === 'uk' ? 'Спершу поверніть завдання в роботу' : 'Reopen the task before starting its timer')
    : countdownFinished ? (lang === 'uk' ? 'Повторити таймер' : 'Restart countdown')
    : (lang === 'uk' ? 'Продовжити' : 'Resume');
  const matchedTab = tabs.find((tb) => tb.id === task.phase);
  const phaseLabel = (t.phases as any)[task.phase] || matchedTab?.name || task.phase;
  const phaseStyle = KNOWN_PHASE_COLORS[task.phase] || {
    bg: 'bg-neutral-900/60',
    text: 'text-neutral-300',
    border: 'border-neutral-700',
  };

  const hasStepList = !!task.stepList && task.stepList.length > 0;
  const effectiveStepList = hasStepList
    ? task.stepList!
    : Array.from({ length: Math.max(0, task.steps || 0) }, (_, idx) => ({
        id: `s-${task.id}-${idx}`,
        title: `${lang === 'uk' ? 'Крок' : 'Step'} ${idx + 1}`,
        done: idx < task.currentStep,
      }));

  const completedStepCount = effectiveStepList.filter(step => step.done).length;
  const nextStepIndex = effectiveStepList.findIndex(step => !step.done);

  // Background visual indicators during swipe gesture
  const bgOpacityLeft = useTransform(x, [-110, -30, 0], [1, 0.5, 0]);
  const bgOpacityRight = useTransform(x, [0, 30, 110], [0, 0.5, 1]);
  const rotateLeft = useTransform(x, [-100, 0], [-1.5, 0]);
  const rotateRight = useTransform(x, [0, 100], [0, 1.5]);

  useEffect(() => () => {
    if (completionTimeout.current !== null) clearTimeout(completionTimeout.current);
  }, []);

  const handleDragEnd = (_: any, info: { offset: { x: number } }) => {
    if (info.offset.x < -75) {
      if (completionTimeout.current !== null) return;
      // Swiped Left -> Slice / Toggle Complete
      sound.slice();
      setIsSlashing(true);
      completionTimeout.current = setTimeout(() => {
        completionTimeout.current = null;
        onToggleDone(task.id);
        setIsSlashing(false);
      }, 160);
    } else if (info.offset.x > 75) {
      // Swiped Right -> Pin / Boost
      sound.activate();
      onTogglePin(task.id);
    }
  };

  const handleStepClick = (e: React.MouseEvent, stepNum: number) => {
    e.stopPropagation();
    sound.tick(500 + stepNum * 100);
    const newStep = task.currentStep === stepNum ? stepNum - 1 : stepNum;
    onUpdateStep(task.id, Math.max(0, newStep));
  };

  const handleToggleSubStep = (stepIdx: number) => {
    const isCurrentlyDone = effectiveStepList[stepIdx]?.done;
    if (isCurrentlyDone) {
      sound.tick(450);
    } else {
      sound.activate();
    }
    if (onToggleStepItem) {
      onToggleStepItem(task.id, stepIdx);
    } else {
      // fallback
      const targetStep = task.currentStep === stepIdx + 1 ? stepIdx : stepIdx + 1;
      onUpdateStep(task.id, targetStep);
    }
  };

  const handleCreateStepSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStepText.trim()) return;
    sound.activate();
    if (onAddStepItem) {
      onAddStepItem(task.id, newStepText.trim());
    }
    setNewStepText('');
    setIsAddingStep(false);
  };

  const primaryAction = 'inline-flex min-h-11 sm:min-h-9 items-center justify-center gap-2 border border-white bg-white px-3 py-1.5 text-sm font-bold text-black transition-colors hover:bg-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-40';
  const iconAction = 'inline-flex h-11 w-11 sm:h-9 sm:w-9 items-center justify-center text-neutral-500 transition-colors hover:bg-neutral-900 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';

  return (
    <div id={`task-wrapper-${task.id}`} className="relative group select-none touch-pan-y">
      {/* Background Gesture Layer - Left: Slice to Complete */}
      <motion.div
        aria-hidden="true"
        style={{ opacity: bgOpacityLeft }}
        className="pointer-events-none absolute inset-0 bg-neutral-900 border border-neutral-700 flex items-center justify-end px-5 rounded-none z-0"
      >
        <div className="flex items-center gap-2 text-xs uppercase font-bold tracking-widest text-neutral-200">
          <span>{task.done ? t.restoreOperation : t.slashToComplete}</span>
          <Check className="w-4 h-4 text-white" />
        </div>
      </motion.div>

      {/* Background Gesture Layer - Right: Pin / Boost */}
      <motion.div
        aria-hidden="true"
        style={{ opacity: bgOpacityRight }}
        className="pointer-events-none absolute inset-0 bg-neutral-900 border border-neutral-700 flex items-center justify-start px-5 rounded-none z-0"
      >
        <div className="flex items-center gap-2 text-xs uppercase font-bold tracking-widest text-neutral-200">
          <Pin className={`w-4 h-4 ${task.pinned ? 'fill-white text-white' : 'text-neutral-400'}`} />
          <span>{task.pinned ? t.unpin : t.pinToTop}</span>
        </div>
      </motion.div>

      {/* Main Draggable Task Surface */}
      <motion.div
        id={`task-card-${task.id}`}
        drag="x"
        dragControls={dragControls}
        dragListener={false}
        onPointerDown={(event) => {
          // Native drag listeners run before React bubbling. Start explicitly so
          // text selection and button gestures can never become a task swipe.
          if (isEditingTask || (isExpanded && isAddingStep) || isConfiguringTimer || scheduleOpen || event.button !== 0) return;
          const target = event.target;
          if (target instanceof Element && target.closest('button, summary, input, textarea, select, a, [role="button"], [contenteditable="true"]')) return;
          dragControls.start(event);
        }}
        dragConstraints={{ left: -100, right: 100 }}
        dragElastic={0.2}
        onDragEnd={handleDragEnd}
        onContextMenu={(e) => {
          const target = e.target;
          if (isEditingTask || (target instanceof Element && target.closest('button, summary, input, textarea, select, a, [role="button"], [contenteditable="true"]'))) return;
          e.preventDefault();
          sound.tick(500);
          beginEditingTask();
        }}
        style={{ x, rotate: x.get() < 0 ? rotateLeft : rotateRight }}
        whileTap={{ cursor: 'grabbing' }}
        className={`relative z-10 bg-[#0c0c0d] border transition-all duration-200 p-4 sm:p-5 cursor-grab ${
          task.timerRunning
            ? 'border-emerald-500/90 task-timer-glow'
            : task.done
            ? 'border-neutral-800/80 bg-[#080808]/90'
            : task.pinned
            ? 'border-neutral-500 shadow-[0_0_15px_rgba(255,255,255,0.05)]'
            : 'border-neutral-800 hover:border-neutral-700'
        }`}
      >
        {/* Kinetic slash cut animation */}
        {isSlashing && (
          <motion.div
            initial={{ width: 0, opacity: 1 }}
            animate={{ width: '100%', opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="absolute top-1/2 left-0 h-[2px] bg-white z-30 pointer-events-none shadow-[0_0_8px_#ffffff]"
          />
        )}

        <div className="flex flex-col gap-4">
          {/* Content first: meta and title on the left, a compact timer readout on the right. */}
          <div className={`grid min-w-0 gap-x-6 gap-y-3 ${showTimerWidget ? 'sm:grid-cols-[minmax(0,1fr)_auto]' : ''}`}>
            <div className="min-w-0">
              <div className="-ml-1.5 -mt-1.5 flex flex-wrap items-center gap-x-0.5">
                <button
                  id={`task-phase-btn-${task.id}`}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    sound.tick(700);
                    onCyclePhase(task.id);
                  }}
                  title={lang === 'uk' ? 'Натисніть для зміни вкладки/категорії' : 'Tap to cycle category'}
                  aria-label={lang === 'uk' ? `Категорія ${phaseLabel}, натисніть для зміни` : `Category ${phaseLabel}, press to change`}
                  className="inline-flex min-h-11 min-w-11 sm:min-h-8 items-center justify-center px-1.5 transition-transform active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  <span
                    style={matchedTab?.color ? {
                      borderColor: `${matchedTab.color}55`,
                      backgroundColor: `${matchedTab.color}14`,
                      color: matchedTab.color,
                    } : undefined}
                    className={`flex items-center gap-1.5 border px-1.5 py-0.5 text-[11px] uppercase font-bold tracking-wider ${
                      !matchedTab?.color ? `${phaseStyle.border} ${phaseStyle.bg} ${phaseStyle.text}` : ''
                    }`}
                  >
                    {matchedTab?.color && (
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ backgroundColor: matchedTab.color }}
                      />
                    )}
                    <span>{phaseLabel}</span>
                  </span>
                </button>

                <button
                  id={`task-priority-btn-${task.id}`}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    sound.tick(400 + task.priority * 150);
                    onCyclePriority(task.id);
                  }}
                  title={
                    lang === 'uk'
                      ? `Пріоритет: P${task.priority} (${
                          task.priority === 1
                            ? 'Червоний / Терміново'
                            : task.priority === 2
                            ? 'Жовтий / Стандарт'
                            : 'Зелений / Низький'
                        }) — клік для зміни`
                      : `Priority: P${task.priority} (${
                          task.priority === 1
                            ? 'Red / Urgent'
                            : task.priority === 2
                            ? 'Yellow / Standard'
                            : 'Green / Low'
                        }) — tap to cycle`
                  }
                  aria-label={lang === 'uk' ? `Пріоритет P${task.priority}, натисніть для зміни` : `Priority P${task.priority}, press to change`}
                  className="group/priority inline-flex min-h-11 min-w-11 sm:min-h-8 items-center justify-center px-1.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  <span className={`flex items-center gap-1.5 border border-transparent px-1 py-0.5 transition-colors ${
                    task.priority === 1 ? 'group-hover/priority:border-red-900/70' : task.priority === 2 ? 'group-hover/priority:border-amber-900/70' : 'group-hover/priority:border-emerald-900/70'
                  }`}>
                    <span className={`font-mono text-[11px] font-bold ${task.priority === 1 ? 'text-red-400' : task.priority === 2 ? 'text-amber-400' : 'text-emerald-400'}`}>
                      P{task.priority}
                    </span>
                    <span className="flex items-center gap-0.5 h-2.5" aria-hidden="true">
                      <span className="w-1 h-2.5 bg-emerald-400" />
                      <span className={`w-1 h-2.5 ${task.priority <= 2 ? 'bg-amber-400' : 'bg-neutral-800'}`} />
                      <span className={`w-1 h-2.5 ${task.priority === 1 ? 'bg-red-500' : 'bg-neutral-800'}`} />
                    </span>
                  </span>
                </button>

                {task.plannedDate && <span className="mx-1.5 inline-flex items-center font-mono text-[11px] font-bold text-neutral-400">
                  {lang === 'uk' ? 'НА' : 'ON'} {formatTaskDate(task.plannedDate, lang, now)}
                </span>}
                {task.deadlineDate && (() => {
                  const progress = Math.round(getDeadlineProgress(task, now));
                  const end = taskDateEnd(task.deadlineDate);
                  const overdue = !task.done && end !== null && now > end;
                  const color = task.done ? 'text-neutral-400' : overdue || progress >= 85 ? 'text-red-400' : progress >= 60 ? 'text-amber-400' : 'text-emerald-400';
                  return <span title={lang === 'uk' ? `${overdue ? 'Термін минув. ' : ''}Минуло ${progress}% часу від створення до кінця дедлайну` : `${overdue ? 'Overdue. ' : ''}${progress}% of time from creation to deadline elapsed`} className={`mx-1.5 inline-flex items-center gap-2 font-mono text-[11px] font-bold ${color}`}>
                    <span>{lang === 'uk' ? 'ДО' : 'BY'} {formatTaskDate(task.deadlineDate, lang, now)}{overdue && ' !'}</span>
                    <span role="progressbar" aria-label={lang === 'uk' ? 'Час до дедлайну, що минув' : 'Elapsed deadline time'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} className="h-1 w-10 bg-neutral-800">
                      <span className="block h-full bg-current" style={{ width: `${progress}%` }} />
                    </span>
                  </span>;
                })()}

                {task.pinned && (
                  <span className="mx-1.5 inline-flex items-center text-neutral-400" title={lang === 'uk' ? 'Закріплено' : 'Pinned'}>
                    <Pin className="w-3 h-3 fill-neutral-400" aria-hidden="true" />
                    <span className="sr-only">{lang === 'uk' ? 'Закріплено' : 'Pinned'}</span>
                  </span>
                )}
              </div>

              <div className="relative mt-1.5 min-w-0">
              {isEditingTask ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!editTitleText.trim() || !onEditTask || editDatesInvalid || editDatesReversed) return;
                    if (!onEditTask(task.id, editTitleText.trim(), editNoteText.trim(), editBase.current, { plannedDate: editPlannedDate || undefined, deadlineDate: editDeadlineDate || undefined })) {
                      setEditConflict(true);
                      return;
                    }
                    setIsEditingTask(false);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="flex flex-col gap-3 p-3 bg-[#08080a] border border-neutral-700 my-1 z-30"
                >
                  <div className="text-xs font-sans text-neutral-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Pencil className="w-3 h-3 text-emerald-400" />
                    <span>{lang === 'uk' ? 'Редагування завдання' : 'Edit Task'}</span>
                  </div>
                  <input
                    type="text"
                    required
                    aria-label={lang === 'uk' ? 'Назва завдання' : 'Task title'}
                    value={editTitleText}
                    onChange={(e) => setEditTitleText(e.target.value)}
                    placeholder={lang === 'uk' ? 'Назва завдання...' : 'Task title...'}
                    autoFocus
                    className="w-full px-2.5 py-1.5 bg-[#0d0d12] border border-neutral-700 text-white text-sm leading-relaxed font-sans focus:outline-none focus:border-white transition-colors"
                  />
                  <input
                    type="text"
                    value={editNoteText}
                    aria-label={lang === 'uk' ? 'Нотатка' : 'Note'}
                    onChange={(e) => setEditNoteText(e.target.value)}
                    placeholder={lang === 'uk' ? 'Нотатка (необов\'язково)...' : 'Note (optional)...'}
                    className="w-full px-2.5 py-1.5 bg-[#0d0d12] border border-neutral-800 text-neutral-300 text-sm leading-relaxed font-sans focus:outline-none focus:border-neutral-600 transition-colors"
                  />
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {([{ key: 'planned', label: lang === 'uk' ? 'Заплановано на' : 'Planned for', value: editPlannedDate, set: setEditPlannedDate }, { key: 'deadline', label: lang === 'uk' ? 'Завершити до' : 'Complete by', value: editDeadlineDate, set: setEditDeadlineDate }]).map(field => <label key={field.key} className="flex flex-col gap-1 text-xs text-neutral-400">
                      {field.label}
                      <input type="date" min="0001-01-01" max="9999-12-31" value={field.value} aria-invalid={!!field.value && !isTaskDate(field.value) || editDatesReversed || undefined} onChange={e => field.set(e.target.value)} className="min-w-0 w-full border border-neutral-700 bg-[#0d0d12] px-2.5 py-1.5 text-sm text-white [color-scheme:dark] focus:outline-none focus:border-white" />
                    </label>)}
                  </div>
                  {editDatesInvalid && <p role="alert" className="text-xs text-amber-300">{lang === 'uk' ? 'Вкажіть коректну дату.' : 'Enter a valid date.'}</p>}
                  {editDatesReversed && <p role="alert" className="text-xs text-amber-300">{lang === 'uk' ? 'Дата роботи має бути не пізніше дедлайну.' : 'Planned date must not be after the deadline.'}</p>}
                  {editConflict && <p role="alert" className="text-xs text-amber-300">{lang === 'uk'
                    ? 'Це поле вже змінилося. Ваш текст збережено у формі. Скасуйте й відкрийте редагування знову, щоб побачити актуальні дані.'
                    : 'This field changed while you were editing. Your draft remains here. Cancel and reopen editing to see the current data.'}</p>}
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setIsEditingTask(false)}
                      className="px-2.5 py-1 bg-neutral-800 border border-neutral-700 text-neutral-300 text-sm leading-relaxed font-sans font-bold hover:bg-neutral-700 transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                      <span>{lang === 'uk' ? 'Скасувати' : 'Cancel'}</span>
                    </button>
                    <button
                      type="submit"
                      disabled={!editTitleText.trim() || !onEditTask || editDatesInvalid || editDatesReversed}
                      className="px-2.5 py-1 bg-emerald-500 text-black text-xs font-sans font-extrabold hover:bg-emerald-400 transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <Check className="w-3 h-3" />
                      <span>{lang === 'uk' ? 'Зберегти' : 'Save'}</span>
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <h3
                    className={`text-base sm:text-[17px] font-semibold leading-snug break-words [overflow-wrap:anywhere] transition-all ${
                      task.done
                        ? 'line-through text-neutral-400 decoration-neutral-600 decoration-2'
                        : 'text-neutral-100 hover:text-white'
                    }`}
                  >
                    {task.title}
                  </h3>
                  {scheduledRange && <div className="mt-1 text-sm leading-relaxed text-emerald-300">{onApplyAgentActions ? <button type="button" id={`task-schedule-btn-${task.id}`} title={lang === 'uk' ? 'Змінити час' : 'Change time'} aria-haspopup="dialog" aria-controls={`task-schedule-dialog-${task.id}`} onClick={event => { event.stopPropagation(); openSchedule(event.currentTarget); }} className="min-h-11 text-left underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300 sm:min-h-8"><span className="sr-only">{lang === 'uk' ? 'Заплановано: ' : 'Planned: '}</span><time dateTime={new Date(task.scheduledFor!).toISOString()}>{scheduledRange}</time></button> : <><span className="sr-only">{lang === 'uk' ? 'Заплановано: ' : 'Planned: '}</span><time dateTime={new Date(task.scheduledFor!).toISOString()}>{scheduledRange}</time></>}</div>}
                  {missed && <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-amber-300/90">
                    <p>{lang === 'uk' ? `Пропущено з ${missedSince}` : `Missed since ${missedSince}`}</p>
                    <button type="button" disabled={missed.paused ? !onToggleTimer : !onStartTask} onClick={event => { event.stopPropagation(); if (!allowAction('timer')) return; sound.activate(); if (missed.paused) onToggleTimer?.(task.id); else onStartTask?.(task.id); }} className="min-h-11 underline underline-offset-4 hover:text-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 disabled:opacity-40 sm:min-h-8">{lang === 'uk' ? 'Почати зараз' : 'Start now'}</button>
                    {onReplanDay && <button type="button" onClick={event => { event.stopPropagation(); onReplanDay(); }} className="min-h-11 underline underline-offset-4 hover:text-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 sm:min-h-8">{lang === 'uk' ? 'Перебудувати день' : 'Replan day'}</button>}
                  </div>}

                  {task.note && (
                    <div className="mt-1.5 max-w-prose text-sm leading-relaxed break-words [overflow-wrap:anywhere] font-sans text-neutral-400">
                      <span>{task.note}</span>
                    </div>
                  )}
                </>
              )}

              {task.autoPausedOverdue && (
                <button
                  type="button"
                  className="flex w-full min-h-11 items-center gap-1.5 px-2 py-1 text-left bg-amber-950/40 border border-amber-500/40 text-amber-300 text-xs font-sans mt-1.5 cursor-pointer hover:bg-amber-950/60 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    sound.tick(400);
                    openTimeSettings(e.currentTarget, true);
                  }}
                  title={t.timer.editTime}
                >
                  <AlertTriangle className="w-3 h-3 shrink-0 text-amber-400" />
                  <span className="flex-1">{t.timer.autoPausedNotice}</span>
                  <span className="text-xs underline underline-offset-2 text-amber-200">{t.timer.editTime}</span>
                </button>
              )}
              </div>
            </div>

            {showTimerWidget && (
              <section
                id={`task-timer-widget-${task.id}`}
                aria-label={lang === 'uk' ? 'Час завдання' : 'Task time'}
                className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 sm:block sm:text-right"
              >
                <p role="status" className={`inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider sm:flex sm:justify-end ${task.timerRunning ? 'text-emerald-300' : countdownFinished ? 'text-amber-300' : hasStarted ? 'text-neutral-400' : 'text-neutral-500'}`}>
                  <span aria-hidden="true" className={`h-1.5 w-1.5 ${task.timerRunning ? 'bg-emerald-400' : countdownFinished ? 'bg-amber-400' : hasStarted ? 'bg-neutral-400' : 'bg-neutral-700'}`} />
                  {task.timerRunning ? (lang === 'uk' ? 'Таймер іде' : 'Timer running')
                    : task.done ? (lang === 'uk' ? 'Завершено' : 'Completed')
                    : countdownFinished ? (lang === 'uk' ? 'Відлік закінчився' : 'Countdown ended')
                    : hasStarted ? (lang === 'uk' ? 'На паузі' : 'Paused')
                    : hasCountdown ? (lang === 'uk' ? 'Відлік' : 'Countdown')
                    : (lang === 'uk' ? 'Не розпочато' : 'Not started')}
                </p>
                <button
                  type="button" id={`task-time-settings-${task.id}`}
                  aria-haspopup="dialog" aria-controls={`task-time-dialog-${task.id}`}
                  aria-label={`${lang === 'uk' ? 'Налаштувати час' : 'Configure time'}: ${formatDurationFull(hasCountdown ? remainingSeconds : currentElapsedSeconds, lang)}`}
                  title={[
                    lang === 'uk' ? 'Натисніть, щоб налаштувати час' : 'Click to configure time',
                    hasCountdown ? `${lang === 'uk' ? 'Тривалість' : 'Duration'}: ${formatDurationFull(task.countdownDurationSeconds!, lang)} · ${lang === 'uk' ? 'Всього витрачено' : 'Total spent'}: ${formatTime(currentElapsedSeconds)}` : '',
                  ].filter(Boolean).join('\n')}
                  onClick={event => { event.stopPropagation(); openTimeSettings(event.currentTarget); }}
                  className={`min-h-11 sm:mt-1.5 sm:min-h-0 whitespace-nowrap font-mono text-2xl font-semibold leading-none tabular-nums tracking-tight decoration-dotted underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:text-[28px] ${task.timerRunning ? 'text-emerald-300' : countdownFinished ? 'text-amber-300' : hasStarted || hasCountdown ? 'text-neutral-100' : 'text-neutral-600 hover:text-neutral-300'}`}>
                  {timerValue}
                </button>
                {hasCountdown && <div role="progressbar"
                  aria-label={lang === 'uk' ? 'Прогрес зворотного відліку' : 'Countdown progress'}
                  aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(countdownProgress)}
                  aria-valuetext={lang === 'uk' ? `Залишилось ${formatDurationFull(remainingSeconds, lang)}` : `${formatDurationFull(remainingSeconds, lang)} remaining`}
                  className="h-1 w-full basis-full overflow-hidden bg-neutral-800 sm:mt-2.5 sm:ml-auto sm:w-36">
                  <div style={{ width: `${countdownProgress}%` }} className={`h-full transition-[width] duration-500 ${countdownFinished ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                </div>}
              </section>
            )}
          </div>

          {Number.isFinite(task.countdownExpiredAt) && <CountdownExpiryNotice task={task} lang={lang}
            onContinueAfterExpiry={onContinueAfterExpiry} onFinishAfterExpiry={onFinishAfterExpiry}
            onCorrect={() => { const trigger = document.getElementById('task-time-settings-' + task.id); if (trigger instanceof HTMLButtonElement) openTimeSettings(trigger, true); }} />}

          {/* One action row: steps on the left, work actions and tools on the right. */}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-neutral-800/60 pt-3">
            <div className="-ml-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <button
                type="button"
                id={`task-toggle-steps-${task.id}`}
                aria-expanded={isExpanded}
                aria-controls={`task-steps-subcard-${task.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  sound.tick(500);
                  if (!isExpanded && effectiveStepList.length === 0) setIsAddingStep(true);
                  setIsExpanded(!isExpanded);
                }}
                className={`flex min-h-11 sm:min-h-8 items-center gap-1.5 px-2 py-1 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
                  isExpanded
                    ? 'bg-neutral-900 text-white'
                    : effectiveStepList.length > 0
                    ? 'text-neutral-300 hover:bg-neutral-900 hover:text-white'
                    : 'text-neutral-500 hover:bg-neutral-900 hover:text-neutral-200'
                }`}
                title={isExpanded ? t.stepsSection.collapse : effectiveStepList.length > 0 ? t.stepsSection.expand : t.stepsSection.addStepBtn}
              >
                {isExpanded ? <ChevronUp className="h-4 w-4" aria-hidden="true" />
                  : effectiveStepList.length > 0 ? <ChevronDown className="h-4 w-4" aria-hidden="true" />
                  : <Plus className="h-4 w-4" aria-hidden="true" />}
                <span>{isExpanded ? t.stepsSection.collapse : effectiveStepList.length > 0
                  ? <>{lang === 'uk' ? 'Кроки' : 'Steps'} <span className="font-mono tabular-nums">{completedStepCount}/{effectiveStepList.length}</span></>
                  : (lang === 'uk' ? 'Підзавдання' : 'Subtasks')}</span>
              </button>

              {/* Bars */}
              {effectiveStepList.length > 0 && <div className="flex max-w-full flex-wrap items-center gap-1">
                {effectiveStepList.map((step, i) => {
                  const stepNum = i + 1;
                  const isFilled = step.done;
                  return (
                    <button
                      key={i}
                      id={`task-${task.id}-step-${stepNum}`}
                      onClick={(e) => {
                        if (hasStepList && onToggleStepItem) {
                          e.stopPropagation();
                          handleToggleSubStep(i);
                        } else handleStepClick(e, stepNum);
                      }}
                      title={`${t.step} ${stepNum} / ${effectiveStepList.length}`}
                      aria-label={`${t.step} ${stepNum} / ${effectiveStepList.length}`}
                      aria-pressed={isFilled}
                      className="flex h-11 w-11 min-h-11 min-w-11 shrink-0 items-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white md:[@media(pointer:fine)]:h-7 md:[@media(pointer:fine)]:w-3 md:[@media(pointer:fine)]:min-h-7 md:[@media(pointer:fine)]:min-w-3"
                    >
                      <span aria-hidden="true" className={`h-1.5 w-full transition-colors ${isFilled
                        ? 'bg-neutral-100' : 'bg-neutral-800 hover:bg-neutral-600'}`} />
                    </button>
                  );
                })}
              </div>}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {!task.done && !hasStarted && <button
                  type="button" id={`task-start-action-${task.id}`} disabled={!onStartTask}
                  onClick={(e) => { e.stopPropagation(); if (!allowAction('timer')) return; sound.activate(); onStartTask?.(task.id); }}
                  className={primaryAction}>
                  <Play className="h-4 w-4" aria-hidden="true" />
                  {lang === 'uk' ? 'Почати' : 'Start'}
                </button>}
                {task.timerRunning && onStopTimer && <button
                  type="button" id={`task-timer-stop-${task.id}`}
                  title={lang === 'uk'
                    ? 'Зупинити зі збереженням витраченого часу й залишку. Можна продовжити пізніше.'
                    : 'Stop and keep time spent and remaining time. You can resume later.'}
                  onClick={(e) => { e.stopPropagation(); if (allowAction('timer')) onStopTimer(task.id); }}
                  className={primaryAction}>
                  <Square className="h-4 w-4" aria-hidden="true" />
                  {lang === 'uk' ? 'Зупинити' : 'Stop'}
                </button>}
                {!Number.isFinite(task.countdownExpiredAt) && (task.timerRunning || (hasStarted && !task.done)) && onToggleTimer && !(task.timerRunning && onStopTimer) && <button
                  type="button" id={`task-timer-toggle-${task.id}`}
                  onClick={(e) => { e.stopPropagation(); if (allowAction('timer')) onToggleTimer(task.id); }}
                  className={primaryAction}>
                  {task.timerRunning ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
                  {timerToggleLabel}
                </button>}
                {!hasCountdown && currentElapsedSeconds > 0 && !task.timerRunning && !task.done && onResetTimer && <button
                  type="button" id={`task-timer-reset-${task.id}`}
                  title={t.timer.reset}
                  aria-label={t.timer.reset}
                  onClick={(e) => { e.stopPropagation(); if (allowAction('timer')) onResetTimer(task.id); }}
                  className={`${iconAction} hover:text-rose-300`}>
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                </button>}

                <button
                  type="button"
                  id={`task-toggle-action-${task.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    sound.slice();
                    onToggleDone(task.id);
                  }}
                  className="inline-flex min-h-11 sm:min-h-9 items-center justify-center gap-2 border border-neutral-700 px-3 py-1.5 text-sm font-semibold text-neutral-300 transition-colors hover:border-white hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  {task.done ? <RotateCcw className="h-4 w-4" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
                  {task.done ? (lang === 'uk' ? 'Відновити' : 'Reopen') : (lang === 'uk' ? 'Завершити' : 'Complete')}
                </button>

              </div>

              {/* Tools stay together so they wrap as one group on narrow screens. */}
              <div className="flex items-center sm:border-l sm:border-neutral-800 sm:pl-2">
                {onApplyAgentActions && <details className="relative" onClick={event => event.stopPropagation()}>
                  <summary aria-label={lang === 'uk' ? 'Меню завдання' : 'Task menu'} title={lang === 'uk' ? 'Меню завдання' : 'Task menu'} className={iconAction + ' list-none cursor-pointer [&::-webkit-details-marker]:hidden'}><MoreHorizontal className="h-4 w-4" aria-hidden="true" /></summary>
                  <div className="absolute bottom-full right-0 z-30 mb-2 min-w-44 border border-neutral-700 bg-neutral-950 p-1 shadow-xl">
                    <button type="button" onClick={event => { const menu = event.currentTarget.closest('details'); const trigger = menu?.querySelector('summary'); if (trigger) openSchedule(trigger); menu?.removeAttribute('open'); }} className="min-h-11 w-full px-3 py-2 text-left text-sm text-neutral-300 hover:bg-neutral-900 hover:text-white focus-visible:outline-2 focus-visible:outline-white">{lang === 'uk' ? 'Змінити час' : 'Change time'}</button>
                  </div>
                </details>}


                <button
                  id={`task-edit-btn-${task.id}`}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    sound.tick(500);
                    if (isEditingTask) setIsEditingTask(false);
                    else beginEditingTask();
                  }}
                  title={lang === 'uk' ? 'Редагувати текст завдання (або ПКМ)' : 'Edit task text (or right-click)'}
                  aria-label={lang === 'uk' ? 'Редагувати текст завдання' : 'Edit task text'}
                  className={iconAction}
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  id={`task-delete-btn-${task.id}`}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    sound.tick(300);
                    onDelete(task.id);
                  }}
                  title={lang === 'uk' ? 'Видалити завдання' : 'Delete task'}
                  aria-label={lang === 'uk' ? 'Видалити завдання' : 'Delete task'}
                  className={`${iconAction} hover:text-rose-400`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  id={`task-ai-btn-${task.id}`}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    sound.activate();
                    onAskAIAboutTask(task.title);
                  }}
                  title={t.askAI}
                  aria-label={t.askAI}
                  className={`${iconAction} hover:text-emerald-400`}
                >
                  <AIIcon className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Collapsible Animated Sub-Card with Granular Steps & Descriptions */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            id={`task-steps-subcard-${task.id}`}
            initial={{ opacity: 0, height: 0, y: -4 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={{ opacity: 0, height: 0, y: -4 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="relative z-10 overflow-hidden"
          >
            <div className="bg-[#08080a] border border-neutral-800 border-t-0 px-4 py-5 sm:px-5 sm:py-6 space-y-5">
              {/* Sub-Card Header */}
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-sans font-bold tracking-wider text-neutral-400 uppercase">
                    {lang === 'uk' ? '\u041a\u0440\u043e\u043a\u0438' : 'Steps'}
                  </span>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  {onAIBreakdown && (
                    <button
                      type="button"
                      id={`ai-breakdown-step-btn-${task.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onAIBreakdown(task.id);
                      }}
                      disabled={isBreakingDown}
                      title={lang === 'uk' ? 'Автоматично розбити це завдання на послідовні підкроки через ШІ' : 'Auto-break down this task into steps via AI'}
                      aria-label={isBreakingDown ? t.stepsSection.aiBreakingDown : t.stepsSection.aiBreakdownBtn}
                      aria-busy={isBreakingDown}
                      className="inline-flex items-center justify-center gap-2 whitespace-nowrap border border-neutral-800 bg-transparent px-3 py-2 text-xs font-sans font-bold uppercase tracking-wider text-neutral-300 transition-colors hover:border-white hover:text-white focus-visible:outline-none focus-visible:border-white disabled:cursor-wait disabled:border-neutral-800 disabled:bg-neutral-950 disabled:text-neutral-600"
                    >
                      {isBreakingDown ? (
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <AIIcon className="h-3.5 w-3.5" />
                      )}
                      <span>{isBreakingDown ? t.stepsSection.aiBreakingDown : t.stepsSection.aiBreakdownBtn}</span>
                    </button>
                  )}

                  <button
                    type="button"
                    id={`add-step-inline-btn-${task.id}`}
                    onClick={() => {
                      sound.tick(600);
                      setIsAddingStep(!isAddingStep);
                    }}
                    className="inline-flex items-center justify-center gap-2 whitespace-nowrap border border-neutral-800 bg-transparent px-3 py-2 text-xs font-sans font-bold uppercase tracking-wider text-neutral-300 transition-colors hover:border-white hover:text-white focus-visible:outline-none focus-visible:border-white"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{t.stepsSection.addStepBtn}</span>
                  </button>
                </div>
              </div>

              {/* Inline Add Step Form */}
              <AnimatePresence>
                {isAddingStep && (
                  <motion.form
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    onSubmit={handleCreateStepSubmit}
                    className="flex items-center gap-2 overflow-hidden"
                  >
                    <input
                      type="text"
                      id={`new-step-text-input-${task.id}`}
                      value={newStepText}
                      onChange={(e) => setNewStepText(e.target.value)}
                      placeholder={t.stepsSection.stepPlaceholder}
                      autoFocus
                      className="min-w-0 flex-1 bg-[#101014] border border-neutral-700 focus:border-white text-white placeholder:text-neutral-500 px-3 py-2 text-sm leading-relaxed font-sans transition-colors"
                    />
                    <button
                      type="submit"
                      disabled={!newStepText.trim()}
                      className="px-3 py-2.5 bg-white text-black font-extrabold text-xs font-sans uppercase tracking-wider hover:bg-neutral-200 transition-colors disabled:opacity-40"
                    >
                      OK
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsAddingStep(false)}
                      aria-label={lang === 'uk' ? 'Скасувати' : 'Cancel'}
                      className="p-2.5 border border-neutral-800 text-neutral-400 hover:text-white"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </motion.form>
                )}
              </AnimatePresence>

              {/* Steps List */}
              {effectiveStepList.length > 0 ? (
                <ol className="relative divide-y divide-neutral-800/70 border-y border-neutral-800/70">
                  {effectiveStepList.map((step, sIdx) => {
                    const isDone = step.done;
                    const isCurrent = sIdx === nextStepIndex;
                    return (
                      <li key={step.id || sIdx} id={`task-${task.id}-step-row-${sIdx}`}
                        className={`group/step relative flex items-center gap-2 transition-colors ${isCurrent ? 'bg-white/[0.035]' : 'hover:bg-white/[0.02]'}`}>
                        {isCurrent && <span className="absolute inset-y-3 left-0 w-0.5 bg-neutral-200" aria-hidden="true" />}
                        <button
                          type="button"
                          id={`step-checkbox-${task.id}-${sIdx}`}
                          role="checkbox"
                          aria-checked={isDone}
                          aria-label={step.title}
                          onClick={() => handleToggleSubStep(sIdx)}
                          className="flex min-w-0 flex-1 items-center gap-4 px-3 py-4 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white sm:px-4 sm:py-5">
                          <span aria-hidden="true" className={`flex h-8 w-8 shrink-0 items-center justify-center border font-sans text-xs tabular-nums transition-colors ${isDone ? 'border-neutral-600 bg-neutral-800 text-neutral-300' : isCurrent ? 'border-white bg-white text-black' : 'border-neutral-700 text-neutral-400 group-hover/step:border-neutral-400'}`}>
                            {isDone ? <Check className="h-4 w-4" /> : String(sIdx + 1).padStart(2, '0')}
                          </span>
                          <span className="min-w-0 flex-1">
                            {isCurrent && <span className="mb-1 block text-xs font-sans text-neutral-400">{t.stepsSection.stepPending}</span>}
                            <span className={`block break-words text-sm font-sans leading-relaxed ${isDone ? 'text-neutral-400 line-through decoration-neutral-700' : 'text-neutral-100'}`}>{step.title}</span>
                          </span>
                        </button>
                        {onDeleteStepItem && hasStepList && (
                          <button type="button"
                            onClick={() => { if (!allowAction('delete-step')) return; sound.tick(300); onDeleteStepItem(task.id, sIdx); }}
                            aria-label={`${lang === 'uk' ? '\u0412\u0438\u0434\u0430\u043b\u0438\u0442\u0438 \u043a\u0440\u043e\u043a' : 'Delete step'}: ${step.title}`}
                            className="mr-2 flex h-9 w-9 shrink-0 items-center justify-center text-neutral-500 transition-colors hover:bg-rose-950/30 hover:text-rose-400 focus-visible:outline-2 focus-visible:outline-white sm:mr-3">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <div className="py-2 text-center text-xs font-sans text-neutral-400 flex flex-col items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setIsAddingStep(true)}
                    className="text-xs uppercase font-bold text-neutral-300 hover:text-white underline underline-offset-4"
                  >
                    {t.stepsSection.addStepBtn}
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {scheduleOpen && onApplyAgentActions && <TaskScheduleDialog
        task={task} lang={lang} timeZone={timeZone} triggerRef={scheduleTriggerRef} onApply={onApplyAgentActions}
        onClose={() => setScheduleOpen(false)}
        onExtend={hasCountdown && onExtendCountdown ? () => { setScheduleOpen(false); const trigger = document.getElementById('task-time-settings-' + task.id); timeTriggerRef.current = scheduleTriggerRef.current instanceof HTMLButtonElement ? scheduleTriggerRef.current : trigger instanceof HTMLButtonElement ? trigger : null; setCorrectionOpen(false); setIsConfiguringTimer(true); } : undefined}
      />}

      {isConfiguringTimer && <TaskTimeDialog
        task={task} lang={lang} triggerRef={timeTriggerRef} correctionOpen={correctionOpen}
        onClose={() => setIsConfiguringTimer(false)} onExtend={onExtendCountdown}
        onConfigure={onConfigureCountdown} onClear={onClearCountdown} onCorrect={onUpdateTimeSpent}
      />}

    </div>
  );
};

export const TaskCard = React.memo(TaskCardComponent);
