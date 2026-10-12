/**
 * Real-provider latency benchmark for Karkas AI.
 *
 * PowerShell:  $env:GEMINI_API_KEY="your-key"; npx tsx scripts/ai-benchmark.ts
 * Optional:    $env:KARKAS_BENCH_MODEL="gemini-3.8-flash"  (default: app fallback order)
 *
 * Each scenario runs in two modes: "tuned" (Karkas thinking settings) and "default"
 * (provider default thinking). Each mode sends the same request twice back-to-back,
 * so the second run shows implicit-cache hits (cachedTok) once the static prompt
 * prefix reaches the model minimum (about 4096 tokens on 3.x, 2048 on 2.5).
 * Prose scenarios (help, free chat, analysis) and task commands also run in
 * "stream" mode (tuned thinking, streamed reply) and report time to first token:
 * ttftMs is measured at the caller, serverTtftMs is the server's own metric.
 * Task commands use Gemini function calling; toolCalls is the number of proposed
 * operations (set KARKAS_AI_TOOLS=off to measure the forced-JSON path instead).
 * About 34 requests in total — mind free-tier quotas.
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
  { name: 'Довідка', streams: true, body: { prompt: 'Як працює таймер у застосунку?', action: 'chat' } },
  { name: 'Вільна розмова', streams: true, body: { prompt: 'Як мені краще зосередитись після обіду?', action: 'chat' } },
  { name: 'Таймер', streams: true, body: { prompt: 'Додай таймер на 25 хвилин до завдання Референси', action: 'chat' } },
  { name: 'Нове завдання', streams: true, body: { prompt: 'Створи завдання Купити продукти на завтра', action: 'chat' } },
  { name: 'Аналіз', streams: true, body: { prompt: 'Проаналізуй мої завдання', action: 'chat', intent: 'analysis' } },
  { name: 'Генерація плану', body: { prompt: 'Сплануй підготовку презентації', action: 'generate' } },
];

const rows: Record<string, string | number>[] = [];
for (const scenario of scenarios) {
  const modes = scenario.streams ? ['tuned', 'default', 'stream'] as const : ['tuned', 'default'] as const;
  for (const mode of modes) {
    if (mode === 'default') process.env.KARKAS_AI_THINKING = 'default';
    else delete process.env.KARKAS_AI_THINKING;
    for (const run of [1, 2]) {
      const started = performance.now();
      let ttftMs: number | undefined;
      const result = mode === 'stream'
        ? await invokeDesktopApi('assist', { ...base, ...scenario.body, stream: true }, {
          onStreamDelta: () => { ttftMs ??= Math.round(performance.now() - started); },
        })
        : await invokeDesktopApi('assist', { ...base, ...scenario.body });
      const m = result.body?.aiMetrics || {};
      rows.push({ scenario: scenario.name, mode, run, status: result.status, model: m.model ?? result.body?.code ?? '-',
        ms: Math.round(performance.now() - started), ttftMs: ttftMs ?? '-', serverTtftMs: m.timeToFirstTokenMs ?? '-', thinking: m.thinking ?? '-',
        promptTok: m.promptTokens ?? '-', cachedTok: m.cachedTokens ?? 0, thoughtTok: m.thoughtsTokens ?? 0, outputTok: m.outputTokens ?? '-',
        toolCalls: m.toolCalls ?? '-', operations: ['tasks', 'tabs', 'taskUpdates', 'taskDeletions'].reduce((sum, key) => sum + (Array.isArray(result.body?.[key]) ? result.body[key].length : 0), 0) });
    }
  }
}
console.table(rows);
for (const name of scenarios.map(s => s.name)) {
  // Compare first (uncached) runs; the second runs show the cache effect.
  const [tuned, def] = ['tuned', 'default'].map(mode => rows.find(r => r.scenario === name && r.mode === mode && r.run === 1)!);
  if (tuned.status === 200 && def.status === 200) console.log(`${name}: ${def.ms} ms -> ${tuned.ms} ms (${Math.round((1 - Number(tuned.ms) / Number(def.ms)) * 100)}% faster)`);
  const streamed = rows.find(r => r.scenario === name && r.mode === 'stream' && r.run === 1);
  if (streamed?.status === 200 && tuned.status === 200 && typeof streamed.ttftMs === 'number') {
    console.log(`${name}: first visible text after ${streamed.ttftMs} ms when streamed (full reply ${streamed.ms} ms; unstreamed ${tuned.ms} ms)`);
  }
}
process.exit(0);
