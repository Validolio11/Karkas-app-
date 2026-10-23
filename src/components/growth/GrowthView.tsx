import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { GrowthSkill, PracticeSession, PSTask, Skill, SkillMeasurement } from '../../types';
import type { useGrowth } from '../../hooks/useGrowth';
import type { Language } from '../../utils/i18n';
import type { GrowthStatus } from '../../utils/growth';
import { currentValue, daysUntilMeasurement, isConfiguredSkill, metricChange, nextMeasurementDate, plateau, progressShare,
  reviewTrendCounts, skillStatus, subskillSuccessRate, weakestSubskill, weekReview } from '../../utils/growth';
import { localTaskDate } from '../../utils/taskDates';
import { useGrowthCopy } from './growthI18n';
import { GrowthHatch, growthDay, growthDelta, growthPalette, growthStatusPill, growthValue, growthValueUnit, growthWeekday,
  growthWeekRange } from './growthUi';
import './growth.css';
import { useAutoFitText } from './useAutoFitText';
import { SoftHatchSvg } from '../SoftHatchSvg';
import { SkillResults } from './SkillResults';
import { GoalAchievement } from './GrowthFeedback';
import { isGoalReached } from '../../utils/growth';

type Growth = ReturnType<typeof useGrowth>;
export interface GrowthViewProps {
  growth: Growth;
  tasks: PSTask[];
  lang: Language;
  initialTab?: 'skills' | 'week';
  revealSkillId?: string | null;
  onPractice: (skill: GrowthSkill, subskillId?: string, title?: string, measurementMode?: boolean) => void;
  onAddPractice?: (skill: GrowthSkill, subskillId?: string, title?: string, measurementMode?: boolean) => boolean;
  onMeasure: (skill: Skill) => void;
  onSetup: (skill?: GrowthSkill, initialTitle?: string) => void;
}

const live = (value: { deletedAt?: number }) => value.deletedAt === undefined;
function monday(now: number) { const date = new Date(now); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() - (date.getDay() + 6) % 7); return date.getTime(); }
function splitTitle(title: string): [string, string | undefined] {
  const words = title.trim().split(/\s+/);
  return words.length > 1 ? [words.slice(0, -1).join(' '), words.at(-1)] : [title, undefined];
}
function statusText(status: GrowthStatus, copy: ReturnType<typeof useGrowthCopy>) {
  return copy.statuses[status.kind] + (status.kind === 'behind' && status.gapPercent !== undefined ? ' ' + status.gapPercent + '%' : '');
}
const clip = (text: string, length = 34) => text.length > length ? text.slice(0, length - 1).trimEnd() + '…' : text;

const PlayIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.9l10.4-6.5a1 1 0 0 0 0-1.8L9.5 4.6A1 1 0 0 0 8 5.5z" /></svg>;
const PlusIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>;
const ChevronIcon = ({ next = false }: { next?: boolean }) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={next ? 'M9 6l6 6-6 6' : 'M15 6l-6 6 6 6'} /></svg>;
const CheckIcon = ({ shown }: { shown: boolean }) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ opacity: shown ? 1 : 0 }}><path d="M20 6 9 17l-5-5" /></svg>;

function Head({ first, second, switcher, actions, onTitle, titleTip }: { first: string; second?: string; switcher: React.ReactNode; actions?: React.ReactNode; onTitle?: () => void; titleTip?: string }) {
  const title = <><span className="pulse-page-title-light" data-fit-text="32">{first}</span>{second && <span className="pulse-page-title-heavy" data-fit-text="32">{second}</span>}</>;
  return <div className="pulse-page-head gv-head">
    <div className="pulse-page-head-copy">
      <h1 className="pulse-page-title">{onTitle ? <button type="button" className="gv-title-button" data-tip={titleTip} onClick={onTitle}>{title}</button> : title}</h1>
      {switcher}
    </div>
    {actions && <div className="gv-head-actions">{actions}</div>}
  </div>;
}

