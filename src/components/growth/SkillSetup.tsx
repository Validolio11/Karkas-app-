import React, { useEffect, useRef, useState, type FormEvent } from 'react';
import type { GrowthSkill, Skill } from '../../types';
import type { useGrowth } from '../../hooks/useGrowth';
import type { Language } from '../../utils/i18n';
import { isConfiguredSkill, metricChange } from '../../utils/growth';
import { localTaskDate } from '../../utils/taskDates';
import { growthFormsCopy } from './growthFormsI18n';
import { GrowthHatch, growthDay } from './growthUi';
import { PulseCalendar } from '../pulse/PulseCalendar';
import './growthForms.css';
import { useAutoFitText } from './useAutoFitText';
import { canonical } from '../../utils/canonical';

export interface SkillSetupProps {
  growth: ReturnType<typeof useGrowth>;
  skill?: GrowthSkill;
  initialTitle?: string;
  lang: Language;
  onClose: () => void;
  onSaved: (id: string) => void;
}

const Arrow = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>;
const Check = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>;
const Calendar = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 2v4" /><path d="M16 2v4" /><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M3 10h18" /></svg>;
/** Inputs shown as plain text grow with their value, as in the mockup («62», «95»). */
const fit = (value: string, min = 1) => Math.max(min, value.length) + 0.3 + 'ch';

