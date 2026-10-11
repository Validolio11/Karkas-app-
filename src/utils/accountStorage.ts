type AccountStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const accountStorageKey = (prefix: string, owner?: string | null) =>
  `${prefix}.v2:${owner == null ? 'guest' : `account:${encodeURIComponent(owner)}`}`;

// The old guest slot has no reliable ownership metadata. Never import it into an account named guest.
export const legacyAccountStorageKey = (prefix: string, owner?: string | null) =>
  owner === 'guest' ? null : `${prefix}:${owner || 'guest'}`;

export function readAccountStorage(storage: AccountStorage, prefix: string, owner?: string | null): string | null {
  const current = storage.getItem(accountStorageKey(prefix, owner));
  if (current !== null) return current;
  const legacy = legacyAccountStorageKey(prefix, owner);
  return legacy ? storage.getItem(legacy) : null;
}

export function writeAccountStorage(storage: AccountStorage, prefix: string, owner: string | null | undefined, value: string): void {
  storage.setItem(accountStorageKey(prefix, owner), value);
  const legacy = legacyAccountStorageKey(prefix, owner);
  if (legacy && storage.getItem(legacy) !== null) storage.removeItem(legacy);
}

export function removeAccountStorage(storage: AccountStorage, prefix: string, owner?: string | null): void {
  storage.removeItem(accountStorageKey(prefix, owner));
  const legacy = legacyAccountStorageKey(prefix, owner);
  if (legacy) storage.removeItem(legacy);
}
