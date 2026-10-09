import { useEffect, useRef } from 'react';

/** Keep keyboard navigation inside an open dialog and restore its opener on close. */
export function useDialogKeyboard(isOpen: boolean, onClose: () => void, dialogId: string, returnFocusTo?: { current: HTMLElement | null }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!isOpen) return;
    const opener = returnFocusTo?.current || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const focusable = () => {
      const dialog = document.getElementById(dialogId);
      return Array.from(dialog?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex="0"]',
      ) || []).filter(element => element.getClientRects().length > 0);
    };
    const frame = requestAnimationFrame(() => {
      const dialog = document.getElementById(dialogId);
      // Respect existing autoFocus fields, including the desktop countdown input.
      if (!dialog?.contains(document.activeElement)) focusable()[0]?.focus();
    });
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
      } else if (event.key === 'Tab') {
        const elements = focusable();
        const first = elements[0];
        const last = elements.at(-1);
        if (!first || !last) return;
        const active = document.activeElement;
        if (!elements.includes(active as HTMLElement) || (event.shiftKey ? active === first : active === last)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKey);
      if (opener?.isConnected) opener.focus();
    };
  }, [isOpen, dialogId, returnFocusTo]);
}
