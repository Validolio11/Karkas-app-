import React, { useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, Camera, Check, Cloud, LogOut, X } from 'lucide-react';
import type { Language } from '../../utils/i18n';
import { readAccountStorage, writeAccountStorage } from '../../utils/accountStorage';
import { KarkasLogo } from './KarkasLogo';
import './account.css';

type SyncStatus = 'idle' | 'pending' | 'syncing' | 'synced' | 'offline' | 'error';

export interface AccountViewProps {
  key?: React.Key;
  lang: Language;
  user: { id: string; name: string; email?: string | null; avatarUrl?: string | null } | null;
  onAvatarChange: (value: string | null) => void;
  isSyncing: boolean;
  syncStatus: SyncStatus;
  syncError: string | null;
  autoSyncEnabled: boolean;
  counts: { tasks: number; skills: number; measurements: number; notes: number };
  onLogin: () => Promise<void>;
  onLogout: () => Promise<void>;
  onSyncNow: () => Promise<void>;
  onRestoreFromCloud: () => Promise<void>;
  onToggleAutoSync: () => void;
  onClose: () => void;
}

const COPY = {
  uk: {
    region: 'Акаунт', steps: ['Вхід', 'Браузер', 'Синхронізація'], stepsLabel: 'Кроки', tagline: 'Задачі, навички й заміри — на всіх пристроях.',
    titles: { signin: ['Вхід', 'у Karkas'], browser: ['Майже', 'готово'], syncing: ['Синхро-', 'нізація'], done: ['Усе', 'на місці'] },
    devices: ['Цей ПК', 'Хмара', 'Інший пристрій'], signinTitle: 'Увійдіть, щоб синхронізувати', google: 'Увійти через Google',
    browserNote: 'Вхід відкриється у вашому браузері', popupNote: 'Вхід відкриється в окремому вікні',
    what: ['Задачі', 'Навички', 'Заміри', 'Нотатки'], guest: 'Без акаунта', guestNote: 'Дані лишаться на цьому комп’ютері', proceed: 'Продовжити',
    finish: 'Завершіть вхід у браузері', finishNote: 'Повернемося сюди автоматично', reopen: 'Відкрити ще раз', cancel: 'Скасувати',
    signedIn: 'Увійшли через Google', syncing: 'Синхронізуємо…', synced: 'Синхронізовано', offline: 'Офлайн · зміни збережено тут', failed: 'Не вдалося синхронізувати',
    items: ['Задачі', 'Навички й заміри', 'Висновки й нотатки', 'Налаштування'], syncNow: 'Синхронізувати', restore: 'Відновити з хмари',
    restoreConfirm: 'Замінити дані на цьому пристрої хмарною копією? Поточні дані збережемо в резервну копію.', auto: 'Автосинхронізація', logout: 'Вийти', done: 'Готово',
    close: 'Закрити', loginFailed: 'Не вдалося увійти через Google. Спробуйте ще раз.', popupBlocked: 'Браузер заблокував вікно входу. Дозвольте спливаючі вікна й спробуйте ще раз.',
  },
  en: {
    region: 'Account', steps: ['Sign in', 'Browser', 'Sync'], stepsLabel: 'Steps', tagline: 'Tasks, skills and measurements — on every device.',
    titles: { signin: ['Sign in', 'to Karkas'], browser: ['Almost', 'there'], syncing: ['Sync', 'in progress'], done: ['All', 'in place'] },
    devices: ['This PC', 'Cloud', 'Other device'], signinTitle: 'Sign in to sync', google: 'Sign in with Google',
    browserNote: 'Sign-in opens in your browser', popupNote: 'Sign-in opens in a separate window',
    what: ['Tasks', 'Skills', 'Measurements', 'Notes'], guest: 'Without an account', guestNote: 'Data stays on this computer', proceed: 'Continue',
    finish: 'Finish signing in in your browser', finishNote: 'We will come back here automatically', reopen: 'Open again', cancel: 'Cancel',
    signedIn: 'Signed in with Google', syncing: 'Syncing…', synced: 'Synced', offline: 'Offline · changes kept here', failed: 'Could not sync',
    items: ['Tasks', 'Skills and measurements', 'Lessons and notes', 'Settings'], syncNow: 'Sync', restore: 'Restore from cloud',
    restoreConfirm: 'Replace the data on this device with the cloud copy? Current data will be kept in a backup.', auto: 'Auto sync', logout: 'Sign out', done: 'Done',
    close: 'Close', loginFailed: 'Could not sign in with Google. Try again.', popupBlocked: 'The browser blocked the sign-in window. Allow pop-ups and try again.',
  },
};
const PROFILE_COPY = {
  uk: {
    title: ['Мій', 'профіль'], tagline: 'Ваш простір у Karkas.', account: 'Особисті дані',
    icon: 'Ваша іконка', add: 'Додати іконку', change: 'Змінити іконку', reset: 'Повернути початкову',
    formats: 'JPG, PNG або WebP · до 5 МБ', local: 'Іконка зберігається на цьому пристрої.',
    name: 'Ім’я', email: 'Електронна пошта', provider: 'Спосіб входу', noEmail: 'Не вказано',
    manageSync: 'Керувати синхронізацією', continue: 'До моїх справ', logout: 'Вийти з акаунта',
    session: 'Ви увійшли через Google', sessionNote: 'Можна повернутися до акаунта в будь-який момент.',
    uploading: 'Додаємо…', saved: 'Іконку збережено', resetDone: 'Початкову іконку відновлено',
    invalid: 'Оберіть зображення JPG, PNG або WebP розміром до 5 МБ.',
    imageFailed: 'Не вдалося додати іконку. Спробуйте інше зображення.', logoutFailed: 'Не вдалося вийти. Спробуйте ще раз.', signingOut: 'Виходимо…',
    ready: 'Акаунт підключено',
  },
  en: {
    title: ['My', 'profile'], tagline: 'Your space in Karkas.', account: 'Personal details',
    icon: 'Your icon', add: 'Add an icon', change: 'Change icon', reset: 'Restore original',
    formats: 'JPG, PNG or WebP · up to 5 MB', local: 'Your icon is saved on this device.',
    name: 'Name', email: 'Email address', provider: 'Sign-in method', noEmail: 'Not provided',
    manageSync: 'Manage sync', continue: 'Back to my tasks', logout: 'Sign out',
    session: 'Signed in with Google', sessionNote: 'You can sign back in at any time.',
    uploading: 'Adding…', saved: 'Icon saved', resetDone: 'Original icon restored',
    invalid: 'Choose a JPG, PNG or WebP image up to 5 MB.',
    imageFailed: 'Could not add the icon. Try another image.', logoutFailed: 'Could not sign out. Try again.', signingOut: 'Signing out…',
    ready: 'Account connected',
  },
};

