import { createClient } from '@supabase/supabase-js'

export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? 'http://127.0.0.1:54321'
const ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? ''

if (!ANON_KEY) console.warn('VITE_SUPABASE_ANON_KEY is not set. Copy .env.example to .env.local.')

/** The dashboard talks to Postgres as the signed-in user; RLS decides what they see. */
export const supabase = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})

/** Edge Functions base. Defaults to the Supabase project; override to self-host them elsewhere. */
export const FUNCTIONS_URL = ((import.meta.env.VITE_FUNCTIONS_URL as string | undefined) ?? `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1`).replace(/\/$/, '')
export const API_URL = `${FUNCTIONS_URL}/api`
export const WIDGET_URL = (import.meta.env.VITE_WIDGET_URL as string | undefined) ?? `${location.origin}/widget.js`
