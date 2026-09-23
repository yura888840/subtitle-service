import { dispatch } from '../../../src/durable/api';
import { migrate } from '../../../src/durable/store';
let ready: Promise<void> | undefined;
export async function ensureSchema() {
  if (!ready) ready = migrate().catch(error => { ready = undefined; throw error; });
  await ready;
}
export async function handle(request: Request) {
  const pathname = new URL(request.url).pathname;
  try {
    // Apply bodies are bounded while streaming, including chunked requests without Content-Length.
    const limit = Number(process.env.MAX_SRT_SIZE_KB || 2048) * 1024;
    let body: unknown = {};
    let bytes: Uint8Array<ArrayBufferLike>[] = [];
    if (request.method === 'POST' && request.body) {
      const reader = request.body.getReader(); let size = 0;
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.length;
        if (size > limit) { await reader.cancel(); return Response.json({ error: 'Request body too large.' }, { status: 413 }); }
        bytes.push(chunk.value);
      }
      const raw = Buffer.concat(bytes); bytes = [];
      if (raw.length) { try { body = JSON.parse(raw.toString()); } catch { return Response.json({ error: 'Invalid JSON.' }, { status: 400 }); } }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ error: 'Expected a JSON object.' }, { status: 400 });
    }
    if (!process.env.DATABASE_URL) {
      // Compatibility only for the original backend-only mode and its regression suite.
      const upstream = await fetch(new URL(pathname, process.env.MEDIA_API_URL || 'http://127.0.0.1:3000'), {
        method: request.method, headers: { 'Content-Type': 'application/json', Cookie: request.headers.get('cookie') || '', 'X-Forwarded-For': request.headers.get('x-real-ip') || '' },
        ...(request.method === 'POST' ? { body: JSON.stringify(body) } : {}), cache: 'no-store', signal: AbortSignal.timeout(10000),
      });
      const headers = new Headers({ 'Cache-Control': 'no-store' });
      for (const key of ['content-type', 'set-cookie']) { const value = upstream.headers.get(key); if (value) headers.set(key, value); }
      return new Response(upstream.body, { status: upstream.status, headers });
    }
    await ensureSchema();
    const result = await dispatch(request.method, pathname, { body, ip: request.headers.get('x-real-ip') || 'unknown', cookie: request.headers.get('cookie') || '' });
    return typeof result.body === 'string' ? new Response(result.body, { status: result.status, headers: result.headers }) : Response.json(result.body, { status: result.status, headers: result.headers });
  } catch (error) {
    const e = error as Error & { status?: number };
    return Response.json({ error: e.status ? e.message : 'Service temporarily unavailable.' }, { status: e.status || 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
