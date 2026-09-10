import React, { useState } from 'react';
import { User } from 'firebase/auth';
import { Language, TRANSLATIONS } from '../utils/i18n';
import { sound } from '../utils/audio';
import { UserCloudState } from '../services/firebase';
import firebaseConfig from '../../firebase-applet-config.json';
import { 
  X, 
  Cloud, 
  CloudCheck, 
  RefreshCw, 
  LogOut, 
  ShieldCheck, 
  CheckCircle2, 
  AlertCircle,
  Database,
  Layers,
  History
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const CopyableDomain: React.FC<{ domain: string; lang: string }> = ({ domain, lang }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(domain);
      setCopied(true);
      sound.activate();
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error(e);
    }
  };
  return (
    <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 bg-black border border-neutral-800 text-[11px] font-mono hover:border-neutral-700 transition-colors">
      <span className="text-neutral-300 truncate select-all">{domain}</span>
      <button
        type="button"
        onClick={handleCopy}
        className="text-[9px] uppercase font-bold tracking-wider px-2 py-0.5 border border-neutral-800 bg-neutral-900 text-neutral-400 hover:text-white transition-all hover:bg-neutral-800 cursor-pointer whitespace-nowrap"
      >
        {copied ? (lang === 'uk' ? 'Скопійовано' : 'Copied') : (lang === 'uk' ? 'Копіювати' : 'Copy')}
      </button>
    </div>
  );
};

interface AccountModalProps {
  isOpen: boolean;
  lang: Language;
  user: User | null;
  cloudData: UserCloudState | null;
  isSyncing: boolean;
  lastSyncTime: number | null;
  autoSyncEnabled: boolean;
  onClose: () => void;
  onLoginWithGoogle: () => Promise<void>;
  onLogout: () => Promise<void>;
  onSyncNow: () => Promise<void>;
  onRestoreFromCloud: () => Promise<void>;
  onToggleAutoSync: () => void;
}

