import express from "express";
import { taskMutationProperties, taskTimerProperties, taskActionInstructions, validateTaskMutations, validatedTimerFields, normalizeAIOptionalFields, taskScheduleProperties, validatedScheduleFields, schedulingClockContext } from "./server/aiActions";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI, Modality, Type } from "@google/genai";
import { verifyGeminiKey } from "./server/geminiKeyVerification";
import { AIRequestError, aiRequestFailure, classifyAIRequestError, generateGeminiWithFallback } from "./server/geminiGeneration";
import { isCompletedArchivedTask, isCancelledArchivedTask, selectRelevantArchivedTasks } from "./src/utils/taskArchive";
import { selectPeriodTasks } from "./src/components/workflowViewModel";
import { recordedTaskSeconds, summarizeTaskTime } from "./src/utils/taskTimeStats";

dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// The packaged app accepts API writes only from its own local window.
app.use('/api', (req, res, next) => {
  if (process.versions.electron && !['GET', 'HEAD'].includes(req.method)) {
    const origin = req.headers.origin;
    const port = req.socket.localPort;
    if (origin !== `http://localhost:${port}` && origin !== `http://127.0.0.1:${port}`) {
      return res.status(403).json({ code: 'ACCESS_DENIED', error: 'Request origin is not allowed' });
    }
  }
  next();
});
app.use(express.json({ limit: "25mb" }));

const isRecord = (value: unknown): value is Record<string, any> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const nonEmptyText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
const textOr = (value: unknown, fallback = ''): string => nonEmptyText(value) ? value.trim() : fallback;
const priorityOr = (value: unknown, fallback = 2): number =>
  value === 1 || value === 2 || value === 3 ? value : fallback;

// Shared by HTTP handlers and the desktop IPC bridge, which bypasses middleware.
function requestValidationError(body: unknown): string | undefined {
  if (!isRecord(body)) return 'JSON object is required';
  try { if (body.clientClock !== undefined) schedulingClockContext(body.clientClock); } catch { return 'Invalid clientClock'; }
  const contexts = [body];
  if (body.fullAppContext !== undefined) {
    if (!isRecord(body.fullAppContext)) return 'Invalid fullAppContext';
    contexts.push(body.fullAppContext);
  }
  for (const context of contexts) {
    for (const key of ['tasks', 'currentTasks', 'allTasks', 'activeTasks', 'completedTasks', 'deletedTasks', 'scheduledPlans']) {
      if (context[key] !== undefined && (!Array.isArray(context[key]) ||
        !context[key].every((task: unknown) => isRecord(task) && nonEmptyText(task.title)))) {
        return `Invalid ${key}: expected tasks with non-empty titles`;
      }
    }
    if (context.tabs !== undefined && (!Array.isArray(context.tabs) ||
      !context.tabs.every((tab: unknown) => nonEmptyText(tab) || (isRecord(tab) && nonEmptyText(tab.id))))) return 'Invalid tabs';
    if (context.stats !== undefined && !isRecord(context.stats)) return 'Invalid stats';
  }
  if (body.periodMetrics !== undefined) {
    if (!isRecord(body.periodMetrics)) return 'Invalid periodMetrics';
    for (const key of ['totalCreated', 'totalCompleted', 'totalDeleted', 'totalActive', 'successRate']) {
      const value = body.periodMetrics[key];
      if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 ||
        (key === 'successRate' ? value > 100 : !Number.isInteger(value)))) return `Invalid periodMetrics.${key}`;
    }
  }
}

function cleanAndParseJson(rawText: string): Record<string, any> {
  const cleaned = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  const parsed = JSON.parse(cleaned);
  if (!isRecord(parsed)) throw new Error('Expected an AI response object');
  return parsed;
}

/** Validate every proposed action before accepting a provider response. */
function validateAssistProposal(rawText: string, action: string, tasks: any[]) {
  const parsed = normalizeAIOptionalFields(cleanAndParseJson(rawText));
  if (!nonEmptyText(action === 'chat' ? parsed.reply : parsed.summary)) throw new Error('Missing AI response text');
  for (const key of ['tasks', 'tabs', 'taskUpdates', 'taskDeletions', 'categoryHealth']) {
    if (parsed[key] !== undefined && !Array.isArray(parsed[key])) throw new Error(`Invalid ${key}`);
  }
  for (const task of parsed.tasks || []) {
    if (!isRecord(task) || !nonEmptyText(task.title)) throw new Error('Invalid new task title');
    validatedTimerFields(task);
    validatedScheduleFields(task);
  }
  Object.assign(parsed, validateTaskMutations(parsed, tasks));
  for (const category of parsed.categoryHealth || []) {
    if (!isRecord(category) || ['phase', 'phaseName', 'status', 'recommendation'].some(key => category[key] !== undefined && typeof category[key] !== 'string') ||
      category.taskCount !== undefined && typeof category.taskCount !== 'number') throw new Error('Invalid category analysis');
  }
  if (parsed.workloadDiagnosis !== undefined) {
    const diagnosis = parsed.workloadDiagnosis;
    if (!isRecord(diagnosis) || diagnosis.status !== undefined && typeof diagnosis.status !== 'string' ||
      ['bottlenecks', 'strengths'].some(key => diagnosis[key] !== undefined && (!Array.isArray(diagnosis[key]) || diagnosis[key].some((item: unknown) => typeof item !== 'string')))) throw new Error('Invalid workload diagnosis');
  }
  return parsed;
}

function normalizedSteps(value: unknown, count: unknown, isUk: boolean, prefix: string, min = 1, max = 50) {
  const entries = Array.isArray(value) ? value.filter((step) => nonEmptyText(step) ||
    (isRecord(step) && nonEmptyText(step.title))).slice(0, max) : [];
  const stepCount = entries.length || (typeof count === 'number' && Number.isFinite(count)
    ? Math.min(max, Math.max(min, Math.trunc(count))) : 3);
  return Array.from({ length: Math.max(min, stepCount) }, (_, index) => ({
    id: `${prefix}-${index}-${Date.now().toString(36)}`,
    title: textOr(typeof entries[index] === 'string' ? entries[index] : entries[index]?.title,
      `${isUk ? 'Етап' : 'Step'} ${index + 1}`),
    done: false,
  }));
}

function workspaceProductivityContext(activeTasks: any[], completedTasks: any[], archivedTasks: any[], currentRecords = [...activeTasks, ...completedTasks]) {
  const relevantArchive = selectRelevantArchivedTasks(currentRecords, archivedTasks);
  const completedHistory = relevantArchive.filter(isCompletedArchivedTask);
  const cancelledTasks = relevantArchive.filter(isCancelledArchivedTask);
  const completed = [...completedTasks, ...completedHistory];
  const timeStatistics = summarizeTaskTime(completed);
  const tracked = [...activeTasks, ...completedTasks, ...relevantArchive];
  const phaseCounts: Record<string, number> = {};
  const completedByPhase = new Map<string, number>();
  const activeByPhase = new Map<string, number>();
  for (const task of tracked) phaseCounts[task.phase] = (phaseCounts[task.phase] || 0) + 1;
  for (const task of completed) completedByPhase.set(task.phase, (completedByPhase.get(task.phase) || 0) + 1);
  for (const task of activeTasks) activeByPhase.set(task.phase, (activeByPhase.get(task.phase) || 0) + 1);
  const tasksWithSteps = tracked.filter(task => Number.isInteger(task.steps) && task.steps > 0);
  const urgentLoad = activeTasks.filter(task => task.priority === 1).length;
  const completionRate = tracked.length ? Math.round(completed.length / tracked.length * 100) : 0;
  return {
    completedHistory, cancelledTasks, timeStatistics,
    stats: { total: tracked.length, completed: completed.length, active: activeTasks.length, cancelled: cancelledTasks.length, percent: completionRate, phaseCounts },
    adaptiveProfile: {
      trackedTasks: tracked.length, completedTasks: completed.length, completionRate,
      averageCompletionMinutes: timeStatistics.averageSeconds === null ? 0 : Math.round(timeStatistics.averageSeconds / 60),
      averageStepCount: tasksWithSteps.length ? Math.round(tasksWithSteps.reduce((sum, task) => sum + task.steps, 0) / tasksWithSteps.length * 10) / 10 : 0,
      preferredPhases: [...completedByPhase].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([phase]) => phase),
      overloadedPhases: [...activeByPhase].filter(([, count]) => count >= 4).sort((a, b) => b[1] - a[1]).map(([phase]) => phase),
      activeLoad: activeTasks.length, urgentLoad,
      recommendedActiveLimit: urgentLoad >= 3 || activeTasks.length >= 8 ? 3 : 5,
    },
  };
}

const isLiveProductivityTask = (task: any) => task.deletedAt === undefined && task.deletionReason !== 'accidental' && !task.scheduledPending;

// Initialize Gemini Client
let geminiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  if (!geminiClient && process.env.GEMINI_API_KEY) {
    geminiClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return geminiClient;
}

// Shared bounded generation path for HTTP and the native desktop bridge.
async function generateGeminiContentWithFallback(params: {
  contents: string;
  config: any;
  customAi?: GoogleGenAI | null;
  selectedModel?: string;
  validateResponse?: (text: string) => unknown;
}): Promise<any> {
  const ai = params.customAi || getGeminiClient();
  if (!ai) throw new AIRequestError('MISSING_API_KEY');
  return generateGeminiWithFallback({ ai, ...params });
}

