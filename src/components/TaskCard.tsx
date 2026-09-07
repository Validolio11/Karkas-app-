import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform } from 'motion/react';
import { PSTask, TaskTab } from '../types';
import { sound } from '../utils/audio';
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
  const [now, setNow] = useState(Date.now());
  const x = useMotionValue(0);

  // Live stopwatch interval (only ticks when timer is running)
  useEffect(() => {
    if (!task.timerRunning) return;
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [task.timerRunning]);

  // Compute live seconds spent on task
  const currentElapsedSeconds = useMemo(() => {
    const base = task.timeSpentSeconds || 0;
    if (task.timerRunning && task.timerStartedAt) {
      const live = Math.floor((now - task.timerStartedAt) / 1000);
      return Math.max(0, base + live);
    }
    return base;
  }, [task.timeSpentSeconds, task.timerRunning, task.timerStartedAt, now]);

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

  const currentActiveStep = effectiveStepList[Math.min(task.currentStep, effectiveStepList.length - 1)];

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
    <div id={`task-wrapper-${task.id}`} className="relative group select-none touch-pan-y my-2.5">
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
        className={`relative z-10 bg-[#0c0c0d] border transition-all duration-200 p-3.5 sm:p-4 cursor-grab ${
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

        <div className="flex flex-col gap-2.5">
          {/* Top Meta Row */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {/* Sequential Index */}
              <span className="text-[10px] font-bold tracking-widest text-neutral-500 font-mono">
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
                className={`text-[10px] uppercase font-extrabold tracking-wider px-2 py-0.5 border flex items-center gap-1.5 ${
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
                className={`flex items-center gap-1 px-1.5 py-0.5 bg-[#0a0a0c] border transition-colors ${
                  task.priority === 1
                    ? 'border-red-900/70 hover:border-red-500 bg-red-950/20'
                    : task.priority === 2
                    ? 'border-amber-900/70 hover:border-amber-500 bg-amber-950/20'
                    : 'border-emerald-900/70 hover:border-emerald-500 bg-emerald-950/20'
                }`}
              >
                <span
                  className={`text-[9px] font-mono font-bold mr-0.5 ${
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
                <span className="flex items-center text-[10px] font-mono text-neutral-400">
                  <Pin className="w-2.5 h-2.5 fill-neutral-400 mr-1" />
                  PIN
                </span>
              )}
            </div>

            {/* Right side: Stopwatch / Timer & Quick Micro-Actions */}
            <div className="flex items-center gap-1.5 sm:gap-2">
              {/* Task Stopwatch / Timer Widget */}
              <div
                id={`task-timer-widget-${task.id}`}
                className={`flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-2 py-0.5 border font-mono transition-all ${
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
                  title={task.timerRunning ? t.timer.pause : t.timer.start}
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
                  className={`text-[10px] font-bold tracking-wider ${
                    task.timerRunning
                      ? 'text-emerald-300'
                      : currentElapsedSeconds > 0
                      ? 'text-neutral-200'
                      : 'text-neutral-500'
                  }`}
                >
                  {formatTime(currentElapsedSeconds)}
                </span>

                {/* Reset Button (shows when paused and has recorded time) */}
                {currentElapsedSeconds > 0 && !task.timerRunning && onResetTimer && (
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
                className="flex flex-col gap-2 p-2 bg-[#08080a] border border-neutral-700 my-1 z-30"
              >
                <div className="text-[10px] font-mono text-neutral-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Pencil className="w-3 h-3 text-emerald-400" />
                  <span>{lang === 'uk' ? 'Редагування завдання' : 'Edit Task'}</span>
                </div>
                <input
                  type="text"
                  value={editTitleText}
                  onChange={(e) => setEditTitleText(e.target.value)}
                  placeholder={lang === 'uk' ? 'Назва завдання...' : 'Task title...'}
                  autoFocus
                  className="w-full px-2.5 py-1.5 bg-[#0d0d12] border border-neutral-700 text-white text-xs font-mono focus:outline-none focus:border-white transition-colors"
                />
                <input
                  type="text"
                  value={editNoteText}
                  onChange={(e) => setEditNoteText(e.target.value)}
                  placeholder={lang === 'uk' ? 'Нотатка (необов\'язково)...' : 'Note (optional)...'}
                  className="w-full px-2.5 py-1.5 bg-[#0d0d12] border border-neutral-800 text-neutral-300 text-xs font-mono focus:outline-none focus:border-neutral-600 transition-colors"
                />
                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setIsEditingTask(false)}
                    className="px-2.5 py-1 bg-neutral-800 border border-neutral-700 text-neutral-300 text-[10px] font-mono font-bold hover:bg-neutral-700 transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                    <span>{lang === 'uk' ? 'Скасувати' : 'Cancel'}</span>
                  </button>
                  <button
                    type="submit"
                    className="px-2.5 py-1 bg-emerald-500 text-black text-[10px] font-mono font-extrabold hover:bg-emerald-400 transition-colors flex items-center gap-1 cursor-pointer"
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
                  className={`text-sm sm:text-base font-bold tracking-tight cursor-pointer leading-snug transition-all ${
                    task.done
                      ? 'line-through text-neutral-500 decoration-neutral-600 decoration-2'
                      : 'text-neutral-100 hover:text-white'
                  }`}
                >
                  {task.title}
                </h3>

                {task.note && (
                  <div className="flex items-center gap-1 mt-1 text-[11px] font-mono text-neutral-400">
                    <span className="text-neutral-600 font-bold">//</span>
                    <span>{task.note}</span>
                  </div>
                )}
              </>
            )}

            {task.autoPausedOverdue && (
              <div
                className="flex items-center gap-1.5 px-2 py-1 bg-amber-950/40 border border-amber-500/40 text-amber-300 text-[10px] font-mono mt-1.5 cursor-pointer hover:bg-amber-950/60 transition-colors"
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
                <span className="text-[9px] underline underline-offset-2 text-amber-200">{t.timer.editTime}</span>
              </div>
            )}
          </div>

          {/* Interactive Step Scrubber Rail with Right-Side Step Description and Toggle Button */}
          <div className="pt-1.5 flex flex-wrap items-center justify-between gap-2 border-t border-neutral-900">
            {/* Scrubber & Active Step Description */}
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <span className="text-[9px] font-mono text-neutral-400 uppercase tracking-widest font-bold whitespace-nowrap">
                {t.step} {task.currentStep}/{task.steps}
              </span>
              
              {/* Bars */}
              <div className="flex items-center gap-1 w-24 sm:w-28 h-3.5">
                {Array.from({ length: Math.max(1, task.steps) }).map((_, i) => {
                  const stepNum = i + 1;
                  const isFilled = task.currentStep >= stepNum;
                  return (
                    <button
                      key={i}
                      id={`task-${task.id}-step-${stepNum}`}
                      onClick={(e) => handleStepClick(e, stepNum)}
                      title={`${t.step} ${stepNum} / ${task.steps}`}
                      className={`h-2 flex-1 transition-all rounded-none ${
                        isFilled
                          ? 'bg-neutral-100 shadow-[0_0_6px_rgba(255,255,255,0.2)]'
                          : 'bg-neutral-800 hover:bg-neutral-700'
                      }`}
                    />
                  );
                })}
              </div>

              {/* Right Side Step Description next to scrubber (in exact same font) */}
              {currentActiveStep && (
                <span
                  title={currentActiveStep.title}
                  className="text-[9px] font-mono text-neutral-400 tracking-wider truncate max-w-[140px] sm:max-w-[220px] hidden xs:inline-block"
                >
                  // {currentActiveStep.title}
                </span>
              )}
            </div>

            {/* Steps Drawer Toggle & Complete Button */}
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Collapsible Steps Button */}
              <button
                id={`task-toggle-steps-${task.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  sound.tick(500);
                  setIsExpanded(!isExpanded);
                }}
                className={`flex items-center gap-1 text-[9px] font-mono uppercase font-bold tracking-wider px-2 py-0.5 border transition-all ${
                  isExpanded
                    ? 'border-white bg-neutral-900 text-white'
                    : hasStepList
                    ? 'border-neutral-700 text-neutral-300 hover:border-neutral-500 hover:text-white bg-neutral-950'
                    : 'border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-neutral-300'
                }`}
                title={isExpanded ? t.stepsSection.collapse : t.stepsSection.expand}
              >
                <span>{isExpanded ? t.stepsSection.collapse : t.stepsSection.expand}</span>
                {effectiveStepList.length > 0 && (
                  <span className="text-[8px] opacity-70">
                    ({effectiveStepList.filter((s) => s.done).length}/{effectiveStepList.length})
                  </span>
                )}
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
                className={`text-[9px] font-mono uppercase font-bold tracking-wider px-2 py-0.5 border transition-all ${
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
            className="overflow-hidden mt-1 mx-2 sm:mx-3"
          >
            <div className="bg-[#09090b] border border-neutral-800 border-t-0 p-3 sm:p-3.5 space-y-2">
              {/* Sub-Card Header */}
              <div className="flex items-center justify-between border-b border-neutral-800/80 pb-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono font-bold tracking-wider text-neutral-400 uppercase">
                    // {t.stepsSection.optionalTitle}
                  </span>
                  {effectiveStepList.length > 0 && (
                    <span className="text-[9px] font-mono px-1.5 py-0.2 bg-neutral-900 border border-neutral-800 text-neutral-300">
                      {effectiveStepList.filter((s) => s.done).length}/{effectiveStepList.length} {t.stepsSection.stepDone}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
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
                      className="flex items-center gap-1 text-[9px] font-mono uppercase px-2 py-0.5 bg-neutral-900 border border-neutral-700 hover:border-white text-white hover:text-white transition-colors disabled:opacity-50"
                    >
                      <Sparkles className="w-2.5 h-2.5 text-white animate-pulse" />
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
                    className="flex items-center gap-1 text-[9px] font-mono uppercase px-2 py-0.5 bg-neutral-900 border border-neutral-700 hover:border-white text-neutral-300 hover:text-white transition-colors"
                  >
                    <Plus className="w-2.5 h-2.5" />
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
                    className="flex items-center gap-1.5 pt-1 overflow-hidden"
                  >
                    <input
                      type="text"
                      id={`new-step-text-input-${task.id}`}
                      value={newStepText}
                      onChange={(e) => setNewStepText(e.target.value)}
                      placeholder={t.stepsSection.stepPlaceholder}
                      autoFocus
                      className="flex-1 bg-[#101014] border border-neutral-700 focus:border-white text-white placeholder:text-neutral-500 px-2.5 py-1 text-xs font-mono transition-colors"
                    />
                    <button
                      type="submit"
                      className="px-2.5 py-1 bg-white text-black font-extrabold text-[10px] font-mono uppercase tracking-wider hover:bg-neutral-200 transition-colors"
                    >
                      OK
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsAddingStep(false)}
                      className="p-1 border border-neutral-800 text-neutral-400 hover:text-white"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </motion.form>
                )}
              </AnimatePresence>

              {/* Steps List */}
              {effectiveStepList.length > 0 ? (
                <div className="space-y-1.5 pt-1">
                  {effectiveStepList.map((step, sIdx) => {
                    const isDone = step.done;
                    const isCurrent = !isDone && sIdx === task.currentStep;

                    return (
                      <div
                        key={step.id || sIdx}
                        id={`task-${task.id}-step-row-${sIdx}`}
                        onClick={() => handleToggleSubStep(sIdx)}
                        className={`group/step flex items-center justify-between gap-2.5 p-2.5 border cursor-pointer select-none transition-all ${
                          isDone
                            ? 'bg-[#0a0a0c] border-neutral-800/60 opacity-60 hover:opacity-90 hover:border-neutral-700'
                            : isCurrent
                            ? 'bg-[#141418] border-neutral-500 hover:border-neutral-400'
                            : 'bg-[#0d0d10] border-neutral-800 hover:border-neutral-600 hover:bg-[#111115]'
                        }`}
                      >
                        {/* Left: Interactive Checkbox + Number + Title */}
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          <button
                            type="button"
                            id={`step-checkbox-${task.id}-${sIdx}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleSubStep(sIdx);
                            }}
                            className={`w-5 h-5 rounded-none border flex items-center justify-center transition-all shrink-0 cursor-pointer ${
                              isDone
                                ? 'bg-white border-white text-black'
                                : 'border-neutral-600 bg-neutral-900/90 hover:border-white group-hover/step:border-neutral-400'
                            }`}
                            title={isDone ? 'Позначити крок як не виконаний' : 'Завершити крок'}
                            aria-label={isDone ? 'Позначити крок як не виконаний' : 'Завершити крок'}
                          >
                            {isDone ? (
                              <Check className="w-3.5 h-3.5 stroke-[3]" />
                            ) : (
                              <Check className="w-3 h-3 text-neutral-400 opacity-0 group-hover/step:opacity-40 transition-opacity" />
                            )}
                          </button>

                          <span className="text-[10px] font-mono text-neutral-500 font-bold shrink-0">
                            #{String(sIdx + 1).padStart(2, '0')}
                          </span>

                          <span
                            className={`text-xs font-mono leading-tight break-words ${
                              isDone
                                ? 'line-through text-neutral-500 decoration-neutral-600'
                                : isCurrent
                                ? 'text-white font-medium'
                                : 'text-neutral-200'
                            }`}
                          >
                            {step.title}
                          </span>
                        </div>

                        {/* Right: Interactive Status Pill & Delete Button */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleSubStep(sIdx);
                            }}
                            className={`text-[8px] font-mono uppercase px-2 py-0.5 border transition-all cursor-pointer ${
                              isDone
                                ? 'border-neutral-800 text-neutral-400 bg-neutral-900/60 hover:border-neutral-600 hover:text-white'
                                : isCurrent
                                ? 'border-neutral-500 text-white bg-neutral-800 hover:bg-neutral-700'
                                : 'border-neutral-800/90 text-neutral-400 bg-neutral-900/30 hover:border-neutral-600 hover:text-white'
                            }`}
                          >
                            {isDone
                              ? `✓ ${t.stepsSection.stepDone}`
                              : isCurrent
                              ? `● ${t.stepsSection.stepPending}`
                              : `${t.step} ${sIdx + 1}`}
                          </button>

                          {onDeleteStepItem && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                sound.tick(300);
                                onDeleteStepItem(task.id, sIdx);
                              }}
                              className="p-1 text-neutral-600 hover:text-rose-400 transition-colors cursor-pointer"
                              title="Видалити крок"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="py-2 text-center text-[11px] font-mono text-neutral-400 flex flex-col items-center gap-1">
                  <p>{t.stepsSection.noStepsHint}</p>
                  <button
                    type="button"
                    onClick={() => setIsAddingStep(true)}
                    className="text-[10px] uppercase font-bold text-neutral-300 hover:text-white underline underline-offset-4"
                  >
                    {t.stepsSection.addStepBtn}
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Time Adjustment Modal */}
      {isEditingTime && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="bg-[#121216] border border-neutral-700 w-full max-w-sm p-5 shadow-2xl flex flex-col gap-4 font-mono">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-200 flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-emerald-400" />
                {t.timer.editTitle}
              </h4>
              <button
                type="button"
                onClick={() => setIsEditingTime(false)}
                className="text-neutral-500 hover:text-white p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-[11px] text-neutral-400">
              {t.timer.safeguardActive}
            </p>

            <div className="grid grid-cols-3 gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase text-neutral-400">{t.timer.hours}</label>
                <input
                  type="number"
                  min="0"
                  max="99"
                  value={editHours}
                  onChange={(e) => setEditHours(Math.max(0, parseInt(e.target.value) || 0))}
                  className="bg-neutral-900 border border-neutral-700 px-2 py-1.5 text-sm text-center text-white focus:border-emerald-500 outline-none"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase text-neutral-400">{t.timer.minutes}</label>
                <input
                  type="number"
                  min="0"
                  max="59"
                  value={editMinutes}
                  onChange={(e) => setEditMinutes(Math.max(0, Math.min(59, parseInt(e.target.value) || 0)))}
                  className="bg-neutral-900 border border-neutral-700 px-2 py-1.5 text-sm text-center text-white focus:border-emerald-500 outline-none"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase text-neutral-400">{t.timer.seconds}</label>
                <input
                  type="number"
                  min="0"
                  max="59"
                  value={editSeconds}
                  onChange={(e) => setEditSeconds(Math.max(0, Math.min(59, parseInt(e.target.value) || 0)))}
                  className="bg-neutral-900 border border-neutral-700 px-2 py-1.5 text-sm text-center text-white focus:border-emerald-500 outline-none"
                />
              </div>
            </div>

            {/* Quick Adjust Buttons */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              <button
                type="button"
                onClick={() => {
                  const total = editHours * 3600 + editMinutes * 60 + editSeconds + 900;
                  setEditHours(Math.floor(total / 3600));
                  setEditMinutes(Math.floor((total % 3600) / 60));
                  setEditSeconds(total % 60);
                }}
                className="text-[10px] px-2 py-1 bg-neutral-900 border border-neutral-800 text-neutral-300 hover:border-neutral-600"
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
                className="text-[10px] px-2 py-1 bg-neutral-900 border border-neutral-800 text-neutral-300 hover:border-neutral-600"
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
                className="text-[10px] px-2 py-1 bg-neutral-900 border border-neutral-800 text-neutral-300 hover:border-neutral-600"
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
                className="text-[10px] px-2 py-1 bg-neutral-900 border border-neutral-800 text-neutral-300 hover:border-neutral-600"
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
                className="text-[10px] px-2 py-1 bg-neutral-900 border border-neutral-800 text-neutral-300 hover:border-neutral-600"
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
                className="text-[10px] px-2 py-1 bg-neutral-900 border border-rose-900/50 text-rose-400 hover:border-rose-700 ml-auto"
              >
                {t.timer.setZero}
              </button>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-neutral-800">
              <button
                type="button"
                onClick={() => setIsEditingTime(false)}
                className="px-3 py-1.5 text-xs text-neutral-400 hover:text-white"
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
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold uppercase tracking-wider"
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
