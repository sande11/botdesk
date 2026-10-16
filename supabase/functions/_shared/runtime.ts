/** Runs work after the response is sent (Supabase Edge Runtime background tasks). */

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined

export function background(work: Promise<unknown>): void {
  const guarded = work.catch((err) => console.error(JSON.stringify({ level: 'error', msg: 'background task failed', error: String(err) })))
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(guarded)
}

export function log(level: 'info' | 'warn' | 'error', msg: string, extra: Record<string, unknown> = {}) {
  console[level === 'info' ? 'log' : level](JSON.stringify({ level, msg, ...extra }))
}
