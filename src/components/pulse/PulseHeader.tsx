import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Copy, Minus, Plus, Search, Settings, Square, X } from 'lucide-react';
import type { Language } from '../../utils/i18n';
import { KarkasLogo } from './KarkasLogo';
import { PULSE_SHELL_STRINGS } from './pulseShellStrings';
import './pulseShell.css';

export type PulseTab = 'today' | 'growth' | 'notes';
export type PulseSyncStatus = 'idle' | 'pending' | 'syncing' | 'synced' | 'offline' | 'error';

export interface PulseHeaderProps {
  lang: Language;
  activeTab: PulseTab;
  onTabChange: (tab: PulseTab) => void;
  onSearch: () => void;
  searchOpen: boolean;
  searchValue: string;
  searchPlaceholder: string;
  onSearchChange: (value: string) => void;
  onSearchClose: () => void;
  searchInputRef?: RefObject<HTMLInputElement | null>;
  searchFocusToken?: number;
  onSettings: () => void;
  onAdd: () => void;
  onAccount: () => void;
  accountName?: string | null;
  accountAvatarUrl?: string | null;
  syncLabel?: string;
  syncStatus?: PulseSyncStatus;
  isFullscreen?: boolean;
  onMinimize?: () => void;
  onToggleFullscreen?: () => void;
  onCloseWindow?: () => void;
}

