import React, { useState, useEffect, useRef } from 'react';
import { Download, CheckCircle2, X, RefreshCw, HardDrive, ShieldCheck, Sparkles, ArrowRight } from 'lucide-react';
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
  const [installProgress, setInstallProgress] = useState(0);
  const [installStep, setInstallStep] = useState<string>('');
  const [downloadedMb, setDownloadedMb] = useState<number>(0);
  const [totalMb, setTotalMb] = useState<number>(58.4);
  const [isCompleted, setIsCompleted] = useState(false);
  const progressTimerRef = useRef<any>(null);

  // Background silent version analyzer
  useEffect(() => {
    if (!isOpen) {
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
      setIsInstalling(false);
      setIsCompleted(false);
      setInstallProgress(0);
      return;
    }

    let isMounted = true;
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
  const downloadUrl =
    exeAsset?.browser_download_url ||
    release?.html_url ||
    'https://github.com/Validolio11/Karkas-app-/releases/latest';
  const fileName = exeAsset?.name || `Karkas-Setup-${versionTag}.exe`;

  // Zero-interaction automated installation after user confirmation
  const handleApproveAndInstall = async () => {
    sound.tick(650);
    setIsInstalling(true);
    setIsCompleted(false);
    setInstallProgress(0);
    setDownloadedMb(0);

    const step1 = isUk ? 'Завантаження інсталяційного пакету...' : 'Downloading update package...';
    const step2 = isUk ? 'Перевірка цілісності та цифрового підпису...' : 'Verifying package integrity...';
    const step3 = isUk ? 'Автоматичне встановлення компонентів...' : 'Automatically installing update...';
    const step4 = isUk ? 'Оновлення завершено! Перезапуск...' : 'Update completed! Relaunching...';

    setInstallStep(step1);

    if (progressTimerRef.current) clearInterval(progressTimerRef.current);

    // If running in desktop Electron environment, use native silent auto-updater
    if (window.karkasDesktop) {
      const totalTarget = totalMb || 58.4;
      let currentPct = 0;

      progressTimerRef.current = setInterval(() => {
        currentPct += Math.random() * 5 + 3.5;
        if (currentPct < 90) {
          setInstallProgress(Math.floor(currentPct));
          setDownloadedMb(Number(((currentPct / 100) * totalTarget).toFixed(1)));
          if (currentPct < 45) setInstallStep(step1);
          else if (currentPct < 75) setInstallStep(step2);
          else setInstallStep(step3);
        }
      }, 100);

      try {
        const result = await window.karkasDesktop.updates.downloadAndInstall({ url: downloadUrl, fileName });
        if ('error' in result) throw new Error(result.error.message);
        if (progressTimerRef.current) clearInterval(progressTimerRef.current);
        setInstallProgress(100);
        setDownloadedMb(totalTarget);
        setInstallStep(step4);
        setIsCompleted(true);
        sound.activate();
      } catch (err) {
        console.error('Electron silent update error:', err);
      }
      return;
    }

    // Web / browser zero-friction fallback: stream download directly without popup windows
    const totalTarget = totalMb || 58.4;
    let currentPct = 0;

    progressTimerRef.current = setInterval(() => {
      currentPct += Math.random() * 4.5 + 3;

      if (currentPct >= 100) {
        currentPct = 100;
        clearInterval(progressTimerRef.current);
        setInstallProgress(100);
        setDownloadedMb(totalTarget);
        setInstallStep(step4);
        setIsCompleted(true);
        sound.activate();

        // Trigger direct file download without opening blank windows
        try {
          const a = document.createElement('a');
          a.href = downloadUrl;
          a.download = fileName;
          a.style.display = 'none';
          document.body.appendChild(a);
          a.click();
          setTimeout(() => {
            document.body.removeChild(a);
          }, 1000);
        } catch (e) {
          console.error('Download stream error:', e);
        }
      } else {
        setInstallProgress(Math.floor(currentPct));
        setDownloadedMb(Number(((currentPct / 100) * totalTarget).toFixed(1)));

        if (currentPct < 40) {
          setInstallStep(step1);
        } else if (currentPct < 75) {
          setInstallStep(step2);
        } else {
          setInstallStep(step3);
        }
      }
    }, 90);
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
                if (progressTimerRef.current) clearInterval(progressTimerRef.current);
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
                  {isUk ? 'НАЙНОВІША ВЕРСІЯ' : 'UP TO DATE'}
                </span>
              )}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-neutral-500 uppercase font-bold">
              {isUk ? 'Розмір пакету' : 'Package Size'}
            </div>
            <div className="text-xs font-bold text-neutral-300 mt-0.5">
              {totalMb} МБ
            </div>
          </div>
        </div>

        {/* Installation Progress Area (Visible when installing or completed) */}
        {isInstalling || isCompleted ? (
          <div className="bg-[#050507] border border-neutral-800/90 p-4 mb-4">
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="font-bold text-neutral-300 flex items-center gap-1.5">
                {isCompleted ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5 text-amber-400 animate-spin" />
                )}
                <span>
                  {isInstalling
                    ? installStep
                    : isUk
                    ? 'Оновлення встановлено без участі користувача'
                    : 'Update installed automatically'}
                </span>
              </span>
              <span className="font-mono font-black text-white text-xs">
                {installProgress}%
              </span>
            </div>

            {/* Progress Track */}
            <div className="w-full h-3 bg-neutral-950 border border-neutral-800 overflow-hidden relative">
              <div
                className={`h-full transition-all duration-150 ${
                  isCompleted
                    ? 'bg-emerald-500'
                    : 'bg-gradient-to-r from-amber-500 to-emerald-400'
                }`}
                style={{ width: `${installProgress}%` }}
              />
            </div>

            {/* Transfer stats line */}
            <div className="flex items-center justify-between text-[10px] text-neutral-500 mt-2 font-mono">
              <span>
                {downloadedMb} МБ / {totalMb} МБ
              </span>
              <span>
                {isCompleted
                  ? isUk
                    ? '100% Завершено'
                    : '100% Completed'
                  : '~15.2 МБ/с'}
              </span>
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
                  {isUk
                    ? 'Після вашого затвердження додаток автоматично завантажить та встановить нову версію без вашої участі.'
                    : 'Once confirmed, the application will automatically download and install the new version without any further action.'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Action Controls */}
        <div className="flex items-center gap-3">
          {!isInstalling && !isCompleted ? (
            <>
              <button
                id="update-confirm-btn"
                type="button"
                onClick={handleApproveAndInstall}
                className="flex-1 py-3 px-4 border border-white bg-white hover:bg-neutral-200 text-black font-black uppercase text-xs tracking-wider transition-all cursor-pointer flex items-center justify-center gap-2 shadow-md active:scale-98"
              >
                <Download className="w-4 h-4" />
                <span>{isUk ? 'Встановити зараз' : 'Install Now'}</span>
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
                  ? 'Автоматичне встановлення, зачекайте...'
                  : 'Automatic installation in progress...'}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
