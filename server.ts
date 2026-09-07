import express from "express";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";
import { createServer as createViteServer } from "vite";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

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
    ? [params.selectedModel, "gemini-3.8-flash", "gemini-flash-latest"]
    : ["gemini-3.8-flash", "gemini-2.5-flash", "gemini-flash-latest"];

  for (const model of modelsToTry) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: params.contents,
        config: params.config,
      });
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

      if (isTemporaryDemand) {
        // Softly attempt next fallback model after brief delay
        await new Promise((r) => setTimeout(r, 350));
        continue;
      } else {
        break;
      }
    }
  }

  return null;
}

// Endpoint to validate custom Gemini API key and automatically fetch available models
app.post("/api/ai/verify-key", async (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey || typeof apiKey !== "string") {
    return res.status(400).json({ error: "API key is required" });
  }

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });

    const response = (await ai.models.list()) as any;
    const models = (response.models || [])
      .map((m: any) => m.name.replace("models/", ""))
      .filter((name: string) => name.includes("gemini") && !name.includes("embedding"));

    // Provide default fallback models in case of strict filters
    if (models.length === 0) {
      models.push("gemini-3.8-flash", "gemini-3.1-pro-preview", "gemini-3.1-flash-lite");
    }

    res.json({ success: true, models });
  } catch (err: any) {
    console.error("Verify custom API key error:", err);
    res.status(400).json({ error: err.message || "Invalid API key or network error" });
  }
});

