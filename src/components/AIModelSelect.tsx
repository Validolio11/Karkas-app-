import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

interface Props {
  models: string[];
  value: string;
  disabled: boolean;
  label: string;
  emptyLabel: string;
  onChange: (model: string) => void;
}

/** Select-only combobox: focus stays on the trigger while navigating options. */
export const AIModelSelect: React.FC<Props> = ({ models, value, disabled, label, emptyLabel, onChange }) => {
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const selected = Math.max(0, models.indexOf(value));
  const unavailable = disabled || !models.length;

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
    <button ref={trigger} type="button" role="combobox" aria-label={`${label}: ${value || emptyLabel}`}
      aria-expanded={open} aria-haspopup="listbox" aria-controls={open ? listId : undefined}
      aria-activedescendant={open ? `${listId}-${active}` : undefined}
      disabled={unavailable} title={value || emptyLabel} onKeyDown={keyDown}
      onClick={() => { if (open) setOpen(false); else show(); }} className="karkas-ai-model-trigger">
      <span>{models.length ? value || models[selected] : emptyLabel}</span>
      <ChevronDown aria-hidden="true" className="w-3.5 h-3.5 shrink-0" />
    </button>
    {open && <div ref={list} id={listId} role="listbox" aria-label={label} className="karkas-ai-model-list">
      {models.map((model, index) => <div key={model} id={`${listId}-${index}`} role="option"
        aria-selected={model === value} data-model-index={index}
        className={`karkas-ai-model-option${active === index ? ' is-active' : ''}`}
        onMouseDown={event => event.preventDefault()} onPointerMove={() => setActive(index)} onClick={() => choose(index)}>
        <span>{model}</span>
        {model === value && <Check aria-hidden="true" className="w-4 h-4 shrink-0" />}
      </div>)}
    </div>}
  </div>;
};
