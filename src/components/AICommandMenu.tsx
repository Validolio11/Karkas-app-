import React, { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { AI_COMMANDS, type AIIntent } from './aiCommands';

export const AICommandMenu: React.FC<{ lang: 'uk' | 'en'; disabled: boolean; onChoose: (intent: AIIntent) => void }> = ({ lang, disabled, onChoose }) => {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const close = (focus = false) => { setOpen(false); if (focus) trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) close(); };
    document.addEventListener('pointerdown', outside);
    items.current[active]?.focus();
    return () => document.removeEventListener('pointerdown', outside);
  }, [open, active]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  return <div ref={root} className="karkas-ai-command-menu" onBlur={event => { if (event.relatedTarget && !root.current?.contains(event.relatedTarget as Node)) close(); }} onKeyDown={event => {
    if (!open) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      setActive(event.key === 'Home' ? 0 : event.key === 'End' ? AI_COMMANDS.length - 1 : (active + (event.key === 'ArrowDown' ? 1 : -1) + AI_COMMANDS.length) % AI_COMMANDS.length);
    }
  }}>
    <button id="ai-command-menu-btn" ref={trigger} type="button" disabled={disabled} aria-label={lang === 'uk' ? 'Додати дію' : 'Add action'} aria-haspopup="menu" aria-expanded={open} aria-controls="ai-command-menu" className="karkas-ai-plus" onClick={() => { setActive(0); setOpen(value => !value); }} onKeyDown={event => {
      if (!open && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setActive(event.key === 'ArrowUp' ? AI_COMMANDS.length - 1 : 0); setOpen(true); }
    }}><Plus size={22} aria-hidden="true" /></button>
    {open && <div id="ai-command-menu" role="menu" aria-label={lang === 'uk' ? 'Дії ШІ' : 'AI actions'} className="karkas-ai-command-list">
      {AI_COMMANDS.map((action, index) => <button key={action.intent} ref={node => { items.current[index] = node; }} role="menuitem" type="button" tabIndex={active === index ? 0 : -1} onClick={() => { close(); onChoose(action.intent); }}>
        <span>{action[lang]}</span><span className="text-neutral-400">{action.command}</span>
      </button>)}
    </div>}
  </div>;
};
