import React, { useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import type { PSTask, Skill, GrowthSkill, SkillMeasurement, PracticeSession } from '../../types';
import type { useGrowth } from '../../hooks/useGrowth';
import type { Language } from '../../utils/i18n';
import { currentValue, practiceResultPreview, isConfiguredSkill } from '../../utils/growth';
import { PracticeResultPanel } from './PracticeResultPanel';
import { useDialogKeyboard } from '../useDialogKeyboard';
import { growthFormsCopy } from './growthFormsI18n';
import { formatGrowthNumber } from './growthUi';
import './growthForms.css';

export interface PracticeFinishDialogProps {
  skill: GrowthSkill;
  growth?: ReturnType<typeof useGrowth>;
  inline?: boolean;
  session?: PracticeSession;
  measurement?: SkillMeasurement;
  measurements: SkillMeasurement[];
  task?: PSTask;
  measurementMode?: boolean;
  lang: Language;
  onSave: (input: Parameters<ReturnType<typeof useGrowth>['addPracticeSession']>[0], measurement?: Parameters<ReturnType<typeof useGrowth>['addPracticeSession']>[1]) => boolean;
  onClose: () => void;
  onSkip: () => void;
}

const StepIcon = ({ plus = false }: { plus?: boolean }) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">{plus ? <path d="M12 5v14M5 12h14" /> : <path d="M5 12h14" />}</svg>;
const fit = (value: string, min = 1) => Math.max(min, value.length) + 0.3 + 'ch';

const LegacyPracticeFinishDialog = ({ skill, measurements, task, measurementMode = false, lang, onSave, onClose, onSkip }: Omit<PracticeFinishDialogProps, 'skill'> & { skill: Skill }) => {
  const t = growthFormsCopy(lang);
  const isPercent = skill.metric.unit.trim() === '%';
  const current = currentValue(skill, measurements);
  // A percentage is counted from attempts: «2 з 10» starts near the current level.
  const [of, setOf] = useState('10');
  const [done, setDone] = useState(String(isPercent ? Math.round(current / 10) : current));
  const [difficulty, setDifficulty] = useState<PracticeSession['difficulty']>('edge');
  const [lesson, setLesson] = useState('');
  const [counted, setCounted] = useState(measurementMode);
  const [saveFailed, setSaveFailed] = useState(false);
  const submitted = useRef(false);
  const preview = practiceResultPreview(skill, measurements, Number(done), Number(of));
  const above = preview.comparison === 'better';
  const level = formatGrowthNumber(current, lang) + (isPercent ? '%' : '');
  const comparison = preview.value === current ? t.same : (preview.value > current ? t.above : t.below) + ' ' + level;
  const minutes = task?.timeSpentSeconds ? Math.round(task.timeSpentSeconds / 60) : 0;
  useDialogKeyboard(true, onClose, 'growth-practice-dialog');
  const step = (amount: number) => setDone(previous => {
    const next = Number(previous) + amount;
    return String(isPercent ? Math.max(0, Math.min(Number(of), next)) : next);
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (submitted.current || !Number.isFinite(preview.value) || !Number.isFinite(Number(done)) || done === '' || isPercent && (Number(of) <= 0 || Number(done) < 0 || Number(done) > Number(of))) return;
    submitted.current = true;
    const saved = onSave({ skillId: skill.id, ...(task ? { taskId: task.id, subskillId: task.subskillId, durationSeconds: task.timeSpentSeconds } : {}), difficulty,
      ...(isPercent ? { result: { done: Number(done), of: Number(of) } } : {}), ...(lesson.trim() ? { lesson: lesson.trim() } : {}),
    }, counted ? { value: preview.value, ...(lesson.trim() ? { note: lesson.trim() } : {}) } : undefined);
    if (!saved) { submitted.current = false; setSaveFailed(true); }
  };
  const levels = [{ value: 'easy', text: t.easy, tip: t.easyTip }, { value: 'edge', text: t.edge, tip: t.edgeTip }, { value: 'hard', text: t.hard, tip: t.hardTip }] as const;
  return createPortal(<div className="gf-practice-overlay app-no-drag" onClick={event => event.stopPropagation()}>
    <form id="growth-practice-dialog" className="gf-practice-dialog" role="dialog" aria-modal="true" aria-labelledby="growth-practice-title" onSubmit={submit}>
      <div className="gf-practice-head">
        <div><span>{skill.title}{minutes ? ' · ' + minutes + ' ' + t.min : ''}</span><h1 id="growth-practice-title">{task?.title ?? (measurementMode ? skill.measure?.how?.trim() || t.measurement : t.finish)}</h1></div>
        <button type="button" className="gf-close" onClick={onClose} aria-label={t.close}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg></button>
      </div>

      <div className="gf-result">
        {isPercent
          ? <span className="gf-result-label">{t.successes} {t.of} <input type="number" aria-label={t.attempts} required min="1" step="1" value={of} style={{ width: fit(of) }} onChange={event => setOf(event.target.value)} /></span>
          : <label className="gf-result-label" htmlFor="growth-practice-result">{skill.metric.label || t.result}{skill.metric.unit ? ', ' + skill.metric.unit : ''}</label>}
        <div className="gf-stepper">
          <button type="button" onClick={() => step(-1)} aria-label={t.less} disabled={isPercent && Number(done) <= 0}><StepIcon /></button>
          <input id="growth-practice-result" type="number" aria-live="polite" aria-label={t.result} required step="any" min={isPercent ? 0 : undefined} max={isPercent ? Number(of) : undefined} value={done} style={{ width: fit(done, 2) }} onChange={event => setDone(event.target.value)} />
          <button type="button" onClick={() => step(1)} aria-label={t.more} disabled={isPercent && Number(done) >= Number(of)}><StepIcon plus /></button>
        </div>
        <output className="gf-result-chip" style={above ? { background: '#13f287', color: '#090a0a' } : undefined}>
          <span>{formatGrowthNumber(preview.value, lang) + (isPercent ? '%' : '')}</span><span>{comparison}</span>
        </output>
      </div>

      <div className="gf-difficulty" role="radiogroup" aria-label={t.difficulty}>{levels.map((item, index) => <button key={item.value} type="button" role="radio" aria-checked={difficulty === item.value} data-tip={item.tip} tabIndex={difficulty === item.value ? 0 : -1} onClick={() => setDifficulty(item.value)} onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        const next = (index + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + levels.length) % levels.length;
        setDifficulty(levels[next].value);
        (event.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
      }}>{item.text}</button>)}</div>

      <label className="gf-lesson"><span className="gf-sr-only">{t.lesson}</span><input type="text" value={lesson} maxLength={1000} placeholder={t.lesson} onChange={event => setLesson(event.target.value)} /></label>
      {saveFailed && <p className="gf-error" role="alert">{t.saveFailed}</p>}
      <div className="gf-practice-actions">
        <button type="button" role="checkbox" aria-checked={counted} aria-labelledby="growth-count-label" className="gf-count-check" onClick={() => setCounted(value => !value)}
          style={{ background: counted ? '#090a0a' : 'transparent', boxShadow: 'inset 0 0 0 2px ' + (counted ? '#090a0a' : '#aeaeb2') }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ opacity: counted ? 1 : 0 }}><path d="M20 6 9 17l-5-5" /></svg>
        </button>
        <span id="growth-count-label" className="gf-count-label" onClick={() => setCounted(value => !value)}>{t.measurement}</span>
        <button type="button" className="gf-skip" onClick={onSkip}>{t.skip}</button>
        <button type="submit" className="gf-save">{t.save}</button>
      </div>
    </form>
  </div>, document.body);
};

export function PracticeFinishDialog(props: PracticeFinishDialogProps) {
  return props.growth || !isConfiguredSkill(props.skill) ? <PracticeResultPanel {...props} /> : <LegacyPracticeFinishDialog {...props} skill={props.skill} />;
}
