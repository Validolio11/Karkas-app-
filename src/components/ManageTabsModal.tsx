import React, { useState, useEffect, useRef } from 'react';
import { TaskTab } from '../types';
import {
  Language,
  TRANSLATIONS,
  DEFAULT_TABS_UK,
  DEFAULT_TABS_EN,
  getRandomTabColor,
} from '../utils/i18n';
import { sound } from '../utils/audio';
import { X, Plus, Trash2, Shuffle, LoaderCircle, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useDialogKeyboard } from './useDialogKeyboard';
import { AIIcon } from './AIIconTemplates';
import { karkasApiFetch } from '../utils/desktopApi';
import { AIRequestError, aiRequestErrorMessage, responseRequestError } from './aiAssistantState';

interface ManageTabsModalProps {
  isOpen: boolean;
  keyboardEnabled?: boolean;
  tabs: TaskTab[];
  lang: Language;
  onClose: () => void;
  onAddTab: (name: string, color?: string) => void;
  onDeleteTab: (id: string) => void;
  onSetPresetTabs: (preset: TaskTab[], moveTo?: Record<string, string>) => void;
  onUpdateTabColor?: (id: string, color: string) => void;
  tabCounts: Record<string, number>;
  /** What the assistant already knows; sent only when the person asks for a suggestion. */
  aiContext?: { goals: string[]; facts: string[]; taskTitles: string[] };
}

interface TabSuggestion { tabs: { name: string; color: string; fromTabIds: string[] }[]; explanation: string }

const readSuggestion = (value: unknown): TabSuggestion | null => {
  if (!value || typeof value !== 'object' || !Array.isArray((value as any).tabs)) return null;
  const tabs = (value as any).tabs.filter((tab: any) => tab && typeof tab.name === 'string' && tab.name.trim() && typeof tab.color === 'string')
    .map((tab: any) => ({ name: tab.name.trim().slice(0, 24), color: tab.color, fromTabIds: Array.isArray(tab.fromTabIds) ? tab.fromTabIds.filter((id: unknown) => typeof id === 'string') : [] }));
  return tabs.length >= 2 ? { tabs, explanation: typeof (value as any).explanation === 'string' ? (value as any).explanation : '' } : null;
};

const titleCase = (name: string) => name.charAt(0) + name.slice(1).toLocaleLowerCase();

/** Chat wording ("paste it below", "no task changes") does not fit this dialog. */
const suggestionErrorMessage = (error: unknown, lang: Language) => {
  if (error instanceof AIRequestError && error.code === 'MISSING_API_KEY') return lang === 'uk'
    ? 'Потрібен Gemini API-ключ. Додайте його в налаштуваннях Karkas AI і спробуйте ще раз.'
    : 'A Gemini API key is required. Add it in Karkas AI settings and try again.';
  return aiRequestErrorMessage(error, lang).replace(lang === 'uk' ? ' Зміни до завдань не застосовано.' : ' No task changes were applied.', '');
};

/** Chosen colours read well on the dark UI; a random one is still one click away. */
const TAB_PALETTE: { hex: string; uk: string; en: string }[] = [
  { hex: '#f43f5e', uk: 'Червоний', en: 'Red' },
  { hex: '#f97316', uk: 'Помаранчевий', en: 'Orange' },
  { hex: '#fbbf24', uk: 'Жовтий', en: 'Yellow' },
  { hex: '#a3e635', uk: 'Салатовий', en: 'Lime' },
  { hex: '#34d399', uk: 'Зелений', en: 'Green' },
  { hex: '#2dd4bf', uk: 'Бірюзовий', en: 'Teal' },
  { hex: '#38bdf8', uk: 'Блакитний', en: 'Sky' },
  { hex: '#818cf8', uk: 'Індиго', en: 'Indigo' },
  { hex: '#a855f7', uk: 'Фіолетовий', en: 'Purple' },
  { hex: '#ec4899', uk: 'Рожевий', en: 'Pink' },
  { hex: '#a3a3a3', uk: 'Сірий', en: 'Grey' },
];

