/**
 * Live "human factor" check of the Karkas AI agent against real Gemini.
 * Run the dev server (npm run dev, GEMINI_API_KEY in .env), then:
 *   npx tsx scripts/agent-scenarios.ts [filter]
 * Every scenario starts from the same realistic evening workspace, sends one or
 * more colloquial phrases, replays the returned actions with the shared engine
 * exactly like the app does, and checks the resulting state.
 */
import { applyAgentAction, type AgentAction, type AgentWorkspace } from '../src/utils/aiAgentActions';
import { createTask } from '../src/utils/taskOperations';
import { configureTaskCountdown, pauseTaskTimer, startTaskTimer, expireTaskCountdown, getTaskTotalSeconds } from '../src/utils/taskTimer';
import type { PSTask } from '../src/types';

const URL = process.env.KARKAS_URL ?? 'http://localhost:3000/api/ai/assist';
const TZ = 'Europe/Kyiv';
const MIN = 60_000;
const dayKey = (at: number, shift = 0) => new Intl.DateTimeFormat('sv-SE', { timeZone: TZ }).format(at + shift * 86_400_000);
const TODAY = dayKey(Date.now());
const NOW = Date.parse(`${TODAY}T18:30:00+03:00`);
const TOMORROW = dayKey(NOW, 1), AFTER = dayKey(NOW, 2);
const at = (hhmm: string, date = TODAY) => Date.parse(`${date}T${hhmm}:00+03:00`);
const wall = (epoch?: number) => epoch === undefined ? undefined : new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(epoch);

function block(id: string, title: string, phase: string, start: string, minutes: number, priority: 1 | 2 | 3 = 2, extra: Partial<PSTask> = {}): PSTask {
  let task = createTask({ title, phase, priority, steps: 0 } as any, id, NOW - 10 * 3_600_000);
  task = pauseTaskTimer(configureTaskCountdown(task, minutes * 60, at(start), () => id + '-s'), at(start));
  const { startedAt: _unused, ...rest } = task as any;
  return { ...rest, scheduledFor: at(start), scheduledPending: false, scheduledDurationSeconds: minutes * 60, plannedDate: TODAY, ...extra };
}
function workspace(): AgentWorkspace {
  const steps = ['Аніматік', 'Ключові кадри', 'Твіни', 'Вторинний рух', 'Звук', 'Рендер'].map((title, i) => ({ id: 'anim-s' + (i + 1), title, done: i < 3 }));
  let blinds = block('blinds', 'Встановити жалюзі', 'work', '14:30', 60);
  blinds = expireTaskCountdown(startTaskTimer(blinds, at('14:30'), () => 'blinds-run'), at('15:31'));
  return {
    tabs: [{ id: 'work', name: 'Робота' }, { id: 'freelance', name: 'Фріланс' }, { id: 'skills', name: 'Навички' }, { id: 'restored', name: 'Відновлені завдання' }],
    tasks: [
      blinds,
      block('plan', 'Спланувати анімацію', 'freelance', '15:30', 30),
      block('anim', 'Робота над анімацією', 'freelance', '16:00', 300, 1, { startedAt: at('16:00'), stepList: steps, steps: 6, currentStep: 3 }),
      block('typing', 'Навчання друку', 'skills', '21:00', 30),
      block('rest', 'Відпочинок', 'work', '21:30', 60, 3),
      { ...createTask({ title: 'Портфоліо на Behance', phase: 'freelance', priority: 2, steps: 0 } as any, 'portfolio', NOW - 86_400_000) },
      { ...createTask({ title: 'Оновити резюме', phase: 'work', priority: 3, steps: 0 } as any, 'cv', NOW - 86_400_000), done: true, completedAt: NOW - 3_600_000 },
    ],
    deletedTasks: [], notes: [],
  };
}

