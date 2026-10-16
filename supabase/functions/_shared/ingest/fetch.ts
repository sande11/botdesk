/**
 * Fetches a web page or file for indexing, refusing private and internal
 * addresses (so a URL source can't be used to probe the server's network),
 * following at most 5 redirects and reading at most `maxBytes`.
 */
import { PermanentError } from '../jobs.ts'

export interface Fetched {
  url: string
  status: number
  contentType: string
  bytes: Uint8Array
}

const BLOCKED_HOSTS = /^(localhost|.*\.localhost|.*\.local|.*\.internal|metadata\.google\.internal|kubernetes(\..*)?)$/i

export function isPrivateIp(ip: string): boolean {
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    return (
      a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
    )
  }
  const v6 = ip.toLowerCase().replace(/^\[|\]$/g, '')
  if (!v6.includes(':')) return false
  if (v6 === '::' || v6 === '::1') return true
  if (/^f[cd]/.test(v6) || /^fe[89ab]/.test(v6)) return true // unique local, link local
  const mapped = v6.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  return mapped ? isPrivateIp(mapped[1]) : false
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new PermanentError('That is not a valid web address.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new PermanentError('Only http and https links can be added.')
  if (url.username || url.password) throw new PermanentError('Links with a username or password are not supported.')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (BLOCKED_HOSTS.test(host) || isPrivateIp(host)) throw new PermanentError('That address is not reachable from the internet.')

  // Resolve the name too, where the runtime allows it.
  try {
    const records = [
      ...(await Deno.resolveDns(host, 'A').catch(() => [] as string[])),
      ...(await Deno.resolveDns(host, 'AAAA').catch(() => [] as string[])),
    ]
    if (records.some(isPrivateIp)) throw new PermanentError('That address is not reachable from the internet.')
  } catch (err) {
    if (err instanceof PermanentError) throw err
  }
  return url
}

export async function safeFetch(
  raw: string,
  opts: { maxBytes?: number; timeoutMs?: number; accept?: string } = {},
): Promise<Fetched> {
  const maxBytes = opts.maxBytes ?? 15 * 1024 * 1024
  let current = raw
  for (let hop = 0; hop < 6; hop++) {
    const url = await assertPublicUrl(current)
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20_000)
    let res: Response
    try {
      res = await fetch(url, {
        redirect: 'manual',
        signal: ctrl.signal,
        headers: {
          'user-agent': 'BotDeskBot/2.0 (+https://botdesk.ai/bot; indexing pages its owner added)',
          accept: opts.accept ?? 'text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.5',
        },
      })
    } catch (err) {
      clearTimeout(timer)
      throw new Error(`Could not load ${url.hostname}: ${(err as Error).message}`)
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      clearTimeout(timer)
      await res.body?.cancel()
      current = new URL(res.headers.get('location')!, url).toString()
      continue
    }
    if (res.status === 404 || res.status === 410) {
      clearTimeout(timer)
      throw new PermanentError(`The page was not found (${res.status}).`)
    }
    if (res.status === 401 || res.status === 403) {
      clearTimeout(timer)
      throw new PermanentError(`The site refused access (${res.status}). Only public pages can be added.`)
    }
    if (!res.ok) {
      clearTimeout(timer)
      throw new Error(`The site answered ${res.status}.`)
    }
    const declared = Number(res.headers.get('content-length') ?? '0')
    if (declared > maxBytes) {
      clearTimeout(timer)
      throw new PermanentError(`The file is larger than ${Math.round(maxBytes / 1048576)} MB.`)
    }
    const bytes = await readCapped(res.body, maxBytes)
    clearTimeout(timer)
    return { url: url.toString(), status: res.status, contentType: res.headers.get('content-type') ?? '', bytes }
  }
  throw new PermanentError('Too many redirects.')
}

async function readCapped(body: ReadableStream<Uint8Array> | null, max: number): Promise<Uint8Array> {
  if (!body) return new Uint8Array()
  const reader = body.getReader()
  const parts: Uint8Array[] = []
  let size = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    size += value.length
    if (size > max) {
      await reader.cancel()
      throw new PermanentError(`The file is larger than ${Math.round(max / 1048576)} MB.`)
    }
    parts.push(value)
  }
  const out = new Uint8Array(size)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return out
}
