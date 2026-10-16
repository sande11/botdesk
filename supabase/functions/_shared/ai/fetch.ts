import { ProviderError } from './types.ts'

const RETRY_STATUS = new Set([408, 409, 429, 500, 502, 503, 504, 529])

/**
 * POSTs JSON to a model provider. Retries rate limits and server errors
 * (twice, honouring Retry-After), and turns failures into ProviderError.
 */
export async function postJson(
  provider: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  opts: { signal?: AbortSignal; timeoutMs?: number; retries?: number } = {},
): Promise<Response> {
  const retries = opts.retries ?? 2
  let attempt = 0
  while (true) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 120_000)
    const onAbort = () => ctrl.abort()
    opts.signal?.addEventListener('abort', onAbort)
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      })
    } catch (err) {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      if (attempt < retries && !opts.signal?.aborted) {
        attempt++
        await sleep(500 * 2 ** attempt)
        continue
      }
      throw new ProviderError(provider, 0, `Could not reach ${provider}: ${(err as Error).message}`, true)
    }
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onAbort)
    if (res.ok) return res

    const text = await res.text().catch(() => '')
    if (RETRY_STATUS.has(res.status) && attempt < retries) {
      attempt++
      const after = Number(res.headers.get('retry-after'))
      await sleep(Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 20_000) : 800 * 2 ** attempt)
      continue
    }
    throw new ProviderError(provider, res.status, describe(provider, res.status, text), RETRY_STATUS.has(res.status))
  }
}

function describe(provider: string, status: number, body: string): string {
  let detail = body.slice(0, 300)
  try {
    const j = JSON.parse(body)
    detail = j?.error?.message ?? j?.message ?? j?.detail ?? detail
  } catch {
    // keep raw text
  }
  if (status === 401 || status === 403) return `${provider} rejected the API key (${status}). Check the key in Settings → Models.`
  if (status === 404) return `${provider} does not know this model (${status}): ${detail}`
  if (status === 429) return `${provider} rate limit reached. Try again shortly.`
  return `${provider} error ${status}: ${detail}`
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
