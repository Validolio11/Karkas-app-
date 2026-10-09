import type { DeletedTask, PSTask } from '../types';
import { getTaskSessionSeconds, getTaskTotalSeconds } from './taskTimer';
import { isCompletedArchivedTask, selectArchivedTasks } from './taskArchive';

export type InsightConfidence = 'insufficient' | 'low' | 'moderate';
export interface WorkInsights {
  coverage: { completed: number; measured: number; ratio: number; excludedAccidental: number; explanation: string };
  workload: { active: number; urgent: number; recentCompleted: number; observationDays: number; observedDailyPace: number | null; suggestedActiveLimit: number | null; confidence: InsightConfidence; explanation: string };
  queueForecast: { lowerDays: number; upperDays: number; earliestAt: number; latestAt: number; weeklyCompletions: number[]; confidence: InsightConfidence; explanation: string } | null;
  prioritySuggestions: { taskId: string; currentPriority: 1 | 2 | 3; suggestedPriority: 1 | 2 | 3; explanation: string }[];
  bottlenecks: { taskId: string; stepId?: string; title: string; recordedSeconds: number; estimatedSeconds: number; overrunSeconds: number; explanation: string }[];
  forecasts: { taskId: string; phase: string; sampleCount: number; measurementRatio: number; lowerSeconds: number; upperSeconds: number; recordedSeconds: number; remainingLowerSeconds: number | null; remainingUpperSeconds: number | null; confidence: InsightConfidence; explanation: string }[];
  workingPattern: { sampleCount: number; distinctDays: number; timeZone: string; observedHours: { hour: number; count: number }[]; confidence: InsightConfidence; explanation: string };
  reminderCandidates: { taskId: string; scheduledFor: number; explanation: string }[];
}

const DAY = 86400000;
const positive = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= Number.MAX_SAFE_INTEGER ? Math.floor(value) : null;
const timestamp = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 8640000000000000;
const taskRecord = (value: unknown): value is PSTask => Boolean(value && typeof value === 'object' && typeof (value as PSTask).id === 'string' && (value as PSTask).id.trim() && typeof (value as PSTask).title === 'string');
const priority = (task: PSTask) => task.priority === 1 || task.priority === 3 ? task.priority : 2;
function quantile(values: number[], fraction: number) {
  const position = (values.length - 1) * fraction;
  const lower = Math.floor(position);
  return Math.round(values[lower] + (values[Math.ceil(position)] - values[lower]) * (position - lower));
}

