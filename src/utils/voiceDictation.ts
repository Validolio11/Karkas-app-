import { GoogleGenAI, type Session, type LiveConnectConfig } from '@google/genai';
import { karkasApiFetch } from './desktopApi';

export type VoicePhase = 'starting' | 'connecting' | 'listening' | 'recording' | 'finishing' | 'idle';
type Callbacks = {
  lang: string;
  onPhase: (phase: VoicePhase) => void;
  onLevel: (level: number) => void;
  onText: (text: string) => void;
  onError: (message: string) => void;
};

export function encodePcm(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((value, i) => {
    const sample = Math.max(-1, Math.min(1, value));
    view.setInt16(i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  });
  return btoa(String.fromCharCode(...bytes));
}

/** One microphone acquisition, with a full recording retained if streaming fails. */
export function createVoiceDictation(callbacks: Callbacks) {
  let disposed = false;
  let stopping = false;
  let failed = false;
  let completed = false;
  let endSent = false;
  let session: Session | undefined;
  let stream: MediaStream | undefined;
  let context: AudioContext | undefined;
  let recorder: MediaRecorder | undefined;
  let analyser: AnalyserNode | undefined;
  let worklet: AudioWorkletNode | undefined;
  let meter = 0;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let stopTimer: ReturnType<typeof setTimeout> | undefined;
  let limit: ReturnType<typeof setTimeout> | undefined;
  let flushed: (() => void) | undefined;
  const abort = new AbortController();
  const chunks: Blob[] = [];
  const pending: string[] = [];
  let finalized = '';
  let interim = '';
  let recordingDone: Promise<Blob> = Promise.resolve(new Blob());
  const text = (value: string) => { if (!disposed) callbacks.onText(value); };
  const phase = (value: VoicePhase) => { if (!disposed) callbacks.onPhase(value); };

  function closeLive() {
    clearTimeout(deadline);
    pending.length = 0;
    const active = session;
    session = undefined;
    active?.close();
  }
  function releaseMicrophone() {
    cancelAnimationFrame(meter);
    worklet?.disconnect();
    if (recorder?.state === 'recording') recorder.stop();
    stream?.getTracks().forEach(track => track.stop());
    void context?.close().catch(() => {});
    callbacks.onLevel(0);
  }
  function cleanup() {
    clearTimeout(stopTimer);
    clearTimeout(limit);
    abort.abort();
    closeLive();
    releaseMicrophone();
  }
  async function finish(useFallback: boolean) {
    if (completed || disposed) return;
    completed = true;
    clearTimeout(stopTimer);
    closeLive();
    try {
      if (useFallback) {
        phase('finishing');
        const blob = await recordingDone;
        if (disposed) return;
        if (blob.size <= 200) throw new Error(callbacks.lang === 'uk' ? 'Запис занадто короткий.' : 'Recording too short.');
        const bytes = new Uint8Array(await blob.arrayBuffer());
        // Avoid spreading an entire recording onto the JS call stack.
        let binary = '';
        for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        const response = await karkasApiFetch('/api/ai/transcribe-audio', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: abort.signal,
          body: JSON.stringify({ audioBase64: btoa(binary), mimeType: blob.type, lang: callbacks.lang,
            customApiKey: localStorage.getItem('karkas_custom_api_key') || undefined }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Transcription failed');
        if (!result.text?.trim()) throw new Error(callbacks.lang === 'uk' ? 'Мовлення не виявлено. Спробуйте ще раз.' : 'No speech detected. Please try again.');
        text(result.text.trim());
      } else {
        text(finalized.trim());
      }
    } catch (error) {
      if (!disposed) callbacks.onError(error instanceof Error ? error.message : 'Transcription failed');
    } finally {
      cleanup();
      if (!disposed) phase('idle');
    }
  }
  function fallback() {
    if (failed || completed || disposed) return;
    failed = true;
    closeLive();
    if (stopping) void finish(true);
    else if (recorder) phase('recording');
  }
  async function stop() {
    if (stopping || disposed || completed) return;
    stopping = true;
    clearTimeout(limit);
    phase('finishing');
    // Drain the worklet's last partial packet before ending the server stream.
    if (worklet && session && !failed) {
      await new Promise<void>(resolve => {
        const timeout = setTimeout(resolve, 200);
        flushed = () => { clearTimeout(timeout); resolve(); };
        worklet!.port.postMessage('flush');
      });
      flushed = undefined;
    }
    releaseMicrophone();
    if (disposed || completed) return;
    if (!session || failed) {
      void finish(true);
      return;
    }
    try {
      session.sendRealtimeInput({ audioStreamEnd: true });
      endSent = true;
      stopTimer = setTimeout(() => void finish(true), 4000);
    } catch { void finish(true); }
  }
  async function start() {
    phase('starting');
    // Request token and microphone concurrently. Always settle token errors locally.
    const tokenRequest = karkasApiFetch('/api/ai/voice-token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: abort.signal,
      body: JSON.stringify({ lang: callbacks.lang, customApiKey: localStorage.getItem('karkas_custom_api_key') || undefined }),
    }).then(async response => {
      if (!response.ok) throw new Error('Live transcription unavailable');
      return response.json() as Promise<{ token: string; model: string; config: LiveConnectConfig }>;
    }).catch(() => null);
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: {
        channelCount: 1, sampleRate: 16000, echoCancellation: true,
        noiseSuppression: true, autoGainControl: true,
      } });
      if (disposed || stopping) { stream.getTracks().forEach(track => track.stop()); return; }
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
      recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 32000 });
      recordingDone = new Promise(resolve => {
        recorder!.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
        recorder!.onstop = () => resolve(new Blob(chunks, { type: recorder!.mimeType || 'audio/webm' }));
      });
      recorder.onerror = () => { callbacks.onError(callbacks.lang === 'uk' ? 'Помилка запису мікрофона.' : 'Microphone recording failed.'); stop(); };
      recorder.start(250);
      phase('connecting');
      limit = setTimeout(stop, 5 * 60 * 1000);
      deadline = setTimeout(fallback, 8000);

      try {
        context = new AudioContext({ sampleRate: 16000 });
        await context.resume();
        if (disposed || stopping) return;
        const source = context.createMediaStreamSource(stream);
        analyser = context.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        const values = new Float32Array(analyser.fftSize);
        let lastMeter = 0;
        const measure = (now: number) => {
          if (disposed || stopping) return;
          if (now - lastMeter > 60) {
            analyser!.getFloatTimeDomainData(values);
            callbacks.onLevel(Math.min(1, Math.sqrt(values.reduce((sum, v) => sum + v * v, 0) / values.length) * 5));
            lastMeter = now;
          }
          meter = requestAnimationFrame(measure);
        };
        meter = requestAnimationFrame(measure);
        await context.audioWorklet.addModule(new URL('voice-capture.js', document.baseURI).href);
        if (disposed || stopping || failed) return;
        worklet = new AudioWorkletNode(context, 'voice-capture');
        const mute = context.createGain();
        mute.gain.value = 0;
        source.connect(worklet).connect(mute).connect(context.destination);
        const mime = `audio/pcm;rate=${context.sampleRate}`;
        worklet.port.onmessage = (event: MessageEvent<{ samples: Float32Array; flushed: boolean }>) => {
          if (disposed || failed) { flushed?.(); return; }
          if (stopping && !flushed) return;
          const data = encodePcm(event.data.samples);
          if (session) {
            try { session.sendRealtimeInput({ audio: { data, mimeType: mime } }); } catch { fallback(); }
          } else if (pending.length < 80) pending.push(data);
          else fallback(); // Retain the full recording instead of dropping the start.
          if (event.data.flushed) flushed?.();
        };
        const credentials = await tokenRequest;
        if (disposed || stopping || failed) return;
        if (!credentials) { fallback(); return; }
        const ai = new GoogleGenAI({ apiKey: credentials.token, httpOptions: { apiVersion: 'v1alpha' } });
        const connected = await ai.live.connect({
          model: credentials.model, config: credentials.config,
          callbacks: {
            onmessage: message => {
              if (disposed || failed || completed) return;
              const content = message.serverContent;
              if (content?.inputTranscription?.text) {
                const segment = content.inputTranscription.text;
                finalized += finalized && !/\s$/.test(finalized) && !/^[\s.,!?;:]/.test(segment) ? ` ${segment}` : segment;
                interim = '';
                text(finalized.trim());
              }
              if (content?.interimInputTranscription?.text) {
                interim = content.interimInputTranscription.text;
                text(`${finalized} ${interim}`.trim());
              }
              if (endSent && (content?.turnComplete || content?.inputTranscription?.finished)) void finish(!finalized.trim() || !!interim);
            },
            onerror: () => fallback(),
            onclose: () => { if (!completed && !disposed) fallback(); },
          },
        });
        if (disposed || stopping || failed) { connected.close(); return; }
        session = connected;
        clearTimeout(deadline);
        for (const data of pending) session.sendRealtimeInput({ audio: { data, mimeType: mime } });
        pending.length = 0;
        phase('listening');
      } catch { fallback(); }
    } catch (error) {
      if (!disposed) callbacks.onError(callbacks.lang === 'uk'
        ? 'Не вдалося запустити мікрофон. Перевірте дозвіл і вибраний пристрій.'
        : 'Could not start microphone. Check permission and the selected device.');
      completed = true;
      cleanup();
      phase('idle');
    }
  }
  return {
    start,
    stop,
    cancel() { disposed = true; cleanup(); },
  };
}
