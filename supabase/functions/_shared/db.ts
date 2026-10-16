import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { anonKey, serviceKey, supabaseUrl } from './env.ts'

export type Db = SupabaseClient

let service: Db | null = null

/** Service-role client: bypasses RLS. Every query must scope by workspace. */
export function serviceDb(): Db {
  if (!service) {
    service = createClient(supabaseUrl(), serviceKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return service
}

/** A client that acts as the signed-in user, so RLS applies. */
export function userDb(accessToken: string): Db {
  return createClient(supabaseUrl(), anonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })
}

/** Throws the PostgREST error, so callers can just `await must(q)`. */
// deno-lint-ignore no-explicit-any
export async function must<T = any>(
  // deno-lint-ignore no-explicit-any
  q: PromiseLike<{ data: any; error: { message: string; code?: string } | null }>,
): Promise<T> {
  const { data, error } = await q
  if (error) throw new DbError(error.message, error.code)
  return data as T
}

export class DbError extends Error {
  constructor(message: string, public code?: string) {
    super(message)
  }
}