/** Real timestamps on a symmetric time axis: past left, now centered, future right. */
function skillChart(skill: Skill, measurements: readonly SkillMeasurement[], sessions: readonly PracticeSession[], now: number, unitsPerPixelX: number) {
  const startAt = new Date(skill.start.date + 'T00:00:00').getTime();
  const series = [{ at: startAt, value: skill.start.value }, ...measurements.filter(item => live(item) && item.skillId === skill.id && item.at >= startAt)
    .slice().sort((a, b) => a.at - b.at).map(item => ({ at: item.at, value: item.value }))];
  // A measurement taken on the start day replaces the start point.
  if (series.length > 1 && localTaskDate(series[1].at) === skill.start.date) series.shift();
  const values = series.map(item => item.value);
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || Math.max(Math.abs(min) * .1, 1);
  const low = min - span * 2 / 9, range = span * 13 / 9;
  const day = 24 * 60 * 60 * 1000;
  const halfWindow = Math.max(day, ...series.map(item => Math.abs(item.at - now)));
  const inset = Math.min(240, Math.max(24, 24 * unitsPerPixelX));
  const X = (at: number) => 600 + (at - now) / halfWindow * (600 - inset);
  const Y = (value: number) => 250 - (value - low) / range * 170;
  const points = series.map(item => ({ ...item, x: X(item.at), y: Y(item.value) }));
  let line = 'M' + points[0].x.toFixed(1) + ' ' + points[0].y.toFixed(1);
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i], p2 = points[i + 1];
    const middleX = (p1.x + p2.x) / 2;
    // Controls stay between real timestamps and values: no future extension or overshoot.
    line += ' C' + middleX.toFixed(1) + ' ' + p1.y.toFixed(1)
      + ' ' + middleX.toFixed(1) + ' ' + p2.y.toFixed(1)
      + ' ' + p2.x.toFixed(1) + ' ' + p2.y.toFixed(1);
  }
  const last = points.at(-1)!;
  // The highlighted point is the biggest step in the right direction.
  const direction = skill.metric.direction === 'down' ? -1 : 1;
  let selected = points.length - 1, best = 0;
  for (let i = 1; i < points.length; i++) { const step = (points[i].value - points[i - 1].value) * direction; if (step > best) { best = step; selected = i; } }
  // A lesson marks the measurement that followed it.
  const lessons = sessions.filter(session => live(session) && session.skillId === skill.id && session.lesson?.trim()).slice().sort((a, b) => b.at - a.at);
  const lessonAt = (index: number) => index > 0 ? lessons.find(session => session.at <= points[index].at && session.at > points[index - 1].at)?.lesson?.trim() : undefined;
  const marks: { index: number; gap: number; text: string }[] = [];
  const selectedLesson = lessonAt(selected);
  if (selectedLesson && points[selected].x > 240 && points[selected].x < 960) marks.push({ index: selected, gap: 30, text: selectedLesson });
  for (let i = points.length - 1; i > 0 && marks.length < 2; i--) {
    const text = i !== selected && lessonAt(i);
    // Labels stay off the card edges and clear of the highlighted one.
    if (text && points[i].x > 240 && points[i].x < 960 && Math.abs(points[i].x - points[selected].x) > 300) marks.push({ index: i, gap: 14, text });
  }
  const labels = [now - halfWindow, now, now + halfWindow];
  return { points, line, area: line + ' L' + last.x.toFixed(1) + ' 270 L' + points[0].x.toFixed(1) + ' 270 Z', selected, marks, labels };
}