// Smart AI Assistant & Full App Context Analyzer Endpoint
app.post("/api/ai/assist", async (req, res) => {
  try {
    const {
      prompt,
      currentTasks = [],
      activeTasks = [],
      completedTasks = [],
      deletedTasks = [],
      tabs = [],
      stats = {},
      action = "generate",
      lang = "uk",
      customApiKey,
      selectedModel,
    } = req.body;

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Prompt is required" });
    }

    const isUk = lang === "uk" || /[а-яіїєґ]/i.test(prompt);
    
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

    // Consolidate active tasks list
    const effectiveActiveTasks = activeTasks.length > 0 ? activeTasks : currentTasks.filter((t: any) => !t.done);
    const effectiveCompletedTasks = completedTasks.length > 0 ? completedTasks : currentTasks.filter((t: any) => t.done);

    // Determine available tab IDs and descriptions
    const tabList = Array.isArray(tabs) && tabs.length > 0
      ? tabs
      : [
          { id: "focus", name: isUk ? "Фокус" : "Focus" },
          { id: "work", name: isUk ? "Робота" : "Work" },
          { id: "home", name: isUk ? "Дім" : "Home" },
          { id: "health", name: isUk ? "Здоровʼя" : "Health" },
          { id: "buy", name: isUk ? "Покупки" : "Buy" },
          { id: "study", name: isUk ? "Навчання" : "Study" },
        ];

    const activeTabIds: string[] = tabList.map((t: any) => (typeof t === "string" ? t : t.id));
    const primaryTab = activeTabIds[0] || "focus";

    // If Gemini client is available, leverage LLM with full context
    if (ai) {
      try {
        const systemInstruction = `You are an elite, tactical AI Task Architect and Productivity Strategist for the life & workflow application "Karkas".
You have FULL, UNRESTRICTED visibility into the user's entire app state:
- Active Tasks (with current step progress and sub-step checklists)
- Completed Tasks history
- Deleted / Archived tasks
- User's dynamic category tabs
- Overall completion metrics and priority distribution

Tone: Minimalist, direct, tactical, street-smart, actionable, zero corporate fluff, no emojis in task titles.
LANGUAGE REQUIREMENT: ${isUk ? "All output (summary, insights, task titles, step titles, notes) MUST be in UKRAINIAN." : "All output must be in English."}
AVAILABLE CATEGORY TABS: ${JSON.stringify(activeTabIds)}.
Every task MUST set "phase" to one of these exact available tabs: ${JSON.stringify(activeTabIds)}.

When breaking down tasks or analyzing:
1. Provide a punchy "summary" explaining the execution roadmap or strategic diagnosis.
2. Provide an array of 2-3 "insights" (tactical advice on priorities, avoiding overload, and workflow optimization).
3. Provide an array of 2-5 concrete "tasks". For each task:
   - "title": Actionable, specific task name
   - "phase": One of ${JSON.stringify(activeTabIds)}
   - "priority": 1 (urgent), 2 (standard), or 3 (low)
   - "steps": Number from 2 to 5 representing stages
   - "note": Brief tip or key action note (max 8 words)
   - "stepList": An array of concrete sequential sub-steps (2-5 items), each with "title" (e.g. ${isUk ? '"1. Підготувати драфт структури", "2. Узгодити вимоги", "3. Провести фінальну перевірку"' : '"1. Draft core structure", "2. Validate specs", "3. Quality check & sign-off"'}).

Adhere strictly to the requested JSON schema.`;

        const fullAppContext = {
          userQueryOrGoal: prompt,
          actionType: action,
          language: isUk ? "Ukrainian" : "English",
          applicationOverview: {
            totalTasks: (stats.total || effectiveActiveTasks.length + effectiveCompletedTasks.length),
            completedCount: (stats.completed || effectiveCompletedTasks.length),
            completionPercent: stats.percent ?? 0,
            activeCount: effectiveActiveTasks.length,
            urgentP1Count: effectiveActiveTasks.filter((t: any) => t.priority === 1).length,
          },
          categoryTabs: tabList,
          activeTasks: effectiveActiveTasks.map((t: any) => ({
            id: t.id,
            title: t.title,
            phase: t.phase,
            priority: t.priority,
            progress: `${t.currentStep || 0}/${t.steps || 1}`,
            subSteps: t.stepList?.map((s: any) => s.title) || [],
            note: t.note || "",
            pinned: !!t.pinned,
          })),
          recentCompletedTasks: effectiveCompletedTasks.slice(-10).map((t: any) => ({
            title: t.title,
            phase: t.phase,
          })),
          deletedArchiveSample: deletedTasks.slice(-5).map((t: any) => ({
            title: t.title,
            phase: t.phase,
          })),
        };

        const response = await generateGeminiContentWithFallback({
          contents: `USER REQUEST: "${prompt}".
ACTION: ${action}.
FULL APPLICATION REAL-TIME CONTEXT:
${JSON.stringify(fullAppContext, null, 2)}`,
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
              phase: activeTabIds.includes(t.phase) ? t.phase : primaryTab,
              priority: (t.priority === 1 || t.priority === 2 || t.priority === 3) ? t.priority : 2,
              steps: finalStepList.length,
              stepList: finalStepList,
              note: t.note || "",
            };
          });

          return res.json({
            summary: parsed.summary || (isUk ? "План сформовано з повного аналізу додатку." : "Plan formulated from full app analysis."),
            insights: parsed.insights || [],
            tasks: validatedTasks,
            analyzedContext: {
              activeCount: effectiveActiveTasks.length,
              completedCount: effectiveCompletedTasks.length,
              tabsCount: tabList.length,
            },
            source: "gemini",
          });
        }
      } catch (geminiError) {
        console.warn("Gemini assist API call encountered temporary issue, seamlessly transitioning to local rule engine.", geminiError);
      }
    }

    // High quality rule-based Assistant fallback (instant, offline-resilient)
    const lower = prompt.toLowerCase();
    let fallbackSummary = isUk ? "Сформовано структурований покроковий план дій." : "Formulated structured action plan.";
    let fallbackTasks: any[] = [];
    const fallbackInsights: string[] = isUk
      ? [
          effectiveActiveTasks.length > 8
            ? "У черзі багато завдань. Сфокусуйтеся на виконанні поточних перед додаванням нових."
            : "Збалансоване навантаження. Розбивайте великі цілі на короткі спринти.",
          "Використовуйте пріоритет P1 для дій із найвищим коефіцієнтом корисної дії.",
        ]
      : [
          "Keep high-priority tasks contained to 2-3 active items at a time.",
          "Batch similar category tasks to reduce mental friction.",
        ];

    const getPhaseFor = (preferred: string) => {
      if (activeTabIds.includes(preferred)) return preferred;
      return primaryTab;
    };

    const isHealth = lower.includes("спорт") || lower.includes("тренув") || lower.includes("здоров") || lower.includes("gym") || lower.includes("fit") || lower.includes("сон");
    const isBuy = lower.includes("купит") || lower.includes("покупк") || lower.includes("buy") || lower.includes("shop") || lower.includes("замовити");
    const isStudy = lower.includes("навчан") || lower.includes("книг") || lower.includes("study") || lower.includes("learn") || lower.includes("курси") || lower.includes("read");

    if (isHealth) {
      fallbackSummary = isUk ? "План відновлення енергії та фізичної форми." : "Physical energy & vitality action plan.";
      fallbackTasks = isUk
        ? [
            {
              title: "Кардіо або прогулянка 45 хв",
              phase: getPhaseFor("health"),
              priority: 1,
              steps: 2,
              stepList: [
                { id: "s-1", title: "Розминка суглобів 5 хв", done: false },
                { id: "s-2", title: "Основний темп у зоні 2", done: false },
              ],
              note: "Тримати пульс у зоні 2",
            },
            {
              title: "Силове тренування на основні групи",
              phase: getPhaseFor("health"),
              priority: 1,
              steps: 3,
              stepList: [
                { id: "s-3", title: "Динамічний розігрів", done: false },
                { id: "s-4", title: "3 базові вправи по 4 підходи", done: false },
                { id: "s-5", title: "Заминка та розтяжка", done: false },
              ],
              note: "Розминка обов'язково",
            },
            {
              title: "Пити 2.5л води та електроліти",
              phase: getPhaseFor("health"),
              priority: 2,
              steps: 3,
              stepList: [
                { id: "s-6", title: "Склянка води вранці", done: false },
                { id: "s-7", title: "Пляшка води під час роботи", done: false },
                { id: "s-8", title: "Ізотонік після тренування", done: false },
              ],
              note: "По склянці щогодини",
            },
          ]
        : [
            {
              title: "45-min Zone-2 cardio or brisk walk",
              phase: getPhaseFor("health"),
              priority: 1,
              steps: 2,
              stepList: [
                { id: "s-1", title: "5 min warmup", done: false },
                { id: "s-2", title: "Sustained Zone 2 pace", done: false },
              ],
              note: "Aerobic recovery zone",
            },
            {
              title: "Full-body functional resistance workout",
              phase: getPhaseFor("health"),
              priority: 1,
              steps: 3,
              stepList: [
                { id: "s-3", title: "Joint mobility warmup", done: false },
                { id: "s-4", title: "3 compound exercises", done: false },
                { id: "s-5", title: "Cooldown & stretch", done: false },
              ],
              note: "Thorough warmup first",
            },
          ];
    } else if (isBuy) {
      fallbackSummary = isUk ? "Список необхідних закупівель." : "Targeted shopping checklist.";
      fallbackTasks = isUk
        ? [
            {
              title: "Замовити базові продукти на тиждень",
              phase: getPhaseFor("buy"),
              priority: 1,
              steps: 2,
              stepList: [
                { id: "s-b1", title: "Ревізія холодильника", done: false },
                { id: "s-b2", title: "Оформлення кошика", done: false },
              ],
              note: "Овочі, білок, крупи",
            },
            {
              title: "Побутові дрібниці та засоби для дому",
              phase: getPhaseFor("buy"),
              priority: 2,
              steps: 2,
              stepList: [
                { id: "s-b3", title: "Список побутової хімії", done: false },
                { id: "s-b4", title: "Замовлення або покупка", done: false },
              ],
              note: "Перевірити запаси",
            },
          ]
        : [
            {
              title: "Weekly whole-foods grocery order",
              phase: getPhaseFor("buy"),
              priority: 1,
              steps: 2,
              stepList: [
                { id: "s-b1", title: "Pantry check", done: false },
                { id: "s-b2", title: "Submit order", done: false },
              ],
              note: "Proteins, greens, grains",
            },
          ];
    } else {
      fallbackSummary = isUk ? `Тактичний план виконання для «${prompt}».` : `Tactical execution sequence for "${prompt}".`;
      fallbackTasks = isUk
        ? [
            {
              title: `Окреслити ключовий результат для «${prompt}»`,
              phase: getPhaseFor("focus"),
              priority: 1,
              steps: 2,
              stepList: [
                { id: "s-g1", title: "Сформулювати кінцевий критерій готовності", done: false },
                { id: "s-g2", title: "Підготувати необхідні матеріали", done: false },
              ],
              note: "Чіткі критерії успіху",
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
              title: `Підбити підсумки та зафіксувати статус`,
              phase: getPhaseFor("focus"),
              priority: 2,
              steps: 1,
              stepList: [
                { id: "s-g6", title: "Перевірити якість та закрити задачу", done: false },
              ],
              note: "Оновити чергу завдань",
            },
          ]
        : [
            {
              title: `Clarify critical deliverable for "${prompt}"`,
              phase: getPhaseFor("focus"),
              priority: 1,
              steps: 2,
              stepList: [
                { id: "s-g1", title: "Define completion criteria", done: false },
                { id: "s-g2", title: "Gather assets", done: false },
              ],
              note: "Define definition of done",
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
              note: "Single-task focus mode",
            },
          ];
    }

    return res.json({
      summary: fallbackSummary,
      insights: fallbackInsights,
      tasks: fallbackTasks,
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
});

