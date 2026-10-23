import { useState } from 'react';
import type { GrowthSkill, PracticeSession, SkillMeasurement } from '../../types';
import type { useGrowth } from '../../hooks/useGrowth';
import type { Language } from '../../utils/i18n';
import { isConfiguredSkill } from '../../utils/growth';
import { PracticeFinishDialog } from './PracticeFinishDialog';

type Growth = ReturnType<typeof useGrowth>;
export function SkillResults({ skill, growth, lang, readOnly = false }: { skill: GrowthSkill; growth: Growth; lang: Language; readOnly?: boolean }) {
  const uk = lang === 'uk';
  const [editor, setEditor] = useState<{ key: string; session?: PracticeSession; measurement?: SkillMeasurement; measurementMode?: boolean } | null>(null);
  const [error, setError] = useState('');
  const sessions = growth.sessions.filter(value => value.skillId === skill.id && value.deletedAt === undefined);
  const measurements = growth.measurements.filter(value => value.skillId === skill.id && value.deletedAt === undefined);
  const rows = [...sessions.map(session => ({ id: session.id, at: session.at, session, measurement: measurements.find(value => value.id === session.measurementId) })),
    ...measurements.filter(value => !value.sessionId || !sessions.some(session => session.id === value.sessionId)).map(measurement => ({ id: measurement.id, at: measurement.at, measurement, session: undefined }))].sort((a, b) => b.at - a.at);
  return <section className="gv-results" aria-label={uk ? 'Практика й результати' : 'Practice and results'}>
    <div className="gv-results-head"><h2>{uk ? 'Практика й результати' : 'Practice and results'}</h2>{!readOnly && <div className="gf-practice-actions"><button type="button" className="gf-save" onClick={() => setEditor({ key: crypto.randomUUID() })}>{uk ? 'Записати практику' : 'Record practice'}</button>{isConfiguredSkill(skill) && <button type="button" className="gf-skip" onClick={() => setEditor({ key: crypto.randomUUID(), measurementMode: true })}>{uk ? 'Новий замір' : 'New measurement'}</button>}</div>}</div>
    {editor && !readOnly && <PracticeFinishDialog key={editor.key} growth={growth} inline skill={skill} session={editor.session} measurement={editor.measurement} measurementMode={editor.measurementMode} measurements={growth.measurements} lang={lang} onSave={(input, measurement) => !!growth.addPracticeSession(input, measurement)} onClose={() => setEditor(null)} onSkip={() => setEditor(null)} />}
    {!rows.length && <p className="gf-hint">{uk ? 'Записів ще немає. Практика без заміру також зберігається.' : 'No records yet. Practice without a measurement is saved too.'}</p>}
    {rows.map(row => <div className="gv-result-row" key={row.id}>
      <div><time dateTime={new Date(row.at).toISOString()}>{new Date(row.at).toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' })}</time><button type="button" className="gv-result-value" disabled={readOnly} aria-label={uk ? 'Редагувати цей результат' : 'Edit this result'} onClick={() => setEditor({ key: row.id, session: row.session, measurement: row.measurement })}><strong>{row.measurement ? row.measurement.value.toLocaleString(lang, { maximumFractionDigits: 2 }) + (isConfiguredSkill(skill) ? ' ' + skill.metric.unit : '') : uk ? 'Практика' : 'Practice'}</strong></button>{row.session?.result && <span>{row.session.result.done} / {row.session.result.of}</span>}{(row.session?.lesson || row.measurement?.note) && <p>{row.session?.lesson || row.measurement?.note}</p>}</div>
      {!readOnly && <div className="gv-result-actions"><button type="button" onClick={() => setEditor({ key: row.id, session: row.session, measurement: row.measurement })}>{uk ? 'Редагувати' : 'Edit'}</button><button type="button" onClick={() => {
        if (row.session ? growth.deletePracticeSession(row.id) : growth.deleteMeasurement(row.id)) { setError(''); if (editor?.key === row.id) setEditor(null); }
        else setError(uk ? 'Не видалено. Введення збережено; повторіть.' : 'Not deleted. Your entry is preserved; retry.');
      }}>{uk ? 'Видалити' : 'Delete'}</button></div>}
    </div>)}
    {error && <p className="gf-error" role="alert">{error}</p>}
  </section>;
}