type Reply = { status: number; text: string; actions: { action: AgentAction; createdIds?: string[] }[]; pending: AgentAction[]; clarification?: { question: string; options: { label: string; message: string }[] }; model?: string; view?: unknown };
type Turn = { prompt: string; reply: Reply; ws: AgentWorkspace };
async function send(ws: AgentWorkspace, prompt: string, history: { role: 'user' | 'assistant'; content: string }[]): Promise<Reply> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      action: 'chat', intent: 'auto', prompt, lang: 'uk', turnId: crypto.randomUUID(), clientClock: { now: new Date(NOW).toISOString(), timeZone: TZ },
      currentTasks: ws.tasks, tabs: ws.tabs, deletedTasks: ws.deletedTasks, notes: ws.notes, conversation: history }) });
    const body: any = await res.json().catch(() => ({}));
    if ((res.status === 504 || res.status === 503 || res.status === 429) && attempt < 2) { await new Promise(r => setTimeout(r, 4000)); continue; }
    return { status: res.status, text: body.reply ?? body.error ?? '', actions: body.agent?.actions ?? [], pending: body.agent?.pendingConfirmations ?? [], clarification: body.agent?.clarification, model: body.usedModel, view: body.agent?.view };
  }
  throw new Error('unreachable');
}
function replay(ws: AgentWorkspace, reply: Reply): AgentWorkspace {
  for (const entry of reply.actions) {
    let i = 0;
    const out = applyAgentAction(ws, entry.action, { now: NOW, timeZone: TZ, newId: () => entry.createdIds?.[i++] ?? crypto.randomUUID() });
    if (out.result.ok) ws = out.workspace; else console.log('    ! local replay failed:', entry.action.type, out.result.error);
  }
  return ws;
}

type Check = (turns: Turn[]) => string | null;
const task = (ws: AgentWorkspace, id: string) => ws.tasks.find(t => t.id === id) ?? ws.deletedTasks.find(t => t.id === id);
const byTitle = (ws: AgentWorkspace, re: RegExp) => ws.tasks.filter(t => re.test(t.title));
const last = (turns: Turn[]) => turns[turns.length - 1];
const asked = (turns: Turn[]) => !!last(turns).reply.clarification || /\?\s*$/.test(last(turns).reply.text.trim());
const noChange = (turns: Turn[]) => turns.every(t => !t.reply.actions.some(a => !['open_view', 'reveal_task'].includes(a.action.type)));
const all = (...checks: (string | null)[]) => checks.find(Boolean) ?? null;
const expect = (ok: boolean, message: string) => ok ? null : message;
const todayTimed = (ws: AgentWorkspace) => ws.tasks.filter(t => !t.done && wall(t.scheduledFor)?.startsWith(TODAY));

