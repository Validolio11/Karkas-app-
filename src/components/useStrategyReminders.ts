import { useEffect, useState } from 'react';
import type { PersonalStrategyProfile, PSTask } from '../types';
import { claimPlanningNotice } from '../utils/planningNotices';

export function useStrategyReminders(owner: string | null, ready: boolean, profile: PersonalStrategyProfile, tasks: PSTask[], lang: 'uk' | 'en', onNotice: (text: string) => void) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const interval = setInterval(() => setNow(Date.now()), 20000); return () => clearInterval(interval); }, []);
  useEffect(() => {
    if (!ready || !profile.reminders.enabled || !profile.reminders.times.length || tasks.some(task => task.timerRunning && !task.done)) return;
    const goal = profile.goals.find(item => item.agreed);
    if (!goal) return;
    const belongs = (item: PSTask) => goal.taskIds.includes(item.id) || !!item.schedulePlanId && goal.taskIds.includes(item.schedulePlanId);
    const task = tasks.find(item => item.id === profile.latestStrategy?.focusTaskId && !item.done && !item.scheduledPending && belongs(item))
      || tasks.find(item => !item.done && !item.scheduledPending && belongs(item));
    if (!task) return;
    // A due explicit schedule takes precedence over an additional personal nudge.
    if (tasks.some(item => !item.done && !item.startedAt && item.scheduledFor && now >= item.scheduledFor - 5 * 60000 && now - item.scheduledFor < 15 * 60000)) return;
    const date = new Date(now);
    const day = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    const minutes = date.getHours() * 60 + date.getMinutes();
    const slot = [...new Set(profile.reminders.times)].slice(0, 2).find(time => {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return false;
      const [hour, minute] = time.split(':').map(Number);
      return minutes >= hour * 60 + minute && minutes < hour * 60 + minute + 10;
    });
    if (!slot || !claimPlanningNotice(localStorage, owner, `coach:${day}:${slot}`, now, false, `coach:${day}:`)) return;
    const body = lang === 'uk'
      ? `Ви обрали час для «${goal.title}». Наступний крок: ${task.title}. Якщо зараз складно почати, обговорімо, що заважає.`
      : `You chose time for “${goal.title}”. Next step: ${task.title}. If starting feels difficult, let us discuss what is getting in the way.`;
    onNotice(body);
    if (window.karkasDesktop) void window.karkasDesktop.system.showNotification({ title: lang === 'uk' ? 'Karkas · Моя стратегія' : 'Karkas · My strategy', body,
      target: { view: 'STRATEGY', ownerId: owner, taskId: task.id } }).catch(() => undefined);
  }, [now, owner, ready, profile, tasks, lang, onNotice]);
}