function sendAIRequestFailure(res: any, error: unknown, isUk: boolean) {
  const failure = aiRequestFailure(error instanceof AIRequestError ? error : new AIRequestError('INVALID_AI_RESPONSE'), isUk);
  return res.status(failure.status).json(failure.body);
}

// Endpoint to validate custom Gemini API key and automatically fetch available models
export async function verifyKeyHandler(req: any, res: any) {
  const result = await verifyGeminiKey(req.body?.apiKey);
  return res.status(result.status).json(result.body);
}
app.post("/api/ai/verify-key", verifyKeyHandler);

// App update checking endpoint with memory cache (2 min TTL) to avoid GitHub rate limits
let cachedReleaseData: { data: any; timestamp: number } | null = null;
export async function checkUpdateHandler(_req: any, res: any) {
  try {
    if (cachedReleaseData && Date.now() - cachedReleaseData.timestamp < 120000) {
      return res.json(cachedReleaseData.data);
    }

    const ghRes = await fetch("https://api.github.com/repos/Validolio11/Karkas-app-/releases/latest", {
      headers: {
        "User-Agent": "Karkas-Updater/1.1",
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (!ghRes.ok) {
      if (ghRes.status === 404) {
        return res.status(404).json({ error: "No releases found on GitHub" });
      }
      return res.status(ghRes.status).json({ error: `GitHub API error: ${ghRes.statusText}` });
    }

    const releaseData = await ghRes.json();
    cachedReleaseData = { data: releaseData, timestamp: Date.now() };
    res.json(releaseData);
  } catch (err: any) {
    console.error("Error checking GitHub release:", err);
    res.status(500).json({ error: err.message || "Failed to check update" });
  }
}
app.get("/api/check-update", checkUpdateHandler);

const UK_EN_TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ye', ж: 'zh', з: 'z', и: 'y', і: 'i',
  ї: 'yi', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u',
  ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ь: '', ю: 'yu', я: 'ya',
  'робота': 'work', 'дім': 'home', 'спорт': 'health', 'здоровʼя': 'health', 'здоров\'я': 'health',
  'покупки': 'buy', 'навчання': 'study', 'проєкт': 'project', 'проект': 'project',
  'маркетинг': 'marketing', 'дизайн': 'design', 'фінанси': 'finance', 'фокус': 'focus'
};

export function slugifyTabId(rawName: string, requestedId?: string): string {
  if (requestedId && /^[a-z0-9_-]{2,32}$/i.test(requestedId)) {
    return requestedId.toLowerCase();
  }
  const clean = (rawName || '').trim().toLowerCase();
  if (UK_EN_TRANSLIT[clean]) return UK_EN_TRANSLIT[clean];
  
  let transliterated = '';
  for (const char of clean) {
    transliterated += UK_EN_TRANSLIT[char] ?? char;
  }
  const slug = transliterated
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);
  return slug || `tab_${Date.now().toString(36)}`;
}

// Smart AI Assistant & Full App Context Analyzer Endpoint
export async function assistHandler(req: any, res: any) {
  try {
    const validationError = requestValidationError(req.body);
    if (validationError) return res.status(400).json({ error: validationError });
    const {
      prompt,
      currentTasks = [],
      activeTasks = [],
      completedTasks = [],
      deletedTasks = [],
      tabs = [],
      action = "generate",
      lang = "uk",
      customApiKey,
      selectedModel,
      conversation = [],
      pendingChanges,
      fullAppContext,
      allowNewTabs = false,
    } = req.body;

    if (!nonEmptyText(prompt)) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    const clientClock = schedulingClockContext(req.body.clientClock);
    const isUk = lang === "uk" || /[а-яіїєґ]/i.test(prompt);
    const normalizedPrompt = prompt.trim().toLowerCase().replace(/[!?.,]/g, "");
    const isSimpleGreeting = /^(привіт|вітаю|добрий день|доброго ранку|добрий вечір|hello|hi|hey)$/.test(normalizedPrompt);

    if (action === "chat" && isSimpleGreeting) {
      return res.json({
        reply: isUk
          ? "Привіт. Я поруч і бачу весь контекст твоїх задач. Розкажи, що зараз плануєш зробити, яку задачу хочеш розбити чи змінити, або що викликає затримку."
          : "Hi. I am here with full visibility into your tasks. Tell me what you want to plan, break down, edit, or what is slowing you down.",
        source: "greeting",
      });
    }
    
    // Dynamic AI Client setup
    let ai = getGeminiClient();
    if (customApiKey && typeof customApiKey === "string") {
      ai = new GoogleGenAI({
        apiKey: customApiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });
    }

    // The client sends the complete state as fullAppContext. Accept both formats.
    const suppliedContext = fullAppContext && typeof fullAppContext === 'object' ? fullAppContext : {};
    const contextActiveTasks = Array.isArray(suppliedContext.activeTasks) ? suppliedContext.activeTasks : [];
    const contextCompletedTasks = Array.isArray(suppliedContext.completedTasks) ? suppliedContext.completedTasks : [];
    const contextDeletedTasks = Array.isArray(suppliedContext.deletedTasks) ? suppliedContext.deletedTasks : [];
    const contextTabs = Array.isArray(suppliedContext.tabs) ? suppliedContext.tabs : [];
    const currentActiveRecords = activeTasks.length > 0
      ? activeTasks
      : contextActiveTasks.length > 0
        ? contextActiveTasks
        : currentTasks.filter((t: any) => !t.done);
    const currentCompletedRecords = completedTasks.length > 0
      ? completedTasks
      : contextCompletedTasks.length > 0
        ? contextCompletedTasks
        : currentTasks.filter((t: any) => t.done);
    const effectiveActiveTasks = currentActiveRecords.filter((task: any) => !task.done && isLiveProductivityTask(task));
    const effectiveCompletedTasks = currentCompletedRecords.filter((task: any) => task.done && isLiveProductivityTask(task));
    const scheduledPlans = (Array.isArray(suppliedContext.scheduledPlans) ? suppliedContext.scheduledPlans : currentActiveRecords.filter((task: any) => task.scheduledPending)).filter((task: any) => task.scheduledPending && !task.done);
    const mutationTargets = [...effectiveActiveTasks, ...effectiveCompletedTasks, ...scheduledPlans];
    const effectiveDeletedTasks = deletedTasks.length > 0 ? deletedTasks : contextDeletedTasks;
    const productivity = workspaceProductivityContext(effectiveActiveTasks, effectiveCompletedTasks, effectiveDeletedTasks, [...currentActiveRecords, ...currentCompletedRecords]);
    const effectiveStats = productivity.stats;
    const effectiveAdaptiveProfile = productivity.adaptiveProfile;

    // Preserve tab names and colors for analysis
    const tabList = contextTabs.length > 0 ? contextTabs : (Array.isArray(tabs) ? tabs : []);
    const activeTabIds: string[] = tabList.map((t: any) => (typeof t === "string" ? t : t.id));
    const primaryTab = activeTabIds[0] || "focus";

    const isTabCreationRequested = allowNewTabs || /(?:вкладк|категорі|розділ|напрямок|проєкт|проект|секці|tab|category|section|project)/iu.test(prompt);
    const isScheduleRequest = /(?:tomorrow|today|daily|every day|every evening|schedule|\d{1,2}:\d{2}|\d{4}-\d{2}-\d{2}|завтра|щодн|кожн|сьогодні|на\s+\d{1,2}\s*(?:год|веч))/iu.test(prompt);
    const isTimerRequest = /(?:таймер|секундомір|відлік|timer|stopwatch|countdown)/iu.test(prompt);

    if (ai && action === "chat") {
      try {
        const chatPrompt = `You are Karkas AI, an elite conversational task architect and productivity strategist embedded directly in the user's workspace.
LANGUAGE: ${isUk ? "Ukrainian" : "English"}.
CURRENT CLIENT CLOCK (authoritative for relative dates): ${JSON.stringify(clientClock)}.
CURRENT USER PROMPT: "${prompt}".
RECENT CONVERSATION:
${JSON.stringify(Array.isArray(conversation) ? conversation.slice(-10) : [], null, 2)}
PENDING UNAPPLIED PROPOSAL:
${JSON.stringify(pendingChanges || {})}
If the user revises this proposal, return the entire revised proposal. If they cancel it, return empty action arrays. Never assume it has been applied; actual application happens via the UI button.
WORKSPACE CONTEXT:
${JSON.stringify({
          scheduledPlans,
          activeTasks: effectiveActiveTasks.map((t: any) => ({
            id: t.id,
            title: t.title,
            phase: t.phase,
            priority: t.priority,
            progress: `${t.currentStep || 0}/${t.steps || 1}`,
            stepList: t.stepList || [],
            note: t.note || '',
            schedule: t.schedule,
            scheduledPending: t.scheduledPending,
            timerRunning: !!t.timerRunning,
            timerMode: t.timerMode ?? (t.countdownDurationSeconds > 0 ? 'countdown' : 'stopwatch'),
            countdownDurationSeconds: t.countdownDurationSeconds ?? null,
            countdownRemainingSeconds: t.countdownRemainingSeconds ?? null,
            timeSpentSeconds: t.timeSpentSeconds || 0,
            done: !!t.done,
          })),
          completedTasksCount: effectiveStats.completed,
          completedTasks: effectiveCompletedTasks,
          completedHistory: productivity.completedHistory,
          cancelledTasks: productivity.cancelledTasks,
          timeStatistics: productivity.timeStatistics,
          availableTabs: tabList,
          stats: effectiveStats,
          adaptiveProfile: effectiveAdaptiveProfile,
        }, null, 2)}

INSTRUCTIONS:
For time analysis, timeStatistics counts only completed tasks with positive recorded work. Report measurement coverage. Missing readings are unknown, never zero. Recorded time excludes pauses and may omit untracked work; do not infer time from createdAt/completedAt. Countdown duration is the current timer budget, may include extensions, and is not necessarily the original estimate. Recommend time blocks and buffers with uncertainty; an analysis request alone does not authorize task changes.
1. Provide a natural, concise, empowering conversational "reply".
   Make the reply easy to scan: use short paragraphs separated by blank lines, **bold** only for key facts, and numbered or bulleted lists for actual steps. Use a brief heading only for a longer answer. A small, relevant emoji is welcome when helpful, but avoid decoration in every paragraph. Format only the reply string this way; keep task titles and structured fields plain, and return valid JSON with escaped newlines.
2. If the user asks to create, plan, add, break down, edit, update, rename, delete tasks or tabs, or configure/start/pause/stop timers, YOU MUST ALSO POPULATE the structured JSON fields ("tasks", "tabs", "taskUpdates", "taskDeletions").
3. "tasks": New tasks to create. Each task must have:
   - "title": Actionable concise title
   - "phase": One of available tab IDs: ${JSON.stringify(activeTabIds)} or a newly defined tab ID
   - "priority": 1, 2, or 3
   - "steps": 0 to 5 (use 0 when no subtasks were requested or needed)
   - "stepList": Array of sequential sub-steps with "title"
   - "note": Short tactical note
4. "tabs": Create only when explicitly requested. Each with "id" (lowercase ASCII slug) and "name".
5. "taskUpdates": Edits to existing tasks matching their "id" (e.g. updating title, priority, phase, note, done, stepList, timerMode, countdownDurationSeconds, or timerAction).
6. "taskDeletions": Tasks to delete/archive by their "id".
7. Return strictly valid JSON adhering to schema.`;

        const chatResponse = await generateGeminiContentWithFallback({
          contents: chatPrompt,
          config: {
            systemInstruction: taskActionInstructions,
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                reply: { type: Type.STRING },
                insights: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                tasks: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      title: { type: Type.STRING },
                      phase: { type: Type.STRING },
                      priority: { type: Type.INTEGER },
                      steps: { type: Type.INTEGER },
                      note: { type: Type.STRING },
                      ...taskTimerProperties,
                      ...taskScheduleProperties,
                      stepList: {
                        type: Type.ARRAY,
                        items: {
                          type: Type.OBJECT,
                          properties: {
                            title: { type: Type.STRING },
                          },
                          required: ["title"],
                        },
                      },
                    },
                    required: ["title", "phase", "priority", "steps"],
                  },
                },
                tabs: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING },
                      name: { type: Type.STRING },
                    },
                    required: ["id", "name"],
                  },
                },
                ...taskMutationProperties,
              },
              required: ["reply"],
            },
          },
          customAi: ai,
          selectedModel,
          validateResponse: text => validateAssistProposal(text, action, mutationTargets),
        });

        if (chatResponse?.text) {
          const parsed = chatResponse.validatedResponse;
          const existingTabIds = new Set(activeTabIds);
          const validatedTabs: { id: string; name: string }[] = [];
          if (isTabCreationRequested && Array.isArray(parsed.tabs)) {
            for (const rawTab of parsed.tabs.slice(0, 3)) {
              const name = typeof rawTab?.name === 'string' ? rawTab.name.trim().slice(0, 32) : '';
              if (!name) continue;
              const baseId = slugifyTabId(name, rawTab.id);
              let id = baseId;
              let suffix = 2;
              while (existingTabIds.has(id) || validatedTabs.some((tb) => tb.id === id)) {
                id = `${baseId.slice(0, 24)}_${suffix++}`;
              }
              existingTabIds.add(id);
              validatedTabs.push({ id, name });
            }
          }

          const allowedTaskPhases = new Set([...activeTabIds, ...validatedTabs.map((tb) => tb.id)]);
          const validatedTasks = (Array.isArray(parsed.tasks) ? parsed.tasks : [])
            .filter((t: unknown) => isRecord(t) && nonEmptyText(t.title)).slice(0, 50).map((t: any, idx: number) => {
            const finalStepList = normalizedSteps(t.stepList, t.steps, isUk, `s-chat-gen-${idx}`, 0);

            return {
              title: t.title.trim(),
              phase: allowedTaskPhases.has(t.phase) ? t.phase : primaryTab,
              priority: (t.priority === 1 || t.priority === 2 || t.priority === 3) ? t.priority : 2,
              steps: finalStepList.length,
              stepList: finalStepList,
              note: textOr(t.note),
              ...validatedTimerFields(t),
              ...validatedScheduleFields(t),
            };
          });

          return res.json({
            reply: textOr(parsed.reply, isUk ? 'Пропозицію сформовано.' : 'Proposal prepared.'),
            summary: textOr(parsed.reply, isUk ? 'Пропозицію сформовано.' : 'Proposal prepared.'),
            insights: Array.isArray(parsed.insights) ? parsed.insights.filter(nonEmptyText).slice(0, 10) : [],
            tasks: validatedTasks,
            tabs: validatedTabs,
            ...validateTaskMutations(parsed, mutationTargets),
            source: "gemini-chat",
            usedModel: chatResponse.usedModel,
            fallbackUsed: chatResponse.fallbackUsed,
          });
        }
      } catch (chatError) {
        return sendAIRequestFailure(res, chatError, isUk);
      }
    }

    // If Gemini client is available, leverage LLM for generate / analyze / breakdown
    if (ai && action !== "chat") {
      try {
        const isAnalyzeMode = action === "analyze";
        const systemInstruction = `You are an elite, tactical AI Task Architect and Productivity Strategist for "KARKAS // TASK ARCHITECT".
You have FULL real-time visibility into the user's workspace:
- Active Tasks (with sub-steps, priority, and progress)
- Completed Tasks history
- Deliberately cancelled tasks, kept separate from unfinished active work and completed work
- Category Tabs: ${JSON.stringify(tabList)}
- Workflow statistics & metrics

GOAL: ${isAnalyzeMode ? "Deep diagnostic audit of bottlenecks, momentum, category balance, and concrete corrective action plan." : "Produce a high-impact tactical execution roadmap with concrete tasks and sub-steps."}
TONE: Minimalist, direct, tactical, street-smart, actionable, zero corporate fluff, no emojis in task titles.
LANGUAGE REQUIREMENT: ${isUk ? "All output (summary, insights, task titles, step titles, notes, diagnosis) MUST be in UKRAINIAN." : "All output must be in English."}
AVAILABLE CATEGORY TABS: ${JSON.stringify(activeTabIds)}.
${isTabCreationRequested ? `You may return 1-3 new tabs in "tabs" if organizing a new project area. Each new tab must have a short "name" and an ASCII "id".` : 'Do not create tabs unless clearly requested.'}

CURRENT CLIENT CLOCK (authoritative for relative dates): ${JSON.stringify(clientClock)}.
Requirements:
For time analysis use recorded work and timeStatistics, disclose measurement coverage, and never treat missing readings as zero. Timestamp differences are not measured effort. Current countdown duration may include extensions and is not an original estimate. Recommendations should acknowledge untracked work and uncertainty; do not change tasks for an analysis-only request.
1. "summary": Punchy diagnosis or strategy summary (2-3 sentences).
2. "insights": 2-4 tactical observations on priorities, workload distribution, and execution momentum.
3. "tasks": New top-level tasks only when requested; use an empty array for edits or breakdowns of existing tasks.
4. "tabs": Any new category tabs needed.
5. "taskUpdates": Any adjustments to existing tasks (matching their "id", e.g. re-prioritizing or updating title/note).
6. "workloadDiagnosis": Status assessment object (status badge, bottlenecks array, strengths array).
7. "categoryHealth": Array assessing health per category tab (phase, phaseName, taskCount, status, recommendation).

${taskActionInstructions}
Return valid JSON adhering to schema.`;

        const fullContextPayload = {
          userPrompt: prompt,
          actionType: action,
          language: isUk ? "Ukrainian" : "English",
          overview: {
            totalTasks: effectiveStats.total ?? (effectiveActiveTasks.length + effectiveCompletedTasks.length),
            completedCount: effectiveStats.completed ?? effectiveCompletedTasks.length,
            completionPercent: effectiveStats.percent ?? 0,
            activeCount: effectiveActiveTasks.length,
            urgentP1Count: effectiveActiveTasks.filter((t: any) => t.priority === 1).length,
          },
          behavioralProfile: effectiveAdaptiveProfile,
          categoryTabs: tabList,
          scheduledPlans,
          activeTasks: effectiveActiveTasks.map((t: any) => ({
            id: t.id,
            title: t.title,
            phase: t.phase,
            priority: t.priority,
            progress: `${t.currentStep || 0}/${t.steps || 1}`,
            subSteps: t.stepList || [],
            note: t.note || "",
            schedule: t.schedule,
            scheduledPending: t.scheduledPending,
            timerRunning: !!t.timerRunning,
            timeSpentSeconds: t.timeSpentSeconds || 0,
            timerMode: t.timerMode ?? (t.countdownDurationSeconds > 0 ? 'countdown' : 'stopwatch'),
            countdownDurationSeconds: t.countdownDurationSeconds ?? null,
            countdownRemainingSeconds: t.countdownRemainingSeconds ?? null,
            done: !!t.done,
          })),
          completedTasks: effectiveCompletedTasks,
          completedHistory: productivity.completedHistory,
          cancelledTasks: productivity.cancelledTasks,
          timeStatistics: productivity.timeStatistics,
        };

        const response = await generateGeminiContentWithFallback({
          contents: `USER REQUEST: "${prompt}".
ACTION: ${action}.
WORKSPACE REAL-TIME CONTEXT:
${JSON.stringify(fullContextPayload, null, 2)}`,
          config: {
            systemInstruction,
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                summary: { type: Type.STRING },
                insights: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                tasks: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      title: { type: Type.STRING },
                      phase: { type: Type.STRING },
                      priority: { type: Type.INTEGER },
                      steps: { type: Type.INTEGER },
                      note: { type: Type.STRING },
                      ...taskTimerProperties,
                      ...taskScheduleProperties,
                      stepList: {
                        type: Type.ARRAY,
                        items: {
                          type: Type.OBJECT,
                          properties: {
                            title: { type: Type.STRING },
                          },
                          required: ["title"],
                        },
                      },
                    },
                    required: ["title", "phase", "priority", "steps"],
                  },
                },
                tabs: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING },
                      name: { type: Type.STRING },
                    },
                    required: ["id", "name"],
                  },
                },
                ...taskMutationProperties,
                workloadDiagnosis: {
                  type: Type.OBJECT,
                  properties: {
                    status: { type: Type.STRING },
                    bottlenecks: { type: Type.ARRAY, items: { type: Type.STRING } },
                    strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
                  },
                },
                categoryHealth: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      phase: { type: Type.STRING },
                      phaseName: { type: Type.STRING },
                      taskCount: { type: Type.INTEGER },
                      status: { type: Type.STRING },
                      recommendation: { type: Type.STRING },
                    },
                    required: ["phase", "phaseName", "taskCount", "status"],
                  },
                },
              },
              required: ["summary", "tasks"],
            },
          },
          customAi: ai,
          selectedModel: selectedModel,
          validateResponse: text => validateAssistProposal(text, action, mutationTargets),
        });

        if (response && response.text) {
          const parsed = response.validatedResponse;

          const existingTabIds = new Set(activeTabIds);
          const validatedTabs: { id: string; name: string }[] = [];
          if (isTabCreationRequested && Array.isArray(parsed.tabs)) {
            for (const rawTab of parsed.tabs.slice(0, 4)) {
              const name = typeof rawTab?.name === 'string' ? rawTab.name.trim().slice(0, 32) : '';
              if (!name) continue;
              const baseId = slugifyTabId(name, rawTab.id);
              let id = baseId;
              let suffix = 2;
              while (existingTabIds.has(id) || validatedTabs.some((tb) => tb.id === id)) {
                id = `${baseId.slice(0, 24)}_${suffix++}`;
              }
              existingTabIds.add(id);
              validatedTabs.push({ id, name });
            }
          }
          const allowedTaskPhases = new Set([...activeTabIds, ...validatedTabs.map((tb) => tb.id)]);

          const validatedTasks = (Array.isArray(parsed.tasks) ? parsed.tasks : [])
            .filter((t: unknown) => isRecord(t) && nonEmptyText(t.title)).slice(0, 50).map((t: any, idx: number) => {
            const finalStepList = normalizedSteps(t.stepList, t.steps, isUk, `s-gen-${idx}`, 0);

            return {
              title: t.title.trim(),
              phase: allowedTaskPhases.has(t.phase) ? t.phase : primaryTab,
              priority: (t.priority === 1 || t.priority === 2 || t.priority === 3) ? t.priority : 2,
              steps: finalStepList.length,
              stepList: finalStepList,
              note: textOr(t.note),
              ...validatedTimerFields(t),
              ...validatedScheduleFields(t),
            };
          });

          return res.json({
            summary: textOr(parsed.summary, isUk ? "Аналіз та тактичний план сформовано." : "Analysis and tactical plan generated."),
            insights: Array.isArray(parsed.insights) ? parsed.insights.filter(nonEmptyText).slice(0, 10) : [],
            tasks: validatedTasks,
            tabs: validatedTabs,
            ...validateTaskMutations(parsed, mutationTargets),
            workloadDiagnosis: parsed.workloadDiagnosis,
            categoryHealth: parsed.categoryHealth,
            analyzedContext: {
              activeCount: effectiveActiveTasks.length,
              completedCount: effectiveStats.completed,
              tabsCount: tabList.length,
            },
            source: "gemini",
            usedModel: response.usedModel,
            fallbackUsed: response.fallbackUsed,
          });
        }
      } catch (geminiError) {
        return sendAIRequestFailure(res, geminiError, isUk);
      }
    }

    if (isTimerRequest || isScheduleRequest || action === 'chat') return sendAIRequestFailure(res, new AIRequestError('MISSING_API_KEY'), isUk);

    // High quality offline rule-based Assistant fallback
    const lower = prompt.toLowerCase();
    const isAnalyze = action === "analyze" || lower.includes("аналіз") || lower.includes("аудит") || lower.includes("прогрес") || lower.includes("звіт");
    const p1Tasks = effectiveActiveTasks.filter((t: any) => t.priority === 1);
    const p1Count = p1Tasks.length;

    let fallbackSummary = "";
    let fallbackInsights: string[] = [];
    let fallbackTasks: any[] = [];
    const getPhaseFor = (preferred: string) => activeTabIds.includes(preferred) ? preferred : primaryTab;

    if (isAnalyze) {
      fallbackSummary = isUk
        ? `Аудит робочого процесу: ${effectiveActiveTasks.length} активних завдань, ${effectiveStats.completed} виконано, ${p1Count} у терміновому пріоритеті P1. Свідомо скасованих: ${productivity.cancelledTasks.length}; вони враховані окремо.`
        : `Workflow audit: ${effectiveActiveTasks.length} active tasks, ${effectiveStats.completed} completed, ${p1Count} urgent P1 items. Deliberately cancelled: ${productivity.cancelledTasks.length}, counted separately.`;

      fallbackInsights = isUk
        ? [
            p1Count >= 3
              ? `Увага: у вас ${p1Count} термінових завдань P1. Виберіть одне ключове та завершіть його перед іншими.`
              : `Пріоритетне навантаження збалансоване (${p1Count} задач P1).`,
            effectiveActiveTasks.length > 8
              ? `Черга перевантажена (${effectiveActiveTasks.length} завдань). Рекомендується закрити або відкласти частину справ.`
              : `Оптимальний обсяг черги завдань.`,
            `Регулярно фіксуйте час виконання через вбудований таймер для точної оцінки спринтів.`,
          ]
        : [
            p1Count >= 3
              ? `Warning: ${p1Count} urgent P1 items active. Single-thread on top deliverable first.`
              : `Priority balance is healthy (${p1Count} P1 tasks).`,
            `Capture sub-steps on complex tasks to reduce cognitive friction.`,
          ];

      fallbackTasks = isUk
        ? [
            {
              title: p1Tasks[0] ? `Сфокусуватися на «${p1Tasks[0].title.slice(0, 35)}»` : "Закрити головне пріоритетне завдання дня",
              phase: p1Tasks[0]?.phase || primaryTab,
              priority: 1,
              steps: 2,
              stepList: [
                { id: "s-an-1", title: "Запустити 25-хв фокус-спринт без перемикання", done: false },
                { id: "s-an-2", title: "Зафіксувати результат та закрити задачу", done: false },
              ],
              note: "Головний фокус",
            },
            {
              title: "Провести ревізію та оптимізацію черги завдань",
              phase: primaryTab,
              priority: 2,
              steps: 2,
              stepList: [
                { id: "s-an-3", title: "Перевірити неактуальні завдання та архівувати", done: false },
                { id: "s-an-4", title: "Перерозподілити пріоритети на тиждень", done: false },
              ],
              note: "Гігієна робочого простору",
            },
          ]
        : [
            {
              title: "Knock out top priority deliverable",
              phase: primaryTab,
              priority: 1,
              steps: 2,
              stepList: [
                { id: "s-an-1", title: "Start 25-min focus sprint", done: false },
                { id: "s-an-2", title: "Review outputs and mark complete", done: false },
              ],
              note: "Prime focus",
            },
          ];
    } else {
      fallbackSummary = isUk ? `Тактичний план виконання для «${prompt}».` : `Tactical execution sequence for "${prompt}".`;
      fallbackInsights = isUk
        ? [
            "Розбивайте великі завдання на 2-4 конкретних підкроки для прискорення прогресу.",
            "Зосередьтеся на P1 завданнях перед відкриттям нових етапів.",
          ]
        : [
            "Decompose multi-stage operations into smaller micro-steps.",
            "Focus on urgent P1 items before starting secondary tabs.",
          ];

      fallbackTasks = isUk
        ? [
            {
              title: `Окреслити ключовий результат для «${prompt.slice(0, 40)}»`,
              phase: getPhaseFor("focus"),
              priority: 1,
              steps: 2,
              stepList: [
                { id: "s-g1", title: "Сформулювати критерій готовності", done: false },
                { id: "s-g2", title: "Підготувати необхідні матеріали", done: false },
              ],
              note: "Чіткий орієнтир",
            },
            {
              title: `Основна ударна робота (Sprint Block)`,
              phase: getPhaseFor("work"),
              priority: 1,
              steps: 3,
              stepList: [
                { id: "s-g3", title: "Старт першого 25-хв блоку", done: false },
                { id: "s-g4", title: "Основне виконання без відволікань", done: false },
                { id: "s-g5", title: "Фіксація результату", done: false },
              ],
              note: "Без відволікань",
            },
            {
              title: `Підбити підсумки та перевірити якість`,
              phase: getPhaseFor("focus"),
              priority: 2,
              steps: 1,
              stepList: [
                { id: "s-g6", title: "Перевірити результат за чеклістом", done: false },
              ],
              note: "Фінальний контроль",
            },
          ]
        : [
            {
              title: `Clarify deliverable for "${prompt.slice(0, 40)}"`,
              phase: getPhaseFor("focus"),
              priority: 1,
              steps: 2,
              stepList: [
                { id: "s-g1", title: "Define completion criteria", done: false },
                { id: "s-g2", title: "Gather required assets", done: false },
              ],
              note: "Scope definition",
            },
            {
              title: `Deep execution sprint block`,
              phase: getPhaseFor("work"),
              priority: 1,
              steps: 3,
              stepList: [
                { id: "s-g3", title: "Launch 25-min sprint", done: false },
                { id: "s-g4", title: "Core implementation", done: false },
                { id: "s-g5", title: "Review outputs", done: false },
              ],
              note: "Single-task focus",
            },
          ];
    }

    const quotedTabName = prompt.match(/["«]([^"»]{1,32})["»]/)?.[1]?.trim();
    const fallbackTabs = isTabCreationRequested
      ? [{ id: slugifyTabId(quotedTabName || (isUk ? 'Новий напрямок' : 'New area')), name: quotedTabName || (isUk ? 'Новий напрямок' : 'New area') }]
      : [];

    return res.json({
      summary: fallbackSummary,
      insights: fallbackInsights,
      tasks: fallbackTasks,
      tabs: fallbackTabs,
      analyzedContext: {
        activeCount: effectiveActiveTasks.length,
        completedCount: effectiveStats.completed,
        tabsCount: tabList.length,
      },
      source: "life-rule-engine",
    });
  } catch (err: any) {
    return sendAIRequestFailure(res, classifyAIRequestError(err), req.body?.lang !== 'en');
  }
}
app.post("/api/ai/assist", assistHandler);

