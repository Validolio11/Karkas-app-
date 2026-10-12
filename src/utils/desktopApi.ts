import { readAIEventStream } from './aiEventStream';

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

/** Stop waiting immediately and notify a cancellable native operation when available. */
function awaitDesktop<T>(operation: () => Promise<T>, signal?: AbortSignal | null, cancelOperation?: () => void): Promise<T> {
  if (signal?.aborted) return Promise.reject(new DOMException('Request cancelled', 'AbortError'));
  return new Promise<T>((resolve, reject) => {
    const abort = () => { cancelOperation?.(); cleanup(); reject(new DOMException('Request cancelled', 'AbortError')); };
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

  if (operation === 'transcribeAudio' || operation === 'assist') {
    const requestId = crypto.randomUUID();
    const result = await awaitDesktop(() => desktop.ai[operation]({ ...body, desktopRequestId: requestId }), init?.signal,
      () => { if (typeof desktop.ai.cancelRequest === 'function') void desktop.ai.cancelRequest(requestId).catch(() => {}); });
    if ('error' in result) return responseFromDesktop(503, { code: result.error.code, error: result.error.message });
    return responseFromDesktop(result.value.status, result.value.body);
  }

  const result = await awaitDesktop(() => operation === 'checkLatest'
    ? desktop.updates.checkLatest()
    : operation === 'breakdown'
        ? desktop.ai.breakdown(body)
        : operation === 'voiceToken'
          ? desktop.ai.voiceToken(body)
        : desktop.ai.recommendations(body), init?.signal);

  if ('error' in result) return responseFromDesktop(503, { code: result.error.code, error: result.error.message });
  return responseFromDesktop(result.value.status, result.value.body);
}

/**
 * Streamed chat request. Reply fragments go to onDelta as they arrive; the result
 * is an ordinary JSON Response holding the final body (the same body the
 * non-streaming request returns, whose reply replaces the streamed text) or the
 * error body. The request body must already contain `stream: true`.
 */
export async function karkasApiStream(input: '/api/ai/assist', init: RequestInit, onDelta: (text: string) => void): Promise<Response> {
  const desktop = window.karkasDesktop;
  const signal = init.signal;
  const deliver = (text: string) => { if (!signal?.aborted && text) onDelta(text); };
  if (!desktop) {
    const response = await fetch(input, init);
    if (!response.body || !/text\/event-stream/i.test(response.headers.get('Content-Type') || '')) return response;
    return readAIEventStream(response.body, deliver);
  }
  // Older desktop bridges cannot stream; they still return the final body.
  if (typeof desktop.ai.assistStream !== 'function' || typeof desktop.ai.onStreamDelta !== 'function') return karkasApiFetch(input, init);
  const body = typeof init.body === 'string' && init.body ? JSON.parse(init.body) : {};
  const requestId = crypto.randomUUID();
  const unsubscribe = desktop.ai.onStreamDelta(event => {
    if (event && event.requestId === requestId && typeof event.text === 'string') deliver(event.text);
  });
  try {
    const result = await awaitDesktop(() => desktop.ai.assistStream!({ ...body, desktopRequestId: requestId }), signal,
      () => { if (typeof desktop.ai.cancelRequest === 'function') void desktop.ai.cancelRequest(requestId).catch(() => {}); });
    if ('error' in result) return responseFromDesktop(503, { code: result.error.code, error: result.error.message });
    return responseFromDesktop(result.value.status, result.value.body);
  } finally {
    unsubscribe();
  }
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
