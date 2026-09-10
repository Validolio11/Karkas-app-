import React, { useState, useEffect } from 'react';
import { TaskTab, FilterMode, WorkflowStats } from '../types';
import { sound } from '../utils/audio';
import { Language, TRANSLATIONS } from '../utils/i18n';
import { Volume2, VolumeX, ChevronDown, Plus, Globe, Settings2, X, Check, LayoutDashboard, History, Cloud, RefreshCw, Minus, Square, Copy } from 'lucide-react';
import { AIIcon, AIIconId } from './AIIconTemplates';
import { User } from 'firebase/auth';

interface TopWorkflowMatrixProps {
  stats: WorkflowStats;
  tabs: TaskTab[];
  activeFilter: FilterMode;
  selectedPhase: string;
  soundEnabled: boolean;
  isAddOpen: boolean;
  lang: Language;
  aiIconVariant?: AIIconId;
  historyCount?: number;
  user?: User | null;
  isSyncing?: boolean;
  autoSyncEnabled?: boolean;
  isMinimized?: boolean;
  isFullscreen?: boolean;
  onMinimize?: () => void;
  onToggleFullscreen?: () => void;
  onCloseWindow?: () => void;
  onToggleSound: () => void;
  onToggleLang: () => void;
  onSetFilter: (filter: FilterMode) => void;
  onSelectPhase: (phase: string) => void;
  onToggleAdd: () => void;
  onOpenAI: () => void;
  onAddTab: (name: string) => void;
  onDeleteTab: (id: string) => void;
  onOpenManageTabs: () => void;
  onOpenAccount: () => void;
}

