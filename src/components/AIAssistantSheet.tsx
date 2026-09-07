import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { PSTask, TaskTab, DeletedTask, WorkflowStats, TaskStepItem } from '../types';
import { sound } from '../utils/audio';
import { Language, TRANSLATIONS, AI_PRESETS_UK, AI_PRESETS_EN } from '../utils/i18n';
import { X, CornerDownLeft, Plus, CheckCircle2, ListTree, Sparkles, Activity, Layers, ArrowRight, Lightbulb } from 'lucide-react';
import { AIIcon, AIIconId } from './AIIconTemplates';

interface AIAssistantSheetProps {
  isOpen: boolean;
  lang: Language;
  tabs?: TaskTab[];
  onClose: () => void;
  currentTasks: PSTask[];
  deletedTasks?: DeletedTask[];
  stats?: WorkflowStats;
  initialPrompt?: string;
  aiIconVariant?: AIIconId;
  onInjectTasks: (newTasks: Omit<PSTask, 'id' | 'currentStep' | 'done' | 'pinned' | 'createdAt'>[]) => void;
}

type AIMode = 'breakdown' | 'analyze' | 'generate';

interface AIResponse {
  summary: string;
  insights?: string[];
  tasks: {
    title: string;
    phase: string;
    priority: 1 | 2 | 3;
    steps: number;
    stepList?: { title: string; done?: boolean }[];
    note?: string;
    reason?: string;
  }[];
  source: string;
}

