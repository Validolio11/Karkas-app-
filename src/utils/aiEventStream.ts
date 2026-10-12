/** Incremental parser for the chat endpoint's Server-Sent Events (see server/chatEventStream.ts). */
export interface AIStreamEvent { event: string; data: any }

export function createSSEParser(onEvent: (event: AIStreamEvent) => void) {
  let buffer = '';
  let pendingCR = false;
  const dispatch = (block: string) => {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      const separator = line.indexOf(':');
      const field = separator === -1 ? line : line.slice(0, separator);
      const value = separator === -1 ? '' : line.slice(separator + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    if (!data.length) return;
    let parsed: unknown;
    try { parsed = JSON.parse(data.join('\n')); } catch { return; }
    onEvent({ event, data: parsed });
  };
  return {
    push(text: string) {
      // A CR may be the first half of a CRLF split across reads; normalize it later.
      const raw = (pendingCR ? '\r' : '') + text;
      pendingCR = raw.endsWith('\r');
      buffer += (pendingCR ? raw.slice(0, -1) : raw).replace(/\r\n?/g, '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        dispatch(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');
      }
    },
    end() { if (buffer.trim()) dispatch(buffer); buffer = ''; pendingCR = false; },
  };
}

const jsonResponse = (status: number, body: unknown) => new Response(JSON.stringify(body ?? null), {
  status, headers: { 'Content-Type': 'application/json' },
});

/**
 * Consume a streamed chat response. Deltas go to onDelta; the final `done` or
 * `error` event is returned as an ordinary JSON Response so callers handle it
 * exactly like the non-streaming endpoint. A stream that ends without a final
 * event is a broken response.
 */
export async function readAIEventStream(body: ReadableStream<Uint8Array>, onDelta: (text: string) => void): Promise<Response> {
  let final: Response | null = null;
  const parser = createSSEParser(({ event, data }) => {
    if (final) return;
    if (event === 'delta' && typeof data?.text === 'string') onDelta(data.text);
    else if (event === 'done') final = jsonResponse(200, data);
    else if (event === 'error') {
      const status = Number.isInteger(data?.status) && data.status >= 400 && data.status < 600 ? data.status : 502;
      const { status: _status, ...rest } = data && typeof data === 'object' ? data : {};
      final = jsonResponse(status, rest);
    }
  });
  const reader = body.getReader();
  const decoder = new TextDecoder();
  try {
    while (!final) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    if (!final) { parser.push(decoder.decode()); parser.end(); }
  } finally {
    if (final) void reader.cancel().catch(() => {});
    else reader.releaseLock();
  }
  if (!final) throw new TypeError('AI stream ended without a final event');
  return final;
}
