// A model may need time to reason and return structured memory. Keep the client
// deadline above the whole server budget so it can receive the final response.
export const AI_CHAT_MODEL_TIMEOUT_MS = 60_000;
export const AI_CHAT_TOTAL_TIMEOUT_MS = 90_000;
export const AI_CHAT_CLIENT_TIMEOUT_MS = AI_CHAT_TOTAL_TIMEOUT_MS + 10_000;
