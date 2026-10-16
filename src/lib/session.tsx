/** Signed-in user, their workspaces, and the workspace in the URL. */
import type { Session } from '@supabase/supabase-js'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase.ts'
import { type Membership, type Plan, type Profile, ROLE_RANK, type Role, type Workspace } from './types.ts'
import { unwrap } from './api.ts'

// ── Auth ──────────────────────────────────────────────────────────────────

const AuthCtx = createContext<{ session: Session | null; loading: boolean }>({ session: null, loading: true })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const qc = useQueryClient()
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'SIGNED_OUT') qc.clear()
    })
    return () => data.subscription.unsubscribe()
  }, [qc])
  return <AuthCtx.Provider value={{ session, loading }}>{children}</AuthCtx.Provider>
}

export const useAuth = () => useContext(AuthCtx)

export function useProfile() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['profile', session?.user.id],
    enabled: !!session,
    queryFn: async () =>
      unwrap(await supabase.from('profiles').select('id, email, full_name, avatar_url, is_platform_admin').eq('id', session!.user.id).single()) as Profile,
  })
}

export function useMemberships() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['memberships', session?.user.id],
    enabled: !!session,
    queryFn: async () =>
      unwrap(
        await supabase
          .from('workspace_members')
          .select('workspace_id, user_id, role, created_at, workspaces(id, name, slug, plan, features, settings, created_at)')
          .eq('user_id', session!.user.id)
          .order('created_at'),
      ) as unknown as Membership[],
  })
}

export function usePlans() {
  return useQuery({
    queryKey: ['plans'],
    staleTime: 3600_000,
    queryFn: async () => unwrap(await supabase.from('plans').select('*').order('sort')) as Plan[],
  })
}

// ── Current workspace ─────────────────────────────────────────────────────

interface WorkspaceCtxValue {
  workspace: Workspace
  role: Role
  can: (min: Role) => boolean
  legal: boolean
  plan: Plan | undefined
  /** Prefix for links inside this workspace: /w/<slug> */
  base: string
}

const WorkspaceCtx = createContext<WorkspaceCtxValue | null>(null)

export function WorkspaceProvider({ membership, children }: { membership: Membership; children: ReactNode }) {
  const plans = usePlans()
  const value = useMemo<WorkspaceCtxValue>(() => {
    const ws = membership.workspaces!
    return {
      workspace: ws,
      role: membership.role,
      can: (min) => ROLE_RANK[membership.role] >= ROLE_RANK[min],
      legal: ws.features?.legal === true,
      plan: plans.data?.find((p) => p.id === ws.plan),
      base: `/w/${ws.slug}`,
    }
  }, [membership, plans.data])
  return <WorkspaceCtx.Provider value={value}>{children}</WorkspaceCtx.Provider>
}

export function useWorkspace(): WorkspaceCtxValue {
  const v = useContext(WorkspaceCtx)
  if (!v) throw new Error('useWorkspace outside WorkspaceProvider')
  return v
}

// ── Contrast ──────────────────────────────────────────────────────────────

export type Contrast = 'standard' | 'medium' | 'high'

export function useContrast(): [Contrast, (c: Contrast) => void] {
  const [contrast, setContrast] = useState<Contrast>(() => {
    try {
      return (localStorage.getItem('botdesk.contrast') as Contrast) || 'standard'
    } catch {
      return 'standard'
    }
  })
  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('contrast-medium', contrast === 'medium')
    root.classList.toggle('contrast-high', contrast === 'high')
    try {
      localStorage.setItem('botdesk.contrast', contrast)
    } catch {
      // private mode: not remembered
    }
  }, [contrast])
  return [contrast, setContrast]
}

// ── Theme ─────────────────────────────────────────────────────────────────

export type Theme = 'light' | 'dark' | 'system'

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem('botdesk.theme') as Theme) || 'system'
    } catch {
      return 'system'
    }
  })
  useEffect(() => {
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
      document.documentElement.classList.toggle('dark', dark)
    }
    apply()
    try {
      localStorage.setItem('botdesk.theme', theme)
    } catch {
      // private mode: theme just isn't remembered
    }
    if (theme !== 'system') return
    const mq = matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])
  return [theme, setTheme]
}