export const SkillSetup: React.FC<SkillSetupProps> = ({ growth, skill, initialTitle, lang, onClose, onSaved }: SkillSetupProps) => {
  const fitRoot = useAutoFitText<HTMLDivElement>();
  const t = growthFormsCopy(lang);
  const configured = skill && isConfiguredSkill(skill) ? skill : undefined;
  const scope = useRef(growth.scopeKey), draftKey = useRef(`karkas-skill-setup:${growth.scopeKey}:${skill?.id ?? 'new'}`);
  const [draft] = useState(() => { try { const value = JSON.parse(sessionStorage.getItem(draftKey.current) ?? 'null'); return value && typeof value.title === 'string' && Array.isArray(value.subskills) ? value : null; } catch { return null; } });
  const expected = useRef<GrowthSkill | undefined>(draft?.expected ?? skill);
  const [goalEnabled, setGoalEnabled] = useState(!!configured || draft?.goalEnabled === true);
  const [scheduleEnabled, setScheduleEnabled] = useState(draft?.scheduleEnabled ?? !!configured?.measure);
  const today = localTaskDate();
  const [title, setTitle] = useState(draft?.title ?? skill?.title ?? initialTitle ?? '');
  const [metric, setMetric] = useState(draft?.metric ?? configured?.metric.label ?? '');
  const [unit, setUnit] = useState(draft?.unit ?? configured?.metric.unit ?? '');
  const [direction, setDirection] = useState<'up' | 'down'>(draft?.direction ?? configured?.metric.direction ?? 'up');
  const [start, setStart] = useState(draft?.start ?? (configured ? String(configured.start.value) : ''));
  const [goal, setGoal] = useState(draft?.goal ?? (configured ? String(configured.goal.value) : ''));
  const [deadline, setDeadline] = useState(draft?.deadline ?? configured?.goal.date ?? '');
  const [weekday, setWeekday] = useState(draft?.weekday ?? configured?.measure?.weekday ?? 5);
  const [minutes, setMinutes] = useState(draft?.minutes ?? String(configured?.measure?.minutes ?? 10));
  const [how, setHow] = useState(draft?.how ?? configured?.measure?.how ?? '');
  const [time, setTime] = useState(draft?.time ?? configured?.measure?.time ?? '');
  const [subskills, setSubskills] = useState<GrowthSkill['subskills']>(draft?.subskills ?? skill?.subskills ?? []);
  const [error, setError] = useState('');
  const [saveStatus, setSaveStatus] = useState('');
  const calendarButton = useRef<HTMLButtonElement>(null);
  const dateCard = useRef<HTMLDivElement>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const subskillList = useRef<HTMLDivElement>(null);
  const startDate = configured?.start.date ?? today;
  const previewSkill = { metric: { direction } } as Skill;
  const difference = metricChange(previewSkill, Number(start), Number(goal)).delta;
  const number = new Intl.NumberFormat(lang === 'uk' ? 'uk-UA' : 'en-US', { maximumFractionDigits: 2, signDisplay: 'exceptZero' });
  const weeksLeft = deadline ? Math.max(0, Math.round((new Date(deadline + 'T12:00:00').getTime() - new Date(today + 'T12:00:00').getTime()) / 6048e5)) : 0;
  const formSnapshot = canonical({ title, metric, unit, direction, start, goal, deadline, weekday, minutes, how, time, subskills, goalEnabled, scheduleEnabled });
  const lastSaved = useRef(draft ? '' : formSnapshot);
  const clearDraft = () => { try { sessionStorage.removeItem(draftKey.current); } catch { /* The live form remains available. */ } };
  useEffect(() => { if (scope.current !== growth.scopeKey || formSnapshot === lastSaved.current) return; try { sessionStorage.setItem(draftKey.current, JSON.stringify({ title, metric, unit, direction, start, goal, deadline, weekday, minutes, how, time, subskills, goalEnabled, scheduleEnabled, expected: expected.current })); } catch { /* Do not discard input on storage failure. */ } }, [formSnapshot]);
  const persist = (finish = false): boolean => {
    if (scope.current !== growth.scopeKey) return false;
    if (skill && formSnapshot === lastSaved.current) { if (finish) onSaved(skill.id); return true; }
    if (!title.trim()) return false;
    const cleanSubskills = subskills.filter(value => value.title.trim()).map(value => ({ ...value, title: value.title.trim() }));
    const saved = (id: string) => { expected.current = growth.readSkill(id); lastSaved.current = formSnapshot; clearDraft(); setError(''); setSaveStatus(lang === 'uk' ? 'Збережено на пристрої' : 'Saved on this device'); if (finish || !skill) onSaved(id); return true; };
    if (!goalEnabled) {
      if (skill) {
        if (growth.updateSkill(skill.id, { title: title.trim(), subskills: cleanSubskills, needsSetup: true }, expected.current)) return saved(skill.id);
      } else { const id = growth.createPracticeSkill({ title, subskills: cleanSubskills }); if (id) return saved(id); }
      setError(t.saveFailed); return false;
    }
    if (!metric.trim() || !unit.trim() || start.trim() === '' || goal.trim() === '' || !Number.isFinite(Number(start)) || !Number.isFinite(Number(goal))) { setSaveStatus(lang === 'uk' ? 'Незавершене введення збережено як чернетку.' : 'Unfinished entry kept as a draft.'); return false; }
    if ((Number(goal) - Number(start)) * (direction === 'up' ? 1 : -1) < 0 || Number(goal) === Number(start) && (!configured || configured.goal.value !== Number(goal) || configured.start.value !== Number(start))) { setError(t.invalidGoal); return false; }
    const input = {
      title: title.trim(), metric: { label: metric.trim(), unit: unit.trim(), direction },
      start: { value: Number(start), date: startDate }, goal: { value: Number(goal), ...(deadline ? { date: deadline } : {}) },
      measure: scheduleEnabled ? { weekday: weekday as NonNullable<Skill['measure']>['weekday'], minutes: Number(minutes), how: how.trim() || undefined, time: time || undefined } : undefined,
      subskills: cleanSubskills, needsSetup: false,
    };
    if (skill) {
      if (growth.updateSkill(skill.id, input, expected.current)) return saved(skill.id); else setError(t.saveFailed);
    } else {
      const id = growth.createSkill(input);
      if (id) return saved(id); else setError(t.saveFailed);
    }
    return false;
  };
  const submit = (event: FormEvent) => { event.preventDefault(); persist(true); };
  useEffect(() => { if (!skill || formSnapshot === lastSaved.current) return; const timer = window.setTimeout(() => persist(), 600); return () => window.clearTimeout(timer); }, [formSnapshot]);
  const reload = () => {
    const latest = skill && growth.readSkill(skill.id); if (!latest) return;
    const setup = isConfiguredSkill(latest) ? latest : undefined;
    expected.current = latest; setTitle(latest.title); setSubskills(latest.subskills); setGoalEnabled(!!setup); setScheduleEnabled(!!setup?.measure);
    setMetric(setup?.metric.label ?? ''); setUnit(setup?.metric.unit ?? ''); setDirection(setup?.metric.direction ?? 'up'); setStart(setup ? String(setup.start.value) : ''); setGoal(setup ? String(setup.goal.value) : ''); setDeadline(setup?.goal.date ?? ''); setWeekday(setup?.measure?.weekday ?? 5); setMinutes(String(setup?.measure?.minutes ?? 10)); setHow(setup?.measure?.how ?? ''); setTime(setup?.measure?.time ?? '');
    lastSaved.current = canonical({ title: latest.title, metric: setup?.metric.label ?? '', unit: setup?.metric.unit ?? '', direction: setup?.metric.direction ?? 'up', start: setup ? String(setup.start.value) : '', goal: setup ? String(setup.goal.value) : '', deadline: setup?.goal.date ?? '', weekday: setup?.measure?.weekday ?? 5, minutes: String(setup?.measure?.minutes ?? 10), how: setup?.measure?.how ?? '', time: setup?.measure?.time ?? '', subskills: latest.subskills, goalEnabled: !!setup, scheduleEnabled: !!setup?.measure });
    clearDraft(); setError(''); setSaveStatus('');
  };
  useEffect(() => { if (skill && canonical(skill) !== canonical(expected.current) && formSnapshot === lastSaved.current) reload(); }, [skill]);
  const addSubskill = () => {
    setSubskills(previous => [...previous, { id: 'subskill-' + crypto.randomUUID(), title: '' }]);
    requestAnimationFrame(() => (subskillList.current?.querySelector('input:last-of-type') as HTMLInputElement | null)?.focus());
  };

  return <div ref={fitRoot} className="pulse-page-shell growth-setup">
    <div className="pulse-page-head">
      <h1 className="pulse-page-title"><span className="pulse-page-title-light">{skill?.needsSetup ? t.setupFirst : t.newFirst}</span><span className="pulse-page-title-heavy">{skill?.needsSetup ? t.setupSecond : t.newSecond}</span></h1>
      <div className="gf-head-actions"><button className="gf-back" type="button" onClick={onClose} aria-label={t.back}><Arrow /></button></div>
    </div>
    <div className="pulse-page-grid">
      <aside className="pulse-page-sidebar">
        <section className="gf-checks">
          <span className="gf-checks-title">{t.fits}</span>
          {t.checks.map(check => <div className="gf-check" key={check}><span><Check /></span><span>{check}</span></div>)}
        </section>
      </aside>
      <form className="gf-setup-form" onSubmit={submit} onBlurCapture={() => { if (skill) persist(); }}>
        <label className="gf-name"><span>{t.title}</span><input data-fit-text="22" required maxLength={160} autoFocus value={title} placeholder={t.titlePlaceholder} onChange={event => setTitle(event.target.value)} /></label>
        <label className="gf-goal-toggle"><input type="checkbox" disabled={!!configured} checked={goalEnabled} onChange={event => setGoalEnabled(event.target.checked)} /><span>{lang === 'uk' ? 'Встановити ціль' : 'Set a goal'}</span></label>
        {configured && <p className="gf-hint">{lang === 'uk' ? 'Метрика та результати зберігаються. Для практики без цілі створіть окрему навичку.' : 'Your metric and results are preserved. Create a separate skill to practice without a goal.'}</p>}
        {!goalEnabled && <p className="gf-hint">{lang === 'uk' ? 'Можна практикувати вже зараз. Прогрес ще не вимірюється.' : 'Start practising now. Progress is not measured yet.'}</p>}
        {goalEnabled && <>
        <div className="gf-metric">
          <label htmlFor="growth-metric" className="gf-metric-heading"><span>{t.metricFirst}</span> <strong>{t.metricSecond}</strong></label>
          <span className="gf-metric-input">
            <input id="growth-metric" required maxLength={240} value={metric} placeholder={t.metricPlaceholder} onChange={event => setMetric(event.target.value)} />
            <input className="gf-unit" required aria-label={t.unit} placeholder={t.unitPlaceholder} maxLength={24} value={unit} style={{ width: fit(unit || t.unitPlaceholder, 2) }} onChange={event => setUnit(event.target.value)} />
          </span>
          <div className="gf-direction" role="group" aria-label={t.direction}>{(['up', 'down'] as const).map(value => <button key={value} type="button" aria-pressed={direction === value} onClick={() => setDirection(value)}>{value === 'up' ? t.up : t.down}</button>)}</div>
        </div>

        <label className="gf-goal-toggle"><input type="checkbox" checked={scheduleEnabled} onChange={event => setScheduleEnabled(event.target.checked)} /><span>{lang === 'uk' ? 'Нагадувати про щотижневий замір' : 'Weekly measurement reminder'}</span></label>
        {scheduleEnabled && <label className="gf-measure">
          <span>{t.measurement}</span>
          <input aria-label={t.how} value={how} maxLength={500} placeholder={t.howPlaceholder} onChange={event => setHow(event.target.value)} />
          <span className="gf-schedule">{t.weekly} · <select aria-label={t.weekday} value={weekday} onChange={event => setWeekday(Number(event.target.value))}>{t.weekdays.map((day, index) => <option key={day} value={index}>{day}</option>)}</select>
            {' · '}<input type="time" aria-label={t.time} value={time} onChange={event => setTime(event.target.value)} />
            {' · ~'}<input type="number" min="1" max="1440" required aria-label={t.minutes} value={minutes} style={{ width: fit(minutes) }} onChange={event => setMinutes(event.target.value)} /> {t.min}</span>
        </label>}

        <div className="gf-values">
          <label className="gf-value gf-start">
            <span className="gf-value-head"><span>{t.start}</span><span className="gf-pill">{startDate === today ? t.today : growthDay(startDate, lang)}</span></span>
            <span className="gf-value-line"><input data-fit-text="24" type="number" required step="any" aria-label={t.startValue} value={start} placeholder="—" onChange={event => setStart(event.target.value)} /><span>{unit}</span></span>
          </label>
          <label className="gf-value gf-goal">
            <GrowthHatch width="100%" color="#090a0a" opacity={0.14} />
            <span className="gf-value-head"><span>{t.goal}</span>{goal !== '' && Number.isFinite(difference) && <span className="gf-pill">{number.format(difference)}</span>}</span>
            <span className="gf-value-line"><input data-fit-text="24" type="number" step="any" required aria-label={t.goalValue} value={goal} placeholder="—" onChange={event => setGoal(event.target.value)} /><span>{unit}</span></span>
          </label>
          <div ref={dateCard} className="gf-value gf-deadline" data-open={calendarOpen || undefined} onClick={() => setCalendarOpen(open => !open)}>
            <span className="gf-value-head"><span>{t.deadline}</span><button ref={calendarButton} type="button" className="gf-calendar" aria-haspopup="dialog" aria-expanded={calendarOpen} aria-label={t.deadline}><Calendar /></button></span>
            <span className="gf-deadline-value">
              <button type="button" className="gf-deadline-date" aria-haspopup="dialog" aria-expanded={calendarOpen} aria-label={t.deadline + (deadline ? ': ' + deadline : '')}>{deadline ? growthDay(deadline, lang) : '—'}</button>
              <span>{deadline ? new Date(deadline + 'T12:00:00').getFullYear() + ' · ' + t.inWeeks(weeksLeft) : t.pickDate}</span>
            </span>
            {calendarOpen && dateCard.current && calendarButton.current && <PulseCalendar lang={lang} value={deadline} min={startDate} anchor={dateCard.current} revealFrom={calendarButton.current}
              onChange={date => { setDeadline(date); setError(''); }} onClose={() => setCalendarOpen(false)} />}
          </div>
        </div>
        </>}
        <div className="gf-subskills">
          <span>{t.subskills}</span>
          <div className="gf-subskill-list" ref={subskillList}>
            {subskills.map((subskill, index) => <input key={subskill.id} className="gf-subskill" aria-label={t.subskill + ' ' + (index + 1)} value={subskill.title} placeholder={t.subskill} maxLength={120}
              style={{ width: fit(subskill.title || t.subskill, 4) }}
              onChange={event => setSubskills(previous => previous.map(value => value.id === subskill.id ? { ...value, title: event.target.value } : value))}
              onBlur={() => { if (!subskill.title.trim()) setSubskills(previous => previous.filter(value => value.id !== subskill.id)); }}
              onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addSubskill(); } }} />)}
            <button type="button" className="gf-add" onClick={addSubskill}>{t.add}</button>
          </div>
        </div>

        {error && <p role="alert" className="gf-error">{error}</p>}
        {saveStatus && <p role="status" className="gf-hint">{saveStatus}</p>}
        {skill && error && <button type="button" className="gf-action gf-action-dark" onClick={reload}>{lang === 'uk' ? 'Завантажити актуальні дані' : 'Reload current data'}</button>}
        {skill && <p className="gf-hint">{lang === 'uk' ? 'Коректні зміни зберігаються автоматично. Незавершені поля залишаються в чернетці.' : 'Valid changes save automatically. Unfinished fields remain in a draft.'}</p>}
        <div className="gf-form-actions"><button type="button" className="gf-action gf-action-dark" onClick={() => { if (skill) persist(); onClose(); }}>{skill ? (lang === 'uk' ? 'Назад' : 'Back') : t.cancel}</button>{!skill && <button type="submit" className="gf-action gf-action-paper">{t.create}</button>}</div>
      </form>
    </div>
  </div>;
};
