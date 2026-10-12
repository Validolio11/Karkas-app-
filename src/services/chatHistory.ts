import type { AIResponse } from '../types';
import { readAIResponse } from '../components/aiAssistantState';
import { readAccountStorage, writeAccountStorage, removeAccountStorage } from '../utils/accountStorage';

export interface PersistedAIChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sentAt?: number;
  id?: string;
  response?: AIResponse;
  proposalStatus?: 'pending' | 'stale' | 'applied';
  actionId?: string;
  notice?: string;
  greeting?: boolean;
}

const STORAGE_PREFIX = 'karkas_ai_chat_history';
const MAX_MESSAGES = 200;

/** Load the last AI conversation for an account. */
export function loadAIChatHistory(accountId?: string | null): PersistedAIChatMessage[] {
  try {
    const raw = readAccountStorage(localStorage, STORAGE_PREFIX, accountId);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((message): message is PersistedAIChatMessage => (
        Boolean(message) &&
        typeof message === 'object' &&
        ((message as PersistedAIChatMessage).role === 'user' || (message as PersistedAIChatMessage).role === 'assistant') &&
        typeof (message as PersistedAIChatMessage).content === 'string'
      ))
      .map(message => {
        let response: AIResponse | undefined;
        try { if (message.response && message.role === 'assistant') response = readAIResponse(message.response, 'chat'); } catch { /* Preserve the conversation even if an old card is malformed. */ }
        const hasProposal = response && ([response.tasks, response.tabs, response.taskUpdates, response.taskDeletions, response.strategy?.actions].some(actions => (actions?.length || 0) > 0)
          || message.proposalStatus === 'pending' || message.proposalStatus === 'applied');
        return {
          role: message.role, content: message.content,
          ...(typeof message.sentAt === 'number' && Number.isFinite(message.sentAt) && message.sentAt > 0 && message.sentAt <= 8640000000000000 ? { sentAt: message.sentAt } : {}),
          ...(typeof message.id === 'string' ? { id: message.id } : {}),
          ...(response ? { response, ...(hasProposal ? { proposalStatus: message.proposalStatus === 'applied' ? 'applied' as const : 'stale' as const } : {}) } : {}),
          ...(typeof message.actionId === 'string' ? { actionId: message.actionId } : {}),
          ...(typeof message.notice === 'string' ? { notice: message.notice } : {}),
          ...(message.greeting === true ? { greeting: true } : {}),
        };
      })
      .slice(-MAX_MESSAGES);
  } catch {
    return [];
  }
}

/** Account-scoped one-time welcome, independent from account age and chat history. */
export function ensureAIChatWelcome(accountId: string | null | undefined, messages: PersistedAIChatMessage[], content: string, hasProfile: boolean): { messages: PersistedAIChatMessage[]; added: boolean } {
  const prefix = 'karkas_ai_chat_welcome';
  try {
    if (hasProfile || readAccountStorage(localStorage, prefix, accountId) === '1') return { messages, added: false };
    const next: PersistedAIChatMessage[] = [...messages, { id: `welcome-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, role: 'assistant', content, greeting: true }];
    // Commit the message before the marker, so a full storage cannot lose the greeting.
    writeAccountStorage(localStorage, STORAGE_PREFIX, accountId, JSON.stringify(next.slice(-MAX_MESSAGES)));
    writeAccountStorage(localStorage, prefix, accountId, '1');
    return { messages: next, added: true };
  } catch {
    if (hasProfile || messages.some(message => message.greeting)) return { messages, added: false };
    return { messages: [...messages, { id: `welcome-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, role: 'assistant', content, greeting: true }], added: true };
  }
}

/** Save the current AI conversation locally so it survives reloads and restarts. */
export function saveAIChatHistory(accountId: string | null | undefined, messages: PersistedAIChatMessage[]): void {
  try {
    writeAccountStorage(localStorage, STORAGE_PREFIX, accountId, JSON.stringify(messages.slice(-MAX_MESSAGES)));
  } catch {
    // Storage can be unavailable or full; the in-memory conversation still works.
  }
}

export function clearAIChatHistory(accountId?: string | null): void {
  try {
    removeAccountStorage(localStorage, STORAGE_PREFIX, accountId);
  } catch {
    // Ignore storage errors.
  }
}

/** Compact client-local send time, e.g. "[12.10 16:25]"; the server prompt explains the format. */
export function chatTimestampPrefix(sentAt: number): string {
  const date = new Date(sentAt);
  const two = (value: number) => String(value).padStart(2, '0');
  return `[${two(date.getDate())}.${two(date.getMonth() + 1)} ${two(date.getHours())}:${two(date.getMinutes())}]`;
}

/** A restarted introduction keeps old text visible but starts fresh provider context. */
export function recentAIChatContext(messages: PersistedAIChatMessage[], limit = 10, currentTurnId?: string): { role: 'user' | 'assistant'; content: string }[] {
  let start = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].greeting) { start = index; break; }
  }
  // A retried message is already sent as the current prompt, not a second
  // answer to the preceding question. Keep earlier identical text by its ID.
  return messages.slice(start).filter(message => !currentTurnId || message.id !== currentTurnId)
    .slice(-limit).map(({ role, content, sentAt }) => ({ role, content: typeof sentAt === 'number' && Number.isFinite(sentAt) && sentAt > 0 && sentAt <= 8640000000000000
      ? `${chatTimestampPrefix(sentAt)} ${content}` : content }));
}

export function visibleAIChatMessages(messages: PersistedAIChatMessage[], introductionId: string | null): { messages: PersistedAIChatMessage[]; previousCount: number } {
  const index = introductionId ? messages.findIndex(message => message.id === introductionId) : -1;
  return index > 0 ? { messages: messages.slice(index), previousCount: index } : { messages, previousCount: 0 };
}
