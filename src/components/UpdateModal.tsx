import React, { useState } from 'react';
import { RefreshCw, CheckCircle2, Download, ShieldCheck, Sparkles, X, Info, AlertTriangle, ExternalLink, FileDown } from 'lucide-react';
import { sound } from '../utils/audio';

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size?: number;
}

interface ReleaseData {
  tag_name: string;
  name?: string;
  html_url: string;
  body?: string;
  published_at?: string;
  assets?: ReleaseAsset[];
}

interface UpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
  lang: string;
  currentVersion: string;
}

function isNewerVersion(latest: string, current: string): boolean {
  const clean = (v: string) => v.replace(/^v/i, '').trim();
  const l = clean(latest).split('.').map((p) => parseInt(p, 10) || 0);
  const c = clean(current).split('.').map((p) => parseInt(p, 10) || 0);
  const maxLen = Math.max(l.length, c.length);
  for (let i = 0; i < maxLen; i++) {
    const lPart = l[i] ?? 0;
    const cPart = c[i] ?? 0;
    if (lPart > cPart) return true;
    if (lPart < cPart) return false;
  }
  return false;
}

function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} МБ`;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({
  isOpen,
  onClose,
  lang,
  currentVersion,
}) => {
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<'idle' | 'upToDate' | 'found' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [latestRelease, setLatestRelease] = useState<ReleaseData | null>(null);
  const [lastCheckTime, setLastCheckTime] = useState<string | null>(null);

  if (!isOpen) return null;

  const isUk = lang === 'uk';

  const handleCheckForUpdates = async () => {
    sound.tick(600);
    setChecking(true);
    setStatus('idle');
    setErrorMessage(null);

    try {
      let data: ReleaseData | null = null;

      // 1. Try internal server proxy first (avoids GitHub rate limits & CORS)
      try {
        const proxyRes = await fetch('/api/check-update');
        if (proxyRes.ok) {
          data = await proxyRes.json();
        }
      } catch {
        // Fallback to direct GitHub API if proxy not available (e.g. standalone client)
      }

      // 2. If proxy didn't succeed, fetch directly from GitHub repository with correct repo name
      if (!data) {
        const ghRes = await fetch('https://api.github.com/repos/Validolio11/Karkas-app-/releases/latest', {
          headers: {
            Accept: 'application/vnd.github.v3+json',
          },
        });

        if (!ghRes.ok) {
          if (ghRes.status === 404) {
            throw new Error(isUk ? 'Релізів ще не опубліковано на GitHub.' : 'No releases found on GitHub.');
          } else if (ghRes.status === 403) {
            throw new Error(isUk ? 'Перевищено ліміт запитів до GitHub. Спробуйте пізніше.' : 'GitHub rate limit exceeded. Try again later.');
          } else {
            throw new Error(`HTTP ${ghRes.status}: ${ghRes.statusText}`);
          }
        }
        data = await ghRes.json();
      }

      if (!data || !data.tag_name) {
        throw new Error(isUk ? 'Не вдалося отримати дані релізу.' : 'Failed to parse release data.');
      }

      setLatestRelease(data);
      const latestTag = data.tag_name;

      if (isNewerVersion(latestTag, currentVersion)) {
        setStatus('found');
      } else {
        setStatus('upToDate');
      }
    } catch (err: any) {
      console.error('Update check failed:', err);
      setStatus('error');
      setErrorMessage(err?.message || (isUk ? 'Не вдалося перевірити оновлення.' : 'Failed to check for updates.'));
    } finally {
      sound.activate();
      setChecking(false);
      const now = new Date();
      setLastCheckTime(
        now.toLocaleTimeString(isUk ? 'uk-UA' : 'en-US', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      );
    }
  };

  const exeAsset = latestRelease?.assets?.find((a) =>
    typeof a.name === 'string' && a.name.toLowerCase().endsWith('.exe')
  );

  return (
    <div id="update-modal-backdrop" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in app-no-drag">
      <div id="update-modal-card" className="relative w-full max-w-md bg-[#0c0c0e] border border-neutral-800 shadow-2xl p-5 font-mono text-neutral-200">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-neutral-800 mb-4">
          <div className="flex items-center gap-2">
            <RefreshCw className={`w-4 h-4 text-emerald-400 ${checking ? 'animate-spin' : ''}`} />
            <h3 className="text-xs font-extrabold uppercase tracking-widest text-white">
              {isUk ? 'Центр Оновлень System' : 'System Update Center'}
            </h3>
          </div>
          <button
            id="update-modal-close-btn"
            type="button"
            onClick={() => {
              sound.tick(300);
              onClose();
            }}
            className="text-neutral-500 hover:text-white p-1 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Current Version Box */}
        <div className="bg-neutral-900/80 border border-neutral-800/90 p-3.5 mb-4 flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase text-neutral-400 font-bold tracking-wider">
              {isUk ? 'Поточна версія додатку' : 'Current App Version'}
            </div>
            <div className="text-sm font-black text-white flex items-center gap-2 mt-0.5">
              <span>v{currentVersion}</span>
              <span className="text-[9px] px-1.5 py-0.2 bg-emerald-950 border border-emerald-500/40 text-emerald-400 uppercase tracking-widest font-bold">
                {isUk ? 'АКТИВНА' : 'ACTIVE'}
              </span>
            </div>
          </div>
          <ShieldCheck className="w-6 h-6 text-emerald-400/80" />
        </div>

        {/* Status / Output Display */}
        <div className="bg-[#050507] border border-neutral-800/80 p-4 mb-5 text-xs min-h-[95px] flex flex-col justify-center">
          {checking ? (
            <div className="flex items-center gap-3 text-neutral-300">
              <RefreshCw className="w-4 h-4 animate-spin text-amber-400 shrink-0" />
              <div>
                <p className="font-bold text-amber-300">{isUk ? 'Перевірка нових версій...' : 'Checking for updates...'}</p>
                <p className="text-[10px] text-neutral-500 mt-0.5">
                  {isUk ? 'Зʼєднання з GitHub репозиторієм Validolio11/Karkas-app-...' : 'Connecting to Validolio11/Karkas-app- on GitHub...'}
                </p>
              </div>
            </div>
          ) : status === 'found' && latestRelease ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <Download className="w-5 h-5 text-amber-400 shrink-0 mt-0.5 animate-bounce" />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <p className="font-bold text-amber-300">
                      {isUk ? `Доступна нова версія ${latestRelease.tag_name}!` : `New version available: ${latestRelease.tag_name}!`}
                    </p>
                    <span className="text-[9px] px-1.5 py-0.5 bg-amber-500/20 text-amber-400 border border-amber-500/40 uppercase font-bold">
                      {isUk ? 'Новий реліз' : 'New Release'}
                    </span>
                  </div>
                  <p className="text-[10px] text-neutral-400 mt-1 leading-relaxed">
                    {latestRelease.body?.trim()
                      ? latestRelease.body.slice(0, 160) + (latestRelease.body.length > 160 ? '...' : '')
                      : isUk
                      ? 'Опубліковано свіже оновлення системи KARKAS з виправленнями та покращеннями.'
                      : 'Fresh KARKAS system update with fixes and improvements.'}
                  </p>
                </div>
              </div>

              {/* Direct Installer Download Button if .exe asset exists */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {exeAsset ? (
                  <a
                    id="update-download-exe-btn"
                    href={exeAsset.browser_download_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-black font-extrabold text-[11px] uppercase transition-colors"
                  >
                    <FileDown className="w-3.5 h-3.5" />
                    <span>
                      {isUk
                        ? `Завантажити ${exeAsset.name} ${formatFileSize(exeAsset.size)}`
                        : `Download ${exeAsset.name} ${formatFileSize(exeAsset.size)}`}
                    </span>
                  </a>
                ) : null}

                <a
                  id="update-view-github-btn"
                  href={latestRelease.html_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-bold text-[10px] uppercase transition-colors border border-neutral-700"
                >
                  <ExternalLink className="w-3 h-3" />
                  <span>{isUk ? 'Сторінка релізу GitHub' : 'GitHub Release Page'}</span>
                </a>
              </div>
            </div>
          ) : status === 'upToDate' ? (
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-emerald-300">
                  {isUk ? 'У вас встановлено найновішу версію!' : 'You have the latest version installed!'}
                </p>
                <p className="text-[10px] text-neutral-400 mt-1 leading-relaxed">
                  {isUk
                    ? `Поточна версія v${currentVersion} повністю відповідає останньому стабільному релізу (${latestRelease?.tag_name || `v${currentVersion}`}).`
                    : `Current version v${currentVersion} matches the latest stable release (${latestRelease?.tag_name || `v${currentVersion}`}).`}
                </p>
                {lastCheckTime && (
                  <p className="text-[9px] text-neutral-500 mt-1.5">
                    {isUk ? 'Остання перевірка:' : 'Last checked:'} {lastCheckTime}
                  </p>
                )}
              </div>
            </div>
          ) : status === 'error' ? (
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-rose-300">
                  {isUk ? 'Помилка перевірки оновлень' : 'Update Check Failed'}
                </p>
                <p className="text-[10px] text-neutral-400 mt-1 leading-relaxed">
                  {errorMessage || (isUk ? 'Не вдалося звʼязатися з сервером релізів.' : 'Could not reach the releases server.')}
                </p>
                <button
                  type="button"
                  onClick={handleCheckForUpdates}
                  className="mt-2 text-[10px] text-amber-400 hover:underline inline-flex items-center gap-1 cursor-pointer font-bold"
                >
                  <RefreshCw className="w-2.5 h-2.5" />
                  <span>{isUk ? 'Спробувати знову' : 'Try again'}</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2.5 text-neutral-400">
              <Info className="w-4 h-4 text-neutral-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-[11px] leading-relaxed">
                  {isUk
                    ? 'Натисніть кнопку нижче, щоб перевірити наявність нових релізів системи KARKAS на GitHub.'
                    : 'Click the button below to check for new KARKAS system releases on GitHub.'}
                </p>
                {lastCheckTime && (
                  <p className="text-[9px] text-neutral-500 mt-1">
                    {isUk ? 'Остання перевірка:' : 'Last checked:'} {lastCheckTime}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* System Info Note */}
        <div className="flex items-center gap-1.5 text-[10px] text-neutral-500 mb-5">
          <Sparkles className="w-3 h-3 text-amber-400 shrink-0" />
          <span>
            {isUk
              ? 'Веб-версія оновлюється автоматично при перезавантаженні.'
              : 'Web version updates automatically on page reload.'}
          </span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button
            id="update-check-now-btn"
            type="button"
            onClick={handleCheckForUpdates}
            disabled={checking}
            className={`flex-1 py-2.5 px-3 border font-extrabold uppercase text-xs tracking-wider transition-all cursor-pointer flex items-center justify-center gap-2 ${
              checking
                ? 'border-neutral-800 bg-neutral-900 text-neutral-500'
                : 'border-white bg-white text-black hover:bg-neutral-200 active:scale-98'
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
            <span>
              {checking
                ? isUk
                  ? 'Шукаємо...'
                  : 'Checking...'
                : isUk
                ? 'Шукати оновлення'
                : 'Check for Updates'}
            </span>
          </button>

          <button
            id="update-close-btn"
            type="button"
            onClick={() => {
              sound.tick(300);
              onClose();
            }}
            className="py-2.5 px-4 border border-neutral-800 bg-neutral-900 hover:border-neutral-700 text-neutral-300 text-xs font-bold uppercase transition-all cursor-pointer"
          >
            {isUk ? 'Закрити' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
};
