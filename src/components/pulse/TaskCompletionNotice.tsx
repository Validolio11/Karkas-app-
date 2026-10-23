import { useEffect, useRef, type CSSProperties } from 'react';
import { Check, X } from 'lucide-react';
import './taskCompletion.css';

interface Props {
  taskId: string;
  lang: 'uk' | 'en';
  onReopen: () => void;
  onDismiss: () => void;
  onRecordResult?: () => void;
  canUndo?: boolean;
}

/** A single short burst, with enough time to undo an accidental completion. */
export function TaskCompletionNotice({ taskId, lang, onReopen, onDismiss, onRecordResult, canUndo = true }: Props) {
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useEffect(() => {
    const timer = window.setTimeout(() => dismiss.current(), 8000);
    return () => window.clearTimeout(timer);
  }, [taskId]);
  return <div className="pulse-completion-notice">
    <div key={taskId} className="pulse-completion-burst" aria-hidden="true">
      {Array.from({ length: 16 }, (_, index) => <i key={index} style={{
        '--burst-x': `${Math.cos(index * Math.PI / 8) * (70 + index % 3 * 18)}px`,
        '--burst-y': `${Math.sin(index * Math.PI / 8) * 65 - 45}px`,
        '--burst-turn': `${index * 47}deg`,
        '--burst-color': index % 3 === 0 ? 'var(--pulse-paper)' : index % 3 === 1 ? 'var(--pulse-growth)' : 'var(--pulse-data)',
      } as CSSProperties} />)}
    </div>
    <span className="pulse-completion-check" aria-hidden="true"><Check size={21} strokeWidth={3} /></span>
    <span role="status">{lang === 'uk' ? 'Готово!' : 'Done!'}</span>
    {canUndo && <button type="button" onClick={onReopen}>{lang === 'uk' ? 'Скасувати' : 'Undo'}</button>}
    {onRecordResult && <button type="button" onClick={onRecordResult}>{lang === 'uk' ? 'Записати результат' : 'Record result'}</button>}
    <button type="button" className="pulse-completion-close" onClick={onDismiss} aria-label={lang === 'uk' ? 'Закрити' : 'Dismiss'}><X size={18} aria-hidden="true" /></button>
  </div>;
}
