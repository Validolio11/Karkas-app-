import { useEffect, useRef, useState } from 'react';
import type { PSTask } from '../types';
import type { WorkInsights } from '../utils/workInsights';

/** Per-account, bounded reminder state; no API requests or task changes. */
export function useWorkReminders(owner: string | null, ready: boolean, insights: WorkInsights, tasks: PSTask[], lang: 'uk' | 'en', onNotice: (text: string) => void) {
  const scope = owner || 'guest';
  const [enabled, setEnabled] = useState(true);
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const ledger = useRef<{ scope: string; last: number; sent: Record<string, number> }>({ scope, last: 0, sent: {} });
  const generation = useRef(0);
  const storageKey = `karkas_work_reminders:${scope}`;
  useEffect(() => {
    generation.current++;
    ledger.current = { scope, last: 0, sent: {} };
    let nextEnabled = true;
    try {
      const raw = localStorage.getItem(storageKey);
      const value = raw ? JSON.parse(raw) : null;
      if (value && typeof value === 'object') {
        nextEnabled = value.enabled !== false;
        const now = Date.now();
        const entries = Object.entries(value.sent || {}).filter(([id, stamp]) => id.length < 512 && typeof stamp === 'number' && Number.isFinite(stamp) && stamp <= now && stamp >= now - 86400000).slice(-300);
        ledger.current.sent = Object.fromEntries(entries) as Record<string, number>;
        ledger.current.last = typeof value.last === 'number' && Number.isFinite(value.last) && value.last <= now ? value.last : 0;
      }
    } catch { /* In-memory deduplication remains available. */ }
    setEnabled(nextEnabled);
    setLoadedScope(scope);
    return () => { generation.current++; };
  }, [scope, storageKey]);

  const persist = (nextEnabled: boolean) => {
    try { localStorage.setItem(storageKey, JSON.stringify({ enabled: nextEnabled, last: ledger.current.last, sent: ledger.current.sent })); }
    catch { onNotice(lang === 'uk' ? 'Налаштування нагадувань діє в цьому сеансі, але його не вдалося зберегти.' : 'The reminder setting applies in this session, but could not be saved.'); }
  };
  useEffect(() => {
    if (!ready || !enabled || loadedScope !== scope || ledger.current.scope !== scope) return;
    const now = Date.now();
    if (now - ledger.current.last < 30 * 60000) return;
    if (tasks.some(task => !task.done && !task.scheduledPending && task.timerRunning)) return;
    // The snapshot can straddle an hour boundary; check the learned hour at dispatch.
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: insights.workingPattern.timeZone, hour: '2-digit', hourCycle: 'h23' }).format(now));
    if (insights.workingPattern.confidence === 'insufficient' ||
      !insights.workingPattern.observedHours.some(item => item.hour === hour)) return;
    const candidate = insights.reminderCandidates.find(item => {
      const sentAt = Object.prototype.hasOwnProperty.call(ledger.current.sent, item.taskId) ? ledger.current.sent[item.taskId] : 0;
      return now - sentAt >= 86400000;
    });
    const task = candidate && tasks.find(item => item.id === candidate.taskId && !item.done && !item.startedAt && !item.scheduledPending);
    if (!task || !candidate || task.scheduledFor !== candidate.scheduledFor ||
      now - candidate.scheduledFor < 5 * 60000 || now - candidate.scheduledFor > 2 * 3600000) return;
    // Mark before dispatch so rerenders/repeated clicks cannot notify twice.
    ledger.current.last = now;
    ledger.current.sent = Object.fromEntries([...Object.entries(ledger.current.sent as Record<string, number>).filter(([, stamp]) => now - stamp < 86400000), [task.id, now]].slice(-300)) as Record<string, number>;
    persist(enabled);
    const body = lang === 'uk' ? `«${task.title}»: запланований початок минув. Зараз немає активного таймера — можна почати або переглянути план.` : `“${task.title}”: its scheduled start has passed. No timer is active — you can start or review the plan.`;
    onNotice(body);
    const currentGeneration = generation.current;
    if (window.karkasDesktop) void window.karkasDesktop.system.showNotification({ title: lang === 'uk' ? 'Karkas · Нагадування про план' : 'Karkas · Plan reminder', body }).then(result => {
      if (!result.ok && generation.current === currentGeneration) onNotice(`${body} ${lang === 'uk' ? 'Сповіщення Windows недоступне.' : 'Windows notification unavailable.'}`);
    }).catch(() => { if (generation.current === currentGeneration) onNotice(body); });
  }, [ready, enabled, loadedScope, scope, insights, tasks, lang]);
  return { enabled, setEnabled: (value: boolean) => { setEnabled(value); persist(value); } };
}
