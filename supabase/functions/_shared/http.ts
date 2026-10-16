/** Small HTTP toolkit: errors, JSON responses, CORS, a router and SSE. */

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message)
  }
}

export const badRequest = (msg: string, details?: Record<string, unknown>) =>
  new HttpError(400, 'bad_request', msg, details)
export const unauthorized = (msg = 'Missing or invalid credentials.') => new HttpError(401, 'unauthorized', msg)
export const forbidden = (msg = 'You do not have access to this.') => new HttpError(403, 'forbidden', msg)
export const notFound = (msg = 'Not found.') => new HttpError(404, 'not_found', msg)
export const tooMany = (msg = 'Too many requests. Please slow down.') => new HttpError(429, 'rate_limited', msg)
export const paymentRequired = (msg: string) => new HttpError(402, 'quota_exceeded', msg)

export function corsHeaders(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin ?? '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key, x-session',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  })
}

export function errorResponse(err: unknown, headers: Record<string, string> = {}): Response {
  if (err instanceof HttpError) {
    return json({ error: { code: err.code, message: err.message, ...(err.details ?? {}) } }, err.status, headers)
  }
  console.error(JSON.stringify({ level: 'error', msg: 'unhandled', error: String(err), stack: (err as Error)?.stack }))
  return json({ error: { code: 'internal', message: 'Something went wrong. Please try again.' } }, 500, headers)
}

/** Parses a JSON body, refusing anything over `maxBytes`. */
export async function readJson<T = Record<string, unknown>>(req: Request, maxBytes = 256_000): Promise<T> {
  const len = Number(req.headers.get('content-length') ?? '0')
  if (len > maxBytes) throw new HttpError(413, 'too_large', 'Request body is too large.')
  const text = await req.text()
  if (text.length > maxBytes) throw new HttpError(413, 'too_large', 'Request body is too large.')
  if (!text) return {} as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw badRequest('Request body must be JSON.')
  }
}

// ── Router ────────────────────────────────────────────────────────────────

export type Params = Record<string, string>
export type Handler = (req: Request, params: Params, url: URL) => Promise<Response> | Response

interface Route {
  method: string
  pattern: RegExp
  keys: string[]
  handler: Handler
}

export class Router {
  private routes: Route[] = []

  /** `path` like "/v1/conversations/:id/messages". */
  on(method: string, path: string, handler: Handler): this {
    const keys: string[] = []
    const pattern = new RegExp(
      '^' +
        path.replace(/\/:([a-zA-Z_]+)/g, (_, k) => {
          keys.push(k)
          return '/([^/]+)'
        }) +
        '/?$',
    )
    this.routes.push({ method, pattern, keys, handler })
    return this
  }

  /** Strips "/functions/v1/<name>" or "/<name>" from the path. */
  static localPath(url: URL, functionName: string): string {
    return (
      url.pathname
        .replace(new RegExp(`^/functions/v1/${functionName}`), '')
        .replace(new RegExp(`^/${functionName}(?=/|$)`), '') || '/'
    )
  }

  match(method: string, path: string): { handler: Handler; params: Params } | 'method' | null {
    let pathMatched = false
    for (const r of this.routes) {
      const m = path.match(r.pattern)
      if (!m) continue
      pathMatched = true
      if (r.method !== method) continue
      const params: Params = {}
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])))
      return { handler: r.handler, params }
    }
    return pathMatched ? 'method' : null
  }
}

// ── Server-sent events ────────────────────────────────────────────────────

export interface SseWriter {
  send(event: string, data: unknown): void
  close(): void
}

export function sseResponse(
  run: (w: SseWriter) => Promise<void>,
  headers: Record<string, string> = {},
): Response {
  const enc = new TextEncoder()
  let closed = false
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const w: SseWriter = {
        send(event, data) {
          if (closed) return
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        },
        close() {
          if (closed) return
          closed = true
          controller.close()
        },
      }
      try {
        await run(w)
      } catch (err) {
        const msg = err instanceof HttpError ? err.message : 'Something went wrong. Please try again.'
        if (!(err instanceof HttpError)) console.error('sse error', err)
        w.send('error', { message: msg, code: err instanceof HttpError ? err.code : 'internal' })
      } finally {
        w.close()
      }
    },
    cancel() {
      closed = true
    },
  })
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      ...headers,
    },
  })
}

/** Reads `event:`/`data:` frames from an SSE response body. */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader()
  let buf = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += value
    let idx: number
    while ((idx = buf.search(/\r?\n\r?\n/)) !== -1) {
      const frame = buf.slice(0, idx)
      buf = buf.slice(idx).replace(/^\r?\n\r?\n/, '')
      let event = 'message'
      const data: string[] = []
      for (const line of frame.split(/\r?\n/)) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
      }
      if (data.length) yield { event, data: data.join('\n') }
    }
  }
}
