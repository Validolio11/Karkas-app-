/**
 * Real-provider latency benchmark for Karkas AI.
 *
 * PowerShell:  $env:GEMINI_API_KEY="your-key"; npx tsx scripts/ai-benchmark.ts
 * Optional:    $env:KARKAS_BENCH_MODEL="gemini-3.8-flash"  (default: app fallback order)
 *
 * Each scenario runs twice: "tuned" (Karkas thinking settings) and "default"
 * (provider default thinking). About 10 requests in total — mind free-tier quotas.
 * The key is read from the environment only and is never printed or saved.
 */
process.env.KARKAS_SERVER_AUTOSTART = 'false';
if (!process.env.GEMINI_API_KEY) {
  console.error('Set GEMINI_API_KEY first, e.g. PowerShell: $env:GEMINI_API_KEY="..."');
  process.exit(1);
}
const { invokeDesktopApi } = await import('../server.ts');

const now = Date.now();
const day = 86_400_000;
const tasks = [
  { id: 't1', title: 'Референси', phase: 'focus', priority: 1, done: false, steps: 2, currentStep: 0, createdAt: now - 2 * day,
    stepList: [{ id: 's1', title: 'Зібрати 10 прикладів', done: false }, { id: 's2', title: 'Вибрати 3 найкращі', done: false }] },
  { id: 't2', title: 'Підготувати презентацію', phase: 'work', priority: 2, done: false, steps: 0, currentStep: 0, createdAt: now - day },
  { id: 't3', title: 'Оплатити рахунки', phase: 'home', priority: 2, done: false, steps: 0, currentStep: 0, createdAt: now - 3 * day },
  { id: 't4', title: 'Прочитати розділ книги', phase: 'study', priority: 3, done: true, steps: 0, currentStep: 0, createdAt: now - 5 * day, completedAt: now - 4 * day, timeSpentSeconds: 1800 },
];
const tabs = [{ id: 'focus', name: 'Фокус' }, { id: 'work', name: 'Робота' }, { id: 'home', name: 'Дім' }, { id: 'study', name: 'Навчання' }];
const base = {
  lang: 'uk', selectedModel: process.env.KARKAS_BENCH_MODEL || undefined,
  clientClock: { now: new Date().toISOString(), timeZone: 'Europe/Kyiv' },
  fullAppContext: { activeTasks: tasks.filter(t => !t.done), completedTasks: tasks.filter(t => t.done), deletedTasks: [], tabs },
};
const scenarios = [
  { name: 'Довідка', body: { prompt: 'Як працює таймер у застосунку?', action: 'chat' } },
  { name: 'Таймер', body: { prompt: 'Додай таймер на 25 хвилин до завдання Референси', action: 'chat' } },
  { name: 'Нове завдання', body: { prompt: 'Створи завдання Купити продукти на завтра', action: 'chat' } },
  { name: 'Аналіз', body: { prompt: 'Проаналізуй мої завдання', action: 'chat', intent: 'analysis' } },
  { name: 'Генерація плану', body: { prompt: 'Сплануй підготовку презентації', action: 'generate' } },
];

const rows: Record<string, string | number>[] = [];
for (const scenario of scenarios) {
  for (const mode of ['tuned', 'default'] as const) {
    if (mode === 'default') process.env.KARKAS_AI_THINKING = 'default';
    else delete process.env.KARKAS_AI_THINKING;
    const started = performance.now();
    const result = await invokeDesktopApi('assist', { ...base, ...scenario.body });
    const m = result.body?.aiMetrics || {};
    rows.push({ scenario: scenario.name, mode, status: result.status, model: m.model ?? result.body?.code ?? '-',
      ms: Math.round(performance.now() - started), thinking: m.thinking ?? '-',
      promptTok: m.promptTokens ?? '-', thoughtTok: m.thoughtsTokens ?? 0, outputTok: m.outputTokens ?? '-' });
  }
}
console.table(rows);
for (const name of scenarios.map(s => s.name)) {
  const [tuned, def] = ['tuned', 'default'].map(mode => rows.find(r => r.scenario === name && r.mode === mode)!);
  if (tuned.status === 200 && def.status === 200) console.log(`${name}: ${def.ms} ms -> ${tuned.ms} ms (${Math.round((1 - Number(tuned.ms) / Number(def.ms)) * 100)}% faster)`);
}
process.exit(0);