/** Observations and reviewable proposals only. Never modifies tasks or schedules notifications. */
export function buildWorkInsights(tasks: PSTask[], deletedTasks: DeletedTask[] = [], options: { now?: number; timeZone?: string; lang?: 'uk' | 'en' } = {}): WorkInsights {
  const live = new Map<string, PSTask>();
  for (const task of Array.isArray(tasks) ? tasks.filter(taskRecord) : []) if (!live.has(task.id)) live.set(task.id, task);
  tasks = Array.from(live.values());
  deletedTasks = Array.isArray(deletedTasks) ? deletedTasks.filter(taskRecord) as DeletedTask[] : [];
  const selectedArchive = selectArchivedTasks(tasks, deletedTasks);
  tasks = tasks.filter(task => (task as DeletedTask).deletionReason !== 'accidental' && !((task as DeletedTask).deletionReason === 'cancelled' && !task.done));
  const now = timestamp(options.now) ? options.now : Date.now();
  const uk = options.lang !== 'en';
  const say = (ukText: string, enText: string) => uk ? ukText : enText;
  let timeZone = options.timeZone || 'Europe/Kyiv';
  try { new Intl.DateTimeFormat('en-GB', { timeZone }).format(now); }
  catch { timeZone = 'UTC'; }
  const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const hourFormatter = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' });
  const byId = new Map<string, PSTask>();
  for (const task of tasks) if (task && !task.scheduledPending) byId.set(task.id, task);
  for (const task of selectedArchive) {
    if (isCompletedArchivedTask(task)) byId.set(task.id, task);
  }
  const completed = Array.from(byId.values()).filter(task => task.done);
  // Completed work must have explicitly recorded seconds; timestamps are calendar observations only.
  const measured = completed.filter(task => positive(task.timeSpentSeconds) !== null);
  const active = tasks.filter(task => !task.done && !task.scheduledPending && (!timestamp(task.scheduledFor) || task.scheduledFor <= now));
  const recentCompleted = completed.filter(task => timestamp(task.completedAt) && task.completedAt <= now && task.completedAt >= now - 28 * DAY);
  const distinctDates = new Set(recentCompleted.map(task => dateFormatter.format(task.completedAt!)));
  const paceKnown = recentCompleted.length >= 5 && distinctDates.size >= 3;
  const observedDailyPace = paceKnown ? recentCompleted.length / 28 : null;
  const suggestedActiveLimit = observedDailyPace === null ? null : Math.max(2, Math.min(6, Math.ceil(observedDailyPace * 3)));
  const coverage = {
    completed: completed.length, measured: measured.length, ratio: completed.length ? measured.length / completed.length : 0,
    excludedAccidental: selectedArchive.filter(task => task.deletionReason === 'accidental').length,
    explanation: say('Враховано лише записаний час завершених завдань. Відсутній або нульовий час не означає швидке виконання; випадкові й незавершені архівні записи виключено.', 'Only recorded time on completed tasks is used. Missing or zero time does not mean fast completion; accidental and unfinished archive entries are excluded.'),
  };
  const result: WorkInsights = {
    coverage,
    workload: {
      active: active.length, urgent: active.filter(task => task.priority === 1).length, recentCompleted: recentCompleted.length, observationDays: 28,
      observedDailyPace, suggestedActiveLimit, confidence: paceKnown ? 'low' : 'insufficient',
      explanation: paceKnown
        ? say('Ліміт активної черги — обережна пропозиція на основі кількості завершень за 28 днів, а не вимір вашої робочої місткості. Розклад і вільний час невідомі.', 'The active queue limit is a cautious suggestion based on completions over 28 days, not a measurement of working capacity. Availability and calendar capacity are unknown.')
        : say('Для оцінки темпу потрібно щонайменше 5 завершень у 3 різні дні за останні 28 днів. Поки пропозиції ліміту немає.', 'Pace needs at least 5 completions on 3 distinct days in the last 28 days. No queue limit is suggested yet.'),
    },
    queueForecast: null, prioritySuggestions: [], bottlenecks: [], forecasts: [],
    workingPattern: { sampleCount: 0, distinctDays: 0, timeZone, observedHours: [], confidence: 'insufficient', explanation: '' },
    reminderCandidates: [],
  };
  const weeklyCompletions = [0, 0, 0, 0];
  for (const task of recentCompleted) {
    const week = Math.min(3, Math.floor((now - task.completedAt!) / (7 * DAY)));
    weeklyCompletions[week]++;
  }
  // Zero-completion weeks make a finite upper bound unsupported, so no calendar forecast is shown.
  if (active.length && paceKnown && weeklyCompletions.every(count => count > 0)) {
    const lowerDays = Math.ceil(active.length * 7 / Math.max(...weeklyCompletions));
    const upperDays = Math.ceil(active.length * 7 / Math.min(...weeklyCompletions));
    result.queueForecast = { lowerDays, upperDays, earliestAt: now + lowerDays * DAY, latestAt: now + upperDays * DAY, weeklyCompletions,
      confidence: 'low', explanation: say('Орієнтовний календарний діапазон очищення поточної черги: кількість активних завдань поділено на найвищий і найнижчий тижневий темп за 4 повні тижні. Діє лише якщо черга, обсяг завдань і темп не зміняться; це не обіцянка дедлайну.', 'A rough calendar range to clear the current queue: active task count divided by the highest and lowest weekly completion rates over four full weeks. Valid only if the queue, task scope and pace remain unchanged; this is not a promised deadline.') };
  }
  if (suggestedActiveLimit !== null && active.length > suggestedActiveLimit && result.workload.urgent > 1) {
    const reviewable = active.filter(task => task.priority === 1 && !timestamp(task.scheduledFor) && !task.timerRunning && !timestamp(task.startedAt))
      .sort((a, b) => (timestamp(a.createdAt) ? a.createdAt : 0) - (timestamp(b.createdAt) ? b.createdAt : 0) || a.id.localeCompare(b.id));
    // Keep the oldest urgent item untouched; never revise scheduled or already started work.
    result.prioritySuggestions = reviewable.slice(1, 4).map(task => ({ taskId: task.id, currentPriority: task.priority, suggestedPriority: 2,
      explanation: say('Активна черга перевищує обережний орієнтир, і термінових завдань кілька. Розгляньте звичайний пріоритет для цього ще не розпочатого завдання; зміна потребує вашого рішення.', 'The active queue exceeds a cautious guideline and several tasks are urgent. Consider normal priority for this unstarted task; the decision remains yours.') }));
  }
  for (const task of byId.values()) {
    const recorded = positive(task.done ? task.timeSpentSeconds : getTaskTotalSeconds(task, now));
    const estimated = positive(task.plannedDurationSeconds);
    if (recorded && estimated && recorded > estimated * 1.25 && recorded - estimated >= 60) result.bottlenecks.push({ taskId: task.id, title: task.title, recordedSeconds: recorded, estimatedSeconds: estimated, overrunSeconds: recorded - estimated,
      explanation: say('Записаний час перевищує початкову явну оцінку. Це сигнал переглянути обсяг або оцінку, а не висновок про вашу продуктивність.', 'Recorded time exceeds the initial explicit estimate. Review scope or the estimate; this is not a judgment of productivity.') });
    const steps = Array.isArray(task.stepList) ? task.stepList : [];
    const stepIdCounts = new Map<string, number>();
    for (const step of steps) if (step && typeof step.id === 'string' && step.id.trim()) stepIdCounts.set(step.id, (stepIdCounts.get(step.id) || 0) + 1);
    for (const step of steps) {
      if (!step || typeof step !== 'object' || typeof step.title !== 'string' || typeof step.id !== 'string' || stepIdCounts.get(step.id) !== 1) continue;
      const seconds = positive((positive(step.timeSpentSeconds) || 0) + (!task.done && task.timerStepId === step.id ? getTaskSessionSeconds(task, now) : 0));
      const estimate = positive(step.estimatedDurationSeconds);
      if (seconds && estimate && seconds > estimate * 1.25 && seconds - estimate >= 60) result.bottlenecks.push({ taskId: task.id, stepId: step.id, title: step.title, recordedSeconds: seconds, estimatedSeconds: estimate, overrunSeconds: seconds - estimate,
        explanation: say('Виміряний час підзавдання перевищив вашу явну оцінку. Історичний час завдання не розподілявся між підзавданнями.', 'Measured subtask time exceeds your explicit estimate. Historical task time was not distributed among subtasks.') });
    }
  }
  result.bottlenecks.sort((a, b) => b.overrunSeconds - a.overrunSeconds || a.taskId.localeCompare(b.taskId) || (a.stepId || '').localeCompare(b.stepId || ''));
  const phaseSamples = new Map<string, number[]>();
  const phaseCompleted = new Map<string, number>();
  for (const task of completed) if (typeof task.phase === 'string' && task.phase) phaseCompleted.set(task.phase, (phaseCompleted.get(task.phase) || 0) + 1);
  for (const task of measured) {
    if (typeof task.phase !== 'string' || !task.phase) continue;
    const samples = phaseSamples.get(task.phase) || [];
    samples.push(positive(task.timeSpentSeconds)!);
    phaseSamples.set(task.phase, samples);
  }
  for (const samples of phaseSamples.values()) samples.sort((a, b) => a - b);
  for (const task of active) {
    const samples = phaseSamples.get(task.phase);
    if (!samples || samples.length < 3) continue;
    const lowerSeconds = quantile(samples, .25);
    const upperSeconds = Math.max(lowerSeconds, quantile(samples, .75));
    if (task.timeSpentSeconds !== undefined && (typeof task.timeSpentSeconds !== 'number' || !Number.isFinite(task.timeSpentSeconds) || task.timeSpentSeconds < 0 || task.timeSpentSeconds > Number.MAX_SAFE_INTEGER)) continue;
    const recordedSeconds = getTaskTotalSeconds(task, now);
    if (!Number.isSafeInteger(recordedSeconds) || recordedSeconds < 0) continue;
    const measurementRatio = samples.length / (phaseCompleted.get(task.phase) || samples.length);
    const overrun = recordedSeconds >= upperSeconds;
    result.forecasts.push({ taskId: task.id, phase: task.phase, sampleCount: samples.length, measurementRatio, lowerSeconds, upperSeconds, recordedSeconds,
      remainingLowerSeconds: overrun ? null : Math.max(0, lowerSeconds - recordedSeconds),
      remainingUpperSeconds: overrun ? null : Math.max(0, upperSeconds - recordedSeconds),
      confidence: samples.length >= 8 && measurementRatio >= .6 ? 'moderate' : 'low',
      explanation: overrun
        ? say('Записаний час уже досяг верхньої межі спостережуваного діапазону. Надійно оцінити залишок неможливо; перегляньте обсяг роботи.', 'Recorded work has reached the upper end of the observed range. Remaining effort cannot be estimated reliably; review the remaining scope.')
        : say('Діапазон — середні 50% записаного часу завершених завдань у цій категорії. Різний обсяг і неповний облік знижують точність; це орієнтир зусиль, не дата завершення.', 'The range is the middle 50% of recorded time on completed tasks in this category. Scope differences and incomplete tracking reduce accuracy; this is an effort guideline, not a completion date.') });
  }
  // Calendar timestamps describe observed starts/completions, never uninterrupted effort or mental state.
  const observations = completed.map(task => timestamp(task.startedAt) ? task.startedAt : task.completedAt)
    .filter((value): value is number => timestamp(value) && value <= now && value >= now - 28 * DAY);
  const hours = new Map<number, number>();
  for (const value of observations) { const hour = Number(hourFormatter.format(value)); hours.set(hour, (hours.get(hour) || 0) + 1); }
  const days = new Set(observations.map(value => dateFormatter.format(value))).size;
  result.workingPattern = { sampleCount: observations.length, distinctDays: days, timeZone,
    observedHours: observations.length >= 5 && days >= 3 ? Array.from(hours, ([hour, count]) => ({ hour, count })).sort((a, b) => b.count - a.count || a.hour - b.hour).slice(0, 3) : [],
    confidence: observations.length >= 5 && days >= 3 ? 'low' : 'insufficient',
    explanation: say('Показано години зафіксованого першого початку роботи (або завершення, якщо початок невідомий) за 28 днів. Це не вимір фокусу, енергії чи безперервної роботи.', 'Hours reflect recorded first starts (or completions when starts are unknown) over 28 days. They do not measure focus, energy or uninterrupted work.') };
  const timerActive = tasks.some(task => !task.done && !task.scheduledPending && task.timerRunning);
  const currentHour = Number(hourFormatter.format(now));
  const learnedHour = result.workingPattern.confidence !== 'insufficient' && result.workingPattern.observedHours.some(item => item.hour === currentHour);
  if (!timerActive && learnedHour) result.reminderCandidates = active.filter(task => timestamp(task.scheduledFor) && now - task.scheduledFor >= 5 * 60000 && now - task.scheduledFor <= 2 * 3600000 && !timestamp(task.startedAt))
    .sort((a, b) => priority(a) - priority(b) || a.scheduledFor! - b.scheduledFor!).slice(0, 3)
    .map(task => ({ taskId: task.id, scheduledFor: task.scheduledFor!, explanation: say('Запланований початок уже минув, роботу ще не розпочато й активного таймера немає.', 'The scheduled start has passed, work has not started and no timer is running.') }));
  return result;
}
