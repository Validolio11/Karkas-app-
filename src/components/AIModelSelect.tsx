import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { AIUsageView } from '../utils/aiModelUsage';

interface Props {
  models: string[];
  value: string;
  disabled: boolean;
  label: string;
  emptyLabel: string;
  onChange: (model: string) => void;
  lang?: 'uk' | 'en';
  /** Locally observed usage per model; omitted models show no bar. */
  usage?: (model: string) => AIUsageView | undefined;
}

const clock = (time: number, lang: 'uk' | 'en') => new Date(time).toLocaleTimeString(lang === 'uk' ? 'uk-UA' : 'en-US', { hour: '2-digit', minute: '2-digit' });
const ukRequests = (count: number) => count % 10 === 1 && count % 100 !== 11 ? 'запит'
  : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? 'запити' : 'запитів';
const compact = (count: number) => count >= 1000 ? `${(count / 1000).toFixed(count >= 10_000 ? 0 : 1)}k` : String(count);

/** One-line text alternative for a usage bar; never invents a limit. */
export function usageLabel(view: AIUsageView, lang: 'uk' | 'en'): string {
  const uk = lang === 'uk';
  if (view.state === 'unavailable') return view.reason === 'no_quota'
    ? (uk ? 'недоступна на безкоштовному тарифі' : 'not available on the free tier')
    : (uk ? 'недоступна для цього проєкту' : 'unavailable for this project');
  if (view.state === 'limited') return uk ? `ліміт до ${clock(view.limitedUntil!, lang)}` : `limited until ${clock(view.limitedUntil!, lang)}`;
  const approx = view.approximate ? '≈ ' : '';
  if (view.state === 'known') return uk
    ? `${approx}${view.used}/${view.limit} ${ukRequests(view.limit!)} · ${view.percent}% · скидання о ${clock(view.resetAt, lang)}`
    : `${approx}${view.used}/${view.limit} requests · ${view.percent}% · resets ${clock(view.resetAt, lang)}`;
  return uk ? `${view.used} ${ukRequests(view.used)} сьогодні · ліміт ще невідомий` : `${view.used} requests today · limit not known yet`;
}

/**
 * Thin usage bar. The compact bar beside the selector is a meter when Google
 * reported a limit; list rows (option content is presentational) rely on their
 * visible text, and the trigger's label repeats the selected model's usage.
 */
export const AIUsageBar: React.FC<{ view: AIUsageView; lang: 'uk' | 'en'; model: string; compact?: boolean }> = ({ view, lang, model, compact: small }) => {
  const text = usageLabel(view, lang);
  const tokens = view.tokens ? (lang === 'uk' ? ` · ${compact(view.tokens)} токенів` : ` · ${compact(view.tokens)} tokens`) : '';
  // Counts are this device's; Google applies limits to the whole project.
  const approximation = !view.approximate ? '' : lang === 'uk'
    ? '\nОрієнтовний ліміт безкоштовного тарифу Google; фактичний може відрізнятися (платний тариф — вищий).'
    : '\nApproximate Google free-tier limit; the actual one may differ (paid tiers are higher).';
  const scope = approximation + (lang === 'uk' ? '\nЛічильник цього пристрою; ліміти Google діють на весь проєкт.' : '\nThis device’s count; Google limits apply to the whole project.');
  const fill = view.state === 'limited' ? 100 : view.state === 'unavailable' ? 0 : view.percent ?? 0;
  const meter = small && view.limit !== undefined
    ? { role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': view.limit, 'aria-valuenow': Math.min(view.used, view.limit), 'aria-valuetext': text, 'aria-label': `${model}: ${text}` }
    : { 'aria-hidden': true };
  return <span className={`karkas-ai-usage is-${view.state}${(view.percent ?? 0) >= 80 ? ' is-high' : ''}${small ? ' is-compact' : ''}`} title={`${text}${tokens}${scope}`}>
    <span className="karkas-ai-usage-track" {...meter}>
      <span className="karkas-ai-usage-fill" style={{ width: `${fill}%` }} />
    </span>
    {!small && <span className="karkas-ai-usage-text">{text}</span>}
  </span>;
};

/** Select-only combobox: focus stays on the trigger while navigating options. */
export const AIModelSelect: React.FC<Props> = ({ models, value, disabled, label, emptyLabel, onChange, lang: langProp, usage }) => {
  // Without strictNullChecks a `= 'uk'` default widens to string; narrow explicitly.
  const lang: 'uk' | 'en' = langProp === 'en' ? 'en' : 'uk';
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const selected = Math.max(0, models.indexOf(value));
  const unavailable = disabled || !models.length;
  const current = models.length ? value || models[selected] : '';
  const currentUsage = current ? usage?.(current) : undefined;

  useEffect(() => {
    if (unavailable) setOpen(false);
    setActive(selected);
  }, [unavailable, selected, models]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`[data-model-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const show = (index = selected) => { setActive(index); setOpen(true); };
  const choose = (index: number) => {
    const model = models[index];
    if (!model || unavailable) return;
    setOpen(false);
    trigger.current?.focus();
    onChange(model);
  };
  const keyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (unavailable || event.nativeEvent.isComposing) return;
    if (event.key === 'Escape' && open) {
      event.preventDefault(); event.stopPropagation(); setOpen(false); return;
    }
    if (event.key === 'Tab') { setOpen(false); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) show();
      else setActive(index => Math.max(0, Math.min(models.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))));
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault(); show(event.key === 'Home' ? 0 : models.length - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (open) choose(active); else show();
    }
  };

  return <div ref={root} className="karkas-ai-model-select" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }}>
    <button ref={trigger} type="button" role="combobox" aria-label={`${label}: ${value || emptyLabel}${currentUsage ? `, ${usageLabel(currentUsage, lang)}` : ''}`}
      aria-expanded={open} aria-haspopup="listbox" aria-controls={open ? listId : undefined}
      aria-activedescendant={open ? `${listId}-${active}` : undefined}
      disabled={unavailable} title={value || emptyLabel} onKeyDown={keyDown}
      onClick={() => { if (open) setOpen(false); else show(); }} className="karkas-ai-model-trigger">
      <span>{models.length ? value || models[selected] : emptyLabel}</span>
      <ChevronDown aria-hidden="true" className="w-3.5 h-3.5 shrink-0" />
    </button>
    {currentUsage && <AIUsageBar view={currentUsage} lang={lang} model={current} compact />}
    {open && <div ref={list} id={listId} role="listbox" aria-label={label} className="karkas-ai-model-list">
      {models.map((model, index) => {
        const view = usage?.(model);
        return <div key={model} id={`${listId}-${index}`} role="option"
          aria-selected={model === value} data-model-index={index}
          className={`karkas-ai-model-option${active === index ? ' is-active' : ''}`}
          onMouseDown={event => event.preventDefault()} onPointerMove={() => setActive(index)} onClick={() => choose(index)}>
          <span className="karkas-ai-model-option-body">
            <span className="karkas-ai-model-name">{model}</span>
            {view && <AIUsageBar view={view} lang={lang} model={model} />}
          </span>
          {model === value && <Check aria-hidden="true" className="w-4 h-4 shrink-0" />}
        </div>;
      })}
    </div>}
  </div>;
};
