import { isNewerAppVersion, isValidAppVersion } from '../utils/appVersion';

export interface UpdateReleaseAsset { name: string; browser_download_url: string; size?: number }
export interface UpdateRelease {
  tag_name: string;
  name?: string;
  html_url?: string;
  body?: string;
  published_at?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: UpdateReleaseAsset[];
}
export type UpdateAvailability = 'unknown-version' | 'checking' | 'check-error' | 'current' | 'unavailable' | 'available';

/** Only a checked, newer Windows release may reach the installer action. */
export function getUpdateAvailability({ currentVersion, release, isVersionKnown = true, isChecking = false, checkError = '' }: {
  currentVersion: string;
  release: UpdateRelease | null;
  isVersionKnown?: boolean;
  isChecking?: boolean;
  checkError?: string;
}): { status: UpdateAvailability; installer?: UpdateReleaseAsset } {
  if (!isVersionKnown || !isValidAppVersion(currentVersion)) return { status: 'unknown-version' };
  if (isChecking) return { status: 'checking' };
  if (checkError || !release || !isValidAppVersion(release.tag_name) || release.draft || release.prerelease) return { status: 'check-error' };
  if (!isNewerAppVersion(release.tag_name, currentVersion)) return { status: 'current' };
  const expectedName = `Karkas-Setup-${release.tag_name.replace(/^v/i, '')}.exe`;
  const installer = Array.isArray(release.assets) ? release.assets.find(asset => {
    if (!asset || asset.name !== expectedName || typeof asset.browser_download_url !== 'string') return false;
    try {
      const url = new URL(asset.browser_download_url);
      return url.protocol === 'https:' && decodeURIComponent(url.pathname.split('/').pop() || '') === expectedName;
    } catch { return false; }
  }) : undefined;
  return installer ? { status: 'available', installer } : { status: 'unavailable' };
}
