import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase.js'

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dashboard`

async function dashboardFetch(path, options = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`${FUNCTIONS_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token}`,
      ...options.headers,
    },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `Request failed: ${res.status}`)
  }
  return res.json()
}

function rowToConversation(row) {
  return {
    id:           row.id,
    appId:        row.app_id,
    visitorId:    row.visitor_id,
    visitorName:  row.visitor_name || 'Anonymous',
    visitorEmail: row.visitor_email ?? null,
    status:       row.status,
    channel:      row.channel ?? 'web',
    escalated:    row.escalated ?? false,
    tags:         row.tags ?? [],
    startedAt:    new Date(row.started_at),
    lastMessage:  new Date(row.last_message ?? row.started_at),
    messages: (row.messages ?? [])
      .map((m) => ({ id: m.id, role: m.role, content: m.content, ts: new Date(m.ts) }))
      .sort((a, b) => a.ts - b.ts),
  }
}

export function useConversations() {
  const [conversations, setConversations] = useState([])
  const [selected,      setSelected]      = useState(null)
  const [loading,       setLoading]       = useState(true)

  const load = useCallback(async () => {
    try {
      const rows = await dashboardFetch('/conversations')
      const mapped = rows.map(rowToConversation)
      setConversations(mapped)
      // Keep the currently selected conversation in sync; else pick the first
      setSelected((prev) => {
        if (!prev) return mapped[0] ?? null
        return mapped.find((c) => c.id === prev.id) ?? prev
      })
    } catch (err) {
      console.error('useConversations load error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()

    // Realtime: re-fetch on any conversation or message change
    const channel = supabase
      .channel('conversations-rt')
      .on('postgres_changes', { event: '*',      schema: 'public', table: 'conversations' }, load)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' },      load)
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [load])

  const selectConversation = useCallback((id) => {
    setSelected((prev) => {
      const conv = conversations.find((c) => c.id === id)
      return conv ?? prev
    })
  }, [conversations])

  const markResolved = useCallback(async (id) => {
    try {
      await dashboardFetch(`/conversations/${id}/resolve`, { method: 'PATCH' })
      const update = (c) => c.id === id ? { ...c, status: 'resolved' } : c
      setConversations((prev) => prev.map(update))
      setSelected((prev) => prev?.id === id ? { ...prev, status: 'resolved' } : prev)
    } catch (err) {
      console.error('markResolved error:', err)
    }
  }, [])

  return { conversations, selected, selectConversation, markResolved, loading }
}
