import React, { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import type { GrowthSkill, PracticeSession, PSTask, Skill, SkillMeasurement, TaskTab } from '../../types';
import { localTaskDate } from '../../utils/taskDates';
import type { DaySummary } from '../../utils/dayRecap';
import { isConfiguredSkill, plateau, skillStatus, weakestSubskill } from '../../utils/growth';
import { KarkasLogo } from './KarkasLogo';
import './today.css';

interface TodaySidebarProps {
  tasks: readonly PSTask[];
  tabs: readonly TaskTab[];
  now: number;
  lang: 'uk' | 'en';
  summary: DaySummary;
  suggestion?: string;
  skills?: readonly GrowthSkill[];
  measurements?: readonly SkillMeasurement[];
  sessions?: readonly PracticeSession[];
  firstRun?: boolean;
  onReveal: (id: string) => void;
  onDiscuss: (text: string) => void;
  onCloseDay: () => void;
  onAddPractice?: (skill: Skill, subskillId?: string, title?: string) => void;
  onSetupSkill?: (initialTitle?: string) => void;
}

type SlotKind = 'done' | 'now' | 'practice' | 'plain';

function durationLabel(task: PSTask, lang: 'uk' | 'en') {
  const seconds = task.scheduledDurationSeconds ?? task.plannedDurationSeconds ?? task.countdownDurationSeconds;
  if (!seconds) return '';
  const minutes = Math.round(seconds / 60);
  if (minutes >= 60 && minutes % 60 === 0) return minutes / 60 + (lang === 'uk' ? ' год' : ' h');
  return minutes + (lang === 'uk' ? ' хв' : ' min');
}

/** One growth hint for the day: a stalled or lagging skill and its weakest part. */
function growthHints(skills: readonly GrowthSkill[], measurements: readonly SkillMeasurement[], sessions: readonly PracticeSession[], now: number, lang: 'uk' | 'en') {
  const uk = lang === 'uk';
  return skills.filter(isConfiguredSkill).filter(skill => skill.deletedAt === undefined && skill.archivedAt === undefined).flatMap(skill => {
    const stalled = plateau(skill, measurements, now);
    const status = skillStatus(skill, measurements, now);
    if (!stalled && status.kind !== 'behind') return [];
    const weak = weakestSubskill(skill, sessions);
    const subskill = skill.subskills.find(item => item.id === weak?.subskillId);
    return [{ skill, subskillId: subskill?.id, title: subskill?.title || skill.measure.how || skill.metric.label,
      second: stalled ? (uk ? 'на плато' : 'on a plateau') : (uk ? 'відстає' : 'is behind') }];
  });
}

export function TodaySidebar({ tasks, tabs, now, lang, summary, suggestion, skills = [], measurements = [], sessions = [], firstRun = false,
  onReveal, onDiscuss, onCloseDay, onAddPractice, onSetupSkill }: TodaySidebarProps) {
  const uk = lang === 'uk';
  const [hintIndex, setHintIndex] = useState(0);
  const today = localTaskDate(now);
  const plan = tasks.filter(task => !task.scheduledPending && (task.plannedDate === today || task.deadlineDate === today
    || !!task.scheduledFor && localTaskDate(task.scheduledFor) === today || task.timerRunning || task.done && !!task.completedAt && localTaskDate(task.completedAt) === today))
    .sort((a, b) => (a.scheduledFor ?? Infinity) - (b.scheduledFor ?? Infinity));
  const hints = growthHints(skills, measurements, sessions, now, lang);
  const hint = hints.length ? hints[hintIndex % hints.length] : undefined;
  const timeOf = (task: PSTask) => task.scheduledFor ? new Date(task.scheduledFor).toLocaleTimeString(uk ? 'uk-UA' : 'en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
  const kindOf = (task: PSTask): SlotKind => task.done ? 'done' : task.timerRunning ? 'now' : task.skillId ? 'practice' : 'plain';
  void tabs; void summary;

  return <>
    {firstRun ? <section className="pulse-suggestion" aria-label={uk ? 'Перша навичка' : 'First skill'}>
      <span className="pulse-eyebrow">{uk ? 'Яку навичку' : 'Which skill'}<strong>{uk ? 'прокачуємо?' : 'shall we grow?'}</strong></span>
      <div className="pulse-suggestion-chips">
        {(uk ? ['Холодні дзвінки', 'Англійська', 'React'] : ['Cold calling', 'English', 'React']).map(example =>
          <button key={example} type="button" className="pulse-paper-button" onClick={() => onSetupSkill?.(example)}>{example}</button>)}
        <button type="button" className="pulse-paper-button pulse-paper-button--ghost" onClick={() => onSetupSkill?.()}>{uk ? '+ Своя' : '+ My own'}</button>
      </div>
    </section> : hint ? <section className="pulse-suggestion" aria-label={uk ? 'Наступна найкраща практика' : 'Best next practice'}>
      <span className="pulse-eyebrow">{hint.skill.title}<strong>{hint.second}</strong></span>
      <p>{hint.title}</p>
      <div className="pulse-suggestion-chips">
        <button type="button" className="pulse-paper-button" onClick={() => onAddPractice?.(hint.skill, hint.subskillId, hint.title)}>{uk ? 'Додати на сьогодні' : 'Add to today'}</button>
        {hints.length > 1 && <button type="button" className="pulse-paper-button pulse-paper-button--ghost" onClick={() => setHintIndex(index => index + 1)}>{uk ? 'Інша' : 'Another'}</button>}
      </div>
    </section> : suggestion ? <section className="pulse-suggestion" aria-label={uk ? 'Наступний крок' : 'Next step'}>
      <span className="pulse-suggestion-mark"><KarkasLogo compact width={15} height={16} />{uk ? 'Наступний крок' : 'Next step'}</span>
      <p className="pulse-suggestion-text">{suggestion}</p>
      <div className="pulse-suggestion-chips">
        <button type="button" className="pulse-paper-button" onClick={() => onDiscuss(suggestion)}>{uk ? 'Обговорити' : 'Discuss'}</button>
      </div>
    </section> : null}

    <section className="pulse-day-plan" aria-labelledby="pulse-day-plan-title">
      <h2 id="pulse-day-plan-title">{uk ? 'План дня' : 'Day plan'}</h2>
      {plan.map(task => {
        const kind = kindOf(task);
        return <button key={task.id} type="button" className="pulse-slot" data-kind={kind} onClick={() => onReveal(task.id)}>
          <span className="pulse-slot-time">{timeOf(task)}</span>
          <span className="pulse-slot-body"><span className="pulse-slot-title">{task.title}</span><span className="pulse-slot-meta">{kind === 'now' ? (uk ? 'зараз' : 'now') : durationLabel(task, lang)}</span></span>
        </button>;
      })}
      <button type="button" className="pulse-slot" data-kind="close" onClick={onCloseDay}>
        <span className="pulse-slot-time">21:00</span>
        <span className="pulse-slot-body"><span className="pulse-slot-title">{uk ? 'Закрити день' : 'Close the day'}</span><ArrowRight size={16} aria-hidden="true" /></span>
      </button>
    </section>
  </>;
}
