import assert from 'node:assert/strict';
import test from 'node:test';
import { karkasApiFetch, desktopHasAiKey } from './desktopApi.ts';
import { verifyApiKey } from './verifyApiKey.ts';

const installWindow = (desktop: unknown) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { karkasDesktop: desktop } });
  return () => {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  };
};

test('desktop sends selected model and request through the bridge and preserves provider errors', async () => {
  const restore = installWindow({ ai: { assist: async (input: unknown) => {
    assert.deepEqual(input, { prompt: 'Plan my work', selectedModel: 'gemini-selected' });
    return { ok: true, value: { status: 429, body: { success: false, code: 'QUOTA_EXCEEDED' } } };
  } } });
  try {
    const response = await karkasApiFetch('/api/ai/assist', { body: JSON.stringify({ prompt: 'Plan my work', selectedModel: 'gemini-selected' }) });
    assert.equal(response.status, 429);
    assert.equal((await response.json()).code, 'QUOTA_EXCEEDED');
  } finally { restore(); }
});

test('already cancelled desktop request never starts an IPC operation', async () => {
  let calls = 0;
  const restore = installWindow({ ai: { assist: async () => { calls++; return { ok: true }; } } });
  try {
    const controller = new AbortController(); controller.abort();
    await assert.rejects(karkasApiFetch('/api/ai/assist', { signal: controller.signal }), { name: 'AbortError' });
    assert.equal(calls, 0);
  } finally { restore(); }
});

test('cancelling stalled desktop IPC frees the caller and ignores late success or rejection', async () => {
  for (const lateFailure of [false, true]) {
    let resolveOperation!: (value: unknown) => void, rejectOperation!: (reason: unknown) => void;
    const restore = installWindow({ ai: { assist: () => new Promise((resolve, reject) => { resolveOperation = resolve; rejectOperation = reject; }) } });
    try {
      const controller = new AbortController();
      const pending = karkasApiFetch('/api/ai/assist', { signal: controller.signal });
      await Promise.resolve(); controller.abort();
      await assert.rejects(pending, { name: 'AbortError' });
      if (lateFailure) rejectOperation(new Error('Late failure'));
      else resolveOperation({ ok: true, value: { status: 200, body: { reply: 'Late reply' } } });
      await new Promise(resolve => setImmediate(resolve));
    } finally { restore(); }
  }
});

test('desktop verification retains quota and access errors instead of mislabelling the key', async () => {
  for (const code of ['QUOTA_EXCEEDED', 'ACCESS_DENIED', 'INVALID_API_KEY']) {
    const restore = installWindow({ ai: { verifyAndStoreKey: async () => ({ ok: false, error: { code, message: 'Safe explanation' } }) } });
    try { await assert.rejects(verifyApiKey('synthetic-key'), { code }); }
    finally { restore(); }
  }
});

test('verification timeout also works when the desktop IPC never settles', async () => {
  const restore = installWindow({ ai: { verifyAndStoreKey: () => new Promise(() => {}) } });
  try { await assert.rejects(verifyApiKey('synthetic-key', { timeoutMs: 5 }), { code: 'TIMEOUT' }); }
  finally { restore(); }
});

test('a stalled credential check cannot leave the send button waiting forever', async () => {
  const restore = installWindow({ ai: { hasKey: () => new Promise(() => {}) } });
  try { await assert.rejects(desktopHasAiKey({ timeoutMs: 5 }), { name: 'AbortError' }); }
  finally { restore(); }
});

test('credential-check failure is not misreported as a missing key', async () => {
  const restore = installWindow({ ai: { hasKey: async () => ({ ok:false, error:{code:'DESKTOP_ERROR'} }) } });
  try { await assert.rejects(desktopHasAiKey(), /Unable to check/); }
  finally { restore(); }
});
