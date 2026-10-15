const LEGACY_KEY = 'karkas_custom_api_key';
const SESSION_KEY = 'karkas_custom_api_key_session';

/** Desktop uses its secret bridge; browser keys last only for this tab's session. */
export function readWebApiKey(): string {
  if (typeof window === 'undefined') return '';
  if (window.karkasDesktop) {
    try { localStorage.removeItem(LEGACY_KEY); } catch { /* Native secrets remain authoritative. */ }
    return '';
  }
  let value = '';
  try { value = sessionStorage.getItem(SESSION_KEY) || ''; } catch { /* Session storage may be unavailable. */ }
  try {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (!value && legacy) {
      sessionStorage.setItem(SESSION_KEY, legacy);
      value = legacy;
    }
    localStorage.removeItem(LEGACY_KEY);
  } catch { /* A valid session key remains usable even when persistent storage is blocked. */ }
  return value;
}

export function storeWebApiKey(value: string): void {
  if (window.karkasDesktop) return;
  const key = value.trim();
  if (key) sessionStorage.setItem(SESSION_KEY, key);
  else sessionStorage.removeItem(SESSION_KEY);
  try { localStorage.removeItem(LEGACY_KEY); } catch { /* The saved session key is already usable. */ }
}
