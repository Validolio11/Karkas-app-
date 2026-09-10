import React, { useId, useState } from 'react';
import { TrendingUp } from 'lucide-react';

interface ActivityPoint {
  label: string;
  delivered: number;
  dropped: number;
}

interface ActivityChartProps {
  data: ActivityPoint[];
  title: string;
  period: string;
  completedLabel: string;
  deletedLabel: string;
  unitLabel: string;
  emptyLabel: string;
}

const SERIES = [
  { key: 'delivered', color: 'text-emerald-400', dash: undefined },
  { key: 'dropped', color: 'text-neutral-500', dash: '5 5' },
] as const;

export const ActivityChart: React.FC<ActivityChartProps> = ({ data, title, period, completedLabel, deletedLabel, unitLabel, emptyLabel }) => {
  const id = useId();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const labels = { delivered: completedLabel, dropped: deletedLabel };
  const maximum = Math.max(0, ...data.flatMap(point => [point.delivered, point.dropped]));
  const step = Math.max(1, Math.ceil(maximum / 4));
  const ceiling = step * 4;
  const left = 48;
  const right = 956;
  const top = 32;
  const bottom = 236;
  const x = (index: number) => data.length < 2 ? (left + right) / 2 : left + index * (right - left) / (data.length - 1);
  const y = (value: number) => bottom - (value / ceiling) * (bottom - top);
  const active = activeIndex === null ? undefined : data[activeIndex];
  const tooltipX = activeIndex === null ? left : Math.min(right - 194, Math.max(left, x(activeIndex) - 97));

  return (
    <section className="border border-neutral-800/80 bg-[#08080a]/60 p-4 sm:p-5" aria-labelledby={`${id}-title`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-3.5 w-3.5 shrink-0 text-neutral-300" />
          <h3 id={`${id}-title`} className="font-mono text-xs font-bold uppercase tracking-wider text-neutral-200">{title}</h3>
        </div>
        <span className="border border-neutral-800 bg-neutral-950 px-2.5 py-1.5 text-[10px] text-neutral-400">{period}</span>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-[10px] font-mono">
        <span className="text-neutral-500">{unitLabel}</span>
        <div className="flex flex-wrap gap-4">
          {SERIES.map(series => (
            <span key={series.key} className="flex items-center gap-2 text-neutral-400">
              <span className={`w-5 border-t-2 ${series.color} ${series.dash ? 'border-dashed' : ''}`} />
              {labels[series.key]}
            </span>
          ))}
        </div>
      </div>
      {maximum === 0 && <p className="mt-4 text-xs text-neutral-400" role="status">{emptyLabel}</p>}
      <div className="mt-2 overflow-x-auto">
        <svg viewBox="0 0 1000 280" className="block w-full min-w-[560px] overflow-visible font-mono" role="group" aria-label={title}
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
              <text x={left - 16} y={y(tick * step) + 4} textAnchor="end" className="fill-neutral-500 text-[11px]">{tick * step}</text>
            </g>
          ))}
          {data.length > 1 && <path d={`M ${x(0)} ${bottom} ${data.map((point, index) => `L ${x(index)} ${y(point.delivered)}`).join(' ')} L ${x(data.length - 1)} ${bottom} Z`} fill={`url(#${id}-fill)`} />}
          {SERIES.map(series => (
            <g key={series.key} className={series.color}>
              <path d={data.map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(point[series.key])}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray={series.dash} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              {data.map((point, index) => <circle key={index} cx={x(index)} cy={y(point[series.key])} r={activeIndex === index ? 5 : 3.5} fill="currentColor" stroke="#08080a" strokeWidth="2" vectorEffect="non-scaling-stroke" />)}
            </g>
          ))}
          {active && activeIndex !== null && <line x1={x(activeIndex)} x2={x(activeIndex)} y1={top} y2={bottom} className="stroke-neutral-500" strokeDasharray="3 5" pointerEvents="none" />}
          {data.map((point, index) => {
            const hitLeft = index === 0 ? left - 14 : (x(index - 1) + x(index)) / 2;
            const hitRight = index === data.length - 1 ? right + 14 : (x(index) + x(index + 1)) / 2;
            return (
            <g key={index}>
              <text x={x(index)} y={bottom + 26} textAnchor="middle" className="fill-neutral-400 text-[11px]">{point.label}</text>
              <rect x={hitLeft} y={top} width={hitRight - hitLeft} height={bottom - top}
                fill="transparent" tabIndex={0} role="button" className="cursor-crosshair focus:outline-none focus-visible:stroke-neutral-400"
                aria-label={`${point.label}: ${completedLabel} ${point.delivered}, ${deletedLabel} ${point.dropped}`}
                onPointerEnter={() => setActiveIndex(index)} onFocus={() => setActiveIndex(index)} onClick={() => setActiveIndex(index)}
                onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setActiveIndex(index); } if (event.key === 'Escape') { event.stopPropagation(); setActiveIndex(null); } }} />
            </g>
          ); })}
          {active && <g pointerEvents="none" aria-hidden="true">
            <rect x={tooltipX} y={0} width={194} height={72} className="fill-neutral-950 stroke-neutral-700" />
            <text x={tooltipX + 12} y={18} className="fill-neutral-400 text-[10px]">{active.label}</text>
            <text x={tooltipX + 12} y={39} className="fill-emerald-400 text-[11px]">{completedLabel}<tspan x={tooltipX + 182} textAnchor="end" fontWeight="bold">{active.delivered}</tspan></text>
            <text x={tooltipX + 12} y={59} className="fill-neutral-400 text-[11px]">{deletedLabel}<tspan x={tooltipX + 182} textAnchor="end" fontWeight="bold">{active.dropped}</tspan></text>
          </g>}
        </svg>
      </div>
    </section>
  );
}
