// Keep slow or stalled model attempts bounded and reserve time for healthy alternatives.
// The client deadline also leaves time to receive the server's final response,
// so it must stay above the server total.
export const AI_CHAT_MODEL_TIMEOUT_MS = 15_000;
export const AI_CHAT_FALLBACK_TIMEOUT_MS = 10_000;
export const AI_CHAT_TOTAL_TIMEOUT_MS = 35_000;
export const AI_CHAT_CLIENT_TIMEOUT_MS = AI_CHAT_TOTAL_TIMEOUT_MS + 10_000;
// Quota-cheap models first: on the free tier Flash-Lite allows about 500 requests
// per day, Flash only about 20, so a fallback must not burn the scarce Flash quota.
// gemini-3.1-flash-lite is hidden in the selector once 3.5 Flash-Lite is listed
// (newest per family), yet remains a useful fallback with its own quota. Legacy
// gemini-2.x is not used: a new project can list it yet get 404. Static on purpose:
// update together with the selector rules in aiAssistantState.ts. The selected
// model still runs first, duplicates are removed and AI_CHAT_MAX_ATTEMPTS bounds
// the queue, so at most two of these run after it (all three when it is one of them).
export const AI_CHAT_FALLBACK_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'];
export const AI_CHAT_MAX_ATTEMPTS = 3;
// Streaming replies: AI_CHAT_MODEL_TIMEOUT_MS bounds time-to-first-chunk (the only
// window in which another model may be tried); after that, each gap between
// chunks is bounded separately while the total deadline still applies.
export const AI_CHAT_STREAM_IDLE_TIMEOUT_MS = 10_000;

// Default chat model when the person has not chosen one that is still offered.
// Tiers in priority order; within a tier the newest version wins. Flash-Lite comes
// first: on the free tier it allows ~500 requests per day against ~20 for Flash,
// which stays selectable as the higher-quality choice. Listed names that match no
// tier (Pro, unknown future families) keep the provider's order after every tier,
// so an unexpected list never leaves the selection empty.
export const AI_DEFAULT_MODEL_PREFERENCE: RegExp[] = [
  /^gemini-(?:[3-9]|\d{2,})(?:\.\d+)?-flash-lite$/,
  /^gemini-(?:[3-9]|\d{2,})(?:\.\d+)?-flash-lite-preview(?:-\d{2}-\d{4})?$/,
  /^gemini-flash-lite-latest$/,
  /^gemini-(?:[3-9]|\d{2,})(?:\.\d+)?-flash$/,
  /^gemini-(?:[3-9]|\d{2,})(?:\.\d+)?-flash-preview(?:-\d{2}-\d{4})?$/,
  /^gemini-flash-latest$/,
  /^gemini-2\.5-flash-lite$/,
  /^gemini-2\.5-flash$/,
];
