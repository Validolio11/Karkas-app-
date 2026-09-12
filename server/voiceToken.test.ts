import assert from 'node:assert/strict';
import test from 'node:test';

process.env.KARKAS_SERVER_AUTOSTART = 'false';
const { createVoiceToken } = await import('../server.ts');

test('creates a short-lived single-use token locked to live transcription', async () => {
  const requests: any[] = [];
  const ai = {
    authTokens: {
      create: async (request: any) => {
        requests.push(request);
        return { name: 'auth_tokens/ephemeral-test' };
      },
    },
  };

  const now = Date.parse('2026-09-12T10:00:00.000Z');
  const result = await createVoiceToken(ai as any, now);

  assert.deepEqual(result, {
    token: 'auth_tokens/ephemeral-test',
    model: 'gemini-3.5-transcribe-live',
    config: {
      responseModalities: ['TEXT'],
      inputAudioTranscription: { languageCodes: ['uk-UA', 'en-US'] },
    },
  });
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], {
    config: {
      httpOptions: { apiVersion: 'v1alpha' },
      uses: 1,
      expireTime: '2026-09-12T10:05:00.000Z',
      newSessionExpireTime: '2026-09-12T10:01:00.000Z',
      liveConnectConstraints: {
        model: 'gemini-3.5-transcribe-live',
        config: {
          responseModalities: ['TEXT'],
          inputAudioTranscription: { languageCodes: ['uk-UA', 'en-US'] },
        },
      },
    },
  });
});

test('rejects a provider response without an ephemeral credential', async () => {
  const ai = { authTokens: { create: async () => ({}) } };
  await assert.rejects(() => createVoiceToken(ai as any), /did not return an ephemeral token/);
});