export const AccountModal: React.FC<AccountModalProps> = ({
  isOpen,
  lang,
  user,
  cloudData,
  isSyncing,
  lastSyncTime,
  autoSyncEnabled,
  onClose,
  onLoginWithGoogle,
  onLogout,
  onSyncNow,
  onRestoreFromCloud,
  onToggleAutoSync,
}) => {
  const t = TRANSLATIONS[lang];
  const acc = t.account;

  const [authLoading, setAuthLoading] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: React.ReactNode } | null>(null);

  if (!isOpen) return null;

  const handleGoogleLogin = async () => {
    try {
      setAuthLoading(true);
      setFeedbackMsg(null);
      sound.tick(600);
      await onLoginWithGoogle();
      sound.activate();
      setFeedbackMsg({
        type: 'success',
        text: lang === 'uk' ? 'Успішний вхід! Завдання привʼязано до вашого Google акаунта.' : 'Successfully connected Google Account!',
      });
    } catch (err: any) {
      console.error('Login error:', err);
      sound.tick(250);
      
      if (err?.code === 'auth/unauthorized-domain' || err?.message?.includes('unauthorized-domain')) {
        const domain = window.location.hostname || 'localhost';
        const projectId = firebaseConfig.projectId || 'bezier3-4f548';
        const consoleUrl = `https://console.firebase.google.com/project/${projectId}/authentication/settings`;

        const domainsToRecommend = Array.from(new Set([
          'localhost',
          'localhost:14141',
          '127.0.0.1',
          'run.app',
          'europe-west2.run.app',
          domain
        ])).filter(Boolean);

        setFeedbackMsg({
          type: 'error',
          text: (
            <div className="space-y-3 w-full text-left">
              <div>
                <p className="font-bold text-rose-400 uppercase tracking-wide text-[11px]">
                  {lang === 'uk' ? 'Помилка авторизації домену' : 'Unauthorized Domain Error'}
                </p>
                <p className="text-[10px] text-neutral-400 mt-1 leading-relaxed">
                  {lang === 'uk'
                    ? `Firebase блокує вхід, оскільки цей веб-домен не додано до дозволених у вашому проекті.`
                    : `Firebase blocks Google login because this web domain is not added to the authorized domains list in your Firebase project.`}
                </p>
              </div>

              {/* Step 1 */}
              <div className="p-2.5 bg-rose-950/10 border border-rose-900/30 space-y-2">
                <p className="text-[10px] font-bold text-rose-300 uppercase tracking-wider">
                  {lang === 'uk' ? 'Крок 1. Відкрийте налаштування Firebase' : 'Step 1. Open Firebase Settings'}
                </p>
                <a
                  href={consoleUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-950/80 border border-rose-800 hover:border-white text-white font-bold text-[10px] font-mono uppercase transition-all tracking-wider cursor-pointer"
                  onClick={() => sound.activate()}
                >
                  <span>{lang === 'uk' ? 'Налаштування Firebase Console ↗' : 'Firebase Console Settings ↗'}</span>
                </a>
              </div>

              {/* Step 2 */}
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-neutral-300 uppercase tracking-wider">
                  {lang === 'uk' ? 'Крок 2. Додайте ці домени у список:' : 'Step 2. Add these domains to the list:'}
                </p>
                <p className="text-[9px] text-neutral-500 leading-normal">
                  {lang === 'uk'
                    ? 'У розділі "Authorized domains" натисніть "Add domain" та додайте кожен із наведених нижче доменів:'
                    : 'In the "Authorized domains" section, click "Add domain" and add each of these domains:'}
                </p>
                <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                  {domainsToRecommend.map((d) => (
                    <CopyableDomain key={d} domain={d} lang={lang} />
                  ))}
                </div>
              </div>
            </div>
          )
        });
        return;
      }

      let errMsg = err?.message || (lang === 'uk' ? 'Не вдалося увійти через Google. Спробуйте ще раз.' : 'Failed to sign in with Google.');
      if (err?.code === 'auth/operation-not-allowed' || err?.message?.includes('operation-not-allowed')) {
        errMsg = lang === 'uk'
          ? `Увага! Спосіб входу через Google вимкнено. У Firebase Console -> Authentication -> Sign-in method увімкніть "Google" і збережіть.`
          : `Google Sign-in disabled. In Firebase Console -> Authentication -> Sign-in method, enable "Google".`;
      } else if (err?.code === 'auth/popup-blocked' || err?.message?.includes('popup-blocked')) {
        errMsg = lang === 'uk'
          ? `Браузер заблокував випливаюче вікно. Дозвольте вспливаючі вікна (popups) у налаштуваннях браузера або відкрийте додаток у новій вкладці.`
          : `Popup blocked by browser. Please allow popups in your browser settings or open in a new tab.`;
      }
      setFeedbackMsg({
        type: 'error',
        text: errMsg,
      });
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      setAuthLoading(true);
      setFeedbackMsg(null);
      sound.tick(350);
      await onLogout();
      sound.tick(450);
    } catch (err: any) {
      console.error('Sign out error:', err);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleManualSync = async () => {
    try {
      setFeedbackMsg(null);
      sound.tick(500);
      await onSyncNow();
      sound.activate();
      setFeedbackMsg({
        type: 'success',
        text: acc.syncSuccess,
      });
    } catch (err: any) {
      sound.tick(250);
      setFeedbackMsg({
        type: 'error',
        text: lang === 'uk' ? 'Помилка синхронізації.' : 'Sync failed.',
      });
    }
  };

  const handleManualRestore = async () => {
    try {
      setFeedbackMsg(null);
      sound.tick(500);
      await onRestoreFromCloud();
      sound.activate();
      setFeedbackMsg({
        type: 'success',
        text: acc.restoreSuccess,
      });
    } catch (err: any) {
      sound.tick(250);
      setFeedbackMsg({
        type: 'error',
        text: lang === 'uk' ? 'Помилка відновлення з хмари.' : 'Restore failed.',
      });
    }
  };

  const formatLastSync = (timestamp: number | null) => {
    if (!timestamp) return acc.never;
    const diffSeconds = Math.floor((Date.now() - timestamp) / 1000);
    if (diffSeconds < 10) return acc.justNow;
    if (diffSeconds < 60) return `${diffSeconds} ${lang === 'uk' ? 'сек тому' : 's ago'}`;
    const date = new Date(timestamp);
    return date.toLocaleTimeString(lang === 'uk' ? 'uk-UA' : 'en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
      />

      {/* Modal Dialog */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-modal-title"
        aria-describedby="account-modal-description"
        className="relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-hidden border border-neutral-800 bg-[#0c0c0e] font-mono text-neutral-100 shadow-2xl [&_button]:cursor-pointer [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-offset-2 [&_button]:focus-visible:outline-white"
      >
        {/* Top Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 px-5 py-5 border-b border-neutral-800 bg-[#0c0c0e]">
          <div className="flex items-center gap-2">
            <Cloud className="w-4 h-4 text-white" />
            <div>
              <h2 id="account-modal-title" className="text-xs font-mono font-black tracking-widest uppercase text-white">
                {acc.title}
              </h2>
              <p id="account-modal-description" className="mt-1 text-[11px] leading-relaxed text-neutral-400">
                {acc.subtitle}
              </p>
            </div>
          </div>
          <button
            id="close-account-modal-btn"
            aria-label={lang === 'uk' ? 'Закрити' : 'Close'}
            onClick={() => {
              sound.tick(400);
              onClose();
            }}
            className="shrink-0 p-2 hover:bg-neutral-800 text-neutral-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="min-h-0 overflow-y-auto p-4 sm:p-5 space-y-4">
          {/* Feedback message banner */}
          <AnimatePresence>
            {feedbackMsg && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className={`p-3 text-xs font-mono flex items-start gap-2 border ${
                  feedbackMsg.type === 'success'
                    ? 'bg-emerald-950/40 border-emerald-800/80 text-emerald-300'
                    : 'bg-rose-950/40 border-rose-800/80 text-rose-300'
                }`}
              >
                {feedbackMsg.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
                )}
                <span>{feedbackMsg.text}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {user ? (
            <div className="space-y-5">
              {/* Identity stays separate from the current sync state. */}
              <div className="border border-neutral-800 bg-[#0e0e11]">
                <div className="flex items-center gap-3 p-4">
                  {user.photoURL ? (
                    <img src={user.photoURL} alt="" className="h-12 w-12 shrink-0 rounded-full border border-neutral-700 object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-neutral-700 bg-neutral-800 text-lg font-bold text-white">
                      {(user.displayName || user.email?.split('@')[0] || 'U')[0].toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-white">{user.displayName || user.email?.split('@')[0] || 'User'}</p>
                    <p className="mt-1 break-all text-[11px] leading-relaxed text-neutral-400">{user.email}</p>
                  </div>
                  <button id="sign-out-btn" onClick={handleSignOut} disabled={authLoading} title={acc.signOut} aria-label={acc.signOut}
                    className="flex h-9 w-9 shrink-0 items-center justify-center border border-neutral-800 text-neutral-400 transition-colors hover:border-rose-900 hover:text-rose-400 disabled:opacity-40">
                    <LogOut className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-800 px-4 py-2.5 text-[10px]">
                  <span className="flex items-center gap-2 text-neutral-300"><CloudCheck className="h-3.5 w-3.5 text-emerald-400" />{lang === 'uk' ? 'Google акаунт підключено' : 'Google account connected'}</span>
                  {user.email?.toLowerCase() === 'melychyn4@gmail.com' && (
                    <span className="flex items-center gap-1.5 whitespace-nowrap text-[9px] font-bold uppercase tracking-wider text-amber-300"><ShieldCheck className="h-3 w-3" />{lang === 'uk' ? 'Власник системи' : 'System owner'}</span>
                  )}
                </div>
              </div>

              <section className="border border-neutral-800" aria-labelledby="account-sync-heading">
                <div className="flex items-start justify-between gap-4 p-4">
                  <div className="min-w-0">
                    <h3 id="account-sync-heading" className="text-xs font-bold tracking-wide text-white">{acc.autoSyncTitle}</h3>
                    <p className="mt-2 max-w-xs text-[11px] leading-relaxed text-neutral-400">{acc.autoSyncDesc}</p>
                  </div>
                  <button id="toggle-autosync-btn" type="button" role="switch" aria-checked={autoSyncEnabled} aria-label={acc.autoSyncTitle}
                    onClick={() => { sound.tick(600); onToggleAutoSync(); }}
                    className={`relative mt-0.5 h-6 w-11 shrink-0 border transition-colors ${autoSyncEnabled ? 'border-emerald-500 bg-emerald-950/70 hover:bg-emerald-900/80' : 'border-neutral-600 bg-neutral-900 hover:border-neutral-400'}`}>
                    <span className={`absolute top-1 h-3.5 w-3.5 transition-transform ${autoSyncEnabled ? 'left-1 translate-x-5 bg-emerald-300' : 'left-1 bg-neutral-400'}`} />
                  </button>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-neutral-800 bg-neutral-950/50 px-4 py-3 text-[10px]">
                  <span className={`flex items-center gap-2 ${autoSyncEnabled ? 'text-emerald-400' : 'text-neutral-400'}`}>
                    <span className={`h-1.5 w-1.5 ${autoSyncEnabled ? 'bg-emerald-400' : 'bg-neutral-500'}`} />
                    {autoSyncEnabled ? (lang === 'uk' ? 'Увімкнено · реальний час' : 'On · real time') : acc.autoSyncOff}
                  </span>
                  <span className="flex items-center gap-1.5 text-neutral-400" aria-live="polite">
                    <History className="h-3 w-3 shrink-0" />
                    <span>{acc.lastSynced} <span className="text-neutral-200">{formatLastSync(lastSyncTime)}</span></span>
                  </span>
                </div>
              </section>

              {cloudData && (
                <section aria-label={acc.backupStats}>
                  <h3 className="mb-3 text-[10px] font-bold uppercase tracking-wider text-neutral-400">{acc.backupStats}</h3>
                  <div className="grid grid-cols-3 divide-x divide-neutral-800 border border-neutral-800 bg-[#0a0a0c]">
                    {[
                      [cloudData.tasks?.length || 0, acc.activeTasks],
                      [cloudData.tabs?.length || 0, acc.tabsCount],
                      [cloudData.deletedTasks?.length || 0, acc.historyCount],
                    ].map(([count, label]) => (
                      <div key={label} className="min-w-0 px-2 py-3 text-center">
                        <div className="text-lg font-bold tabular-nums text-white">{count}</div>
                        <div className="mt-1 text-[9px] leading-relaxed text-neutral-400">{label}</div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <div className="flex items-start gap-2.5 px-1">
                <Layers className="mt-0.5 h-4 w-4 shrink-0 text-neutral-500" />
                <div>
                  <p className="text-[11px] font-bold leading-relaxed text-neutral-300">{acc.tabsPreserved}</p>
                  <p className="mt-1 text-[10px] leading-relaxed text-neutral-400">{acc.tabsPreservedDesc}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button id="sync-now-cloud-btn" onClick={handleManualSync} disabled={isSyncing} aria-busy={isSyncing}
                  className="flex min-h-11 items-center justify-center gap-2 bg-white px-3 py-3 text-[11px] font-bold tracking-wide text-black transition-colors hover:bg-neutral-200 disabled:cursor-wait disabled:bg-neutral-800 disabled:text-neutral-400">
                  <RefreshCw className={`h-3.5 w-3.5 shrink-0 ${isSyncing ? 'animate-spin' : ''}`} />
                  <span aria-live="polite">{isSyncing ? acc.syncing : acc.syncNow}</span>
                </button>
                <button id="restore-from-cloud-btn" onClick={handleManualRestore} disabled={isSyncing}
                  className="flex min-h-11 items-center justify-center gap-2 border border-neutral-700 bg-neutral-900 px-3 py-3 text-[11px] font-bold tracking-wide text-neutral-300 transition-colors hover:border-neutral-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40">
                  <Database className="h-3.5 w-3.5 shrink-0" /><span>{acc.restoreFromCloud}</span>
                </button>
              </div>
            </div>
          ) : (
            /* Logged-out view */
            <div className="space-y-4">
              <div className="p-3.5 bg-neutral-900/60 border border-neutral-800 text-xs font-mono text-neutral-300 leading-relaxed flex items-start gap-2.5">
                <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-white mb-1">
                    {lang === 'uk' ? 'Захист від втрати завдань' : 'Cloud Backup Protection'}
                  </p>
                  <p className="text-[11px] text-neutral-400">
                    {acc.localDataNotice}
                  </p>
                </div>
              </div>

              {/* Google Sign-in Button */}
              <button
                id="google-sign-in-modal-btn"
                type="button"
                onClick={handleGoogleLogin}
                disabled={authLoading}
                className="w-full py-3 px-4 bg-white hover:bg-neutral-100 text-black font-mono font-extrabold text-xs tracking-wider transition-all flex items-center justify-center gap-3 shadow-lg active:scale-98 cursor-pointer disabled:opacity-50"
              >
                {/* Google Multi-Color G Icon */}
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
                <span>{authLoading
                  ? window.electronAPI?.isElectron
                    ? (lang === 'uk' ? 'ОЧІКУЄМО ВХІД У БРАУЗЕРІ…' : 'WAITING FOR BROWSER SIGN-IN…')
                    : (lang === 'uk' ? 'ПІДКЛЮЧЕННЯ...' : 'CONNECTING...')
                  : acc.signInWithGoogle}</span>
              </button>

              <div className="text-[10px] font-mono text-neutral-500 text-center leading-relaxed">
                {lang === 'uk' 
                  ? 'При вході ваші поточні локальні завдання автоматично збережуться у вашому персональному хмарному профілі Google.'
                  : 'Upon sign in, your existing local tasks will be backed up to your personal Google Cloud profile.'}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 px-5 py-3 border-t border-neutral-800/80 bg-[#0a0a0c] flex items-center justify-between text-[10px] font-mono text-neutral-400">
          <span>KARKAS // SECURE CLOUD</span>
          <button
            onClick={onClose}
            className="hover:text-white transition-colors cursor-pointer"
          >
            [ESC] {lang === 'uk' ? 'ЗАКРИТИ' : 'CLOSE'}
          </button>
        </div>
      </motion.div>
    </div>
  );
};
