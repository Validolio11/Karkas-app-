type Store = Pick<Storage, 'getItem' | 'setItem'>;
const KEY = 'karkas.guest-workspace-import.v1';

/** Reserve the first recipient before copying; failed saves can retry for that account only. */
export function claimGuestWorkspaceImport(storage: Store, ownerId: string): boolean {
  if (!ownerId) return false;
  const existing = storage.getItem(KEY);
  if (existing !== null) return existing === JSON.stringify({ ownerId });
  const claim = JSON.stringify({ ownerId });
  storage.setItem(KEY, claim);
  if (storage.getItem(KEY) !== claim) throw new Error('Guest import could not be recorded');
  return true;
}
