import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppsContext } from '../context/AppsContext.js'

const EMPTY_FORM = { name: '', url: '', primaryColor: '#7c6df8', botName: 'AI Assistant', welcomeMessage: 'Hi! How can I help you today?' }

/* ── Shared form body (create + edit modals) ─────────────────────── */
function FormBody({ form, setForm, errors, showCustomize, setShowCustomize, onSave, saveLabel }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label">
          App name <span style={{ color: 'var(--red)' }}>*</span>
        </label>
        <input
          className="form-input"
          placeholder="My E-Commerce Store"
          value={form.name}
          onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
          onKeyDown={(e) => e.key === 'Enter' && onSave()}
          maxLength={100}
          autoFocus
        />
        {errors.name && (
          <div style={{ color: 'var(--red)', fontSize: 11, marginTop: 4 }}>{errors.name}</div>
        )}
      </div>

      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label">Website URL</label>
        <input
          className="form-input"
          placeholder="https://example.com"
          value={form.url}
          onChange={(e) => setForm((p) => ({ ...p, url: e.target.value }))}
          maxLength={200}
        />
      </div>

      <button
        type="button"
        onClick={() => setShowCustomize((s) => !s)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: 'var(--text3)', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font-sans)', padding: 0, width: 'fit-content' }}
      >
        <span style={{ fontSize: 10, display: 'inline-block', transform: showCustomize ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>▶</span>
        Customize widget (optional)
      </button>

      {showCustomize && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingLeft: 14, borderLeft: '2px solid var(--border2)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Bot name</label>
              <input
                className="form-input"
                placeholder="AI Assistant"
                value={form.botName}
                onChange={(e) => setForm((p) => ({ ...p, botName: e.target.value }))}
                maxLength={50}
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Accent color</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="color"
                  value={form.primaryColor}
                  onChange={(e) => setForm((p) => ({ ...p, primaryColor: e.target.value }))}
                  style={{ width: 38, height: 36, borderRadius: 6, border: '1px solid var(--border2)', cursor: 'pointer', padding: 2, background: 'var(--bg3)', flexShrink: 0 }}
                />
                <input
                  className="form-input"
                  value={form.primaryColor}
                  onChange={(e) => setForm((p) => ({ ...p, primaryColor: e.target.value }))}
                  maxLength={7}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button className="btn btn-primary" onClick={onSave}>{saveLabel}</button>
      </div>
    </div>
  )
}

/* ── Small reusable modal shell ─────────────────────────────────── */
function Modal({ onClose, children }) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{ background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 'var(--radius)', padding: 28, width: 460, boxShadow: 'var(--shadow)', animation: 'fadeIn 0.18s ease both' }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

export default function Apps() {
  const navigate  = useNavigate()
  const { apps, selectedAppId, setSelectedAppId, addApp, updateApp, deleteApp, toggleApp } = useAppsContext()

  const [modal,         setModal]         = useState(null)  // 'create' | 'edit:<id>' | 'delete:<id>'
  const [form,          setForm]          = useState(EMPTY_FORM)
  const [errors,        setErrors]        = useState({})
  const [showCustomize, setShowCustomize] = useState(false)

  /* ── Helpers ──────────────────────────────────────────────────── */
  const openCreate = () => {
    setForm(EMPTY_FORM)
    setErrors({})
    setShowCustomize(false)
    setModal('create')
  }

  const openEdit = (app) => {
    setForm({ name: app.name, url: app.url, primaryColor: app.primaryColor, botName: app.botName, welcomeMessage: app.welcomeMessage })
    setErrors({})
    setShowCustomize(true)
    setModal(`edit:${app.id}`)
  }

  const closeModal = () => { setModal(null); setErrors({}) }

  const validate = (f) => {
    const e = {}
    if (!f.name.trim()) e.name = 'App name is required.'
    return e
  }

  const saveCreate = () => {
    const errs = validate(form)
    if (Object.keys(errs).length) { setErrors(errs); return }
    const app = addApp(form)
    closeModal()
    // Take the user straight to KB so they can start adding entries
    navigate('/knowledge')
  }

  const saveEdit = (id) => {
    const errs = validate(form)
    if (Object.keys(errs).length) { setErrors(errs); return }
    updateApp(id, form)
    closeModal()
  }

  const confirmDelete = (app) => setModal(`delete:${app.id}`)

  const execDelete = (id) => { deleteApp(id); closeModal() }

  const goToKB = (app) => {
    setSelectedAppId(app.id)
    navigate('/knowledge')
  }

  /* ── Derived modal state ──────────────────────────────────────── */
  const isCreate   = modal === 'create'
  const editId     = modal?.startsWith('edit:')   ? modal.slice(5)   : null
  const deleteId   = modal?.startsWith('delete:') ? modal.slice(7)   : null
  const editApp    = editId   ? apps.find((a) => a.id === editId)   : null
  const deleteApp_ = deleteId ? apps.find((a) => a.id === deleteId) : null

  return (
    <div className="animate-fade-in">
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div className="page-title">Apps</div>
          <div className="page-sub" style={{ margin: 0 }}>
            Each app has its own isolated knowledge base &nbsp;·&nbsp; {apps.length} app{apps.length !== 1 ? 's' : ''}
          </div>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>+ New app</button>
      </div>

      {/* App grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
        {apps.map((app) => {
          const kbCount    = app.knowledgeBase.length
          const activeCount = app.knowledgeBase.filter((e) => e.active).length
          const isEmpty    = kbCount === 0
          const isSelected = selectedAppId === app.id

          return (
            <div
              key={app.id}
              className="card"
              style={{
                opacity:     app.active ? 1 : 0.55,
                borderColor: isSelected ? app.primaryColor : undefined,
                transition:  'border-color 0.15s, opacity 0.15s',
                display:     'flex', flexDirection: 'column',
              }}
            >
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                    background: app.primaryColor + '22',
                    border: `2px solid ${app.primaryColor}55`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
                  }}>🌐</div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{app.name}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 1 }}>
                      {app.url || <em style={{ opacity: 0.6 }}>No URL set</em>}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                  {isSelected && <span className="tag tag-purple" style={{ fontSize: 10 }}>Selected</span>}
                  <span className={`tag ${app.active ? 'tag-green' : 'tag-red'}`}>
                    {app.active ? 'Active' : 'Off'}
                  </span>
                </div>
              </div>

              {/* KB status — empty vs. configured */}
              {isEmpty ? (
                <div style={{
                  flex: 1, marginBottom: 14,
                  padding: '14px 16px',
                  background: 'var(--amber-bg)',
                  border: '1px dashed rgba(251,191,36,0.35)',
                  borderRadius: 'var(--radius-sm)',
                  display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  <span style={{ fontSize: 18 }}>📭</span>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--amber)' }}>No knowledge base yet</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 2 }}>
                      Add Q&amp;A entries so the chatbot knows how to respond.
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{
                  flex: 1, marginBottom: 14,
                  display: 'flex', gap: 0,
                  background: 'var(--bg3)', borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)', overflow: 'hidden',
                }}>
                  {[
                    { label: 'KB entries', value: kbCount,    color: app.primaryColor },
                    { label: 'Active',     value: activeCount, color: 'var(--green)'  },
                    { label: 'Bot',        value: app.botName, color: 'var(--text)'   },
                  ].map((s, i) => (
                    <div key={i} style={{ flex: 1, padding: '10px 12px', textAlign: 'center', borderRight: i < 2 ? '1px solid var(--border)' : 'none' }}>
                      <div style={{ fontSize: i < 2 ? 19 : 12.5, fontWeight: 700, color: s.color, lineHeight: 1.2 }}>{s.value}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--text3)', marginTop: 2 }}>{s.label}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* API key */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: app.primaryColor, flexShrink: 0 }} />
                <code style={{ fontSize: 10.5, color: 'var(--text3)', background: 'var(--bg3)', padding: '3px 8px', borderRadius: 4, flex: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                  {app.apiKey
                    ? app.apiKey.slice(0, 20) + '••••'
                    : (app.apiKeys?.find((k) => k.active)?.key_prefix ?? '••••••••••••••••') + '••••••••'}
                </code>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 6 }}>
                {isEmpty ? (
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => goToKB(app)}
                    style={{ flex: 1, background: 'var(--amber)', color: '#000' }}
                  >
                    + Add knowledge base
                  </button>
                ) : (
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => goToKB(app)}
                    style={{ flex: 1 }}
                  >
                    {isSelected ? '📚 View KB' : 'Open KB'}
                  </button>
                )}
                <button className="btn btn-ghost btn-sm" onClick={() => openEdit(app)}>Edit</button>
                <button className="btn btn-ghost btn-sm" onClick={() => toggleApp(app.id)}>
                  {app.active ? 'Disable' : 'Enable'}
                </button>
                <button className="btn btn-danger btn-sm" onClick={() => confirmDelete(app)}>Delete</button>
              </div>
            </div>
          )
        })}

        {/* Ghost "add" card — always the last cell */}
        <button
          onClick={openCreate}
          style={{
            background: 'transparent',
            border: '2px dashed var(--border2)',
            borderRadius: 'var(--radius)',
            minHeight: 200,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 10,
            cursor: 'pointer', color: 'var(--text3)',
            transition: 'border-color 0.15s, color 0.15s',
            fontFamily: 'var(--font-sans)',
            padding: 24,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent2)' }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border2)'; e.currentTarget.style.color = 'var(--text3)' }}
        >
          <div style={{ width: 40, height: 40, borderRadius: '50%', border: '2px dashed currentColor', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>+</div>
          <div style={{ fontSize: 13, fontWeight: 500 }}>New app</div>
          <div style={{ fontSize: 12, opacity: 0.7, textAlign: 'center', lineHeight: 1.5 }}>Create an app, then<br />add its knowledge base</div>
        </button>
      </div>

      {/* ── Create modal ─────────────────────────────────────────── */}
      {isCreate && (
        <Modal onClose={closeModal}>
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: 20, marginBottom: 4 }}>New app</div>
            <div style={{ fontSize: 13, color: 'var(--text2)' }}>
              Give it a name — you can add the knowledge base afterwards.
            </div>
          </div>
          <FormBody
            form={form} setForm={setForm} errors={errors}
            showCustomize={showCustomize} setShowCustomize={setShowCustomize}
            onSave={saveCreate} saveLabel="Create app →"
          />
          <button className="btn btn-ghost" onClick={closeModal} style={{ marginTop: 8, width: '100%', justifyContent: 'center' }}>Cancel</button>
        </Modal>
      )}

      {/* ── Edit modal ───────────────────────────────────────────── */}
      {editApp && (
        <Modal onClose={closeModal}>
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: 20, marginBottom: 4 }}>Edit app</div>
            <div style={{ fontSize: 13, color: 'var(--text2)' }}>{editApp.name}</div>
          </div>
          <FormBody
            form={form} setForm={setForm} errors={errors}
            showCustomize={showCustomize} setShowCustomize={setShowCustomize}
            onSave={() => saveEdit(editApp.id)} saveLabel="Save changes"
          />
          <button className="btn btn-ghost" onClick={closeModal} style={{ marginTop: 8, width: '100%', justifyContent: 'center' }}>Cancel</button>
        </Modal>
      )}

      {/* ── Delete confirmation modal ─────────────────────────────── */}
      {deleteApp_ && (
        <Modal onClose={closeModal}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>
            Delete &ldquo;{deleteApp_.name}&rdquo;?
          </div>
          <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6, marginBottom: 24 }}>
            This permanently deletes the app and all{' '}
            <strong>
              {deleteApp_.knowledgeBase.length} knowledge base{' '}
              {deleteApp_.knowledgeBase.length === 1 ? 'entry' : 'entries'}
            </strong>.
            This action cannot be undone.
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost btn-sm" onClick={closeModal}>Cancel</button>
            <button className="btn btn-danger btn-sm" onClick={() => execDelete(deleteApp_.id)}>Delete app</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