interface Scenario { name: string; say: string[]; check: Check; followClarification?: boolean }
const S: Scenario[] = [
  // Days and moving
  { name: 'перекинути всі сьогоднішні на завтра', say: ['Всі завдання які на сьогодні перекинь на завтра'], check: ([t]) => all(
    expect(todayTimed(t.ws).length === 0, 'tasks still timed today: ' + todayTimed(t.ws).map(x => x.title).join(', ')),
    expect(['plan', 'anim', 'typing', 'rest'].every(id => task(t.ws, id)?.plannedDate === TOMORROW && wall(task(t.ws, id)?.scheduledFor)?.startsWith(TOMORROW)), 'not all moved to tomorrow with time'),
    expect(wall(task(t.ws, 'typing')?.scheduledFor) === `${TOMORROW} 21:00`, 'typing lost its hour: ' + wall(task(t.ws, 'typing')?.scheduledFor))) },
  { name: 'перенести одне на завтра на 10', say: ['перенеси анімацію на завтра на 10 ранку'], check: ([t]) => expect(wall(task(t.ws, 'anim')?.scheduledFor) === `${TOMORROW} 10:00`, 'anim at ' + wall(task(t.ws, 'anim')?.scheduledFor)) },
  { name: 'післязавтра суржиком', say: ['перенеси друк на послєзавтра'], check: ([t]) => expect(task(t.ws, 'typing')?.plannedDate === AFTER && wall(task(t.ws, 'typing')?.scheduledFor)?.startsWith(AFTER) === true, 'typing ' + task(t.ws, 'typing')?.plannedDate + ' ' + wall(task(t.ws, 'typing')?.scheduledFor)) },
  { name: 'не встигаю — перебудова', say: ['Підкорегуй завдання по годині бо я не встигаю'], check: ([t]) => all(
    expect((task(t.ws, 'plan')?.scheduledFor ?? 0) >= NOW || asked([t]), 'missed block still in the past and no question'),
    expect(t.reply.actions.some(a => a.action.type === 'replan_day') || asked([t]), 'no replan')) },
  { name: 'посунь на годину', say: ['посунь все що залишилось на годину'], check: ([t]) => expect(wall(task(t.ws, 'typing')?.scheduledFor) === `${TODAY} 22:00` || asked([t]), 'typing at ' + wall(task(t.ws, 'typing')?.scheduledFor)) },
  { name: 'прибрати час', say: ['прибери час з відпочинку'], check: ([t]) => expect(task(t.ws, 'rest')?.scheduledFor === undefined, 'rest still timed') },
  { name: 'поставити годину', say: ['постав відпочинок о 22:00'], check: ([t]) => expect(wall(task(t.ws, 'rest')?.scheduledFor) === `${TODAY} 22:00`, 'rest at ' + wall(task(t.ws, 'rest')?.scheduledFor)) },
  { name: 'план на завтра з годинами', say: ['сплануй мені завтра: з 9 до 12 анімація, потім обід годину, потім друк пів години'], check: ([t]) => all(
    expect(wall(task(t.ws, 'anim')?.scheduledFor) === `${TOMORROW} 09:00`, 'anim at ' + wall(task(t.ws, 'anim')?.scheduledFor)),
    expect(byTitle(t.ws, /обід/i).some(x => wall(x.scheduledFor) === `${TOMORROW} 12:00`), 'lunch not at 12:00 tomorrow'),
    expect(wall(task(t.ws, 'typing')?.scheduledFor) === `${TOMORROW} 13:00` || byTitle(t.ws, /друк/i).some(x => wall(x.scheduledFor) === `${TOMORROW} 13:00`), 'typing not at 13:00 tomorrow')) },
  { name: 'пʼятниця з годиною', say: ['в пятницю о 15 дзвінок з клієнтом на пів години'], check: ([t]) => {
    const call = byTitle(t.ws, /дзвін|клієнт/i)[0];
    const day = new Date(`${TODAY}T12:00:00Z`).getUTCDay(); const friday = dayKey(NOW, ((5 - day + 7) % 7) || 7);
    return all(expect(!!call, 'call not created'), expect(wall(call?.scheduledFor) === `${friday} 15:00`, 'call at ' + wall(call?.scheduledFor) + ' expected ' + friday), expect(call?.countdownDurationSeconds === 1800, 'duration ' + call?.countdownDurationSeconds)); } },
  // Timers
  { name: 'запустити таймер', say: ['запусти таймер на анімацію'], check: ([t]) => expect(!!task(t.ws, 'anim')?.timerRunning, 'not running') },
  { name: 'додати пів години', say: ['додай ще пів години до анімації'], check: ([t]) => expect((task(t.ws, 'anim')?.countdownDurationSeconds ?? 0) === 330 * 60 || asked([t]), 'duration ' + task(t.ws, 'anim')?.countdownDurationSeconds) },
  { name: 'ще працюю після нуля', say: ['я ще працюю над жалюзі'], check: ([t]) => all(expect(task(t.ws, 'blinds')?.countdownExpiredAt === undefined, 'expiry not resolved'), expect(getTaskTotalSeconds(task(t.ws, 'blinds')!, NOW) > 3600 + 170 * 60, 'gap not credited: ' + getTaskTotalSeconds(task(t.ws, 'blinds')!, NOW))) },
  { name: 'закінчив о годині', say: ['закінчив жалюзі о 16:00'], check: ([t]) => expect(Math.round(getTaskTotalSeconds(task(t.ws, 'blinds')!, NOW) / 60) === 60 + 30, 'credited ' + Math.round(getTaskTotalSeconds(task(t.ws, 'blinds')!, NOW) / 60)) },
  { name: 'спроба 15 хв', say: ['дай 15 хвилин спробувати портфоліо'], check: ([t]) => expect(!!task(t.ws, 'portfolio')?.limitedStart || !!task(t.ws, 'portfolio')?.timerRunning, 'no attempt started') },
  { name: 'забув таймер', say: ['я забув включити таймер, зарахуй 2 години на портфоліо'], check: ([t]) => expect(Math.round(getTaskTotalSeconds(task(t.ws, 'portfolio')!, NOW) / 60) === 120 || asked([t]), 'recorded ' + getTaskTotalSeconds(task(t.ws, 'portfolio')!, NOW)) },
  // Steps
  { name: 'етап з помилкою', say: ['заверш 4 етап анимации'], check: ([t]) => expect(!!task(t.ws, 'anim')?.stepList?.[3].done, 'step 4 not done') },
  { name: 'додати кроки', say: ['додай кроки до портфоліо: ідея, скетч, рендер'], check: ([t]) => expect((task(t.ws, 'portfolio')?.stepList ?? []).map(s => s.title.toLowerCase()).join(',') === 'ідея,скетч,рендер', 'steps ' + task(t.ws, 'portfolio')?.stepList?.map(s => s.title)) },
  { name: 'перейменувати крок', say: ['перейменуй 5 крок анімації на "Саунд дизайн"'], check: ([t]) => expect(task(t.ws, 'anim')?.stepList?.[4].title === 'Саунд дизайн', 'step 5 ' + task(t.ws, 'anim')?.stepList?.[4].title) },
  // Tasks
  { name: 'створити терміново на завтра', say: ['додай задачу купити продукти завтра терміново'], check: ([t]) => { const x = byTitle(t.ws, /продукт/i)[0]; return all(expect(!!x, 'not created'), expect(x?.priority === 1, 'priority ' + x?.priority), expect(x?.plannedDate === TOMORROW, 'date ' + x?.plannedDate)); } },
  { name: 'три завдання', say: ['створи 3 завдання: подзвонити клієнту, відправити рахунок, оновити портфоліо на дрібблі'], check: ([t]) => expect(t.ws.tasks.length === workspace().tasks.length + 3, 'created ' + (t.ws.tasks.length - workspace().tasks.length)) },
  { name: 'пріоритет', say: ['зроби друк важливим'], check: ([t]) => expect(task(t.ws, 'typing')?.priority === 1, 'priority ' + task(t.ws, 'typing')?.priority) },
  { name: 'вкладка назвою', say: ['перенеси портфоліо у навички'], check: ([t]) => expect(task(t.ws, 'portfolio')?.phase === 'skills', 'phase ' + task(t.ws, 'portfolio')?.phase) },
  { name: 'виконав', say: ['виконав жалюзі'], check: ([t]) => expect(!!task(t.ws, 'blinds')?.done, 'not done') },
  { name: 'повернути в роботу', say: ['поверни резюме в роботу'], check: ([t]) => expect(task(t.ws, 'cv')?.done === false, 'still done') },
  { name: 'видалення з підтвердженням', say: ['видали портфоліо'], check: ([t]) => all(expect(t.reply.pending.some(a => a.type === 'delete_task'), 'no pending confirmation'), expect(!!t.ws.tasks.find(x => x.id === 'portfolio'), 'deleted without confirmation')) },
  { name: 'перейменувати з помилкою', say: ['переймінуй портфоліо на портфоліо для біханс'], check: ([t]) => expect(/біханс/i.test(task(t.ws, 'portfolio')?.title ?? ''), 'title ' + task(t.ws, 'portfolio')?.title) },
  { name: 'закріпити', say: ['закріпи анімацію вгорі'], check: ([t]) => expect(!!task(t.ws, 'anim')?.pinned, 'not pinned') },
  // Tabs, notes, navigation
  { name: 'вкладка', say: ['створи вкладку спорт'], check: ([t]) => expect(t.ws.tabs.some(x => /спорт/i.test(x.name)), 'no tab') },
  { name: 'нотатка', say: ['запиши в нотатки ідею: ролик про каву'], check: ([t]) => expect(t.ws.notes.some(n => /кав/i.test(n.title + n.content)), 'no note') },
  { name: 'дашборд', say: ['покажи дашборд'], check: ([t]) => expect(!!t.reply.view || t.reply.actions.some(a => a.action.type === 'open_view'), 'no view') },
  // Read-only questions
  { name: 'що на завтра', say: ['що в мене на завтра?'], check: turns => expect(noChange(turns) && turns[0].reply.text.length > 5, 'changed something or empty') },
  { name: 'правильний місяць', say: ['яке завтра число?'], check: turns => expect(new RegExp(new Intl.DateTimeFormat('uk-UA', { timeZone: TZ, month: 'long', day: 'numeric' }).format(NOW + 86_400_000).split(' ')[1]).test(turns[0].reply.text), 'wrong month: ' + turns[0].reply.text.slice(0, 100)) },
  { name: 'скільки працював', say: ['скільки я сьогодні вже відпрацював?'], check: turns => expect(noChange(turns) && /\d/.test(turns[0].reply.text), 'no numbers or changed: ' + turns[0].reply.text.slice(0, 120)) },
  // Ambiguity and noise
  { name: 'одне слово', say: ['збільш'], check: turns => expect(noChange(turns) && asked(turns), 'acted on a bare word') },
  { name: 'шум диктування', say: ['Париж зараз 1 година і в Петербурзі час'], check: turns => expect(noChange(turns), 'acted on noise') },
  { name: 'частково неможливе', say: ['заверш 5 етап анімації і нагадай мені о 20 про друк'], check: ([t]) => all(expect(!!task(t.ws, 'anim')?.stepList?.[4].done, 'step 5 not done'), expect(t.reply.text.length > 0, 'empty reply')) },
  { name: 'англійською', say: ['move typing practice to tomorrow'], check: ([t]) => expect(task(t.ws, 'typing')?.plannedDate === TOMORROW && wall(task(t.ws, 'typing')?.scheduledFor)?.startsWith(TOMORROW) === true, 'typing ' + wall(task(t.ws, 'typing')?.scheduledFor)) },
  { name: 'виконані — підтвердження', say: ['всі виконані прибери'], check: ([t]) => expect(t.reply.pending.length > 0 && !!t.ws.tasks.find(x => x.id === 'cv'), 'no confirmation or removed') },
  // Multi-turn follow-ups
  { name: 'уточнення → кнопка', say: ['час збільш'], followClarification: true, check: turns => expect(turns.length === 1 || last(turns).reply.actions.length > 0, 'clarification button did nothing') },
  { name: 'контекст попередньої фрази', say: ['анімацію на завтра', 'і друк теж'], check: turns => expect(task(last(turns).ws, 'typing')?.plannedDate === TOMORROW, 'second turn ignored context') },
];