// Dedicated Single-Task AI Breakdown into Sub-steps Endpoint
export async function breakdownTaskHandler(req: any, res: any) {
  try {
    const validationError = requestValidationError(req.body);
    if (validationError) return res.status(400).json({ error: validationError });
    const rawTask = req.body.task || (req.body.title ? {
      id: req.body.taskId || req.body.id,
      title: req.body.title,
      note: req.body.note,
      priority: req.body.priority,
      steps: req.body.steps,
      phase: req.body.phase,
    } : null);

    const { allTasks = [], tabs = [], lang = "uk", fullAppContext, customApiKey, selectedModel, currentSteps = [] } = req.body;
    const task = rawTask;

    if (!isRecord(task) || !nonEmptyText(task.title)) {
      return res.status(400).json({ error: "Task with title is required" });
    }

    const clientClock = schedulingClockContext(req.body.clientClock);
    const isUk = lang === "uk" || /[а-яіїєґ]/i.test(task.title);
    
    // Dynamic AI Client setup
    let ai = getGeminiClient();
    if (customApiKey && typeof customApiKey === "string") {
      ai = new GoogleGenAI({
        apiKey: customApiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });
    }

    const effectiveAllTasks = (fullAppContext?.activeTasks || allTasks || []).filter((item: any) => !item.done && isLiveProductivityTask(item));
    const effectiveTabs = fullAppContext?.tabs || tabs || [];

    const activeTabIds = Array.isArray(effectiveTabs) && effectiveTabs.length > 0
      ? effectiveTabs.map((t: any) => (typeof t === "string" ? t : t.id))
      : ["focus", "work", "home", "health", "buy", "study"];

    if (ai) {
      try {
        const systemInstruction = `You are an expert tactical task decomposition engine for the app "Karkas".
CURRENT CLIENT CLOCK: ${JSON.stringify(clientClock)}.
Your mission: Break down a single specific task using a lightweight Work Breakdown Structure (WBS) into 2 to 5 concrete, actionable, sequential sub-steps.
LANGUAGE REQUIREMENT: ${isUk ? "All output (sub-step titles, note, explanation) MUST be in UKRAINIAN." : "All output must be in English."}

Requirements:
1. "stepList": Array of 2 to 5 concise sequential sub-steps. Each title must contain one observable action and a concrete completion signal (e.g. ${isUk ? '"1. Зібрати вимоги в один список", "2. Підготувати перший чернетковий результат", "3. Перевірити результат за чеклістом"' : '"1. Gather requirements into one list", "2. Produce a first draft", "3. Verify the result against a checklist"'}).
2. "steps": Total count of generated sub-steps (equal to stepList.length).
3. "note": Refined concise execution tip (max 6-8 words).
4. "suggestedPriority": Number 1 (urgent), 2 (standard), or 3 (low).
5. "explanation": One short tactical sentence explaining how to execute this task frictionlessly.
6. Make the first sub-step independently actionable within roughly 25 minutes and name its expected output.
7. Order steps by dependency: preparation/input -> execution/output -> verification/closeout. Do not put verification before execution.
8. Preserve useful existing steps when they are still valid; do not repeat completed work.
9. Avoid vague verbs ("work on", "handle", "continue", "do the task"), hidden multi-task steps, and unnecessary sub-steps. If the task is simple, use 2-3 steps; use 4-5 only when there are real dependencies.

Return valid JSON adhering to schema.`;

        const response = await generateGeminiContentWithFallback({
          contents: `TASK TO BREAK DOWN:
- Title: "${task.title}"
- Category: "${task.phase || 'general'}"
- Priority: P${task.priority || 2}
- Current Note: "${task.note || ''}"
- Existing Step Count: ${task.steps || 1}
- Existing Steps: ${JSON.stringify(Array.isArray(currentSteps) ? currentSteps : [])}

APP CONTEXT:
- Other active tasks: ${JSON.stringify(effectiveAllTasks.slice(0, 8).map((t: any) => t.title))}
- Available categories: ${JSON.stringify(activeTabIds)}
- Language: ${isUk ? 'Ukrainian' : 'English'}`,
          config: {
            systemInstruction,
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                steps: { type: Type.INTEGER },
                suggestedPriority: { type: Type.INTEGER },
                note: { type: Type.STRING },
                explanation: { type: Type.STRING },
                stepList: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      title: { type: Type.STRING },
                    },
                    required: ["title"],
                  },
                },
              },
              required: ["steps", "stepList", "note"],
            },
          },
          customAi: ai,
          selectedModel: selectedModel,
        });

        if (response && response.text) {
          const parsed = cleanAndParseJson(response.text || "{}");
          if (!Array.isArray(parsed.stepList) || !parsed.stepList.some((step: unknown) =>
            nonEmptyText(step) || (isRecord(step) && nonEmptyText(step.title)))) throw new Error('Invalid generated breakdown');
          const generatedList = normalizedSteps(parsed.stepList, parsed.steps, isUk, 's-ai', 2, 5);

          return res.json({
            taskId: task.id,
            steps: generatedList.length,
            stepList: generatedList,
            note: textOr(parsed.note, textOr(task.note)),
            suggestedPriority: priorityOr(parsed.suggestedPriority, priorityOr(task.priority)),
            explanation: textOr(parsed.explanation, isUk ? "Завдання розбито на послідовні кроки." : "Task broken into sequential steps."),
            source: "gemini",
            usedModel: response.usedModel,
            fallbackUsed: response.fallbackUsed,
          });
        }
      } catch (err) {
        return sendAIRequestFailure(res, err, isUk);
      }
    }

    // Heuristic Sub-step Breakdown Engine
    const tTitle = task.title.trim();
    const fallbackList = isUk
      ? [
          { id: `s-fb-1-${Date.now()}`, title: `1. Виписати очікуваний результат для «${tTitle.slice(0, 32)}»`, done: false },
          { id: `s-fb-2-${Date.now()}`, title: `2. Виконати головну дію та створити перший результат`, done: false },
          { id: `s-fb-3-${Date.now()}`, title: `3. Перевірити результат за коротким чеклістом`, done: false },
        ]
      : [
          { id: `s-fb-1-${Date.now()}`, title: `1. Define the expected outcome for "${tTitle.slice(0, 32)}"`, done: false },
          { id: `s-fb-2-${Date.now()}`, title: `2. Complete the main action and produce a first result`, done: false },
          { id: `s-fb-3-${Date.now()}`, title: `3. Verify the result against a short checklist`, done: false },
        ];

    return res.json({
      taskId: task.id,
      steps: fallbackList.length,
      stepList: fallbackList,
      note: textOr(task.note, isUk ? "Послідовне виконання за етапами" : "Execute step-by-step"),
      suggestedPriority: priorityOr(task.priority),
      explanation: isUk ? "Завдання розбито на 3 базові етапи." : "Task partitioned into 3 distinct stages.",
      source: "heuristic-engine",
    });
  } catch (err: any) {
    return sendAIRequestFailure(res, classifyAIRequestError(err), req.body?.lang !== 'en');
  }
}
app.post("/api/ai/breakdown-task", breakdownTaskHandler);

