/** Bits shared by the knowledge pages. */
import { FileText, Globe, HelpCircle, Map as MapIcon, Type } from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge, Spinner } from '@/components/ui/display.tsx'
import { Field, Input, Select, Switch } from '@/components/ui/form.tsx'
import { useModels } from '@/lib/queries.ts'
import { useWorkspace } from '@/lib/session.tsx'
import { type KnowledgeBase, type Source, SOURCE_TYPES, type SourceKind, type SourceType } from '@/lib/types.ts'

export const KIND_INFO: Record<SourceKind, { label: string; icon: ReactNode }> = {
  file: { label: 'File', icon: <FileText /> },
  url: { label: 'Web page', icon: <Globe /> },
  sitemap: { label: 'Website', icon: <MapIcon /> },
  text: { label: 'Text', icon: <Type /> },
  qa: { label: 'Q&A', icon: <HelpCircle /> },
}

export const SOURCE_TYPE_LABEL: Record<SourceType, string> = {
  statute: 'Statute / Act',
  regulation: 'Regulation',
  case_law: 'Case law',
  constitution: 'Constitution',
  guidance: 'Guidance',
  practice_note: 'Practice note',
  form: 'Form',
  faq: 'FAQ',
  verified_answer: 'Verified answer',
  other: 'Other',
}

export function KindIcon({ kind }: { kind: SourceKind }) {
  return <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted [&_svg]:size-4">{KIND_INFO[kind].icon}</span>
}

export function progressText(s: Pick<Source, 'status' | 'progress'>): string | null {
  const p = s.progress ?? {}
  if (s.status !== 'processing' && s.status !== 'queued') return null
  if (s.status === 'queued') return 'Waiting to index'
  if (p.phase === 'extract' && p.pages) return `Reading page ${p.page ?? 0} of ${p.pages}`
  if (p.phase === 'embed' && p.total) return `Indexing ${p.done ?? 0} of ${p.total} passages`
  if (p.phase === 'crawl') return 'Finding pages'
  return 'Indexing'
}

export function StatusBadge({ source }: { source: Pick<Source, 'status' | 'progress' | 'error'> }) {
  switch (source.status) {
    case 'ready':
      return <Badge tone="success" dot>Ready</Badge>
    case 'failed':
      return <Badge tone="danger" dot>Failed</Badge>
    case 'disabled':
      return <Badge>Disabled</Badge>
    case 'queued':
      return <Badge tone="info"><Spinner className="size-3 text-info" />Queued</Badge>
    default:
      return <Badge tone="info"><Spinner className="size-3 text-info" />{progressText(source)}</Badge>
  }
}

/** Embedding model picker grouped by provider, with prices and notes. */
export function EmbeddingSelect({ value, onChange, legal }: { value: string; onChange: (provider: KnowledgeBase['embedding_provider'], model: string) => void; legal?: boolean }) {
  const models = useModels()
  const list = models.data?.embedding ?? []
  const selected = list.find((m) => `${m.provider}:${m.id}` === value)
  return (
    <Field
      label="Embedding model"
      hint={
        models.data?.fake_ai
          ? 'Fake AI is on: test embeddings are used whatever you pick.'
          : selected?.note ?? (legal ? 'Voyage law-2 is tuned for legal text.' : 'Turns text into vectors for search. Changing it later re-indexes everything.')
      }
    >
      <Select
        value={value}
        onChange={(e) => {
          const [provider, ...rest] = e.target.value.split(':')
          onChange(provider as KnowledgeBase['embedding_provider'], rest.join(':'))
        }}
      >
        {(['openai', 'voyage'] as const).map((p) => (
          <optgroup key={p} label={(p === 'openai' ? 'OpenAI' : 'Voyage AI') + (models.data && !models.data.providers[p]?.available ? ' (add a key)' : '')}>
            {list.filter((m) => m.provider === p).map((m) => (
              <option key={m.id} value={`${m.provider}:${m.id}`}>
                {m.label}{m.perM != null ? ` · $${m.perM} per M tokens` : ''}
              </option>
            ))}
          </optgroup>
        ))}
        {!selected && value && <option value={value}>{value.split(':').slice(1).join(':')} (current)</option>}
      </Select>
    </Field>
  )
}

export interface LegalMeta {
  jurisdiction: string
  source_type: SourceType | ''
  citation: string
  effective_date: string
}

export const emptyLegal = (jurisdiction = ''): LegalMeta => ({ jurisdiction, source_type: '', citation: '', effective_date: '' })

export function legalPatch(m: LegalMeta) {
  return {
    jurisdiction: m.jurisdiction.trim().toUpperCase() || null,
    source_type: m.source_type || null,
    citation: m.citation.trim() || null,
    effective_date: m.effective_date || null,
  }
}

/** Jurisdiction, document type, citation and effective date. */
export function LegalFields({ value, onChange, superseded }: { value: LegalMeta; onChange: (v: LegalMeta) => void; superseded?: { checked: boolean; onChange: (v: boolean) => void } }) {
  const { workspace } = useWorkspace()
  const jurisdictions = workspace.settings.jurisdictions ?? []
  const set = <K extends keyof LegalMeta>(k: K, v: LegalMeta[K]) => onChange({ ...value, [k]: v })
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Jurisdiction" hint="Answers for a jurisdiction only use its sources, plus sources with none set.">
        {jurisdictions.length ? (
          <Select value={value.jurisdiction} onChange={(e) => set('jurisdiction', e.target.value)}>
            <option value="">Any jurisdiction</option>
            {jurisdictions.map((j) => <option key={j} value={j}>{j}</option>)}
            {value.jurisdiction && !jurisdictions.includes(value.jurisdiction) && <option value={value.jurisdiction}>{value.jurisdiction}</option>}
          </Select>
        ) : (
          <Input value={value.jurisdiction} onChange={(e) => set('jurisdiction', e.target.value)} placeholder="MW" maxLength={12} />
        )}
      </Field>
      <Field label="Document type">
        <Select value={value.source_type} onChange={(e) => set('source_type', e.target.value as SourceType | '')}>
          <option value="">Not set</option>
          {SOURCE_TYPES.map((t) => <option key={t} value={t}>{SOURCE_TYPE_LABEL[t]}</option>)}
        </Select>
      </Field>
      <Field label="Citation" optional hint="Shown when the bot cites this source.">
        <Input value={value.citation} onChange={(e) => set('citation', e.target.value)} placeholder="Employment Act (Cap. 55:01)" />
      </Field>
      <Field label="In force from" optional>
        <Input type="date" value={value.effective_date} onChange={(e) => set('effective_date', e.target.value)} />
      </Field>
      {superseded && (
        <div className="sm:col-span-2">
          <Switch
            checked={superseded.checked}
            onChange={superseded.onChange}
            label="Superseded"
            description="Repealed or replaced. The bot stops using it but it stays here for reference."
          />
        </div>
      )}
    </div>
  )
}
