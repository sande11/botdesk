/** Add files, web pages, a whole site, pasted text or a Q&A pair to a knowledge base. */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, FileUp, Globe, HelpCircle, Type, X } from 'lucide-react'
import { type ReactNode, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button.tsx'
import { Notice, Segmented, Spinner } from '@/components/ui/display.tsx'
import { Field, Input, Select, Textarea } from '@/components/ui/form.tsx'
import { Dialog } from '@/components/ui/overlay.tsx'
import { friendlyDbError, unwrap } from '@/lib/api.ts'
import { cn } from '@/lib/cn.ts'
import { bytes } from '@/lib/format.ts'
import { useWorkspace } from '@/lib/session.tsx'
import { supabase } from '@/lib/supabase.ts'
import type { KnowledgeBase } from '@/lib/types.ts'
import { emptyLegal, LegalFields, legalPatch, type LegalMeta } from './shared.tsx'

type Mode = 'files' | 'web' | 'text' | 'qa'
const ACCEPT = '.pdf,.docx,.txt,.md,.markdown,.csv,.html,.htm,.json'
const ACCEPT_RE = /\.(pdf|docx|txt|md|markdown|csv|html?|json)$/i
const MAX_BYTES = 50 * 1024 * 1024

interface Pending {
  file: File
  state: 'waiting' | 'uploading' | 'done' | 'error'
  error?: string
}

export function AddSourceDialog({ kb, open, onOpenChange }: { kb: KnowledgeBase; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { workspace } = useWorkspace()
  const qc = useQueryClient()
  const [mode, setMode] = useState<Mode>('files')
  const [files, setFiles] = useState<Pending[]>([])
  const [drag, setDrag] = useState(false)
  const [url, setUrl] = useState('')
  const [crawl, setCrawl] = useState<'page' | 'site'>('page')
  const [maxPages, setMaxPages] = useState(100)
  const [refresh, setRefresh] = useState('')
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [legal, setLegal] = useState<LegalMeta>(emptyLegal(workspace.settings.default_jurisdiction ?? ''))
  const input = useRef<HTMLInputElement>(null)

  const reset = () => {
    setFiles([])
    setUrl('')
    setTitle('')
    setText('')
    setQuestion('')
    setAnswer('')
  }
  const done = (msg: string) => {
    qc.invalidateQueries({ queryKey: ['sources', kb.id] })
    qc.invalidateQueries({ queryKey: ['kb-stats', workspace.id] })
    toast.success(msg)
  }
  const base = () => ({ workspace_id: workspace.id, knowledge_base_id: kb.id, ...(kb.legal ? legalPatch(legal) : {}) })

  const addFiles = (list: FileList | File[]) => {
    const next: Pending[] = []
    for (const f of Array.from(list)) {
      if (!ACCEPT_RE.test(f.name)) next.push({ file: f, state: 'error', error: 'Unsupported type' })
      else if (f.size > MAX_BYTES) next.push({ file: f, state: 'error', error: 'Larger than 50 MB' })
      else next.push({ file: f, state: 'waiting' })
    }
    setFiles((cur) => [...cur.filter((c) => !next.some((n) => n.file.name === c.file.name)), ...next])
  }

  const upload = useMutation({
    mutationFn: async () => {
      let ok = 0
      for (let i = 0; i < files.length; i++) {
        const p = files[i]
        if (p.state !== 'waiting') continue
        setFiles((cur) => cur.map((c, j) => (j === i ? { ...c, state: 'uploading' } : c)))
        try {
          const id = crypto.randomUUID()
          const safe = p.file.name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+/, '').slice(-120) || 'file'
          const path = `${workspace.id}/${id}/${safe}`
          const { error } = await supabase.storage.from('sources').upload(path, p.file, { contentType: p.file.type || undefined, upsert: false })
          if (error) throw new Error(error.message)
          const { error: e2 } = await supabase.from('sources').insert({
            ...base(), id, kind: 'file', title: p.file.name.replace(/\.[^.]+$/, ''), storage_path: path,
            mime_type: p.file.type || null, bytes: p.file.size,
          })
          if (e2) {
            await supabase.storage.from('sources').remove([path])
            throw new Error(friendlyDbError(e2.message, e2.code))
          }
          ok++
          setFiles((cur) => cur.map((c, j) => (j === i ? { ...c, state: 'done' } : c)))
        } catch (err) {
          setFiles((cur) => cur.map((c, j) => (j === i ? { ...c, state: 'error', error: (err as Error).message } : c)))
        }
      }
      return ok
    },
    onSuccess: (ok) => {
      if (!ok) return
      done(`${ok} file${ok > 1 ? 's' : ''} added. Indexing has started.`)
      setFiles((cur) => {
        const left = cur.filter((c) => c.state === 'error')
        if (!left.length) onOpenChange(false)
        return left
      })
    },
  })

  const addOther = useMutation({
    mutationFn: async () => {
      if (mode === 'web') {
        let u: URL
        try {
          u = new URL(url.trim().match(/^https?:\/\//i) ? url.trim() : `https://${url.trim()}`)
        } catch {
          throw new Error('Enter a valid web address.')
        }
        unwrap(await supabase.from('sources').insert({
          ...base(), kind: crawl === 'site' ? 'sitemap' : 'url', url: u.toString(), title: title.trim() || u.hostname + (u.pathname === '/' ? '' : u.pathname),
          refresh_hours: refresh ? Number(refresh) : null,
          metadata: crawl === 'site' ? { max_pages: maxPages } : {},
        }))
        return crawl === 'site' ? 'Website added. BotDesk is finding its pages.' : 'Page added. Indexing has started.'
      }
      if (mode === 'text') {
        if (!text.trim()) throw new Error('Paste some text.')
        unwrap(await supabase.from('sources').insert({ ...base(), kind: 'text', title: title.trim() || text.trim().slice(0, 60), content: text }))
        return 'Text added. Indexing has started.'
      }
      if (!question.trim() || !answer.trim()) throw new Error('Fill in the question and the answer.')
      unwrap(await supabase.from('sources').insert({ ...base(), kind: 'qa', title: question.trim().slice(0, 200), question: question.trim(), content: answer.trim() }))
      return 'Answer added.'
    },
    onSuccess: (msg) => {
      done(msg)
      reset()
      onOpenChange(false)
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const waiting = files.filter((f) => f.state === 'waiting').length
  const busy = upload.isPending || addOther.isPending
  const canSubmit = mode === 'files' ? waiting > 0 : mode === 'web' ? !!url.trim() : mode === 'text' ? !!text.trim() : !!(question.trim() && answer.trim())

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!busy) onOpenChange(v)
      }}
      title={`Add to ${kb.name}`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!canSubmit}
            onClick={() => (mode === 'files' ? upload.mutate() : addOther.mutate())}
          >
            {mode === 'files' ? (waiting > 1 ? `Upload ${waiting} files` : 'Upload') : 'Add'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <Segmented<Mode>
          value={mode}
          onChange={setMode}
          className="self-start"
          options={[
            { value: 'files', label: <Lbl icon={<FileUp />}>Files</Lbl> },
            { value: 'web', label: <Lbl icon={<Globe />}>Website</Lbl> },
            { value: 'text', label: <Lbl icon={<Type />}>Text</Lbl> },
            { value: 'qa', label: <Lbl icon={<HelpCircle />}>Q&amp;A</Lbl> },
          ]}
        />

        {mode === 'files' && (
          <>
            <button
              type="button"
              onClick={() => input.current?.click()}
              onDragOver={(e) => {
                e.preventDefault()
                setDrag(true)
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDrag(false)
                addFiles(e.dataTransfer.files)
              }}
              className={cn(
                'flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors',
                drag ? 'border-primary bg-primary-soft' : 'border-border hover:border-border-strong hover:bg-surface-2',
              )}
            >
              <FileUp className="size-6 text-muted" />
              <span className="text-sm font-medium">Drop files here or click to choose</span>
              <span className="text-xs text-muted">PDF, Word, text, Markdown, CSV, HTML or JSON · up to 50 MB each</span>
            </button>
            <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => e.target.files && addFiles(e.target.files)} />
            {!!files.length && (
              <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
                {files.map((p, i) => (
                  <li key={p.file.name} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{p.file.name}</span>
                    <span className="text-xs text-muted tabular-nums">{bytes(p.file.size)}</span>
                    {p.state === 'uploading' && <Spinner />}
                    {p.state === 'done' && <Check className="size-4 text-success" />}
                    {p.state === 'error' && <span className="text-xs text-danger">{p.error}</span>}
                    {(p.state === 'waiting' || p.state === 'error') && (
                      <button type="button" aria-label={`Remove ${p.file.name}`} className="text-subtle hover:text-fg" onClick={() => setFiles((c) => c.filter((_, j) => j !== i))}>
                        <X className="size-4" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted">Scanned PDFs need text in them (OCR) to be searchable. Large PDFs are indexed in the background, page by page.</p>
          </>
        )}

        {mode === 'web' && (
          <>
            <Field label="Web address">
              <Input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/help" inputMode="url" />
            </Field>
            <Segmented
              value={crawl}
              onChange={setCrawl}
              className="self-start"
              options={[{ value: 'page', label: 'Just this page' }, { value: 'site', label: 'Whole site' }]}
            />
            {crawl === 'site' && (
              <Notice tone="info">
                Give a sitemap (…/sitemap.xml) for the best results, or a page whose links should be followed. Only pages on the same site are added.
              </Notice>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" optional>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Help centre" />
              </Field>
              {crawl === 'site' ? (
                <Field label="Up to">
                  <Select value={maxPages} onChange={(e) => setMaxPages(Number(e.target.value))}>
                    {[25, 50, 100, 250, 500].map((n) => <option key={n} value={n}>{n} pages</option>)}
                  </Select>
                </Field>
              ) : <div />}
              <Field label="Keep up to date" hint="Re-reads the page and re-indexes it if it changed.">
                <Select value={refresh} onChange={(e) => setRefresh(e.target.value)}>
                  <option value="">Never</option>
                  <option value="24">Every day</option>
                  <option value="168">Every week</option>
                  <option value="720">Every month</option>
                </Select>
              </Field>
            </div>
          </>
        )}

        {mode === 'text' && (
          <>
            <Field label="Name" optional>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Returns policy" />
            </Field>
            <Field label="Text" hint="Markdown headings (#, ##) help BotDesk keep sections together.">
              <Textarea autoFocus rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste text here…" />
            </Field>
          </>
        )}

        {mode === 'qa' && (
          <>
            <Field label="Question">
              <Input autoFocus value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="How long does delivery take?" />
            </Field>
            <Field label="Answer" hint="Each Q&A is indexed as one passage, so a customer asking the same thing finds it directly.">
              <Textarea rows={5} value={answer} onChange={(e) => setAnswer(e.target.value)} />
            </Field>
          </>
        )}

        {kb.legal && (
          <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
            <p className="text-[13px] font-semibold">Legal details{mode === 'files' && files.length > 1 ? ' (applied to every file)' : ''}</p>
            <LegalFields value={legal} onChange={setLegal} />
          </div>
        )}
      </div>
    </Dialog>
  )
}

function Lbl({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return <span className="inline-flex items-center gap-1.5 [&_svg]:size-3.5">{icon}{children}</span>
}
