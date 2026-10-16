/**
 * Environment for BotDesk Edge Functions.
 *
 * Set with `supabase secrets set NAME=value` (see .env.example):
 *   SESSION_SECRET         signs widget sessions (32+ random bytes)
 *   WORKER_SECRET          shared by pg_cron and the worker function
 *   PUBLIC_API_URL         optional; public base URL of the functions
 *   ANTHROPIC_API_KEY      platform keys, used when a workspace has none
 *   OPENAI_API_KEY         and its plan allows platform AI
 *   VOYAGE_API_KEY
 *   RESEND_API_KEY         emails (hand-off alerts, invites)
 *   EMAIL_FROM             e.g. "BotDesk <noreply@yourdomain.com>"
 *   DASHBOARD_URL          links in emails, e.g. https://app.botdesk.ai
 *   BOTDESK_FAKE_AI=1      local development only: deterministic fake models
 */

export function env(name: string): string | undefined {
  const v = Deno.env.get(name)
  return v === undefined || v === '' ? undefined : v
}

export function requireEnv(name: string): string {
  const v = env(name)
  if (!v) throw new Error(`Missing environment variable ${name}`)
  return v
}

export function supabaseUrl(): string {
  return requireEnv('SUPABASE_URL')
}

/** Service key: the legacy service_role JWT, or the default new secret key. */
export function serviceKey(): string {
  const legacy = env('SUPABASE_SERVICE_ROLE_KEY')
  if (legacy) return legacy
  const keys = env('SUPABASE_SECRET_KEYS')
  if (keys) {
    try {
      const parsed = JSON.parse(keys) as Record<string, string>
      const k = parsed.default ?? Object.values(parsed)[0]
      if (k) return k
    } catch {
      // fall through
    }
  }
  throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEYS')
}

/** Publishable (anon) key, for verifying user sessions. */
export function anonKey(): string {
  const legacy = env('SUPABASE_ANON_KEY')
  if (legacy) return legacy
  const keys = env('SUPABASE_PUBLISHABLE_KEYS')
  if (keys) {
    try {
      const parsed = JSON.parse(keys) as Record<string, string>
      const k = parsed.default ?? Object.values(parsed)[0]
      if (k) return k
    } catch {
      // fall through
    }
  }
  throw new Error('Missing SUPABASE_ANON_KEY / SUPABASE_PUBLISHABLE_KEYS')
}

/** Base URL that external services (WhatsApp, Twilio) call back on. */
export function publicFunctionsUrl(): string {
  const explicit = env('PUBLIC_API_URL')
  if (explicit) return explicit.replace(/\/$/, '')
  return `${supabaseUrl().replace(/\/$/, '')}/functions/v1`
}

export function fakeAi(): boolean {
  return env('BOTDESK_FAKE_AI') === '1'
}
