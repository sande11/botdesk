import { DASHBOARD_STATS, DAILY_VOLUME, TOP_TOPICS } from '../utils/mockData.js'

function StatCard({ label, value, delta, up, icon }) {
  return (
    <div className="card">
      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {icon} {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 600, color: 'var(--text)', lineHeight: 1, marginBottom: 6 }}>{value}</div>
      <div style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, color: up ? 'var(--green)' : 'var(--red)' }}>
        {up ? '↑' : '↓'} {delta} vs last week
      </div>
    </div>
  )
}

function BarChart({ title, rows, maxVal }) {
  const max = maxVal || Math.max(...rows.map((r) => r.count ?? r.pct))
  return (
    <div className="card">
      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 16, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title}</div>
      {rows.map((r, i) => {
        const val  = r.count ?? r.pct
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

export default function Overview() {
  return (
    <div className="animate-fade-in">
      <div className="page-title">Overview</div>
      <div className="page-sub">Last 7 days · All channels</div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 20 }}>
        {DASHBOARD_STATS.map((s) => <StatCard key={s.label} {...s} />)}
      </div>

      {/* Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <BarChart title="Conversations per day" rows={DAILY_VOLUME} />
        <BarChart title="Top topics" rows={TOP_TOPICS} />
      </div>

      {/* Recent activity */}
      <div className="card" style={{ marginTop: 14 }}>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 14, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Recent activity</div>
        {[
          { time: '2 min ago',  icon: '💬', text: 'New conversation started · Amara T.' },
          { time: '18 min ago', icon: '⚠',  text: 'Escalation triggered · James K. · enterprise contract query' },
          { time: '1 hr ago',   icon: '✓',  text: 'Conversation resolved · Luca B.' },
          { time: '2 hr ago',   icon: '📚', text: 'Knowledge base updated · 2 entries added' },
          { time: '3 hr ago',   icon: '✓',  text: 'Conversation resolved · Priya S.' },
        ].map((a, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: i < 4 ? '1px solid var(--border)' : 'none' }}>
            <span style={{ fontSize: 16 }}>{a.icon}</span>
            <span style={{ fontSize: 13, color: 'var(--text)', flex: 1 }}>{a.text}</span>
            <span style={{ fontSize: 11, color: 'var(--text3)', flexShrink: 0 }}>{a.time}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
