import type { Db } from '../db.ts'
import { sha256Hex } from '../crypto.ts'
import { forbidden, unauthorized } from '../http.ts'

export type KeyKind = 'publishable' | 'secret'
export type Scope = 'chat' | 'ingest' | 'conversations' | 'analyze'

export interface KeyPrincipal {
  keyId: string
  kind: KeyKind
  workspaceId: string
  /** null: the key works for every bot in the workspace. */
  botId: string | null
  scopes: Scope[]
}

const KEY_RE = /^bd_(pk|sk)_[A-Za-z0-9]{32}$/
const LEGACY_RE = /^bdk_live_[0-9a-f]{24}$/ // v1 widget keys, imported as publishable

export function looksLikeKey(raw: string | null | undefined): raw is string {
  return !!raw && (KEY_RE.test(raw) || LEGACY_RE.test(raw))
}

const cache = new Map<string, { at: number; principal: KeyPrincipal | null }>()
const CACHE_MS = 30_000
const lastTouched = new Map<string, number>()

export async function verifyApiKey(db: Db, raw: string | null | undefined): Promise<KeyPrincipal | null> {
  if (!looksLikeKey(raw)) return null
  const hash = await sha256Hex(raw)
  const hit = cache.get(hash)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.principal

  const { data } = await db
    .from('api_keys')
    .select('id, kind, workspace_id, bot_id, scopes, expires_at, revoked_at')
    .eq('key_hash', hash)
    .maybeSingle()

  let principal: KeyPrincipal | null = null
  if (data && !data.revoked_at && (!data.expires_at || new Date(data.expires_at) > new Date())) {
    principal = {
      keyId: data.id,
      kind: data.kind,
      workspaceId: data.workspace_id,
      botId: data.bot_id,
      scopes: data.scopes ?? [],
    }
  }
  cache.set(hash, { at: Date.now(), principal })

  if (principal && Date.now() - (lastTouched.get(principal.keyId) ?? 0) > 5 * 60_000) {
    lastTouched.set(principal.keyId, Date.now())
    db.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', principal.keyId).then(() => {})
  }
  return principal
}

/** Reads the key from `Authorization: Bearer`, `x-api-key`, or a body field. */
export function keyFromRequest(req: Request, bodyKey?: unknown): string | null {
  const auth = req.headers.get('authorization')
  if (auth?.startsWith('Bearer ')) {
    const v = auth.slice(7).trim()
    if (looksLikeKey(v)) return v
  }
  const header = req.headers.get('x-api-key')
  if (header) return header.trim()
  return typeof bodyKey === 'string' ? bodyKey : null
}

export async function requireKey(
  db: Db,
  req: Request,
  opts: { scope: Scope; kind?: KeyKind; bodyKey?: unknown },
): Promise<KeyPrincipal> {
  const p = await verifyApiKey(db, keyFromRequest(req, opts.bodyKey))
  if (!p) throw unauthorized('Missing or invalid API key.')
  if (opts.kind && p.kind !== opts.kind) {
    throw forbidden(opts.kind === 'secret' ? 'This endpoint needs a secret key (bd_sk_...).' : 'Use a publishable key.')
  }
  if (!p.scopes.includes(opts.scope)) throw forbidden(`This key does not have the "${opts.scope}" scope.`)
  return p
}

/** Test hook. */
export function clearKeyCache() {
  cache.clear()
}
