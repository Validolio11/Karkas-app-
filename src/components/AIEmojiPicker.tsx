import React, { useEffect, useId, useRef, useState } from 'react';
import { Smile } from 'lucide-react';

const choices = [
  ['🙂', 'Усмішка', 'Smile'], ['👍', 'Добре', 'Thumbs up'], ['✅', 'Виконано', 'Done'], ['🎯', 'Мета', 'Goal'],
  ['💡', 'Ідея', 'Idea'], ['📅', 'Планування', 'Schedule'], ['⏱️', 'Час', 'Time'], ['🚀', 'Початок', 'Start'],
];

export const AIEmojiPicker: React.FC<{ lang: 'uk' | 'en'; disabled: boolean; onChoose: (emoji: string) => void }> = ({ lang, disabled, onChoose }) => {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const close = (restoreFocus = false) => { setOpen(false); if (restoreFocus) trigger.current?.focus(); };

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  useEffect(() => {
    if (!open) return;
    items.current[active]?.focus();
  }, [open, active]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  return <div className="karkas-ai-emoji-picker" ref={root} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }}>
    <button type="button" ref={trigger} disabled={disabled} aria-label={lang === 'uk' ? 'Додати емодзі' : 'Add emoji'}
      title={lang === 'uk' ? 'Додати емодзі' : 'Add emoji'} aria-expanded={open} aria-haspopup="menu" aria-controls={open ? id : undefined}
      className="karkas-ai-emoji-trigger" onClick={() => { setActive(0); setOpen(previous => !previous); }}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActive(event.key === 'ArrowDown' ? 0 : choices.length - 1); setOpen(true); }
        if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(); }
      }}><Smile className="w-4 h-4" aria-hidden="true" /></button>
    {open && <div id={id} role="menu" aria-label={lang === 'uk' ? 'Емодзі' : 'Emoji'} className="karkas-ai-emoji-menu"
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
        else if (event.key === 'Tab') {
          event.preventDefault(); event.stopPropagation();
          const dialog = root.current?.closest('[role="dialog"]') as HTMLElement | null | undefined;
          const controls = Array.from(dialog?.querySelectorAll<HTMLElement>('button, input, textarea, select, a[href], summary, [tabindex="0"]') || [])
            .filter(element => !element.hasAttribute('disabled') && element.tabIndex >= 0 && !element.closest('[role="menu"]') && element.getClientRects().length > 0);
          const index = controls.indexOf(trigger.current!);
          close();
          if (index >= 0 && controls.length) controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
          else trigger.current?.focus();
        }
        else if (['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowDown' ? 4 : -4;
          setActive(index => event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : (index + delta + choices.length) % choices.length);
        }
      }}>
      {choices.map(([emoji, uk, en], index) => <button key={emoji} type="button" role="menuitem"
        ref={element => { items.current[index] = element; }} tabIndex={active === index ? 0 : -1}
        aria-label={lang === 'uk' ? uk : en} title={lang === 'uk' ? uk : en}
        className="karkas-ai-emoji-choice" onFocus={() => setActive(index)}
        onClick={() => { close(); onChoose(emoji); }}><span aria-hidden="true">{emoji}</span></button>)}
    </div>}
  </div>;
};
