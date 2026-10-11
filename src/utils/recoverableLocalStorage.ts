type JsonStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Preserve malformed source bytes before replacing them; failed backup blocks the write. */
export function writeRecoverableJson(storage: JsonStorage, key: string, serialized: string): void {
  // Caller mistakes must not replace usable saved data with invalid JSON.
  JSON.parse(serialized);
  const existing = storage.getItem(key);
  if (existing !== null) {
    let malformed = false;
    try { JSON.parse(existing); } catch { malformed = true; }
    if (malformed) {
      const prefix = `${key}:corrupt:${Date.now()}`;
      let backupKey = prefix;
      let suffix = 0;
      while (storage.getItem(backupKey) !== null) backupKey = `${prefix}:${++suffix}`;
      storage.setItem(backupKey, existing);
      // Some storage shims fail silently; never discard the original without a readable backup.
      if (storage.getItem(backupKey) !== existing) throw new Error('Cannot preserve the damaged workspace');
    }
  }
  storage.setItem(key, serialized);
}
