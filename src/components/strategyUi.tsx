import React, { useId, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ChevronRight } from 'lucide-react';
import type { PSTask } from '../types';
import { formatTaskDate, getDeadlineProgress, taskDateEnd } from '../utils/taskDates';

/** Shared building blocks of «Моя стратегія»; they follow the task card and dashboard styles. */
export const btn = 'inline-flex min-h-11 sm:min-h-8 items-center justify-center gap-1.5 border border-neutral-700 px-2.5 py-1.5 text-xs font-semibold text-neutral-200 transition-colors hover:border-white hover:text-white disabled:opacity-40 motion-reduce:transition-none';
export const primaryBtn = 'inline-flex min-h-11 sm:min-h-9 items-center justify-center gap-2 border border-white bg-white px-3 py-2 text-sm font-bold text-black transition-colors hover:bg-neutral-200 disabled:opacity-40 motion-reduce:transition-none';
export const ghostBtn = 'inline-flex min-h-11 sm:min-h-8 items-center justify-center gap-1.5 px-2 py-1.5 text-xs text-neutral-400 transition-colors hover:text-white motion-reduce:transition-none';
export const chipBtn = 'inline-flex min-h-11 sm:min-h-8 items-center justify-center gap-1.5 border border-neutral-800 px-2.5 py-1 text-xs text-neutral-400 transition-colors hover:border-neutral-500 hover:text-white motion-reduce:transition-none';
export const panel = 'min-w-0 border border-neutral-800 bg-[#09090b]/95 p-5 sm:p-6';
/** The one emphasised surface of the tab: the next step. */
export const heroPanel = 'relative min-w-0 border bg-[#0e0e10] p-5 sm:p-8 transition-colors motion-reduce:transition-none';
export const heading = 'text-[11px] font-bold uppercase tracking-wider text-neutral-300';
export const monoLabel = 'font-mono text-[11px] uppercase tracking-wider text-neutral-500';
export const field = 'mt-1 w-full min-h-11 sm:min-h-8 border border-neutral-700 bg-[#09090b] px-2 py-1.5 text-xs text-neutral-200';

type Tone = 'neutral' | 'green' | 'amber' | 'red' | 'white';
const toneClass: Record<Tone, string> = {
  neutral: 'border-neutral-700 text-neutral-400',
  green: 'border-emerald-800/70 text-emerald-300',
  amber: 'border-amber-900/70 text-amber-300',
  red: 'border-red-900/70 text-red-400',
  white: 'border-neutral-500 text-white',
};

/** Small uppercase chip, like «РЕЖИМ ЗНАЙОМСТВА» in the chat header. */
export const Chip: React.FC<{ tone?: Tone; className?: string; title?: string; children: React.ReactNode }> = ({ tone = 'neutral', className = '', title, children }) =>
  <span title={title} className={`inline-flex shrink-0 items-center gap-1.5 border bg-[#0a0a0c] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${toneClass[tone]} ${className}`}>{children}</span>;

/** Section title with the dashboard's white square marker and an optional mono counter. */
export const SectionTitle: React.FC<{ id?: string; count?: number | string; children: React.ReactNode }> = ({ id, count, children }) =>
  <h2 id={id} className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-neutral-200">
    <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 bg-white" />{children}
    {count !== undefined && <span className="font-mono font-normal text-neutral-500">{count}</span>}
  </h2>;

/** Thin progress bar; colour is used only for the filled part. */
export const Meter: React.FC<{ value: number; label: string; tone?: 'green' | 'white' | 'amber' | 'red'; className?: string; valueText?: string }> = ({ value, label, tone = 'green', className = '', valueText }) => {
  const width = Math.max(0, Math.min(100, Math.round(value)));
  const fill = tone === 'white' ? 'bg-neutral-100' : tone === 'amber' ? 'bg-amber-400' : tone === 'red' ? 'bg-red-500' : 'bg-emerald-400';
  return <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={width} aria-valuetext={valueText}
    className={`h-1 overflow-hidden bg-neutral-800 ${className}`}>
    <div className={`h-full ${fill} transition-[width] duration-500 motion-reduce:transition-none`} style={{ width: `${width}%` }} />
  </div>;
};

/** Segmented step bar, as in the quick-add wizard and task cards. */
export const SegmentBar: React.FC<{ segments: ('on' | 'partial' | 'off')[]; label: string; valueText: string; className?: string; thick?: boolean }> = ({ segments, label, valueText, className = '', thick = false }) =>
  <div role="img" aria-label={`${label}: ${valueText}`} className={`flex gap-1 ${className}`}>
    {segments.map((state, index) => <span key={index} aria-hidden="true" className={`${thick ? 'h-1.5' : 'h-1'} min-w-2 flex-1 transition-colors motion-reduce:transition-none ${state === 'on' ? 'bg-white' : state === 'partial' ? 'bg-neutral-500' : 'bg-neutral-800'}`} />)}
  </div>;