const TopWorkflowMatrixComponent: React.FC<TopWorkflowMatrixProps> = ({
  stats,
  tabs,
  activeFilter,
  selectedPhase,
  soundEnabled,
  isAddOpen,
  lang,
  aiIconVariant,
  historyCount = 0,
  user = null,
  isSyncing = false,
  autoSyncEnabled = true,
  isMinimized = false,
  isFullscreen = false,
  onMinimize,
  onToggleFullscreen,
  onCloseWindow,
  onToggleSound,
  onToggleLang,
  onSetFilter,
  onSelectPhase,
  onToggleAdd,
  onOpenAI,
  onAddTab,
  onDeleteTab,
  onOpenManageTabs,
  onOpenAccount,
}) => {
  const t = TRANSLATIONS[lang];
  const [isInlineAdding, setIsInlineAdding] = useState(false);
  const [inlineTabName, setInlineTabName] = useState('');

  const handleInlineAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inlineTabName.trim();
    if (!trimmed) {
      setIsInlineAdding(false);
      return;
    }
    sound.tick(600);
    onAddTab(trimmed);
    setInlineTabName('');
    setIsInlineAdding(false);
  };

  const handleElectronMinimize = () => {
    sound.tick(400);
    if (typeof window !== 'undefined' && (window as any).electronAPI) {
      (window as any).electronAPI.minimize();
    } else if (onMinimize) {
      onMinimize();
    }
  };

  const handleElectronMaximize = () => {
    sound.tick(500);
    if (typeof window !== 'undefined' && (window as any).electronAPI) {
      (window as any).electronAPI.maximize();
    } else if (onToggleFullscreen) {
      onToggleFullscreen();
    }
  };

  const handleElectronClose = () => {
    sound.tick(300);
    if (typeof window !== 'undefined' && (window as any).electronAPI) {
      (window as any).electronAPI.close();
    } else if (onCloseWindow) {
      onCloseWindow();
    }
  };

  return (
    <header id="windows-app-header" className="sticky top-0 z-30 bg-[#070709]/98 backdrop-blur-md border-b border-neutral-800/90 select-none">
      {/* 1. NATIVE WINDOWS TITLE BAR (TOPMOST ROW WITH CONTROLS & CAPTION BUTTONS) */}
      <div id="windows-titlebar" className="h-9 px-3 bg-[#0a0a0d] border-b border-neutral-800/80 flex items-center justify-between gap-2 app-drag-region">
        {/* Left: Windows 4-Tile Logo & Window Title */}
        <div className="flex items-center gap-2.5 shrink-0 app-drag-region">
          {/* Windows 4-Square Icon */}
          <div className="grid grid-cols-2 gap-[1.5px] w-3 h-3 text-neutral-300">
            <div className="w-1.5 h-1.5 bg-neutral-300 rounded-[0.5px]" />
            <div className="w-1.5 h-1.5 bg-neutral-300 rounded-[0.5px]" />
            <div className="w-1.5 h-1.5 bg-neutral-300 rounded-[0.5px]" />
            <div className="w-1.5 h-1.5 bg-neutral-300 rounded-[0.5px]" />
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs font-mono font-extrabold tracking-wider text-neutral-200 uppercase">
              {t.winTitlebar?.appTitle || 'KARKAS // TASK ARCHITECT'}
            </span>
            <span className="text-xs font-mono font-bold tracking-widest text-neutral-400 px-1 py-0.2 bg-neutral-900 border border-neutral-800 rounded-[2px] hidden sm:inline-block">
              {t.winTitlebar?.badge || 'WIN_x64'}
            </span>
          </div>
        </div>

        {/* Center & Right: App Action Buttons integrated right inside the Windows Title Bar Header */}
        <div className="flex items-center gap-1.5 sm:gap-2 flex-1 justify-end min-w-0 app-drag-region">
          {/* Cloud Account & Auto-Sync Trigger */}
          <button
            id="open-account-modal-btn"
            onClick={() => {
              sound.tick(500);
              onOpenAccount();
            }}
            title={
              user
                ? `${t.account.title} (${user.email || user.displayName}) • ${
                    isSyncing
                      ? t.account.syncing
                      : autoSyncEnabled
                      ? t.account.autoSyncStatus
                      : t.account.statusConnected
                  }`
                : t.account.title
            }
            className={`flex items-center gap-1.5 text-xs font-mono font-bold tracking-wider px-2 py-0.5 border transition-all cursor-pointer shrink-0 app-no-drag ${
              user
                ? isSyncing
                  ? 'border-amber-700/80 bg-amber-950/30 text-amber-300'
                  : autoSyncEnabled
                  ? 'border-emerald-800/80 bg-emerald-950/30 text-emerald-300 hover:border-emerald-500'
                  : 'border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-neutral-500'
                : 'border-neutral-800 bg-neutral-900 text-neutral-300 hover:text-white hover:border-neutral-600'
            }`}
          >
            {isSyncing ? (
              <RefreshCw className="w-3 h-3 text-amber-400 animate-spin shrink-0" />
            ) : user?.photoURL ? (
              <img
                src={user.photoURL}
                alt="Avatar"
                className="w-3 h-3 rounded-full object-cover shrink-0"
                referrerPolicy="no-referrer"
              />
            ) : (
              <Cloud className={`w-3 h-3 ${user ? (autoSyncEnabled ? 'text-emerald-400' : 'text-neutral-300') : 'text-neutral-400'}`} />
            )}
            <span className="hidden sm:inline">
              {isSyncing
                ? t.account.syncing
                : user
                ? user.displayName?.split(' ')[0] || user.email?.split('@')[0] || t.account.accountLabel
                : t.account.accountLabel}
            </span>
            {user && !isSyncing && (
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  autoSyncEnabled
                    ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)] animate-pulse'
                    : 'bg-neutral-500'
                }`}
              />
            )}
          </button>

          {/* Language Switcher */}
          <button
            id="lang-toggle-btn"
            onClick={() => {
              sound.tick(650);
              onToggleLang();
            }}
            title={lang === 'uk' ? 'Перемкнути на English' : 'Switch to Ukrainian'}
            className="flex items-center gap-1 text-xs font-mono font-bold tracking-wider px-2 py-0.5 border border-neutral-800 text-neutral-300 hover:text-white hover:border-neutral-600 bg-neutral-900 transition-colors shrink-0 app-no-drag"
          >
            <Globe className="w-2.5 h-2.5 text-neutral-400" />
            <span>{lang === 'uk' ? 'УКР' : 'ENG'}</span>
          </button>

          {/* Sound Toggle */}
          <button
            id="sound-toggle-btn"
            onClick={onToggleSound}
            title={soundEnabled ? (lang === 'uk' ? 'Вимкнути звук' : 'Mute sound') : (lang === 'uk' ? 'Увімкнути звук' : 'Unmute sound')}
            className="p-1 border border-neutral-800 text-neutral-400 hover:text-white hover:border-neutral-700 bg-neutral-900 transition-colors shrink-0 app-no-drag"
          >
            {soundEnabled ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
          </button>

          {/* AI Copilot Summon Button with Dynamic Selected AIIcon */}
          <button
            id="summon-ai-btn"
            onClick={() => {
              sound.activate();
              onOpenAI();
            }}
            title={lang === 'uk' ? 'Розумний Karkas Ai планувальник' : 'Smart Karkas Ai Planner'}
            className="flex items-center gap-1.5 text-xs font-mono font-bold tracking-wider px-2 py-0.5 bg-neutral-900 border border-neutral-700 hover:border-white text-neutral-200 hover:text-white transition-all cursor-pointer shrink-0 app-no-drag"
          >
            <AIIcon id={aiIconVariant} className="w-3 h-3 text-neutral-300" />
            <span className="hidden sm:inline">KARKAS AI</span>
          </button>

          {/* Quick Add Toggle Button */}
          <button
            id="top-quick-add-btn"
            onClick={() => {
              sound.tick(600);
              onToggleAdd();
            }}
            className={`flex items-center gap-1 text-xs font-mono font-bold tracking-wider px-2 py-0.5 border transition-all shrink-0 app-no-drag ${
              isAddOpen
                ? 'bg-white text-black border-white'
                : 'bg-neutral-900 text-neutral-200 border-neutral-700 hover:border-white'
            }`}
          >
            <Plus className="w-3 h-3" />
            <span>{t.inject}</span>
          </button>

          {/* Windows Titlebar Divider */}
          <div className="w-[1px] h-4 bg-neutral-800 shrink-0 mx-0.5" />

          {/* 2. AUTHENTIC WINDOWS WINDOW CONTROL BUTTONS (MINIMIZE, MAXIMIZE/RESTORE, CLOSE) */}
          <div className="flex items-center -mr-3 h-9 app-no-drag">
            {/* Minimize Button */}
            <button
              id="win-btn-minimize"
              type="button"
              onClick={handleElectronMinimize}
              title={t.winTitlebar?.minimize || 'Minimize'}
              className="w-10 h-9 flex items-center justify-center text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer app-no-drag"
            >
              <Minus className="w-3 h-3 stroke-[2.5]" />
            </button>

            {/* Maximize / Restore Button */}
            <button
              id="win-btn-maximize"
              type="button"
              onClick={handleElectronMaximize}
              title={isFullscreen ? (t.winTitlebar?.restore || 'Restore') : (t.winTitlebar?.maximize || 'Maximize')}
              className="w-10 h-9 flex items-center justify-center text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer app-no-drag"
            >
              {isFullscreen ? (
                <Copy className="w-2.5 h-2.5 stroke-[2]" />
              ) : (
                <Square className="w-2.5 h-2.5 stroke-[2]" />
              )}
            </button>

            {/* Close Button with Signature Windows Red Hover */}
            <button
              id="win-btn-close"
              type="button"
              onClick={handleElectronClose}
              title={t.winTitlebar?.close || 'Close'}
              className="w-10 h-9 flex items-center justify-center text-neutral-400 hover:text-white hover:bg-[#e81123] transition-colors cursor-pointer app-no-drag"
            >
              <X className="w-3.5 h-3.5 stroke-[2.5]" />
            </button>
          </div>
        </div>
      </div>

      {/* 2. WORKFLOW MATRIX BAR & TABS (DOCKED DIRECTLY UNDER WINDOWS TITLE BAR) */}
      <div className="pt-4 pb-3 px-5 sm:px-8 app-no-drag">
        {/* Visual Timeline & Progress Matrix Bar */}
        <div className="mb-2">
          <div className="flex items-center justify-between flex-wrap gap-3 text-xs font-mono text-neutral-400 mb-3">
            <div className="flex items-center gap-2">
              <span className="text-white font-bold">{stats.completed}/{stats.total} {t.delivered}</span>
              <span className="text-neutral-600">//</span>
              <span>{stats.percent}% {t.complete}</span>
            </div>
            <div className="flex items-center gap-3">
              {/* Filter Toggle (ALL / ACTIVE / DONE) */}
              <div className="flex items-center gap-1 text-xs">
                {(['ALL', 'ACTIVE', 'DONE'] as FilterMode[]).map((f) => (
                  <button
                    key={f}
                    id={`filter-btn-${f.toLowerCase()}`}
                    onClick={() => {
                      sound.tick(500);
                      onSetFilter(f);
                    }}
                    className={`px-1.5 py-0.5 border font-mono transition-colors ${
                      activeFilter === f
                        ? 'border-white text-white bg-neutral-800'
                        : 'border-transparent text-neutral-500 hover:text-neutral-300'
                    }`}
                  >
                    {t.filters[f]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Segmented Visual Progress Rail */}
          <div className="w-full h-1 bg-neutral-900 overflow-hidden border border-neutral-800 flex">
            <div
              className="h-full bg-white transition-all duration-300"
              style={{ width: `${stats.percent}%` }}
            />
          </div>
        </div>

        {/* Horizontal Interactive Dynamic Tabs Rail */}
        <div className="flex items-center justify-between gap-1.5 w-full">
          {/* Left: Scrollable Tabs Container */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none flex-1 min-w-0">
            {/* DASHBOARD Tab Button */}
            <button
              id="phase-filter-dashboard"
              onClick={() => {
                sound.tick(600);
                onSelectPhase('DASHBOARD');
              }}
              className={`flex items-center gap-1.5 text-xs font-mono tracking-wider px-3 py-2 border whitespace-nowrap transition-all shrink-0 cursor-pointer ${
                selectedPhase === 'DASHBOARD'
                  ? 'border-white bg-white text-black font-extrabold'
                  : 'border-neutral-800 bg-[#09090b] text-neutral-300 hover:text-white hover:border-neutral-600'
              }`}
            >
              <LayoutDashboard className={`w-3 h-3 ${selectedPhase === 'DASHBOARD' ? 'text-black' : 'text-neutral-400'}`} />
              <span className="font-bold">{t.dashboard || (lang === 'uk' ? 'ДАШБОРД' : 'DASHBOARD')}</span>
            </button>

            {/* ALL Tab */}
            <button
              id="phase-filter-all"
              onClick={() => {
                sound.tick(600);
                onSelectPhase('ALL');
              }}
              className={`flex items-center gap-1.5 text-xs font-mono tracking-wider px-3 py-2 border whitespace-nowrap transition-all shrink-0 cursor-pointer ${
                selectedPhase === 'ALL'
                  ? 'border-white bg-neutral-100 text-black font-extrabold'
                  : 'border-neutral-800 bg-[#09090b] text-neutral-400 hover:text-white hover:border-neutral-600'
              }`}
            >
              <span>{t.phases.ALL}</span>
              <span className={`text-xs ${selectedPhase === 'ALL' ? 'text-black font-bold' : 'text-neutral-500'}`}>
                {stats.total}
              </span>
            </button>

            {/* Dynamic User Tabs */}
            {tabs.map((tab) => {
              const count = stats.phaseCounts[tab.id] || 0;
              const isSelected = selectedPhase === tab.id;
              const tabDisplayName = (t.phases as any)[tab.id] || tab.name;

              return (
                <button
                  key={tab.id}
                  id={`tab-btn-${tab.id}`}
                  onClick={() => {
                    sound.tick(600);
                    onSelectPhase(tab.id);
                  }}
                  style={
                    isSelected && tab.color
                      ? { borderBottomColor: tab.color, borderBottomWidth: '2px' }
                      : undefined
                  }
                  className={`flex items-center gap-1.5 text-xs font-mono tracking-wider px-3 py-2 border whitespace-nowrap transition-all shrink-0 cursor-pointer ${
                    isSelected
                      ? 'border-white bg-white text-black font-extrabold shadow-sm'
                      : 'border-neutral-800 bg-[#09090b] text-neutral-300 hover:text-white hover:border-neutral-600'
                  }`}
                >
                  {tab.color && (
                    <span
                      className="w-1.5 h-1.5 shrink-0 shadow-sm"
                      style={{ backgroundColor: tab.color }}
                    />
                  )}
                  <span>{tabDisplayName}</span>
                  <span className={`text-xs font-mono ${isSelected ? 'text-black font-bold' : 'text-neutral-500'}`}>
                    {count}
                  </span>
                </button>
              );
            })}

            {/* Inline Quick Add Tab Input or Button */}
            {isInlineAdding ? (
              <form onSubmit={handleInlineAdd} className="flex items-center gap-1 border border-white bg-black px-1 py-0.5 whitespace-nowrap">
                <input
                  type="text"
                  autoFocus
                  value={inlineTabName}
                  onChange={(e) => setInlineTabName(e.target.value)}
                  placeholder={t.tabNamePlaceholder}
                  maxLength={20}
                  className="bg-transparent text-xs font-mono text-white placeholder:text-neutral-300 outline-none w-24 px-1"
                />
                <button
                  type="submit"
                  className="p-1 bg-white text-black hover:bg-neutral-200"
                  title={lang === 'uk' ? 'Зберегти вкладку' : 'Save tab'}
                >
                  <Check className="w-2.5 h-2.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsInlineAdding(false)}
                  className="p-1 text-neutral-400 hover:text-white"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </form>
            ) : (
              <button
                type="button"
                id="inline-add-tab-btn"
                onClick={() => {
                  sound.tick(500);
                  setIsInlineAdding(true);
                }}
                title={lang === 'uk' ? 'Додати нову вкладку' : 'Add new tab'}
                className="flex items-center gap-1 text-xs font-mono tracking-wider px-2 py-1 border border-dashed border-neutral-700 text-neutral-400 hover:text-white hover:border-white bg-[#09090b]/60 whitespace-nowrap transition-colors"
              >
                <Plus className="w-3 h-3" />
                <span>{t.addTab}</span>
              </button>
            )}

            {/* Tab Manager Modal Trigger */}
            <button
              type="button"
              id="manage-tabs-btn"
              onClick={() => {
                sound.tick(600);
                onOpenManageTabs();
              }}
              title={t.manageTabs}
              className="p-1.5 border border-neutral-800 bg-[#09090b] text-neutral-500 hover:text-white hover:border-neutral-600 transition-colors whitespace-nowrap"
            >
              <Settings2 className="w-3 h-3" />
            </button>
          </div>

          {/* RIGHT SIDE: History Button */}
          <div className="shrink-0 pb-1">
            <button
              id="phase-filter-history"
              onClick={() => {
                sound.tick(600);
                onSelectPhase('HISTORY');
              }}
              title={lang === 'uk' ? 'Історія виконаних та видалених завдань' : 'History of completed and deleted tasks'}
              className={`flex items-center gap-1.5 text-xs font-mono tracking-wider px-3 py-2 border whitespace-nowrap transition-all shrink-0 cursor-pointer ${
                selectedPhase === 'HISTORY'
                  ? 'border-white bg-white text-black font-extrabold'
                  : 'border-neutral-800 bg-[#09090b] text-neutral-300 hover:text-white hover:border-neutral-600'
              }`}
            >
              <History className={`w-3 h-3 ${selectedPhase === 'HISTORY' ? 'text-black' : 'text-neutral-400'}`} />
              <span className="font-bold">{t.history || (lang === 'uk' ? 'ІСТОРІЯ' : 'HISTORY')}</span>
              {historyCount !== undefined && historyCount > 0 && (
                <span
                  className={`text-xs font-mono px-1 py-0.2 ${
                    selectedPhase === 'HISTORY'
                      ? 'bg-black text-white font-bold'
                      : 'bg-neutral-800 text-neutral-400'
                  }`}
                >
                  {historyCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Pull-down Gesture Indicator (Clickable as well) */}
        <div
          id="pull-down-indicator"
          onClick={() => {
            sound.tick(500);
            onToggleAdd();
          }}
          className="w-full flex items-center justify-center pt-1.5 cursor-pointer text-xs font-mono tracking-widest text-neutral-400 hover:text-neutral-200 transition-colors"
        >
          <span className="flex items-center gap-1">
            <ChevronDown className={`w-3 h-3 transition-transform ${isAddOpen ? 'rotate-180' : ''}`} />
            <span>{isAddOpen ? t.collapseInput : t.pullDownToInject}</span>
          </span>
        </div>
      </div>
    </header>
  );
};

export const TopWorkflowMatrix = React.memo(TopWorkflowMatrixComponent);
