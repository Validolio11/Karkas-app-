import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Minus, Plus, X } from 'lucide-react';
import type { PSTask } from '../types';
import type { Language } from '../utils/i18n';
import { getTaskRemainingSeconds, getTaskTimerMode, getTaskTotalSeconds } from '../utils/taskTimer';
import { useDialogKeyboard } from './useDialogKeyboard';

interface Props {
  task: PSTask;
  lang: Language;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  correctionOpen?: boolean;
  onClose: () => void;
  onExtend?: (id: string, seconds: number) => void;
  onConfigure?: (id: string, seconds: number) => void;
  onClear?: (id: string) => void;
  onCorrect?: (id: string, seconds: number) => void;
}
type Mode = 'add' | 'new' | 'work';
const whole = (value: string) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value));
const formatTime = (value: number) => {
  const seconds = Math.max(0, Math.floor(value));
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
};

export function TaskTimeDialog({ task, lang, triggerRef, correctionOpen, onClose, onExtend, onConfigure, onClear, onCorrect }: Props) {
  const uk = lang === 'uk';
  const [recordedBase] = useState(() => getTaskTotalSeconds(task));
  const countdown = getTaskTimerMode(task) === 'countdown' && getTaskRemainingSeconds(task) !== undefined;
  const modes: { mode: Mode; label: string; available: boolean }[] = [
    { mode: 'add', label: uk ? 'Додати час' : 'Add time', available: countdown && !task.done && !!onExtend },
    { mode: 'new', label: uk ? 'Новий відлік' : 'New countdown', available: !task.done && !!onConfigure },
    { mode: 'work', label: uk ? 'Облік часу' : 'Recorded time', available: !!onCorrect },
  ];
  const [mode, setMode] = useState<Mode>(correctionOpen || task.done ? 'work' : countdown && onExtend ? 'add' : onConfigure ? 'new' : 'work');
  const [extra, setExtra] = useState(String(Math.max(1, Math.min(15, Math.floor((86400 - (task.countdownDurationSeconds || 0)) / 60)))));
  const [duration, setDuration] = useState(String(Math.max(1, Math.round((task.countdownDurationSeconds || 1500) / 60))));
  const [minutes, setMinutes] = useState(String(Math.floor(recordedBase / 60)));
  const [seconds, setSeconds] = useState(String(recordedBase % 60));
  const submitted = useRef(false);
  const value = mode === 'add' ? extra : mode === 'new' ? duration : minutes;
  const setValue = mode === 'add' ? setExtra : mode === 'new' ? setDuration : setMinutes;
  const min = mode === 'work' ? 0 : 1;
  const max = mode === 'add' ? Math.max(0, Math.floor((86400 - (task.countdownDurationSeconds || 0)) / 60)) : mode === 'new' ? 1440 : Math.max(100000, Math.floor(recordedBase / 60));
  const rangeMax = Math.max(min, Math.min(max, mode === 'add' ? 120 : 180));
  const corrected = Number(minutes) * 60 + Number(seconds);
  const valid = modes.some(item => item.mode === mode && item.available) && whole(value) && Number(value) >= min && Number(value) <= max && (mode !== 'work' || whole(seconds) && Number(seconds) <= 59 && Number.isSafeInteger(corrected));
  const amount = whole(value) ? Number(value) : 0;
  const exactInputStyle = {
    '--time-input-width': `${Math.min(72, 32 + Math.max(0, value.length - 3) * 8)}px`,
    '--time-touch-input-width': `${Math.min(72, 36 + Math.max(0, value.length - 3) * 10)}px`,
  } as React.CSSProperties;
  const progress = Math.min(1, Math.max(0, (amount - min) / Math.max(1, rangeMax - min)));
  const readout = whole(value) ? mode === 'work' ? `${value.padStart(2, '0')}:${whole(seconds) ? seconds.padStart(2, '0') : '—'}` : value : '—';
  const help = mode === 'add'
    ? uk ? `Витрачений час збережеться. ${task.timerRunning && (getTaskRemainingSeconds(task) || 0) > 0 ? 'Таймер продовжить працювати.' : 'Таймер залишиться на паузі.'}` : `Recorded work is preserved. ${task.timerRunning && (getTaskRemainingSeconds(task) || 0) > 0 ? 'The timer keeps running.' : 'The timer remains paused.'}`
    : mode === 'new' ? uk ? 'Замінить залишок і запустить новий відлік. Витрачений час збережеться.' : 'Replaces remaining time and starts a new countdown. Recorded work is preserved.'
      : uk ? 'Залишок таймера не зміниться. Час, відпрацьований після відкриття вікна, також збережеться.' : 'Countdown remaining time is unchanged. Work recorded since opening this window is also preserved.';
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid || submitted.current) return;
    submitted.current = true;
    if (mode === 'add') onExtend?.(task.id, amount * 60);
    else if (mode === 'new') onConfigure?.(task.id, amount * 60);
    else {
      const adjustedTotal = Math.max(0, getTaskTotalSeconds(task) + corrected - recordedBase);
      if (!Number.isSafeInteger(adjustedTotal)) { submitted.current = false; return; }
      if (corrected !== recordedBase) onCorrect?.(task.id, adjustedTotal);
    }
    onClose();
  };
  const step = (delta: number) => setValue(String(Math.max(min, Math.min(max, (whole(value) ? amount : min) + delta))));
  useDialogKeyboard(true, onClose, `task-time-dialog-${task.id}`, triggerRef);
  return createPortal(
    <div className="task-time-overlay" onClick={event => event.stopPropagation()}>
      <form onSubmit={submit} id={`task-time-dialog-${task.id}`} role="dialog" aria-modal="true" aria-labelledby={`task-time-title-${task.id}`} className="task-time-dialog">
        <header><div><h4 id={`task-time-title-${task.id}`}>{uk ? 'Час завдання' : 'Task time'}</h4><p>{task.title}</p></div><button type="button" onClick={onClose} aria-label={uk ? 'Закрити' : 'Close'} className="task-time-close"><X /></button></header>
        <div className="task-time-modes" role="group" aria-label={uk ? 'Що змінити' : 'What to change'}>{modes.map(item => <button key={item.mode} type="button" disabled={!item.available} aria-pressed={mode === item.mode} onClick={() => setMode(item.mode)}>{item.label}</button>)}</div>
        <div className="task-time-main">
          <div className="task-time-dial" aria-hidden="true" style={{ '--time-angle': `${-135 + progress * 270}deg`, '--time-progress': `${progress * 75}%`, '--seconds-progress': `${(whole(seconds) ? Number(seconds) : 0) / 60 * 100}%` } as React.CSSProperties}>
            <div className="task-time-ticks" />{mode === 'work' && <div className="task-time-seconds-ring" />}<div className="task-time-arc" /><div className="task-time-knob"><div className="task-time-pointer" /><div className="task-time-readout"><strong style={{ fontSize: mode === 'work' ? readout.length > 7 ? 20 : readout.length > 6 ? 24 : 30 : readout.length > 3 ? 28 : 38 }}>{readout}</strong><span>{mode === 'work' ? uk ? 'ХВ : С' : 'MIN : S' : uk ? 'ХВИЛИН' : 'MINUTES'}</span></div></div>
          </div>
          <div className="task-time-controls">
            <div className="task-time-range-header"><label htmlFor={`time-minutes-${task.id}`}>{mode === 'add' ? uk ? 'Додаткові хвилини' : 'Additional minutes' : mode === 'new' ? uk ? 'Тривалість відліку' : 'Countdown duration' : uk ? 'Витрачений час · хвилини' : 'Recorded time · minutes'}</label><div className="task-time-steps"><button type="button" disabled={max < min || amount <= min} aria-label={uk ? 'Зменшити на хвилину' : 'Decrease by one minute'} onClick={() => step(-1)}><Minus /></button><input type="number" min={min} max={max} step="1" value={value} style={exactInputStyle} aria-label={uk ? 'Точне значення у хвилинах' : 'Exact minutes'} onChange={event => setValue(event.target.value)} /><button type="button" disabled={max < min || amount >= max} aria-label={uk ? 'Збільшити на хвилину' : 'Increase by one minute'} onClick={() => step(1)}><Plus /></button></div></div>
            <input id={`time-minutes-${task.id}`} className="task-time-range" type="range" min={min} max={rangeMax} step="1" disabled={max < min} value={Math.max(min, Math.min(rangeMax, amount))} onChange={event => setValue(event.target.value)} /><div className="task-time-range-ends"><span>{min} {uk ? 'хв' : 'min'}</span><span>{rangeMax} {uk ? 'хв' : 'min'}</span></div>
            {mode === 'work' && <div className="task-time-seconds-controls"><div className="task-time-range-header"><label htmlFor={`time-seconds-${task.id}`}>{uk ? 'Секунди' : 'Seconds'}</label><div className="task-time-steps"><button type="button" disabled={whole(seconds) && Number(seconds) <= 0} aria-label={uk ? 'Зменшити на секунду' : 'Decrease by one second'} onClick={() => setSeconds(String(Math.max(0, (whole(seconds) ? Number(seconds) : 0) - 1)))}><Minus /></button><input type="number" min="0" max="59" step="1" value={seconds} aria-label={uk ? 'Точне значення секунд' : 'Exact seconds'} onChange={event => setSeconds(event.target.value)} /><button type="button" disabled={whole(seconds) && Number(seconds) >= 59} aria-label={uk ? 'Збільшити на секунду' : 'Increase by one second'} onClick={() => setSeconds(String(Math.min(59, (whole(seconds) ? Number(seconds) : 0) + 1)))}><Plus /></button></div></div><input id={`time-seconds-${task.id}`} className="task-time-range" type="range" min="0" max="59" step="1" value={whole(seconds) ? Math.min(59, Number(seconds)) : 0} onChange={event => setSeconds(event.target.value)} /><div className="task-time-range-ends"><span>0 {uk ? 'с' : 's'}</span><span>59 {uk ? 'с' : 's'}</span></div></div>}
          </div>
        </div>
        {mode !== 'work' && <div className="task-time-result"><span>{mode === 'add' ? uk ? 'Залишиться' : 'Remaining time' : uk ? 'Новий відлік' : 'New countdown'}</span><strong>{valid ? formatTime((mode === 'add' ? getTaskRemainingSeconds(task) || 0 : 0) + amount * 60) : '—'}</strong></div>}
        <p className="task-time-help">{help}</p>
        {!valid && <p role="alert" className="task-time-error">{max < min ? uk ? 'Досягнуто максимальний бюджет 24 години.' : 'The maximum 24-hour budget has been reached.' : uk ? `Вкажіть ціле число від ${min} до ${max} хвилин${mode === 'work' ? ' і секунди від 0 до 59' : ''}.` : `Enter whole minutes from ${min} to ${max}${mode === 'work' ? ' and seconds from 0 to 59' : ''}.`}</p>}
        {mode === 'new' && countdown && !task.done && onClear && <details className="task-time-stopwatch"><summary>{uk ? 'Перейти на секундомір' : 'Switch to stopwatch'}</summary><p className="task-time-help">{uk ? 'Таймер зупиниться, залишок відліку буде прибрано. Витрачений час збережеться.' : 'The timer pauses and the countdown budget is removed. Recorded work is preserved.'}</p><button type="button" onClick={() => { if (submitted.current) return; submitted.current = true; onClear(task.id); onClose(); }}>{uk ? 'Перейти на секундомір' : 'Switch to stopwatch'}</button></details>}
        <footer><button type="button" onClick={onClose}>{uk ? 'Скасувати' : 'Cancel'}</button><button type="submit" disabled={!valid} className="task-time-apply">{mode === 'add' ? uk ? `Додати ${valid ? amount : '…'} хв` : `Add ${valid ? amount : '…'} min` : mode === 'new' ? uk ? 'Почати новий відлік' : 'Start new countdown' : uk ? 'Зберегти час' : 'Save time'}</button></footer>
      </form>
    </div>, document.body,
  );
}
