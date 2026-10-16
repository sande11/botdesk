/**
 * Widget sessions: a signed token the widget gets once from /v1/widget/session
 * and sends with every message. It binds a visitor (contact) to one bot, so a
 * publishable key alone cannot read or write anyone else's conversation.
 *
 * Format: base64url(JSON payload) "." base64url(HMAC-SHA256(payload))
 */
import { fromBase64Url, hmacSha256, timingSafeEqual, toBase64Url } from '../crypto.ts'
import { requireEnv } from '../env.ts'

export interface Session {
  v: 1
  ws: string // workspace id
  bot: string // bot id
  ct: string // contact id
  exp: number // unix seconds
}

const TTL_SECONDS = 7 * 24 * 3600
const enc = new TextEncoder()
const dec = new TextDecoder()

function secret(override?: string): string {
  const s = override ?? requireEnv('SESSION_SECRET')
  if (s.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters')
  return s
}

export async function signSession(
  s: Omit<Session, 'v' | 'exp'> & { exp?: number },
  secretOverride?: string,
): Promise<string> {
  const payload: Session = { v: 1, ...s, exp: s.exp ?? Math.floor(Date.now() / 1000) + TTL_SECONDS }
  const body = toBase64Url(enc.encode(JSON.stringify(payload)))
  const sig = toBase64Url(await hmacSha256(secret(secretOverride), body))
  return `${body}.${sig}`
}

export async function verifySession(token: string | null | undefined, secretOverride?: string): Promise<Session | null> {
  if (!token || typeof token !== 'string' || token.length > 2048) return null
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return null
  const body = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = toBase64Url(await hmacSha256(secret(secretOverride), body))
  if (!timingSafeEqual(sig, expected)) return null
  try {
    const s = JSON.parse(dec.decode(fromBase64Url(body))) as Session
    if (s.v !== 1 || !s.ws || !s.bot || !s.ct || typeof s.exp !== 'number') return null
    if (s.exp < Math.floor(Date.now() / 1000)) return null
    return s
  } catch {
    return null
  }
}
