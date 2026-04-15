import { useState } from 'react'
import { DEFAULT_APPS, createApp } from '../utils/appsData.js'
import { sanitize } from '../utils/security.js'
import { generateId } from '../utils/helpers.js'

export function useApps() {
  const [apps, setApps] = useState(DEFAULT_APPS)
  const [selectedAppId, setSelectedAppId] = useState(DEFAULT_APPS[0]?.id || null)

  const selectedApp = apps.find((a) => a.id === selectedAppId) || null

  // ── App CRUD ──────────────────────────────────────────────────────────────

  const addApp = (data) => {
    const app = createApp({
      ...data,
      name: sanitize(data.name),
      url:  sanitize(data.url || ''),
    })
    setApps((prev) => [...prev, app])
    setSelectedAppId(app.id)
    return app
  }

  const updateApp = (id, data) => {
    setApps((prev) =>
      prev.map((a) =>
        a.id === id
          ? { ...a, ...data, name: sanitize(data.name ?? a.name), url: sanitize(data.url ?? a.url) }
          : a
      )
    )
  }

  const deleteApp = (id) => {
    setApps((prev) => {
      const next = prev.filter((a) => a.id !== id)
      if (selectedAppId === id) setSelectedAppId(next[0]?.id || null)
      return next
    })
  }

  const toggleApp = (id) =>
    setApps((prev) => prev.map((a) => (a.id === id ? { ...a, active: !a.active } : a)))

  // ── Knowledge Base CRUD (scoped to a specific app) ─────────────────────────

  const addKBEntry = (appId, data) => {
    const entry = {
      id:       'kb_' + generateId(),
      keywords: sanitize(data.keywords)
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
      answer:   sanitize(data.answer),
      active:   true,
      tags:     [],
    }
    setApps((prev) =>
      prev.map((a) =>
        a.id === appId ? { ...a, knowledgeBase: [...a.knowledgeBase, entry] } : a
      )
    )
  }

  const updateKBEntry = (appId, entryId, data) => {
    setApps((prev) =>
      prev.map((a) => {
        if (a.id !== appId) return a
        return {
          ...a,
          knowledgeBase: a.knowledgeBase.map((e) =>
            e.id === entryId
              ? {
                  ...e,
                  keywords: sanitize(data.keywords)
                    .split(',')
                    .map((s) => s.trim().toLowerCase())
                    .filter(Boolean),
                  answer: sanitize(data.answer),
                }
              : e
          ),
        }
      })
    )
  }

  const deleteKBEntry = (appId, entryId) => {
    setApps((prev) =>
      prev.map((a) =>
        a.id === appId
          ? { ...a, knowledgeBase: a.knowledgeBase.filter((e) => e.id !== entryId) }
          : a
      )
    )
  }

  const toggleKBEntry = (appId, entryId) => {
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

  return {
    apps,
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
  }
}