const taskCountLabel = (count: number, lang: Language) => {
  if (lang !== 'uk') return `${count} ${count === 1 ? 'task' : 'tasks'}`;
  const mod10 = count % 10, mod100 = count % 100;
  const word = mod10 === 1 && mod100 !== 11 ? 'справа' : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'справи' : 'справ';
  return `${count} ${word}`;
};

const ColorPicker: React.FC<{ value: string; lang: Language; label: string; onChange: (color: string) => void }> = ({ value, lang, label, onChange }) => (
  <div role="radiogroup" aria-label={label} className="-ml-1 flex flex-wrap items-center gap-0.5">
    {TAB_PALETTE.map(color => {
      const selected = value.toLowerCase() === color.hex;
      return (
        <button
          key={color.hex}
          type="button"
          role="radio"
          aria-checked={selected}
          aria-label={lang === 'uk' ? color.uk : color.en}
          title={lang === 'uk' ? color.uk : color.en}
          onClick={() => { sound.tick(500); onChange(color.hex); }}
          className="inline-flex h-10 w-10 sm:h-8 sm:w-8 items-center justify-center transition-colors hover:bg-neutral-900 focus-visible:outline-2 focus-visible:outline-white"
        >
          <span
            aria-hidden="true"
            className={`h-4 w-4 transition-transform ${selected ? 'scale-110 ring-2 ring-white ring-offset-2 ring-offset-[#0c0c0e]' : ''}`}
            style={{ backgroundColor: color.hex }}
          />
        </button>
      );
    })}
    <button
      type="button"
      id="tab-color-shuffle-btn"
      aria-label={lang === 'uk' ? 'Випадковий колір' : 'Random color'}
      title={lang === 'uk' ? 'Випадковий колір' : 'Random color'}
      onClick={() => { sound.tick(700); onChange(getRandomTabColor()); }}
      className="inline-flex h-10 w-10 sm:h-8 sm:w-8 items-center justify-center text-neutral-500 transition-colors hover:bg-neutral-900 hover:text-white focus-visible:outline-2 focus-visible:outline-white"
    >
      <Shuffle className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  </div>
);

