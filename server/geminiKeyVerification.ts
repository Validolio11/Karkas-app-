export type KeyVerificationCode =
  | 'MISSING_API_KEY' | 'INVALID_API_KEY' | 'ACCESS_DENIED'
  | 'QUOTA_EXCEEDED' | 'NETWORK_ERROR' | 'TIMEOUT' | 'NO_MODELS' | 'PROVIDER_ERROR';

type VerificationFailure = { success: false; code: KeyVerificationCode; error: string };
type VerificationResult = { status: number; body: { success: true; models: string[] } | VerificationFailure };

const failures: Record<KeyVerificationCode, { status: number; error: string }> = {
  MISSING_API_KEY: { status: 400, error: 'Enter a Gemini API key.' },
  INVALID_API_KEY: { status: 401, error: 'Google rejected this API key. Enter a valid Gemini API key.' },
  ACCESS_DENIED: { status: 403, error: 'This key does not have access to the Gemini API. Check its project permissions and restrictions.' },
  QUOTA_EXCEEDED: { status: 429, error: 'Google has temporarily limited requests. Check the project quota or try again later.' },
  NETWORK_ERROR: { status: 503, error: 'Could not connect to Google. Check your connection and try again.' },
  TIMEOUT: { status: 504, error: 'Google did not respond in time. Try again.' },
  NO_MODELS: { status: 422, error: 'The key was accepted, but no compatible chat models were listed.' },
  PROVIDER_ERROR: { status: 502, error: 'Google could not complete key verification. Try again later.' },
};

function fail(code: KeyVerificationCode): VerificationResult {
  return { status: failures[code].status, body: { success: false, code, error: failures[code].error } };
}

function providerFailure(status: number, data: any): VerificationResult {
  const error = data?.error;
  const reasons = Array.isArray(error?.details) ? error.details.map((detail: any) => detail?.reason) : [];
  if (status === 401 || error?.status === 'UNAUTHENTICATED' ||
      reasons.some((reason: unknown) => ['API_KEY_INVALID', 'API_KEY_EXPIRED', 'API_KEY_NOT_FOUND'].includes(String(reason)))) {
    return fail('INVALID_API_KEY');
  }
  // Older Google responses sometimes omit structured ErrorInfo.
  if (status === 400 && /api key (not valid|is invalid|expired)/i.test(String(error?.message || ''))) {
    return fail('INVALID_API_KEY');
  }
  if (status === 429 || error?.status === 'RESOURCE_EXHAUSTED') return fail('QUOTA_EXCEEDED');
  if (status === 403 || error?.status === 'PERMISSION_DENIED') return fail('ACCESS_DENIED');
  return fail('PROVIDER_ERROR');
}

/** Checks credentials with models.list; verification never spends generation quota. */
export async function verifyGeminiKey(
  input: unknown,
  { fetchImpl = fetch, timeoutMs = 12_000 }: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<VerificationResult> {
  if (typeof input !== 'string' || !input.trim()) return fail('MISSING_API_KEY');
  const apiKey = input.trim();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<VerificationResult>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(fail('TIMEOUT'));
    }, timeoutMs);
  });

  const listModels = async (): Promise<VerificationResult> => {
    const models = new Set<string>();
    const seenTokens = new Set<string>();
    let pageToken = '';
    for (let page = 0; page < 10; page += 1) {
      if (controller.signal.aborted) return fail('TIMEOUT');
      const url = new URL('https://generativelanguage.googleapis.com/v1beta/models');
      url.searchParams.set('pageSize', '1000');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const response = await fetchImpl(url.toString(), {
        headers: { 'x-goog-api-key': apiKey, 'User-Agent': 'aistudio-build' },
        signal: controller.signal,
      });
      let data: any;
      try {
        data = await response.json();
      } catch {
        if (controller.signal.aborted) return fail('TIMEOUT');
        return response.ok ? fail('PROVIDER_ERROR') : providerFailure(response.status, null);
      }
      if (!response.ok) return providerFailure(response.status, data);
      if (!data || typeof data !== 'object' || Array.isArray(data) ||
          (data.models !== undefined && !Array.isArray(data.models))) return fail('PROVIDER_ERROR');
      for (const model of data.models || []) {
        const name = typeof model?.name === 'string' ? model.name.replace(/^models\//, '') : '';
        const methods = Array.isArray(model?.supportedGenerationMethods)
          ? model.supportedGenerationMethods
          : Array.isArray(model?.supportedActions) ? model.supportedActions : [];
        if (/^gemini-[a-z0-9.-]+$/i.test(name) &&
            !/(embedding|image|tts|transcrib|robotics|computer-use)/i.test(name) &&
            methods.includes('generateContent')) models.add(name);
      }
      if (!data.nextPageToken) {
        return models.size ? { status: 200, body: { success: true, models: [...models] } } : fail('NO_MODELS');
      }
      if (typeof data.nextPageToken !== 'string' || seenTokens.has(data.nextPageToken)) return fail('PROVIDER_ERROR');
      pageToken = data.nextPageToken;
      seenTokens.add(pageToken);
    }
    return fail('PROVIDER_ERROR');
  };

  try {
    return await Promise.race([listModels(), deadline]);
  } catch {
    return fail(controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR');
  } finally {
    clearTimeout(timer!);
  }
}
