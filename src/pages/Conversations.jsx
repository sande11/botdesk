import { useState, useEffect } from 'react'
import { sanitize } from '../utils/security.js'
import { formatTime, formatDate, formatRelative } from '../utils/helpers.js'
import { useConversations } from '../hooks/useConversations.js'
import { useAppsContext } from '../context/AppsContext.js'

function StatusDot({ status }) {
  const colors  = { active: 'var(--green)', resolved: 'var(--text3)', escalated: 'var(--amber)' }
  const shadows = { active: '0 0 6px var(--green)', escalated: '0 0 6px var(--amber)' }
  return (
    <span style={{
      width: 7, height: 7, borderRadius: '50%', display: 'inline-block',
      marginRight: 5, background: colors[status] || 'var(--text3)',
      boxShadow: shadows[status] || 'none',
    }} />
  )
}

export default function Conversations() {
  const { conversations, selected, selectConversation, markResolved } = useConversations()
  const { apps } = useAppsContext()

  const [search,    setSearch]    = useState('')
  const [appFilter, setAppFilter] = useState(null) // null = All

  // Resolve the app object for display (color, name)
  const activeApp = appFilter ? apps.find((a) => a.id === appFilter) : null

  // Chain: app filter → search filter
  const byApp = appFilter
    ? conversations.filter((c) => c.appId === appFilter)
    : conversations

  const filtered = byApp.filter((c) => {
    const q = search.toLowerCase()
    return !q
      || c.visitorName.toLowerCase().includes(q)
      || c.tags.some((t) => t.includes(q))
      || c.status.includes(q)
  })

  // When the filter changes, auto-select the first visible conversation
  // so the detail pane is never showing a conversation outside the filter.
  useEffect(() => {
    if (filtered.length > 0) {
      selectConversation(filtered[0].id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appFilter])

  const switchFilter = (id) => {
    setAppFilter(id)
    setSearch('')
  }

  // Count per app for the pill badges
  const countForApp = (id) => conversations.filter((c) => c.appId === id).length

  return (
    <div className="animate-fade-in" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <div className="page-title">Conversations</div>
          <div className="page-sub" style={{ margin: 0 }}>
            {appFilter
              ? `${filtered.length} conversation${filtered.length !== 1 ? 's' : ''} · ${activeApp?.name ?? 'Unknown app'}`
              : `${conversations.length} total · across all apps`}
          </div>
        </div>
      </div>

      {/* App filter bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        marginBottom: 14, padding: '10px 14px',
        background: 'var(--bg2)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
      }}>
        <span style={{ fontSize: 11.5, color: 'var(--text3)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em', flexShrink: 0 }}>
          Filter
        </span>

        {/* All pill */}
        <button
          onClick={() => switchFilter(null)}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '4px 11px', borderRadius: 20,
            border: `1.5px solid ${!appFilter ? 'var(--text2)' : 'var(--border2)'}`,
            background: !appFilter ? 'var(--bg4)' : 'transparent',
            color: !appFilter ? 'var(--text)' : 'var(--text3)',
            fontSize: 12.5, fontWeight: !appFilter ? 600 : 400,
            cursor: 'pointer', fontFamily: 'var(--font-sans)', transition: 'all 0.15s',
          }}
        >
          All apps
          <span style={{
            fontSize: 10, padding: '1px 5px', borderRadius: 8, fontWeight: 600,
            background: !appFilter ? 'var(--accent-chip-bg)' : 'var(--bg3)',
            color: !appFilter ? 'var(--accent-chip-fg)' : 'var(--text3)',
          }}>
            {conversations.length}
          </span>
        </button>

        {/* One pill per app */}
        {apps.map((app) => {
          const active = appFilter === app.id
          const count  = countForApp(app.id)
          return (
            <button
              key={app.id}
              onClick={() => switchFilter(app.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '4px 11px', borderRadius: 20,
                border: `1.5px solid ${active ? app.primaryColor : 'var(--border2)'}`,
                background: active ? app.primaryColor + '1a' : 'transparent',
                color: active ? app.primaryColor : 'var(--text3)',
                fontSize: 12.5, fontWeight: active ? 600 : 400,
                cursor: 'pointer', fontFamily: 'var(--font-sans)', transition: 'all 0.15s',
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: app.primaryColor, flexShrink: 0 }} />
              {app.name}
              <span style={{
                fontSize: 10, padding: '1px 5px', borderRadius: 8, fontWeight: 600,
                background: active ? app.primaryColor + '30' : 'var(--bg3)',
                color: active ? app.primaryColor : 'var(--text3)',
              }}>
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Main panel */}
      <div style={{
        display: 'grid', gridTemplateColumns: '300px 1fr',
        flex: 1, border: '1px solid var(--border)', borderRadius: 'var(--radius)',
        overflow: 'hidden', background: 'var(--bg2)', minHeight: 0,
      }}>
        {/* Conversation list */}
        <div style={{ borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: 12, borderBottom: '1px solid var(--border)' }}>
            <input
              className="form-input"
              placeholder="Search conversations…"
              value={search}
              onChange={(e) => setSearch(sanitize(e.target.value))}
              maxLength={60}
            />
          </div>

          <div style={{ overflowY: 'auto', flex: 1 }}>
            {filtered.map((c) => {
              const app = apps.find((a) => a.id === c.appId)
              return (
                <div
                  key={c.id}
                  onClick={() => selectConversation(c.id)}
                  style={{
                    padding: '12px 14px', borderBottom: '1px solid var(--border)',
                    cursor: 'pointer', transition: 'background 0.1s',
                    background: selected?.id === c.id ? 'var(--accent-bg)' : 'transparent',
                    borderLeft: selected?.id === c.id ? '2px solid var(--accent)' : '2px solid transparent',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
                      <StatusDot status={c.status} />{c.visitorName}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text3)' }}>{formatRelative(c.lastMessage)}</span>
                  </div>

                  <div style={{ fontSize: 12, color: 'var(--text2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220, marginBottom: 6 }}>
                    {c.messages[c.messages.length - 1]?.content}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                    {/* App pill — only when viewing All */}
                    {!appFilter && app && (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 3,
                        padding: '1px 6px', borderRadius: 10,
                        fontSize: 10, fontWeight: 500,
                        background: app.primaryColor + '18',
                        color: app.primaryColor,
                        border: `1px solid ${app.primaryColor}33`,
                      }}>
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: app.primaryColor }} />
                        {app.name}
                      </span>
                    )}
                    {c.tags.map((t) => (
                      <span key={t} className={`tag ${t === 'escalated' ? 'tag-amber' : 'tag-purple'}`}>{t}</span>
                    ))}
                  </div>
                </div>
              )
            })}

            {filtered.length === 0 && (
              <div style={{ padding: '48px 24px', textAlign: 'center' }}>
                <div style={{ fontSize: 28, marginBottom: 10, opacity: 0.4 }}>💬</div>
                <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 4 }}>No conversations found</div>
                {appFilter && (
                  <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                    Try switching to <button onClick={() => switchFilter(null)} style={{ background: 'none', border: 'none', color: 'var(--accent2)', cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font-sans)', padding: 0 }}>All apps</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Conversation detail */}
        {selected && filtered.some((c) => c.id === selected.id) ? (
          <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Detail header */}
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 36, height: 36, background: 'var(--accent-chip-bg)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: 'var(--accent-chip-fg)', fontWeight: 600 }}>
                {selected.visitorName[0]}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{selected.visitorName}</div>
                <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 1 }}>
                  ID: {selected.visitorId} · {formatDate(selected.startedAt)} · {selected.messages.length} messages
                  {selected.visitorEmail && ` · ${selected.visitorEmail}`}
                </div>
              </div>

              {/* App badge in header */}
              {(() => {
                const app = apps.find((a) => a.id === selected.appId)
                return app ? (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '3px 10px', borderRadius: 20, fontSize: 11.5, fontWeight: 500,
                    background: app.primaryColor + '18',
                    color: app.primaryColor,
                    border: `1px solid ${app.primaryColor}33`,
                  }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: app.primaryColor }} />
                    {app.name}
                  </span>
                ) : null
              })()}

              <span className={`tag ${selected.status === 'active' ? 'tag-green' : selected.status === 'escalated' ? 'tag-amber' : 'tag-purple'}`}>
                {selected.status}
              </span>
              {selected.status !== 'resolved' && (
                <button className="btn btn-ghost btn-sm" onClick={() => markResolved(selected.id)}>Mark resolved</button>
              )}
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {selected.messages.map((m) => (
                <div key={m.id}>
                  {m.role === 'escalation' ? (
                    <div style={{ background: 'var(--amber-bg)', color: 'var(--amber)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: 8, fontSize: 12, padding: '8px 12px', margin: '0 auto', textAlign: 'center', fontWeight: 500, maxWidth: '90%' }}>
                      {m.content}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 8, flexDirection: m.role === 'user' ? 'row-reverse' : 'row' }}>
                      <div style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, background: m.role === 'bot' ? 'var(--accent-chip-bg)' : 'var(--bg4)', color: m.role === 'bot' ? 'var(--accent-chip-fg)' : 'var(--text2)' }}>
                        {m.role === 'bot' ? '🤖' : selected.visitorName[0]}
                      </div>
                      <div>
                        <div style={{ maxWidth: '72%', padding: '10px 14px', borderRadius: m.role === 'bot' ? '4px 12px 12px 12px' : '12px 4px 12px 12px', fontSize: 13.5, lineHeight: 1.55, background: m.role === 'bot' ? 'var(--bg3)' : 'var(--accent-chip-bg)', color: m.role === 'bot' ? 'var(--text)' : 'var(--accent-chip-fg)' }}>
                          {m.content}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3, padding: '0 4px', textAlign: m.role === 'user' ? 'right' : 'left' }}>
                          {formatTime(m.ts)}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text3)', gap: 10 }}>
            <span style={{ fontSize: 36, opacity: 0.4 }}>💬</span>
            <p style={{ fontSize: 13 }}>Select a conversation to view</p>
          </div>
        )}
      </div>
    </div>
  )
}
