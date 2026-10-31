export type SSEEvent = { event: string; data: string };
export async function* readSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<SSEEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', event = 'message', data: string[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let pos: number;
      while ((pos = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, pos).replace(/\r$/, ''); buffer = buffer.slice(pos + 1);
        if (!line) { if (data.length) yield { event, data: data.join('\n') }; event = 'message'; data = []; }
        else if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (done) break;
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