export function PulseHeader({
  lang, activeTab, onTabChange, onSearch, searchOpen, searchValue, searchPlaceholder,
  onSearchChange, onSearchClose, searchInputRef, searchFocusToken = 0, onSettings, onAdd, onAccount,
  accountName, accountAvatarUrl, syncLabel, syncStatus = 'idle', isFullscreen = false,
  onMinimize, onToggleFullscreen, onCloseWindow,
}: PulseHeaderProps) {
  const t = PULSE_SHELL_STRINGS[lang];
  const headerRef = useRef<HTMLElement>(null);
  const searchEntry = useRef<HTMLSpanElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const searchField = useRef<HTMLInputElement>(null);
  const searchFocusOrigin = useRef<Element | null>(null);
  const wasSearchOpen = useRef(false);
  const searchId = useId();
  const setSearchField = useCallback((node: HTMLInputElement | null) => {
    searchField.current = node;
    if (searchInputRef) searchInputRef.current = node;
  }, [searchInputRef]);
  const focusSearch = () => {
    const active = document.activeElement;
    if (searchOpen && (active === searchFocusOrigin.current || active === document.body || searchEntry.current?.contains(active))) searchField.current?.focus({ preventScroll: true });
  };
  useEffect(() => {
    const alreadyOpen = wasSearchOpen.current;
    wasSearchOpen.current = searchOpen;
    if (!searchOpen) return;
    searchFocusOrigin.current = document.activeElement;
    const reduce = document.documentElement.classList.contains('karkas-reduce-motion') || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const timer = window.setTimeout(focusSearch, alreadyOpen || reduce ? 0 : 360);
    return () => window.clearTimeout(timer);
  }, [searchOpen, searchFocusToken]);
  const closeSearch = () => {
    onSearchClose();
    requestAnimationFrame(() => searchButton.current?.focus({ preventScroll: true }));
  };
  useLayoutEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined' || !headerRef.current) return;
    const header = headerRef.current, style = document.documentElement.style;
    const property = '--pulse-header-height';
    const previous = style.getPropertyValue(property), priority = style.getPropertyPriority(property);
    let measured = '';
    const update = () => {
      // offsetHeight stays in logical CSS pixels even when the app is zoomed.
      if (header.offsetHeight <= 0) return;
      measured = `${header.offsetHeight}px`;
      if (style.getPropertyValue(property) !== measured) style.setProperty(property, measured);
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(header, { box: 'border-box' });
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect(); window.removeEventListener('resize', update);
      if (style.getPropertyValue(property) === measured) {
        if (previous) style.setProperty(property, previous, priority); else style.removeProperty(property);
      }
    };
  }, []);
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null);
  const avatarUrl = accountAvatarUrl && accountAvatarUrl !== failedAvatarUrl ? accountAvatarUrl : null;
  const name = accountName?.trim() || t.guest;
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => Array.from(part)[0]).join('').toLocaleUpperCase(lang);
  const accountTip = name + ' · ' + (syncLabel || t.sync[syncStatus]);
  const nativeWindow = () => typeof window === 'undefined' ? undefined : window.karkasDesktop?.window;
  const minimize = () => { const desktop = nativeWindow(); if (desktop) void desktop.minimize(); else onMinimize?.(); };
  const maximize = () => { const desktop = nativeWindow(); if (desktop) void desktop.toggleMaximize(); else onToggleFullscreen?.(); };
  // Keep the app's existing close-to-tray behavior.
  const close = () => { const desktop = nativeWindow(); if (desktop) void desktop.hide(); else onCloseWindow?.(); };
  const tabs: PulseTab[] = ['today', 'growth', 'notes'];

  return (
    <header ref={headerRef} id="windows-app-header" className="pulse-header app-drag-region" data-search-open={searchOpen}>
      <span className="pulse-header-logo" role="img" aria-label="Karkas"><KarkasLogo /></span>
      <nav className="pulse-header-nav app-no-drag" aria-label={t.sections}>
        {tabs.map(tab => <button key={tab} type="button" className="pulse-nav-tab app-no-drag"
          aria-label={t[tab]} aria-current={activeTab === tab ? 'page' : undefined} data-tip={t.tabTips[tab]}
          onClick={() => onTabChange(tab)}>{t[tab]}</button>)}
      </nav>
      <div className="pulse-header-actions app-no-drag">
        <span ref={searchEntry} className="pulse-header-search app-no-drag" data-open={searchOpen} onKeyDown={event => {
          if (searchOpen && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeSearch(); }
        }} onTransitionEnd={event => {
          if (event.target === event.currentTarget && event.propertyName === 'width') focusSearch();
        }}>
          <span className="pulse-header-search-field" role="search" aria-label={t.search} inert={!searchOpen}>
            <Search size={18} aria-hidden="true" />
            <input id={searchId} ref={setSearchField} type="search" value={searchValue} placeholder={searchPlaceholder} aria-label={searchPlaceholder}
              onChange={event => onSearchChange(event.target.value)} />
            <button type="button" className="pulse-header-search-close app-no-drag" aria-label={lang === 'uk' ? 'Закрити пошук' : 'Close search'} onClick={closeSearch}><X size={16} aria-hidden="true" /></button>
          </span>
          <button ref={searchButton} id="pulse-search-btn" type="button" className="pulse-round-button pulse-header-search-trigger app-no-drag"
            aria-label={t.search} aria-keyshortcuts="Control+f" data-tip={t.searchTip} aria-expanded={searchOpen} aria-controls={searchId}
            inert={searchOpen} tabIndex={searchOpen ? -1 : undefined} onClick={onSearch}>
            <Search size={18} aria-hidden="true" />
          </button>
        </span>
        <button type="button" className="pulse-round-button app-no-drag" aria-label={t.settings}
          data-tip={t.settings} onClick={onSettings}><Settings size={18} aria-hidden="true" /></button>
        <button id="pulse-quick-add-btn" type="button" className="pulse-header-add app-no-drag"
          aria-label={t.add} aria-keyshortcuts="Control+n" data-tip={t.addTip} onClick={onAdd}>
          <Plus size={16} strokeWidth={2.4} aria-hidden="true" /><span>{t.add}</span>
        </button>
        <button type="button" className="pulse-round-button pulse-account-button app-no-drag"
          aria-label={t.account + ' ' + accountTip} data-tip={accountTip} onClick={onAccount}>
          {avatarUrl ? <img src={avatarUrl} alt="" referrerPolicy="no-referrer" onError={() => setFailedAvatarUrl(avatarUrl)} /> : <span aria-hidden="true">{initials}</span>}
          <span className="pulse-sync-dot" data-sync-state={syncStatus} aria-hidden="true" />
        </button>
        <div className="pulse-window-controls app-no-drag" role="group" aria-label={t.window}>
          <button id="win-btn-minimize" type="button" aria-label={t.minimize} className="app-no-drag" onClick={minimize}>
            <Minus size={14} strokeWidth={2.4} aria-hidden="true" />
          </button>
          <button id="win-btn-maximize" type="button" aria-label={isFullscreen ? t.restore : t.maximize}
            className="app-no-drag" onClick={maximize}>
            {isFullscreen ? <Copy size={13} strokeWidth={2.4} aria-hidden="true" /> : <Square size={13} strokeWidth={2.4} aria-hidden="true" />}
          </button>
          <button id="win-btn-close" type="button" aria-label={t.close} className="pulse-window-close app-no-drag" onClick={close}>
            <X size={14} strokeWidth={2.4} aria-hidden="true" />
          </button>
        </div>
      </div>
    </header>
  );
}
