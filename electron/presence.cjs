const DEFAULT_LANGUAGE = 'uk';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validTaskReference(value) {
  return isRecord(value)
    && typeof value.taskId === 'string' && value.taskId.trim().length > 0 && value.taskId.length <= 128
    && typeof value.title === 'string' && value.title.length <= 60;
}

function validSeconds(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

// IPC data is copied into a small, known shape; malformed data clears presence.
function sanitizePresence(payload) {
  const fallback = { lang: DEFAULT_LANGUAGE };
  try {
    if (!isRecord(payload) || !['uk', 'en'].includes(payload.lang)) return fallback;
    const result = { lang: payload.lang };
    if (payload.active !== undefined) {
      const active = payload.active;
      if (!validTaskReference(active)
        || !['running', 'paused', 'expired'].includes(active.state)
        || !['countdown', 'stopwatch'].includes(active.mode)
        || !validSeconds(active.elapsedSeconds)
        || (active.totalSeconds !== undefined && !validSeconds(active.totalSeconds))
        || (active.remainingSeconds !== undefined && !validSeconds(active.remainingSeconds))) return fallback;
      result.active = {
        taskId: active.taskId, title: active.title, state: active.state, mode: active.mode,
        elapsedSeconds: active.elapsedSeconds,
        ...(active.totalSeconds !== undefined ? { totalSeconds: active.totalSeconds } : {}),
        ...(active.remainingSeconds !== undefined ? { remainingSeconds: active.remainingSeconds } : {}),
      };
    }
    if (payload.next !== undefined) {
      if (!validTaskReference(payload.next)) return fallback;
      result.next = { taskId: payload.next.taskId, title: payload.next.title };
    }
    return result;
  } catch {
    return fallback;
  }
}

function progressFor(presence) {
  const { active } = sanitizePresence(presence);
  if (!active) return { value: -1, mode: 'none' };
  if (active.mode !== 'countdown') return { value: -1, mode: 'none' };
  if (active.state === 'expired') return { value: 1, mode: 'error' };
  const value = active.totalSeconds > 0
    ? Math.min(1, Math.max(0, active.elapsedSeconds / active.totalSeconds))
    : 0;
  return { value, mode: active.state === 'paused' ? 'paused' : 'normal' };
}

function durationFor(seconds, lang, roundUp = false) {
  const minutes = roundUp ? Math.ceil(seconds / 60) : Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  const hourUnit = lang === 'uk' ? 'год' : 'h';
  const minuteUnit = lang === 'uk' ? 'хв' : 'min';
  return hours > 0
    ? `${hours} ${hourUnit}${remainder > 0 ? ` ${remainder} ${minuteUnit}` : ''}`
    : `${minutes} ${minuteUnit}`;
}

function activeStatus(active, lang) {
  const isUk = lang === 'uk';
  if (active.state === 'expired') return isUk ? 'сесію завершено' : 'session finished';
  const remaining = active.remainingSeconds
    ?? Math.max(0, (active.totalSeconds ?? active.elapsedSeconds) - active.elapsedSeconds);
  const time = active.mode === 'countdown'
    ? (isUk ? `залишилось ${durationFor(remaining, lang, true)}` : `${durationFor(remaining, lang, true)} left`)
    : (isUk ? `${durationFor(active.elapsedSeconds, lang)} у роботі` : `${durationFor(active.elapsedSeconds, lang)} in progress`);
  return active.state === 'paused' ? `${isUk ? 'на паузі' : 'paused'} · ${time}` : time;
}

function tooltipFor(presence) {
  const { lang, active, next } = sanitizePresence(presence);
  if (active) return `Karkas · ${active.title} · ${activeStatus(active, lang)}`;
  if (next) return `Karkas · ${lang === 'uk' ? 'Далі' : 'Next'}: ${next.title}`;
  return 'Karkas';
}

// Empty labels identify separators without importing Electron into these helpers.
function trayMenuModel(presence) {
  const { lang, active, next } = sanitizePresence(presence);
  const isUk = lang === 'uk';
  const items = [];
  if (active) {
    items.push(
      { label: `${active.title} · ${activeStatus(active, lang)}`, enabled: false },
      {
        label: active.state === 'running' ? (isUk ? 'Пауза' : 'Pause') : (isUk ? 'Продовжити' : 'Resume'),
        enabled: true, command: { type: 'toggle-timer', taskId: active.taskId },
      },
      { label: isUk ? 'Завершити' : 'Complete', enabled: true, command: { type: 'complete-task', taskId: active.taskId } },
      { label: '', enabled: false },
    );
  }
  if (next && active?.state !== 'running') {
    items.push({ label: `${isUk ? 'Почати' : 'Start'}: ${next.title}`, enabled: true, command: { type: 'start-task', taskId: next.taskId } });
  }
  items.push(
    { label: isUk ? 'Відкрити Karkas' : 'Open Karkas', enabled: true, command: 'open' },
    { label: isUk ? 'Нова задача' : 'New task', enabled: true, command: 'new-task' },
    { label: isUk ? 'Налаштування' : 'Settings', enabled: true, command: 'open-settings' },
    { label: '', enabled: false },
    { label: isUk ? 'Вийти' : 'Quit', enabled: true, command: 'quit' },
  );
  return items;
}

module.exports = { sanitizePresence, progressFor, tooltipFor, trayMenuModel };
