export const looksLikeGeminiApiKey = (value: string): boolean =>
  /^(?:AIza|AQ\.)[\w.-]{20,}$/.test(value.trim());

export const shouldVerifyAsApiKey = (value: string, awaitingApiKey: boolean): boolean =>
  awaitingApiKey || looksLikeGeminiApiKey(value);
