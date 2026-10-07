import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { after, before, test } from "node:test";

let child: ChildProcess;
let baseUrl: string;

before(async () => {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((done) => reservation.close(() => done()));
  baseUrl = `http://127.0.0.1:${port}`;

  // Replace the SDK before loading the real server. No request can reach Google.
  const sdkSource = `
    export const Type = new Proxy({}, { get: (_, key) => key });
    export const Modality = new Proxy({}, { get: (_, key) => key });
    export class GoogleGenAI {
      models = { generateContent: async ({ config, contents }) => {
        const properties = config.responseSchema.properties;
        let result;
        if (properties.tasks) {
          const marker = 'WORKSPACE REAL-TIME CONTEXT:';
          const context = JSON.parse(contents.slice(contents.indexOf(marker) + marker.length));
          result = { summary: { invalid: true }, insights: {}, tasks: [null,
            { title: 'Valid task', phase: 'missing', priority: 99, steps: 1000000000,
              stepList: [null, {}, ''], note: context.activeTasks[0].subSteps.map(step => typeof step === 'string' ? step : step.title).join('|') }] };
        } else if (properties.stepList) {
          result = { steps: 999999, stepList: [null, 'First action', {}, { title: 'Second action' }],
            suggestedPriority: 99, note: {}, explanation: [] };
        } else {
          result = { productivityGrade: 'S', suggestedTasks: [null,
            { title: 'Useful next step', phase: 'missing', steps: 2.5, priority: 99, note: {} }] };
        }
        return { text: JSON.stringify(result) };
      }};
    }
  `;
  const hookSource = `
    import { registerHooks } from 'node:module';
    registerHooks({
      resolve(specifier, context, next) {
        return specifier === '@google/genai' ? { url: 'mock:gemini', shortCircuit: true } : next(specifier, context);
      },
      load(url, context, next) {
        return url === 'mock:gemini' ? { format: 'module', source: ${JSON.stringify(sdkSource)}, shortCircuit: true } : next(url, context);
      }
    });
  `;
  child = spawn(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(hookSource)}`,
    "--import", "tsx", "--input-type=module", "--eval",
    "const {startServer}=await import('./server.ts'); await startServer({port:Number(process.env.PORT),host:'127.0.0.1'}); console.log('server running');"], {
    cwd: process.cwd(), env: { ...process.env, PORT: String(port), NODE_ENV: "production", GEMINI_API_KEY: "test-only-mocked-key", KARKAS_SERVER_AUTOSTART: "false" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((done, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`Mock server did not start: ${output}`)), 30_000);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`Mock server exited ${code}: ${output}`)); });
    child.stderr?.on("data", (chunk) => { output += chunk; });
    child.stdout?.on("data", (chunk) => {
      output += chunk;
      if (output.includes("server running")) { clearTimeout(timer); done(); }
    });
  });
});

after(async () => {
  if (child && child.exitCode === null) {
    const exited = once(child, "exit");
    child.kill();
    await exited;
  }
});

async function post(route: string, body: unknown) {
  const response = await fetch(`${baseUrl}/api/ai/${route}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  assert.equal(response.status, 200);
  return response.json();
}

test("AI assistance preserves string substeps and bounds malformed model output", async () => {
  const data = await post("assist", {
    prompt: "Plan", tabs: ["custom"], fullAppContext: { activeTasks: [{ title: "Existing", stepList: ["Draft", { title: "Review" }] }] },
  });
  assert.equal(data.source, "gemini");
  assert.equal(data.tasks.length, 1);
  assert.equal(data.tasks[0].note, "Draft|Review");
  assert.equal(data.tasks[0].phase, "custom");
  assert.equal(data.tasks[0].priority, 2);
  assert.equal(data.tasks[0].steps, 50);
  assert.equal(data.tasks[0].stepList.length, 50);
  assert.equal(typeof data.summary, "string");
  assert.deepEqual(data.insights, []);
});

test("AI breakdown derives the count from valid steps and normalizes scalar fields", async () => {
  const data = await post("breakdown-task", { task: { id: "x", title: "Draft", priority: 1 }, lang: "en" });
  assert.equal(data.source, "gemini");
  assert.equal(data.steps, 2);
  assert.deepEqual(data.stepList.map((step: any) => step.title), ["First action", "Second action"]);
  assert.equal(data.suggestedPriority, 1);
  assert.equal(typeof data.note, "string");
  assert.equal(typeof data.explanation, "string");
});

test("AI recommendations cannot override the computed grade or insert invalid task fields", async () => {
  const data = await post("recommendations", { tabs: ["custom"], periodMetrics: { totalCompleted: 0, successRate: 0 } });
  assert.equal(data.source, "gemini");
  assert.equal(data.productivityGrade, "C");
  assert.equal(data.suggestedTasks.length, 1);
  assert.equal(data.suggestedTasks[0].phase, "custom");
  assert.equal(data.suggestedTasks[0].steps, 2);
  assert.equal(data.suggestedTasks[0].priority, 2);
  assert.equal(data.suggestedTasks[0].note, "");
});
