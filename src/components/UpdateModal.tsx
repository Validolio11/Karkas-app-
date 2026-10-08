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

type UpdateAttempt = { requestId: string; phase: 'downloading' | 'installing'; cancelling: boolean; closeAfterCancellation: boolean };
type InstallStep = 'downloading' | 'cancelling' | 'starting' | 'installer-started' | 'browser-download';
type InstallFailure = 'unavailable' | 'cancel-failed' | 'download-timeout' | 'download-failed' | 'download-storage' | 'preparation-timeout' | 'install-failed';

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
  const [checkError, setCheckError] = useState<'failed' | 'timeout' | ''>('');
  const [isInstalling, setIsInstalling] = useState(false);
  const [isHandoff, setIsHandoff] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [installStep, setInstallStep] = useState<InstallStep | ''>('');
  const [totalMb, setTotalMb] = useState<number | null>(null);
  const [isCompleted, setIsCompleted] = useState(false);
  const [installError, setInstallError] = useState<InstallFailure | ''>('');
  const [installNotice, setInstallNotice] = useState<'cancelled' | 'unsaved-drafts' | ''>('');
  const installInFlight = useRef(false);
  const installHandedOff = useRef(false);
  const activeAttempt = useRef<UpdateAttempt | null>(null);
  const mounted = useRef(true);
  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;
  const checkInFlight = useRef(false);
  const refreshVersion = useRef(onCheckAgain);
  refreshVersion.current = onCheckAgain;
  useDialogKeyboard(isOpen, () => { void requestClose(); }, 'update-modal-card');

  function markInstallerHandoff(attempt: UpdateAttempt) {
    attempt.phase = 'installing';
    attempt.closeAfterCancellation = false;
    if (!mounted.current || activeAttempt.current !== attempt) return;
    setIsHandoff(true);
    setIsCancelling(false);
    setInstallStep('starting');
  }

  async function cancelDownload(closeAfterCancellation = false) {
    const attempt = activeAttempt.current;
    if (!attempt || attempt.phase === 'installing') return;
    attempt.closeAfterCancellation ||= closeAfterCancellation;
    if (attempt.cancelling) return;
    attempt.cancelling = true;
    setIsCancelling(true);
    setInstallError('');
    setInstallStep('cancelling');
    try {
      const result = await window.karkasDesktop!.updates.cancelDownload(attempt.requestId);
      if ('error' in result) throw new Error(result.error.message);
      if (result.value.phase === 'installing') markInstallerHandoff(attempt);
      // The original request settles after cleanup and owns the final UI state.
    } catch {
      attempt.closeAfterCancellation = false;
      if (mounted.current && activeAttempt.current === attempt) {
        setInstallError('cancel-failed');
        if (attempt.phase === 'downloading') setInstallStep('downloading');
      }
    } finally {
      attempt.cancelling = false;
      if (mounted.current && activeAttempt.current === attempt) setIsCancelling(false);
    }
  }

  async function requestClose() {
    if (installInFlight.current) {
      await cancelDownload(true);
      return;
    }
    sound.tick(300);
    onClose();
  }

  useEffect(() => {
    mounted.current = true;
    const desktop = window.karkasDesktop;
    const unsubscribe = desktop?.updates.onInstallStateChanged((state) => {
      const attempt = activeAttempt.current;
      if (attempt?.requestId === state.requestId && state.phase === 'installing') markInstallerHandoff(attempt);
    });
    return () => {
      mounted.current = false;
      unsubscribe?.();
      const attempt = activeAttempt.current;
      if (attempt?.phase === 'downloading') void desktop?.updates.cancelDownload(attempt.requestId).catch(() => {});
    };
  }, []);

  useEffect(() => {
    // Covers dismissal initiated outside the dialog as well as its own controls.
    if (!isOpen && activeAttempt.current?.phase === 'downloading') void cancelDownload();
  }, [isOpen]);

  useEffect(() => {
    if (isInstalling) document.getElementById('update-install-status')?.focus();
  }, [isInstalling]);

  // Background silent version analyzer
  useEffect(() => {
    if (!isOpen) {
      if (!installInFlight.current) {
        setIsInstalling(false);
        setIsHandoff(false);
        setIsCancelling(false);
        setIsCompleted(false);
        installHandedOff.current = false;
        setInstallError('');
        setInstallNotice('');
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
          setCheckError('failed');
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
        if (isMounted) setCheckError('failed');
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
        setCheckError('timeout');
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
  }, [isOpen, checkAttempt]);

  if (!isOpen) return null;

  const installSteps: Record<InstallStep, string> = {
    downloading: isUk ? 'Завантаження інсталяційного пакету…' : 'Downloading update package…',
    cancelling: isUk ? 'Скасовуємо завантаження…' : 'Cancelling download…',
    starting: isUk ? 'Запускаємо інсталятор. Скасування більше недоступне.' : 'Starting the installer. Cancellation is no longer available.',
    'installer-started': isUk ? 'Інсталятор запущено. Додаток закриється та відкриється після оновлення.' : 'Installer started. The app will close and reopen after the update.',
    'browser-download': isUk ? 'Завантаження передано браузеру. Відкрийте завантажений інсталятор для оновлення.' : 'Download requested in your browser. Open the downloaded installer to update.',
  };
  const installFailures: Record<InstallFailure, string> = {
    unavailable: isUk ? 'Інсталятор для Windows недоступний. Закрийте вікно та перевірте оновлення ще раз.' : 'The Windows installer is unavailable. Close this window and check again.',
    'cancel-failed': isUk ? 'Не вдалося скасувати завантаження. Спробуйте ще раз.' : 'Unable to cancel the download. Please try again.',
    'download-timeout': isUk ? 'Завантаження триває надто довго або зупинилося. Перевірте з’єднання та спробуйте ще раз.' : 'The download timed out or stopped responding. Check your connection and try again.',
    'download-failed': isUk ? 'Не вдалося завантажити пакет оновлення. Перевірте з’єднання та спробуйте ще раз.' : 'Unable to download the update package. Check your connection and try again.',
    'download-storage': isUk ? 'Не вдалося зберегти пакет оновлення. Перевірте вільне місце на диску й дозвіл на запис, потім повторіть спробу.' : 'Unable to save the update package. Check free disk space and write permissions, then try again.',
    'preparation-timeout': isUk ? 'Не вдалося вчасно підготувати додаток до оновлення. Спробуйте ще раз.' : 'The app could not prepare for the update in time. Please try again.',
    'install-failed': isUk ? 'Не вдалося запустити оновлення. Спробуйте ще раз.' : 'Unable to start the update. Please try again.',
  };
  const installNoticeText = installNotice === 'cancelled'
    ? (isUk ? 'Завантаження скасовано. Можна спробувати ще раз.' : 'Download cancelled. You can try again.')
    : installNotice === 'unsaved-drafts'
      ? (isUk ? 'Оновлення відкладено. Завершіть голосове введення та збережіть чернетки або скопіюйте текст перед повторною спробою.' : 'Update postponed. Finish voice input and save your drafts or copy the text before trying again.') : '';
  const checkErrorText = checkError === 'timeout'
    ? (isUk ? 'Перевірка триває надто довго. Перевірте з’єднання та спробуйте ще раз.' : 'The check timed out. Check your connection and try again.')
    : checkError ? (isUk ? 'Не вдалося перевірити оновлення. Перевірте з’єднання та спробуйте ще раз.' : 'Unable to check for updates. Check your connection and try again.') : '';

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
    : (checkErrorText || (isUk ? 'Не вдалося підтвердити доступну версію. Спробуйте перевірити ще раз.' : 'Unable to verify the available version. Please check again.'));

  const exeAsset = availability.installer;
  const fileName = exeAsset?.name || `Karkas-Setup-${versionTag}.exe`;

  const handleApproveAndInstall = async () => {
    if (installInFlight.current || installHandedOff.current || checkInFlight.current || !canInstall || isInstalling || isChecking) return;
    setInstallError('');
    setInstallNotice('');
    if (!exeAsset?.browser_download_url) {
      setInstallError('unavailable');
      return;
    }
    sound.tick(650);
    const attempt: UpdateAttempt = { requestId: crypto.randomUUID(), phase: 'downloading', cancelling: false, closeAfterCancellation: false };
    installInFlight.current = true;
    activeAttempt.current = attempt;
    setIsInstalling(true);
    setIsHandoff(false);
    setIsCancelling(false);
    setIsCompleted(false);
    setInstallStep('downloading');

    try {
      if (window.karkasDesktop) {
        const result = await window.karkasDesktop.updates.downloadAndInstall({ url: exeAsset.browser_download_url, fileName, requestId: attempt.requestId });
        if ('error' in result) throw Object.assign(new Error(result.error.message), { code: result.error.code });
        if (!mounted.current || activeAttempt.current !== attempt) return;
        markInstallerHandoff(attempt);
        setInstallStep('installer-started');
      } else {
        const anchor = document.createElement('a');
        anchor.href = exeAsset.browser_download_url;
        anchor.download = fileName;
        anchor.style.display = 'none';
        document.body.appendChild(anchor);
        try { anchor.click(); } finally { anchor.remove(); }
        setInstallStep('browser-download');
      }
      setIsCompleted(true);
      installHandedOff.current = true;
      sound.activate();
    } catch (err) {
      if (!mounted.current || activeAttempt.current !== attempt) return;
      const code = err && typeof err === 'object' && 'code' in err ? err.code : '';
      if (code === 'UPDATE_DOWNLOAD_CANCELLED') {
        setInstallNotice('cancelled');
      } else if (code === 'UPDATE_UNSAVED_DRAFTS') {
        setInstallNotice('unsaved-drafts');
      } else if (code === 'UPDATE_DOWNLOAD_TIMEOUT' || code === 'UPDATE_DOWNLOAD_STALLED') {
        setInstallError('download-timeout');
      } else if (code === 'UPDATE_DOWNLOAD_INTERRUPTED' || code === 'UPDATE_DOWNLOAD_FAILED' || code === 'UPDATE_DOWNLOAD_REDIRECT_LIMIT') {
        setInstallError('download-failed');
      } else if (code === 'UPDATE_DOWNLOAD_STORAGE') {
        setInstallError('download-storage');
      } else if (code === 'UPDATE_PREPARATION_TIMEOUT') {
        setInstallError('preparation-timeout');
      } else {
        setInstallError('install-failed');
      }
    } finally {
      if (activeAttempt.current === attempt) {
        activeAttempt.current = null;
        installInFlight.current = false;
        if (mounted.current) {
          setIsInstalling(false);
          setIsHandoff(false);
          setIsCancelling(false);
          if (attempt.closeAfterCancellation && !installHandedOff.current && isOpenRef.current) onClose();
        }
      }
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
          if (isInstalling && event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            void requestClose();
          }
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
          {!isHandoff && (
            <button
              id="update-modal-close-btn"
              aria-label={isInstalling ? (isUk ? 'Скасувати завантаження та закрити' : 'Cancel download and close') : (isUk ? 'Закрити оновлення' : 'Close update')}
              type="button"
              onClick={() => { void requestClose(); }}
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
              <span>{installStep ? installSteps[installStep] : ''}</span>
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

        {installError && <p role="alert" className="mb-4 text-xs text-red-400">{installFailures[installError]}</p>}
        {installNoticeText && <p role="status" aria-live="polite" className="mb-4 text-xs text-neutral-300">{installNoticeText}</p>}

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
                onClick={() => { void requestClose(); }}
                className="min-h-11 border border-neutral-800 px-3 py-2 text-xs text-neutral-400 hover:border-neutral-500 hover:text-white focus-visible:outline-2 focus-visible:outline-white"
              >
                {canInstall ? (isUk ? 'Пізніше' : 'Later') : (isUk ? 'Закрити' : 'Close')}
              </button>
            </>
          ) : isInstalling && !isHandoff ? (
            <button id="update-cancel-download-btn" type="button" disabled={isCancelling}
              onClick={() => { void cancelDownload(); }}
              className="min-h-11 border border-neutral-700 px-3 py-2 text-xs text-neutral-300 hover:border-white hover:text-white disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-white">
              {isCancelling ? (isUk ? 'Скасування…' : 'Cancelling…') : (isUk ? 'Скасувати завантаження' : 'Cancel download')}
            </button>
          ) : isCompleted ? (
            <button
              id="update-done-close-btn"
              type="button"
              onClick={() => { void requestClose(); }}
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