// Dedicated Single-Task AI Breakdown into Sub-steps Endpoint
app.post("/api/ai/breakdown-task", async (req, res) => {
  try {
    const rawTask = req.body.task || (req.body.title ? {
      id: req.body.taskId || req.body.id,
      title: req.body.title,
      note: req.body.note,
      priority: req.body.priority,
      steps: req.body.steps,
      phase: req.body.phase,
    } : null);

    const { allTasks = [], tabs = [], lang = "uk", fullAppContext, customApiKey, selectedModel } = req.body;
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
Your mission: Break down a single specific task into 2 to 5 concrete, actionable, sequential sub-steps.
LANGUAGE REQUIREMENT: ${isUk ? "All output (sub-step titles, note, explanation) MUST be in UKRAINIAN." : "All output must be in English."}

Requirements:
1. "stepList": Array of 2 to 5 concise sequential sub-steps. Each title must begin with a number or clear action verb (e.g. ${isUk ? '"1. Підготувати матеріали", "2. Зробити перший прохід", "3. Перевірити результат"' : '"1. Gather assets", "2. Core implementation", "3. Quality review"'}).
2. "steps": Total count of generated sub-steps (equal to stepList.length).
3. "note": Refined concise execution tip (max 6-8 words).
4. "suggestedPriority": Number 1 (urgent), 2 (standard), or 3 (low).
5. "explanation": One short tactical sentence explaining how to execute this task frictionlessly.

Return valid JSON adhering to schema.`;

        const response = await generateGeminiContentWithFallback({
          contents: `TASK TO BREAK DOWN:
- Title: "${task.title}"
- Category: "${task.phase || 'general'}"
- Priority: P${task.priority || 2}
- Current Note: "${task.note || ''}"
- Existing Step Count: ${task.steps || 1}

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
          { id: `s-fb-1-${Date.now()}`, title: `1. Підготувати дані та ресурси для «${tTitle.slice(0, 24)}»`, done: false },
          { id: `s-fb-2-${Date.now()}`, title: `2. Основний робочий блок виконання`, done: false },
          { id: `s-fb-3-${Date.now()}`, title: `3. Фінальна перевірка та закриття результату`, done: false },
        ]
      : [
          { id: `s-fb-1-${Date.now()}`, title: `1. Setup & prerequisites for "${tTitle.slice(0, 24)}"`, done: false },
          { id: `s-fb-2-${Date.now()}`, title: `2. Core execution sprint`, done: false },
          { id: `s-fb-3-${Date.now()}`, title: `3. Verification & final sign-off`, done: false },
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
});

// AI Dashboard Recommendations & Period Productivity Analysis Endpoint
app.post("/api/ai/recommendations", async (req, res) => {
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
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`PS To-Do server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