// AI Dashboard Recommendations & Period Productivity Analysis Endpoint
export async function recommendationsHandler(req: any, res: any) {
  try {
    const validationError = requestValidationError(req.body);
    if (validationError) return res.status(400).json({ error: validationError });
    const {
      tasks: suppliedTasks = [],
      deletedTasks: suppliedDeletedTasks = [],
      tabs = [],
      lang = "uk",
      period = "ALL_TIME",
      customApiKey,
      selectedModel,
    } = req.body;
    const isUk = lang === "uk";
    
    // Dynamic AI Client setup
    let ai = getGeminiClient();
    if (customApiKey && typeof customApiKey === "string") {
      ai = new GoogleGenAI({
        apiKey: customApiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });
    }

    const activeTabIds: string[] = Array.isArray(tabs) && tabs.length > 0
      ? tabs.map((t: any) => (typeof t === "string" ? t : t.id))
      : ["focus", "work", "home", "health", "buy", "study"];
    const primaryTab = activeTabIds[0] || "focus";

    const tasks = suppliedTasks.filter(isLiveProductivityTask);
    const relevantArchive = selectRelevantArchivedTasks(suppliedTasks, suppliedDeletedTasks);
    const periodTasks = selectPeriodTasks(tasks, relevantArchive, period, new Date());
    const activeTasks = periodTasks.activeInPeriod;
    const completedTasks = [...periodTasks.completedInPeriod, ...periodTasks.deletedCompleted];
    const timeStatistics = summarizeTaskTime(completedTasks);
    const cancelledTasks = periodTasks.droppedInPeriod;
    const p1Count = activeTasks.filter((t: any) => t.priority === 1).length;
    const p2Count = activeTasks.filter((t: any) => t.priority === 2).length;

    // Period label humanized
    const currentYear = new Date().getFullYear();
    const lastYear = currentYear - 1;
    const periodNames: Record<string, string> = isUk
      ? {
          ALL_TIME: "За весь час",
          THIS_YEAR: `Цей рік (${currentYear})`,
          LAST_YEAR: `Минулий рік (${lastYear})`,
          THIS_MONTH: "Цей місяць",
          LAST_30_DAYS: "Останні 30 днів",
        }
      : {
          ALL_TIME: "All Time",
          THIS_YEAR: `This Year (${currentYear})`,
          LAST_YEAR: `Last Year (${lastYear})`,
          THIS_MONTH: "This Month",
          LAST_30_DAYS: "Last 30 Days",
        };
    const periodHumanName = periodNames[period] || period;

    const isMonthPeriod = period === "THIS_MONTH" || period === "LAST_30_DAYS";
    const isYearPeriod = period === "THIS_YEAR" || period === "LAST_YEAR";
    const targetNorm = isMonthPeriod ? 25 : isYearPeriod ? 200 : 40;
    const minDeliveredForGrade = isMonthPeriod
      ? { S: 20, APlus: 15, A: 10, B: 6 }
      : isYearPeriod
      ? { S: 150, APlus: 100, A: 60, B: 30 }
      : { S: 30, APlus: 20, A: 12, B: 6 };

    const totalAll = periodTasks.createdInPeriod.length;
    const completedAll = completedTasks.length;
    const cancelledAll = cancelledTasks.length;
    const successRate = Math.round(
      (completedAll / (completedAll + cancelledAll || 1)) * 100);
    const safePeriodMetrics = {
      totalCreated: totalAll, totalCompleted: completedAll, totalActive: activeTasks.length,
      totalCancelled: cancelledAll, totalDeleted: cancelledAll, successRate,
    };
    const productivityGrade = successRate >= 90 && completedAll >= minDeliveredForGrade.S ? 'S'
      : successRate >= 80 && completedAll >= minDeliveredForGrade.APlus ? 'A+'
      : successRate >= 65 && completedAll >= minDeliveredForGrade.A ? 'A'
      : successRate >= 50 && completedAll >= minDeliveredForGrade.B ? 'B' : 'C';

    if (ai) {
      try {
        const systemInstruction = `You are an elite strategic AI Productivity Analyst for the "KARKAS // TASK ARCHITECT" workspace.
Your task is to critically analyze the user's complete productivity performance and TASK VOLUME DENSITY for the specified timeframe (${periodHumanName}).
This includes unfinished active work, successfully completed work (including completed archives), and explicitly deliberately cancelled unfinished tasks as three separate groups.
Active unfinished tasks are not failures and are not cancelled. Cancelled tasks are not completed. Do not infer why the user cancelled a task or equate cancellation with procrastination or poor discipline.
Accidental entries and unfinished archives with unknown reasons are excluded entirely from these metrics and context. Do not reconstruct them from earlier conversation or treat them as workload, output, or failures.
TIME ANALYSIS: In periodRetrospective or optimizationTip discuss the supplied recorded work time, measurement coverage, realistic work blocks and buffer time when available. Unknown readings are not zero. Only measured completed tasks contribute to the average; no readings means insufficient time data. Do not infer effort from creation/completion timestamps. Recorded time excludes pauses and untracked work. Current timer budgets may include added time and must not be called original estimates. A small measured sample does not justify confident duration predictions.

TASK VOLUME BENCHMARKS & DENSITY RULES:
- Standard monthly workload benchmark is 20 to 30 tasks per month (target norm: ~${targetNorm} tasks for ${periodHumanName}).
- CRITICAL VOLUME RULE: If the user has only recorded a handful of tasks (e.g. 1 to 5 tasks in a whole month), a 100% success rate on 3 tasks is NOT high productivity. It represents insufficient operational density or under-decomposition (e.g. doing 1 single commit/animation a month).
- In cases of low task volume (<${minDeliveredForGrade.B} completed tasks), your "periodRetrospective" and "focusAdvice" MUST explicitly call out the low task volume deficit, advise breaking work into daily atomic milestones, and assign Grade "C" due to insufficient sample size.

GRADE CRITERIA (Requires BOTH high success rate AND meeting task volume quota):
- "S" (Elite): Success rate >= 90% AND completed >= ${minDeliveredForGrade.S} tasks in period.
- "A+" (High Output): Success rate >= 80% AND completed >= ${minDeliveredForGrade.APlus} tasks in period.
- "A" (Solid Output): Success rate >= 65% AND completed >= ${minDeliveredForGrade.A} tasks in period.
- "B" (Baseline Minimum): Success rate >= 50% AND completed >= ${minDeliveredForGrade.B} tasks in period.
- "C" (Deficit / Low Volume): Success rate < 50% OR completed < ${minDeliveredForGrade.B} tasks in period.

LANGUAGE REQUIREMENT: ${isUk ? "All output (focusAdvice, optimizationTip, workloadStatus, periodRetrospective, dropoffAnalysis, futureStrategy, suggested task titles, notes, and reasons) MUST be in UKRAINIAN." : "All output must be in English."}
AVAILABLE CATEGORY TABS: ${JSON.stringify(activeTabIds)}.
Each suggested task must have a phase belonging to: ${JSON.stringify(activeTabIds)}.

Provide:
1. "focusAdvice": 1-2 punchy, tactical sentences on what immediate priority to tackle next (or how to ramp up task logging density if volume is low).
2. "optimizationTip": 1 actionable tip on cadence, batching, daily decomposition, or workload management.
3. "workloadStatus": Short badge string (e.g. ${isUk ? '"🔥 ВИСОКИЙ ТЕМП", "⚡ ОПТИМАЛЬНИЙ БАЛАНС", "⚠️ НИЗЬКИЙ ОБСЯГ", "🌱 ЧЕРГА ВІЛЬНА"' : '"🔥 HIGH TEMPO", "⚡ OPTIMAL BALANCE", "⚠️ LOW VOLUME", "🌱 LOW LOAD"'}).
4. "periodRetrospective": 2-3 deep analytical sentences evaluating output velocity, completion discipline, and task volume density against the target norm of ${targetNorm} tasks for "${periodHumanName}". Refer to concrete numbers (e.g. "закрито X із норми Y завдань").
5. "dropoffAnalysis": 1-2 constructive sentences about explicitly cancelled unfinished tasks only. Use their supplied count; do not invent motives or mix them with active work, completed archives or accidental entries. When there are none, say there were no classified cancellations in this period.
6. "futureStrategy": 1-2 strategic recommendations for the upcoming work cycles (focusing on consistent daily task cadence).
7. "productivityGrade": One grade code: "S", "A+", "A", "B", or "C" strictly matching the volume+completion rules above.
8. "suggestedTasks": 2 to 3 high-impact next step tasks that naturally complement their workflow. Each with:
   - "title": Actionable task title (max 7-8 words)
   - "phase": One of ${JSON.stringify(activeTabIds)}
   - "priority": 1, 2, or 3
   - "steps": 1 to 3
   - "note": Brief tip or key action note (max 6 words)
   - "reason": Why this task is recommended

Return valid JSON adhering to the schema.`;

        const response = await generateGeminiContentWithFallback({
          contents: `USER PRODUCTIVITY DATA FOR PERIOD [${periodHumanName}]:
- Target Period Norm: ${targetNorm} tasks
- Metrics Overview: ${JSON.stringify(safePeriodMetrics)}
- Recorded completed work time (seconds, selected period): ${JSON.stringify(timeStatistics)}
- Active Tasks (${activeTasks.length}): ${JSON.stringify(activeTasks.slice(0, 15).map((t: any) => ({ title: t.title, phase: t.phase, priority: t.priority, steps: t.steps })))}
- Completed Tasks (${completedTasks.length}; first 15 shown): ${JSON.stringify(completedTasks.slice(0, 15).map((t: any) => ({ title: t.title, phase: t.phase, recordedWorkSeconds: recordedTaskSeconds(t), currentTimerBudgetSeconds: t.countdownDurationSeconds ?? null })))}
- Deliberately Cancelled Unfinished Tasks (${cancelledTasks.length}): ${JSON.stringify(cancelledTasks.slice(0, 15).map((t: any) => ({ title: t.title, phase: t.phase, deletionReason: 'cancelled', done: false })))}
- Category List: ${JSON.stringify(tabs)}
- Urgent P1 count: ${p1Count}, Standard P2 count: ${p2Count}
Language: ${isUk ? "Ukrainian" : "English"}.`,
          config: {
            systemInstruction,
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                focusAdvice: { type: Type.STRING },
                optimizationTip: { type: Type.STRING },
                workloadStatus: { type: Type.STRING },
                periodRetrospective: { type: Type.STRING },
                dropoffAnalysis: { type: Type.STRING },
                futureStrategy: { type: Type.STRING },
                productivityGrade: { type: Type.STRING },
                suggestedTasks: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      title: { type: Type.STRING },
                      phase: { type: Type.STRING },
                      priority: { type: Type.INTEGER },
                      steps: { type: Type.INTEGER },
                      note: { type: Type.STRING },
                      reason: { type: Type.STRING },
                    },
                    required: ["title", "phase", "priority", "steps", "reason"],
                  },
                },
              },
              required: [
                "focusAdvice",
                "optimizationTip",
                "workloadStatus",
                "periodRetrospective",
                "dropoffAnalysis",
                "futureStrategy",
                "productivityGrade",
                "suggestedTasks",
              ],
            },
          },
          customAi: ai,
          selectedModel: selectedModel,
        });

        if (response && response.text) {
          const raw = response.text || "{}";
          const parsed = cleanAndParseJson(raw);
          if (!Array.isArray(parsed.suggestedTasks)) throw new Error('Invalid generated recommendations');
          const validatedSuggestedTasks = parsed.suggestedTasks
            .filter((st: unknown) => isRecord(st) && nonEmptyText(st.title)).slice(0, 3).map((st: any) => ({
            title: st.title.trim(),
            phase: activeTabIds.includes(st.phase) ? st.phase : primaryTab,
            priority: priorityOr(st.priority),
            steps: Number.isInteger(st.steps) && st.steps >= 1 && st.steps <= 3 ? st.steps : 2,
            note: textOr(st.note),
            reason: textOr(st.reason),
          }));

          return res.json({
            focusAdvice: textOr(parsed.focusAdvice, isUk ? "Закрийте пріоритетне завдання для імпульсу." : "Finish top priority task for momentum."),
            optimizationTip: textOr(parsed.optimizationTip, isUk ? "Групуйте дрібні задачі в 25-хвилинні спринти." : "Batch minor tasks in 25-min sprints."),
            workloadStatus: textOr(parsed.workloadStatus, isUk ? "🎯 ЧІТКИЙ ФОКУС" : "🎯 SHARP FOCUS"),
            periodRetrospective: textOr(parsed.periodRetrospective),
            dropoffAnalysis: textOr(parsed.dropoffAnalysis),
            futureStrategy: textOr(parsed.futureStrategy),
            productivityGrade,
            suggestedTasks: validatedSuggestedTasks,
            source: "gemini",
            usedModel: response.usedModel,
            fallbackUsed: response.fallbackUsed,
          });
        }
      } catch (gemError) {
        return sendAIRequestFailure(res, gemError, isUk);
      }
    }

    // Heuristic Rule-Based Intelligence Engine (instant fallback)
    let focusAdvice = "";
    let optimizationTip = "";
    let workloadStatus = "";
    let periodRetrospective = "";
    let dropoffAnalysis = "";
    let futureStrategy = "";
    let suggestedTasks: any[] = [];

    const p1Active = activeTasks.find((t: any) => t.priority === 1);

    if (completedAll < minDeliveredForGrade.B) {
      workloadStatus = isUk ? "⚠️ НИЗЬКИЙ ОБСЯГ" : "⚠️ LOW VOLUME";
      focusAdvice = isUk
        ? `Зафіксовано лише ${completedAll} закритих завдань із рекомендованої норми ${targetNorm}. Декомпозуйте щоденну роботу на менші конкретні задачі.`
        : `Only ${completedAll} tasks delivered out of ${targetNorm} target benchmark. Break workflows into daily actionable tasks.`;
      optimizationTip = isUk
        ? "Додавайте принаймні 1-2 конкретні атомарні справи щодня, щоб вийти на робочу норму."
        : "Capture at least 1-2 daily atomic tasks to reach operational quota.";
    } else if (p1Count >= 3) {
      workloadStatus = isUk ? "🔥 ВИСОКИЙ ТЕМП" : "🔥 HIGH TEMPO";
      focusAdvice = isUk
        ? `У вас ${p1Count} термінових справ P1. Сфокусуйтеся на «${p1Active?.title || "найважливішій справі"}» та не перемикайте контекст.`
        : `You have ${p1Count} urgent P1 tasks. Zero in on "${p1Active?.title || "primary priority"}" without context switching.`;
      optimizationTip = isUk
        ? "Тимчасово відкладіть другорядні справи (P3) до завершення критичного блоку."
        : "Park low-priority P3 items until critical deliverables are clear.";
    } else if (activeTasks.length === 0) {
      workloadStatus = isUk ? "🌱 ЧЕРГА ВІЛЬНА" : "🌱 QUEUE CLEARED";
      focusAdvice = isUk
        ? "У вибраному періоді немає активних завдань. Можна переглянути результати або спланувати наступні справи."
        : "There are no active tasks in the selected period. Review results or plan the next tasks.";
      optimizationTip = isUk
        ? "Сформуйте 3 ключові орієнтири на наступний робочий спринт."
        : "Draft 3 core anchors for your next operational sprint.";
    } else {
      workloadStatus = isUk ? "⚡ ОПТИМАЛЬНИЙ БАЛАНС" : "⚡ OPTIMAL BALANCE";
      focusAdvice = isUk
        ? `Рівномірний темп: почніть із «${p1Active?.title || activeTasks[0]?.title || "активного завдання"}», щоб розігнати фокус.`
        : `Solid cadence: tackle "${p1Active?.title || activeTasks[0]?.title || "active item"}" first to build momentum.`;
      optimizationTip = isUk
        ? "Використовуйте правило двох хвилин: якщо дію можна зробити миттєво — зробіть одразу."
        : "Apply the 2-minute rule: if a sub-step is quick, knock it out immediately.";
    }

    periodRetrospective = isUk
      ? `За період «${periodHumanName}» зафіксовано ${totalAll} завдань (цільова норма: ${targetNorm}). Успішно закрито ${completedAll} (${successRate}% успішності). ${completedAll < minDeliveredForGrade.B ? "Поточний обсяг замалий для повноцінної високої оцінки — збільшуйте щільність щоденного планування." : "Ви демонструєте достатню щільність та дисципліну закриття."}`
      : `For "${periodHumanName}", tracked ${totalAll} tasks (target norm: ${targetNorm}). Delivered ${completedAll} (${successRate}% success rate). ${completedAll < minDeliveredForGrade.B ? "Volume is below baseline quota — increase daily task decomposition." : "Solid task output and execution cadence."}`;

    dropoffAnalysis = isUk
      ? cancelledAll > 0
        ? `Свідомо скасовано ${cancelledAll} незавершених завдань. Вони враховані окремо від виконаних і активних; причина скасування не визначена.`
        : "Свідомо скасованих завдань за цей період немає. Активні незавершені завдання не є скасованими."
      : cancelledAll > 0
      ? `${cancelledAll} unfinished tasks were deliberately cancelled. They are counted separately from completed and active work; no cancellation motive is inferred.`
      : "There are no classified cancellations in this period. Active unfinished tasks are not cancellations.";

    futureStrategy = isUk
      ? "Підтримуйте декомпозицію складних цілей на 2-3 підкроки та підбивайте підсумки наприкінці кожного тижня для максимального фокусу."
      : "Maintain 2-3 step sub-task breakdown and run weekly recaps for peak focus.";

    // Dynamic suggested tasks
    suggestedTasks.push({
      title: isUk ? "Провести ретроспективу та зафіксувати досягнення" : "Run periodic review & log achievements",
      phase: primaryTab,
      priority: 2,
      steps: 2,
      note: isUk ? "15 хв аналіз" : "15 min review",
      reason: isUk ? "Допомагає закріпити робочий прогрес" : "Consolidates work progress",
    });

    if (activeTabIds.includes("health")) {
      suggestedTasks.push({
        title: isUk ? "Відновлювальна розминка та водний баланс (500 мл)" : "Mobility stretch & 500ml hydration check",
        phase: "health",
        priority: 2,
        steps: 1,
        note: isUk ? "Підтримка фокусу" : "Physical reset",
        reason: isUk ? "Відновлює когнітивну продуктивність" : "Restores cognitive baseline",
      });
    }

    if (suggestedTasks.length < 3) {
      suggestedTasks.push({
        title: isUk ? "Визначити топ-3 цілі на наступний місяць" : "Set top 3 milestone goals for next month",
        phase: primaryTab,
        priority: 1,
        steps: 3,
        note: isUk ? "Стратегічний фокус" : "Strategic focus",
        reason: isUk ? "Забезпечує довгостроковий напрямок" : "Guides long-term trajectory",
      });
    }

    return res.json({
      focusAdvice,
      optimizationTip,
      workloadStatus,
      periodRetrospective,
      dropoffAnalysis,
      futureStrategy,
      productivityGrade,
      suggestedTasks: suggestedTasks.slice(0, 3),
      source: "rule-engine",
    });
  } catch (err: any) {
    return sendAIRequestFailure(res, classifyAIRequestError(err), req.body?.lang !== 'en');
  }
}
app.post("/api/ai/recommendations", recommendationsHandler);

