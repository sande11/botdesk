import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppsContext } from '../context/AppsContext.js'
import { truncate } from '../utils/security.js'

function FormFields({ form, setForm, errors, onSave, onCancel, label }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {label && <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{label}</div>}
      <div className="form-group">
        <label className="form-label">
          Keywords{' '}
          <span style={{ color: 'var(--text3)', fontWeight: 400 }}>(comma-separated — these trigger this answer)</span>
        </label>
        <input
          className="form-input"
          placeholder="pricing, cost, plan, how much"
          value={form.keywords}
          onChange={(e) => setForm((p) => ({ ...p, keywords: e.target.value }))}
          maxLength={300}
          autoFocus
        />
        {errors.keywords && <div style={{ color: 'var(--red)', fontSize: 11, marginTop: 4 }}>{errors.keywords}</div>}
      </div>
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label">Answer</label>
        <textarea
          className="form-input"
          placeholder="The answer the bot will give when these keywords match…"
          value={form.answer}
          onChange={(e) => setForm((p) => ({ ...p, answer: e.target.value }))}
          maxLength={1000}
          style={{ minHeight: 90, resize: 'vertical' }}
        />
        {errors.answer && <div style={{ color: 'var(--red)', fontSize: 11, marginTop: 4 }}>{errors.answer}</div>}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary btn-sm" onClick={onSave}>Save entry</button>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

export default function KnowledgeBase() {
  const navigate = useNavigate()
  const {
    apps, selectedAppId, selectedApp, setSelectedAppId,
    addKBEntry, updateKBEntry, deleteKBEntry, toggleKBEntry,
    reembedKBEntries,
  } = useAppsContext()

  const [adding,       setAdding]       = useState(false)
  const [editing,      setEditing]      = useState(null)
  const [form,         setForm]         = useState({ keywords: '', answer: '' })
  const [errors,       setErrors]       = useState({})
  const [reembedding,  setReembedding]  = useState(false)
  const [reembedMsg,   setReembedMsg]   = useState(null)

  const validate = (f) => {
    const e = {}
    if (!f.keywords.trim()) e.keywords = 'Keywords are required.'
    if (!f.answer.trim())   e.answer   = 'Answer is required.'
    return e
  }

  const saveNew = () => {
    const errs = validate(form)
    if (Object.keys(errs).length) { setErrors(errs); return }
    addKBEntry(selectedAppId, form)
    setForm({ keywords: '', answer: '' })
    setErrors({})
    setAdding(false)
  }

  const saveEdit = (entryId) => {
    const errs = validate(form)
    if (Object.keys(errs).length) { setErrors(errs); return }
    updateKBEntry(selectedAppId, entryId, form)
    setEditing(null)
    setErrors({})
  }

  const startEdit = (entry) => {
    setEditing(entry.id)
    setForm({ keywords: entry.keywords.join(', '), answer: entry.answer })
    setErrors({})
    setAdding(false)
  }

  const switchApp = (id) => {
    setSelectedAppId(id)
    setAdding(false)
    setEditing(null)
    setErrors({})
  }

  const handleReembed = async () => {
    if (!selectedAppId || reembedding) return
    setReembedding(true)
    setReembedMsg(null)
    try {
      const result = await reembedKBEntries(selectedAppId)
      setReembedMsg(result.reembedded === 0
        ? 'All entries already have embeddings.'
        : `Re-embedded ${result.reembedded} entr${result.reembedded === 1 ? 'y' : 'ies'}.`)
    } catch {
      setReembedMsg('Failed — check console for details.')
    } finally {
      setReembedding(false)
    }
  }

  const entries = selectedApp?.knowledgeBase || []

  // No apps exist yet
  if (apps.length === 0) {
    return (
      <div className="animate-fade-in">
        <div className="page-title">Knowledge Base</div>
        <div className="card" style={{ textAlign: 'center', padding: '56px 24px', marginTop: 16 }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📚</div>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>No apps yet</div>
          <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 20 }}>
            Create an app first, then add knowledge base entries to it.
          </div>
          <button className="btn btn-primary" onClick={() => navigate('/apps')}>Go to Apps</button>
        </div>
      </div>
    )
  }

  return (
    <div className="animate-fade-in">
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div className="page-title">Knowledge Base</div>
          <div className="page-sub" style={{ margin: 0 }}>
            Q&amp;A data scoped to &ldquo;{selectedApp?.name}&rdquo;
            &nbsp;·&nbsp;
            {entries.filter((e) => e.active).length} active{' '}
            {entries.filter((e) => e.active).length === 1 ? 'entry' : 'entries'}
          </div>
        </div>
        {!adding && selectedApp && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {reembedMsg && (
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>{reembedMsg}</span>
            )}
            <button
              className="btn btn-ghost btn-sm"
              onClick={handleReembed}
              disabled={reembedding}
              title="Re-embed KB entries that are missing AI embeddings (needed for semantic search)"
            >
              {reembedding ? 'Re-embedding…' : 'Fix embeddings'}
            </button>
            <button
              className="btn btn-primary"
              onClick={() => { setAdding(true); setEditing(null); setForm({ keywords: '', answer: '' }); setErrors({}) }}
            >
              + Add entry
            </button>
          </div>
        )}
      </div>

      {/* App selector */}
      <div className="card" style={{ marginBottom: 14, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em', flexShrink: 0 }}>App</span>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', flex: 1 }}>
          {apps.map((app) => {
            const active = selectedAppId === app.id
            return (
              <button
                key={app.id}
                onClick={() => switchApp(app.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '5px 12px', borderRadius: 20,
                  border: `1.5px solid ${active ? app.primaryColor : 'var(--border2)'}`,
                  background: active ? app.primaryColor + '1a' : 'transparent',
                  color: active ? app.primaryColor : 'var(--text2)',
                  fontSize: 12.5, fontWeight: active ? 600 : 400,
                  cursor: 'pointer', fontFamily: 'var(--font-sans)', transition: 'all 0.15s',
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: app.primaryColor, flexShrink: 0 }} />
                {app.name}
                <span style={{ fontSize: 11, opacity: 0.65, fontWeight: 400 }}>({app.knowledgeBase.length})</span>
              </button>
            )
          })}
        </div>
        {selectedApp && (
          <span style={{ fontSize: 11, color: 'var(--text3)', flexShrink: 0 }}>
            {selectedApp.url || 'No URL'}
          </span>
        )}
      </div>

      {/* Isolation notice */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', marginBottom: 14, background: 'var(--accent-bg)', border: '1px solid var(--accent)', borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--accent2)' }}>
        <span>🔒</span>
        <span>Entries below are <strong>only visible to the &ldquo;{selectedApp?.name}&rdquo; widget</strong>. Other apps cannot access them.</span>
      </div>

      {/* Add form */}
      {adding && (
        <div className="card" style={{ marginBottom: 14, borderColor: 'var(--accent)' }}>
          <FormFields
            form={form} setForm={setForm} errors={errors}
            label={`New entry for "${selectedApp?.name}"`}
            onSave={saveNew}
            onCancel={() => { setAdding(false); setErrors({}) }}
          />
        </div>
      )}

      {/* Empty state for selected app */}
      {entries.length === 0 && !adding && (
        <div className="card" style={{ textAlign: 'center', padding: '40px 24px' }}>
          <div style={{ fontSize: 28, marginBottom: 10 }}>📭</div>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>No entries for &ldquo;{selectedApp?.name}&rdquo;</div>
          <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 20 }}>
            Add Q&amp;A entries to teach this chatbot how to respond.
          </div>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => { setAdding(true); setErrors({}) }}
          >
            + Add first entry
          </button>
        </div>
      )}

      {/* Entries grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
        {entries.map((entry, i) => (
          <div key={entry.id} className="card" style={{ opacity: entry.active ? 1 : 0.55 }}>
            {editing === entry.id ? (
              <FormFields
                form={form} setForm={setForm} errors={errors}
                label={`Editing entry ${i + 1}`}
                onSave={() => saveEdit(entry.id)}
                onCancel={() => { setEditing(null); setErrors({}) }}
              />
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>📎 Entry {i + 1}</span>
                  <span className={`tag ${entry.active ? 'tag-green' : 'tag-red'}`}>
                    {entry.active ? 'Active' : 'Disabled'}
                  </span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                  {entry.keywords.slice(0, 5).map((kw, j) => (
                    <span key={j} className="tag tag-purple">{kw}</span>
                  ))}
                  {entry.keywords.length > 5 && (
                    <span className="tag tag-purple">+{entry.keywords.length - 5}</span>
                  )}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.55, marginBottom: 12 }}>
                  {truncate(entry.answer, 120)}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => startEdit(entry)}>Edit</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => toggleKBEntry(selectedAppId, entry.id)}>
                    {entry.active ? 'Disable' : 'Enable'}
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={() => deleteKBEntry(selectedAppId, entry.id)}>Delete</button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