async function main() {
  const filter = process.argv[2];
  const list = S.filter(s => !filter || s.name.includes(filter));
  const results: { name: string; ok: boolean; why: string | null; model?: string; text: string }[] = [];
  for (const scenario of list) {
    let ws = workspace(); const turns: Turn[] = []; const history: { role: 'user' | 'assistant'; content: string }[] = [];
    const prompts = [...scenario.say];
    try {
      for (let i = 0; i < prompts.length; i++) {
        const reply = await send(ws, prompts[i], history);
        ws = replay(ws, reply);
        turns.push({ prompt: prompts[i], reply, ws });
        history.push({ role: 'user', content: prompts[i] }, { role: 'assistant', content: reply.text });
        if (scenario.followClarification && reply.clarification?.options[0] && i === prompts.length - 1) prompts.push(reply.clarification.options[0].message);
      }
      const why = scenario.check(turns);
      results.push({ name: scenario.name, ok: !why, why, model: last(turns).reply.model, text: last(turns).reply.text.replace(/\s+/g, ' ').slice(0, 140) });
    } catch (error) {
      results.push({ name: scenario.name, ok: false, why: 'error: ' + (error as Error).message, text: '' });
    }
    const r = results[results.length - 1];
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  [${r.model ?? ''}]${r.ok ? '' : '  → ' + r.why}\n      «${scenario.say.join(' / ')}» → ${r.text}`);
    await new Promise(r => setTimeout(r, 4500)); // Flash-Lite free tier: 15 requests per minute
  }
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
}
void main();
