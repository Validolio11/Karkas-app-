import express from "express";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";
import { verifyGeminiKey } from "./server/geminiKeyVerification";

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

// Helper to call Gemini with retry and fallback across models
async function generateGeminiContentWithFallback(params: {
  contents: string;
  config: any;
  customAi?: GoogleGenAI | null;
  selectedModel?: string;
}): Promise<any> {
  const ai = params.customAi || getGeminiClient();
  if (!ai) return null;

  // Models to attempt: primary and fallback
  const modelsToTry = params.selectedModel
    ? [params.selectedModel, "gemini-3.1-flash-lite", "gemini-2.5-flash", "gemini-flash-latest"]
    : ["gemini-3.1-flash-lite", "gemini-2.5-flash", "gemini-flash-latest"];

  for (const model of modelsToTry) {
    try {
      const response = await Promise.race([
        ai.models.generateContent({
          model,
          contents: params.contents,
          config: params.config,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Gemini model ${model} timed out`)), 12000)
        ),
      ]);
      if (response && response.text) {
        return response;
      }
    } catch (err: any) {
      const isTemporaryDemand =
        err?.status === 503 ||
        err?.status === 429 ||
        err?.message?.includes("503") ||
        err?.message?.includes("high demand") ||
        err?.message?.includes("UNAVAILABLE");

      if (isTemporaryDemand || err?.message?.includes("timed out")) {
        // Move quickly to the next model when a provider is slow or busy.
        await new Promise((r) => setTimeout(r, 150));
        continue;
      } else {
        break;
      }
    }
  }

  return null;
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
    const {
      prompt,
      currentTasks = [],
      activeTasks = [],
      completedTasks = [],
      deletedTasks = [],
      tabs = [],
      stats = {},
      adaptiveProfile = {},
      action = "generate",
      lang = "uk",
      customApiKey,
      selectedModel,
      conversation = [],
      fullAppContext,
      allowNewTabs = false,
    } = req.body;

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Prompt is required" });
    }

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
    const effectiveActiveTasks = activeTasks.length > 0
      ? activeTasks
      : contextActiveTasks.length > 0
        ? contextActiveTasks
        : currentTasks.filter((t: any) => !t.done);
    const effectiveCompletedTasks = completedTasks.length > 0
      ? completedTasks
      : contextCompletedTasks.length > 0
        ? contextCompletedTasks
        : currentTasks.filter((t: any) => t.done);
    const effectiveDeletedTasks = deletedTasks.length > 0 ? deletedTasks : contextDeletedTasks;
    const effectiveStats = Object.keys(stats || {}).length > 0 ? stats : (suppliedContext.stats || {});

    // Preserve tab names and colors for analysis
    const tabList = contextTabs.length > 0 ? contextTabs : (Array.isArray(tabs) ? tabs : []);
    const activeTabIds: string[] = tabList.map((t: any) => (typeof t === "string" ? t : t.id));
    const primaryTab = activeTabIds[0] || "focus";

    const isTabCreationRequested = allowNewTabs || /(?:вкладк|категорі|розділ|напрямок|проєкт|проект|секці|tab|category|section|project)/iu.test(prompt);

    if (ai && action === "chat") {
      try {
        const chatPrompt = `You are Karkas AI, an elite conversational task architect and productivity strategist embedded directly in the user's workspace.
LANGUAGE: ${isUk ? "Ukrainian" : "English"}.
CURRENT USER PROMPT: "${prompt}".
RECENT CONVERSATION:
${JSON.stringify(Array.isArray(conversation) ? conversation.slice(-10) : [], null, 2)}
WORKSPACE CONTEXT:
${JSON.stringify({
          activeTasks: effectiveActiveTasks.map((t: any) => ({
            id: t.id,
            title: t.title,
            phase: t.phase,
            priority: t.priority,
            progress: `${t.currentStep || 0}/${t.steps || 1}`,
            stepList: t.stepList?.map((s: any) => typeof s === 'string' ? s : s.title) || [],
            note: t.note || '',
            timerRunning: !!t.timerRunning,
          })),
          completedTasksCount: effectiveCompletedTasks.length,
          recentCompletedSample: effectiveCompletedTasks.slice(-8).map((t: any) => t.title),
          availableTabs: tabList,
          stats: effectiveStats,
          adaptiveProfile,
        }, null, 2)}

INSTRUCTIONS:
1. Provide a natural, concise, empowering conversational "reply".
2. If the user asks to create, plan, add, break down, edit, update, rename, or delete tasks or tabs, YOU MUST ALSO POPULATE the structured JSON fields ("tasks", "tabs", "taskUpdates", "taskDeletions").
3. "tasks": New tasks to create. Each task must have:
   - "title": Actionable concise title
   - "phase": One of available tab IDs: ${JSON.stringify(activeTabIds)} or a newly defined tab ID
   - "priority": 1, 2, or 3
   - "steps": 1 to 5
   - "stepList": Array of sequential sub-steps with "title"
   - "note": Short tactical note
4. "tabs": New category tabs if needed. Each with "id" (lowercase ASCII slug) and "name".
5. "taskUpdates": Edits to existing tasks matching their "id" (e.g. updating title, priority, phase, note, done, or stepList).
6. "taskDeletions": Tasks to delete/archive by their "id".
7. Return strictly valid JSON adhering to schema.`;

        const chatResponse = await generateGeminiContentWithFallback({
          contents: chatPrompt,
          config: {
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
                taskUpdates: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING },
                      title: { type: Type.STRING },
                      phase: { type: Type.STRING },
                      priority: { type: Type.INTEGER },
                      note: { type: Type.STRING },
                      done: { type: Type.BOOLEAN },
                    },
                    required: ["id"],
                  },
                },
              },
              required: ["reply"],
            },
          },
          customAi: ai,
          selectedModel,
        });

        if (chatResponse?.text) {
          const parsed = JSON.parse(chatResponse.text || "{}");
          const existingTabIds = new Set(activeTabIds);
          const validatedTabs: { id: string; name: string }[] = [];
          if (Array.isArray(parsed.tabs)) {
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
          const validatedTasks = (parsed.tasks || []).map((t: any, idx: number) => {
            const rawStepList = Array.isArray(t.stepList) ? t.stepList : [];
            const finalStepList = rawStepList.length > 0
              ? rawStepList.map((s: any, sIdx: number) => ({
                  id: `s-chat-gen-${idx}-${sIdx}-${Date.now().toString(36)}`,
                  title: typeof s === "string" ? s : s.title || `Крок ${sIdx + 1}`,
                  done: false,
                }))
              : Array.from({ length: Math.max(1, t.steps || 2) }, (_, sIdx) => ({
                  id: `s-chat-gen-${idx}-${sIdx}-${Date.now().toString(36)}`,
                  title: `${isUk ? "Етап" : "Step"} ${sIdx + 1}`,
                  done: false,
                }));

            return {
              title: t.title,
              phase: allowedTaskPhases.has(t.phase) ? t.phase : primaryTab,
              priority: (t.priority === 1 || t.priority === 2 || t.priority === 3) ? t.priority : 2,
              steps: finalStepList.length,
              stepList: finalStepList,
              note: t.note || "",
            };
          });

          return res.json({
            reply: parsed.reply,
            summary: parsed.reply,
            insights: parsed.insights || [],
            tasks: validatedTasks,
            tabs: validatedTabs,
            taskUpdates: Array.isArray(parsed.taskUpdates) ? parsed.taskUpdates : [],
            source: "gemini-chat",
          });
        }
      } catch (chatError) {
        console.warn("Gemini chat request failed, smoothly falling back:", chatError);
      }
    }

    // If Gemini client is available, leverage LLM for generate / analyze / breakdown
    if (ai) {
      try {
        const isAnalyzeMode = action === "analyze";
        const systemInstruction = `You are an elite, tactical AI Task Architect and Productivity Strategist for "KARKAS // TASK ARCHITECT".
You have FULL real-time visibility into the user's workspace:
- Active Tasks (with sub-steps, priority, and progress)
- Completed Tasks history
- Category Tabs: ${JSON.stringify(tabList)}
- Workflow statistics & metrics

GOAL: ${isAnalyzeMode ? "Deep diagnostic audit of bottlenecks, momentum, category balance, and concrete corrective action plan." : "Produce a high-impact tactical execution roadmap with concrete tasks and sub-steps."}
TONE: Minimalist, direct, tactical, street-smart, actionable, zero corporate fluff, no emojis in task titles.
LANGUAGE REQUIREMENT: ${isUk ? "All output (summary, insights, task titles, step titles, notes, diagnosis) MUST be in UKRAINIAN." : "All output must be in English."}
AVAILABLE CATEGORY TABS: ${JSON.stringify(activeTabIds)}.
${isTabCreationRequested ? `You may return 1-3 new tabs in "tabs" if organizing a new project area. Each new tab must have a short "name" and an ASCII "id".` : 'Do not create tabs unless clearly requested.'}

Requirements:
1. "summary": Punchy diagnosis or strategy summary (2-3 sentences).
2. "insights": 2-4 tactical observations on priorities, workload distribution, and execution momentum.
3. "tasks": 2-6 concrete actionable tasks with sub-steps.
4. "tabs": Any new category tabs needed.
5. "taskUpdates": Any adjustments to existing tasks (matching their "id", e.g. re-prioritizing or updating title/note).
6. "workloadDiagnosis": Status assessment object (status badge, bottlenecks array, strengths array).
7. "categoryHealth": Array assessing health per category tab (phase, phaseName, taskCount, status, recommendation).

Return valid JSON adhering to schema.`;

        const fullContextPayload = {
          userPrompt: prompt,
          actionType: action,
          language: isUk ? "Ukrainian" : "English",
          overview: {
            totalTasks: effectiveStats.total || (effectiveActiveTasks.length + effectiveCompletedTasks.length),
            completedCount: effectiveStats.completed || effectiveCompletedTasks.length,
            completionPercent: effectiveStats.percent ?? 0,
            activeCount: effectiveActiveTasks.length,
            urgentP1Count: effectiveActiveTasks.filter((t: any) => t.priority === 1).length,
          },
          behavioralProfile: adaptiveProfile,
          categoryTabs: tabList,
          activeTasks: effectiveActiveTasks.map((t: any) => ({
            id: t.id,
            title: t.title,
            phase: t.phase,
            priority: t.priority,
            progress: `${t.currentStep || 0}/${t.steps || 1}`,
            subSteps: t.stepList?.map((s: any) => typeof s === 'string' ? s : s.title) || [],
            note: t.note || "",
            timerRunning: !!t.timerRunning,
            timeSpentSeconds: t.timeSpentSeconds || 0,
          })),
          recentCompletedTasks: effectiveCompletedTasks.slice(-12).map((t: any) => ({
            title: t.title,
            phase: t.phase,
          })),
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
                taskUpdates: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING },
                      title: { type: Type.STRING },
                      phase: { type: Type.STRING },
                      priority: { type: Type.INTEGER },
                      note: { type: Type.STRING },
                      done: { type: Type.BOOLEAN },
                    },
                    required: ["id"],
                  },
                },
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
        });

        if (response && response.text) {
          const rawText = response.text || "{}";
          const parsed = JSON.parse(rawText);

          const existingTabIds = new Set(activeTabIds);
          const validatedTabs: { id: string; name: string }[] = [];
          if (Array.isArray(parsed.tabs)) {
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

          const validatedTasks = (parsed.tasks || []).map((t: any, idx: number) => {
            const rawStepList = Array.isArray(t.stepList) ? t.stepList : [];
            const finalStepList = rawStepList.length > 0
              ? rawStepList.map((s: any, sIdx: number) => ({
                  id: `s-gen-${idx}-${sIdx}-${Date.now().toString(36)}`,
                  title: typeof s === "string" ? s : s.title || `Крок ${sIdx + 1}`,
                  done: false,
                }))
              : Array.from({ length: Math.max(1, t.steps || 2) }, (_, sIdx) => ({
                  id: `s-gen-${idx}-${sIdx}-${Date.now().toString(36)}`,
                  title: `${isUk ? "Етап" : "Step"} ${sIdx + 1}`,
                  done: false,
                }));

            return {
              title: t.title,
              phase: allowedTaskPhases.has(t.phase) ? t.phase : primaryTab,
              priority: (t.priority === 1 || t.priority === 2 || t.priority === 3) ? t.priority : 2,
              steps: finalStepList.length,
              stepList: finalStepList,
              note: t.note || "",
            };
          });

          return res.json({
            summary: parsed.summary || (isUk ? "Аналіз та тактичний план сформовано." : "Analysis and tactical plan generated."),
            insights: parsed.insights || [],
            tasks: validatedTasks,
            tabs: validatedTabs,
            taskUpdates: Array.isArray(parsed.taskUpdates) ? parsed.taskUpdates : [],
            workloadDiagnosis: parsed.workloadDiagnosis,
            categoryHealth: parsed.categoryHealth,
            analyzedContext: {
              activeCount: effectiveActiveTasks.length,
              completedCount: effectiveCompletedTasks.length,
              tabsCount: tabList.length,
            },
            source: "gemini",
          });
        }
      } catch (geminiError) {
        console.warn("Gemini assist encountered load, smoothly using heuristic engine:", geminiError);
      }
    }

    if (action === "chat") {
      const activeCount = effectiveActiveTasks.length;
      const completedCount = effectiveCompletedTasks.length;
      return res.json({
        reply: isUk
          ? `У черзі ${activeCount} активних задач і ${completedCount} завершених. Напишіть конкретну дію (напр. «додай задачу X», «створи вкладку Y», «проаналізуй мої задачі»).`
          : `You have ${activeCount} active and ${completedCount} completed tasks. Tell me what action you need (e.g. "add task X", "create tab Y", "analyze my tasks").`,
        source: "local-chat-fallback",
      });
    }

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
        ? `Аудит робочого процесу: ${effectiveActiveTasks.length} активних завдань, ${effectiveCompletedTasks.length} виконано, ${p1Count} у терміновому пріоритеті P1.`
        : `Workflow audit: ${effectiveActiveTasks.length} active tasks, ${effectiveCompletedTasks.length} completed, ${p1Count} urgent P1 items.`;

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
        completedCount: effectiveCompletedTasks.length,
        tabsCount: tabList.length,
      },
      source: "life-rule-engine",
    });
  } catch (err: any) {
    console.error("AI assist error:", err);
    return res.status(500).json({ error: "Failed to process AI assist request" });
  }
}
app.post("/api/ai/assist", assistHandler);

// Dedicated Single-Task AI Breakdown into Sub-steps Endpoint
export async function breakdownTaskHandler(req: any, res: any) {
  try {
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

    if (!task || !task.title) {
      return res.status(400).json({ error: "Task with title is required" });
    }

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

    const effectiveAllTasks = fullAppContext?.activeTasks || allTasks || [];
    const effectiveTabs = fullAppContext?.tabs || tabs || [];

    const activeTabIds = Array.isArray(effectiveTabs) && effectiveTabs.length > 0
      ? effectiveTabs.map((t: any) => (typeof t === "string" ? t : t.id))
      : ["focus", "work", "home", "health", "buy", "study"];

    if (ai) {
      try {
        const systemInstruction = `You are an expert tactical task decomposition engine for the app "Karkas".
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
- Other active tasks: ${JSON.stringify(allTasks.slice(0, 8).map((t: any) => t.title))}
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
          const parsed = JSON.parse(response.text || "{}");
          const rawSteps = Array.isArray(parsed.stepList) ? parsed.stepList : [];
          const generatedList = rawSteps.map((s: any, idx: number) => ({
            id: `s-ai-${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 3)}`,
            title: typeof s === "string" ? s : s.title || `Крок ${idx + 1}`,
            done: false,
          }));

          const finalStepCount = generatedList.length > 0 ? generatedList.length : Math.max(2, parsed.steps || 3);

          return res.json({
            taskId: task.id,
            steps: finalStepCount,
            stepList: generatedList,
            note: parsed.note || task.note || "",
            suggestedPriority: parsed.suggestedPriority || task.priority || 2,
            explanation: parsed.explanation || (isUk ? "Завдання розбито на послідовні кроки." : "Task broken into sequential steps."),
            source: "gemini",
          });
        }
      } catch (err) {
        console.warn("Gemini breakdown error, falling back to heuristic decomposition engine:", err);
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
      note: task.note || (isUk ? "Послідовне виконання за етапами" : "Execute step-by-step"),
      suggestedPriority: task.priority || 2,
      explanation: isUk ? "Завдання розбито на 3 базові етапи." : "Task partitioned into 3 distinct stages.",
      source: "heuristic-engine",
    });
  } catch (err: any) {
    console.error("Task breakdown API error:", err);
    return res.status(500).json({ error: "Failed to break down task" });
  }
}
app.post("/api/ai/breakdown-task", breakdownTaskHandler);

// AI Dashboard Recommendations & Period Productivity Analysis Endpoint
export async function recommendationsHandler(req: any, res: any) {
  try {
    const {
      tasks = [],
      deletedTasks = [],
      tabs = [],
      lang = "uk",
      period = "ALL_TIME",
      periodMetrics,
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

    const activeTasks = tasks.filter((t: any) => !t.done);
    const completedTasks = tasks.filter((t: any) => t.done);
    const p1Count = activeTasks.filter((t: any) => t.priority === 1).length;
    const p2Count = activeTasks.filter((t: any) => t.priority === 2).length;

    // Period label humanized
    const periodNames: Record<string, string> = isUk
      ? {
          ALL_TIME: "За весь час",
          THIS_YEAR: "Цей рік (2026)",
          LAST_YEAR: "Минулий рік (2025)",
          THIS_MONTH: "Цей місяць",
          LAST_30_DAYS: "Останні 30 днів",
        }
      : {
          ALL_TIME: "All Time",
          THIS_YEAR: "This Year (2026)",
          LAST_YEAR: "Last Year (2025)",
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

    if (ai) {
      try {
        const systemInstruction = `You are an elite strategic AI Productivity Analyst for the "KARKAS // TASK ARCHITECT" workspace.
Your task is to critically analyze the user's complete productivity performance and TASK VOLUME DENSITY for the specified timeframe (${periodHumanName}).
This includes active tasks, successfully completed tasks, and deleted/dropped tasks from the archive.

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
5. "dropoffAnalysis": 1-2 constructive sentences analyzing dropped/deleted tasks or stuck categories and why friction occurred.
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
- Metrics Overview: ${JSON.stringify(periodMetrics || {})}
- Active Tasks (${activeTasks.length}): ${JSON.stringify(activeTasks.slice(0, 15).map((t: any) => ({ title: t.title, phase: t.phase, priority: t.priority, steps: t.steps })))}
- Completed Tasks (${completedTasks.length}): ${JSON.stringify(completedTasks.slice(0, 15).map((t: any) => ({ title: t.title, phase: t.phase })))}
- Archived / Deleted Tasks (${deletedTasks.length}): ${JSON.stringify(deletedTasks.slice(0, 15).map((t: any) => ({ title: t.title, phase: t.phase, doneBeforeDelete: t.done })))}
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
          const parsed = JSON.parse(raw);
          const validatedSuggestedTasks = (parsed.suggestedTasks || []).map((st: any) => ({
            ...st,
            phase: activeTabIds.includes(st.phase) ? st.phase : primaryTab,
            priority: st.priority === 1 || st.priority === 2 || st.priority === 3 ? st.priority : 2,
            steps: st.steps >= 1 && st.steps <= 4 ? st.steps : 2,
            note: st.note || "",
          }));

          return res.json({
            focusAdvice: parsed.focusAdvice || (isUk ? "Закрийте пріоритетне завдання для імпульсу." : "Finish top priority task for momentum."),
            optimizationTip: parsed.optimizationTip || (isUk ? "Групуйте дрібні задачі в 25-хвилинні спринти." : "Batch minor tasks in 25-min sprints."),
            workloadStatus: parsed.workloadStatus || (isUk ? "🎯 ЧІТКИЙ ФОКУС" : "🎯 SHARP FOCUS"),
            periodRetrospective: parsed.periodRetrospective || "",
            dropoffAnalysis: parsed.dropoffAnalysis || "",
            futureStrategy: parsed.futureStrategy || "",
            productivityGrade: parsed.productivityGrade || "A",
            suggestedTasks: validatedSuggestedTasks,
            source: "gemini",
          });
        }
      } catch (gemError) {
        console.warn("Gemini recommendations encountered temporary load, seamlessly transitioning to local rule engine:", gemError);
      }
    }

    // Heuristic Rule-Based Intelligence Engine (instant fallback)
    let focusAdvice = "";
    let optimizationTip = "";
    let workloadStatus = "";
    let periodRetrospective = "";
    let dropoffAnalysis = "";
    let futureStrategy = "";
    let productivityGrade = "A";
    let suggestedTasks: any[] = [];

    const p1Active = activeTasks.find((t: any) => t.priority === 1);
    const totalAll = (periodMetrics?.totalCreated || (activeTasks.length + completedTasks.length + deletedTasks.length)) || 1;
    const completedAll = periodMetrics?.totalCompleted ?? completedTasks.length;
    const deletedAll = periodMetrics?.totalDeleted ?? deletedTasks.length;
    const successRate = periodMetrics?.successRate ?? Math.round((completedAll / (completedAll + deletedAll || 1)) * 100);

    if (completedAll < minDeliveredForGrade.B) {
      productivityGrade = "C";
    } else if (successRate >= 90 && completedAll >= minDeliveredForGrade.S) {
      productivityGrade = "S";
    } else if (successRate >= 80 && completedAll >= minDeliveredForGrade.APlus) {
      productivityGrade = "A+";
    } else if (successRate >= 65 && completedAll >= minDeliveredForGrade.A) {
      productivityGrade = "A";
    } else if (successRate >= 50 && completedAll >= minDeliveredForGrade.B) {
      productivityGrade = "B";
    } else {
      productivityGrade = "C";
    }

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
        ? "Всі поточні завдання виконано. Ідеальний момент для планування нових завдань."
        : "All active items are cleared. Perfect window for strategic planning.";
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
      ? deletedAll > 0
        ? `Утилізовано або скасовано ${deletedAll} завдань. Регулярне очищення черги звільняє ментальний ресурс для дійсно пріоритетних цілей.`
        : "Нульовий рівень відмови: всі зафіксовані завдання або виконані, або знаходяться в активній черзі."
      : deletedAll > 0
      ? `${deletedAll} items were archived or dropped, keeping your queue lean and focused on true priorities.`
      : "Zero dropoff rate: all tasks are either active or successfully delivered.";

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
    console.error("AI recommendations error:", err);
    return res.status(500).json({ error: "Failed to generate AI recommendations" });
  }
}
app.post("/api/ai/recommendations", recommendationsHandler);

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

    const cleanBase64 = audioBase64.replace(/^data:[^;]+;base64,/, "").trim();
    const cleanMime = (mimeType || "audio/webm").split(";")[0].trim().toLowerCase();

    const isUk = lang === "uk";
    const prompt = isUk
      ? "Точно транскрибуй усне мовлення з цього аудіозапису українською мовою. Поверни ВИКЛЮЧНО розпізнаний текст без лапок, вступних слів чи пояснень. Якщо аудіо тихе або без слів, поверни порожній рядок."
      : "Accurately transcribe the spoken language from this audio recording into plain text. Return ONLY the transcribed words without quotation marks, introductions, notes, or explanations. If audio is silent or unintelligible, return an empty string.";

    const modelsToTry = ["gemini-2.5-flash", "gemini-3.8-flash", "gemini-flash-latest"];
    let transcription = "";
    let lastError: any = null;

    for (const model of modelsToTry) {
      try {
        const response = await ai.models.generateContent({
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
        });
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
