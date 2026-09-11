const routeMap = {
  '/api/ai/verify-key': 'verifyKey',
  '/api/ai/assist': 'assist',
  '/api/ai/breakdown-task': 'breakdown',
  '/api/ai/recommendations': 'recommendations',
  '/api/ai/transcribe-audio': 'transcribeAudio',
  '/api/check-update': 'checkLatest',
} as const;

function responseFromDesktop(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body ?? null), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function karkasApiFetch(input: string, init?: RequestInit): Promise<Response> {
  const desktop = window.karkasDesktop;
  if (!desktop) return fetch(input, init);

  let body: any = {};
  if (typeof init?.body === 'string' && init.body) body = JSON.parse(init.body);
  const operation = routeMap[input as keyof typeof routeMap];
  if (!operation) return responseFromDesktop(404, { error: 'Unknown desktop API route' });

  if (operation === 'verifyKey') {
    return verifyAndStoreDesktopApiKey(typeof body.apiKey === 'string' ? body.apiKey : '');
  }

  const result = operation === 'checkLatest'
    ? await desktop.updates.checkLatest()
    : operation === 'assist'
      ? await desktop.ai.assist(body)
      : operation === 'breakdown'
        ? await desktop.ai.breakdown(body)
        : operation === 'transcribeAudio'
          ? await desktop.ai.transcribeAudio(body)
          : await desktop.ai.recommendations(body);

  if ('error' in result) return responseFromDesktop(503, { code: result.error.code, error: result.error.message });
  return responseFromDesktop(result.value.status, result.value.body);
}

export async function desktopHasAiKey(): Promise<boolean> {
  const result = await window.karkasDesktop?.ai.hasKey();
  return result?.ok ? result.value : false;
}

export async function verifyAndStoreDesktopApiKey(apiKey: string): Promise<Response> {
  const desktop = window.karkasDesktop;
  if (!desktop) {
    return fetch('/api/ai/verify-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey }),
    });
  }
  const result = await desktop.ai.verifyAndStoreKey(apiKey);
  if ('error' in result) return responseFromDesktop(503, { code: result.error.code, error: result.error.message });
  return responseFromDesktop(200, { success: true, models: result.value.models });
}
