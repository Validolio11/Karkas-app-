import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { useGrowth } from '../../hooks/useGrowth';
import type { Skill } from '../../types';
import type { Language } from '../../utils/i18n';
import { currentValue, goalVersionOf, isConfiguredSkill, isGoalReached } from '../../utils/growth';
import { localTaskDate } from '../../utils/taskDates';
import { useDialogKeyboard } from '../useDialogKeyboard';
import './growthForms.css';

type Growth = ReturnType<typeof useGrowth>;

export function GoalAchievement({ growth, skill, lang, onClose, onNewSkill }: { growth: Growth; skill: Skill; lang: Language; onClose: () => void; onNewSkill?: (skill: Skill) => void }) {
  const uk = lang === 'uk', version = goalVersionOf(skill);
  const current = currentValue(skill, growth.measurements), percentage = skill.metric.unit.trim() === '%';
  const atLimit = percentage && (skill.metric.direction === 'down' ? current <= 0 : current >= 100);
  const [newGoal, setNewGoal] = useState(false), [value, setValue] = useState(''), [date, setDate] = useState(''), [error, setError] = useState('');
  const complete = (action: 'completed' | 'maintaining') => {
    if (growth.resolveGoal(skill.id, action, version)) onClose();
    else setError(uk ? 'Результат змінився або запис не збережено. Перевірте дані й повторіть.' : 'The result changed or could not be saved. Check the data and retry.');
  };
  const save = () => {
    if (!value.trim() || !Number.isFinite(Number(value)) || date && date < localTaskDate()) return false;
    if (growth.startNewGoal(skill.id, version, Number(value), date || undefined)) { onClose(); return true; }
    setError(uk ? 'Нова ціль має продовжувати прогрес у вибраному напрямку. Перевірте дані й повторіть.' : 'The new goal must continue progress in the chosen direction. Check and retry.'); return false;
  };
  useDialogKeyboard(true, onClose, 'growth-goal-achievement');
  return createPortal(<div className="gf-practice-overlay app-no-drag" onClick={event => event.stopPropagation()}>
    <section id="growth-goal-achievement" className="gf-practice-dialog gf-goal-achievement" role="dialog" aria-modal="true" aria-labelledby="growth-achievement-title">
      <div className="gf-practice-head"><div><span>{skill.title}</span><h2 id="growth-achievement-title">{uk ? 'Цілі досягнуто!' : 'Goal reached!'}</h2></div><button type="button" className="gf-close" aria-label={uk ? 'Закрити' : 'Close'} onClick={onClose}>×</button></div>
      <p className="gf-achievement-value">{currentValue(skill, growth.measurements).toLocaleString(lang)} {skill.metric.unit}</p>
      <p className="gf-hint">{uk ? 'Це підтверджено вашим заміром. Оберіть наступний крок; завершені завдання рахуються окремо.' : 'Confirmed by your measurement. Choose the next step; completed tasks are counted separately.'}</p>
      {atLimit && <p className="gf-hint">{uk ? 'Ви досягли межі цієї відсоткової метрики. Для наступної цілі створіть навичку з іншою метрикою; ці результати збережуться.' : 'You reached the limit of this percentage metric. Create a skill with another metric for your next goal; these results stay preserved.'}</p>}
      {!newGoal ? <div className="gf-practice-actions"><button type="button" className="gf-save" onClick={() => complete('completed')}>{uk ? 'Завершити навичку' : 'Complete skill'}</button><button type="button" className="gf-skip" onClick={() => complete('maintaining')}>{uk ? 'Підтримувати рівень' : 'Maintain level'}</button>{atLimit ? <button type="button" className="gf-skip" disabled={!onNewSkill} onClick={() => { onClose(); onNewSkill?.(skill); }}>{uk ? 'Нова навичка з іншою метрикою' : 'New skill with another metric'}</button> : <button type="button" className="gf-skip" onClick={() => setNewGoal(true)}>{uk ? 'Нова ціль' : 'New goal'}</button>}</div>
        : <form className="gf-new-goal" onSubmit={event => { event.preventDefault(); save(); }}>
          <label>{uk ? 'Нова ціль' : 'New goal'}<input autoFocus type="number" step="any" min={percentage ? 0 : undefined} max={percentage ? 100 : undefined} value={value} placeholder="—" onChange={event => { setValue(event.target.value); setError(''); }} onBlur={event => { if (event.relatedTarget && event.currentTarget.form?.contains(event.relatedTarget as Node)) return; save(); }} required /></label>
          <label>{uk ? 'Дата · необов’язково' : 'Date · optional'}<input type="date" min={localTaskDate()} value={date} onChange={event => setDate(event.target.value)} onBlur={save} /></label>
          <p className="gf-hint">{uk ? 'Коректна ціль збережеться при виході з поля. Попереднє досягнення залишиться у даних навички.' : 'A valid goal saves when you leave the field. The previous achievement stays in the skill data.'}</p>
          <div className="gf-practice-actions"><button type="submit" className="gf-save">{uk ? 'Застосувати' : 'Apply'}</button><button type="button" className="gf-skip" onClick={() => setNewGoal(false)}>{uk ? 'Назад' : 'Back'}</button></div>
        </form>}
      {error && <p className="gf-error" role="alert">{error}</p>}
    </section>
  </div>, document.body);
}

