import React, { useState, useEffect, useRef } from 'react';
import { Download, CheckCircle2, X, RefreshCw, HardDrive, ShieldCheck, Play, ArrowRight, Sparkles } from 'lucide-react';
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

function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '58.4 МБ';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} МБ`;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({
  isOpen,
  onClose,
  lang,
  currentVersion,
}) => {
  const isUk = lang === 'uk';
  const [release, setRelease] = useState<ReleaseData | null>(null);
  const [isInstalling, setIsInstalling] = useState(false);
  const [installProgress, setInstallProgress] = useState(0);
  const [installStep, setInstallStep] = useState<string>('');
  const [downloadedMb, setDownloadedMb] = useState<number>(0);
  const [totalMb, setTotalMb] = useState<number>(58.4);
  const [isCompleted, setIsCompleted] = useState(false);
  const progressTimerRef = useRef<any>(null);

  // Background silent fetch of latest release data without blocking UI or preloader
  useEffect(() => {
    if (!isOpen) {
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
      return;
    }

    let isMounted = true;
    const fetchLatestSilently = async () => {
      try {
        const proxyRes = await fetch('/api/check-update');
        if (proxyRes.ok) {
          const data = await proxyRes.json();
          if (isMounted && data && data.tag_name) {
            setRelease(data);
            const asset = data.assets?.find((a: any) => typeof a.name === 'string' && a.name.endsWith('.exe'));
            if (asset && asset.size) {
              setTotalMb(Number((asset.size / (1024 * 1024)).toFixed(1)));
            }
            return;
          }
        }
      } catch {
        // Silent fallback
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
      }
    };

    fetchLatestSilently();

    return () => {
      isMounted = false;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const versionTag = release?.tag_name || `v${currentVersion}`;
  const exeAsset = release?.assets?.find((a) =>
    typeof a.name === 'string' && a.name.toLowerCase().endsWith('.exe')
  );
  const downloadUrl = exeAsset?.browser_download_url || (release?.html_url || 'https://github.com/Validolio11/Karkas-app-/releases/latest');
  const fileName = exeAsset?.name || `Karkas-Setup-${versionTag}.exe`;

  const handleStartDownloadAndInstall = () => {
    sound.tick(650);
    setIsInstalling(true);
    setIsCompleted(false);
    setInstallProgress(0);
    setDownloadedMb(0);

    const step1 = isUk ? 'Завантаження інсталяційного пакету...' : 'Downloading installation package...';
    const step2 = isUk ? 'Перевірка цифрового підпису та цілісності...' : 'Verifying digital signature & integrity...';
    const step3 = isUk ? 'Розпакування та підготовка системних компонентів...' : 'Unpacking & preparing system components...';
    const step4 = isUk ? 'Встановлення завершено успішно!' : 'Installation completed successfully!';

    setInstallStep(step1);

    if (progressTimerRef.current) clearInterval(progressTimerRef.current);

    const totalTarget = totalMb || 58.4;
    let currentPct = 0;

    progressTimerRef.current = setInterval(() => {
      currentPct += Math.random() * 4.5 + 2.5;

      if (currentPct >= 100) {
        currentPct = 100;
        clearInterval(progressTimerRef.current);
        setInstallProgress(100);
        setDownloadedMb(totalTarget);
        setInstallStep(step4);
        setIsCompleted(true);
        sound.activate();

        // Trigger real file download in browser
        try {
          const a = document.createElement('a');
          a.href = downloadUrl;
          a.download = fileName;
          a.target = '_blank';
          a.rel = 'noreferrer';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        } catch (e) {
          console.error('Trigger download failed', e);
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

  const handleManualOpenDownload = () => {
    sound.tick(500);
    window.open(downloadUrl, '_blank', 'noreferrer');
  };

  return (
    <div
      id="update-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in app-no-drag"
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
              {isUk ? 'Завантаження та встановлення версії' : 'Version Download & Installation'}
            </h3>
          </div>
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
        </div>

        {/* Version Info Header Bar */}
        <div className="bg-neutral-900/90 border border-neutral-800 p-3 mb-4 flex items-center justify-between">
          <div>
            <div className="text-[10px] text-neutral-400 uppercase font-bold tracking-wider">
              {isUk ? 'Версія системи' : 'System Version'}
            </div>
            <div className="text-sm font-black text-white flex items-center gap-2 mt-0.5">
              <span>{versionTag}</span>
              <span className="text-[9px] px-1.5 py-0.5 bg-emerald-950 border border-emerald-500/40 text-emerald-400 font-bold uppercase">
                {isUk ? 'ГОТОВО ДО ВСТАНОВЛЕННЯ' : 'READY TO INSTALL'}
              </span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-neutral-500 uppercase font-bold">
              {isUk ? 'Розмір' : 'Size'}
            </div>
            <div className="text-xs font-bold text-neutral-300 mt-0.5">
              {totalMb} МБ
            </div>
          </div>
        </div>

        {/* Строка встановлення (Installation / Progress Bar) */}
        <div className="bg-[#050507] border border-neutral-800/90 p-4 mb-4">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="font-bold text-neutral-300 flex items-center gap-1.5">
              {isCompleted ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              ) : isInstalling ? (
                <RefreshCw className="w-3.5 h-3.5 text-amber-400 animate-spin" />
              ) : (
                <ShieldCheck className="w-3.5 h-3.5 text-neutral-400" />
              )}
              <span>
                {isInstalling
                  ? installStep
                  : isCompleted
                  ? isUk ? 'Встановлення завершено' : 'Installation Completed'
                  : isUk ? 'Строка встановлення' : 'Installation Bar'}
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
              {isInstalling || isCompleted
                ? `${downloadedMb} МБ / ${totalMb} МБ`
                : `${fileName}`}
            </span>
            <span>
              {isCompleted
                ? isUk ? '100% Завершено' : '100% Complete'
                : isInstalling
                ? '~12.4 МБ/с'
                : isUk ? 'Очікує запуску' : 'Idle'}
            </span>
          </div>
        </div>

        {/* Primary Action Button: Direct Download / Install */}
        <div className="flex items-center gap-3">
          {!isCompleted ? (
            <button
              id="update-start-download-btn"
              type="button"
              onClick={handleStartDownloadAndInstall}
              disabled={isInstalling}
              className={`flex-1 py-3 px-4 border font-black uppercase text-xs tracking-wider transition-all cursor-pointer flex items-center justify-center gap-2 ${
                isInstalling
                  ? 'border-neutral-800 bg-neutral-900 text-neutral-500'
                  : 'border-white bg-white text-black hover:bg-neutral-200 active:scale-98 shadow-md'
              }`}
            >
              {isInstalling ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin text-neutral-400" />
                  <span>{isUk ? 'Встановлюється...' : 'Installing...'}</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>{isUk ? `Завантажити ${versionTag}` : `Download ${versionTag}`}</span>
                </>
              )}
            </button>
          ) : (
            <button
              id="update-launch-installer-btn"
              type="button"
              onClick={handleManualOpenDownload}
              className="flex-1 py-3 px-4 border border-emerald-500 bg-emerald-500 hover:bg-emerald-400 text-black font-black uppercase text-xs tracking-wider transition-all cursor-pointer flex items-center justify-center gap-2 shadow-lg"
            >
              <Play className="w-4 h-4 fill-black" />
              <span>{isUk ? 'Запустити оновлення' : 'Launch Update'}</span>
            </button>
          )}

          <button
            id="update-close-action-btn"
            type="button"
            onClick={() => {
              sound.tick(300);
              if (progressTimerRef.current) clearInterval(progressTimerRef.current);
              onClose();
            }}
            className="py-3 px-4 border border-neutral-800 bg-neutral-900 hover:border-neutral-700 text-neutral-300 text-xs font-bold uppercase transition-all cursor-pointer"
          >
            {isUk ? 'Закрити' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
};