const PROFILE_READY_KEY = 'karkas.account-profile-ready';

/** Decode and crop locally; original files never leave this device. */
async function prepareAvatar(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Image could not be decoded'));
      image.src = url;
    });
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    if (!side) throw new Error('Empty image');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image processing unavailable');
    context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
    return canvas.toDataURL('image/png');
  } finally { URL.revokeObjectURL(url); }
}
const TILE_ICONS = ['M9 11l3 3 8-8M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9', 'M3 17l6-6 4 4 8-8M15 7h6v6', 'M3 3v18h18M7 15v2M12 10v7M17 6v11',
  'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5'];
const TILE_COLORS = [['#090a0a', '#ffffff'], ['#13f287', '#090a0a'], ['#6408fa', '#ffffff'], ['#f4f4f2', '#090a0a']];
const DEVICE_ICONS = ['M3 5h18v11H3zM8 20h8M12 16v4', 'M17.5 19a4.5 4.5 0 1 0-1.4-8.8A6 6 0 0 0 4.5 13 3 3 0 0 0 6 19z', 'M5 6h14v9H5zM2 18h20'];

function Hatch({ color }: { color: string }) {
  const id = useId().replace(/:/g, '');
  return <svg width="100%" height="100%" style={{ display: 'block' }} aria-hidden="true"><defs><pattern id={id} x="0" width="9" height="40" patternUnits="userSpaceOnUse" patternTransform="rotate(10)">
    <animate attributeName="x" from="0" to="9" dur="0.35s" repeatCount="indefinite" />
    <line x1="1.5" y1="-10" x2="1.5" y2="50" stroke={color} strokeWidth="2" />
  </pattern></defs><rect width="100%" height="100%" fill={'url(#' + id + ')'} /></svg>;
}
const Icon = ({ d, size = 28 }: { d: string; size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;

/** Sign-in and sync as a page, as in Auth.dc.html. */
export function AccountView(props: AccountViewProps) {
  const { lang, user, isSyncing, syncStatus } = props;
  const copy = COPY[lang];
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState('');
  const [pct, setPct] = useState(isSyncing ? 0 : 100);
  const [showProfile, setShowProfile] = useState(() => {
    try { return !!user && readAccountStorage(localStorage, PROFILE_READY_KEY, user.id) === 'true'; }
    catch { return false; }
  });
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarNotice, setAvatarNotice] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const profileHeading = useRef<HTMLHeadingElement>(null);
  const uploadAttempt = useRef(0);
  const profileCopy = PROFILE_COPY[lang];
  const attempt = useRef(0);
  useEffect(() => () => { uploadAttempt.current++; attempt.current++; }, []);
  useEffect(() => { if (showProfile) profileHeading.current?.focus({ preventScroll: true }); }, [showProfile]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) props.onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [props.onClose]);
  // Real sync has no byte progress: the bar eases towards 90% while it runs and closes on completion.
  useEffect(() => {
    if (!user) return;
    if (!isSyncing) { setPct(100); return; }
    setPct(0);
    const timer = window.setInterval(() => setPct(value => Math.min(90, value + Math.max(1, Math.round((90 - value) / 8)))), 120);
    return () => window.clearInterval(timer);
  }, [isSyncing, user]);
  useEffect(() => { if (user) setSigningIn(false); }, [user]);

  const login = async () => {
    const id = ++attempt.current;
    setError(''); setSigningIn(true);
    try { await props.onLogin(); }
    catch (err) {
      if (id !== attempt.current) return;
      const code = (err as { code?: string })?.code ?? '';
      setError(code.includes('popup-blocked') ? copy.popupBlocked : copy.loginFailed);
    } finally { if (id === attempt.current) setSigningIn(false); }
  };
  const cancel = () => { attempt.current++; setSigningIn(false); };
  const run = async (action: () => Promise<void>) => { setError(''); try { await action(); } catch { setError(copy.failed); } };
  const finish = () => {
    if (!user) return;
    try { writeAccountStorage(localStorage, PROFILE_READY_KEY, user.id, 'true'); } catch { /* Navigation still works without storage. */ }
    setError(''); setShowProfile(true);
  };
  const changeAvatar = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(''); setAvatarNotice('');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setError(profileCopy.invalid); return;
    }
    const id = ++uploadAttempt.current;
    setAvatarBusy(true);
    try {
      const value = await prepareAvatar(file);
      if (id !== uploadAttempt.current) return;
      props.onAvatarChange(value);
      setAvatarNotice(profileCopy.saved);
    } catch { if (id === uploadAttempt.current) setError(profileCopy.imageFailed); }
    finally { if (id === uploadAttempt.current) setAvatarBusy(false); }
  };
  const resetAvatar = () => {
    setError(''); setAvatarNotice('');
    try { props.onAvatarChange(null); setAvatarNotice(profileCopy.resetDone); }
    catch { setError(profileCopy.imageFailed); }
  };
  const logout = async () => {
    if (loggingOut) return;
    setLoggingOut(true); setError('');
    try { await props.onLogout(); }
    catch { setError(profileCopy.logoutFailed); }
    finally { setLoggingOut(false); }
  };

  const step = user ? 2 : signingIn ? 1 : 0;
  const synced = !!user && !isSyncing && pct >= 100;
  const titles = user ? (synced ? copy.titles.done : copy.titles.syncing) : signingIn ? copy.titles.browser : copy.titles.signin;
  const flow = !user ? (signingIn ? .25 : 0) : .5 + .5 * pct / 100;
  const deviceOn = [true, !!user, synced];
  const thresholds = [25, 50, 75, 100];
  const counts = [String(props.counts.tasks), props.counts.skills + ' · ' + props.counts.measurements, String(props.counts.notes), '—'];
  const desktop = typeof window !== 'undefined' && !!(window as Window & { karkasDesktop?: unknown }).karkasDesktop;
  const initials = (user?.name || '').split(/\s+/).filter(Boolean).slice(0, 2).map(part => Array.from(part)[0]).join('').toLocaleUpperCase(lang) || 'K';
  const statusLine = syncStatus === 'offline' ? copy.offline : syncStatus === 'error' || props.syncError ? copy.failed : null;
  const avatarUrl = user?.avatarUrl && user.avatarUrl !== failedAvatar ? user.avatarUrl : null;

  if (showProfile && user) return <div className="ac-view ac-view--profile">
    <button type="button" className="ac-close" aria-label={copy.close} onClick={props.onClose}><X size={20} aria-hidden="true" /></button>
    <div className="ac-hero ac-profile-hero">
      <span className="ac-profile-eyebrow">Karkas / {copy.region}</span>
      <h1 className="pulse-page-title" ref={profileHeading} tabIndex={-1}><span className="pulse-page-title-light">{profileCopy.title[0]}</span><span className="pulse-page-title-heavy">{profileCopy.title[1]}</span></h1>
      <span className="ac-tagline">{profileCopy.tagline}</span>
      <span className="ac-profile-connected"><Check size={15} aria-hidden="true" />{profileCopy.ready}</span>
      <button type="button" className="ac-profile-sync-link" onClick={() => { setError(''); setShowProfile(false); }}><Cloud size={18} aria-hidden="true" />{profileCopy.manageSync}<ArrowRight size={16} aria-hidden="true" /></button>
    </div>
    <div className="ac-profile-column">
      <section className="ac-profile-card ac-swap" aria-label={profileCopy.account}>
        <h2>{profileCopy.account}</h2>
        <div className="ac-profile-icon-row">
          <button type="button" className="ac-profile-avatar" aria-label={avatarUrl ? profileCopy.change : profileCopy.add} disabled={avatarBusy || loggingOut} onClick={() => fileInput.current?.click()}>
            {avatarUrl ? <img src={avatarUrl} alt="" referrerPolicy="no-referrer" onError={() => setFailedAvatar(avatarUrl)} /> : <span>{initials}</span>}
            <span className="ac-profile-camera"><Camera size={18} aria-hidden="true" /></span>
          </button>
          <div className="ac-profile-icon-copy">
            <span>{profileCopy.icon}</span>
            <button type="button" className="ac-profile-upload" disabled={avatarBusy || loggingOut} onClick={() => fileInput.current?.click()}>{avatarBusy ? profileCopy.uploading : avatarUrl ? profileCopy.change : profileCopy.add}</button>
            <span className="ac-profile-formats">{profileCopy.formats}</span>
            {user.avatarUrl?.startsWith('data:') && <button type="button" className="ac-profile-reset" disabled={avatarBusy || loggingOut} onClick={resetAvatar}>{profileCopy.reset}</button>}
          </div>
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={changeAvatar} />
        </div>
        <p className="ac-profile-local">{profileCopy.local}</p>
        <dl className="ac-profile-details">
          <div><dt>{profileCopy.name}</dt><dd>{user.name}</dd></div>
          <div><dt>{profileCopy.email}</dt><dd>{user.email || profileCopy.noEmail}</dd></div>
          <div><dt>{profileCopy.provider}</dt><dd><span className="ac-profile-provider">G</span>Google</dd></div>
        </dl>
        {error && <p className="ac-profile-error" role="alert">{error}</p>}
        {avatarNotice && <p className="ac-profile-notice" role="status">{avatarNotice}</p>}
        <button type="button" className="ac-profile-continue" onClick={props.onClose}>{profileCopy.continue}<ArrowRight size={20} aria-hidden="true" /></button>
      </section>
      <section className="ac-profile-session" aria-label={profileCopy.logout}>
        <span><span>{profileCopy.session}</span><span>{profileCopy.sessionNote}</span></span>
        <button type="button" disabled={loggingOut || avatarBusy} onClick={logout}><LogOut size={18} aria-hidden="true" />{loggingOut ? profileCopy.signingOut : profileCopy.logout}</button>
      </section>
    </div>
  </div>;

  return <div className="ac-view">
    <button type="button" className="ac-close" aria-label={copy.close} onClick={props.onClose}><X size={20} aria-hidden="true" /></button>
    <div className="ac-hero">
      <h1 className="pulse-page-title"><span className="pulse-page-title-light">{titles[0]}</span><span className="pulse-page-title-heavy">{titles[1]}</span></h1>
      <div className="ac-steps" role="list" aria-label={copy.stepsLabel}>
        {copy.steps.map((label, index) => <span key={label} role="listitem" aria-current={index === step ? 'step' : undefined} data-state={index === step ? 'current' : index < step ? 'past' : 'next'}><span />{label}</span>)}
      </div>
      <span className="ac-tagline">{copy.tagline}</span>
      <div className="ac-flow">
        <span className="ac-flow-track" />
        <span className="ac-flow-fill" style={{ width: 'calc((100% - 72px) * ' + flow + ')' }} />
        {copy.devices.map((label, index) => <span key={label} className="ac-device" data-on={deviceOn[index]}><span><Icon d={DEVICE_ICONS[index]} /></span><span>{label}</span></span>)}
      </div>
    </div>

    <section className="ac-card" aria-live="polite" aria-label={copy.region}>
      {!user && !signingIn && <div className="ac-swap" key="signin">
        <span className="ac-card-title">{copy.signinTitle}</span>
        <button type="button" className="ac-google" onClick={login}>{copy.google}<span><Icon d="M5 12h14M12 5l7 7-7 7" size={20} /></span></button>
        <span className="ac-note">{desktop ? copy.browserNote : copy.popupNote}</span>
        {error && <span role="alert" className="ac-error">{error}</span>}
        <div className="ac-tiles">
          {copy.what.map((label, index) => <div key={label} className="ac-tile" style={{ background: TILE_COLORS[index][0], color: TILE_COLORS[index][1] }}>
            {index === 1 && <div className="ac-tile-hatch"><Hatch color="#090a0a" /></div>}
            <Icon d={TILE_ICONS[index]} size={30} /><span>{label}</span>
          </div>)}
        </div>
        <div className="ac-guest">
          <span><span>{copy.guest}</span><span>{copy.guestNote}</span></span>
          <button type="button" onClick={props.onClose}>{copy.proceed}</button>
        </div>
      </div>}

      {!user && signingIn && <div className="ac-swap ac-browser" key="browser">
        <span className="ac-pulse"><KarkasLogo compact width={44} height={46} /></span>
        <span className="ac-browser-copy"><span>{copy.finish}</span><span>{copy.finishNote}</span></span>
        <div className="ac-browser-actions">
          <button type="button" className="ac-paper" onClick={login}>{copy.reopen}</button>
          <button type="button" className="ac-steel" onClick={cancel}>{copy.cancel}</button>
        </div>
      </div>}

      {user && <div className="ac-swap" key="sync">
        <span className="ac-user">
          <span className="ac-avatar">{avatarUrl ? <img src={avatarUrl} alt="" referrerPolicy="no-referrer" onError={() => setFailedAvatar(avatarUrl)} /> : initials}</span>
          <span className="ac-user-copy"><span>{user.name}</span><span>{user.email || copy.signedIn}</span></span>
        </span>
        <div className="ac-sync-head">
          <span>{synced ? copy.synced : copy.syncing}</span>
          <span style={{ color: synced ? '#13f287' : '#ffffff' }}>{pct}%</span>
        </div>
        <div className="ac-bar"><div style={{ width: pct + '%' }}><Hatch color="#090a0a" /></div></div>
        <div className="ac-items">
          {copy.items.map((label, index) => {
            const done = pct >= thresholds[index];
            return <div key={label} className="ac-item">
              <span>{label}</span><span>{counts[index]}</span>
              {done ? <span className="ac-item-done"><Icon d="M20 6 9 17l-5-5" size={13} /></span> : <span className="ac-item-wait" />}
            </div>;
          })}
        </div>
        {(statusLine || error) && <span role="alert" className="ac-error">{error || statusLine}</span>}
        <span className="ac-spacer" />
        <div className="ac-controls">
          <button type="button" className="ac-steel" disabled={isSyncing} onClick={() => run(props.onSyncNow)}>{copy.syncNow}</button>
          <button type="button" className="ac-steel" disabled={isSyncing} onClick={() => { if (window.confirm(copy.restoreConfirm)) void run(props.onRestoreFromCloud); }}>{copy.restore}</button>
          <span className="ac-auto">
            <span>{copy.auto}</span>
            <button type="button" role="switch" aria-checked={props.autoSyncEnabled} aria-label={copy.auto} className="ac-switch" data-on={props.autoSyncEnabled} onClick={props.onToggleAutoSync}><span /></button>
          </span>
          <button type="button" className="ac-steel" onClick={() => run(props.onLogout)}>{copy.logout}</button>
        </div>
        {synced && <button type="button" className="ac-done" onClick={finish}>{copy.done}</button>}
      </div>}
    </section>
  </div>;
}
