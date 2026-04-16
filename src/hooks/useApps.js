import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase.js'
import { sanitize } from '../utils/security.js'

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dashboard`

/** Call the dashboard Edge Function with the current user's JWT */
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

/** Map a DB row → the shape the UI expects */
function rowToApp(row) {
  return {
    id:             row.id,
    name:           row.name,
    url:            row.url,
    primaryColor:   row.primary_color,
    botName:        row.bot_name,
    welcomeMessage: row.welcome_message,
    position:       row.position,
    active:         row.active,
    createdAt:      new Date(row.created_at),
    // apiKey is only returned on creation — not stored here after that
    apiKey:         row.apiKey ?? null,
    knowledgeBase:  (row.kb_entries ?? []).map(rowToKB),
    // Settings (1:1 with app)
    settings: row.app_settings ? {
      outOfScopeMsg:   row.app_settings.out_of_scope_msg   ?? '',
      escalationEmail: row.app_settings.escalation_email   ?? '',
      escalationPhone: row.app_settings.escalation_phone   ?? '',
      rateLimitPerMin: row.app_settings.rate_limit_per_min ?? 15,
      rateLimitPerDay: row.app_settings.rate_limit_per_day ?? 200,
      allowedDomains:  (row.app_settings.allowed_domains ?? []).join(', '),
    } : null,
    // API keys list (without raw key — shown once at creation only)
    apiKeys: (row.app_api_keys ?? []),
  }
}

function rowToKB(row) {
  return {
    id:       row.id,
    keywords: row.keywords ?? [],
    answer:   row.answer,
    active:   row.active,
    tags:     row.tags ?? [],
  }
}

export function useApps() {
  const [apps,          setApps]          = useState([])
  const [selectedAppId, setSelectedAppId] = useState(null)
  const [loading,       setLoading]       = useState(true)

  const selectedApp = apps.find((a) => a.id === selectedAppId) ?? null

  // ── Initial load ────────────────────────────────────────────────────────────

  const loadApps = useCallback(async () => {
    try {
      const rows = await dashboardFetch('/apps')
      const mapped = rows.map(rowToApp)
      setApps(mapped)
      setSelectedAppId((prev) => prev ?? mapped[0]?.id ?? null)
    } catch (err) {
      console.error('useApps load error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadApps()
  }, [loadApps])

  // ── App CRUD ─────────────────────────────────────────────────────────────────

  const addApp = async (data) => {
    const row = await dashboardFetch('/apps', {
      method: 'POST',
      body: JSON.stringify({
        name:           sanitize(data.name),
        url:            sanitize(data.url || ''),
        primaryColor:   data.primaryColor,
        botName:        data.botName,
        welcomeMessage: data.welcomeMessage,
      }),
    })
    const app = rowToApp(row)
    // apiKey is returned once on creation — preserve it in state for display
    app.apiKey = row.apiKey
    setApps((prev) => [app, ...prev])
    setSelectedAppId(app.id)
    return app
  }

  const updateApp = async (id, data) => {
    const row = await dashboardFetch(`/apps/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name:           sanitize(data.name),
        url:            sanitize(data.url ?? ''),
        primaryColor:   data.primaryColor,
        botName:        data.botName,
        welcomeMessage: data.welcomeMessage,
        active:         data.active,
        position:       data.position,
      }),
    })
    // PATCH returns only the scalar app row (no joined tables).
    // Spread only the scalar fields so knowledgeBase, settings, apiKeys, and
    // apiKey are preserved from existing state.
    setApps((prev) => prev.map((a) => {
      if (a.id !== id) return a
      return {
        ...a,
        name:           row.name,
        url:            row.url ?? '',
        primaryColor:   row.primary_color,
        botName:        row.bot_name,
        welcomeMessage: row.welcome_message,
        position:       row.position,
        active:         row.active,
      }
    }))
  }

  const deleteApp = async (id) => {
    await dashboardFetch(`/apps/${id}`, { method: 'DELETE' })
    setApps((prev) => {
      const next = prev.filter((a) => a.id !== id)
      if (selectedAppId === id) setSelectedAppId(next[0]?.id ?? null)
      return next
    })
  }

  const toggleApp = async (id) => {
    const app = apps.find((a) => a.id === id)
    if (!app) return
    await updateApp(id, { ...app, active: !app.active })
  }

  // ── Knowledge Base CRUD ──────────────────────────────────────────────────────

  const addKBEntry = async (appId, data) => {
    const keywords = sanitize(data.keywords)
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)

    const row = await dashboardFetch(`/apps/${appId}/kb`, {
      method: 'POST',
      body: JSON.stringify({
        keywords,
        answer: sanitize(data.answer),
        tags:   data.tags ?? [],
      }),
    })
    const entry = rowToKB(row)
    setApps((prev) =>
      prev.map((a) =>
        a.id === appId ? { ...a, knowledgeBase: [entry, ...a.knowledgeBase] } : a
      )
    )
  }

  const updateKBEntry = async (appId, entryId, data) => {
    const keywords = sanitize(data.keywords)
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)

    const row = await dashboardFetch(`/apps/${appId}/kb/${entryId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        keywords,
        answer: sanitize(data.answer),
        tags:   data.tags ?? [],
      }),
    })
    const entry = rowToKB(row)
    setApps((prev) =>
      prev.map((a) => {
        if (a.id !== appId) return a
        return {
          ...a,
          knowledgeBase: a.knowledgeBase.map((e) => (e.id === entryId ? entry : e)),
        }
      })
    )
  }

  const deleteKBEntry = async (appId, entryId) => {
    await dashboardFetch(`/apps/${appId}/kb/${entryId}`, { method: 'DELETE' })
    setApps((prev) =>
      prev.map((a) =>
        a.id === appId
          ? { ...a, knowledgeBase: a.knowledgeBase.filter((e) => e.id !== entryId) }
          : a
      )
    )
  }

  const toggleKBEntry = async (appId, entryId) => {
    const app   = apps.find((a) => a.id === appId)
    const entry = app?.knowledgeBase.find((e) => e.id === entryId)
    if (!entry) return
    await dashboardFetch(`/apps/${appId}/kb/${entryId}`, {
      method: 'PATCH',
      body: JSON.stringify({ active: !entry.active }),
    })
    setApps((prev) =>
      prev.map((a) => {
        if (a.id !== appId) return a
        return {
          ...a,
          knowledgeBase: a.knowledgeBase.map((e) =>
            e.id === entryId ? { ...e, active: !e.active } : e
          ),
        }
      })
    )
  }

  // ── App Settings ─────────────────────────────────────────────────────────────

  const updateSettings = async (appId, data) => {
    const row = await dashboardFetch(`/apps/${appId}/settings`, {
      method: 'PATCH',
      body: JSON.stringify({
        outOfScopeMsg:   data.outOfScopeMsg,
        escalationEmail: data.escalationEmail,
        escalationPhone: data.escalationPhone,
        rateLimitPerMin: parseInt(data.rateLimitPerMin) || 15,
        rateLimitPerDay: parseInt(data.rateLimitPerDay) || 200,
        allowedDomains:  data.allowedDomains.split(',').map((d) => d.trim()).filter(Boolean),
      }),
    })
    setApps((prev) =>
      prev.map((a) =>
        a.id !== appId ? a : {
          ...a,
          settings: {
            outOfScopeMsg:   row.out_of_scope_msg   ?? '',
            escalationEmail: row.escalation_email   ?? '',
            escalationPhone: row.escalation_phone   ?? '',
            rateLimitPerMin: row.rate_limit_per_min ?? 15,
            rateLimitPerDay: row.rate_limit_per_day ?? 200,
            allowedDomains:  (row.allowed_domains ?? []).join(', '),
          },
        }
      )
    )
  }

  // ── API Keys ─────────────────────────────────────────────────────────────────

  /** Returns the raw key string (shown once). Rotates any existing active key. */
  const createApiKey = async (appId) => {
    const row = await dashboardFetch(`/apps/${appId}/keys`, { method: 'POST' })
    // row = { id, key_prefix, created_at, apiKey }
    setApps((prev) =>
      prev.map((a) =>
        a.id !== appId ? a : {
          ...a,
          apiKeys: [
            { id: row.id, key_prefix: row.key_prefix, active: true, created_at: row.created_at },
            ...a.apiKeys.map((k) => ({ ...k, active: false })),
          ],
        }
      )
    )
    return row.apiKey
  }

  const revokeApiKey = async (appId, keyId) => {
    await dashboardFetch(`/apps/${appId}/keys/${keyId}`, { method: 'DELETE' })
    setApps((prev) =>
      prev.map((a) =>
        a.id !== appId ? a : {
          ...a,
          apiKeys: a.apiKeys.map((k) => (k.id === keyId ? { ...k, active: false } : k)),
        }
      )
    )
  }

  /** Re-embed KB entries that have null embeddings. Returns { reembedded: number } */
  const reembedKBEntries = async (appId) => {
    return dashboardFetch(`/apps/${appId}/kb/reembed`, { method: 'POST' })
  }

  return {
    apps,
    loading,
    selectedAppId,
    selectedApp,
    setSelectedAppId,
    addApp,
    updateApp,
    deleteApp,
    toggleApp,
    addKBEntry,
    updateKBEntry,
    deleteKBEntry,
    toggleKBEntry,
    updateSettings,
    createApiKey,
    revokeApiKey,
    reembedKBEntries,
  }
}
