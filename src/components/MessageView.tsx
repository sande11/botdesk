/** Renders one chat message the way people see it, plus what the team needs (sources, confidence). */
import { AlertTriangle, BookOpen, ChevronDown, Scale } from 'lucide-react'
import { useState } from 'react'
import { renderMarkdown } from '../../widget/src/markdown.ts'
import { cn } from '@/lib/cn.ts'
import type { Citation, LegalAnswer } from '@/lib/types.ts'
import { Badge } from './ui/display.tsx'

export function citationLabel(c: Pick<Citation, 'title' | 'citation' | 'section'>) {
  const base = c.citation || c.title
  return c.section && !base.includes(c.section) ? `${base} · ${c.section}` : base
}

export function Markdown({ text, citations = 0, className }: { text: string; citations?: number; className?: string }) {
  return <div className={cn('prose-chat text-sm leading-relaxed', className)} dangerouslySetInnerHTML={{ __html: renderMarkdown(text, citations) }} />
}

export function Sources({ citations, defaultOpen }: { citations: Citation[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen)
  if (!citations.length) return null
  return (
    <div className="text-[13px]">
      <button type="button" onClick={() => setOpen(!open)} className="inline-flex items-center gap-1 font-medium text-muted hover:text-fg">
        <BookOpen className="size-3.5" />
        {citations.length} source{citations.length > 1 ? 's' : ''}
        <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <ol className="mt-2 flex flex-col gap-2">
          {citations.map((c) => (
            <li key={c.n} className="rounded-lg border border-border bg-surface p-2.5">
              <div className="flex items-center gap-2">
                <span className="grid size-5 shrink-0 place-items-center rounded-md bg-primary-soft text-[11px] font-semibold text-primary-text">{c.n}</span>
                {c.url ? (
                  <a href={c.url} target="_blank" rel="noreferrer" className="truncate font-medium hover:underline">{citationLabel(c)}</a>
                ) : (
                  <span className="truncate font-medium">{citationLabel(c)}</span>
                )}
                {c.score != null && <span className="ml-auto shrink-0 text-xs text-subtle tabular-nums">{c.score.toFixed(2)}</span>}
              </div>
              <p className="mt-1 line-clamp-3 text-muted">{c.snippet}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

export function LegalCard({ answer }: { answer: LegalAnswer }) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="font-medium">{answer.summary}</p>
      {answer.points.length > 0 && (
        <ul className="list-disc pl-5 text-fg/90">
          {answer.points.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}
      {answer.see_a_lawyer && (
        <div className="flex items-center gap-2 rounded-lg bg-warning-soft px-2.5 py-1.5 text-[13px] text-warning">
          <Scale className="size-4" /> Suggests talking to a lawyer
        </div>
      )}
      {answer.follow_ups.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {answer.follow_ups.map((f) => <span key={f} className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted">{f}</span>)}
        </div>
      )}
    </div>
  )
}

export function ConfidenceBadge({ value, outcome }: { value: number | null; outcome?: string | null }) {
  if (outcome === 'no_answer') {
    return <Badge tone="warning"><AlertTriangle className="size-3" />Not found</Badge>
  }
  if (value == null) return null
  const tone = value >= 0.7 ? 'success' : value >= 0.5 ? 'info' : 'warning'
  return <Badge tone={tone}>{Math.round(value * 100)}% confident</Badge>
}
