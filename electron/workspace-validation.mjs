// Shared by the renderer/cloud boundary and native storage. Invalid input is
// rejected as a whole so a subsequent save cannot silently drop damaged records.
export class InvalidWorkspaceError extends Error {
  /** @param {string} message @param {unknown} raw */
  constructor(message, raw) {
    super(message);
    this.name = 'InvalidWorkspaceError';
    this.raw = raw;
  }
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
/** @param {unknown} value @returns {value is number} */
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
/** @param {unknown} value @returns {value is number} */
const integer = value => number(value) && Number.isInteger(value);
/** @param {unknown} value @returns {value is string} */
const text = value => typeof value === 'string';
/** @param {unknown} value @returns {value is string} */
const id = value => text(value) && value.trim().length > 0 && value.length <= 512;
/** @param {Record<string, unknown>} value @param {string} key @param {(value: unknown) => boolean} check */
const optional = (value, key, check) => value[key] === undefined || check(value[key]);

/** @param {unknown} value */
function validDate(value) {
  if (!text(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const date = new Date(0);
  date.setUTCFullYear(year, month, 0);
  return day <= date.getUTCDate();
}

/** @param {unknown} value */
function validSchedule(value) {
  if (!object(value) || !text(value.startAt) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value.startAt) ||
      !Number.isFinite(Date.parse(value.startAt)) || !text(value.recurrence) || !['once', 'daily'].includes(value.recurrence) ||
      !text(value.timeZone) || !integer(value.leadMinutes) || value.leadMinutes > 1440) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: value.timeZone }).format(0); return true; }
  catch { return false; }
}

/** @param {unknown} value */
function validTaskActivity(value) {
  if (!object(value) || !id(value.id) || !number(value.at) || !text(value.kind) ||
      !['created', 'edited', 'rescheduled', 'started', 'paused', 'completed', 'reopened', 'progress', 'time_adjusted', 'attempt'].includes(value.kind) ||
      !optional(value, 'changeKey', v => text(v) && v.length <= 128) ||
      !optional(value, 'attemptSeconds', v => integer(v) && v <= 86400) ||
      !optional(value, 'attemptCapSeconds', v => integer(v) && v <= 86400) ||
      !optional(value, 'attemptOutcome', v => v === 'stopped' || v === 'cap_reached') ||
      !optional(value, 'attemptContinued', v => typeof v === 'boolean')) return false;
  for (const key of ['previousPlannedDate', 'plannedDate', 'previousDeadlineDate', 'deadlineDate']) {
    if (!optional(value, key, v => v === null || validDate(v))) return false;
  }
  for (const key of ['previousScheduledStartAt', 'scheduledStartAt']) {
    if (!optional(value, key, v => v === null || text(v) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v)))) return false;
  }
  return true;
}

/** @param {unknown} value */
export function isTaskLimitedStart(value) {
  if (!object(value) || Object.keys(value).some(key => !['id', 'capSeconds', 'startedAt', 'baseSeconds', 'continued', 'restore'].includes(key)) ||
      !id(value.id) || !integer(value.capSeconds) || value.capSeconds < 60 || value.capSeconds > 3600 ||
      !number(value.startedAt) || !integer(value.baseSeconds) || !optional(value, 'continued', v => typeof v === 'boolean') ||
      !object(value.restore)) return false;
  const restore = value.restore;
  return Object.keys(restore).every(key => ['timerMode', 'countdownDurationSeconds', 'countdownRemainingSeconds'].includes(key)) &&
    optional(restore, 'timerMode', v => text(v) && ['none', 'stopwatch', 'countdown'].includes(v)) &&
    optional(restore, 'countdownDurationSeconds', number) && optional(restore, 'countdownRemainingSeconds', number);
}

