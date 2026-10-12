/**
 * Server-Sent Events transport for streamed AI chat replies.
 *
 * Events (each a single `data:` JSON line):
 * - `delta` {text}: the next piece of the reply, for live display only;
 * - `done` {...}: exactly the JSON body the non-streaming endpoint returns. Its
 *   `reply` is authoritative and replaces the streamed text (response guards run
 *   on the final text and may change it);
 * - `error` {status, code, error, ...}: the body sendAIRequestFailure produces.
 * Every request with `stream: true` ends with exactly one `done` or `error`
 * event, including canned local replies and routes that never stream.
 */
export function sseFrame(event: 'delta' | 'done' | 'error', data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export interface AssistStreamSink {
  /** Emit a reply fragment. A no-op after the final event or a closed connection. */
  delta(text: string): void;
  /** Use instead of the raw response: status().json() becomes the final event. */
  response: any;
}

/**
 * Wrap a response for streaming. The in-process desktop bridge receives deltas
 * through its callback and the final body through its normal response object;
 * an HTTP response receives SSE. Returns null when the target cannot stream.
 */
export function createAssistEventStream(res: any): AssistStreamSink | null {
  if (typeof res?.karkasStreamDelta === 'function') {
    return { delta: text => { if (text) res.karkasStreamDelta(text); }, response: res };
  }
  if (typeof res?.write !== 'function' || typeof res?.setHeader !== 'function') return null;
  let status = 200;
  let opened = false;
  let finished = false;
  const closed = () => finished || res.writableEnded || res.destroyed;
  const write = (event: 'delta' | 'done' | 'error', data: unknown) => {
    if (closed()) return;
    if (!opened) {
      opened = true;
      // The HTTP status is always 200 once streaming; failures travel as `error` events.
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();
    }
    res.write(sseFrame(event, data));
  };
  const response = {
    status(code: number) { status = code; return response; },
    json(body: any) {
      const failed = status >= 400;
      write(failed ? 'error' : 'done', failed ? { status, ...(body && typeof body === 'object' ? body : { error: String(body) }) } : body);
      finished = true;
      if (!res.writableEnded) res.end();
      return response;
    },
    get writableEnded() { return Boolean(finished || res.writableEnded); },
  };
  return { delta: text => { if (text) write('delta', { text }); }, response };
}
