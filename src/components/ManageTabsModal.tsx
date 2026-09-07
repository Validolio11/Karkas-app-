import React, { useState, useEffect } from 'react';
import { TaskTab } from '../types';
import {
  Language,
  TRANSLATIONS,
  DEFAULT_TABS_UK,
  DEFAULT_TABS_EN,
  CREATIVE_TABS_UK,
  CREATIVE_TABS_EN,
  getRandomTabColor,
} from '../utils/i18n';
import { sound } from '../utils/audio';
import { X, Plus, Trash2, SquareCode, FolderKanban, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface ManageTabsModalProps {
  isOpen: boolean;
  tabs: TaskTab[];
  lang: Language;
  onClose: () => void;
  onAddTab: (name: string, color?: string) => void;
  onDeleteTab: (id: string) => void;
  onSetPresetTabs: (preset: TaskTab[]) => void;
  tabCounts: Record<string, number>;
}

export const ManageTabsModal: React.FC<ManageTabsModalProps> = ({
  isOpen,
  tabs,
  lang,
  onClose,
  onAddTab,
  onDeleteTab,
  onSetPresetTabs,
  tabCounts,
}) => {
  const [newTabName, setNewTabName] = useState('');
  const [activeColor, setActiveColor] = useState<string>(() => getRandomTabColor());
  const t = TRANSLATIONS[lang];

  useEffect(() => {
    if (isOpen) {
      setActiveColor(getRandomTabColor());
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleRollRandomColor = () => {
    sound.tick(700);
    setActiveColor(getRandomTabColor());
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newTabName.trim();
    if (!trimmed) return;
    sound.tick(600);
    onAddTab(trimmed, activeColor);
    setNewTabName('');
    setActiveColor(getRandomTabColor());
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          className="w-full max-w-lg bg-[#0d0d11] border border-neutral-800 shadow-2xl p-5 sm:p-6 flex flex-col gap-4 text-neutral-100"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-neutral-800/80 pb-3">
            <div className="flex items-center gap-2">
              <FolderKanban className="w-4 h-4 text-white" />
              <h2 className="text-sm font-bold tracking-wider font-mono uppercase">
                {t.tabsModal.title}
              </h2>
            </div>
            <button
              onClick={() => {
                sound.tick(400);
                onClose();
              }}
              className="p-1 text-neutral-400 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <p className="text-xs text-neutral-400 leading-relaxed">
            {t.tabsModal.desc}
          </p>

          {/* Add New Tab Form with Square Color Button */}
          <div className="flex flex-col gap-2">
            <form onSubmit={handleAdd} className="flex items-center gap-2">
              {/* Square Tab Color Button */}
              <button
                type="button"
                id="tab-color-shuffle-btn"
                onClick={handleRollRandomColor}
                title={lang === 'uk' ? 'Випадковий колір вкладки (клік — новий колір)' : 'Random tab color (click to roll new)'}
                className="w-9 h-9 shrink-0 bg-[#101014] border border-neutral-700 hover:border-white transition-all flex items-center justify-center relative group cursor-pointer"
              >
                {/* Square Color Swatch */}
                <span
                  className="w-4 h-4 border border-white/30 transition-transform group-hover:scale-110 shadow-sm"
                  style={{ backgroundColor: activeColor }}
                />
                {/* Tactical square micro-indicator */}
                <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-black border border-neutral-700 flex items-center justify-center">
                  <RefreshCw className="w-2 h-2 text-neutral-400 group-hover:text-white group-hover:rotate-180 transition-all duration-300" />
                </span>
              </button>

              <div className="relative flex-1">
                <input
                  type="text"
                  value={newTabName}
                  onChange={(e) => setNewTabName(e.target.value)}
                  placeholder={t.tabsModal.inputPlaceholder}
                  maxLength={24}
                  className="w-full bg-[#101014] border border-neutral-700 px-3 py-2 text-xs font-mono text-white placeholder:text-neutral-400 placeholder:font-normal focus:outline-none focus:border-white focus:ring-1 focus:ring-white transition-all"
                />
              </div>

              <button
                type="submit"
                disabled={!newTabName.trim()}
                className="px-4 py-2 bg-white text-black font-mono font-bold text-xs hover:bg-neutral-200 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-1.5 shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{t.tabsModal.addBtn}</span>
              </button>
            </form>
          </div>

          {/* Active Tabs List */}
          <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto pr-1">
            <span className="text-[10px] font-mono tracking-widest text-neutral-500 uppercase">
              {t.tabsModal.currentTabs} ({tabs.length})
            </span>
            <div className="grid grid-cols-1 gap-1.5">
              {tabs.map((tab) => {
                const count = tabCounts[tab.id] || 0;
                const canDelete = tabs.length > 1;

                return (
                  <div
                    key={tab.id}
                    className="flex items-center justify-between px-3 py-2 bg-neutral-900/80 border border-neutral-800 hover:border-neutral-700 transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      <span
                        className="w-2.5 h-2.5 shrink-0 border border-white/20 shadow-sm"
                        style={{ backgroundColor: tab.color || '#38bdf8' }}
                      />
                      <span className="text-xs font-mono font-bold uppercase tracking-wider text-neutral-200">
                        {tab.name}
                      </span>
                      <span className="text-[10px] font-mono text-neutral-500">
                        [{count} {lang === 'uk' ? 'справ' : 'tasks'}]
                      </span>
                    </div>

                    <button
                      type="button"
                      disabled={!canDelete}
                      onClick={() => {
                        sound.tick(350);
                        onDeleteTab(tab.id);
                      }}
                      title={canDelete ? t.deleteTab : t.tabsModal.cantDeleteLast}
                      className={`p-1.5 text-xs font-mono transition-colors flex items-center gap-1 ${
                        canDelete
                          ? 'text-neutral-500 hover:text-red-400 hover:bg-red-950/20'
                          : 'text-neutral-700 cursor-not-allowed'
                      }`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span className="text-[10px] hidden sm:inline">{lang === 'uk' ? 'Видалити' : 'Delete'}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Quick Presets Buttons */}
          <div className="border-t border-neutral-800/80 pt-3 flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={() => {
                sound.tick(650);
                onSetPresetTabs(lang === 'uk' ? DEFAULT_TABS_UK : DEFAULT_TABS_EN);
              }}
              className="flex-1 py-2 px-3 bg-neutral-900 border border-neutral-800 hover:border-neutral-600 text-left transition-colors"
            >
              <div className="flex items-center gap-1.5 text-[11px] font-mono font-bold text-neutral-200">
                <SquareCode className="w-3.5 h-3.5 text-emerald-400 fill-emerald-400/20" />
                <span>{t.tabsModal.resetLife}</span>
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                sound.tick(650);
                onSetPresetTabs(lang === 'uk' ? CREATIVE_TABS_UK : CREATIVE_TABS_EN);
              }}
              className="flex-1 py-2 px-3 bg-neutral-900 border border-neutral-800 hover:border-neutral-600 text-left transition-colors"
            >
              <div className="flex items-center gap-1.5 text-[11px] font-mono font-bold text-neutral-400 hover:text-neutral-200">
                <span>{t.tabsModal.resetCreative}</span>
              </div>
            </button>
          </div>

          {/* Close button */}
          <button
            type="button"
            onClick={() => {
              sound.tick(400);
              onClose();
            }}
            className="w-full py-2 bg-white text-black font-mono font-bold text-xs tracking-wider uppercase hover:bg-neutral-200 transition-colors"
          >
            {t.tabsModal.close}
          </button>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
