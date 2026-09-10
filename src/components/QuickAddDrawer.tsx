import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { TaskTab } from '../types';
import { sound } from '../utils/audio';
import { Language, TRANSLATIONS } from '../utils/i18n';
import { Plus, SquareCode, X } from 'lucide-react';

interface QuickAddDrawerProps {
  isOpen: boolean;
  lang: Language;
  tabs: TaskTab[];
  selectedPhase?: string;
  onClose: () => void;
  onAddTask: (task: {
    title: string;
    phase: string;
    priority: 1 | 2 | 3;
    steps: number;
    stepList?: { id: string; title: string; done: boolean }[];
    note?: string;
  }) => void;
  onOpenAIWithPrompt: (prompt: string) => void;
}

export const QuickAddDrawer: React.FC<QuickAddDrawerProps> = ({
  isOpen,
  lang,
  tabs,
  selectedPhase,
  onClose,
  onAddTask,
  onOpenAIWithPrompt,
}) => {
  const t = TRANSLATIONS[lang];
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [phase, setPhase] = useState<string>(() => {
    if (
      selectedPhase &&
      selectedPhase !== 'ALL' &&
      selectedPhase !== 'DASHBOARD' &&
      tabs.some((tb) => tb.id === selectedPhase)
    ) {
      return selectedPhase;
    }
    return tabs[0]?.id || 'focus';
  });
  const [priority, setPriority] = useState<1 | 2 | 3>(2);
  const [showStepsSection, setShowStepsSection] = useState(false);
  const [customSteps, setCustomSteps] = useState<string[]>([]);
  const [steps, setSteps] = useState(1);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      if (
        selectedPhase &&
        selectedPhase !== 'ALL' &&
        selectedPhase !== 'DASHBOARD' &&
        tabs.some((tb) => tb.id === selectedPhase)
      ) {
        setPhase(selectedPhase);
      } else if (!tabs.some((tb) => tb.id === phase) || phase === 'DASHBOARD' || phase === 'ALL') {
        setPhase(tabs[0]?.id || 'focus');
      }
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen, selectedPhase, tabs]);

  const handleAddStepInput = () => {
    sound.tick(600);
    setCustomSteps((prev) => [...prev, '']);
    setShowStepsSection(true);
  };

  const handleUpdateStepText = (index: number, val: string) => {
    setCustomSteps((prev) => {
      const next = [...prev];
      next[index] = val;
      return next;
    });
  };

  const handleRemoveStepInput = (index: number) => {
    sound.tick(400);
    setCustomSteps((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    sound.activate();
    
    const validStepList = customSteps
      .map((s, idx) => ({ id: `s-${idx}-${Date.now()}`, title: s.trim(), done: false }))
      .filter((s) => s.title.length > 0);

    const calculatedSteps = validStepList.length > 0 ? validStepList.length : steps;

    const effectivePhase =
      phase && phase !== 'DASHBOARD' && phase !== 'ALL' && tabs.some((tb) => tb.id === phase)
        ? phase
        : tabs[0]?.id || 'focus';

    onAddTask({
      title: title.trim(),
      phase: effectivePhase,
      priority,
      steps: calculatedSteps,
      stepList: validStepList.length > 0 ? validStepList : undefined,
      note: note.trim() || undefined,
    });

    setTitle('');
    setNote('');
    setCustomSteps([]);
    setShowStepsSection(false);
    onClose();
  };

  const handleAskAI = () => {
    if (!title.trim()) return;
    onOpenAIWithPrompt(title.trim());
    setTitle('');
    setNote('');
    setCustomSteps([]);
    setShowStepsSection(false);
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          id="quick-add-drawer"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className="overflow-hidden bg-[#0c0c0e] border-b border-neutral-800 font-mono"
        >
          <form onSubmit={handleSubmit} className="p-5 sm:p-8 max-w-4xl mx-auto flex flex-col gap-5">
            {/* Title Input */}
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                id="quick-add-title-input"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t.quickAdd.titlePlaceholder}
                className="min-w-0 flex-1 bg-[#08080a] border border-neutral-700 text-white placeholder:text-neutral-500 placeholder:font-normal placeholder:normal-case px-3.5 py-3 text-sm leading-relaxed font-mono tracking-normal focus:outline-none focus:border-white transition-colors"
              />
              <button
                type="button"
                id="quick-add-close-btn"
                onClick={onClose}
                className="p-2.5 border border-neutral-800 text-neutral-400 hover:text-white hover:border-neutral-600 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Note / Detail Input */}
            <div>
              <input
                id="quick-add-note-input"
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t.quickAdd.notePlaceholder}
                className="w-full bg-[#08080a] border border-neutral-800 text-neutral-200 placeholder:text-neutral-500 placeholder:font-normal px-3.5 py-3 text-sm leading-relaxed font-mono focus:outline-none focus:border-neutral-400 transition-colors"
              />
            </div>

            {/* Phase / Tab & Priority Tactical Controls */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs">
              {/* Tab Selection */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-mono text-neutral-400 font-bold uppercase tracking-wider">
                  {t.quickAdd.phaseLabel}
                </span>
                {tabs.map((tb) => {
                  const displayName = (t.phases as any)[tb.id] || tb.name;
                  const isSelected = phase === tb.id;
                  return (
                    <button
                      key={tb.id}
                      type="button"
                      id={`quick-add-tab-${tb.id.toLowerCase()}`}
                      onClick={() => {
                        sound.tick(600);
                        setPhase(tb.id);
                      }}
                      className={`px-2 py-1 text-xs font-mono border transition-all flex items-center gap-1.5 ${
                        isSelected
                          ? 'border-white bg-white text-black font-extrabold'
                          : 'border-neutral-800 text-neutral-400 hover:text-neutral-200 bg-neutral-900/60'
                      }`}
                    >
                      {tb.color && (
                        <span
                          className="w-1.5 h-1.5 rounded-full shrink-0 shadow-sm"
                          style={{ backgroundColor: tb.color }}
                        />
                      )}
                      <span>{displayName}</span>
                    </button>
                  );
                })}
              </div>

              {/* Priority Selection */}
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-mono text-neutral-400 font-bold">{t.quickAdd.priorityLabel}</span>
                  {([1, 2, 3] as (1 | 2 | 3)[]).map((pri) => {
                    const isSelected = priority === pri;
                    const tooltip =
                      pri === 1
                        ? t.quickAdd.priorityUrgent
                        : pri === 2
                        ? t.quickAdd.priorityStandard
                        : t.quickAdd.priorityLow;

                    return (
                      <button
                        key={pri}
                        type="button"
                        id={`quick-add-pri-${pri}`}
                        onClick={() => {
                          sound.tick(400 + pri * 100);
                          setPriority(pri);
                        }}
                        title={tooltip}
                        className={`flex items-center gap-1 px-2 py-1 text-xs font-mono border transition-all ${
                          isSelected
                            ? pri === 1
                              ? 'border-red-500 bg-red-500 text-black font-extrabold'
                              : pri === 2
                              ? 'border-amber-400 bg-amber-400 text-black font-extrabold'
                              : 'border-emerald-400 bg-emerald-400 text-black font-extrabold'
                            : pri === 1
                            ? 'border-red-950/70 text-red-400/80 hover:border-red-700 hover:text-red-300 bg-red-950/10'
                            : pri === 2
                            ? 'border-amber-950/70 text-amber-400/80 hover:border-amber-700 hover:text-amber-300 bg-amber-950/10'
                            : 'border-emerald-950/70 text-emerald-400/80 hover:border-emerald-700 hover:text-emerald-300 bg-emerald-950/10'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            pri === 1
                              ? 'bg-red-500'
                              : pri === 2
                              ? 'bg-amber-400'
                              : 'bg-emerald-400'
                          } ${isSelected ? 'ring-1 ring-black' : ''}`}
                        />
                        <span>P{pri}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Optional Custom Steps & Descriptions Section */}
            <div className="pt-4 border-t border-neutral-800/80">
              <div className="flex items-center justify-between gap-3 mb-3">
                <button
                  type="button"
                  id="toggle-steps-section-btn"
                  onClick={() => {
                    sound.tick(500);
                    if (!showStepsSection && customSteps.length === 0) {
                      setCustomSteps(['', '']);
                    }
                    setShowStepsSection(!showStepsSection);
                  }}
                  className="flex items-center gap-1.5 text-xs font-mono text-neutral-300 hover:text-white transition-colors"
                >
                  <span className="text-neutral-500">[{showStepsSection ? '−' : '+'}]</span>
                  <span className="font-bold uppercase tracking-wider">{t.stepsSection.optionalTitle}</span>
                  {customSteps.length > 0 && (
                    <span className="text-xs px-1.5 py-1 bg-neutral-800 text-neutral-300 border border-neutral-700">
                      {customSteps.length}
                    </span>
                  )}
                </button>

                {showStepsSection && (
                  <button
                    type="button"
                    id="add-custom-step-btn"
                    onClick={handleAddStepInput}
                    className="text-xs font-mono uppercase px-2 py-1 bg-neutral-900 border border-neutral-700 hover:border-white text-neutral-300 hover:text-white transition-colors"
                  >
                    {t.stepsSection.addStepBtn}
                  </button>
                )}
              </div>

              {/* Animated Custom Step Inputs */}
              <AnimatePresence>
                {showStepsSection && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.18 }}
                    className="space-y-3 overflow-hidden"
                  >
                    {customSteps.map((stepText, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <span className="text-xs font-mono text-neutral-500 w-5 shrink-0">
                          #{idx + 1}
                        </span>
                        <input
                          type="text"
                          id={`custom-step-input-${idx}`}
                          value={stepText}
                          onChange={(e) => handleUpdateStepText(idx, e.target.value)}
                          placeholder={`${t.stepsSection.stepPlaceholder} ${idx + 1}`}
                          className="min-w-0 flex-1 bg-[#101014] border border-neutral-800 focus:border-neutral-400 text-white placeholder:text-neutral-500 px-3 py-2.5 text-sm leading-relaxed font-mono transition-colors"
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoveStepInput(idx)}
                          className="p-1.5 text-neutral-500 hover:text-rose-400 border border-transparent hover:border-neutral-800 transition-colors"
                          title="Видалити цей крок"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}

                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
              {title.trim() && (
                <button
                  type="button"
                  id="quick-add-ai-generate-btn"
                  onClick={handleAskAI}
                  className="flex items-center gap-1.5 px-3 py-2.5 bg-[#08080a] border border-neutral-800 text-xs font-mono text-neutral-400 hover:text-white hover:border-neutral-600 transition-colors cursor-pointer"
                >
                  <SquareCode className="w-3.5 h-3.5 text-neutral-300" />
                  <span>{t.quickAdd.aiBreakdown}</span>
                </button>
              )}

              <button
                type="submit"
                id="quick-add-submit-btn"
                className="flex items-center gap-1.5 px-4 py-2.5 bg-white text-black font-extrabold text-xs font-mono tracking-wider hover:bg-neutral-200 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{t.quickAdd.submitBtn}</span>
              </button>
            </div>
          </form>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