const LIVE_TRANSCRIPTION_MODEL = "gemini-3.5-transcribe-live";
const LIVE_TRANSCRIPTION_CONFIG = {
  responseModalities: [Modality.TEXT],
  inputAudioTranscription: {
    languageCodes: ["uk-UA", "en-US"],
  },
};

type VoiceTokenClient = Pick<GoogleGenAI, "authTokens">;

export async function createVoiceToken(ai: VoiceTokenClient, now = Date.now()) {
  const authToken = await ai.authTokens.create({
    config: {
      // Ephemeral-token support in the installed SDK is served through v1alpha.
      httpOptions: { apiVersion: "v1alpha" },
      uses: 1,
      expireTime: new Date(now + 5 * 60 * 1000).toISOString(),
      newSessionExpireTime: new Date(now + 60 * 1000).toISOString(),
      liveConnectConstraints: {
        model: LIVE_TRANSCRIPTION_MODEL,
        config: LIVE_TRANSCRIPTION_CONFIG,
      },
    },
  });

  if (!authToken.name) throw new Error("Gemini did not return an ephemeral token");
  return {
    token: authToken.name,
    model: LIVE_TRANSCRIPTION_MODEL,
    config: LIVE_TRANSCRIPTION_CONFIG,
  };
}

// Issue a constrained, single-use credential so the renderer can connect to
// Gemini Live without ever receiving the long-lived API key.
export async function voiceTokenHandler(req: any, res: any) {
  try {
    const { customApiKey } = req.body || {};
    let ai = getGeminiClient();
    if (customApiKey && typeof customApiKey === "string") {
      ai = new GoogleGenAI({
        apiKey: customApiKey,
        httpOptions: { headers: { "User-Agent": "aistudio-build" } },
      });
    }

    if (!ai) {
      return res.status(503).json({ error: "Gemini API key is not configured." });
    }

    return res.json(await createVoiceToken(ai));
  } catch (err: any) {
    console.error("Voice token error:", err);
    return res.status(500).json({ error: "Failed to create voice token" });
  }
}
app.post("/api/ai/voice-token", voiceTokenHandler);

