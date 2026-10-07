import type { AIResponse, AITimerSettings, PSTask } from '../types';
import { getTaskRemainingSeconds, getTaskTimerMode, getTaskTotalSeconds } from '../utils/taskTimer';

export interface AIApplyResult {
  created: number; updated: number; deleted: number; tabs: number; rejected: number;
}

export function describeAIApplyResult(result: AIApplyResult, lang: 'uk' | 'en'): string {
  const parts: string[] = [];
  if (result.created) parts.push(lang === 'uk' ? `створено: ${result.created}` : `created: ${result.created}`);
  if (result.updated) parts.push(lang === 'uk' ? `оновлено: ${result.updated}` : `updated: ${result.updated}`);
  if (result.tabs) parts.push(lang === 'uk' ? `вкладок додано: ${result.tabs}` : `tabs added: ${result.tabs}`);
  if (result.deleted) parts.push(lang === 'uk' ? `видалено: ${result.deleted}` : `deleted: ${result.deleted}`);
  const applied = parts.length
    ? (lang === 'uk' ? `Зміни застосовано (${parts.join(', ')}).` : `Changes applied (${parts.join(', ')}).`)
    : (lang === 'uk' ? 'Зміни не застосовано.' : 'No changes were applied.');
  return result.rejected
    ? `${applied} ${lang === 'uk'
      ? `Не застосовано: ${result.rejected}. Дані завдання могли змінитися або параметри некоректні. Уточніть запит і спробуйте знову.`
      : `Not applied: ${result.rejected}. The task may have changed or its settings are invalid. Refine your request and retry.`}`
    : applied;
}

/** Every AI apply entry point uses this mapper so timer instructions survive review. */
export function prepareAITask(task: NonNullable<AIResponse['tasks']>[number], makeId: (index: number) => string) {
  const stepList = task.stepList?.map((step, index) => ({
    id: makeId(index),
    title: typeof step === 'string' ? step : step.title,
    done: false,
  }));
  return {
    title: task.title, phase: task.phase, priority: task.priority,
    steps: stepList?.length ?? task.steps ?? 0,
    stepList, note: task.note,
    timerMode: task.timerMode,
    countdownDurationSeconds: task.countdownDurationSeconds,
    timerAction: task.timerAction,
  };
}

export function describeAITimer(settings: AITimerSettings, lang: 'uk' | 'en'): string | null {
  const parts: string[] = [];
  const uk = lang === 'uk';
  if (settings.timerMode === 'none') parts.push(uk ? 'Без таймера' : 'No timer');
  else if (settings.timerMode === 'stopwatch') parts.push(uk ? 'Секундомір' : 'Stopwatch');
  else if (settings.timerMode === 'countdown' || settings.countdownDurationSeconds !== undefined) {
    const seconds = settings.countdownDurationSeconds;
    const duration = typeof seconds === 'number' && Number.isFinite(seconds)
      ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : null;
    parts.push(duration
      ? `${uk ? 'Таймер' : 'Countdown'} ${duration}`
      : (uk ? 'Таймер · поточна тривалість' : 'Countdown · current duration'));
  }
  if (settings.timerAction === 'start') parts.push(uk ? 'Запустити' : 'Start');
  if (settings.timerAction === 'pause') parts.push(uk ? 'Пауза · час зберігається' : 'Pause · time is preserved');
  if (settings.timerAction === 'stop') parts.push(uk ? 'Зупинити · час зберігається' : 'Stop · time is preserved');
  if (!settings.timerAction && parts.length && settings.timerMode !== 'none') {
    parts.push(uk ? 'Зберегти без запуску' : 'Save without starting');
  }
  return parts.length ? parts.join(' · ') : null;
}

export function getAITimerContext(task: PSTask, now = Date.now()) {
  return {
    timerMode: getTaskTimerMode(task),
    timerRunning: Boolean(task.timerRunning),
    timeSpentSeconds: getTaskTotalSeconds(task, now),
    countdownDurationSeconds: task.countdownDurationSeconds,
    countdownRemainingSeconds: getTaskRemainingSeconds(task, now),
  };
}
