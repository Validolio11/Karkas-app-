import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useMotionValue, useTransform } from 'motion/react';
import { PSTask, TaskTab } from '../types';
import { sound } from '../utils/audio';
import { getTaskTotalSeconds, getTaskRemainingSeconds } from '../utils/taskTimer';
import { Language, TRANSLATIONS } from '../utils/i18n';
import {
  Pin,
  Trash2,
  Check,
  ArrowRight,
  SquareCode,
  ChevronDown,
  ChevronUp,
  Plus,
  X,
  Sparkles,
  LoaderCircle,
  Play,
  Pause,
  RotateCcw,
  Timer,
  Clock,
  AlertTriangle,
  Pencil,
} from 'lucide-react';

interface TaskCardProps {
  task: PSTask;
  index: number;
  lang: Language;
  tabs?: TaskTab[];
  onToggleDone: (id: string) => void;
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
  onResetTimer?: (taskId: string) => void;
  onUpdateTimeSpent?: (taskId: string, newTotalSeconds: number) => void;
  onConfigureCountdown?: (taskId: string, seconds: number) => void;
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
  onResetTimer,
  onUpdateTimeSpent,
  onConfigureCountdown,
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
  const [isEditingTime, setIsEditingTime] = useState(false);
  const [editHours, setEditHours] = useState(0);
  const [editMinutes, setEditMinutes] = useState(0);
  const [editSeconds, setEditSeconds] = useState(0);
  const [isConfiguringTimer, setIsConfiguringTimer] = useState(false);
  const [countdownMinutes, setCountdownMinutes] = useState('60');
  const [now, setNow] = useState(Date.now());
  const x = useMotionValue(0);

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
  const hasCountdown = (task.countdownDurationSeconds || 0) > 0;
  const remainingSeconds = getTaskRemainingSeconds(task, now) ?? 0;
  const countdownFinished = hasCountdown && remainingSeconds === 0;
  const timerToggleLabel = task.timerRunning
    ? t.timer.pause
    : countdownFinished ? (lang === 'uk' ? 'Повторити таймер' : 'Restart countdown') : t.timer.start;
  const validCountdownMinutes = Number.isInteger(Number(countdownMinutes))
    && Number(countdownMinutes) >= 1 && Number(countdownMinutes) <= 1440;

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
    : Array.from({ length: Math.max(1, task.steps || 1) }, (_, idx) => ({
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
        dragConstraints={{ left: -100, right: 100 }}
        dragElastic={0.2}
        onDragEnd={handleDragEnd}
        onContextMenu={(e) => {
          e.preventDefault();
          sound.tick(500);
          setEditTitleText(task.title);
          setEditNoteText(task.note || '');
          setIsEditingTask(true);
        }}
        style={{ x, rotate: x.get() < 0 ? rotateLeft : rotateRight }}
        whileTap={{ cursor: 'grabbing' }}
        className={`relative z-10 bg-[#0c0c0d] border transition-all duration-200 p-4 sm:p-5 cursor-grab ${
          task.timerRunning
            ? 'border-emerald-500/90 shadow-[0_0_20px_rgba(52,211,153,0.3)] ring-1 ring-emerald-500/50 animate-pulse'
            : task.done
            ? 'border-neutral-800/80 bg-[#080808]/90 opacity-70'
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
                onClick={(e) => {
                  e.stopPropagation();
                  sound.tick(700);
                  onCyclePhase(task.id);
                }}
                style={
                  matchedTab?.color
                    ? {
                        borderColor: `${matchedTab.color}66`,
                        backgroundColor: `${matchedTab.color}18`,
                        color: matchedTab.color,
                      }
                    : undefined
                }
                title={lang === 'uk' ? 'Натисніть для зміни вкладки/категорії' : 'Tap to cycle category'}
                className={`text-xs uppercase font-extrabold tracking-wider px-2 py-1 border flex items-center gap-1.5 ${
                  !matchedTab?.color ? `${phaseStyle.border} ${phaseStyle.bg} ${phaseStyle.text}` : ''
                } transition-transform active:scale-95`}
              >
                {matchedTab?.color && (
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0 shadow-sm"
                    style={{ backgroundColor: matchedTab.color }}
                  />
                )}
                <span>[{phaseLabel}]</span>
              </button>

              {/* Priority Bar Indicator (Clickable to cycle: Green -> Yellow -> Red) */}
              <button
                id={`task-priority-btn-${task.id}`}
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
                className={`flex items-center gap-1 px-1.5 py-1 bg-[#0a0a0c] border transition-colors ${
                  task.priority === 1
                    ? 'border-red-900/70 hover:border-red-500 bg-red-950/20'
                    : task.priority === 2
                    ? 'border-amber-900/70 hover:border-amber-500 bg-amber-950/20'
                    : 'border-emerald-900/70 hover:border-emerald-500 bg-emerald-950/20'
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
                <div className="flex items-center gap-0.5 h-2.5">
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
                </div>
              </button>

              {task.pinned && (
                <span className="flex items-center text-xs font-mono text-neutral-400">
                  <Pin className="w-2.5 h-2.5 fill-neutral-400 mr-1" />
                  PIN
                </span>
              )}
            </div>

            {/* Right side: Stopwatch / Timer & Quick Micro-Actions */}
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              {/* Task Stopwatch / Timer Widget */}
              <div
                id={`task-timer-widget-${task.id}`}
                className={`flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-2 py-1 border font-mono transition-all ${
                  task.timerRunning
                    ? 'border-emerald-500/80 bg-emerald-950/30 text-emerald-300 shadow-[0_0_10px_rgba(52,211,153,0.15)]'
                    : currentElapsedSeconds > 0
                    ? 'border-neutral-700 bg-neutral-900/90 text-neutral-200'
                    : 'border-neutral-800 bg-[#0a0a0c] text-neutral-400 hover:border-neutral-700'
                }`}
                title={`${t.timer.timeSpent}: ${formatDurationFull(currentElapsedSeconds, lang)} (${task.timerRunning ? t.timer.running : t.timer.paused})`}
              >
                {/* Play / Pause Toggle Button */}
                <button
                  type="button"
                  id={`task-timer-toggle-${task.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onToggleTimer) onToggleTimer(task.id);
                  }}
                  title={timerToggleLabel}
                  aria-label={timerToggleLabel}
                  className={`p-0.5 transition-transform active:scale-90 flex items-center justify-center ${
                    task.timerRunning
                      ? 'text-emerald-400 hover:text-emerald-300'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  {task.timerRunning ? (
                    <Pause className="w-2.5 h-2.5 fill-current" />
                  ) : (
                    <Play className="w-2.5 h-2.5 fill-current" />
                  )}
                </button>

                {/* Pulsing indicator when timer is active */}
                {task.timerRunning && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                )}

                {/* Live Formatted Stopwatch Time */}
                <span
                  className={`text-xs font-bold tracking-wider ${
                    task.timerRunning
                      ? 'text-emerald-300'
                      : currentElapsedSeconds > 0
                      ? 'text-neutral-200'
                      : 'text-neutral-500'
                  }`}
                >
                  {formatTime(hasCountdown ? remainingSeconds : currentElapsedSeconds)}
                </span>

                {hasCountdown && (
                  <span className="flex flex-col gap-0.5 border-l border-neutral-700 pl-1.5 text-[10px] leading-tight text-neutral-400">
                    <span className={countdownFinished ? 'text-amber-300' : ''} role="status">
                      {countdownFinished
                        ? (lang === 'uk' ? 'Час вийшов' : 'Time is up')
                        : (lang === 'uk' ? 'Залишилось' : 'Remaining')}
                    </span>
                    <span>{lang === 'uk' ? 'Всього' : 'Total'}: {formatTime(currentElapsedSeconds)}</span>
                  </span>
                )}

                {onConfigureCountdown && (
                  <button
                    type="button"
                    id={`task-timer-configure-${task.id}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setCountdownMinutes(String(Math.max(1, Math.round((task.countdownDurationSeconds || 3600) / 60))));
                      setIsConfiguringTimer(true);
                    }}
                    title={lang === 'uk' ? 'Налаштувати зворотний відлік' : 'Set countdown'}
                    aria-label={lang === 'uk' ? 'Налаштувати зворотний відлік' : 'Set countdown'}
                    className="p-1 text-neutral-400 transition-colors hover:text-white"
                  >
                    <Timer className="h-3.5 w-3.5" />
                  </button>
                )}

                {/* Reset Button (shows when paused and has recorded time) */}
                {!hasCountdown && currentElapsedSeconds > 0 && !task.timerRunning && onResetTimer && (
                  <button
                    type="button"
                    id={`task-timer-reset-${task.id}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onResetTimer(task.id);
                    }}
                    title={t.timer.reset}
                    className="p-0.5 text-neutral-500 hover:text-rose-400 transition-colors"
                  >
                    <RotateCcw className="w-2.5 h-2.5" />
                  </button>
                )}

                {/* Edit Time Button */}
                {onUpdateTimeSpent && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      sound.tick(400);
                      const total = currentElapsedSeconds;
                      setEditHours(Math.floor(total / 3600));
                      setEditMinutes(Math.floor((total % 3600) / 60));
                      setEditSeconds(total % 60);
                      setIsEditingTime(true);
                    }}
                    title={t.timer.editTime}
                    className="p-0.5 text-neutral-500 hover:text-neutral-200 transition-colors ml-0.5"
                  >
                    <Clock className="w-2.5 h-2.5" />
                  </button>
                )}
              </div>

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
                className="p-1 text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>

              {/* Ask AI about this task */}
              <button
                id={`task-ai-btn-${task.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  sound.activate();
                  onAskAIAboutTask(task.title);
                }}
                title={t.askAI}
                className="p-1 text-neutral-400 hover:text-emerald-400 hover:bg-neutral-800 transition-colors"
              >
                <SquareCode className="w-3.5 h-3.5" />
              </button>

              {/* Delete */}
              <button
                id={`task-delete-btn-${task.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  sound.tick(300);
                  onDelete(task.id);
                }}
                title={lang === 'uk' ? 'Видалити завдання' : 'Delete task'}
                className="p-1 text-neutral-600 hover:text-rose-400 hover:bg-neutral-800 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Task Title & Notes */}
          <div className="relative">
            {isEditingTask ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (editTitleText.trim() && onEditTask) {
                    onEditTask(task.id, editTitleText, editNoteText);
                  }
                  setIsEditingTask(false);
                }}
                onClick={(e) => e.stopPropagation()}
                className="flex flex-col gap-3 p-3 bg-[#08080a] border border-neutral-700 my-1 z-30"
              >
                <div className="text-xs font-mono text-neutral-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Pencil className="w-3 h-3 text-emerald-400" />
                  <span>{lang === 'uk' ? 'Редагування завдання' : 'Edit Task'}</span>
                </div>
                <input
                  type="text"
                  value={editTitleText}
                  onChange={(e) => setEditTitleText(e.target.value)}
                  placeholder={lang === 'uk' ? 'Назва завдання...' : 'Task title...'}
                  autoFocus
                  className="w-full px-2.5 py-1.5 bg-[#0d0d12] border border-neutral-700 text-white text-sm leading-relaxed font-mono focus:outline-none focus:border-white transition-colors"
                />
                <input
                  type="text"
                  value={editNoteText}
                  onChange={(e) => setEditNoteText(e.target.value)}
                  placeholder={lang === 'uk' ? 'Нотатка (необов\'язково)...' : 'Note (optional)...'}
                  className="w-full px-2.5 py-1.5 bg-[#0d0d12] border border-neutral-800 text-neutral-300 text-sm leading-relaxed font-mono focus:outline-none focus:border-neutral-600 transition-colors"
                />
                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setIsEditingTask(false)}
                    className="px-2.5 py-1 bg-neutral-800 border border-neutral-700 text-neutral-300 text-sm leading-relaxed font-mono font-bold hover:bg-neutral-700 transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                    <span>{lang === 'uk' ? 'Скасувати' : 'Cancel'}</span>
                  </button>
                  <button
                    type="submit"
                    className="px-2.5 py-1 bg-emerald-500 text-black text-xs font-mono font-extrabold hover:bg-emerald-400 transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    <Check className="w-3 h-3" />
                    <span>{lang === 'uk' ? 'Зберегти' : 'Save'}</span>
                  </button>
                </div>
              </form>
            ) : (
              <>
                <h3
                  onClick={() => {
                    sound.slice();
                    onToggleDone(task.id);
                  }}
                  className={`text-sm sm:text-base font-bold tracking-tight cursor-pointer leading-relaxed break-words transition-all ${
                    task.done
                      ? 'line-through text-neutral-500 decoration-neutral-600 decoration-2'
                      : 'text-neutral-100 hover:text-white'
                  }`}
                >
                  {task.title}
                </h3>

                {task.note && (
                  <div className="mt-2 text-sm leading-relaxed break-words font-mono text-neutral-300">
                    <span>{task.note}</span>
                  </div>
                )}
              </>
            )}

            {task.autoPausedOverdue && (
              <div
                className="flex items-center gap-1.5 px-2 py-1 bg-amber-950/40 border border-amber-500/40 text-amber-300 text-xs font-mono mt-1.5 cursor-pointer hover:bg-amber-950/60 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  sound.tick(400);
                  const total = currentElapsedSeconds;
                  setEditHours(Math.floor(total / 3600));
                  setEditMinutes(Math.floor((total % 3600) / 60));
                  setEditSeconds(total % 60);
                  setIsEditingTime(true);
                }}
                title={t.timer.editTime}
              >
                <AlertTriangle className="w-3 h-3 shrink-0 text-amber-400" />
                <span className="flex-1">{t.timer.autoPausedNotice}</span>
                <span className="text-xs underline underline-offset-2 text-amber-200">{t.timer.editTime}</span>
              </div>
            )}
          </div>

          {/* Interactive Step Scrubber Rail with Right-Side Step Description and Toggle Button */}
          <div className="pt-4 flex flex-wrap items-center justify-between gap-4 border-t border-neutral-800/70">
            {/* Scrubber & Active Step Description */}
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <span className="text-xs font-mono text-neutral-400 uppercase tracking-widest font-bold whitespace-nowrap">
                {t.step} {completedStepCount}/{effectiveStepList.length}
              </span>
              
              {/* Bars */}
              <div className="flex items-center gap-1 w-24 sm:w-28 h-3.5">
                {effectiveStepList.map((step, i) => {
                  const stepNum = i + 1;
                  const isFilled = step.done;
                  return (
                    <button
                      key={i}
                      id={`task-${task.id}-step-${stepNum}`}
                      onClick={(e) => handleStepClick(e, stepNum)}
                      title={`${t.step} ${stepNum} / ${effectiveStepList.length}`}
                      aria-label={`${t.step} ${stepNum} / ${effectiveStepList.length}`}
                      aria-pressed={isFilled}
                      className={`h-3 flex-1 transition-all rounded-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
                        isFilled
                          ? 'bg-neutral-100 shadow-[0_0_6px_rgba(255,255,255,0.2)]'
                          : 'bg-neutral-800 hover:bg-neutral-700'
                      }`}
                    />
                  );
                })}
              </div>

            </div>

            {/* Steps Drawer Toggle & Complete Button */}
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Collapsible Steps Button */}
              <button
                id={`task-toggle-steps-${task.id}`}
                aria-expanded={isExpanded}
                aria-controls={`task-steps-subcard-${task.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  sound.tick(500);
                  setIsExpanded(!isExpanded);
                }}
                className={`flex items-center gap-2 text-xs font-mono uppercase font-bold tracking-wider px-3 py-2 border transition-all ${
                  isExpanded
                    ? 'border-white bg-neutral-900 text-white'
                    : hasStepList
                    ? 'border-neutral-700 text-neutral-300 hover:border-neutral-500 hover:text-white bg-neutral-950'
                    : 'border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-neutral-300'
                }`}
                title={isExpanded ? t.stepsSection.collapse : t.stepsSection.expand}
              >
                <span>{isExpanded ? t.stepsSection.collapse : t.stepsSection.expand}</span>
                {isExpanded ? (
                  <ChevronUp className="w-3 h-3" />
                ) : (
                  <ChevronDown className="w-3 h-3" />
                )}
              </button>

              {/* Quick Slash Action / Done Toggle */}
              <button
                id={`task-toggle-action-${task.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  sound.slice();
                  onToggleDone(task.id);
                }}
                className={`text-xs font-mono uppercase font-bold tracking-wider px-3 py-2 border transition-all ${
                  task.done
                    ? 'border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-white'
                    : 'border-neutral-700 text-neutral-300 hover:border-white hover:text-white'
                }`}
              >
                {task.done ? t.reopenBtn : t.completedBtn}
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
                  <span className="text-xs font-mono font-bold tracking-wider text-neutral-400 uppercase">
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
                      className="inline-flex items-center justify-center gap-2 whitespace-nowrap border border-neutral-800 bg-transparent px-3 py-2 text-xs font-mono font-bold uppercase tracking-wider text-neutral-300 transition-colors hover:border-white hover:text-white focus-visible:outline-none focus-visible:border-white disabled:cursor-wait disabled:border-neutral-800 disabled:bg-neutral-950 disabled:text-neutral-600"
                    >
                      {isBreakingDown ? (
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
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
                    className="inline-flex items-center justify-center gap-2 whitespace-nowrap border border-neutral-800 bg-transparent px-3 py-2 text-xs font-mono font-bold uppercase tracking-wider text-neutral-300 transition-colors hover:border-white hover:text-white focus-visible:outline-none focus-visible:border-white"
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
                      className="min-w-0 flex-1 bg-[#101014] border border-neutral-700 focus:border-white text-white placeholder:text-neutral-500 px-3 py-2 text-sm leading-relaxed font-mono transition-colors"
                    />
                    <button
                      type="submit"
                      disabled={!newStepText.trim()}
                      className="px-3 py-2.5 bg-white text-black font-extrabold text-xs font-mono uppercase tracking-wider hover:bg-neutral-200 transition-colors disabled:opacity-40"
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
                          <span aria-hidden="true" className={`flex h-8 w-8 shrink-0 items-center justify-center border font-mono text-xs tabular-nums transition-colors ${isDone ? 'border-neutral-600 bg-neutral-800 text-neutral-300' : isCurrent ? 'border-white bg-white text-black' : 'border-neutral-700 text-neutral-400 group-hover/step:border-neutral-400'}`}>
                            {isDone ? <Check className="h-4 w-4" /> : String(sIdx + 1).padStart(2, '0')}
                          </span>
                          <span className="min-w-0 flex-1">
                            {isCurrent && <span className="mb-1 block text-xs font-mono text-neutral-400">{t.stepsSection.stepPending}</span>}
                            <span className={`block break-words text-sm font-mono leading-relaxed ${isDone ? 'text-neutral-400 line-through decoration-neutral-700' : 'text-neutral-100'}`}>{step.title}</span>
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
                <div className="py-2 text-center text-xs font-mono text-neutral-400 flex flex-col items-center gap-1">
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

      {isConfiguringTimer && onConfigureCountdown && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
          onClick={(e) => { e.stopPropagation(); setIsConfiguringTimer(false); }}
          onKeyDown={(e) => { if (e.key === 'Escape') setIsConfiguringTimer(false); }}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby={`countdown-title-${task.id}`}
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              if (!validCountdownMinutes) return;
              onConfigureCountdown(task.id, Number(countdownMinutes) * 60);
              setIsConfiguringTimer(false);
            }}
            className="flex w-full max-w-sm flex-col gap-4 border border-neutral-800 bg-[#0c0c0e] p-5 font-mono shadow-2xl"
          >
            <div className="flex items-center justify-between gap-3">
              <h4 id={`countdown-title-${task.id}`} className="flex items-center gap-2 text-sm font-bold text-neutral-100">
                <Timer className="h-4 w-4" />
                {lang === 'uk' ? 'Таймер завдання' : 'Task countdown'}
              </h4>
              <button type="button" onClick={() => setIsConfiguringTimer(false)}
                aria-label={t.timer.cancel} className="p-1 text-neutral-400 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs leading-relaxed text-neutral-400">
              {lang === 'uk'
                ? 'Зворотний відлік зупиниться на нулі. Витрачений час додасться до загального часу завдання.'
                : 'The countdown stops at zero. Time spent is added to the task’s total time.'}
            </p>
            <label htmlFor={`countdown-minutes-${task.id}`} className="text-xs text-neutral-300">
              {lang === 'uk' ? 'Тривалість у хвилинах (1–1440)' : 'Duration in minutes (1–1440)'}
            </label>
            <input id={`countdown-minutes-${task.id}`} type="number" min="1" max="1440" step="1"
              required autoFocus value={countdownMinutes}
              onChange={(e) => setCountdownMinutes(e.target.value)}
              className="w-full border border-neutral-700 bg-neutral-950 px-3 py-2 text-white focus:border-white focus:outline-none" />
            <div className="grid grid-cols-3 gap-2">
              {[15, 25, 60].map((minutes) => (
                <button key={minutes} type="button" onClick={() => setCountdownMinutes(String(minutes))}
                  aria-pressed={Number(countdownMinutes) === minutes}
                  className={`border px-2 py-2 text-xs transition-colors ${Number(countdownMinutes) === minutes ? 'border-white text-white' : 'border-neutral-700 text-neutral-400 hover:border-neutral-400 hover:text-white'}`}>
                  {minutes} {lang === 'uk' ? 'хв' : 'min'}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-neutral-800 pt-3">
              {hasCountdown && onClearCountdown && (
                <button type="button" onClick={() => { onClearCountdown(task.id); setIsConfiguringTimer(false); }}
                  className="mr-auto py-1.5 text-xs text-neutral-400 hover:text-white">
                  {lang === 'uk' ? 'Секундомір' : 'Stopwatch'}
                </button>
              )}
              <button type="button" onClick={() => setIsConfiguringTimer(false)}
                className="px-2 py-1.5 text-xs text-neutral-400 hover:text-white">{t.timer.cancel}</button>
              <button type="submit" disabled={!validCountdownMinutes}
                className="border border-white bg-white px-3 py-1.5 text-xs font-bold text-black hover:bg-neutral-200 disabled:opacity-40">
                {lang === 'uk' ? 'Почати' : 'Start'}
              </button>
            </div>
          </form>
        </div>,
        document.body,
      )}

      {/* Time Adjustment Modal */}
      {isEditingTime && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div role="dialog" aria-modal="true" aria-labelledby="edit-time-title" className="flex w-full max-w-sm flex-col gap-4 border border-neutral-800 bg-[#0c0c0e] p-5 font-mono shadow-2xl">
            <div className="flex items-center justify-between border-b border-neutral-800/80 pb-2.5">
              <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-200 flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-neutral-400" aria-hidden="true" />
                <span id="edit-time-title">
                {t.timer.editTitle}
                </span>
              </h4>
              <button
                type="button"
                onClick={() => setIsEditingTime(false)}
                className="inline-flex h-6 w-6 items-center justify-center text-neutral-500 transition-colors hover:bg-neutral-900 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-px border border-neutral-800 bg-neutral-800">
              <div className="flex flex-col gap-1 bg-[#0c0c0e] p-2">
                <label className="text-xs uppercase tracking-wider text-neutral-500">{t.timer.hours}</label>
                <input
                  type="number"
                  min="0"
                  max="99"
                  value={editHours}
                  onChange={(e) => setEditHours(Math.max(0, parseInt(e.target.value) || 0))}
                  className="bg-transparent px-1 py-1 text-center text-sm font-bold text-white outline-none focus:bg-neutral-900"
                />
              </div>
              <div className="flex flex-col gap-1 bg-[#0c0c0e] p-2">
                <label className="text-xs uppercase tracking-wider text-neutral-500">{t.timer.minutes}</label>
                <input
                  type="number"
                  min="0"
                  max="59"
                  value={editMinutes}
                  onChange={(e) => setEditMinutes(Math.max(0, Math.min(59, parseInt(e.target.value) || 0)))}
                  className="bg-transparent px-1 py-1 text-center text-sm font-bold text-white outline-none focus:bg-neutral-900"
                />
              </div>
              <div className="flex flex-col gap-1 bg-[#0c0c0e] p-2">
                <label className="text-xs uppercase tracking-wider text-neutral-500">{t.timer.seconds}</label>
                <input
                  type="number"
                  min="0"
                  max="59"
                  value={editSeconds}
                  onChange={(e) => setEditSeconds(Math.max(0, Math.min(59, parseInt(e.target.value) || 0)))}
                  className="bg-transparent px-1 py-1 text-center text-sm font-bold text-white outline-none focus:bg-neutral-900"
                />
              </div>
            </div>

            {/* Quick Adjust Buttons */}
            <div className="grid grid-cols-3 gap-1">
              <button
                type="button"
                onClick={() => {
                  const total = editHours * 3600 + editMinutes * 60 + editSeconds + 900;
                  setEditHours(Math.floor(total / 3600));
                  setEditMinutes(Math.floor((total % 3600) / 60));
                  setEditSeconds(total % 60);
                }}
                className="border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs text-neutral-400 transition-colors hover:border-neutral-600 hover:text-white"
              >
                {t.timer.quickAdd15}
              </button>
              <button
                type="button"
                onClick={() => {
                  const total = editHours * 3600 + editMinutes * 60 + editSeconds + 1800;
                  setEditHours(Math.floor(total / 3600));
                  setEditMinutes(Math.floor((total % 3600) / 60));
                  setEditSeconds(total % 60);
                }}
                className="border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs text-neutral-400 transition-colors hover:border-neutral-600 hover:text-white"
              >
                {t.timer.quickAdd30}
              </button>
              <button
                type="button"
                onClick={() => {
                  const total = editHours * 3600 + editMinutes * 60 + editSeconds + 3600;
                  setEditHours(Math.floor(total / 3600));
                  setEditMinutes(Math.floor((total % 3600) / 60));
                  setEditSeconds(total % 60);
                }}
                className="border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs text-neutral-400 transition-colors hover:border-neutral-600 hover:text-white"
              >
                {t.timer.quickAdd60}
              </button>
              <button
                type="button"
                onClick={() => {
                  const total = Math.max(0, editHours * 3600 + editMinutes * 60 + editSeconds - 1800);
                  setEditHours(Math.floor(total / 3600));
                  setEditMinutes(Math.floor((total % 3600) / 60));
                  setEditSeconds(total % 60);
                }}
                className="border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs text-neutral-400 transition-colors hover:border-neutral-600 hover:text-white"
              >
                {t.timer.quickSub30}
              </button>
              <button
                type="button"
                onClick={() => {
                  const total = Math.max(0, editHours * 3600 + editMinutes * 60 + editSeconds - 3600);
                  setEditHours(Math.floor(total / 3600));
                  setEditMinutes(Math.floor((total % 3600) / 60));
                  setEditSeconds(total % 60);
                }}
                className="border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs text-neutral-400 transition-colors hover:border-neutral-600 hover:text-white"
              >
                {t.timer.quickSub60}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditHours(0);
                  setEditMinutes(0);
                  setEditSeconds(0);
                }}
                className="col-span-3 border border-transparent px-2 py-1 text-xs text-neutral-500 transition-colors hover:border-neutral-800 hover:text-rose-400"
              >
                {t.timer.setZero}
              </button>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-neutral-800/80 pt-3">
              <button
                type="button"
                onClick={() => setIsEditingTime(false)}
                className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-neutral-500 transition-colors hover:text-white"
              >
                {t.timer.cancel}
              </button>
              <button
                type="button"
                onClick={() => {
                  const newTotal = editHours * 3600 + editMinutes * 60 + editSeconds;
                  if (onUpdateTimeSpent) {
                    onUpdateTimeSpent(task.id, newTotal);
                  }
                  setIsEditingTime(false);
                }}
                className="border border-white bg-white px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-black transition-colors hover:border-neutral-200 hover:bg-neutral-200"
              >
                {t.timer.save}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const TaskCard = React.memo(TaskCardComponent);
