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
  return <div className="mt-3 border-t border-neutral-800 pt-3" onClick={event => event.stopPropagation()}>
    <p role="status" className="text-sm leading-relaxed text-neutral-200">{uk ? `Сесія закінчилась о ${at}. Що було далі?` : `The session ended at ${at}. What happened next?`}</p>
    {manual && <p className="mt-1 text-xs leading-relaxed text-neutral-400">{uk ? 'Після сесії минуло понад 3 год. Можна вказати час роботи або залишити запис до завершення сесії.' : 'It has been over 3 hours since the session. You can enter your work time or keep the time recorded at its end.'}</p>}
    <div className="mt-2 flex flex-wrap gap-2">
      <button type="button" className={button} disabled={!manual && !onContinueAfterExpiry} onClick={() => manual ? onCorrect() : onContinueAfterExpiry?.(task.id)}>
        {manual ? (uk ? 'Вказати час' : 'Enter time') : (uk ? `Працював увесь час (+${minutes} хв)` : `Worked the whole time (+${minutes} min)`)}
      </button>
      <button type="button" className={button} disabled={!onFinishAfterExpiry} onClick={() => onFinishAfterExpiry?.(task.id, true)}>{uk ? 'Закінчив щойно' : 'Just finished'}</button>
      <button type="button" className={button} disabled={!onFinishAfterExpiry} onClick={() => onFinishAfterExpiry?.(task.id)}>{uk ? `Зупинився о ${at}` : `Stopped at ${at}`}</button>
    </div>
  </div>;
};
