import { useCallback, useEffect, useRef, useState } from 'react';
import { accountStorageKey } from '../utils/accountStorage';

const AVATAR_KEY = 'karkas_account_avatar';
const IMAGE_DATA_URL = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

function readAvatar(userId: string | null): string | null {
  if (!userId || typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(accountStorageKey(AVATAR_KEY, userId));
    return value && IMAGE_DATA_URL.test(value) ? value : null;
  } catch {
    return null;
  }
}

/** A device-local image override, scoped to the signed-in account. */
export function useAccountAvatar(userId: string | null, photoURL?: string | null): readonly [string | null, (value: string | null) => void] {
  const owner = useRef(userId);
  owner.current = userId;
  const [saved, setSaved] = useState(() => ({ userId, value: readAvatar(userId) }));

  useEffect(() => {
    setSaved({ userId, value: readAvatar(userId) });
    if (!userId) return;
    const storageKey = accountStorageKey(AVATAR_KEY, userId);
    const refresh = (event: StorageEvent) => {
      if (event.storageArea === window.localStorage && (event.key === storageKey || event.key === null)) {
        setSaved({ userId, value: readAvatar(userId) });
      }
    };
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, [userId]);

  const setAvatarUrl = useCallback((value: string | null) => {
    if (!userId || owner.current !== userId) throw new Error('The account has changed.');
    if (value !== null && !IMAGE_DATA_URL.test(value)) throw new Error('Choose a PNG, JPEG or WebP image.');
    const key = accountStorageKey(AVATAR_KEY, userId);
    // Persist first: a failed write must not look like a saved profile change.
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
    setSaved({ userId, value });
  }, [userId]);

  // Avoid showing the preceding account's image during an auth transition.
  const localAvatar = saved.userId === userId ? saved.value : readAvatar(userId);
  return [userId ? localAvatar || photoURL || null : null, setAvatarUrl] as const;
}
