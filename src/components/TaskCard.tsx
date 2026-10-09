import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform, useDragControls } from 'motion/react';
import { PSTask, TaskTab } from '../types';
import { sound } from '../utils/audio';
import { getTaskTotalSeconds, getTaskRemainingSeconds, getTaskTimerMode } from '../utils/taskTimer';
import { Language, TRANSLATIONS } from '../utils/i18n';
import { AIIcon } from './AIIconTemplates';
import { TaskTimeDialog } from './TaskTimeDialog';
import {
  Pin,
  Trash2,
  Check,
  ArrowRight,
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
} from 'lucide-react';

interface TaskCardProps {
  task: PSTask;
  index: number;
  lang: Language;
  tabs?: TaskTab[];
  onToggleDone: (id: string) => void;
  onStartTask?: (id: string) => void;
  onUpdateStep: (id: string, step: number) => void;
  onCyclePriority: (id: string) => void;
  onCyclePhase: (id: string) => void;
  onTogglePin: (id: string) => void;
  onDelete: (id: string) => void;
  onEditTask?: (taskId: string, updatedTitle: string, updatedNote?: string) => void;
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

function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;

  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatDurationFull(totalSeconds: number, lang: Language): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;

  if (lang === 'uk') {
    if (hrs > 0) return `${hrs} год ${mins} хв ${secs} сек`;
    if (mins > 0) return `${mins} хв ${secs} сек`;
    return `${secs} сек`;
  }
  if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
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
  index,
  lang,
  tabs = [],
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
}) => {
  const t = TRANSLATIONS[lang];
  const [isSlashing, setIsSlashing] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isAddingStep, setIsAddingStep] = useState(false);
  const [newStepText, setNewStepText] = useState('');
  const [isEditingTask, setIsEditingTask] = useState(false);
  const [editTitleText, setEditTitleText] = useState(task.title);
  const [editNoteText, setEditNoteText] = useState(task.note || '');
  const [isConfiguringTimer, setIsConfiguringTimer] = useState(false);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const timeTriggerRef = useRef<HTMLButtonElement>(null);
  const openTimeSettings = (trigger: HTMLButtonElement, correction = false) => {
    timeTriggerRef.current = trigger;
    setCorrectionOpen(correction);
    setIsConfiguringTimer(true);
  };
  const x = useMotionValue(0);
  const dragControls = useDragControls();

  // Live stopwatch interval (only ticks when timer is running)
  useEffect(() => {
    setNow(Date.now());
    if (!task.timerRunning) return;
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [task.timerRunning, task.timerStartedAt]);

  // Compute live seconds spent on task
  const currentElapsedSeconds = getTaskTotalSeconds(task, now);
  const timerMode = getTaskTimerMode(task);
  const hasCountdown = timerMode === 'countdown' && (task.countdownDurationSeconds || 0) > 0;
  const remainingSeconds = getTaskRemainingSeconds(task, now) ?? 0;
  const showTimerWidget = timerMode !== 'none' || !!task.timerRunning;
  const timerValue = formatTime(hasCountdown ? remainingSeconds : currentElapsedSeconds);
  const countdownFinished = hasCountdown && remainingSeconds === 0;
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

  const handleDragEnd = (_: any, info: { offset: { x: number } }) => {
    if (info.offset.x < -75) {
      // Swiped Left -> Slice / Toggle Complete
      sound.slice();
      setIsSlashing(true);
      setTimeout(() => {
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

  return (
    <div id={`task-wrapper-${task.id}`} className="relative group select-none touch-pan-y">
      {/* Background Gesture Layer - Left: Slice to Complete */}
      <motion.div
        style={{ opacity: bgOpacityLeft }}
        className="absolute inset-0 bg-neutral-900 border border-neutral-700 flex items-center justify-end px-5 rounded-none z-0"
      >
        <div className="flex items-center gap-2 text-xs uppercase font-bold tracking-widest text-neutral-200">
          <span>{task.done ? t.restoreOperation : t.slashToComplete}</span>
          <Check className="w-4 h-4 text-white" />
        </div>
      </motion.div>

      {/* Background Gesture Layer - Right: Pin / Boost */}
      <motion.div
        style={{ opacity: bgOpacityRight }}
        className="absolute inset-0 bg-neutral-900 border border-neutral-700 flex items-center justify-start px-5 rounded-none z-0"
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
          if (isEditingTask || (isExpanded && isAddingStep) || isConfiguringTimer || event.button !== 0) return;
          const target = event.target;
          if (target instanceof Element && target.closest('button, input, textarea, select, a, [role="button"], [contenteditable="true"]')) return;
          dragControls.start(event);
        }}
        dragConstraints={{ left: -100, right: 100 }}
        dragElastic={0.2}
        onDragEnd={handleDragEnd}
        onContextMenu={(e) => {
          const target = e.target;
          if (isEditingTask || (target instanceof Element && target.closest('button, input, textarea, select, a, [role="button"], [contenteditable="true"]'))) return;
          e.preventDefault();
          sound.tick(500);
          setEditTitleText(task.title);
          setEditNoteText(task.note || '');
          setIsEditingTask(true);
        }}
        style={{ x, rotate: x.get() < 0 ? rotateLeft : rotateRight }}
        whileTap={{ cursor: 'grabbing' }}
        className={`relative z-10 bg-[#0c0c0d] border transition-all duration-200 p-4 cursor-grab ${
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
          {/* Top Meta Row */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {/* Sequential Index */}
              <span className="text-xs font-bold tracking-widest text-neutral-500 font-mono">
                #{String(index + 1).padStart(2, '0')}
              </span>

              {/* Phase / Category Tag (Clickable to cycle through active tabs) */}
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
                className="inline-flex min-h-11 min-w-11 items-center justify-center transition-transform active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                <span
                  style={matchedTab?.color ? {
                    borderColor: `${matchedTab.color}66`,
                    backgroundColor: `${matchedTab.color}18`,
                    color: matchedTab.color,
                  } : undefined}
                  className={`flex items-center gap-1.5 border px-2 py-1 text-xs uppercase font-extrabold tracking-wider ${
                    !matchedTab?.color ? `${phaseStyle.border} ${phaseStyle.bg} ${phaseStyle.text}` : ''
                  }`}
                >
                  {matchedTab?.color && (
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0 shadow-sm"
                      style={{ backgroundColor: matchedTab.color }}
                    />
                  )}
                  <span>[{phaseLabel}]</span>
                </span>
              </button>

              {/* Priority Bar Indicator (Clickable to cycle: Green -> Yellow -> Red) */}
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
                className="group/priority inline-flex min-h-11 min-w-11 items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                <span
                  className={`flex items-center gap-1 px-1.5 py-1 bg-[#0a0a0c] border transition-colors ${
                    task.priority === 1
                      ? 'border-red-900/70 group-hover/priority:border-red-500 bg-red-950/20'
                      : task.priority === 2
                      ? 'border-amber-900/70 group-hover/priority:border-amber-500 bg-amber-950/20'
                      : 'border-emerald-900/70 group-hover/priority:border-emerald-500 bg-emerald-950/20'
                  }`}
                >
                  <span
                    className={`text-xs font-mono font-bold mr-0.5 ${
                      task.priority === 1
                        ? 'text-red-400'
                        : task.priority === 2
                        ? 'text-amber-400'
                        : 'text-emerald-400'
                    }`}
                  >
                    PRI
                  </span>
                  <span className="flex items-center gap-0.5 h-2.5" aria-hidden="true">
                    <span
                      className={`w-1 h-2.5 transition-all ${
                        task.priority <= 3
                          ? 'bg-emerald-400 shadow-[0_0_5px_rgba(52,211,153,0.8)]'
                          : 'bg-neutral-800'
                      }`}
                    />
                    <span
                      className={`w-1 h-2.5 transition-all ${
                        task.priority <= 2
                          ? 'bg-amber-400 shadow-[0_0_5px_rgba(251,191,36,0.8)]'
                          : 'bg-neutral-800'
                      }`}
                    />
                    <span
                      className={`w-1 h-2.5 transition-all ${
                        task.priority === 1
                          ? 'bg-red-500 shadow-[0_0_7px_rgba(239,68,68,0.9)]'
                          : 'bg-neutral-800'
                      }`}
                    />
                  </span>
                </span>
              </button>

              {task.pinned && (
                <span className="flex items-center text-xs font-sans text-neutral-400">
                  <Pin className="w-2.5 h-2.5 fill-neutral-400 mr-1" />
                  PIN
                </span>
              )}
            </div>

            {/* Quick task actions */}
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {/* Edit Task Text */}
              <button
                id={`task-edit-btn-${task.id}`}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  sound.tick(500);
                  setEditTitleText(task.title);
                  setEditNoteText(task.note || '');
                  setIsEditingTask((prev) => !prev);
                }}
                title={lang === 'uk' ? 'Редагувати текст завдання (або ПКМ)' : 'Edit task text (or right-click)'}
                aria-label={lang === 'uk' ? 'Редагувати текст завдання' : 'Edit task text'}
                className="inline-flex h-11 w-11 items-center justify-center text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                <Pencil className="h-5 w-5" aria-hidden="true" />
              </button>

              {/* Delete */}
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
                className="inline-flex h-11 w-11 items-center justify-center text-neutral-400 hover:text-rose-400 hover:bg-neutral-800 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                <Trash2 className="h-5 w-5" aria-hidden="true" />
              </button>

              {/* Ask AI about this task */}
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
                className="inline-flex h-11 w-11 items-center justify-center text-neutral-400 hover:text-emerald-400 hover:bg-neutral-800 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                <AIIcon className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Time focus: timer rail beside the task text on wider cards. */}
          <div className={`grid min-w-0 gap-4 ${showTimerWidget ? 'sm:grid-cols-[208px_minmax(0,1fr)] sm:gap-5' : ''}`}>
            {showTimerWidget && (
              <section
                id={`task-timer-widget-${task.id}`}
                aria-label={lang === 'uk' ? 'Час завдання' : 'Task time'}
                className="min-w-0 border-b border-neutral-800/70 pb-3 font-sans sm:border-b-0 sm:border-r sm:pb-0 sm:pr-3"
              >
                <div className="min-w-0">
                  <p className="text-xs leading-relaxed text-neutral-400">
                    {hasCountdown
                      ? (lang === 'uk' ? 'ЗАЛИШИЛОСЬ' : 'REMAINING')
                      : (lang === 'uk' ? 'ВИТРАЧЕНО' : 'TIME SPENT')}
                  </p>
                  <p role="status" className={`mt-1 text-[13px] font-medium leading-relaxed ${task.timerRunning ? 'text-emerald-300' : countdownFinished ? 'text-amber-300' : 'text-neutral-400'}`}>
                    {task.timerRunning ? (lang === 'uk' ? 'Таймер працює' : 'Timer running')
                      : task.done ? (lang === 'uk' ? 'Завершено' : 'Completed')
                      : countdownFinished ? (lang === 'uk' ? 'Час вийшов · завершіть завдання, коли будете готові' : 'Time is up · complete the task when ready')
                      : hasStarted ? (lang === 'uk' ? 'На паузі' : 'Paused') : (lang === 'uk' ? 'Готовий до початку' : 'Ready to start')}
                  </p>
                  <button
                    type="button" id={`task-time-settings-${task.id}`}
                    aria-haspopup="dialog" aria-controls={`task-time-dialog-${task.id}`}
                    aria-label={`${lang === 'uk' ? 'Налаштувати час' : 'Configure time'}: ${formatDurationFull(hasCountdown ? remainingSeconds : currentElapsedSeconds, lang)}`}
                    onClick={event => { event.stopPropagation(); openTimeSettings(event.currentTarget); }}
                    className={`mt-1 block min-h-11 w-full whitespace-nowrap text-left font-semibold leading-tight tabular-nums tracking-tight focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${timerValue.length > 5 ? 'text-[36px]' : 'text-[52px]'} ${task.timerRunning ? 'text-emerald-300' : countdownFinished ? 'text-amber-300' : 'text-neutral-100'}`}>
                    {timerValue}
                  </button>
                  <p className="mt-1 text-xs leading-relaxed text-neutral-400">{lang === 'uk' ? 'Натисніть, щоб налаштувати час' : 'Click to configure time'}</p>
                  {hasCountdown && <div role="progressbar"
                    aria-label={lang === 'uk' ? 'Прогрес зворотного відліку' : 'Countdown progress'}
                    aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(countdownProgress)}
                    aria-valuetext={lang === 'uk' ? `Залишилось ${formatDurationFull(remainingSeconds, lang)}` : `${formatDurationFull(remainingSeconds, lang)} remaining`}
                    className="mt-3 h-1 overflow-hidden bg-neutral-800">
                    <div style={{ width: `${countdownProgress}%` }} className={`h-full transition-[width] duration-500 ${countdownFinished ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                  </div>}
                </div>
              </section>
            )}

            {/* Task Title & Notes */}
            <div className="relative min-w-0">
              {isEditingTask ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!editTitleText.trim() || !onEditTask) return;
                    onEditTask(task.id, editTitleText.trim(), editNoteText.trim());
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
                      disabled={!editTitleText.trim() || !onEditTask}
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
                    className={`text-lg font-semibold leading-[27px] break-words [overflow-wrap:anywhere] transition-all ${
                      task.done
                        ? 'line-through text-neutral-400 decoration-neutral-600 decoration-2'
                        : 'text-neutral-100 hover:text-white'
                    }`}
                  >
                    {task.title}
                  </h3>
                  {Number.isFinite(task.scheduledFor) && <p className="mt-1 text-sm leading-relaxed text-emerald-300">{lang === 'uk' ? 'Заплановано на' : 'Planned for'} {new Intl.DateTimeFormat(lang === 'uk' ? 'uk-UA' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(task.scheduledFor)}</p>}

                  {task.note && (
                    <div className="mt-2 text-[15px] leading-[1.6] break-words [overflow-wrap:anywhere] font-sans text-neutral-300">
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
              {showTimerWidget && (
                <div className="mt-3 flex flex-col gap-3 font-sans">
                  {hasCountdown && <p className="text-xs leading-relaxed text-neutral-400">
                    {lang === 'uk' ? 'Тривалість' : 'Duration'}: {formatDurationFull(task.countdownDurationSeconds!, lang)}
                    {' · '}{lang === 'uk' ? 'Всього витрачено' : 'Total spent'}: {formatTime(currentElapsedSeconds)}
                  </p>}
                  <div className="flex flex-wrap items-center gap-2">
                    {!task.done && !hasStarted && <button
                      type="button" id={`task-start-action-${task.id}`} disabled={!onStartTask}
                      onClick={(e) => { e.stopPropagation(); sound.activate(); onStartTask?.(task.id); }}
                      className="inline-flex min-h-11 items-center justify-center gap-2 border border-white bg-white px-3 py-2 text-sm font-bold text-black hover:bg-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-40">
                      <Play className="h-5 w-5" aria-hidden="true" />
                      {lang === 'uk' ? 'Почати' : 'Start'}
                    </button>}
                    {task.timerRunning && onStopTimer && <button
                      type="button" id={`task-timer-stop-${task.id}`}
                      title={lang === 'uk'
                        ? 'Зупинити зі збереженням витраченого часу й залишку. Можна продовжити пізніше.'
                        : 'Stop and keep time spent and remaining time. You can resume later.'}
                      onClick={(e) => { e.stopPropagation(); onStopTimer(task.id); }}
                      className="inline-flex min-h-11 items-center justify-center gap-2 border border-white bg-white px-3 py-2 text-sm font-bold text-black transition-colors hover:bg-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
                      <Square className="h-5 w-5" aria-hidden="true" />
                      {lang === 'uk' ? 'Зупинити' : 'Stop'}
                    </button>}
                    {(task.timerRunning || (hasStarted && !task.done)) && onToggleTimer && !(task.timerRunning && onStopTimer) && <button
                      type="button" id={`task-timer-toggle-${task.id}`}
                      onClick={(e) => { e.stopPropagation(); onToggleTimer(task.id); }}
                      className="inline-flex min-h-11 items-center justify-center gap-2 border border-white bg-white px-3 py-2 text-sm font-bold text-black transition-colors hover:bg-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
                      {task.timerRunning ? <Pause className="h-5 w-5" aria-hidden="true" /> : <Play className="h-5 w-5" aria-hidden="true" />}
                      {timerToggleLabel}
                    </button>}
                    {!hasCountdown && currentElapsedSeconds > 0 && !task.timerRunning && !task.done && onResetTimer && <button
                      type="button" id={`task-timer-reset-${task.id}`}
                      onClick={(e) => { e.stopPropagation(); onResetTimer(task.id); }}
                      className="inline-flex min-h-11 items-center justify-center gap-2 px-3 py-2 text-xs text-neutral-400 transition-colors hover:text-rose-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
                      <RotateCcw className="h-5 w-5" aria-hidden="true" />{t.timer.reset}
                    </button>}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Task progress and explicit work actions */}
          <div className="pt-3 flex flex-wrap items-center justify-between gap-4 border-t border-neutral-800/70">
            {/* Scrubber & Active Step Description */}
            <div className="flex min-w-0 basis-full flex-wrap items-center gap-x-3 gap-y-1 md:basis-auto md:flex-1">
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
                className={`flex min-h-11 items-center gap-2 text-xs font-sans uppercase font-bold tracking-wider px-3 py-2 border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
                  isExpanded
                    ? 'border-white bg-neutral-900 text-white'
                    : effectiveStepList.length > 0
                    ? 'border-neutral-700 text-neutral-300 hover:border-neutral-500 hover:text-white bg-neutral-950'
                    : 'border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-neutral-300'
                }`}
                title={isExpanded ? t.stepsSection.collapse : effectiveStepList.length > 0 ? t.stepsSection.expand : t.stepsSection.addStepBtn}
              >
                {isExpanded ? <ChevronUp className="h-5 w-5" aria-hidden="true" />
                  : effectiveStepList.length > 0 ? <ChevronDown className="h-5 w-5" aria-hidden="true" />
                  : <Plus className="h-5 w-5" aria-hidden="true" />}
                <span>{isExpanded ? t.stepsSection.collapse : effectiveStepList.length > 0
                  ? `${t.step} ${completedStepCount}/${effectiveStepList.length}`
                  : (lang === 'uk' ? 'Додати підзавдання' : 'Add subtask')}</span>
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
                      <span aria-hidden="true" className={`h-3 w-full transition-all ${isFilled
                        ? 'bg-neutral-100 shadow-[0_0_6px_rgba(255,255,255,0.2)]' : 'bg-neutral-800 hover:bg-neutral-700'}`} />
                    </button>
                  );
                })}
              </div>}

            </div>

            {/* Work status and completion are separate from timer controls. */}
            <div className="flex flex-wrap items-center gap-2">
              {!showTimerWidget && !task.done && !hasStarted && <button
                type="button" id={`task-start-action-${task.id}`} disabled={!onStartTask}
                onClick={(e) => { e.stopPropagation(); sound.activate(); onStartTask?.(task.id); }}
                className="inline-flex min-h-11 items-center justify-center gap-2 border border-white bg-white px-3 py-2 text-sm font-sans font-bold text-black hover:bg-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-40">
                <Play className="h-5 w-5" aria-hidden="true" />
                {lang === 'uk' ? 'Почати' : 'Start'}
              </button>}
              {!task.done && hasStarted && <span className="inline-flex min-h-11 items-center px-2 text-xs font-sans text-emerald-300">
                {lang === 'uk' ? 'У роботі' : 'In progress'}
              </span>}
              {task.done && <span className="inline-flex min-h-11 items-center px-2 text-xs font-sans text-neutral-400">
                {lang === 'uk' ? 'Завершено' : 'Completed'}
              </span>}
              {showTimerWidget && !task.done && !hasStarted && <span className="inline-flex min-h-11 items-center px-2 text-xs font-sans text-neutral-400">
                {lang === 'uk' ? 'Не розпочато' : 'Not started'}
              </span>}

              {/* Explicit completion preserves subtask progress and recorded time */}
              <button
                type="button"
                id={`task-toggle-action-${task.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  sound.slice();
                  onToggleDone(task.id);
                }}
                className={`inline-flex min-h-11 items-center justify-center gap-2 text-sm font-sans font-bold px-3 py-2 border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
                  task.done
                    ? 'border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-white'
                    : 'border-neutral-700 text-neutral-300 hover:border-white hover:text-white'
                }`}
              >
                {task.done ? <RotateCcw className="h-5 w-5" aria-hidden="true" /> : <Check className="h-5 w-5" aria-hidden="true" />}
                {task.done ? (lang === 'uk' ? 'Відновити' : 'Reopen') : (lang === 'uk' ? 'Завершити' : 'Complete')}
              </button>
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
            className="overflow-hidden"
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
                            onClick={() => { sound.tick(300); onDeleteStepItem(task.id, sIdx); }}
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

      {isConfiguringTimer && <TaskTimeDialog
        task={task} lang={lang} triggerRef={timeTriggerRef} correctionOpen={correctionOpen}
        onClose={() => setIsConfiguringTimer(false)} onExtend={onExtendCountdown}
        onConfigure={onConfigureCountdown} onClear={onClearCountdown} onCorrect={onUpdateTimeSpent}
      />}

    </div>
  );
};

export const TaskCard = React.memo(TaskCardComponent);