/** @param {unknown} value @param {boolean} deleted */
function validTask(value, deleted) {
  if (!object(value) || !id(value.id) || !text(value.title) || !id(value.phase) ||
      !number(value.priority) || ![1, 2, 3].includes(value.priority) || !integer(value.steps) ||
      !integer(value.currentStep) || value.currentStep > value.steps ||
      typeof value.done !== 'boolean' || typeof value.pinned !== 'boolean' || !number(value.createdAt)) return false;
  if (deleted && !number(value.deletedAt)) return false;
  if (!optional(value, 'updatedAt', number) || !optional(value, 'limitedStart', isTaskLimitedStart)) return false;
  if (value.activityTrail !== undefined) {
    if (!Array.isArray(value.activityTrail) || value.activityTrail.length > 64 || value.activityTrail.some(event => !validTaskActivity(event)) ||
        new Set(value.activityTrail.map(event => event.id)).size !== value.activityTrail.length) return false;
  }
  if (!optional(value, 'scheduledDurationSeconds', v => integer(v) && v >= 1 && v <= 86400)) return false;
  if (!optional(value, 'plannedDate', validDate) || !optional(value, 'deadlineDate', validDate)) return false;
  for (const key of ['note', 'timerStepId', 'timerSessionId', 'schedulePlanId', 'scheduleNextStartAt']) if (!optional(value, key, text)) return false;
  if (value.timeSessions !== undefined && (!object(value.timeSessions) || Object.entries(value.timeSessions).some(([key, session]) =>
    !id(key) || ['__proto__', 'constructor', 'prototype'].includes(key) || !object(session) || !number(session.seconds) || !optional(session, 'stepId', id)))) return false;
  for (const key of ['scheduledPending', 'timerRunning', 'autoPausedOverdue']) if (!optional(value, key, v => typeof v === 'boolean')) return false;
  for (const key of ['startedAt', 'completedAt', 'timeSpentSeconds', 'timeResetAt', 'plannedDurationSeconds', 'timerStartedAt',
    'countdownDurationSeconds', 'countdownRemainingSeconds', 'countdownExpiredAt', 'scheduledFor']) if (!optional(value, key, number)) return false;
  if (!optional(value, 'timerMode', v => text(v) && ['none', 'stopwatch', 'countdown'].includes(v)) ||
      !optional(value, 'schedule', validSchedule) ||
      !optional(value, 'deletionReason', v => text(v) && ['accidental', 'cancelled'].includes(v))) return false;
  if (value.stepList !== undefined) {
    if (!Array.isArray(value.stepList) || value.stepList.length > 10000) return false;
    const seen = new Set();
    for (const step of value.stepList) {
      if (!object(step) || !id(step.id) || seen.has(step.id) || !text(step.title) || typeof step.done !== 'boolean' ||
          !optional(step, 'timeSpentSeconds', number) || !optional(step, 'estimatedDurationSeconds', number)) return false;
      seen.add(step.id);
    }
  }
  return true;
}

/** @param {unknown} value @returns {Record<string, unknown>} */
export function parseWorkspace(value) {
  /** @param {string} message @returns {never} */
  const fail = message => { throw new InvalidWorkspaceError(message, value); };
  if (!object(value)) fail('Workspace must be an object');
  // Older category records used `label`; preserve their IDs and content.
  if (Array.isArray(value.tabs) && value.tabs.some(tab => object(tab) && tab.name === undefined && text(tab.label))) {
    return parseWorkspace({ ...value, tabs: value.tabs.map(tab => object(tab) && tab.name === undefined && text(tab.label) ? { ...tab, name: tab.label } : tab) });
  }
  for (const key of ['tasks', 'deletedTasks', 'tabs']) {
    if (!Array.isArray(value[key])) fail(`Workspace.${key} must be an array`);
    if (value[key].length > (key === 'tabs' ? 500 : 50000)) fail(`Workspace.${key} exceeds its limit`);
    const seen = new Set();
    for (const [index, entry] of value[key].entries()) {
      if (!(key === 'tabs' ? object(entry) && id(entry.id) && text(entry.name) && optional(entry, 'color', text) : validTask(entry, key === 'deletedTasks')) || seen.has(entry.id)) {
        if (key === 'tabs') {
          /** @param {string} field */
          const fieldType = field => !object(entry) ? 'unavailable' : entry[field] === null ? 'null' : Array.isArray(entry[field]) ? 'array' : typeof entry[field];
          fail(`Workspace.tabs contains an invalid or duplicate record (index=${index}, record=${entry === null ? 'null' : Array.isArray(entry) ? 'array' : typeof entry}, idType=${fieldType('id')}, idValid=${object(entry) && id(entry.id)}, nameType=${fieldType('name')}, labelType=${fieldType('label')}, titleType=${fieldType('title')}, colorType=${fieldType('color')}, duplicate=${object(entry) && seen.has(entry.id)})`);
        }
        fail(`Workspace.${key} contains an invalid or duplicate record`);
      }
      seen.add(entry.id);
    }
  }
  const settings = value.settings;
  if (!object(settings) || typeof settings.soundEnabled !== 'boolean' || typeof settings.fireEnabled !== 'boolean' ||
      !text(settings.lang) || !['uk', 'en'].includes(settings.lang) || !text(settings.aiIconVariant)) fail('Workspace settings are invalid');
  return value;
}
