export interface PersistedAIChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const STORAGE_PREFIX = 'karkas_ai_chat_history:';
const MAX_MESSAGES = 200;

const storageKey = (accountId?: string | null) =>
  `${STORAGE_PREFIX}${accountId || 'guest'}`;

/** Load the last AI conversation for an account. */
export function loadAIChatHistory(accountId?: string | null): PersistedAIChatMessage[] {
  try {
    const raw = localStorage.getItem(storageKey(accountId));
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
      .slice(-MAX_MESSAGES);
  } catch {
    return [];
  }
}

/** Save the current AI conversation locally so it survives reloads and restarts. */
export function saveAIChatHistory(accountId: string | null | undefined, messages: PersistedAIChatMessage[]): void {
  try {
    localStorage.setItem(storageKey(accountId), JSON.stringify(messages.slice(-MAX_MESSAGES)));
  } catch {
    // Storage can be unavailable or full; the in-memory conversation still works.
  }
}

export function clearAIChatHistory(accountId?: string | null): void {
  try {
    localStorage.removeItem(storageKey(accountId));
  } catch {
    // Ignore storage errors.
  }
}