export const ManageTabsModal: React.FC<ManageTabsModalProps> = ({
  isOpen,
  keyboardEnabled = true,
  tabs,
  lang,
  onClose,
  onAddTab,
  onDeleteTab,
  onSetPresetTabs,
  onUpdateTabColor,
  tabCounts,
  aiContext,
}) => {
  const uk = lang === 'uk';
  const t = TRANSLATIONS[lang];
  const phases = t.phases as Record<string, string>;
  const nextColor = () => TAB_PALETTE.find(color => !tabs.some(tab => tab.color?.toLowerCase() === color.hex))?.hex || getRandomTabColor();
  const [newTabName, setNewTabName] = useState('');
  const [activeColor, setActiveColor] = useState<string>(nextColor);
  const [recoloringId, setRecoloringId] = useState<string | null>(null);
  const [confirmUniversal, setConfirmUniversal] = useState(false);
  const [activity, setActivity] = useState('');
  const [suggestion, setSuggestion] = useState<TabSuggestion | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState('');
  const suggestRequest = useRef<AbortController | null>(null);
  useDialogKeyboard(isOpen && keyboardEnabled, onClose, 'manage-tabs-dialog');
  useEffect(() => () => suggestRequest.current?.abort(), []);

  useEffect(() => {
    if (isOpen) {
      setActiveColor(nextColor());
      setRecoloringId(null);
      setConfirmUniversal(false);
      setSuggestion(null);
      setSuggestError('');
    } else {
      suggestRequest.current?.abort();
      setSuggesting(false);
    }
    // The suggested colour is chosen once per opening.
  }, [isOpen]);

  if (!isOpen) return null;

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newTabName.trim();
    if (!trimmed) return;
    sound.tick(600);
    onAddTab(trimmed, activeColor);
    setNewTabName('');
    setActiveColor(TAB_PALETTE.find(color => color.hex !== activeColor && !tabs.some(tab => tab.color?.toLowerCase() === color.hex))?.hex || getRandomTabColor());
  };

  const universalTabs = uk ? DEFAULT_TABS_UK : DEFAULT_TABS_EN;
  const universalNames = universalTabs.map(tab => phases[tab.id] ? titleCase(phases[tab.id]) : tab.name);
  const tabName = (id: string) => { const name = phases[id] || tabs.find(tab => tab.id === id)?.name || id; return name === name.toUpperCase() ? titleCase(name) : name; };
  const hasContext = !!activity.trim() || !!aiContext && (aiContext.goals.length > 0 || aiContext.facts.length > 0 || aiContext.taskTitles.length > 0);

  const requestSuggestion = async () => {
    if (suggesting || !hasContext) return;
    suggestRequest.current?.abort();
    const request = new AbortController();
    suggestRequest.current = request;
    const timeout = window.setTimeout(() => request.abort(), 35_000);
    setSuggesting(true);
    setSuggestError('');
    sound.activate();
    try {
      const custom = localStorage.getItem('karkas_custom_ai_enabled') === 'true';
      const response = await karkasApiFetch('/api/ai/suggest-tabs', {
        method: 'POST',
        signal: request.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lang,
          activity: activity.trim(),
          goals: aiContext?.goals.slice(0, 10) || [],
          facts: aiContext?.facts.slice(0, 12) || [],
          taskTitles: aiContext?.taskTitles.slice(0, 25) || [],
          currentTabs: tabs.map(tab => ({ id: tab.id, name: tabName(tab.id), taskCount: tabCounts[tab.id] || 0 })),
          customApiKey: custom ? localStorage.getItem('karkas_custom_api_key') || undefined : undefined,
          selectedModel: custom ? localStorage.getItem('karkas_custom_model') || undefined : undefined,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw responseRequestError(data, response.status);
      const next = readSuggestion(data);
      if (!next) throw responseRequestError({ code: 'INVALID_AI_RESPONSE' }, 502);
      if (suggestRequest.current === request) setSuggestion(next);
    } catch (error) {
      if (suggestRequest.current === request) setSuggestError(suggestionErrorMessage(request.signal.aborted
        ? Object.assign(new Error('timeout'), { name: 'TimeoutError' }) : error, lang));
    } finally {
      window.clearTimeout(timeout);
      if (suggestRequest.current === request) { suggestRequest.current = null; setSuggesting(false); }
    }
  };

  const applySuggestion = () => {
    if (!suggestion) return;
    const stamp = Date.now().toString(36);
    const moveTo: Record<string, string> = {};
    const nextTabs: TaskTab[] = suggestion.tabs.map((tab, index) => {
      const slug = tab.name.toLowerCase().replace(/[^a-zа-яіїєґ0-9]+/gi, '_').replace(/^_|_$/g, '') || 'tab';
      const id = `${slug}_${stamp}${index}`;
      tab.fromTabIds.forEach(oldId => { moveTo[oldId] = id; });
      return { id, name: tab.name, color: tab.color };
    });
    sound.tick(650);
    onSetPresetTabs(nextTabs, moveTo);
    setSuggestion(null);
    setActivity('');
  };
  const sectionLabel = 'text-[11px] font-bold uppercase tracking-wider text-neutral-400';
  const close = () => { sound.tick(400); onClose(); };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
        <motion.div
          id="manage-tabs-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="manage-tabs-title"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          className="flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden border border-neutral-800 bg-[#0c0c0e] font-sans text-neutral-100 shadow-2xl"
        >
          <header className="flex items-start justify-between gap-4 border-b border-neutral-800/80 px-5 py-4 sm:px-6">
            <div className="min-w-0">
              <h2 id="manage-tabs-title" className="text-sm font-bold uppercase tracking-wider text-white">
                {uk ? 'Вкладки' : 'Tabs'}
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-neutral-500">
                {uk ? 'Категорії для ваших завдань.' : 'Categories for your tasks.'}
              </p>
            </div>
            <button
              type="button"
              aria-label={uk ? 'Закрити налаштування вкладок' : 'Close tab settings'}
              onClick={close}
              className="-mr-2 -mt-1 inline-flex h-10 w-10 shrink-0 items-center justify-center text-neutral-400 transition-colors hover:bg-neutral-900 hover:text-white"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </header>

          <div className="flex-1 space-y-7 overflow-y-auto px-5 py-5 sm:px-6">
            {/* New tab */}
            <section aria-labelledby="manage-tabs-new" className="space-y-3">
              <h3 id="manage-tabs-new" className={sectionLabel}>{uk ? 'Нова вкладка' : 'New tab'}</h3>
              <form onSubmit={handleAdd} className="flex items-stretch gap-2">
                <div className="relative min-w-0 flex-1">
                  <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-3 w-3 -translate-y-1/2" style={{ backgroundColor: activeColor }} />
                  <input
                    type="text"
                    value={newTabName}
                    onChange={(e) => setNewTabName(e.target.value)}
                    placeholder={uk ? 'Назва, напр. Проєкти' : 'Name, e.g. Projects'}
                    aria-label={uk ? 'Назва нової вкладки' : 'New tab name'}
                    maxLength={24}
                    className="h-11 w-full border border-neutral-700 bg-[#08080a] pl-9 pr-3 text-sm text-white placeholder:text-neutral-500 transition-colors focus:border-white focus:outline-none"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!newTabName.trim()}
                  className="inline-flex h-11 shrink-0 items-center gap-1.5 bg-white px-4 text-sm font-bold text-black transition-colors hover:bg-neutral-200 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-500"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  {uk ? 'Додати' : 'Add'}
                </button>
              </form>
              <ColorPicker value={activeColor} lang={lang} label={uk ? 'Колір нової вкладки' : 'New tab color'} onChange={setActiveColor} />
            </section>

            {/* Existing tabs */}
            <section aria-labelledby="manage-tabs-current" className="space-y-3">
              <h3 id="manage-tabs-current" className={`${sectionLabel} flex items-baseline justify-between gap-2`}>
                {uk ? 'Ваші вкладки' : 'Your tabs'}
                <span className="font-mono font-normal tabular-nums text-neutral-600">{tabs.length}</span>
              </h3>
              <ul className="divide-y divide-neutral-800/80 border border-neutral-800">
                {tabs.map((tab) => {
                  const count = tabCounts[tab.id] || 0;
                  const canDelete = tabs.length > 1;
                  const name = phases[tab.id] || tab.name;
                  const color = tab.color || '#38bdf8';
                  const recoloring = recoloringId === tab.id;
                  return (
                    <li key={tab.id} className={recoloring ? 'bg-white/[0.02]' : ''}>
                      <div className="flex items-center gap-3 py-1 pl-1.5 pr-1">
                        {onUpdateTabColor ? (
                          <button
                            type="button"
                            aria-expanded={recoloring}
                            aria-controls={`tab-recolor-${tab.id}`}
                            aria-label={`${uk ? 'Змінити колір' : 'Change color'}: ${name}`}
                            title={uk ? 'Змінити колір' : 'Change color'}
                            onClick={() => { sound.tick(500); setRecoloringId(recoloring ? null : tab.id); }}
                            className={`inline-flex h-10 w-10 sm:h-8 sm:w-8 shrink-0 items-center justify-center transition-colors hover:bg-neutral-900 ${recoloring ? 'bg-neutral-900' : ''}`}
                          >
                            <span aria-hidden="true" className="h-3 w-3" style={{ backgroundColor: color }} />
                          </button>
                        ) : (
                          <span aria-hidden="true" className="ml-2.5 h-3 w-3 shrink-0" style={{ backgroundColor: color }} />
                        )}
                        <span title={name} className="min-w-0 flex-1 truncate text-sm font-semibold uppercase tracking-wide text-neutral-100">{name}</span>
                        <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-neutral-500">{taskCountLabel(count, lang)}</span>
                        <button
                          type="button"
                          disabled={!canDelete}
                          onClick={() => { sound.tick(350); onDeleteTab(tab.id); }}
                          title={canDelete ? t.deleteTab : t.tabsModal.cantDeleteLast}
                          aria-label={`${t.deleteTab}: ${name}`}
                          className="inline-flex h-10 w-10 sm:h-8 sm:w-8 shrink-0 items-center justify-center text-neutral-500 transition-colors hover:bg-red-950/30 hover:text-red-400 disabled:cursor-not-allowed disabled:text-neutral-800 disabled:hover:bg-transparent"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                      {recoloring && onUpdateTabColor && (
                        <div id={`tab-recolor-${tab.id}`} className="px-3 pb-3 pt-1">
                          <ColorPicker value={color} lang={lang} label={`${uk ? 'Колір вкладки' : 'Tab color'}: ${name}`}
                            onChange={next => { onUpdateTabColor(tab.id, next); setRecoloringId(null); }} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              <p className="text-xs leading-relaxed text-neutral-500">
                {uk ? 'Завдання з видаленої вкладки перейдуть у першу вкладку списку.' : 'Tasks from a deleted tab move to the first tab in the list.'}
              </p>
            </section>

            {/* Ready sets replace every tab, so both paths show what will happen before applying. */}
            <section aria-labelledby="manage-tabs-presets" className="space-y-3">
              <h3 id="manage-tabs-presets" className={sectionLabel}>{uk ? 'Готові набори' : 'Ready sets'}</h3>

              {confirmUniversal ? (
                <div role="alert" className="space-y-3 border border-amber-900/70 bg-amber-950/20 p-4">
                  <p className="text-[13px] leading-relaxed text-amber-100">
                    {uk
                      ? `Замінити всі вкладки (${tabs.length}) універсальним набором? Завдання з вкладок, яких у ньому немає, перейдуть у «${universalNames[0]}».`
                      : `Replace all ${tabs.length} tabs with the universal set? Tasks from tabs it lacks move to “${universalNames[0]}”.`}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => { sound.tick(650); onSetPresetTabs(universalTabs); setConfirmUniversal(false); }}
                      className="inline-flex min-h-10 items-center bg-amber-400 px-3 text-xs font-bold text-black transition-colors hover:bg-amber-300">
                      {uk ? 'Замінити вкладки' : 'Replace tabs'}
                    </button>
                    <button type="button" onClick={() => setConfirmUniversal(false)}
                      className="inline-flex min-h-10 items-center border border-neutral-700 px-3 text-xs text-neutral-300 transition-colors hover:border-white hover:text-white">
                      {uk ? 'Скасувати' : 'Cancel'}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => { sound.tick(500); setConfirmUniversal(true); }}
                  className="w-full min-w-0 border border-neutral-800 p-4 text-left transition-colors hover:border-neutral-600 hover:bg-white/[0.02]"
                >
                  <span className="block text-sm font-semibold text-neutral-100">{uk ? 'Універсальний' : 'Universal'}</span>
                  <span className="mt-1 block text-xs leading-relaxed text-neutral-500">{uk ? 'Підходить більшості людей.' : 'Fits most people.'}</span>
                  <span className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-400">
                    {universalTabs.map((tab, index) => (
                      <span key={tab.id} className="inline-flex items-center gap-1.5">
                        <span aria-hidden="true" className="h-1.5 w-1.5" style={{ backgroundColor: tab.color }} />
                        {universalNames[index]}
                      </span>
                    ))}
                  </span>
                </button>
              )}

              <div className="border border-neutral-800 p-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-neutral-100">
                  <AIIcon className="h-4 w-4 text-neutral-300" />
                  {uk ? 'Під вашу діяльність' : 'For what you do'}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-neutral-500">
                  {uk ? 'ШІ складе вкладки з вашого опису, цілей зі стратегії та назв завдань.' : 'AI builds tabs from your description, strategy goals and task titles.'}
                </p>

                {suggestion ? (
                  <div className="mt-4 space-y-4">
                    <ul className="divide-y divide-neutral-800/80 border border-neutral-800">
                      {suggestion.tabs.map(tab => (
                        <li key={tab.name} className="flex items-center gap-3 px-3 py-2.5">
                          <span aria-hidden="true" className="h-3 w-3 shrink-0" style={{ backgroundColor: tab.color }} />
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-neutral-100">{tab.name}</span>
                          {tab.fromTabIds.length > 0 && (
                            <span className="min-w-0 truncate text-[11px] text-neutral-500" title={uk ? 'Звідки перейдуть завдання' : 'Tasks move from'}>
                              ← {tab.fromTabIds.map(tabName).join(', ')}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                    {suggestion.explanation && <p className="text-xs leading-relaxed text-neutral-400">{suggestion.explanation}</p>}
                    <p className="text-xs leading-relaxed text-amber-200/90">
                      {uk
                        ? `Замінить ваші вкладки (${tabs.length}). Завдання перейдуть, як показано стрілками; решта — у «${suggestion.tabs[0].name}».`
                        : `Replaces your ${tabs.length} tabs. Tasks move as the arrows show; the rest go to “${suggestion.tabs[0].name}”.`}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={applySuggestion}
                        className="inline-flex min-h-10 items-center bg-white px-3 text-xs font-bold text-black transition-colors hover:bg-neutral-200">
                        {uk ? 'Застосувати' : 'Apply'}
                      </button>
                      <button type="button" onClick={requestSuggestion} disabled={suggesting}
                        className="inline-flex min-h-10 items-center gap-1.5 border border-neutral-700 px-3 text-xs text-neutral-300 transition-colors hover:border-white hover:text-white disabled:opacity-40">
                        {suggesting ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
                        {uk ? 'Інший варіант' : 'Another option'}
                      </button>
                      <button type="button" onClick={() => setSuggestion(null)}
                        className="inline-flex min-h-10 items-center px-3 text-xs text-neutral-400 transition-colors hover:text-white">
                        {uk ? 'Скасувати' : 'Cancel'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={event => { event.preventDefault(); void requestSuggestion(); }} className="mt-4 space-y-2">
                    <label htmlFor="manage-tabs-activity" className="sr-only">{uk ? 'Чим ви займаєтесь' : 'What you do'}</label>
                    <div className="flex items-stretch gap-2">
                      <input
                        id="manage-tabs-activity"
                        type="text"
                        value={activity}
                        maxLength={300}
                        onChange={event => setActivity(event.target.value)}
                        placeholder={uk ? 'Чим ви займаєтесь?' : 'What do you do?'}
                        title={uk ? 'Напр. студент, підробляю дизайном' : 'E.g. student, freelance design'}
                        className="h-11 min-w-0 flex-1 border border-neutral-700 bg-[#08080a] px-3 text-sm text-white placeholder:text-neutral-500 transition-colors focus:border-white focus:outline-none"
                      />
                      <button type="submit" disabled={suggesting || !hasContext} aria-busy={suggesting}
                        className="inline-flex h-11 shrink-0 items-center gap-1.5 border border-neutral-600 px-3 text-sm font-semibold text-neutral-100 transition-colors hover:border-white disabled:cursor-not-allowed disabled:opacity-40">
                        {suggesting ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <AIIcon className="h-4 w-4" />}
                        {suggesting ? (uk ? 'Складаємо…' : 'Building…') : (uk ? 'Запропонувати' : 'Suggest')}
                      </button>
                    </div>
                    {!hasContext && <p className="text-xs text-neutral-500">{uk ? 'Опишіть свою діяльність у кількох словах.' : 'Describe what you do in a few words.'}</p>}
                  </form>
                )}
                {suggestError && <p role="alert" className="mt-3 text-xs leading-relaxed text-amber-300">{suggestError}</p>}
              </div>
            </section>
          </div>

          <footer className="flex justify-end border-t border-neutral-800/80 px-5 py-3 sm:px-6">
            <button
              type="button"
              onClick={close}
              className="inline-flex min-h-10 items-center border border-neutral-700 px-4 text-sm font-semibold text-neutral-200 transition-colors hover:border-white hover:text-white"
            >
              {uk ? 'Готово' : 'Done'}
            </button>
          </footer>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
