/** Dashboard users: verify the Supabase session and their workspace role. */
import type { Db } from '../db.ts'
import { forbidden, unauthorized } from '../http.ts'

export type Role = 'owner' | 'admin' | 'editor' | 'reviewer' | 'viewer'
const RANK: Record<Role, number> = { owner: 50, admin: 40, editor: 30, reviewer: 20, viewer: 10 }

export interface UserPrincipal {
  userId: string
  email: string | null
  accessToken: string
}

export function bearer(req: Request): string | null {
  const h = req.headers.get('authorization')
  return h?.startsWith('Bearer ') ? h.slice(7).trim() : null
}

export async function requireUser(db: Db, req: Request): Promise<UserPrincipal> {
  const token = bearer(req)
  if (!token || token.startsWith('bd_')) throw unauthorized('Sign in to continue.')
  const { data, error } = await db.auth.getUser(token)
  if (error || !data.user) throw unauthorized('Your session has expired. Please sign in again.')
  return { userId: data.user.id, email: data.user.email ?? null, accessToken: token }
}

export async function roleIn(db: Db, userId: string, workspaceId: string): Promise<Role | null> {
  const { data } = await db
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle()
  return (data?.role as Role) ?? null
}

export async function requireRole(db: Db, userId: string, workspaceId: string, min: Role): Promise<Role> {
  const role = await roleIn(db, userId, workspaceId)
  if (!role || RANK[role] < RANK[min]) {
    throw forbidden(min === 'viewer' ? 'You are not a member of this workspace.' : `This needs the ${min} role or higher.`)
  }
  return role
}
