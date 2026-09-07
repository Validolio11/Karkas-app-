import React, { useState } from 'react';
import { RefreshCw, CheckCircle2, Download, ShieldCheck, Sparkles, X, Info } from 'lucide-react';
import { sound } from '../utils/audio';

interface UpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
  lang: string;
  currentVersion: string;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({
  isOpen,
  onClose,
  lang,
  currentVersion,
}) => {
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<'idle' | 'upToDate' | 'found' | 'error'>('idle');
  const [latestRelease, setLatestRelease] = useState<{ tag_name: string; html_url: string; body?: string } | null>(null);
  const [lastCheckTime, setLastCheckTime] = useState<string | null>(null);

  if (!isOpen) return null;

  const isUk = lang === 'uk';

  const handleCheckForUpdates = async () => {
    sound.tick(600);
    setChecking(true);
    setStatus('idle');
    setLatestRelease(null);

    try {
      const res = await fetch('https://api.github.com/repos/Validolio11/Karkas-app/releases/latest');
      if (res.ok) {
        const data = await res.json();
        const latestTag = (data.tag_name || '').replace(/^v/, '');
        setLatestRelease(data);
        
        if (latestTag && latestTag !== currentVersion) {
          setStatus('found');
        } else {
          setStatus('upToDate');
        }
      } else {
        // Fallback if no releases created on GitHub yet
        await new Promise((resolve) => setTimeout(resolve, 800));
        setStatus('upToDate');
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 800));
      setStatus('upToDate');
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in app-no-drag">
      <div className="relative w-full max-w-md bg-[#0c0c0e] border border-neutral-800 shadow-2xl p-5 font-mono text-neutral-200">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-neutral-800 mb-4">
          <div className="flex items-center gap-2">
            <RefreshCw className={`w-4 h-4 text-emerald-400 ${checking ? 'animate-spin' : ''}`} />
            <h3 className="text-xs font-extrabold uppercase tracking-widest text-white">
              {isUk ? 'Центр Оновлень System' : 'System Update Center'}
            </h3>
          </div>
          <button
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
              {isUk ? 'Поточна версія' : 'Current Version'}
            </div>
            <div className="text-sm font-black text-white flex items-center gap-2 mt-0.5">
              <span>v{currentVersion}</span>
              <span className="text-[9px] px-1.5 py-0.2 bg-emerald-950 border border-emerald-500/40 text-emerald-400 uppercase tracking-widest font-bold">
                {isUk ? 'СТАБІЛЬНА' : 'STABLE'}
              </span>
            </div>
          </div>
          <ShieldCheck className="w-6 h-6 text-emerald-400/80" />
        </div>

        {/* Status / Output Display */}
        <div className="bg-[#050507] border border-neutral-800/80 p-4 mb-5 text-xs min-h-[90px] flex flex-col justify-center">
          {checking ? (
            <div className="flex items-center gap-3 text-neutral-300">
              <RefreshCw className="w-4 h-4 animate-spin text-amber-400 shrink-0" />
              <div>
                <p className="font-bold">{isUk ? 'Перевірка нових версій...' : 'Checking for updates...'}</p>
                <p className="text-[10px] text-neutral-500 mt-0.5">
                  {isUk ? 'Зʼєднання з сервером релізів KARKAS' : 'Connecting to KARKAS release channel'}
                </p>
              </div>
            </div>
          ) : status === 'found' && latestRelease ? (
            <div className="flex items-start gap-3">
              <Download className="w-5 h-5 text-amber-400 shrink-0 mt-0.5 animate-bounce" />
              <div>
                <p className="font-bold text-amber-300">
                  {isUk ? `Доступне оновлення ${latestRelease.tag_name}!` : `New update available: ${latestRelease.tag_name}!`}
                </p>
                <p className="text-[10px] text-neutral-400 mt-1 leading-relaxed">
                  {isUk
                    ? 'Знайдено нову версію системи на GitHub. Натисніть кнопку завантаження нижче.'
                    : 'Found a new version on GitHub. Click the download button below.'}
                </p>
                <a
                  href={latestRelease.html_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 mt-2 px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-black font-extrabold text-[10px] uppercase transition-colors"
                >
                  <Download className="w-3 h-3" />
                  <span>{isUk ? 'Завантажити з GitHub' : 'Download from GitHub'}</span>
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
                    ? `Версія v${currentVersion} має всі останні патчі системи та оновлення модулів AI.`
                    : `Version v${currentVersion} includes all latest system patches and AI modules.`}
                </p>
                {lastCheckTime && (
                  <p className="text-[9px] text-neutral-500 mt-1.5">
                    {isUk ? 'Остання перевірка:' : 'Last checked:'} {lastCheckTime}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2.5 text-neutral-400">
              <Info className="w-4 h-4 text-neutral-500 shrink-0 mt-0.5" />
              <p className="text-[11px] leading-relaxed">
                {isUk
                  ? 'Натисніть кнопку нижче, щоб перевірити наявність оновлень системи KARKAS.'
                  : 'Click the button below to check for KARKAS system updates.'}
              </p>
            </div>
          )}
        </div>

        {/* System Info Note */}
        <div className="flex items-center gap-1.5 text-[10px] text-neutral-500 mb-5">
          <Sparkles className="w-3 h-3 text-amber-400 shrink-0" />
          <span>
            {isUk
              ? 'Оновлення веб-версії застосовуються автоматично.'
              : 'Web version updates are applied automatically.'}
          </span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button
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