export const AIAssistantSheet: React.FC<AIAssistantSheetProps> = ({
  isOpen,
  lang,
  tabs = [],
  onClose,
  currentTasks,
  deletedTasks = [],
  stats,
  initialPrompt = '',
  aiIconVariant,
  onInjectTasks,
}) => {
  const t = TRANSLATIONS[lang];
  const presets = lang === 'uk' ? AI_PRESETS_UK : AI_PRESETS_EN;
  const [prompt, setPrompt] = useState(initialPrompt);
  const [mode, setMode] = useState<AIMode>('breakdown');
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<AIResponse | null>(null);
  const [injectedIds, setInjectedIds] = useState<number[]>([]);

  const activeCount = currentTasks.filter((t) => !t.done).length;
  const completedCount = currentTasks.filter((t) => t.done).length;
  const deletedCount = deletedTasks.length;

  // Sync initialPrompt
  useEffect(() => {
    if (initialPrompt) {
      setPrompt(initialPrompt);
      handleGenerate(initialPrompt, 'breakdown');
    }
  }, [initialPrompt]);

  const handleGenerate = async (queryText?: string, selectedMode?: AIMode) => {
    const textToQuery = queryText !== undefined ? queryText : prompt;
    const currentMode = selectedMode || mode;

    if (currentMode !== 'analyze' && !textToQuery.trim() && !currentTasks.length) return;
    if (loading) return;

    sound.activate();
    setLoading(true);
    setResponse(null);
    setInjectedIds([]);

    const activeList = currentTasks.filter((t) => !t.done);
    const doneList = currentTasks.filter((t) => t.done);

    try {
      const res = await fetch('/api/ai/assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: textToQuery.trim() || (currentMode === 'analyze' ? 'Повний аналіз поточних завдань та рекомендації щодо оптимізації' : 'Сформувати тактичний план'),
          action: currentMode === 'analyze' ? 'analyze' : currentMode === 'generate' ? 'generate' : 'breakdown',
          lang,
          tabs: tabs.map((tb) => tb.id),
          currentTasks,
          fullAppContext: {
            activeTasks: activeList.map((t) => ({
              title: t.title,
              phase: t.phase,
              priority: t.priority,
              currentStep: t.currentStep,
              steps: t.steps,
              stepList: t.stepList?.map((s) => s.title) || [],
              note: t.note,
            })),
            completedTasks: doneList.map((t) => ({
              title: t.title,
              phase: t.phase,
              completedAt: t.completedAt,
            })),
            deletedTasks: deletedTasks.slice(0, 15).map((t) => ({
              title: t.title,
              phase: t.phase,
            })),
            tabs: tabs.map((tb) => ({ id: tb.id, name: tb.name, color: tb.color })),
            stats: stats || {
              total: currentTasks.length,
              completed: completedCount,
              percent: currentTasks.length > 0 ? Math.round((completedCount / currentTasks.length) * 100) : 0,
            },
          },
        }),
      });

      if (!res.ok) throw new Error('API request failed');
      const data: AIResponse = await res.json();
      setResponse(data);
      sound.activate();
    } catch (err) {
      console.error('AI query error:', err);
      // Fallback
      const isUk = lang === 'uk';
      const mainPhase = tabs[0]?.id || 'focus';
      const secondaryPhase = tabs[1]?.id || mainPhase;

      const fallbackPrompt = textToQuery || (isUk ? 'Оптимізація завдань' : 'Task Optimization');

      setResponse({
        summary: isUk
          ? `Аналіз сформовано на основі ${activeCount} активних завдань для «${fallbackPrompt}».`
          : `Analysis formulated based on ${activeCount} active tasks for "${fallbackPrompt}".`,
        insights: isUk
          ? [
              `Зосередьтеся на P1 завданнях перед відкриттям нових етапів.`,
              `Розбивайте великі завдання на 2-4 конкретних підкроки для прискорення прогресу.`,
            ]
          : [
              `Focus on urgent P1 items before starting secondary tabs.`,
              `Decompose multi-stage operations into smaller micro-steps.`,
            ],
        tasks: isUk
          ? [
              {
                title: `${fallbackPrompt} — Головний пріоритет`,
                phase: mainPhase,
                priority: 1,
                steps: 3,
                stepList: [
                  { title: 'Аналіз вимог та підготовка' },
                  { title: 'Виконання основної частини' },
                  { title: 'Фінальна перевірка та закриття' },
                ],
                note: 'Ключовий фокус',
              },
              {
                title: `${fallbackPrompt} — Супутній етап`,
                phase: secondaryPhase,
                priority: 2,
                steps: 2,
                stepList: [
                  { title: 'Узгодження деталей' },
                  { title: 'Збереження результатів' },
                ],
                note: 'Стандартний пріоритет',
              },
            ]
          : [
              {
                title: `${fallbackPrompt} - Core Milestone`,
                phase: mainPhase,
                priority: 1,
                steps: 3,
                stepList: [
                  { title: 'Requirements review' },
                  { title: 'Primary execution sprint' },
                  { title: 'Quality check & finalize' },
                ],
                note: 'Primary focus',
              },
            ],
        source: 'local-fallback',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleInjectAll = () => {
    if (!response || !response.tasks.length) return;
    sound.activate();

    const formattedTasks = response.tasks.map((task) => {
      const stepItems: TaskStepItem[] | undefined = task.stepList && task.stepList.length > 0
        ? task.stepList.map((st, idx) => ({
            id: `s-${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 4)}`,
            title: typeof st === 'string' ? st : st.title,
            done: false,
          }))
        : undefined;

      return {
        title: task.title,
        phase: task.phase,
        priority: task.priority,
        steps: stepItems ? stepItems.length : (task.steps || 1),
        stepList: stepItems,
        note: task.note,
      };
    });

    onInjectTasks(formattedTasks);
    setInjectedIds(response.tasks.map((_, i) => i));
    setTimeout(() => {
      onClose();
    }, 500);
  };

  const handleInjectSingle = (task: AIResponse['tasks'][0], index: number) => {
    sound.tick(600);
    const stepItems: TaskStepItem[] | undefined = task.stepList && task.stepList.length > 0
      ? task.stepList.map((st, idx) => ({
          id: `s-${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 4)}`,
          title: typeof st === 'string' ? st : st.title,
          done: false,
        }))
      : undefined;

    onInjectTasks([
      {
        title: task.title,
        phase: task.phase,
        priority: task.priority,
        steps: stepItems ? stepItems.length : (task.steps || 1),
        stepList: stepItems,
        note: task.note,
      },
    ]);
    setInjectedIds((prev) => [...prev, index]);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center pointer-events-auto">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm"
          />

          {/* Sheet Surface */}
          <motion.div
            id="ps-ai-sheet"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            drag="y"
            dragConstraints={{ top: 0 }}
            dragElastic={0.2}
            onDragEnd={(_, info) => {
              if (info.offset.y > 100) {
                onClose();
              }
            }}
            className="relative z-10 w-full max-w-2xl bg-[#09090c] border-t border-x border-neutral-700 max-h-[88vh] flex flex-col shadow-2xl"
          >
            {/* Drag Handle */}
            <div className="w-full flex items-center justify-center pt-2.5 pb-1 cursor-grab active:cursor-grabbing">
              <div className="w-10 h-1 bg-neutral-700 rounded-full" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-4 sm:px-5 py-2.5 border-b border-neutral-800">
              <div className="flex items-center gap-2 flex-wrap">
                <AIIcon id={aiIconVariant} className="w-4 h-4 text-white" />
                <span className="text-xs sm:text-sm font-extrabold uppercase tracking-wider font-mono text-white">
                  {t.aiSheet.header}
                </span>
                <span className="text-[9px] font-mono px-1.5 py-0.5 bg-emerald-950/40 border border-emerald-800/80 text-emerald-300 font-bold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  {t.aiSheet.online}
                </span>
              </div>
              <button
                id="close-ai-sheet-btn"
                onClick={onClose}
                className="p-1.5 text-neutral-400 hover:text-white border border-neutral-800 hover:border-neutral-600 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Live App Context Bar */}
            <div className="px-4 sm:px-5 py-2 bg-black/60 border-b border-neutral-800/80 flex items-center justify-between gap-2 text-[10px] font-mono text-neutral-400 overflow-x-auto">
              <div className="flex items-center gap-2 shrink-0">
                <Activity className="w-3.5 h-3.5 text-white" />
                <span className="text-neutral-200 font-bold">
                  {t.aiSheet.fullContextTitle}
                </span>
              </div>
              <div className="flex items-center gap-3 text-[9px] text-neutral-400 shrink-0 font-mono">
                <span>
                  <strong className="text-white">{activeCount}</strong> {lang === 'uk' ? 'активних' : 'active'}
                </span>
                <span>•</span>
                <span>
                  <strong className="text-white">{completedCount}</strong> {lang === 'uk' ? 'виконано' : 'done'}
                </span>
                <span>•</span>
                <span>
                  <strong className="text-white">{tabs.length}</strong> {lang === 'uk' ? 'вкладок' : 'tabs'}
                </span>
                {deletedCount > 0 && (
                  <>
                    <span>•</span>
                    <span>
                      <strong className="text-white">{deletedCount}</strong> {lang === 'uk' ? 'архів' : 'archived'}
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Action Modes Selector */}
            <div className="grid grid-cols-3 gap-1 px-4 sm:px-5 pt-3 pb-1 border-b border-neutral-800/50">
              <button
                id="ai-mode-breakdown-btn"
                type="button"
                onClick={() => {
                  sound.tick(500);
                  setMode('breakdown');
                }}
                className={`py-2 px-2 text-[10px] sm:text-xs font-mono font-bold tracking-wider uppercase border transition-all flex items-center justify-center gap-1.5 ${
                  mode === 'breakdown'
                    ? 'bg-white text-black border-white shadow-sm'
                    : 'bg-[#101014] text-neutral-400 border-neutral-800 hover:text-neutral-200 hover:border-neutral-700'
                }`}
              >
                <ListTree className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{t.aiSheet.modes.breakdown}</span>
              </button>

              <button
                id="ai-mode-analyze-btn"
                type="button"
                onClick={() => {
                  sound.tick(550);
                  setMode('analyze');
                  handleGenerate(prompt, 'analyze');
                }}
                className={`py-2 px-2 text-[10px] sm:text-xs font-mono font-bold tracking-wider uppercase border transition-all flex items-center justify-center gap-1.5 ${
                  mode === 'analyze'
                    ? 'bg-white text-black border-white shadow-sm'
                    : 'bg-[#101014] text-neutral-400 border-neutral-800 hover:text-neutral-200 hover:border-neutral-700'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{t.aiSheet.modes.analyze}</span>
              </button>

              <button
                id="ai-mode-generate-btn"
                type="button"
                onClick={() => {
                  sound.tick(600);
                  setMode('generate');
                }}
                className={`py-2 px-2 text-[10px] sm:text-xs font-mono font-bold tracking-wider uppercase border transition-all flex items-center justify-center gap-1.5 ${
                  mode === 'generate'
                    ? 'bg-white text-black border-white shadow-sm'
                    : 'bg-[#101014] text-neutral-400 border-neutral-800 hover:text-neutral-200 hover:border-neutral-700'
                }`}
              >
                <Layers className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{t.aiSheet.modes.generate}</span>
              </button>
            </div>

            {/* Content Container (Scrollable) */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 flex flex-col gap-4">
              {/* Presets Chips */}
              <div>
                <div className="text-[10px] font-mono uppercase tracking-widest text-neutral-400 mb-2">
                  {t.aiSheet.blueprints}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {presets.map((preset, i) => (
                    <button
                      key={i}
                      id={`ai-preset-chip-${i}`}
                      onClick={() => {
                        setPrompt(preset);
                        handleGenerate(preset);
                      }}
                      className="text-xs font-mono text-left px-2.5 py-1.5 bg-[#121214] border border-neutral-800 text-neutral-300 hover:border-white hover:text-white transition-all"
                    >
                      + {preset}
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom Prompt Input */}
              <div className="flex items-center gap-2">
                <input
                  id="ai-prompt-input"
                  type="text"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleGenerate();
                  }}
                  placeholder={
                    mode === 'analyze'
                      ? (lang === 'uk' ? 'Уточніть фокус аналізу (напр. пріоритети на сьогодні, перевірити дедлайни)...' : 'Refine audit focus (e.g. today priorities, bottlenecks)...')
                      : t.aiSheet.inputPlaceholder
                  }
                  className="flex-1 bg-[#101014] border border-neutral-600 text-white placeholder:text-neutral-400 placeholder:font-normal placeholder:normal-case px-3.5 py-2.5 text-xs sm:text-sm font-sans focus:outline-none focus:border-white focus:ring-1 focus:ring-white transition-all shadow-inner"
                />
                <button
                  id="ai-generate-submit-btn"
                  onClick={() => handleGenerate()}
                  disabled={loading || (mode !== 'analyze' && !prompt.trim())}
                  className="px-4 py-2.5 bg-white text-black font-extrabold text-xs font-mono tracking-wider hover:bg-neutral-200 disabled:opacity-40 transition-all flex items-center gap-1.5"
                >
                  {loading ? (
                    <span className="animate-pulse">{t.aiSheet.thinking}</span>
                  ) : (
                    <>
                      <span>{t.aiSheet.execute}</span>
                      <CornerDownLeft className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              </div>

              {/* Response Section */}
              {loading && (
                <div className="p-8 border border-neutral-800 bg-black/40 flex flex-col items-center justify-center gap-3">
                  <div className="w-6 h-6 border-2 border-white border-t-transparent animate-spin rounded-full" />
                  <span className="text-xs font-mono tracking-widest text-neutral-300 uppercase animate-pulse">
                    {t.aiSheet.thinking}
                  </span>
                  <span className="text-[10px] font-mono text-neutral-500">
                    {t.aiSheet.fullContextDesc}
                  </span>
                </div>
              )}

              {response && !loading && (
                <div className="border border-neutral-800 bg-[#0d0d10] p-4 flex flex-col gap-4">
                  {/* Strategy Summary */}
                  <div className="flex items-start justify-between gap-3 border-b border-neutral-800 pb-3">
                    <div className="space-y-1">
                      <div className="text-[10px] font-mono uppercase text-neutral-400 tracking-widest flex items-center gap-1.5">
                        <Sparkles className="w-3 h-3 text-white" />
                        <span>{t.aiSheet.strategyHeader}</span>
                      </div>
                      <p className="text-xs sm:text-sm font-bold text-neutral-100 leading-relaxed">
                        {response.summary}
                      </p>
                    </div>

                    {response.tasks.length > 0 && (
                      <button
                        id="ai-inject-all-btn"
                        onClick={handleInjectAll}
                        className="whitespace-nowrap px-3 py-1.5 bg-white text-black font-extrabold text-xs font-mono tracking-wider hover:bg-neutral-200 transition-colors flex items-center gap-1.5 shrink-0"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>{t.aiSheet.injectAll} ({response.tasks.length})</span>
                      </button>
                    )}
                  </div>

                  {/* Tactical Insights / Tips (if available) */}
                  {response.insights && response.insights.length > 0 && (
                    <div className="bg-[#121216] border border-neutral-800 p-3 space-y-2">
                      <div className="text-[10px] font-mono text-neutral-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
                        <Lightbulb className="w-3.5 h-3.5 text-amber-400" />
                        <span>{t.aiSheet.insightsHeader}</span>
                      </div>
                      <ul className="space-y-1.5">
                        {response.insights.map((insight, idx) => (
                          <li key={idx} className="text-xs font-mono text-neutral-300 flex items-start gap-2">
                            <span className="text-white font-bold shrink-0">›</span>
                            <span>{insight}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Generated Tasks List with Sub-Steps */}
                  {response.tasks.length > 0 && (
                    <div className="flex flex-col gap-2.5">
                      {response.tasks.map((task, i) => {
                        const isInjected = injectedIds.includes(i);
                        const matchedTab = tabs.find((tb) => tb.id === task.phase);
                        const phaseLabel = (t.phases as any)[task.phase] || matchedTab?.name || task.phase;
                        const subSteps = task.stepList || [];

                        return (
                          <div
                            key={i}
                            id={`ai-suggested-task-${i}`}
                            className="flex flex-col gap-2 p-3 bg-black border border-neutral-800 hover:border-neutral-700 transition-colors"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex flex-col gap-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-[10px] font-mono text-neutral-400 font-bold flex items-center gap-1">
                                    {matchedTab?.color && (
                                      <span
                                        className="w-1.5 h-1.5 rounded-full shrink-0 shadow-sm"
                                        style={{ backgroundColor: matchedTab.color }}
                                      />
                                    )}
                                    [{phaseLabel}]
                                  </span>
                                  <span
                                    className={`text-[9px] font-mono font-bold px-1 py-0.2 border ${
                                      task.priority === 1
                                        ? 'border-red-900/70 text-red-400 bg-red-950/30'
                                        : task.priority === 2
                                        ? 'border-amber-900/70 text-amber-400 bg-amber-950/30'
                                        : 'border-emerald-900/70 text-emerald-400 bg-emerald-950/30'
                                    }`}
                                  >
                                    P{task.priority}
                                  </span>
                                  <span className="text-xs sm:text-sm font-bold text-neutral-100">
                                    {task.title}
                                  </span>
                                </div>
                                {task.note && (
                                  <span className="text-[10px] font-mono text-neutral-400">
                                    // {task.note}
                                  </span>
                                )}
                              </div>

                              <button
                                id={`ai-inject-single-btn-${i}`}
                                onClick={() => handleInjectSingle(task, i)}
                                disabled={isInjected}
                                className={`px-2.5 py-1 text-[10px] font-mono uppercase font-bold border transition-all shrink-0 ${
                                  isInjected
                                    ? 'border-emerald-700 text-emerald-400 bg-emerald-950/40'
                                    : 'border-neutral-700 text-neutral-300 hover:border-white hover:text-white bg-neutral-900'
                                }`}
                              >
                                {isInjected ? t.aiSheet.added : t.aiSheet.injectSingle}
                              </button>
                            </div>

                            {/* Sub-steps preview */}
                            {subSteps.length > 0 && (
                              <div className="pt-2 border-t border-neutral-900/80 space-y-1">
                                <div className="text-[9px] font-mono text-neutral-500 uppercase font-bold">
                                  {t.aiSheet.subStepsTitle} ({subSteps.length})
                                </div>
                                <div className="grid grid-cols-1 gap-1">
                                  {subSteps.map((st, sIdx) => {
                                    const titleText = typeof st === 'string' ? st : st.title;
                                    return (
                                      <div
                                        key={sIdx}
                                        className="text-[10px] font-mono text-neutral-300 bg-[#0c0c0f] border border-neutral-900 px-2 py-1 flex items-center gap-1.5"
                                      >
                                        <span className="text-neutral-500 font-bold">{sIdx + 1}.</span>
                                        <span>{titleText}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Bottom Footer Hint */}
            <div className="px-4 sm:px-5 py-2.5 bg-black border-t border-neutral-800 flex items-center justify-between text-[10px] font-mono text-neutral-400">
              <span>{t.aiSheet.dismissHint}</span>
              <span>{t.aiSheet.footerTag}</span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
