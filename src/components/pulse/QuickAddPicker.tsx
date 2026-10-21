import React, { useLayoutEffect, useRef, useState } from 'react';

export interface QuickAddChoice {
  value: string;
  top: string;
  main: string;
  bottom?: string;
  label: string;
}

interface QuickAddPickerProps {
  id: string;
  label: string;
  kind: 'date' | 'time' | 'category';
  choices: QuickAddChoice[];
  selected?: string;
  onSelect: (value: string) => void;
  onClose: () => void;
}

/** A mouse-draggable row; touch scrolling and keyboard focus keep their native behavior. */
export const QuickAddPicker: React.FC<QuickAddPickerProps> = ({ id, label, kind, choices, selected, onSelect, onClose }) => {
  const row = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; left: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [edges, setEdges] = useState({ left: false, right: false });
  const updateEdges = () => {
    const el = row.current;
    if (el) setEdges({ left: el.scrollLeft > 2, right: el.scrollWidth - el.clientWidth - el.scrollLeft > 2 });
  };
  useLayoutEffect(() => {
    updateEdges();
    const observer = new ResizeObserver(updateEdges);
    if (row.current) observer.observe(row.current);
    return () => observer.disconnect();
  }, [choices]);
  const finishDrag = () => {
    const current = drag.current;
    if (!current) return;
    suppressClick.current = current.moved;
    drag.current = null;
    if (row.current?.hasPointerCapture(current.id)) row.current.releasePointerCapture(current.id);
    row.current?.classList.remove('is-dragging');
  };
  return <div className="pulse-picker-frame" data-fade-left={edges.left} data-fade-right={edges.right}>
    <div ref={row} id={id} role="group" aria-label={label} className={'pulse-picker pulse-picker--' + kind}
      onScroll={updateEdges}
      onPointerDown={event => {
        if (event.pointerType !== 'mouse' || event.button !== 0) return;
        suppressClick.current = false;
        drag.current = { id: event.pointerId, x: event.clientX, left: event.currentTarget.scrollLeft, moved: false };
      }}
      onPointerMove={event => {
        const current = drag.current;
        if (!current) return;
        if (event.buttons !== 1) { finishDrag(); return; }
        const delta = event.clientX - current.x;
        if (!current.moved && Math.abs(delta) > 4) {
          current.moved = true;
          event.currentTarget.setPointerCapture(current.id);
          event.currentTarget.classList.add('is-dragging');
        }
        if (current.moved) { event.preventDefault(); event.currentTarget.scrollLeft = current.left - delta; }
      }}
      onPointerUp={finishDrag} onPointerCancel={finishDrag} onLostPointerCapture={finishDrag} onPointerLeave={() => { if (drag.current && !drag.current.moved) finishDrag(); }}
      onClickCapture={event => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } }}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const buttons = Array.from((event.currentTarget as HTMLDivElement).querySelectorAll<HTMLButtonElement>('button'));
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1)));
        event.preventDefault(); buttons[next]?.focus({ preventScroll: true }); buttons[next]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }}>
      {choices.map(choice => <button key={choice.value} type="button" aria-label={choice.label} aria-pressed={selected === choice.value} className="pulse-picker-card" onClick={() => onSelect(choice.value)}>
        <span>{choice.top}</span><strong>{choice.main}</strong>{choice.bottom && <span>{choice.bottom}</span>}
      </button>)}
    </div>
  </div>;
};