function SkillChart({ skill, measurements, sessions, lang, now }: { skill: Skill; measurements: readonly SkillMeasurement[]; sessions: readonly PracticeSession[]; lang: Language; now: number }) {
  const copy = useGrowthCopy(lang);
  const id = useId().replace(/:/g, '');
  const svgRef = useRef<SVGSVGElement>(null);
  const [unitsPerPixelX, setUnitsPerPixelX] = useState(1);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const updateScale = () => {
      const width = svg.getBoundingClientRect().width;
      if (width > 0) setUnitsPerPixelX(1200 / width);
    };
    updateScale();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateScale);
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);
  const chart = skillChart(skill, measurements, sessions, now, unitsPerPixelX);
  const current = currentValue(skill, measurements);
  const dot = chart.points[chart.selected];
  return <section className="gv-chart">
    <svg ref={svgRef} viewBox="0 0 1200 270" preserveAspectRatio="none" width="100%" height="270" className="gv-chart-svg" role="img" aria-label={copy.chartLabel(growthValue(skill, skill.start.value, lang), growthValueUnit(skill, current, lang))}>
      <defs>
        <linearGradient id={id + 'area'} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#8442ff" /><stop offset="1" stopColor="#a678ff" /></linearGradient>
        <linearGradient id={id + 'col'} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffffff" stopOpacity="0" /><stop offset="0.45" stopColor="#ffffff" stopOpacity="0.16" /><stop offset="1" stopColor="#ffffff" stopOpacity="0.4" /></linearGradient>
      </defs>
      <path className="gv-chart-area" d={chart.area} fill={'url(#' + id + 'area)'} />
      <SoftHatchSvg x={chart.points[0].x} width={chart.points.at(-1)!.x - chart.points[0].x} height={270} color="#ffffff" unitsPerPixelX={unitsPerPixelX}>
        <path d={chart.area} />
      </SoftHatchSvg>
      <path d={chart.points.map(point => 'M' + point.x.toFixed(1) + ' 0 V270').join(' ')} fill="none" stroke="#ffffff" strokeOpacity="0.14" strokeWidth="1" strokeDasharray="2 6" vectorEffect="non-scaling-stroke" />
      <line x1="600" x2="600" y1="0" y2="270" stroke="#ffffff" strokeOpacity="0.4" strokeWidth="1" strokeDasharray="4 6" vectorEffect="non-scaling-stroke" aria-hidden="true" />
      <rect className="gv-chart-col" x={(dot.x - 36).toFixed(1)} y="0" width="72" height="270" fill={'url(#' + id + 'col)'} />
      <path className="gv-chart-line" d={chart.line} fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
    <div className="gv-chart-head"><span>{growthValue(skill, skill.start.value, lang)} → {growthValueUnit(skill, current, lang)} · {copy.goal} {growthValueUnit(skill, skill.goal.value, lang)}</span></div>
    <div className="gv-chart-delta" data-fit-text="32">{growthDelta(skill, current - skill.start.value, lang)}</div>
    {chart.points.map((point, index) => index !== chart.selected && point.x > 4 && point.x < 1196
      && <div key={index} aria-hidden="true" className="gv-chart-dot" style={{ left: (point.x / 12).toFixed(2) + '%', top: (90 + point.y).toFixed(1) + 'px' }} />)}
    <div aria-hidden="true" className="gv-chart-dates">
      <span>{growthDay(chart.labels[0], lang)}</span>
      <span style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)' }}>{copy.today}</span>
      <span>{growthDay(chart.labels[2], lang)}</span>
    </div>
    <div className="gv-chart-focus" style={{ left: (dot.x / 12).toFixed(2) + '%', top: (90 + dot.y).toFixed(1) + 'px' }} />
    {chart.marks.map(mark => { const left = chart.points[mark.index].x / 12; return <span key={mark.index} className="gv-chart-mark" style={{ left: left.toFixed(2) + '%', top: (90 + chart.points[mark.index].y - mark.gap).toFixed(1) + 'px'}}><span className="gv-dot" style={{ background: '#13f287' }} />{clip(mark.text)}</span>; })}
  </section>;
}

function SkillManagement({ skill, growth, lang, onSetup, onRemoved }: { skill: GrowthSkill; growth: Growth; lang: Language; onSetup: GrowthViewProps['onSetup']; onRemoved: () => void }) {
  const uk = lang === 'uk', inactive = skill.archivedAt !== undefined || skill.deletedAt !== undefined;
  const [error, setError] = useState(''), [goal, setGoal] = useState(false);
  const reached = isConfiguredSkill(skill) && growth.measurements.some(value => value.skillId === skill.id && value.deletedAt === undefined && value.at >= new Date(skill.start.date + 'T00:00:00').getTime()) && isGoalReached(skill, currentValue(skill, growth.measurements));
  return <section className="gv-skill-management">
    {inactive ? <><p className="gf-hint">{uk ? 'Ця навичка в архіві. Історію збережено; відновіть її для нової практики.' : 'This skill is archived. History is preserved; restore it to continue practicing.'}</p><button type="button" onClick={() => { if (!growth.restoreSkill(skill.id)) setError(uk ? 'Не вдалося відновити. Повторіть.' : 'Could not restore. Retry.'); }}>{uk ? 'Відновити навичку' : 'Restore skill'}</button></> : <>
      <button type="button" onClick={() => onSetup(skill)}>{uk ? 'Редагувати навичку' : 'Edit skill'}</button><button type="button" onClick={() => { if (growth.archiveSkill(skill.id)) onRemoved(); else setError(uk ? 'Не збережено. Повторіть.' : 'Not saved. Retry.'); }}>{uk ? 'Архівувати' : 'Archive'}</button><button type="button" onClick={() => { if (growth.deleteSkill(skill.id)) onRemoved(); else setError(uk ? 'Не видалено. Повторіть.' : 'Not deleted. Retry.'); }}>{uk ? 'Видалити' : 'Delete'}</button>
      {reached && <button type="button" onClick={() => setGoal(true)}>{skill.goalState === 'maintaining' ? (uk ? 'Підтримую рівень · наступна ціль' : 'Maintaining · next goal') : (uk ? 'Цілі досягнуто · наступний крок' : 'Goal reached · next step')}</button>}
    </>}
    {error && <p className="gf-error" role="alert">{error}</p>}
    {goal && reached && isConfiguredSkill(skill) && <GoalAchievement growth={growth} skill={skill} lang={lang} onClose={() => setGoal(false)} onNewSkill={source => onSetup(undefined, source.title)} />}
    {!!skill.goalHistory?.length && <details><summary>{uk ? 'Історія досягнень' : 'Achievement history'}</summary>{skill.goalHistory.map(item => <p key={item.version}>{item.value} {item.unit} · {new Date(item.reachedAt).toLocaleDateString(lang)}</p>)}</details>}
  </section>;
}

