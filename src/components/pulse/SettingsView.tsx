import React, { useEffect, useRef, useState } from 'react';
import { Archive, ChevronLeft } from 'lucide-react';
import type { Language } from '../../utils/i18n';
import { SoftHatch } from '../SoftHatch';
import './settings.css';

type Tab = 'look' | 'account';
type UpdateState = 'idle' | 'checking' | 'latest' | 'available' | 'error';

export interface SettingsViewProps {
  lang: Language;
  zoomPercent: number;
  minZoom: number;
  maxZoom: number;
  defaultZoom: number;
  onZoomChange: (zoomPercent: number) => void;
  launchAtStartup: boolean | null;
  startupPending: boolean;
  onLaunchAtStartupChange: (enabled: boolean) => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
  motionEnabled: boolean;
  onToggleMotion: () => void;
  onSetLang: (lang: Language) => void;
  appVersion: string;
  /** Resolves with the newer release tag, or null when this version is the latest. */
  onCheckUpdate: () => Promise<string | null>;
  onOpenUpdates: () => void;
  aiConnected: boolean;
  onOpenAI: () => void;
  account: { name: string; detail: string; avatarUrl?: string | null } | null;
  onSync: () => void;
  onLogin: () => void;
  onLogout: () => void;
  onClearCompleted?: () => void;
  onOpenArchive?: () => void;
  archiveCount?: number;
  onClose: () => void;
}

const COPY = {
  uk: {
    title: ['Мої', 'налаштування'], section: 'Розділ налаштувань', tabs: { look: 'Вигляд', account: 'Акаунт' } as Record<Tab, string>,
    back: 'Назад', language: 'Мова', behaviour: 'Поведінка', sound: 'Звуки', motion: 'Анімації', startup: 'Запуск разом із Windows',
    completed: 'Виконані задачі', clear: 'Очистити', size: 'Розмір інтерфейсу', sample: 'Холодні дзвінки · 17%', smaller: 'Зменшити', bigger: 'Збільшити',
    sizeGroup: 'Розмір', reset: 'Скинути до 100%', aiConnected: 'Ключ API підключено', aiMissing: 'Працює без власного ключа', change: 'Змінити', connect: 'Підключити',
    aiHint: 'Модель і ключ налаштовуються в самому Karkas AI.', open: 'Відкрити Karkas AI',
    version: 'Версія', check: 'Перевірити', checking: 'Шукаю…', searching: 'Шукаю оновлення…', current: 'Актуальна', checked: 'перевірено щойно',
    available: (tag: string) => 'Доступна ' + tag, update: 'Оновити', failed: 'Не вдалося перевірити', guest: 'Гість', guestDetail: 'Дані зберігаються лише на цьому пристрої',
    sync: 'Синхронізувати', logout: 'Вийти', login: 'Увійти', keys: 'Гарячі клавіші',
    keyList: [['Karkas AI', 'Ctrl K'], ['Нова задача', 'Ctrl N'], ['Пошук', 'Ctrl F'], ['Додати й почати наступну', 'Enter'], ['Закрити рядок', 'Esc'], ['Більше параметрів задачі', 'Shift Enter']],
  },
  en: {
    title: ['My', 'settings'], section: 'Settings section', tabs: { look: 'Look', account: 'Account' } as Record<Tab, string>,
    back: 'Back', language: 'Language', behaviour: 'Behaviour', sound: 'Sounds', motion: 'Animations', startup: 'Start with Windows',
    completed: 'Completed tasks', clear: 'Clear', size: 'Interface size', sample: 'Cold calling · 17%', smaller: 'Smaller', bigger: 'Bigger',
    sizeGroup: 'Size', reset: 'Reset to 100%', aiConnected: 'API key connected', aiMissing: 'Works without your own key', change: 'Change', connect: 'Connect',
    aiHint: 'The model and key are set in Karkas AI itself.', open: 'Open Karkas AI',
    version: 'Version', check: 'Check', checking: 'Checking…', searching: 'Looking for updates…', current: 'Up to date', checked: 'checked just now',
    available: (tag: string) => tag + ' available', update: 'Update', failed: 'Could not check', guest: 'Guest', guestDetail: 'Data stays on this device only',
    sync: 'Sync', logout: 'Sign out', login: 'Sign in', keys: 'Keyboard shortcuts',
    keyList: [['Karkas AI', 'Ctrl K'], ['New task', 'Ctrl N'], ['Search', 'Ctrl F'], ['Add and start the next', 'Enter'], ['Close the line', 'Esc'], ['More task options', 'Shift Enter']],
  },
};
const SIZES = [{ label: 'S', value: 90 }, { label: 'M', value: 100 }, { label: 'L', value: 115 }, { label: 'XL', value: 130 }];
const ZOOM_STEP = 5;


