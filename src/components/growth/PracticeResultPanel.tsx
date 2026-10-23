import { useEffect, useRef, useState } from 'react';
import type { PracticeSession, SkillMeasurement } from '../../types';
import type { PracticeFinishDialogProps } from './PracticeFinishDialog';
import { currentValue, isConfiguredSkill } from '../../utils/growth';
import { canonical } from '../../utils/canonical';
import type { GrowthUndoTarget, PracticeResultExpected } from '../../hooks/useGrowthActions';

const localStamp = (at: number) => { const date = new Date(at); return new Date(at - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
type ResultDraft = { id: string; done: string; of: string; lesson: string; at: string; exactAt?: number; exactAtText?: string; counted: boolean; difficulty?: PracticeSession['difficulty']; expected: PracticeResultExpected; measurementExpected?: SkillMeasurement };
function readDraft(key: string): ResultDraft | null {
  try { const value = JSON.parse(sessionStorage.getItem(key) ?? 'null'); return value && typeof value.id === 'string' && ['done', 'of', 'lesson', 'at'].every(field => typeof value[field] === 'string') && typeof value.counted === 'boolean' && value.expected ? value as ResultDraft : null; } catch { return null; }
}

/** One stable result, edited in place. Opening the panel never writes a result. */
export function PracticeResultPanel({ skill, task, measurements, measurementMode = false, session: initialSession, measurement: initialMeasurement,
  growth, lang, onSave, onClose, onSkip, inline = false }: PracticeFinishDialogProps) {
  const uk = lang === 'uk', configured = isConfiguredSkill(skill);
  const linkedSession = initialSession ?? (initialMeasurement?.sessionId ? growth?.sessions.find(value => value.id === initialMeasurement.sessionId && value.deletedAt === undefined) : undefined);
  const standalone = !!initialMeasurement && !linkedSession;
  const percent = configured && skill.metric.unit.trim() === '%' && !standalone;
  const scope = useRef(growth?.scopeKey ?? 'legacy');
  // Task result props become an existing session after the first autosave; keep its draft namespace stable.
  const draftKey = useRef(`karkas-growth-result:${scope.current}:${skill.id}:${task?.id ?? linkedSession?.id ?? initialMeasurement?.id ?? 'new'}`);
  const [draft] = useState(() => readDraft(draftKey.current));
  const id = useRef(draft?.id ?? linkedSession?.id ?? `practice-${crypto.randomUUID()}`);
  const undoTarget: GrowthUndoTarget = standalone ? { collection: 'measurements', id: initialMeasurement.id } : { collection: 'practiceSessions', id: id.current };
  const expected = useRef<PracticeResultExpected>(draft?.expected ?? { session: linkedSession ?? null, measurement: initialMeasurement ?? (linkedSession?.measurementId ? measurements.find(value => value.id === linkedSession.measurementId && value.deletedAt === undefined) ?? null : null) });
  const measurementExpected = useRef(draft?.measurementExpected ?? initialMeasurement);
  const initialResult = linkedSession?.result;
  const [done, setDone] = useState(draft?.done ?? (initialResult ? String(initialResult.done) : initialMeasurement && !percent ? String(initialMeasurement.value) : ''));
  const [of, setOf] = useState(draft?.of ?? (initialResult ? String(initialResult.of) : ''));
  const [lesson, setLesson] = useState(draft?.lesson ?? linkedSession?.lesson ?? initialMeasurement?.note ?? '');
  const [difficulty, setDifficulty] = useState<PracticeSession['difficulty']>(draft?.difficulty ?? linkedSession?.difficulty);
  const [counted, setCounted] = useState(configured && (draft?.counted ?? (!!initialMeasurement || measurementMode)));
  const exactAt = useRef(draft?.exactAt ?? linkedSession?.at ?? initialMeasurement?.at ?? (draft ? new Date(draft.at).getTime() : Date.now()));
  const exactAtText = useRef(draft?.exactAtText ?? localStamp(exactAt.current));
  const [at, setAt] = useState(draft?.at ?? exactAtText.current);
  const [dirty, setDirty] = useState(!!draft);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error' | 'invalid'>('idle');
  const [message, setMessage] = useState(draft ? (uk ? 'Відновлено незавершене введення.' : 'Unfinished entry restored.') : '');
  const locked = useRef(false), lastSaved = useRef('');
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (inline) panel.current?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
      (panel.current?.querySelector<HTMLInputElement>('input[type="number"]')
        ?? panel.current?.querySelector<HTMLInputElement>('.gf-lesson input'))?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  const changed = () => { setDirty(true); setMessage(''); setStatus('idle'); };
  const value = percent ? Number(done) / Number(of) * 100 : Number(done);
  const validNumber = !configured || (!counted && done === '' && of === '') || done.trim() !== '' && Number.isFinite(value) && (!(configured && counted && skill.metric.unit.trim() === '%') || value >= 0 && value <= 100) && (!percent || of.trim() !== '' && Number.isInteger(Number(done)) && Number.isInteger(Number(of)) && Number(of) > 0 && Number(done) >= 0 && Number(done) <= Number(of));
  const snapshot = canonical({ done, of, lesson, difficulty, counted, at });
  const clearDraft = () => { try { sessionStorage.removeItem(draftKey.current); } catch { /* Storage may be unavailable. */ } };
  useEffect(() => {
    if (growth && scope.current !== growth.scopeKey) return;
    if (!dirty) { clearDraft(); return; }
    try { sessionStorage.setItem(draftKey.current, JSON.stringify({ id: id.current, done, of, lesson, difficulty, counted, at, exactAt: exactAt.current, exactAtText: exactAtText.current, expected: expected.current, measurementExpected: measurementExpected.current })); } catch { /* Keep the live draft if browser storage is full. */ }
  }, [snapshot, dirty]);
  const flush = (force = false): boolean => {
    if (growth && scope.current !== growth.scopeKey) return false;
    if (!force && (!dirty || snapshot === lastSaved.current)) return true;
    if (locked.current) return false;
    // datetime-local displays minutes; unrelated edits retain the record's precise original timestamp.
    const timestamp = at === exactAtText.current ? exactAt.current : new Date(at).getTime();
    if (!validNumber || !Number.isFinite(timestamp) || timestamp > Date.now() + 60000) { setDirty(true); setStatus('invalid'); return false; }
    if (standalone && !measurementExpected.current) { setStatus('error'); setMessage(uk ? 'Цей замір уже видалено. Введення збережено; створіть новий запис окремо.' : 'This measurement was deleted. Your entry is kept; create a new record separately.'); return false; }
    const input = { id: id.current, skillId: skill.id, at: timestamp, difficulty,
      taskId: linkedSession?.taskId ?? task?.id, subskillId: linkedSession?.subskillId ?? task?.subskillId, durationSeconds: linkedSession?.durationSeconds ?? task?.timeSpentSeconds,
      ...(percent && done !== '' ? { result: { done: Number(done), of: Number(of) } } : {}), ...(lesson.trim() ? { lesson: lesson.trim() } : {}) };
    const measurement = configured && counted ? { value, ...(lesson.trim() ? { note: lesson.trim() } : {}) } : undefined;
    locked.current = true; setStatus('saving');
    let saved = false;
    try { saved = growth ? standalone && measurementExpected.current
      ? growth.saveMeasurement({ ...measurementExpected.current, value, at: timestamp, note: lesson.trim() || undefined }, measurementExpected.current)
      : !!growth.savePracticeResult(input, measurement, expected.current)
      : onSave(input, measurement); } catch { saved = false; }
    locked.current = false;
    if (!saved) { setStatus('error'); setMessage(uk ? 'Не збережено. Дані могли змінитися в іншому місці. Введення залишилося тут; повторіть або відкрийте актуальний запис.' : 'Not saved. The record may have changed elsewhere. Your entry is kept here; retry or reopen the current record.'); return false; }
    if (growth) {
      expected.current = growth.readPracticeResult(id.current);
      if (standalone && measurementExpected.current) measurementExpected.current = growth.readMeasurement(measurementExpected.current.id);
    }
    exactAt.current = timestamp; exactAtText.current = at;
    clearDraft(); lastSaved.current = snapshot; setDirty(false); setStatus('saved'); return true;
  };
  useEffect(() => { if (!dirty || !growth) return; const timer = window.setTimeout(() => flush(), 600); return () => window.clearTimeout(timer); }, [snapshot, dirty]);
  useEffect(() => { if (growth && dirty && validNumber) flush(); }, [difficulty, counted]);
  const close = () => { if (flush()) onClose(); };
  const reload = () => {
    if (!growth) return;
    expected.current = growth.readPracticeResult(id.current);
    const restoredMeasurement = standalone && initialMeasurement ? growth.readMeasurement(initialMeasurement.id) : expected.current.measurement;
    measurementExpected.current = restoredMeasurement ?? undefined;
    const restoredSession = expected.current.session?.deletedAt === undefined ? expected.current.session : null;
    setDone(restoredSession?.result ? String(restoredSession.result.done) : restoredMeasurement && restoredMeasurement.deletedAt === undefined && !percent ? String(restoredMeasurement.value) : '');
    setOf(restoredSession?.result ? String(restoredSession.result.of) : ''); setLesson(restoredSession?.lesson ?? restoredMeasurement?.note ?? '');
    setCounted(configured && !!restoredMeasurement && restoredMeasurement.deletedAt === undefined); setDifficulty(restoredSession?.difficulty);
    exactAt.current = restoredSession?.at ?? restoredMeasurement?.at ?? Date.now(); exactAtText.current = localStamp(exactAt.current);
    setAt(exactAtText.current); lastSaved.current = '';
    clearDraft(); setDirty(false); setStatus('idle'); setMessage('');
  };
  const undo = () => {
    if (!growth?.undoLastChange(undoTarget)) { setMessage(uk ? 'Не вдалося скасувати: остання зміна стосується іншого запису або вже неактуальна.' : 'Cannot undo: the latest change belongs to another record or is no longer current.'); return; }
    reload(); setMessage(uk ? 'Зміну скасовано.' : 'Change undone.');
  };
  useEffect(() => {
    if (!growth || scope.current !== growth.scopeKey) return;
    const actual = standalone && initialMeasurement ? growth.readMeasurement(initialMeasurement.id) : growth.readPracticeResult(id.current);
    const baseline = standalone ? measurementExpected.current : expected.current;
    if (canonical(actual) === canonical(baseline)) return;
    if (!dirty) reload();
    else { setStatus('error'); setMessage(uk ? 'Запис змінився. Ваше введення збережено тут; відкрийте актуальний запис перед повторною зміною.' : 'The record changed. Your entry is kept here; reload the current record before editing again.'); }
  }, [growth?.measurements, growth?.sessions]);
  const content = <section ref={panel} className="gf-practice-dialog gf-result-panel" aria-label={uk ? 'Запис результату' : 'Record result'} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }}>
    <div className="gf-practice-head"><div><span>{skill.title}</span><h2>{initialSession || initialMeasurement ? (uk ? 'Редагувати результат' : 'Edit result') : (uk ? 'Записати результат' : 'Record result')}</h2></div><button type="button" className="gf-close" aria-label={uk ? 'Закрити' : 'Close'} onClick={close}>×</button></div>
    {configured && !standalone && <label className="gf-goal-toggle"><input type="checkbox" checked={counted} onChange={event => { setCounted(event.target.checked); changed(); }} /><span>{counted ? (uk ? 'Контрольний замір · оновлює графік цілі' : 'Measurement · updates the goal chart') : (uk ? 'Лише практика й висновок' : 'Practice and lesson only')}</span></label>}
    {!configured && <p className="gf-hint">{uk ? 'Прогрес ще не вимірюється. Зберігаємо практику, реальний час і висновок.' : 'Progress is not measured yet. Record practice, real time and a lesson.'}</p>}
    {configured && (counted || percent) && <div className="gf-result-fields"><label>{percent ? (uk ? 'Успішних спроб' : 'Successful attempts') : skill.metric.label}<input type="number" step={percent ? '1' : 'any'} value={done} placeholder={percent ? '—' : String(currentValue(skill, measurements))} onFocus={event => event.currentTarget.select()} onChange={event => { setDone(event.target.value); changed(); }} onBlur={() => flush()} /></label>
      {percent && <label>{uk ? 'Усього спроб' : 'Total attempts'}<input type="number" min="1" step="1" value={of} placeholder="—" onFocus={event => event.currentTarget.select()} onChange={event => { setOf(event.target.value); changed(); }} onBlur={() => flush()} /></label>}
      {done !== '' && validNumber && <output>{percent ? value.toLocaleString(lang, { maximumFractionDigits: 1 }) + '%' : done + ' ' + skill.metric.unit}{counted ? (uk ? ' · попередній перегляд заміру' : ' · measurement preview') : ''}</output>}
    </div>}
    <label className="gf-result-date">{uk ? 'Дата й час' : 'Date and time'}<input type="datetime-local" value={at} onChange={event => { setAt(event.target.value); changed(); }} onBlur={() => flush()} /></label>
    {!standalone && <div className="gf-difficulty" role="group" aria-label={uk ? 'Складність' : 'Difficulty'}>{(['easy', 'edge', 'hard'] as const).map((level, index) => <button type="button" key={level} aria-pressed={difficulty === level} onClick={() => { setDifficulty(previous => previous === level ? undefined : level); changed(); }}>{(uk ? ['Легко', 'На межі', 'Складно'] : ['Easy', 'At the edge', 'Hard'])[index]}</button>)}</div>}
    <label className="gf-lesson"><span className="gf-sr-only">{uk ? 'Висновок' : 'Lesson'}</span><input value={lesson} maxLength={1000} placeholder={uk ? 'Що зміню наступного разу?' : 'What will I change next time?'} onChange={event => { setLesson(event.target.value); changed(); }} onBlur={() => flush()} /></label>
    <p role="status" className="gf-hint">{status === 'saving' ? (uk ? 'Зберігаємо…' : 'Saving…') : status === 'saved' ? (uk ? 'Збережено на пристрої' : 'Saved on this device') : status === 'invalid' ? (uk ? 'Вкажіть коректний результат і дату. Введення не втрачено.' : 'Enter a valid result and date. Your entry is kept.') : status === 'idle' ? (uk ? 'Змінені коректні поля зберігаються автоматично.' : 'Valid changed fields save automatically.') : ''}</p>
    {message && <p className="gf-error" role={status === 'error' ? 'alert' : 'status'}>{message}</p>}
    <div className="gf-practice-actions">{status === 'error' && <button type="button" className="gf-save" onClick={() => flush(true)}>{uk ? 'Повторити' : 'Retry'}</button>}{growth?.undoNotice && growth.canUndoChange(undoTarget) && <button type="button" className="gf-skip" onClick={undo}>{uk ? 'Скасувати зміну' : 'Undo change'}</button>}
      {(!growth || !initialSession && !initialMeasurement && status !== 'saved') && <button type="button" className="gf-save" onClick={() => flush(true)}>{uk ? 'Зафіксувати практику' : 'Record practice'}</button>}
      {status === 'error' && <button type="button" className="gf-skip" onClick={reload}>{uk ? 'Відкрити актуальний запис' : 'Reload current record'}</button>}
      {(status === 'invalid' || status === 'error') && <button type="button" className="gf-skip" onClick={() => { clearDraft(); onClose(); }}>{uk ? 'Відкинути зміни' : 'Discard changes'}</button>}
      <button type="button" className="gf-skip" onClick={() => { if (flush()) onSkip(); }}>{uk ? 'Готово' : 'Done'}</button>
    </div>
  </section>;
  return inline ? content : <div className="gf-practice-overlay app-no-drag">{content}</div>;
}
