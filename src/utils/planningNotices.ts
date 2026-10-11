type NoticeStorage = Pick<Storage, 'getItem' | 'setItem'>;
interface NoticeLedger { last: number; events: Record<string, number> }
const memory = new Map<string, NoticeLedger>();
const key = (owner: string | null) => `karkas_planning_notices_v1:${owner === null ? 'guest' : `account:${owner}`}`;

/** Explicit schedule notices have priority; optional nudges share a 30-minute cooldown. */
export function claimPlanningNotice(storage: NoticeStorage, owner: string | null, eventId: string, now: number, explicit = false, dailyPrefix?: string): boolean {
  const scope = key(owner);
  let ledger = memory.get(scope) || { last: 0, events: {} };
  try {
    const parsed = JSON.parse(storage.getItem(scope) || 'null');
    if (parsed && typeof parsed.last === 'number' && parsed.events && typeof parsed.events === 'object') ledger = {
      last: Math.max(ledger.last, parsed.last), events: { ...parsed.events, ...ledger.events },
    };
  } catch { /* Keep an in-memory ledger if persistence is unavailable. */ }
  const entries = Object.entries(ledger.events).filter(([, at]) => typeof at === 'number' && Number.isFinite(at) && at <= now && now - at < 2 * 86400000);
  const events = Object.fromEntries(entries);
  if (dailyPrefix && entries.filter(([id]) => id.startsWith(dailyPrefix)).length >= 2) return false;
  if (events[eventId] !== undefined || !explicit && ledger.last > 0 && ledger.last <= now && now - ledger.last < 30 * 60000) return false;
  const next = { last: now, events: Object.fromEntries([...entries, [eventId, now]].slice(-600)) };
  memory.set(scope, next);
  try { storage.setItem(scope, JSON.stringify(next)); } catch { /* Session deduplication remains active. */ }
  return true;
}
