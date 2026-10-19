import React, { useEffect, useId, useRef, useState } from 'react';
import { TrendingUp } from 'lucide-react';

interface ActivityPoint {
  label: string;
  delivered: number;
  dropped: number;
  worked?: number;
  tooltipLabel?: string;
}

interface ActivityChartProps {
  data: ActivityPoint[];
  title: string;
  period: string;
  completedLabel: string;
  deletedLabel: string;
  unitLabel: string;
  emptyLabel: string;
  workedLabel?: string;
  workedUnitLabel?: string;
  labelEvery?: number;
}

const SERIES = [
  { key: 'delivered', color: 'text-emerald-400', dash: undefined },
  { key: 'dropped', color: 'text-neutral-400', dash: '5 5' },
] as const;

export const ActivityChart: React.FC<ActivityChartProps> = ({ data, title, period, completedLabel, deletedLabel, unitLabel, emptyLabel, workedLabel, workedUnitLabel, labelEvery = 1 }) => {
  const id = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const updateWidth = () => setWidth(Math.max(280, container.getBoundingClientRect().width));
    updateWidth();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateWidth);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  const labels = { delivered: completedLabel, dropped: deletedLabel };
  const hasWorked = data.some(point => point.worked !== undefined);
  const maximum = Math.max(0, ...data.flatMap(point => [point.delivered, point.dropped]));
  const workedMaximum = Math.max(0, ...data.map(point => point.worked ?? 0));
  const step = Math.max(1, Math.ceil(maximum / 4));
  const workedStep = Math.max(1, Math.ceil(workedMaximum / 4));
  const left = 32;
  const right = width - (hasWorked ? 36 : 16);
  const top = 28;
  const bottom = 222;
  const x = (index: number) => data.length < 2 ? (left + right) / 2 : left + index * (right - left) / (data.length - 1);
  const y = (value: number) => bottom - (value / (step * 4)) * (bottom - top);
  const workedY = (value: number) => bottom - (value / (workedStep * 4)) * (bottom - top);
  const axisEvery = Math.max(labelEvery * (width < 480 && labelEvery > 1 ? 2 : 1), Math.ceil(data.length / Math.max(1, Math.floor((right - left) / 38))));
  const active = activeIndex === null ? undefined : data[activeIndex];
  const tooltipWidth = Math.min(270, width);
  const tooltipX = activeIndex === null ? 0 : Math.min(width - tooltipWidth, Math.max(0, x(activeIndex) - tooltipWidth / 2));
  const workedSummary = (point: ActivityPoint) => `≈ ${Math.round((point.worked ?? 0) * 10) / 10} ${workedUnitLabel ?? workedLabel ?? ''} · ${point.delivered} ${completedLabel.toLowerCase()}`;

  return (
    <section className="min-w-0 border border-neutral-800/80 bg-[#08080a]/60 p-5 sm:p-6" aria-labelledby={`${id}-title`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-3.5 w-3.5 shrink-0 text-neutral-300" />
          <h3 id={`${id}-title`} className="font-sans text-sm font-bold uppercase tracking-wider text-neutral-200">{title}</h3>
        </div>
        <span className="border border-neutral-800 bg-neutral-950 px-2.5 py-1.5 text-xs text-neutral-400">{period}</span>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-xs font-sans">
        <span className="text-neutral-400">{unitLabel}{hasWorked && workedUnitLabel ? ` / ${workedUnitLabel}` : ''}</span>
        <div className="flex flex-wrap gap-4">
          {hasWorked && <span className="flex items-center gap-2 text-neutral-400"><span className="h-3 w-3 bg-emerald-400/30" />{workedLabel}</span>}
          {SERIES.map(series => (
            <span key={series.key} className="flex items-center gap-2 text-neutral-400">
              <span className={`w-5 border-t-2 ${series.color} ${series.dash ? 'border-dashed' : ''}`} />
              {labels[series.key]}
            </span>
          ))}
        </div>
      </div>
      {maximum === 0 && workedMaximum === 0 && <p className="mt-4 text-xs text-neutral-400" role="status">{emptyLabel}</p>}
      <div ref={containerRef} className="relative mt-2 min-w-0">
        <svg viewBox={`0 0 ${width} 260`} className="block w-full font-sans" role="group" aria-label={title}
          onPointerLeave={() => setActiveIndex(null)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setActiveIndex(null); }}>
          <defs>
            <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.2" className="text-emerald-400" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0.01" className="text-emerald-400" />
            </linearGradient>
          </defs>
          {[0, 1, 2, 3, 4].map(tick => (
            <g key={tick}>
              <line x1={left} x2={right} y1={y(tick * step)} y2={y(tick * step)} className="stroke-neutral-800/70" vectorEffect="non-scaling-stroke" />
              <text x={left - 10} y={y(tick * step) + 4} textAnchor="end" className="fill-neutral-400 text-[11px]">{tick * step}</text>
              {hasWorked && <text x={right + 8} y={y(tick * step) + 4} className="fill-neutral-400 text-[11px]">{tick * workedStep}</text>}
            </g>
          ))}
          {hasWorked && data.map((point, index) => {
            const barWidth = Math.max(2, Math.min(28, (right - left) / Math.max(1, data.length) * 0.7));
            return <rect key={index} x={x(index) - barWidth / 2} y={workedY(point.worked ?? 0)} width={barWidth} height={bottom - workedY(point.worked ?? 0)} className="fill-emerald-400/30" />;
          })}
          {!hasWorked && data.length > 1 && <path d={`M ${x(0)} ${bottom} ${data.map((point, index) => `L ${x(index)} ${y(point.delivered)}`).join(' ')} L ${x(data.length - 1)} ${bottom} Z`} fill={`url(#${id}-fill)`} />}
          {SERIES.map(series => (
            <g key={series.key} className={series.color}>
              <path d={data.map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(point[series.key])}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray={series.dash} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              {data.map((point, index) => <circle key={index} cx={x(index)} cy={y(point[series.key])} r={activeIndex === index ? 4 : 2.5} fill="currentColor" stroke="#08080a" strokeWidth="2" vectorEffect="non-scaling-stroke" />)}
            </g>
          ))}
          {active && activeIndex !== null && <line x1={x(activeIndex)} x2={x(activeIndex)} y1={top} y2={bottom} className="stroke-neutral-500" strokeDasharray="3 5" pointerEvents="none" />}
          {data.map((point, index) => {
            const hitLeft = index === 0 ? left - 14 : (x(index - 1) + x(index)) / 2;
            const hitRight = index === data.length - 1 ? right + 14 : (x(index) + x(index + 1)) / 2;
            return (
            <g key={index}>
              {index % axisEvery === 0 && <text x={x(index)} y={bottom + 23} textAnchor="middle" className="fill-neutral-400 text-[11px]">{point.label}</text>}
              <rect x={hitLeft} y={top} width={hitRight - hitLeft} height={bottom - top}
                fill="transparent" tabIndex={0} role="button" className="cursor-crosshair focus:outline-none focus-visible:stroke-neutral-400"
                aria-label={`${point.tooltipLabel ?? point.label}: ${hasWorked ? workedSummary(point) : `${completedLabel} ${point.delivered}`}, ${deletedLabel.toLocaleLowerCase()} ${point.dropped}`}
                onPointerEnter={() => setActiveIndex(index)} onFocus={() => setActiveIndex(index)} onClick={() => setActiveIndex(index)}
                onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setActiveIndex(index); } if (event.key === 'Escape') { event.stopPropagation(); setActiveIndex(null); } }} />
            </g>
          ); })}
        </svg>
        {active && <div className="pointer-events-none absolute top-0 border border-neutral-700 bg-neutral-950 p-3 text-xs font-sans shadow-lg" style={{ left: tooltipX, width: tooltipWidth }} aria-hidden="true">
          <p className="text-neutral-400">{active.tooltipLabel ?? active.label}</p>
          {hasWorked && <p className="mt-2 text-emerald-400">{workedSummary(active)}</p>}
          {!hasWorked && <p className="mt-2 flex justify-between gap-3 text-emerald-400"><span>{completedLabel}</span><strong>{active.delivered}</strong></p>}
          <p className="mt-2 flex justify-between gap-3 text-neutral-400"><span>{deletedLabel}</span><strong>{active.dropped}</strong></p>
        </div>}
      </div>
    </section>
  );
}
