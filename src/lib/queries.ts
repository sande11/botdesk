/** Shared data hooks. RLS scopes every query to workspaces the user belongs to. */
import { useQuery } from '@tanstack/react-query'
import { admin, unwrap } from './api.ts'
import { useWorkspace } from './session.tsx'
import { supabase } from './supabase.ts'
import type { ApiKey, Bot, KnowledgeBase, ModelCatalog } from './types.ts'

export function useBots() {
  const { workspace } = useWorkspace()
  return useQuery({
    queryKey: ['bots', workspace.id],
    queryFn: async () => unwrap(await supabase.from('bots').select('*').eq('workspace_id', workspace.id).order('created_at')) as Bot[],
  })
}

export function useKnowledgeBases() {
  const { workspace } = useWorkspace()
  return useQuery({
    queryKey: ['kbs', workspace.id],
    queryFn: async () =>
      unwrap(await supabase.from('knowledge_bases').select('*').eq('workspace_id', workspace.id).order('created_at')) as KnowledgeBase[],
  })
}

export function useModels() {
  const { workspace } = useWorkspace()
  return useQuery({
    queryKey: ['models', workspace.id],
    staleTime: 60_000,
    queryFn: () => admin<ModelCatalog>(`/models?workspace_id=${workspace.id}`),
  })
}

export function useApiKeys() {
  const { workspace, can } = useWorkspace()
  return useQuery({
    queryKey: ['api-keys', workspace.id],
    enabled: can('admin'),
    queryFn: async () =>
      unwrap(
        await supabase.from('api_keys')
          .select('id, workspace_id, bot_id, name, kind, prefix, display_key, scopes, created_at, last_used_at, revoked_at')
          .eq('workspace_id', workspace.id).order('created_at', { ascending: false }),
      ) as ApiKey[],
  })
}

export function useMembersById() {
  const { workspace } = useWorkspace()
  return useQuery({
    queryKey: ['member-names', workspace.id],
    staleTime: 300_000,
    queryFn: async () => {
      const rows = unwrap(
        await supabase.from('workspace_members').select('user_id').eq('workspace_id', workspace.id),
      ) as { user_id: string }[]
      const profiles = unwrap(
        await supabase.from('profiles').select('id, email, full_name').in('id', rows.map((r) => r.user_id)),
      ) as { id: string; email: string | null; full_name: string | null }[]
      return new Map(profiles.map((p) => [p.id, p.full_name || p.email || 'Teammate']))
    },
  })
}
