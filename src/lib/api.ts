/** Calls to BotDesk's admin Edge Function as the signed-in user. */
import { FUNCTIONS_URL, supabase } from './supabase.ts'

export class AdminError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message)
  }
}

async function token(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  if (!data.session) throw new AdminError(401, 'unauthorized', 'Please sign in again.')
  return data.session.access_token
}

export async function admin<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init
  const res = await fetch(`${FUNCTIONS_URL}/admin${path}`, {
    ...rest,
    method: rest.method ?? (json !== undefined ? 'POST' : 'GET'),
    headers: {
      authorization: `Bearer ${await token()}`,
      ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(rest.headers ?? {}),
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  })
  if (!res.ok) {
    let msg = `Request failed (${res.status}).`
    let code = 'error'
    try {
      const j = await res.json()
      msg = j.error?.message ?? msg
      code = j.error?.code ?? code
    } catch {
      // keep default
    }
    throw new AdminError(res.status, code, msg)
  }
  const type = res.headers.get('content-type') ?? ''
  return (type.includes('application/json') ? res.json() : res.text()) as Promise<T>
}

export async function adminDownload(path: string, filename: string) {
  const res = await fetch(`${FUNCTIONS_URL}/admin${path}`, { headers: { authorization: `Bearer ${await token()}` } })
  if (!res.ok) throw new AdminError(res.status, 'error', 'Download failed.')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return Number(res.headers.get('x-example-count') ?? '0')
}

/** Throws a readable error for a Supabase result. */
export function unwrap<T>(r: { data: T | null; error: { message: string; code?: string } | null }): T {
  if (r.error) throw new Error(friendlyDbError(r.error.message, r.error.code))
  return r.data as T
}

export function friendlyDbError(message: string, code?: string): string {
  if (code === '42501' || /row-level security|permission denied/i.test(message)) {
    return "You don't have permission to do that in this workspace."
  }
  if (code === '23505') return 'That already exists.'
  if (code === '23503') return 'That refers to something that no longer exists.'
  return message
}
