import { useLayoutEffect, useRef } from 'react';

/** Fit only marked display text; ordinary copy and controls retain their normal size. */
export function useAutoFitText<T extends HTMLElement>() {
  const root = useRef<T>(null);
  useLayoutEffect(() => {
    const container = root.current;
    if (!container) return;
    const elements = Array.from(container.querySelectorAll<HTMLElement>('[data-fit-text]'));
    const context = document.createElement('canvas').getContext('2d');
    if (!context) return;
    let frame = 0;
    let disposed = false;
    const fit = () => {
      for (const element of elements) {
        // Reset to the stylesheet size so wider cards can grow their text again.
        element.style.removeProperty('font-size');
        const style = getComputedStyle(element);
        const available = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        if (available <= 0) continue;
        const maximum = parseFloat(style.fontSize);
        const minimum = Math.min(maximum, Number(element.dataset.fitText) || 16);
        let text = element instanceof HTMLInputElement ? element.value || element.placeholder : element.textContent || '';
        if (style.textTransform === 'uppercase') text = text.toLocaleUpperCase();
        else if (style.textTransform === 'lowercase') text = text.toLocaleLowerCase();
        context.font = `${style.fontStyle} ${style.fontWeight} ${maximum}px ${style.fontFamily}`;
        const spacing = parseFloat(style.letterSpacing) || 0;
        const width = context.measureText(text).width + Math.max(0, text.length - 1) * spacing;
        const size = width > available ? Math.max(minimum, maximum * available / width - .5) : maximum;
        element.style.fontSize = `${size}px`;
      }
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    };
    fit();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(container);
    for (const element of elements) observer?.observe(element);
    window.addEventListener('resize', schedule);
    void document.fonts?.ready.then(() => { if (!disposed) schedule(); });
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', schedule);
    };
  });
  return root;
}
