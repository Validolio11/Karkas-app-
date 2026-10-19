import type { AgentResponse, AgentView, AppliedAgentAction } from '../types';
import type { AgentAction, AgentWorkspace } from '../utils/aiAgentActions';
import { validateAgentAction } from '../utils/aiAgentActions';

export interface AgentClientClock { now: string; timeZone: string }
export interface AgentApplyOptions {
  messageId: string;
  ownerId: string | null;
  clientClock: AgentClientClock;
  confirmed?: boolean;
  view?: AgentView;
  isCurrent?: () => boolean;
}
export interface AgentApplyResult {
  applied: { uk: string; en: string }[];
  failed: { action: AgentAction; error: string }[];
  undoToken?: string;
}

/** Full persisted records are the replay workspace; compact context is only for prose. */
export function buildAgentWorkspaceRequest(workspace: AgentWorkspace, clientClock: AgentClientClock) {
  return { currentTasks: workspace.tasks, tabs: workspace.tabs, deletedTasks: workspace.deletedTasks, notes: workspace.notes, clientClock };
}

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const ids = (value: unknown): value is string[] => Array.isArray(value) && value.every(nonempty);
const validAction = (value: unknown): value is AgentAction => !('error' in validateAgentAction(value));
export const validAgentSummary = (value: unknown): value is { uk: string; en: string } => isObject(value) && nonempty(value.uk) && nonempty(value.en);

/** Validate executable fields before a server response reaches the live workspace. */
export function validateAgentResponse(value: unknown): value is AgentResponse {
  if (!isObject(value) || !Array.isArray(value.actions) || !Array.isArray(value.pendingConfirmations)) return false;
  if (!value.actions.every((entry: unknown) => isObject(entry) && validAction(entry.action)
    && validAgentSummary(entry.summary) && ids(entry.changedTaskIds)
    && (entry.createdIds === undefined || ids(entry.createdIds)))) return false;
  if (!value.pendingConfirmations.every(validAction)) return false;
  if (value.view !== undefined && (!validAction(value.view) || !['open_view', 'reveal_task'].includes(value.view.type))) return false;
  if (value.handoff !== undefined && value.handoff !== 'personal') return false;
  const clarification = value.clarification;
  return clarification === undefined || isObject(clarification) && nonempty(clarification.question)
    && Array.isArray(clarification.options) && clarification.options.every((option: unknown) => isObject(option) && nonempty(option.label) && nonempty(option.message));
}

interface AgentConfirmationMessage {
  role: 'user' | 'assistant';
  response?: { agent?: AgentResponse };
  agentConfirmationStatus?: Record<number, 'confirmed' | 'dismissed'>;
}

/** A bare assent can only address the one unresolved action in the latest assistant reply. */
export function singlePendingAgentConfirmation(text: string, latestAssistantMessage?: AgentConfirmationMessage | null): { action: AgentAction; index: number } | null {
  if (!/^(?:так|ок|yes|да|давай)[.!?,…]*$/iu.test(text.trim()) || latestAssistantMessage?.role !== 'assistant') return null;
  if (latestAssistantMessage.response?.agent?.pendingConfirmations.length !== 1) return null;
  const pending = latestAssistantMessage.response?.agent?.pendingConfirmations
    .map((action, index) => ({ action, index }))
    .filter(({ index }) => !latestAssistantMessage.agentConfirmationStatus?.[index]) ?? [];
  return pending.length === 1 ? pending[0] : null;
}

export function describeAgentConfirmation(action: AgentAction, workspace: AgentWorkspace, lang: 'uk' | 'en'): string {
  const task = 'taskId' in action ? [...workspace.tasks, ...workspace.deletedTasks].find(item => item.id === action.taskId) : undefined;
  const title = task?.title ?? ('taskId' in action ? action.taskId : '');
  const quote = (value: string) => lang === 'uk' ? '«' + value + '»' : '“' + value + '”';
  if (action.type === 'delete_task') return lang === 'uk' ? 'Видалити завдання ' + quote(title) + '?' : 'Delete task ' + quote(title) + '?';
  if (action.type === 'permanently_delete_task') return lang === 'uk' ? 'Назавжди видалити завдання ' + quote(title) + '?' : 'Permanently delete task ' + quote(title) + '?';
  if (action.type === 'reset_time') return lang === 'uk' ? 'Скинути записаний час завдання ' + quote(title) + '?' : 'Reset recorded time for task ' + quote(title) + '?';
  if (action.type === 'delete_tab') {
    const name = workspace.tabs.find(tab => tab.id === action.tabId)?.name ?? action.tabId;
    return lang === 'uk' ? 'Видалити вкладку ' + quote(name) + '? Завдання буде перенесено до іншої вкладки.' : 'Delete tab ' + quote(name) + '? Tasks will move to another tab.';
  }
  if (action.type === 'clear_completed') {
    const count = workspace.tasks.filter(item => item.done).length;
    return lang === 'uk' ? 'Перенести всі виконані завдання до історії (' + count + ')?' : 'Move all completed tasks to history (' + count + ')?';
  }
  if (action.type === 'delete_step') {
    const step = typeof action.step === 'number' ? task?.stepList?.[action.step - 1] : task?.stepList?.find(item => item.id === action.step || item.title === action.step);
    return lang === 'uk' ? 'Видалити крок ' + quote(step?.title ?? String(action.step)) + ' завдання ' + quote(title) + '?' : 'Delete step ' + quote(step?.title ?? String(action.step)) + ' from task ' + quote(title) + '?';
  }
  return lang === 'uk' ? 'Виконати дію ' + quote(action.type) + (title ? ' для завдання ' + quote(title) : '') + '?' : 'Perform action ' + quote(action.type) + (title ? ' for task ' + quote(title) : '') + '?';
}

export type { AppliedAgentAction };
