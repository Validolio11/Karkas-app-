import React, { useEffect, useState } from 'react';
import type { PSTask } from '../types';
import { MAX_OVERRUN_SECONDS, overrunGapSeconds } from '../utils/countdownOverrun';

export interface CountdownExpiryActions {
  onContinueAfterExpiry?: (id: string) => void;
  onFinishAfterExpiry?: (id: string, workedUntilNow?: boolean) => void;
}

export const CountdownExpiryNotice: React.FC<CountdownExpiryActions & {
  task: PSTask; lang: 'uk' | 'en'; onCorrect: () => void;
}> = ({ task, lang, onContinueAfterExpiry, onFinishAfterExpiry, onCorrect }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    refresh();
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [task.countdownExpiredAt]);
  if (task.done || !Number.isFinite(task.countdownExpiredAt)) return null;
  const uk = lang === 'uk', gap = overrunGapSeconds(task, now), minutes = Math.floor(gap / 60);
  const at = new Intl.DateTimeFormat(uk ? 'uk-UA' : 'en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(task.countdownExpiredAt);
  const manual = gap > MAX_OVERRUN_SECONDS;
  const button = 'min-h-11 px-3 py-1.5 border border-neutral-700 text-sm text-neutral-200 hover:border-white hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';
  return <div className="mt-3 border-t border-amber-900/60 pt-3" onClick={event => event.stopPropagation()}>
    <p role="status" className="text-sm leading-relaxed text-amber-200">{uk ? `Відлік закінчився о ${at} · минуло ${minutes} хв` : `Countdown ended at ${at} · ${minutes} min ago`}</p>
    {manual && <p className="mt-1 text-xs leading-relaxed text-neutral-400">{uk ? 'Минуло понад 3 год. Вкажіть фактичний час або напишіть ШІ «зарахуй …».' : 'More than 3 hours passed. Enter the actual time or ask AI to record it.'}</p>}
    <div className="mt-2 flex flex-wrap gap-2">
      <button type="button" className={button} disabled={!manual && !onContinueAfterExpiry} onClick={() => manual ? onCorrect() : onContinueAfterExpiry?.(task.id)}>
        {manual ? (uk ? 'Вказати час' : 'Enter time') : (uk ? `Ще працюю (+${minutes} хв)` : `Still working (+${minutes} min)`)}
      </button>
      <button type="button" className={button} disabled={!onFinishAfterExpiry} onClick={() => onFinishAfterExpiry?.(task.id, true)}>{uk ? 'Закінчив щойно' : 'Just finished'}</button>
      <button type="button" className={button} disabled={!onFinishAfterExpiry} onClick={() => onFinishAfterExpiry?.(task.id)}>{uk ? 'Не працював' : 'Was not working'}</button>
    </div>
  </div>;
};
