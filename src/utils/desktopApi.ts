const routeMap = {
  '/api/ai/verify-key': 'verifyKey',
  '/api/ai/assist': 'assist',
  '/api/ai/breakdown-task': 'breakdown',
  '/api/ai/recommendations': 'recommendations',
  '/api/ai/voice-token': 'voiceToken',
  '/api/ai/transcribe-audio': 'transcribeAudio',
  '/api/check-update': 'checkLatest',
} as const;

function responseFromDesktop(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body ?? null), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** IPC cannot be cancelled, but a closed/timed-out caller must stop awaiting it. */
function awaitDesktop<T>(operation: () => Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (signal?.aborted) return Promise.reject(new DOMException('Request cancelled', 'AbortError'));
  return new Promise<T>((resolve, reject) => {
    const abort = () => { cleanup(); reject(new DOMException('Request cancelled', 'AbortError')); };
    const cleanup = () => signal?.removeEventListener('abort', abort);
    signal?.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => {
      if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
      return operation();
    }).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
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
    return verifyAndStoreDesktopApiKey(typeof body.apiKey === 'string' ? body.apiKey : '', init?.signal);
  }

  const result = await awaitDesktop(() => operation === 'checkLatest'
    ? desktop.updates.checkLatest()
    : operation === 'assist'
      ? desktop.ai.assist(body)
      : operation === 'breakdown'
        ? desktop.ai.breakdown(body)
        : operation === 'voiceToken'
          ? desktop.ai.voiceToken(body)
        : operation === 'transcribeAudio'
          ? desktop.ai.transcribeAudio(body)
          : desktop.ai.recommendations(body), init?.signal);

  if ('error' in result) return responseFromDesktop(503, { code: result.error.code, error: result.error.message });
  return responseFromDesktop(result.value.status, result.value.body);
}

export async function desktopHasAiKey(options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<boolean> {
  const desktop = window.karkasDesktop;
  if (!desktop) return false;
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, options.timeoutMs ?? 5000);
  try {
    const result = await awaitDesktop(() => desktop.ai.hasKey(), controller.signal);
    if (!result.ok) throw new Error('Unable to check stored AI credentials');
    return result.value;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
  }
}

export async function verifyAndStoreDesktopApiKey(apiKey: string, signal?: AbortSignal | null): Promise<Response> {
  const desktop = window.karkasDesktop;
  if (!desktop) {
    return fetch('/api/ai/verify-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey }),
      signal,
    });
  }
  const result = await awaitDesktop(() => desktop.ai.verifyAndStoreKey(apiKey), signal);
  if ('error' in result) return responseFromDesktop(503, { success: false, code: result.error.code, error: result.error.message });
  return responseFromDesktop(200, { success: true, models: result.value.models });
}
