type JsonStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Preserve semantically invalid JSON as well as syntax errors before recovery. */
export function preserveRawStorage(storage: JsonStorage, key: string, raw: string): void {
  const prefix = `${key}:recovery-backup`;
  let suffix = 0;
  while (true) {
    const backup = suffix ? `${prefix}:${suffix}` : prefix;
    const previous = storage.getItem(backup);
    if (previous === raw) return;
    if (previous === null) {
      storage.setItem(backup, raw);
      if (storage.getItem(backup) !== raw) throw new Error('Cannot preserve damaged data');
      return;
    }
    suffix++;
  }
}

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
