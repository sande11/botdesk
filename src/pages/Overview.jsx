import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dashboard`

async function dashboardFetch(path) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`${FUNCTIONS_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token}`,
    },
  })
  if (!res.ok) throw new Error(`Request failed: ${res.status}`)
  return res.json()
}

function StatCard({ label, value, icon }) {
  return (
    <div className="card">
      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {icon} {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 600, color: 'var(--text)', lineHeight: 1 }}>{value}</div>
    </div>
  )
}

function BarChart({ title, rows }) {
  const max = Math.max(...rows.map((r) => r.count ?? r.pct ?? 0), 1)
  return (
    <div className="card">
      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 16, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title}</div>
      {rows.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--text3)', textAlign: 'center', padding: '20px 0' }}>No data yet</div>
      )}
      {rows.map((r, i) => {
        const val  = r.count ?? r.pct ?? 0
        const pct  = (val / max) * 100
        const color = pct > 70 ? 'var(--accent)' : pct > 40 ? 'var(--green)' : 'var(--text3)'
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--text2)', width: 90, flexShrink: 0, textAlign: 'right' }}>{r.day || r.label}</div>
            <div style={{ flex: 1, background: 'var(--bg3)', borderRadius: 4, height: 8 }}>
              <div style={{ width: `${pct}%`, height: 8, borderRadius: 4, background: color, transition: 'width 0.8s cubic-bezier(.22,.68,0,1.2)' }} />
            </div>
            <div style={{ fontSize: 12, color: 'var(--text2)', width: 36 }}>{val}{r.pct !== undefined ? '%' : ''}</div>
          </div>
        )
      })}
    </div>
  )
}

const STAT_ICONS = {
  'Total Conversations': '💬',
  'Escalated':           '⚠',
}

export default function Overview() {
  const [stats,       setStats]       = useState([])
  const [dailyVolume, setDailyVolume] = useState([])
  const [loading,     setLoading]     = useState(true)

  useEffect(() => {
    dashboardFetch('/analytics/overview')
      .then(({ stats, dailyVolume }) => {
        setStats(stats ?? [])
        setDailyVolume(dailyVolume ?? [])
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="animate-fade-in">
      <div className="page-title">Overview</div>
      <div className="page-sub">All time · All channels</div>

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text3)', marginTop: 24 }}>Loading…</div>
      ) : (
        <>
          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 14, marginBottom: 20 }}>
            {stats.map((s) => (
              <StatCard key={s.label} label={s.label} value={s.value} icon={STAT_ICONS[s.label] ?? '📊'} />
            ))}
            {stats.length === 0 && (
              <div className="card" style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '40px 24px' }}>
                <div style={{ fontSize: 28, marginBottom: 10 }}>📊</div>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>No data yet</div>
                <div style={{ fontSize: 13, color: 'var(--text2)' }}>Conversations will appear here once your widget starts receiving messages.</div>
              </div>
            )}
          </div>

          {/* Charts */}
          {stats.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <BarChart title="Conversations per day" rows={dailyVolume} />
              <BarChart title="Status breakdown" rows={stats.map((s) => ({ label: s.label, count: Number(s.value.replace(/,/g, '')) }))} />
            </div>
          )}
        </>
      )}
    </div>
  )
}
