import React from 'react';
import type { NotepadNote } from '../types';
import type { Language } from '../utils/i18n';
type Kind = 'lesson' | 'idea';
type Filter = 'all' | Kind;
const COPY = {
  uk: {
    title: ['Мій', 'блокнот'], filter: 'Фільтр', filters: { all: 'Усі', lesson: 'Висновки', idea: 'Ідеї' } as Record<Filter, string>,
    search: 'Пошук', searchLabel: 'Пошук нотаток', newNote: 'Нова нотатка', untitled: 'Без назви', pinned: 'Закріплено', note: 'Нотатка',
    kinds: { lesson: 'Висновок', idea: 'Ідея' } as Record<Kind, string>, kindLabel: 'Тип нотатки', append: 'Редагувати', titleLabel: 'Назва нотатки',
    appendLabel: 'Текст сторінки', appendPlaceholder: 'Пишіть тут…', emptyPage: 'Порожня сторінка', makeTasks: 'Зробити задачі',
    pages: 'Сторінки', page: 'Сторінка', addPage: 'Нова сторінка', pin: 'Закріпити', unpin: 'Відкріпити', remove: 'Видалити',
    menu: 'Дії з виділеним', font: 'Шрифт', fontSearch: 'Пошук шрифту', fonts: 'Шрифти', size: 'Розмір шрифту', smaller: 'Менше', bigger: 'Більше',
    weight: 'Товщина', weights: ['Тонкий', 'Звичайний', 'Жирний'], numbering: 'Нумерація', copy: 'Копіювати', paste: 'Вставити',
    chip: 'Кнопка копіювання', plain: 'Звичайний текст', undo: 'Скасувати',
    copied: 'Скопійовано', pasted: 'Вставлено', chipAdded: 'Кнопку додано', chipRemoved: 'Кнопку прибрано', deleted: 'Видалено',
    numbersOn: 'Нумерацію додано', numbersOff: 'Нумерацію прибрано', pinnedTop: 'Закріплено вгорі', unpinned: 'Відкріплено', noteDeleted: 'Нотатку видалено',
    now: 'Щойно', today: 'Сьогодні', yesterday: 'Вчора', empty: 'Тут поки порожньо', saveFailed: 'Не вдалося зберегти нотатку',
    copyFailed: 'Не вдалося скопіювати. Виділіть текст і натисніть Ctrl+C.', pasteFailed: 'Не вдалося вставити. Скористайтеся Ctrl+V у редакторі.',
    storage: 'Нотатки не зберігаються на цьому пристрої. Перевір місце у сховищі.',
  },
  en: {
    title: ['My', 'notebook'], filter: 'Filter', filters: { all: 'All', lesson: 'Lessons', idea: 'Ideas' } as Record<Filter, string>,
    search: 'Search', searchLabel: 'Search notes', newNote: 'New note', untitled: 'Untitled', pinned: 'Pinned', note: 'Note',
    kinds: { lesson: 'Lesson', idea: 'Idea' } as Record<Kind, string>, kindLabel: 'Note type', append: 'Edit', titleLabel: 'Note title',
    appendLabel: 'Page text', appendPlaceholder: 'Write here…', emptyPage: 'Empty page', makeTasks: 'Make tasks',
    pages: 'Pages', page: 'Page', addPage: 'New page', pin: 'Pin', unpin: 'Unpin', remove: 'Delete',
    menu: 'Selection actions', font: 'Font', fontSearch: 'Search fonts', fonts: 'Fonts', size: 'Font size', smaller: 'Smaller', bigger: 'Bigger',
    weight: 'Weight', weights: ['Light', 'Regular', 'Bold'], numbering: 'Numbering', copy: 'Copy', paste: 'Paste',
    chip: 'Copy button', plain: 'Plain text', undo: 'Undo',
    copied: 'Copied', pasted: 'Pasted', chipAdded: 'Button added', chipRemoved: 'Button removed', deleted: 'Deleted',
    numbersOn: 'Numbering added', numbersOff: 'Numbering removed', pinnedTop: 'Pinned to top', unpinned: 'Unpinned', noteDeleted: 'Note deleted',
    now: 'Just now', today: 'Today', yesterday: 'Yesterday', empty: 'Nothing here yet', saveFailed: 'Could not save the note',
    copyFailed: 'Could not copy. Select the text and press Ctrl+C.', pasteFailed: 'Could not paste. Use Ctrl+V in the editor.',
    storage: 'Notes are not being saved on this device. Check the available storage.',
  },
};

const UK_MONTHS = ['січ', 'лют', 'бер', 'квіт', 'трав', 'черв', 'лип', 'сер', 'вер', 'жовт', 'лист', 'груд'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const BASE_FONTS = ['Inter', 'Segoe UI', 'Segoe UI Variable', 'Arial', 'Bahnschrift', 'Calibri', 'Cambria', 'Candara', 'Comic Sans MS', 'Consolas',
  'Constantia', 'Corbel', 'Courier New', 'Franklin Gothic Medium', 'Gabriola', 'Georgia', 'Impact', 'Lucida Console', 'Lucida Sans Unicode',
  'Palatino Linotype', 'Segoe Print', 'Segoe Script', 'Sitka Text', 'Sylfaen', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'];
const WEIGHTS = [300, 500, 800];
const ICONS = {
  edit: 'M21.17 6.81a1 1 0 0 0-3.98-3.98L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5zM15 5l4 4',
  copy: 'M8 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2zM16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2',
  check: 'M20 6 9 17l-5-5',
  trash: 'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
  paste: 'M9 3h6a1 1 0 0 1 1 1v2H8V4a1 1 0 0 1 1-1zM8 5H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2',
  text: 'M4 7V5h16v2M9 19h6M12 5v14',
  list: 'M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1',
};
const CHIP_ICON = ICONS.copy + 'M14 11v6M11 14h6';
const PIN_PATH = 'M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z';

const fontFamily = (name?: string) => !name || name === 'Inter' ? "'SF Pro Display', Inter, sans-serif" : "'" + name.replace(/'/g, '') + "', 'Segoe UI', sans-serif";
const kindOf = (note: NotepadNote): Kind => note.kind ?? 'idea';
const Path = ({ d, size = 18, width = 2 }: { d: string; size?: number; width?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;

function noteDate(at: number, now: number, lang: Language) {
  const copy = COPY[lang];
  const date = new Date(at), today = new Date(now);
  const day = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  if (now - at < 60_000) return copy.now;
  const diff = Math.round((day(today) - day(date)) / 864e5);
  if (diff === 0) return copy.today + ', ' + date.toLocaleTimeString(lang === 'uk' ? 'uk-UA' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
  if (diff === 1) return copy.yesterday;
  return lang === 'uk' ? date.getDate() + ' ' + UK_MONTHS[date.getMonth()] : EN_MONTHS[date.getMonth()] + ' ' + date.getDate();
}


export { COPY, BASE_FONTS, WEIGHTS, ICONS, CHIP_ICON, PIN_PATH, fontFamily, kindOf, Path, noteDate };
