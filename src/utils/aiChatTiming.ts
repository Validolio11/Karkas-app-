// Give each distinct chat model a usable share of the bounded operation budget.
// A stalled primary must not consume the time reserved for both fallbacks.
// The client deadline also leaves time to receive the server's final response,
// so it must stay above the server total.
export const AI_CHAT_MODEL_TIMEOUT_MS = 15_000;
export const AI_CHAT_TOTAL_TIMEOUT_MS = 45_000;
export const AI_CHAT_CLIENT_TIMEOUT_MS = AI_CHAT_TOTAL_TIMEOUT_MS + 10_000;
// Current aliases precede legacy models, whose availability can depend on prior
// API usage. The selected model still runs first and duplicates are removed.
export const AI_CHAT_FALLBACK_MODELS = ['gemini-3.1-flash-lite', 'gemini-flash-latest', 'gemini-2.5-flash'];
export const AI_CHAT_MAX_ATTEMPTS = 3;
// Streaming replies: AI_CHAT_MODEL_TIMEOUT_MS bounds time-to-first-chunk (the only
// window in which another model may be tried); after that, each gap between
// chunks is bounded separately while the total deadline still applies.
export const AI_CHAT_STREAM_IDLE_TIMEOUT_MS = 10_000;