// Audio transcription endpoint for voice dictation
export async function transcribeAudioHandler(req: any, res: any) {
  try {
    const { audioBase64, mimeType = "audio/webm", lang = "uk", customApiKey } = req.body || {};
    if (!audioBase64 || typeof audioBase64 !== "string") {
      return res.status(400).json({ error: "audioBase64 is required" });
    }

    let ai = getGeminiClient();
    if (customApiKey && typeof customApiKey === "string") {
      ai = new GoogleGenAI({
        apiKey: customApiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });
    }

    if (!ai) {
      return res.status(503).json({
        error: lang === "uk"
          ? "Gemini API ключ не налаштовано. Будь ласка, вкажіть ваш ключ у налаштуваннях AI."
          : "Gemini client not initialized. Please configure your API key in AI settings."
      });
    }

    // Robustly clean base64 data regardless of data URL prefixes and codec parameters
    let cleanBase64 = String(audioBase64 || "").trim();
    const commaIndex = cleanBase64.indexOf(",");
    if (cleanBase64.startsWith("data:") && commaIndex !== -1) {
      cleanBase64 = cleanBase64.slice(commaIndex + 1);
    } else if (cleanBase64.includes(";base64,")) {
      cleanBase64 = cleanBase64.split(";base64,")[1];
    }
    // Remove any remaining metadata or whitespace/linebreaks
    cleanBase64 = cleanBase64.replace(/^data:[^,]+,/, "").replace(/\s+/g, "");

    // Normalize MIME type for Gemini inlineData
    let cleanMime = "audio/webm";
    if (audioBase64.startsWith("data:")) {
      const mimeMatch = audioBase64.match(/^data:([^;,]+)/);
      if (mimeMatch && mimeMatch[1]) {
        cleanMime = mimeMatch[1].trim().toLowerCase();
      }
    } else if (mimeType && typeof mimeType === "string") {
      cleanMime = mimeType.split(";")[0].trim().toLowerCase();
    }
    if (!cleanMime || cleanMime === "undefined" || cleanMime === "null") {
      cleanMime = "audio/webm";
    }

    const isUk = lang === "uk";
    const prompt = isUk
      ? "Точно транскрибуй усне мовлення з цього аудіозапису українською мовою. Поверни ВИКЛЮЧНО розпізнаний текст без лапок, вступних слів чи пояснень. Якщо аудіо тихе або без слів, поверни порожній рядок."
      : "Accurately transcribe the spoken language from this audio recording into plain text. Return ONLY the transcribed words without quotation marks, introductions, notes, or explanations. If audio is silent or unintelligible, return an empty string.";

    // Batch transcription deliberately uses fast, broadly available models and
    // does not inherit the chat model selected by the user.
    const modelsToTry = ["gemini-2.5-flash", "gemini-flash-latest"];

    let transcription = "";
    let lastError: any = null;

    for (const model of modelsToTry) {
      try {
        const response = await Promise.race([ai.models.generateContent({
          model,
          contents: [
            {
              role: "user",
              parts: [
                {
                  inlineData: {
                    mimeType: cleanMime,
                    data: cleanBase64,
                  },
                },
                {
                  text: prompt,
                },
              ],
            },
          ],
          config: {
            temperature: 0.1,
            thinkingConfig: {
              thinkingBudget: 0,
            },
          },
        }), new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Gemini model ${model} timed out`)), 15000)
        )]);
        transcription = (response.text || "").trim();
        break;
      } catch (err: any) {
        lastError = err;
        console.warn(`Model ${model} transcription attempt failed:`, err?.message);
      }
    }

    if (!transcription && lastError) {
      throw lastError;
    }

    const cleanText = transcription.replace(/^["'«“]+|["'»”]+$/g, "").trim();
    return res.json({ text: cleanText });
  } catch (err: any) {
    console.error("Transcribe audio error:", err);
    return res.status(500).json({ error: err.message || "Failed to transcribe audio" });
  }
}
app.post("/api/ai/transcribe-audio", transcribeAudioHandler);

const desktopHandlers: Record<string, (req: any, res: any) => Promise<any>> = {
  verifyKey: verifyKeyHandler,
  checkUpdate: checkUpdateHandler,
  assist: assistHandler,
  breakdown: breakdownTaskHandler,
  recommendations: recommendationsHandler,
  voiceToken: voiceTokenHandler,
  transcribeAudio: transcribeAudioHandler,
};

/** Run an API service in-process for the Electron IPC bridge without opening a TCP listener. */
export async function invokeDesktopApi(operation: string, body: any = {}) {
  const handler = desktopHandlers[operation];
  if (!handler) return { status: 404, body: { error: 'Unknown desktop API operation' } };

  let status = 200;
  let responseBody: any;
  const response = {
    status(code: number) {
      status = code;
      return response;
    },
    json(value: any) {
      responseBody = value;
      return response;
    },
  };

  await handler({ body }, response);
  return { status, body: responseBody };
}

export async function startServer(options: { port?: number; host?: string; distPath?: string } = {}) {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = options.distPath || path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  return new Promise<import('node:http').Server>((resolve, reject) => {
    const server = app.listen(options.port ?? PORT, options.host || "0.0.0.0", () => resolve(server));
    server.once('error', reject);
  });
}

if (!process.versions.electron && process.env.KARKAS_SERVER_AUTOSTART !== 'false') {
  startServer().catch(() => { console.error('Application server failed to start'); process.exitCode = 1; });
}