/** Mount once in App so results recorded from Tasks receive the same lifecycle feedback. */
export function GrowthFeedback({ growth, lang, onNewSkill }: { growth: Growth; lang: Language; onNewSkill?: (skill: Skill) => void }) {
  const [opened, setOpened] = useState<{ id: string; version: string; scopeKey: string } | null>(null), [undoError, setUndoError] = useState(false);
  const shown = useRef(new Set<string>());
  useEffect(() => { setOpened(null); shown.current.clear(); }, [growth.scopeKey]);
  useEffect(() => {
    if (opened) return;
    const skill = growth.skills.find((value): value is Skill => isConfiguredSkill(value) && value.deletedAt === undefined && value.archivedAt === undefined && value.goalState === 'achieved'
      && value.goalAcknowledgedVersion !== goalVersionOf(value) && !shown.current.has(growth.scopeKey + value.id + goalVersionOf(value)) && isGoalReached(value, currentValue(value, growth.measurements)));
    if (!skill) return;
    const version = goalVersionOf(skill);
    if (growth.acknowledgeGoal(skill.id, version)) { shown.current.add(growth.scopeKey + skill.id + version); setOpened({ id: skill.id, version, scopeKey: growth.scopeKey }); }
  }, [growth.skills, growth.measurements, opened]);
  const skill = opened?.scopeKey === growth.scopeKey ? growth.skills.find((value): value is Skill => value.id === opened.id && isConfiguredSkill(value) && value.deletedAt === undefined && value.archivedAt === undefined && goalVersionOf(value) === opened.version && value.goalState === 'achieved' && isGoalReached(value, currentValue(value, growth.measurements))) : undefined;
  useEffect(() => { if (opened && !skill) setOpened(null); }, [opened, skill]);
  useEffect(() => setUndoError(false), [growth.undoNotice?.expiresAt]);
  return <>
    {skill && <GoalAchievement key={skill.id + goalVersionOf(skill)} growth={growth} skill={skill} lang={lang} onClose={() => setOpened(null)} onNewSkill={onNewSkill} />}
    {growth.undoNotice && <div className="gf-undo-notice" role="status"><span>{undoError ? (lang === 'uk' ? 'Запис уже змінено. Скасування недоступне.' : 'The record changed. Undo is unavailable.') : (lang === 'uk' ? 'Зміну збережено' : 'Change saved')}</span><button type="button" disabled={undoError} onClick={() => { if (!growth.undoLastChange()) setUndoError(true); }}>{lang === 'uk' ? 'Скасувати' : 'Undo'}</button><button type="button" aria-label={lang === 'uk' ? 'Закрити' : 'Close'} onClick={growth.dismissUndo}>×</button></div>}
  </>;
}
