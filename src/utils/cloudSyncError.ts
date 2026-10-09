export function getCloudSyncErrorMessage(error: unknown): string | null {
  if (typeof error === 'string') return error.trim() || null;
  if (error && typeof error === 'object') {
    const message = 'message' in error && typeof error.message === 'string' ? error.message.trim() : '';
    const code = 'code' in error && typeof error.code === 'string' ? error.code.trim() : '';
    if (message) return code && !message.includes(code) ? `${message} (${code})` : message;
    return code || null;
  }
  return null;
}

export function isFirestoreServiceDisabled(error: unknown): boolean {
  const message = getCloudSyncErrorMessage(error) || '';
  const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : '';
  // A generic permission-denied error can instead mean a rules or ownership problem.
  return /(?:^|\/)service[-_]disabled$/i.test(code)
    || /\bservice[-_]disabled\b/i.test(message)
    || /\bcloud\s+firestore\s+api\b[\s\S]*\b(?:has\s+not\s+been\s+used|is\s+disabled)\b/i.test(message)
    || /\bfirestore\.googleapis\.com\b[\s\S]*\b(?:has\s+not\s+been\s+used|disabled)\b/i.test(message);
}

export function isCloudBackupMissing(error: unknown): boolean {
  return /^no cloud backup exists\.?$/i.test(getCloudSyncErrorMessage(error) || '');
}