export const GrowthView: React.FC<GrowthViewProps> = ({ growth, tasks, lang, initialTab = 'skills', revealSkillId, onPractice, onAddPractice, onMeasure, onSetup }: GrowthViewProps) => {
  const fitRoot = useAutoFitText<HTMLDivElement>();
  const copy = useGrowthCopy(lang);
  const [tab, setTab] = useState<'skills' | 'week'>(initialTab);
  const [selectedId, setSelectedId] = useState<string>();
  const [weekOffset, setWeekOffset] = useState(0);
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [planError, setPlanError] = useState('');
  const now = Date.now();
  const today = localTaskDate(now);
  const skills = growth.skills.filter(skill => live(skill) && skill.archivedAt === undefined);
  const configured = skills.filter(isConfiguredSkill);
  const selectedSkill = growth.skills.find(skill => skill.id === selectedId);
  const selected = selectedSkill && isConfiguredSkill(selectedSkill) ? selectedSkill : undefined;
  useEffect(() => { setTab(initialTab); setSelectedId(undefined); }, [initialTab]);
  useEffect(() => { if (revealSkillId) { setSelectedId(revealSkillId); setTab('skills'); } }, [revealSkillId]);
  const weekStart = useMemo(() => { const date = new Date(monday(Date.now())); date.setDate(date.getDate() + weekOffset * 7); return date.getTime(); }, [weekOffset]);
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 6);
  const relativeDay = (at: number) => localTaskDate(at) === today ? copy.today : localTaskDate(at) === localTaskDate(now - 864e5) ? copy.yesterday : growthDay(at, lang);
  const selectTab = (next: 'skills' | 'week') => { setTab(next); setSelectedId(undefined); };

  const switcher = <div className="gv-switch" role="tablist" aria-label={copy.view} onKeyDown={event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    selectTab(tab === 'skills' ? 'week' : 'skills');
    (event.currentTarget.querySelector('[aria-selected="false"]') as HTMLButtonElement | null)?.focus();
  }}>
    <button type="button" role="tab" aria-selected={tab === 'skills'} tabIndex={tab === 'skills' ? 0 : -1} onClick={() => selectTab('skills')}>{copy.skills}</button>
    <button type="button" role="tab" aria-selected={tab === 'week'} tabIndex={tab === 'week' ? 0 : -1} onClick={() => selectTab('week')}>{copy.week}{tab === 'week' ? ' · ' + growthWeekRange(weekStart, weekEnd.getTime(), lang) : ''}</button>
  </div>;

  if (selectedSkill && (!selected || selectedSkill.archivedAt !== undefined || selectedSkill.deletedAt !== undefined)) {
    const [first, second] = splitTitle(selectedSkill.title), inactive = selectedSkill.archivedAt !== undefined || selectedSkill.deletedAt !== undefined;
    return <div ref={fitRoot} className="pulse-page-shell growth-view" data-growth-screen="practice-skill">
      <Head first={first} second={second} switcher={<span className="gv-switch-pill">{inactive ? (lang === 'uk' ? 'Архів' : 'Archive') : (lang === 'uk' ? 'Практика' : 'Practice')}</span>} actions={<button type="button" className="gv-round" aria-label={copy.back} onClick={() => setSelectedId(undefined)}><ChevronIcon /></button>} />
      <div className="pulse-page-main">{selected ? <SkillChart skill={selected} measurements={growth.measurements} sessions={growth.sessions} lang={lang} now={now} /> : <p className="gf-hint">{lang === 'uk' ? 'Прогрес ще не вимірюється. Практикуйтеся й записуйте висновки; ціль можна додати будь-коли.' : 'Progress is not measured yet. Practice and record lessons; add a goal whenever you are ready.'}</p>}
        {!inactive && <div className="gf-practice-actions"><button type="button" className="gf-save" onClick={() => onPractice(selectedSkill)}><PlayIcon />{copy.train}</button><button type="button" className="gf-skip" onClick={() => onSetup(selectedSkill)}>{lang === 'uk' ? 'Встановити ціль' : 'Set a goal'}</button></div>}
        <SkillResults key={selectedSkill.id} skill={selectedSkill} growth={growth} lang={lang} readOnly={inactive} />
        <SkillManagement key={'manage-' + selectedSkill.id} skill={selectedSkill} growth={growth} lang={lang} onSetup={onSetup} onRemoved={() => setSelectedId(undefined)} />
      </div>
    </div>;
  }

  if (selected) {
    const status = skillStatus(selected, growth.measurements, now);
    const lastLesson = growth.sessions.filter(session => session.skillId === selected.id && live(session) && session.lesson?.trim()).slice().sort((a, b) => b.at - a.at)[0];
    const lessonSubskill = selected.subskills.find(item => item.id === lastLesson?.subskillId);
    const weak = weakestSubskill(selected, growth.sessions);
    const next = nextMeasurementDate(selected, growth.measurements, now);
    const [first, second] = splitTitle(selected.title);
    return <div ref={fitRoot} className="pulse-page-shell growth-view" data-growth-screen="skill">
      <Head first={first} second={second} onTitle={() => onSetup(selected)} titleTip={copy.edit}
        switcher={<div className="gv-switch" role="group" aria-label={copy.view}>
          <span className="gv-switch-pill" style={growthStatusPill(status.kind)}>{statusText(status, copy)}</span>
          <button type="button" onClick={() => onMeasure(selected)}>{copy.measure}</button>
        </div>}
        actions={<button type="button" className="gv-round" aria-label={copy.back} onClick={() => setSelectedId(undefined)}><ChevronIcon /></button>} />
      <div className="pulse-page-grid gv-grid">
        <aside className="pulse-page-sidebar">
          <section className="gv-lesson">
            <span className="gv-chip"><span className="gv-dot" style={{ background: '#8442ff' }} />{copy.latestLesson}</span>
            <span className="gv-lesson-title" data-fit-text="20">{lastLesson?.lesson?.trim() || copy.noLesson}</span>
            <span className="gv-lesson-meta">{lastLesson ? (lessonSubskill?.title || selected.title) + ' · ' + relativeDay(lastLesson.at) : copy.noLessonHint}</span>
            <button type="button" className="gv-wide-dark" onClick={() => onPractice(selected, lastLesson?.subskillId, lastLesson?.lesson?.trim())}><PlusIcon />{copy.toPractice}</button>
          </section>
          {next && <section className="gv-next-compact">
            <span className="gv-next-compact-copy"><span>{copy.nextMeasurement}</span><strong>{growthWeekday(next, lang, true)}</strong></span>
            <button type="button" onClick={() => onMeasure(selected)}>{copy.start}</button>
          </section>}
        </aside>
        <div className="pulse-page-main">
          <SkillChart skill={selected} measurements={growth.measurements} sessions={growth.sessions} lang={lang} now={now} />
          <SkillResults key={selected.id} skill={selected} growth={growth} lang={lang} />
          <SkillManagement key={'manage-' + selected.id} skill={selected} growth={growth} lang={lang} onSetup={onSetup} onRemoved={() => setSelectedId(undefined)} />
          <section className="gv-subskills" aria-label={copy.subskills}>
            <span className="gv-subskills-title">{copy.subskills}</span>
            {selected.subskills.map(subskill => {
              const rate = subskillSuccessRate(selected.id, subskill.id, growth.sessions);
              const isWeak = weak?.subskillId === subskill.id;
              const bg = isWeak ? '#ff4d4f' : '#090a0a';
              return <button type="button" key={subskill.id} className="gv-subskill" style={{ background: bg, color: isWeak ? '#090a0a' : '#ffffff', '--gv-bg': bg } as React.CSSProperties} onClick={() => onPractice(selected, subskill.id)}>
                <GrowthHatch width={(rate ?? 0) * 100 + '%'} color={isWeak ? 'rgba(9,10,10,0.55)' : '#3a3a3c'} />
                <span className="gv-subskill-name" data-fit-text="13">{subskill.title}</span>
                <span className="gv-subskill-value">{rate === null ? '—' : Math.round(rate * 100) + '%'}</span>
              </button>;
            })}
            {!selected.subskills.length && <button type="button" className="gv-subskill gv-subskill--add" onClick={() => onSetup(selected)}><span className="gv-subskill-name" data-fit-text="13">{copy.noSubskills}</span></button>}
          </section>
        </div>
      </div>
    </div>;
  }

  if (tab === 'week') {
    const review = weekReview(skills, growth.measurements, growth.sessions, tasks, weekStart);
    const trends = reviewTrendCounts(configured, review.skills);
    const [first, second] = copy.weeklyTitle(trends.improved, trends.unchanged, trends.declined);
    // The plan trains what lags (plateau, behind, the weakest link) and adds the nearest control measurement.
    const weakestOwner = configured.map(skill => ({ skill, weak: weakestSubskill(skill, growth.sessions) }))
      .filter(item => item.weak).sort((a, b) => a.weak!.rate - b.weak!.rate)[0]?.skill.id;
    const lagging = configured.filter(skill => skill.id === weakestOwner || !!plateau(skill, growth.measurements, now)
      || skillStatus(skill, growth.measurements, now).kind === 'behind');
    const plan: { skill: GrowthSkill; subskillId?: string; text: string; key: string; measurementMode?: boolean }[] = (lagging.length ? lagging : skills).map(skill => {
      const weak = weakestSubskill(skill, growth.sessions);
      const subskill = skill.subskills.find(item => item.id === weak?.subskillId);
      return { skill, subskillId: subskill?.id, text: subskill?.title || (isConfiguredSkill(skill) ? skill.measure?.how || skill.metric.label : skill.title), key: skill.id + ':' + (subskill?.id || 'practice') };
    });
    const nearest = configured.map(skill => ({ skill, date: nextMeasurementDate(skill, growth.measurements, now) }))
      .filter((item): item is { skill: Skill; date: string } => !!item.date)
      .sort((a, b) => a.date.localeCompare(b.date) || (a.skill.measure?.time ?? '').localeCompare(b.skill.measure?.time ?? ''))[0];
    if (nearest) {
      const day = growthWeekday(nearest.date, lang).split(',')[0].toLowerCase();
      plan.push({ skill: nearest.skill, text: copy.controlMeasure + ', ' + day + (nearest.skill.measure?.time ? ' ' + nearest.skill.measure.time : ''), key: nearest.skill.id + ':measure', measurementMode: true });
    }
    const pending = plan.filter(item => !unchecked.has(item.key) && !added.has(item.key));
    const rows = review.skills.map(row => {
      const skill = configured.find(item => item.id === row.skillId)!;
      const change = metricChange(skill, row.from, row.to);
      const stalled = plateau(skill, growth.measurements, weekEnd.getTime());
      return { row, skill, change, stalled, bad: !!stalled || change.comparison === 'worse' };
    }).sort((a, b) => Number(a.change.comparison !== 'better') - Number(b.change.comparison !== 'better') || Number(a.bad) - Number(b.bad));
    return <div ref={fitRoot} className="pulse-page-shell growth-view" data-growth-screen="week">
      <Head first={first} second={second} switcher={switcher} actions={<>
        <button type="button" className="gv-round" aria-label={copy.previousWeek} onClick={() => setWeekOffset(value => value - 1)}><ChevronIcon /></button>
        <button type="button" className="gv-round" aria-label={copy.nextWeek} disabled={weekOffset >= 0} onClick={() => setWeekOffset(value => value + 1)}><ChevronIcon next /></button>
      </>} />
      <div className="pulse-page-grid gv-grid">
        <aside className="pulse-page-sidebar">
          <section className="gv-plan">
            <span className="gv-plan-title">{copy.weeklyPlan}</span>
            {plan.map(item => {
              const on = !unchecked.has(item.key);
              return <div className="gv-plan-item" key={item.key}>
                <button type="button" role="checkbox" aria-checked={on} aria-label={item.text} className="gv-plan-check" style={{ background: on ? '#090a0a' : 'transparent', boxShadow: 'inset 0 0 0 2px ' + (on ? '#090a0a' : '#c7c7cc') }}
                  onClick={() => setUnchecked(previous => { const next = new Set(previous); if (next.has(item.key)) next.delete(item.key); else next.add(item.key); return next; })}><CheckIcon shown={on} /></button>
                <span className="gv-plan-text">{item.text}</span>
                <span className="gv-plan-skill">{item.skill.title}</span>
              </div>;
            })}
            <button type="button" className="gv-plan-add" disabled={!pending.length} onClick={() => {
              const created = new Set(added);
              let failed = false;
              for (const item of pending) {
                const success = onAddPractice ? onAddPractice(item.skill, item.subskillId, item.text, item.measurementMode) : (onPractice(item.skill, item.subskillId, item.text, item.measurementMode), true);
                if (success) created.add(item.key);
                else failed = true;
              }
              setAdded(created);
              setPlanError(failed ? (lang === 'uk' ? 'Частину завдань не додано. Вони залишилися вибраними; повторіть додавання.' : 'Some tasks could not be added. They remain selected; retry adding them.') : '');
            }}>{plan.length > 0 && !pending.length && added.size ? copy.addedTasks : copy.addTasks}</button>
            {planError && <p className="gf-error" role="alert">{planError}</p>}
          </section>
        </aside>
        <div className="pulse-page-main">
          {rows.map(({ row, skill, change, stalled, bad }) => {
            const palette = growthPalette(row.status.kind);
            const chip = stalled || change.comparison === 'worse' ? { bg: '#ff4d4f', ink: '#090a0a' }
              : change.comparison === 'better' ? (palette.bg === '#13f287' ? { bg: '#090a0a', ink: '#13f287' } : { bg: '#13f287', ink: '#090a0a' })
              : { bg: '#090a0a', ink: '#ffffff' };
            const label = stalled ? copy.plateau(stalled.weeks) : change.comparison === 'better' ? copy.growth : change.comparison === 'worse' ? copy.decline : copy.noChange;
            return <button type="button" key={skill.id} className="gv-card" style={{ background: palette.bg, color: palette.ink, '--gv-bg': palette.bg } as React.CSSProperties} onClick={() => setSelectedId(skill.id)}>
              <GrowthHatch width="34%" opacity={0.9} color={bad ? '#ff4d4f' : palette.hatch} />
              <div className="gv-card-row">
                <span className="gv-glass gv-glass-name"><span className="gv-name" data-fit-text="22">{skill.title}</span><span className="gv-path" data-fit-text="12" style={{ color: palette.sub }}>{growthValue(skill, row.from, lang)} → {growthValueUnit(skill, row.to, lang)} · {skill.metric.label.toLowerCase()}</span></span>
                <span className="gv-glass gv-glass-value"><span className="gv-value" data-fit-text="24">{growthDelta(skill, row.delta, lang)}</span><span className="gv-status" style={{ background: chip.bg, color: chip.ink }}>{label}</span></span>
              </div>
              <div className="gv-note"><span className="gv-dot" style={{ background: bad ? '#ff4d4f' : change.comparison === 'better' ? '#13f287' : '#8e8e93' }} /><span>{row.why || copy.noWeekLesson}</span></div>
            </button>;
          })}
          {!rows.length && <section className="gv-first gv-first--small"><span className="gv-first-title"><span>{copy.noWeekSkills}</span></span><div className="gv-first-chips"><button type="button" onClick={() => onSetup()}>{copy.addSkill}</button></div></section>}
        </div>
      </div>
    </div>;
  }

  const weakLinks = configured.flatMap(skill => { const weak = weakestSubskill(skill, growth.sessions); return weak ? [{ skill, ...weak }] : []; }).sort((a, b) => a.rate - b.rate);
  const weakest = weakLinks[0];
  const nextSkill = configured.map(skill => ({ skill, date: nextMeasurementDate(skill, growth.measurements, now) }))
    .filter((item): item is { skill: Skill; date: string } => !!item.date).sort((a, b) => a.date.localeCompare(b.date) || (a.skill.measure?.time ?? '').localeCompare(b.skill.measure?.time ?? ''))[0];
  const order = { behind: 0, no_data: 1, no_deadline: 1, ahead: 2, on_track: 3 } as const;
  const tiles = skills.map(skill => ({ skill, status: skillStatus(skill, growth.measurements, now) }))
    .sort((a, b) => Number(isConfiguredSkill(b.skill)) - Number(isConfiguredSkill(a.skill)) || order[a.status.kind] - order[b.status.kind]);
  const days = nextSkill ? daysUntilMeasurement(nextSkill.date, now) : 0;
  return <div ref={fitRoot} className="pulse-page-shell growth-view" data-growth-screen="skills">
    <Head first={copy.title[0]} second={copy.title[1]} switcher={switcher} />
    {!skills.length ? <section className="gv-first" aria-label={copy.empty.join(' ')}>
      <span className="gv-first-title"><span>{copy.empty[0]}</span><strong>{copy.empty[1]}</strong></span>
      <div className="gv-first-chips">{copy.examples.map((example, index) => <button type="button" key={example} className={index === 3 ? 'gv-first-own' : undefined} onClick={() => onSetup(undefined, index === 3 ? undefined : example)}>{example}</button>)}</div>
    </section> : <div className="pulse-page-grid gv-grid">
      <aside className="pulse-page-sidebar">
        <section className="gv-weak">
          <span className="gv-chip"><span className="gv-dot" style={{ background: weakest ? '#ff4d4f' : '#8442ff' }} />{copy.weakest}</span>
          <span className="gv-weak-title" data-fit-text="20">{weakest ? weakest.skill.subskills.find(item => item.id === weakest.subskillId)?.title : copy.noWeakest}</span>
          <div className="gv-weak-row">
            {weakest && <div className="gv-weak-stat">
              <span className="gv-weak-number"><strong>{Math.round(weakest.rate * 100)}%</strong><span>{copy.success}</span></span>
              <div aria-hidden="true" className="gv-weak-bar"><div style={{ width: Math.round(weakest.rate * 100) + '%' }}><GrowthHatch width="100%" color="#090a0a" opacity={0.3} /></div></div>
            </div>}
            {(weakest || configured[0]) && <button type="button" className="gv-dark-button" onClick={() => weakest ? onPractice(weakest.skill, weakest.subskillId) : onPractice(configured[0])}><PlayIcon />{copy.train}</button>}
          </div>
        </section>
        {nextSkill && <section className="gv-next">
          <div className="gv-next-top">
            <span className="gv-chip"><span className="gv-dot" style={{ background: '#13f287' }} />{copy.nextMeasurement}</span>
            <span className="gv-next-when">{days ? copy.inDays(days) : copy.today}</span>
          </div>
          <div className="gv-next-bottom">
            <div className="gv-next-copy">
              <span className="gv-next-date"><strong>{growthWeekday(nextSkill.date, lang)}</strong><span>{nextSkill.skill.measure?.time || '~' + nextSkill.skill.measure?.minutes + ' ' + copy.minutes}</span></span>
              <span className="gv-next-how">{nextSkill.skill.measure?.how || nextSkill.skill.title}</span>
            </div>
            <button type="button" className="gv-paper-button" onClick={() => onMeasure(nextSkill.skill)}>{copy.enter}</button>
          </div>
        </section>}
      </aside>
      <div className="pulse-page-main">
        {tiles.map(({ skill, status }) => {
          const ready = isConfiguredSkill(skill);
          const palette = growthPalette(ready ? status.kind : 'no_data');
          const share = ready ? progressShare(skill, currentValue(skill, growth.measurements)) : 0;
          const path = ready ? (skill.goal.label ? skill.goal.label + ' · ' : '') + growthValue(skill, skill.start.value, lang) + ' → ' + growthValueUnit(skill, currentValue(skill, growth.measurements), lang) : (lang === 'uk' ? 'Прогрес ще не вимірюється' : 'Progress is not measured yet');
          return <button type="button" key={skill.id} className="gv-tile" style={{ background: palette.bg, color: palette.ink, '--gv-bg': palette.bg } as React.CSSProperties} onClick={() => setSelectedId(skill.id)}>
            <GrowthHatch width={Math.round(share * 100) + '%'} color={palette.hatch} />
            <span className="gv-glass gv-glass-name"><span className="gv-name" data-fit-text="22">{skill.title}</span><span className="gv-path" data-fit-text="12" style={{ color: palette.sub }}>{path}</span></span>
            <span className="gv-glass gv-glass-value">
              {ready && <span className="gv-value" data-fit-text="24">{Math.round(share * 100)}%</span>}
              <span className="gv-status" style={ready ? { background: palette.chipBg, color: palette.chipInk } : { background: '#6408fa', color: '#ffffff' }}>{ready ? statusText(status, copy) : (lang === 'uk' ? 'Практика' : 'Practice')}</span>
            </span>
          </button>;
        })}
        <div className="gv-add-row"><button type="button" onClick={() => onSetup()}>{copy.addSkill}</button></div>
      </div>
    </div>}
  </div>;
};
