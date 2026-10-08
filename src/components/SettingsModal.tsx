import React, { useEffect, useRef } from 'react';
import { Minus, Plus, RotateCcw, Settings, X, ZoomIn, Power } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Language, SETTINGS_TRANSLATIONS } from '../utils/i18n';
import { sound } from '../utils/audio';

interface SettingsModalProps {
  isOpen: boolean;
  lang: Language;
  zoomPercent: number;
  minZoom: number;
  maxZoom: number;
  defaultZoom: number;
  launchAtStartup: boolean | null;
  startupPending: boolean;
  startupError: 'read' | 'write' | 'unchanged' | null;
  onZoomChange: (zoomPercent: number) => void;
  onLaunchAtStartupChange: (enabled: boolean) => void;
  onRefreshStartup: () => void;
  onClose: () => void;
}

const ZOOM_PRESETS = [75, 90, 100, 110, 125, 150];
const ZOOM_STEP = 5;

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  lang,
  zoomPercent,
  minZoom,
  maxZoom,
  defaultZoom,
  launchAtStartup,
  startupPending,
  startupError,
  onZoomChange,
  onLaunchAtStartupChange,
  onRefreshStartup,
  onClose,
}) => {
  const labels = SETTINGS_TRANSLATIONS[lang];
  const startupMessages = lang === 'uk' ? {
    pending: 'Перевіряємо налаштування Windows…',
    unknown: 'Стан автозапуску невідомий.',
    read: 'Не вдалося перевірити автозапуск. Перевірте стан знову.',
    write: 'Не вдалося завершити зміну автозапуску. Показано останній підтверджений стан. Перевірте стан знову й повторіть спробу.',
    unchanged: 'Windows не підтвердив запитану зміну. Показано фактичний стан. Перевірте автозапуск Karkas у налаштуваннях Windows.',
    retry: 'Перевірити знову',
  } : {
    pending: 'Checking Windows settings…',
    unknown: 'Startup status is unknown.',
    read: 'Could not check startup. Check the status again.',
    write: 'Could not complete the startup change. The last confirmed state is shown. Check the status again, then retry the change.',
    unchanged: 'Windows did not confirm the requested change. The actual state is shown. Check Karkas startup in Windows Settings.',
    retry: 'Check again',
  };
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();

    return () => {
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    };
  }, [isOpen]);

  const setZoom = (value: number) => {
    sound.tick(550);
    onZoomChange(Math.min(maxZoom, Math.max(minZoom, value)));
  };

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const focusable = (dialogRef.current
      ? Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'))
      : []) as HTMLElement[];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <AnimatePresence>
      {isOpen && <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        />

        <motion.div
          ref={dialogRef}
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-modal-title"
          aria-describedby="settings-modal-description"
          onKeyDown={handleDialogKeyDown}
          className="relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-hidden border border-neutral-800 bg-[#0c0c0e] font-sans text-neutral-100 shadow-2xl [&_button]:cursor-pointer [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-offset-2 [&_button]:focus-visible:outline-white"
        >
          <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-5 py-5">
            <div className="flex items-center gap-3">
              <Settings aria-hidden="true" className="h-4 w-4 text-white" />
              <div>
                <h2 id="settings-modal-title" className="text-xs font-black uppercase tracking-widest text-white">
                  {labels.title}
                </h2>
                <p id="settings-modal-description" className="mt-1 text-xs leading-relaxed text-neutral-400">
                  {labels.subtitle}
                </p>
              </div>
            </div>
            <button
              ref={closeButtonRef}
              id="close-settings-modal-btn"
              type="button"
              aria-label={labels.close}
              onClick={() => {
                sound.tick(400);
                onClose();
              }}
              className="shrink-0 p-2 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-white"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>

          <div className="min-h-0 space-y-5 overflow-y-auto p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <ZoomIn aria-hidden="true" className="h-4 w-4 text-neutral-300" />
                <span className="text-xs font-bold uppercase tracking-wider text-neutral-200">{labels.scale}</span>
              </div>
              <span className="border border-neutral-700 bg-black px-2.5 py-1 text-sm font-black tabular-nums text-white">
                {zoomPercent}%
              </span>
            </div>

            <div className="grid grid-cols-[2.5rem_1fr_2.5rem] items-center gap-3">
              <button
                id="decrease-app-zoom-btn"
                type="button"
                aria-label={labels.decrease}
                disabled={zoomPercent <= minZoom}
                onClick={() => setZoom(zoomPercent - ZOOM_STEP)}
                className="flex h-10 items-center justify-center border border-neutral-700 bg-[#08080a] text-neutral-300 transition-colors hover:border-white hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
              >
                <Minus aria-hidden="true" className="h-4 w-4" />
              </button>

              <input
                id="app-zoom-slider"
                type="range"
                min={minZoom}
                max={maxZoom}
                step={ZOOM_STEP}
                value={zoomPercent}
                onChange={(event) => onZoomChange(Number(event.target.value))}
                aria-label={labels.scale}
                aria-valuetext={`${zoomPercent}%`}
                className="h-1.5 w-full cursor-pointer accent-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
              />

              <button
                id="increase-app-zoom-btn"
                type="button"
                aria-label={labels.increase}
                disabled={zoomPercent >= maxZoom}
                onClick={() => setZoom(zoomPercent + ZOOM_STEP)}
                className="flex h-10 items-center justify-center border border-neutral-700 bg-[#08080a] text-neutral-300 transition-colors hover:border-white hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
              >
                <Plus aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {ZOOM_PRESETS.filter((preset) => preset >= minZoom && preset <= maxZoom).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setZoom(preset)}
                  aria-pressed={zoomPercent === preset}
                  className={`border px-2 py-2 text-xs font-bold tabular-nums transition-colors ${
                    zoomPercent === preset
                      ? 'border-white bg-white text-black'
                      : 'border-neutral-800 bg-[#08080a] text-neutral-400 hover:border-neutral-600 hover:text-white'
                  }`}
                >
                  {preset}%
                </button>
              ))}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-neutral-800 pt-4">
              <span className="text-[10px] uppercase tracking-widest text-neutral-500">{labels.savedLocally}</span>
              <button
                id="reset-app-zoom-btn"
                type="button"
                onClick={() => setZoom(defaultZoom)}
                className="flex items-center gap-1.5 border border-neutral-700 bg-[#08080a] px-3 py-2 text-xs font-bold uppercase tracking-wider text-neutral-300 transition-colors hover:border-white hover:text-white"
              >
                <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
                {labels.reset}
              </button>
            </div>

            {window.karkasDesktop && (
              <div className="flex items-center justify-between gap-4 border-t border-neutral-800 pt-5">
                <div className="flex min-w-0 items-center gap-3">
                  <Power aria-hidden="true" className="h-4 w-4 shrink-0 text-neutral-300" />
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wider text-neutral-200">{labels.startup}</div>
                    <div className="mt-1 text-[10px] leading-relaxed text-neutral-500">{labels.startupDescription}</div>
                    <div id="startup-setting-status" aria-live="polite" className="text-xs leading-relaxed text-neutral-400">
                      {startupPending ? startupMessages.pending : launchAtStartup === null ? startupMessages.unknown : null}
                    </div>
                    {startupError && <div id="startup-setting-error" className="mt-1 text-xs leading-relaxed text-rose-300">
                      <p role="alert">{startupMessages[startupError]}</p>
                      <button type="button" onClick={() => {
                        // The retry control disappears when its previous error clears.
                        closeButtonRef.current?.focus();
                        onRefreshStartup();
                      }} disabled={startupPending}
                        className="mt-2 inline-flex min-h-11 min-w-11 items-center justify-center border border-neutral-700 bg-[#08080a] px-3 text-xs font-bold text-neutral-300 transition-colors hover:border-white hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-50">
                        {startupMessages.retry}
                      </button>
                    </div>}
                  </div>
                </div>
                <button
                  id="toggle-startup-btn"
                  type="button"
                  role={launchAtStartup === null ? undefined : 'switch'}
                  aria-checked={launchAtStartup === null ? undefined : launchAtStartup}
                  aria-label={labels.startup}
                  aria-describedby={startupError ? 'startup-setting-status startup-setting-error' : 'startup-setting-status'}
                  aria-busy={startupPending}
                  disabled={startupPending || launchAtStartup === null}
                  onClick={() => onLaunchAtStartupChange(!launchAtStartup)}
                  className="flex h-11 w-11 shrink-0 items-center justify-center disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span aria-hidden="true" className={`relative block h-6 w-11 shrink-0 rounded-full border transition-colors motion-reduce:transition-none ${launchAtStartup ? 'border-white bg-white' : 'border-neutral-700 bg-black'}`}>
                    <span className={`absolute left-1 top-1 h-3.5 w-3.5 rounded-full transition-transform motion-reduce:transition-none ${launchAtStartup ? 'translate-x-5 bg-black' : 'translate-x-0 bg-neutral-500'}`} />
                  </span>
                </button>
              </div>
            )}
          </div>
        </motion.div>
      </div>}
    </AnimatePresence>
  );
};
