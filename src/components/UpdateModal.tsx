import React, { useState, useEffect, useRef } from 'react';
import { Download, CheckCircle2, X, RefreshCw, HardDrive } from 'lucide-react';
import { sound } from '../utils/audio';
import { karkasApiFetch } from '../utils/desktopApi';
import { useDialogKeyboard } from './useDialogKeyboard';
import { getUpdateAvailability, type UpdateRelease } from './updateModalState';

interface UpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
  lang: string;
  currentVersion: string;
  isVersionKnown?: boolean;
  onCheckAgain?: () => Promise<void>;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({
  isOpen,
  onClose,
  lang,
  currentVersion,
  isVersionKnown = true,
  onCheckAgain,
}) => {
  const isUk = lang === 'uk';
  const [release, setRelease] = useState<UpdateRelease | null>(null);
  const [isChecking, setIsChecking] = useState(true);
  const [checkAttempt, setCheckAttempt] = useState(0);
  const [checkError, setCheckError] = useState('');
  const [isInstalling, setIsInstalling] = useState(false);
  const [installStep, setInstallStep] = useState<string>('');
  const [totalMb, setTotalMb] = useState<number | null>(null);
  const [isCompleted, setIsCompleted] = useState(false);
  const [installError, setInstallError] = useState('');
  const installInFlight = useRef(false);
  const installHandedOff = useRef(false);
  const checkInFlight = useRef(false);
  const refreshVersion = useRef(onCheckAgain);
  refreshVersion.current = onCheckAgain;
  useDialogKeyboard(isOpen, () => { if (!installInFlight.current) onClose(); }, 'update-modal-card');

  useEffect(() => {
    if (isInstalling) document.getElementById('update-install-status')?.focus();
  }, [isInstalling]);

  // Background silent version analyzer
  useEffect(() => {
    if (!isOpen) {
      if (!installInFlight.current) {
        setIsInstalling(false);
        setIsCompleted(false);
        installHandedOff.current = false;
        setInstallError('');
      }
      return;
    }

    let isMounted = true;
    const controller = new AbortController();
    checkInFlight.current = true;
    setCheckError('');
    setInstallError('');
    setRelease(null);
    setTotalMb(null);
    setIsChecking(true);

    const fetchLatestSilently = async () => {
      try {
        if (checkAttempt > 0) await refreshVersion.current?.();
        if (controller.signal.aborted) return;
        const proxyRes = await karkasApiFetch('/api/check-update', { signal: controller.signal });
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
        if (isMounted) {
          setCheckError(isUk ? 'Не вдалося перевірити оновлення. Перевірте з’єднання та спробуйте ще раз.' : 'Unable to check for updates. Check your connection and try again.');
          setIsChecking(false);
        }
        return;
      }

      try {
        const ghRes = await fetch('https://api.github.com/repos/Validolio11/Karkas-app-/releases/latest', {
          headers: { Accept: 'application/vnd.github.v3+json' },
          signal: controller.signal,
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
          else throw new Error('Invalid release data');
        }
        else throw new Error('Update check failed');
      } catch {
        if (isMounted) setCheckError(isUk ? 'Не вдалося перевірити оновлення. Перевірте з’єднання та спробуйте ще раз.' : 'Unable to check for updates. Check your connection and try again.');
      } finally {
        if (isMounted) setIsChecking(false);
      }
    };

    const timeout = setTimeout(() => {
      controller.abort();
      if (isMounted) {
        isMounted = false;
        checkInFlight.current = false;
        setIsChecking(false);
        setCheckError(isUk ? 'Перевірка триває надто довго. Перевірте з’єднання та спробуйте ще раз.' : 'The check timed out. Check your connection and try again.');
      }
    }, 35000);
    fetchLatestSilently().finally(() => {
      clearTimeout(timeout);
      if (isMounted) checkInFlight.current = false;
    });

    return () => {
      isMounted = false;
      clearTimeout(timeout);
      controller.abort();
      checkInFlight.current = false;
    };
  }, [isOpen, checkAttempt, isUk]);

  if (!isOpen) return null;

  const versionTag = release?.tag_name || `v${currentVersion}`;
  const availability = getUpdateAvailability({ currentVersion, release, isVersionKnown, isChecking, checkError });
  const isNewVersionAvailable = availability.status === 'available' || availability.status === 'unavailable';
  const canInstall = availability.status === 'available' && !isCompleted;
  const isDesktop = typeof window !== 'undefined' && !!window.karkasDesktop;
  const statusText = availability.status === 'checking' ? (isUk ? 'Перевірка оновлень…' : 'Checking for updates…')
    : availability.status === 'unknown-version' ? (isChecking
      ? (isUk ? 'Уточнюємо встановлену версію…' : 'Checking the installed version…')
      : (isUk ? 'Не вдалося визначити встановлену версію. Спробуйте перевірити ще раз.' : 'Unable to identify the installed version. Please check again.'))
    : availability.status === 'current' ? (isUk ? 'У вас актуальна версія Karkas. Оновлення не потрібне.' : 'Karkas is up to date. No update is needed.')
    : availability.status === 'unavailable' ? (isUk ? `Версія ${versionTag} доступна, але інсталятор Windows ще не готовий. Перевірте пізніше.` : `Version ${versionTag} is available, but its Windows installer is not ready yet. Check again later.`)
    : availability.status === 'available' ? (isUk ? `Доступна нова версія ${versionTag}.` : `New version ${versionTag} is available.`)
    : (checkError || (isUk ? 'Не вдалося підтвердити доступну версію. Спробуйте перевірити ще раз.' : 'Unable to verify the available version. Please check again.'));

  const exeAsset = availability.installer;
  const fileName = exeAsset?.name || `Karkas-Setup-${versionTag}.exe`;

  const handleApproveAndInstall = async () => {
    if (installInFlight.current || installHandedOff.current || checkInFlight.current || !canInstall || isInstalling || isChecking) return;
    setInstallError('');
    if (!exeAsset?.browser_download_url) {
      setInstallError(isUk ? 'Інсталятор для Windows недоступний. Закрийте вікно та перевірте оновлення ще раз.' : 'The Windows installer is unavailable. Close this window and check again.');
      return;
    }
    sound.tick(650);
    installInFlight.current = true;
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
      installHandedOff.current = true;
      sound.activate();
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : (isUk ? 'Не вдалося запустити оновлення. Спробуйте ще раз.' : 'Unable to start the update. Please try again.'));
    } finally {
      installInFlight.current = false;
      setIsInstalling(false);
    }
  };

  return (
    <div
      id="update-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm app-no-drag"
    >
      <div
        id="update-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-modal-title"
        onKeyDown={(event) => {
          // The visible close control is unavailable during installer handoff.
          if (isInstalling && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); }
        }}
        className="relative w-full max-w-lg max-h-[90dvh] overflow-y-auto bg-[#0c0c0e] border border-neutral-800 shadow-2xl p-5 sm:p-6 font-sans text-neutral-100 selection:bg-white selection:text-black"
      >
        {/* Top Header */}
        <div className="flex items-center justify-between pb-3 border-b border-neutral-800 mb-4">
          <div className="flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-white" aria-hidden="true" />
            <h3 id="update-modal-title" className="text-xs font-bold uppercase tracking-wider text-neutral-200">
              {isUk ? 'Оновлення Karkas' : 'Karkas updates'}
            </h3>
          </div>
          {!isInstalling && (
            <button
              id="update-modal-close-btn"
              aria-label={isUk ? 'Закрити оновлення' : 'Close update'}
              type="button"
              onClick={() => {
                if (installInFlight.current) return;
                sound.tick(300);
                onClose();
              }}
              className="inline-flex min-h-11 min-w-11 items-center justify-center text-neutral-400 hover:text-white transition-colors focus-visible:outline-2 focus-visible:outline-white"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Version Detection Status Card */}
        <div className="border border-neutral-800 p-3 mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs text-neutral-400">
              {isUk ? 'Встановлено' : 'Installed'}
            </div>
            <div className="text-sm font-black text-white flex items-center gap-2 mt-0.5">
              <span>{isVersionKnown ? `v${currentVersion.replace(/^v/i, '')}` : '—'}</span>
              {isNewVersionAvailable ? (
                <span className="text-xs px-1.5 py-0.5 border border-neutral-700 text-neutral-300">
                  {isUk ? `Є НОВА ${versionTag}` : `NEW ${versionTag}`}
                </span>
              ) : availability.status === 'current' ? (
                <span className="text-xs px-1.5 py-0.5 border border-neutral-700 text-neutral-300">
                  {isUk ? 'Актуальна' : 'Up to date'}
                </span>
              ) : null}
            </div>
          </div>
          {canInstall && <div className="text-right">
            <div className="text-xs text-neutral-400">
              {isUk ? 'Розмір пакету' : 'Package Size'}
            </div>
            <div className="text-xs font-bold text-neutral-300 mt-0.5">
              {totalMb === null ? '—' : `${totalMb} MB`}
            </div>
          </div>}
        </div>

        {/* The desktop bridge reports handoff, not installation completion. */}
        {isInstalling || isCompleted ? (
          <div id="update-install-status" tabIndex={0} role="status" aria-live="polite" className="bg-[#050507] border border-neutral-800/90 p-4 mb-4 focus-visible:outline-2 focus-visible:outline-white">
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
          <div role={availability.status === 'check-error' ? 'alert' : 'status'} aria-live="polite" className="border border-neutral-800 p-4 mb-4">
            <div className="flex items-start gap-3">
              <div>
                <div className="text-xs font-bold text-white mb-1">
                  {statusText}
                </div>
                {canInstall && <p className="text-xs text-neutral-400 leading-relaxed">
                  {isDesktop
                    ? (isUk ? 'Додаток завантажить оновлення, закриється та відкриється після встановлення.' : 'The app will download the update, close, and reopen after installation.')
                    : (isUk ? 'Завантажте інсталятор та відкрийте його для оновлення додатка Windows.' : 'Download and open the installer to update the Windows app.')}
                </p>}
              </div>
            </div>
          </div>
        )}

        {installError && <p role="alert" className="mb-4 text-xs text-red-400">{installError}</p>}

        {/* Action Controls */}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-neutral-800 pt-3">
          {!isInstalling && !isCompleted ? (
            <>
              <button id="update-check-again-btn" type="button" disabled={isChecking}
                onClick={() => {
                  if (checkInFlight.current || installInFlight.current) return;
                  checkInFlight.current = true;
                  setIsChecking(true);
                  setCheckAttempt(attempt => attempt + 1);
                }}
                className="mr-auto inline-flex min-h-11 items-center gap-2 border border-neutral-700 px-3 py-2 text-xs text-neutral-300 hover:border-neutral-400 hover:text-white disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-white">
                <RefreshCw className={`h-3.5 w-3.5 ${isChecking ? 'animate-spin' : ''}`} aria-hidden="true" />
                {isChecking ? (isUk ? 'Перевірка…' : 'Checking…') : (isUk ? 'Перевірити ще раз' : 'Check again')}
              </button>
              {canInstall && <button
                id="update-confirm-btn"
                type="button"
                onClick={handleApproveAndInstall}
                className="inline-flex min-h-11 items-center justify-center gap-2 border border-white bg-white px-4 py-2 text-xs font-bold text-black hover:bg-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{isDesktop ? (isUk ? 'Встановити' : 'Install') : (isUk ? 'Завантажити' : 'Download')}</span>
              </button>}
              <button
                id="update-cancel-btn"
                type="button"
                onClick={() => {
                  if (installInFlight.current) return;
                  sound.tick(300);
                  onClose();
                }}
                className="min-h-11 border border-neutral-800 px-3 py-2 text-xs text-neutral-400 hover:border-neutral-500 hover:text-white focus-visible:outline-2 focus-visible:outline-white"
              >
                {canInstall ? (isUk ? 'Пізніше' : 'Later') : (isUk ? 'Закрити' : 'Close')}
              </button>
            </>
          ) : isCompleted ? (
            <button
              id="update-done-close-btn"
              type="button"
              onClick={() => {
                if (installInFlight.current) return;
                sound.tick(300);
                onClose();
              }}
              className="min-h-11 border border-white bg-white px-4 py-2 text-xs font-bold text-black hover:bg-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              <span>{isUk ? 'Закрити' : 'Close'}</span>
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
};