/** Read-only priority indicator matching the task card PRI bars. */
export const PriorityBadge: React.FC<{ priority: 1 | 2 | 3; lang: 'uk' | 'en' }> = ({ priority, lang }) => {
  const text = priority === 1 ? 'text-red-400' : priority === 2 ? 'text-amber-400' : 'text-emerald-400';
  const border = priority === 1 ? 'border-red-900/70 bg-red-950/20' : priority === 2 ? 'border-amber-900/70 bg-amber-950/20' : 'border-emerald-900/70 bg-emerald-950/20';
  return <span title={`${lang === 'uk' ? 'Пріоритет' : 'Priority'} P${priority}`} className={`inline-flex items-center gap-1 border px-1.5 py-1 ${border}`}>
    <span className={`font-mono text-[11px] font-bold ${text}`}>PRI</span>
    <span className="flex h-2.5 items-center gap-0.5" aria-hidden="true">
      <span className="h-2.5 w-1 bg-emerald-400" />
      <span className={`h-2.5 w-1 ${priority <= 2 ? 'bg-amber-400' : 'bg-neutral-800'}`} />
      <span className={`h-2.5 w-1 ${priority === 1 ? 'bg-red-500' : 'bg-neutral-800'}`} />
    </span>
    <span className="sr-only">P{priority}</span>
  </span>;
};

/** Category tag «[ФОКУС]» tinted with the tab colour, like on task cards. */
export const CategoryChip: React.FC<{ name: string; color?: string }> = ({ name, color }) =>
  <span style={color ? { borderColor: `${color}66`, backgroundColor: `${color}18`, color } : undefined}
    className={`inline-flex items-center gap-1.5 border px-2 py-1 text-[11px] font-extrabold uppercase tracking-wider ${color ? '' : 'border-neutral-700 bg-neutral-900/60 text-neutral-300'}`}>
    {color && <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />}[{name}]
  </span>;

/** «ДО 16.10.2026» chip with the same colour thresholds as the task card. */
export const DeadlineChip: React.FC<{ task: PSTask; lang: 'uk' | 'en'; now: number }> = ({ task, lang, now }) => {
  if (!task.deadlineDate) return null;
  const end = taskDateEnd(task.deadlineDate);
  const progress = Math.round(getDeadlineProgress(task, now));
  const overdue = !task.done && end !== null && now > end;
  const color = task.done ? 'text-neutral-400 border-neutral-700' : overdue || progress >= 85 ? 'text-red-400 border-red-900/70' : progress >= 60 ? 'text-amber-400 border-amber-900/70' : 'text-emerald-400 border-emerald-900/70';
  return <span title={lang === 'uk' ? `${overdue ? 'Термін минув. ' : ''}Минуло ${progress}% часу до дедлайну` : `${overdue ? 'Overdue. ' : ''}${progress}% of time to deadline elapsed`}
    className={`inline-flex items-center gap-2 border bg-[#0a0a0c] px-2 py-1 font-mono text-[11px] font-bold ${color}`}>
    {lang === 'uk' ? 'ДО' : 'BY'} {formatTaskDate(task.deadlineDate, lang, now)}{overdue && ' !'}
    <span aria-hidden="true" className="h-2 w-10 bg-neutral-800"><span className="block h-full bg-current" style={{ width: `${progress}%` }} /></span>
  </span>;
};

/** Height-animated reveal used by disclosures; reduced motion switches the animation off. */
export const Reveal: React.FC<{ open: boolean; id?: string; labelledBy?: string; children: React.ReactNode }> = ({ open, id, labelledBy, children }) => {
  const reduce = useReducedMotion();
  return <AnimatePresence initial={false}>
    {open && <motion.div key="reveal" id={id} role={labelledBy ? 'region' : undefined} aria-labelledby={labelledBy}
      initial={reduce ? false : { height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
      exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { height: 0, opacity: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }} className="overflow-hidden">
      {children}
    </motion.div>}
  </AnimatePresence>;
};

/** Disclosure section with a count and a short state hint in its header. */
export const Collapsible: React.FC<{
  title: React.ReactNode; count?: number | string; hint?: React.ReactNode; defaultOpen?: boolean;
  className?: string; bodyClassName?: string; children: React.ReactNode;
}> = ({ title, count, hint, defaultOpen = false, className = '', bodyClassName = 'p-3', children }) => {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return <section className={`min-w-0 border border-neutral-800 bg-[#09090b] ${className}`}>
    <h3 className="m-0">
      <button type="button" id={`${id}-trigger`} aria-expanded={open} aria-controls={`${id}-panel`} onClick={() => setOpen(value => !value)}
        className="group flex min-h-11 sm:min-h-9 w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-white/[0.025] motion-reduce:transition-none">
        <ChevronRight aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 text-neutral-500 transition-transform group-hover:text-white motion-reduce:transition-none ${open ? 'rotate-90' : ''}`} />
        <span className="min-w-0 text-[11px] font-bold uppercase tracking-wider text-neutral-300 group-hover:text-white">{title}</span>
        {count !== undefined && <span className="font-mono text-[11px] text-neutral-500">{count}</span>}
        {hint && <span className="ml-auto min-w-0 truncate pl-2 text-right text-[11px] text-neutral-500">{hint}</span>}
      </button>
    </h3>
    <Reveal open={open} id={`${id}-panel`} labelledBy={`${id}-trigger`}>
      <div className={`border-t border-neutral-800 ${bodyClassName}`}>{children}</div>
    </Reveal>
  </section>;
};
