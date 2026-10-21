import { useId } from 'react';
import type { Language } from '../../utils/i18n';
import type { GrowthStatus } from '../../utils/growth';
import type { Skill } from '../../types';

const UK_MONTHS = ['січ', 'лют', 'бер', 'квіт', 'трав', 'черв', 'лип', 'сер', 'вер', 'жовт', 'лист', 'груд'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const UK_WEEKDAYS = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const EN_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function formatGrowthNumber(value: number, lang: Language = 'uk', signed = false) {
  return new Intl.NumberFormat(lang === 'uk' ? 'uk-UA' : 'en-US', { maximumFractionDigits: 1,
    ...(signed ? { signDisplay: 'exceptZero' as const } : {}) }).format(value).replace('-', '−');
}

const isPercent = (skill: Skill) => skill.metric.unit.trim() === '%';
/** «17%» for percentages, a bare number otherwise. */
export const growthValue = (skill: Skill, value: number, lang: Language) => formatGrowthNumber(value, lang) + (isPercent(skill) ? '%' : '');
/** «17%» or «4,2 год». */
export const growthValueUnit = (skill: Skill, value: number, lang: Language) =>
  formatGrowthNumber(value, lang) + (isPercent(skill) ? '%' : skill.metric.unit.trim() ? ' ' + skill.metric.unit.trim() : '');
export const growthDelta = (skill: Skill, delta: number, lang: Language) => formatGrowthNumber(delta, lang, true) + (isPercent(skill) && delta ? '%' : '');

const toDate = (date: string | number) => typeof date === 'string' ? new Date(date + 'T12:00:00') : new Date(date);
/** «25 сер». */
export function growthDay(date: string | number, lang: Language) {
  const value = toDate(date);
  return lang === 'uk' ? value.getDate() + ' ' + UK_MONTHS[value.getMonth()] : EN_MONTHS[value.getMonth()] + ' ' + value.getDate();
}
/** «Пт, 24» or, with the month, «Пт, 24 жовт». */
export function growthWeekday(date: string | number, lang: Language, withMonth = false) {
  const value = toDate(date);
  return (lang === 'uk' ? UK_WEEKDAYS : EN_WEEKDAYS)[value.getDay()] + ', ' + (withMonth ? growthDay(value.getTime(), lang) : value.getDate());
}
/** «14–20 жовт» inside one month, «28 жовт – 3 лист» across months. */
export function growthWeekRange(start: number, end: number, lang: Language) {
  const a = new Date(start), b = new Date(end);
  if (a.getMonth() !== b.getMonth()) return growthDay(start, lang) + ' – ' + growthDay(end, lang);
  return lang === 'uk' ? a.getDate() + '–' + b.getDate() + ' ' + UK_MONTHS[b.getMonth()] : EN_MONTHS[b.getMonth()] + ' ' + a.getDate() + '–' + b.getDate();
}

const reducedMotion = () => typeof window !== 'undefined' && (document.documentElement.classList.contains('karkas-reduce-motion')
  || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

/** Hatched progress band: 9px pitch, 10° tilt, 2px strokes. It fills in, then its strokes keep running one pitch per loop. */
export function GrowthHatch({ width, color, opacity }: { width: string; color: string; opacity?: number }) {
  const id = useId().replace(/:/g, '');
  return <div aria-hidden="true" className="gv-hatch" style={{ width, opacity }}>
    <svg width="100%" height="100%" style={{ display: 'block' }}><defs><pattern id={id} x="0" width="9" height="40" patternUnits="userSpaceOnUse" patternTransform="rotate(10)">
      {!reducedMotion() && <animate attributeName="x" from="0" to="9" dur="0.35s" repeatCount="indefinite" />}
      <line x1="1.5" y1="-10" x2="1.5" y2="50" stroke={color} strokeWidth="2" />
    </pattern></defs><rect width="100%" height="100%" fill={'url(#' + id + ')'} /></svg>
  </div>;
}

export interface GrowthPalette { bg: string; ink: string; sub: string; hatch: string; chipBg: string; chipInk: string }

/** Tile colours per status, as in Main.dc.html. */
export function growthPalette(kind: GrowthStatus['kind']): GrowthPalette {
  if (kind === 'on_track') return { bg: '#13f287', ink: '#090a0a', sub: '#1f1f1f', hatch: '#090a0a', chipBg: '#090a0a', chipInk: '#13f287' };
  if (kind === 'ahead') return { bg: '#3a3a3c', ink: '#ffffff', sub: '#d1d1d6', hatch: '#8e8e93', chipBg: '#6408fa', chipInk: '#ffffff' };
  if (kind === 'behind') return { bg: '#1f1f1f', ink: '#ffffff', sub: '#a1a1a6', hatch: '#13f287', chipBg: '#ff4d4f', chipInk: '#090a0a' };
  return { bg: '#1f1f1f', ink: '#ffffff', sub: '#a1a1a6', hatch: '#13f287', chipBg: '#3a3a3c', chipInk: '#ffffff' };
}

/** The pill in the skill header: status colour on the dark switcher. */
export function growthStatusPill(kind: GrowthStatus['kind']) {
  if (kind === 'on_track') return { background: '#13f287', color: '#090a0a' };
  if (kind === 'ahead') return { background: '#6408fa', color: '#ffffff' };
  if (kind === 'behind') return { background: '#ff4d4f', color: '#090a0a' };
  return { background: '#3a3a3c', color: '#ffffff' };
}
