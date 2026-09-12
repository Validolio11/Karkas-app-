import React, { useState, useEffect } from 'react';
import { Download, CheckCircle2, X, RefreshCw, HardDrive, Sparkles } from 'lucide-react';
import { sound } from '../utils/audio';
import { karkasApiFetch } from '../utils/desktopApi';

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

function normalizeVersion(version: string): number[] {
  const cleaned = String(version || '').trim().replace(/^v/i, '').split('-')[0];
  const parts = cleaned.split('.').map((part) => Number.parseInt(part, 10) || 0);

  while (parts.length < 3) {
    parts.push(0);
  }

  return parts.slice(0, 3);
}

function compareVersions(a: string, b: string): number {
  const left = normalizeVersion(a);
  const right = normalizeVersion(b);

  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }

  return 0;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({
  isOpen,
  onClose,
  lang,
  currentVersion,
}) => {
  const isUk = lang === 'uk';
  const [release, setRelease] = useState<ReleaseData | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [installStep, setInstallStep] = useState<string>('');
  const [totalMb, setTotalMb] = useState<number | null>(null);
  const [isCompleted, setIsCompleted] = useState(false);
  const [installError, setInstallError] = useState('');

  // Background silent version analyzer
  useEffect(() => {
    if (!isOpen) {
      setIsInstalling(false);
      setIsCompleted(false);
      setInstallError('');
      return;
    }

    let isMounted = true;
    setRelease(null);
    setTotalMb(null);
    setIsChecking(true);

    const fetchLatestSilently = async () => {
      try {
        const proxyRes = await karkasApiFetch('/api/check-update');
        if (proxyRes.ok) {
          const data = await proxyRes.json();
          if (isMounted && data && data.tag_name) {
            setRelease(data);
            const asset = data.assets?.find((a: any) => typeof a.name === 'string' && a.name.endsWith('.exe'));
            if (asset && asset.size) {
              setTotalMb(Number((asset.size / (1024 * 1024)).toFixed(1)));
            }
            setIsChecking(false);
            return;
          }
        }
      } catch {
        // Fallback to direct github query
      }

      // Desktop networking belongs to the main-process update service.
      if (window.karkasDesktop) {
        if (isMounted) setIsChecking(false);
        return;
      }

      try {
        const ghRes = await fetch('https://api.github.com/repos/Validolio11/Karkas-app-/releases/latest', {
          headers: { Accept: 'application/vnd.github.v3+json' },
        });
        if (ghRes.ok) {
          const data = await ghRes.json();
          if (isMounted && data && data.tag_name) {
            setRelease(data);
            const asset = data.assets?.find((a: any) => typeof a.name === 'string' && a.name.endsWith('.exe'));
            if (asset && asset.size) {
              setTotalMb(Number((asset.size / (1024 * 1024)).toFixed(1)));
            }
          }
        }
      } catch {
        // Silent fallback
      } finally {
        if (isMounted) setIsChecking(false);
      }
    };

    fetchLatestSilently();

    return () => {
      isMounted = false;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const versionTag = release?.tag_name || `v${currentVersion}`;
  const isNewVersionAvailable = release?.tag_name
    ? compareVersions(release.tag_name, currentVersion) > 0
    : false;

  const exeAsset = release?.assets?.find((a) =>
    typeof a.name === 'string' && a.name.toLowerCase().endsWith('.exe')
  );
  const fileName = exeAsset?.name || `Karkas-Setup-${versionTag}.exe`;

  const handleApproveAndInstall = async () => {
    if (isInstalling || isChecking) return;
    setInstallError('');
    if (!exeAsset?.browser_download_url) {
      setInstallError(isUk ? 'Інсталятор для Windows недоступний. Закрийте вікно та перевірте оновлення ще раз.' : 'The Windows installer is unavailable. Close this window and check again.');
      return;
    }
    sound.tick(650);
    setIsInstalling(true);
    setIsCompleted(false);
    setInstallStep(isUk ? 'Завантаження інсталяційного пакету...' : 'Downloading update package...');

    try {
      if (window.karkasDesktop) {
        const result = await window.karkasDesktop.updates.downloadAndInstall({ url: exeAsset.browser_download_url, fileName });
        if ('error' in result) throw new Error(result.error.message);
        setInstallStep(isUk ? 'Інсталятор запущено. Додаток закриється та відкриється після оновлення.' : 'Installer started. The app will close and reopen after the update.');
      } else {
        const anchor = document.createElement('a');
        anchor.href = exeAsset.browser_download_url;
        anchor.download = fileName;
        anchor.style.display = 'none';
        document.body.appendChild(anchor);
        try { anchor.click(); } finally { anchor.remove(); }
        setInstallStep(isUk ? 'Завантаження передано браузеру. Відкрийте завантажений інсталятор для оновлення.' : 'Download requested in your browser. Open the downloaded installer to update.');
      }
      setIsCompleted(true);
      sound.activate();
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : (isUk ? 'Не вдалося запустити оновлення. Спробуйте ще раз.' : 'Unable to start the update. Please try again.'));
    } finally {
      setIsInstalling(false);
    }
  };

  return (
    <div
      id="update-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-fade-in app-no-drag"
    >
      <div
        id="update-modal-card"
        className="relative w-full max-w-md bg-[#09090b] border border-neutral-800 shadow-2xl p-5 font-mono text-neutral-200 selection:bg-white selection:text-black"
      >
        {/* Top Header */}
        <div className="flex items-center justify-between pb-3 border-b border-neutral-800 mb-4">
          <div className="flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-emerald-400" />
            <h3 className="text-xs font-black uppercase tracking-widest text-white">
              {isUk ? 'Оновлення системи Karkas' : 'Karkas System Update'}
            </h3>
          </div>
          {!isInstalling && (
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
          )}
        </div>

        {/* Version Detection Status Card */}
        <div className="bg-neutral-900/90 border border-neutral-800 p-3 mb-4 flex items-center justify-between">
          <div>
            <div className="text-[10px] text-neutral-400 uppercase font-bold tracking-wider">
              {isUk ? 'Поточна версія' : 'Current Version'}
            </div>
            <div className="text-sm font-black text-white flex items-center gap-2 mt-0.5">
              <span>v{currentVersion}</span>
              {isNewVersionAvailable ? (
                <span className="text-[9px] px-1.5 py-0.5 bg-amber-950 border border-amber-500/40 text-amber-400 font-bold uppercase">
                  {isUk ? `Є НОВА ${versionTag}` : `NEW ${versionTag}`}
                </span>
              ) : (
                <span className="text-[9px] px-1.5 py-0.5 bg-emerald-950 border border-emerald-500/40 text-emerald-400 font-bold uppercase">
                  {isChecking ? (isUk ? 'ПЕРЕВІРКА...' : 'CHECKING...') : !release ? (isUk ? 'НЕ ПЕРЕВІРЕНО' : 'NOT CHECKED') : (isUk ? 'НАЙНОВІША ВЕРСІЯ' : 'UP TO DATE')}
                </span>
              )}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-neutral-500 uppercase font-bold">
              {isUk ? 'Розмір пакету' : 'Package Size'}
            </div>
            <div className="text-xs font-bold text-neutral-300 mt-0.5">
              {totalMb === null ? '—' : `${totalMb} MB`}
            </div>
          </div>
        </div>

        {/* The desktop bridge reports handoff, not installation completion. */}
        {isInstalling || isCompleted ? (
          <div role="status" aria-live="polite" className="bg-[#050507] border border-neutral-800/90 p-4 mb-4">
            <div className="flex items-center gap-2 text-xs font-bold text-neutral-300">
              {isCompleted ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              ) : (
                <RefreshCw className="w-4 h-4 shrink-0 text-amber-400 animate-spin" />
              )}
              <span>{installStep}</span>
            </div>
          </div>
        ) : (
          /* Confirmation Question Prompt */
          <div className="bg-[#0c0c10] border border-neutral-800 p-4 mb-4">
            <div className="flex items-start gap-3">
              <Sparkles className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <div className="text-xs font-bold text-white mb-1">
                  {isNewVersionAvailable
                    ? isUk
                      ? `Виявлено нову версію ${versionTag}. Встановити оновлення зараз?`
                      : `New version ${versionTag} detected. Install update now?`
                    : isUk
                    ? `Встановити або перевстановити версію ${versionTag}?`
                    : `Install or reinstall version ${versionTag}?`}
                </div>
                <p className="text-[11px] text-neutral-400 leading-relaxed">
                  {window.karkasDesktop
                    ? (isUk ? 'Додаток завантажить оновлення, закриється та відкриється після встановлення.' : 'The app will download the update, close, and reopen after installation.')
                    : (isUk ? 'Завантажте інсталятор та відкрийте його для оновлення додатка Windows.' : 'Download and open the installer to update the Windows app.')}
                </p>
              </div>
            </div>
          </div>
        )}

        {installError && <p role="alert" className="mb-4 text-xs text-red-400">{installError}</p>}

        {/* Action Controls */}
        <div className="flex items-center gap-3">
          {!isInstalling && !isCompleted ? (
            <>
              <button
                id="update-confirm-btn"
                type="button"
                onClick={handleApproveAndInstall}
                disabled={isChecking}
                className="flex-1 py-3 px-4 border border-white bg-white hover:bg-neutral-200 text-black font-black uppercase text-xs tracking-wider transition-all cursor-pointer flex items-center justify-center gap-2 shadow-md active:scale-98"
              >
                <Download className="w-4 h-4" />
                <span>{isChecking ? (isUk ? 'Перевірка...' : 'Checking...') : window.karkasDesktop ? (isUk ? 'Встановити зараз' : 'Install Now') : (isUk ? 'Завантажити' : 'Download')}</span>
              </button>
              <button
                id="update-cancel-btn"
                type="button"
                onClick={() => {
                  sound.tick(300);
                  onClose();
                }}
                className="py-3 px-4 border border-neutral-800 bg-neutral-900 hover:border-neutral-700 text-neutral-400 hover:text-white text-xs font-bold uppercase transition-all cursor-pointer"
              >
                {isUk ? 'Пізніше' : 'Later'}
              </button>
            </>
          ) : isCompleted ? (
            <button
              id="update-done-close-btn"
              type="button"
              onClick={() => {
                sound.tick(300);
                onClose();
              }}
              className="w-full py-3 px-4 border border-emerald-500 bg-emerald-500 hover:bg-emerald-400 text-black font-black uppercase text-xs tracking-wider transition-all cursor-pointer flex items-center justify-center gap-2 shadow-lg"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{isUk ? 'Готово' : 'Done'}</span>
            </button>
          ) : (
            <div className="w-full py-2.5 text-center text-xs text-neutral-400 font-mono flex items-center justify-center gap-2">
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400" />
              <span>
                {isUk
                  ? 'Підготовка оновлення, зачекайте...'
                  : 'Preparing the update, please wait...'}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