function Switch({ label, on, disabled, onToggle }: { label: string; on: boolean; disabled?: boolean; onToggle: () => void }) {
  return <div className="st-row">
    <span className="st-row-label">{label}</span>
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className="st-switch" data-on={on} onClick={onToggle}><span /></button>
  </div>;
}

/** «Мої налаштування» as a page, as in Settings.dc.html. */
export function SettingsView(props: SettingsViewProps) {
  const { lang, zoomPercent, minZoom, maxZoom, defaultZoom, onZoomChange } = props;
  const copy = COPY[lang];
  const [tab, setTab] = useState<Tab>('look');
  const [update, setUpdate] = useState<UpdateState>('idle');
  const [release, setRelease] = useState('');
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null);
  const avatarUrl = props.account?.avatarUrl && props.account.avatarUrl !== failedAvatarUrl ? props.account.avatarUrl : null;
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) props.onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [props.onClose]);
  const clamp = (value: number) => Math.min(maxZoom, Math.max(minZoom, value));
  const nearest = SIZES.reduce((best, size) => Math.abs(size.value - zoomPercent) < Math.abs(best.value - zoomPercent) ? size : best, SIZES[0]);
  const fill = Math.round((zoomPercent - minZoom) / (maxZoom - minZoom) * 100);
  const scale = zoomPercent / 100;
  const check = async () => {
    if (update === 'checking') return;
    if (update === 'available') { props.onOpenUpdates(); return; }
    setUpdate('checking');
    const started = Date.now();
    let next: UpdateState = 'error', tag = '';
    try { const found = await props.onCheckUpdate(); next = found ? 'available' : 'latest'; tag = found ?? ''; } catch { next = 'error'; }
    // Let the fill finish so the check reads as work done, not a flicker.
    await new Promise(resolve => setTimeout(resolve, Math.max(0, 1600 - (Date.now() - started))));
    if (!alive.current) return;
    setRelease(tag); setUpdate(next);
  };
  const statusText = update === 'checking' ? copy.searching : update === 'latest' ? copy.checked : update === 'available' ? copy.available(release)
    : update === 'error' ? copy.failed : copy.current;

  return <div className="pulse-page-shell st-view">
    <div className="pulse-page-head">
      <div className="pulse-page-head-copy">
        <h1 className="pulse-page-title"><span className="pulse-page-title-light">{copy.title[0]}</span><span className="pulse-page-title-heavy">{copy.title[1]}</span></h1>
        <div className="st-tabs" role="tablist" aria-label={copy.section}>
          {(['look', 'account'] as Tab[]).map(value => <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)}>{copy.tabs[value]}</button>)}
        </div>
      </div>
      <div className="st-head-actions">
        {props.onOpenArchive && <button type="button" className="st-archive-link" onClick={props.onOpenArchive}><Archive size={19} aria-hidden="true" />{lang === 'uk' ? 'Архів' : 'Archive'}{props.archiveCount !== undefined && <span>{props.archiveCount}</span>}</button>}
        <button type="button" className="st-back" aria-label={copy.back} onClick={props.onClose}><ChevronLeft size={20} aria-hidden="true" /></button>
      </div>
    </div>

    {tab === 'look' && <div className="pulse-page-grid st-grid" key="look">
      <aside className="pulse-page-sidebar">
        <section className="st-card" aria-label={copy.language}>
          <span className="st-card-title">{copy.language}</span>
          <div className="st-segment" role="radiogroup" aria-label={copy.language}>
            {([['uk', 'UA', 'Українська'], ['en', 'EN', 'English']] as const).map(([value, code, label]) => <button key={value} type="button" role="radio" aria-checked={lang === value} onClick={() => props.onSetLang(value)}><span>{code}</span>{label}</button>)}
          </div>
        </section>
        <section className="st-card st-card--list" aria-label={copy.behaviour}>
          <Switch label={copy.sound} on={props.soundEnabled} onToggle={props.onToggleSound} />
          <Switch label={copy.motion} on={props.motionEnabled} onToggle={props.onToggleMotion} />
          {props.launchAtStartup !== null && <Switch label={copy.startup} on={props.launchAtStartup} disabled={props.startupPending} onToggle={() => props.onLaunchAtStartupChange(!props.launchAtStartup)} />}
        </section>
      </aside>
      <div className="pulse-page-main">
        <section className="st-size" aria-label={copy.size}>
          <div className="st-size-head"><span className="st-size-title">{copy.size}</span><span className="st-size-pct">{zoomPercent}%</span></div>
          <div className="st-size-preview">
            <div aria-hidden="true" className="st-size-hatch" style={{ width: fill + '%' }}><SoftHatch color="#ffffff" motion={props.motionEnabled} /></div>
            <span className="st-size-sample"><span style={{ fontSize: Math.round(56 * scale) }}>Аа</span><span style={{ fontSize: Math.round(16 * scale) }}>{copy.sample}</span></span>
          </div>
          <div className="st-size-controls">
            <button type="button" className="st-size-step" aria-label={copy.smaller} disabled={zoomPercent <= minZoom} onClick={() => onZoomChange(clamp(zoomPercent - ZOOM_STEP))}>−</button>
            <div className="st-size-presets" role="radiogroup" aria-label={copy.sizeGroup}>
              {SIZES.map(size => <button key={size.label} type="button" role="radio" aria-checked={nearest.label === size.label} onClick={() => onZoomChange(clamp(size.value))}>{size.label}</button>)}
            </div>
            <button type="button" className="st-size-step" aria-label={copy.bigger} disabled={zoomPercent >= maxZoom} onClick={() => onZoomChange(clamp(zoomPercent + ZOOM_STEP))}>+</button>
          </div>
          <button type="button" className="st-size-reset" disabled={zoomPercent === defaultZoom} onClick={() => onZoomChange(defaultZoom)}>{copy.reset}</button>
        </section>
      </div>
    </div>}

    {tab === 'account' && <div className="pulse-page-grid st-grid" key="account">
      <aside className="pulse-page-sidebar">
        <section className="st-update" aria-label={copy.version} aria-busy={update === 'checking'}>
          {update === 'checking' && <div className="st-update-hatch" aria-hidden="true"><SoftHatch color="#13f287" motion={props.motionEnabled} /></div>}
          <span className="st-update-copy">
            <span className="st-update-version">{copy.version} {props.appVersion}</span>
            <span className="st-update-status" key={update} aria-live="polite" data-state={update}>
              {update === 'latest' && <span className="st-update-chip">{copy.current}</span>}{statusText}
            </span>
          </span>
          <button type="button" className={'st-small st-update-button' + (update === 'available' ? ' st-update-button--go' : '')} onClick={check}>{update === 'checking' ? copy.checking : update === 'available' ? copy.update : copy.check}</button>
        </section>
        <section className="st-card" aria-label="Karkas AI">
          <span className="st-card-title">Karkas AI</span>
          <div className="st-key">
            <span><span className="st-dot" style={{ background: props.aiConnected ? '#13f287' : '#8e8e93' }} />{props.aiConnected ? copy.aiConnected : copy.aiMissing}</span>
            <button type="button" className="st-small" onClick={props.onOpenAI}>{props.aiConnected ? copy.change : copy.connect}</button>
          </div>
          <span className="st-hint">{copy.aiHint}</span>
        </section>
      </aside>
      <div className="pulse-page-main">
        <section className="st-account" aria-label={copy.tabs.account}>
          <span className="st-avatar">{avatarUrl ? <img src={avatarUrl} alt="" referrerPolicy="no-referrer" onError={() => setFailedAvatarUrl(avatarUrl)} /> : (props.account?.name || copy.guest).split(/\s+/).filter(Boolean).slice(0, 2).map(part => Array.from(part)[0]).join('').toLocaleUpperCase(lang)}</span>
          <span className="st-account-copy"><span>{props.account?.name || copy.guest}</span><span>{props.account?.detail || copy.guestDetail}</span></span>
          {props.account ? <>
            <button type="button" className="st-account-dark" onClick={props.onSync}>{copy.sync}</button>
            <button type="button" className="st-account-light" onClick={props.onLogout}>{copy.logout}</button>
          </> : <button type="button" className="st-account-dark" onClick={props.onLogin}>{copy.login}</button>}
        </section>
        <section className="st-card st-card--list" aria-label={copy.keys}>
          <span className="st-card-title st-card-title--list">{copy.keys}</span>
          {copy.keyList.map(([label, combo]) => <div key={label} className="st-row st-row--key"><span className="st-row-label st-row-label--key">{label}</span><span className="st-combo">{combo}</span></div>)}
        </section>
      </div>
    </div>}
  </div>;
}
