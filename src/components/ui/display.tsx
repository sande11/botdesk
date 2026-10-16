import * as TabsPrimitive from '@radix-ui/react-tabs'
import { Check, Copy, Loader2 } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { toast } from 'sonner'
import { cn } from '@/lib/cn.ts'
import { Button } from './button.tsx'

// ── Card ──────────────────────────────────────────────────────────────────

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-2xl border border-border bg-surface shadow-[var(--shadow-sm)]', className)} {...rest}>
      {children}
    </div>
  )
}

export function CardHeader({ title, description, actions, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-4 pb-3', className)}>
      <div className="flex min-w-[min(100%,14rem)] flex-1 flex-col gap-0.5">
        <h3 className="text-[15px] font-semibold">{title}</h3>
        {description && <p className="text-[13px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

// ── Badge ─────────────────────────────────────────────────────────────────

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'
const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-muted',
  primary: 'bg-primary-soft text-primary-text',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
}

export function Badge({ tone = 'neutral', children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn('inline-flex h-[22px] items-center gap-1.5 rounded-md px-2 font-sans text-xs font-medium tracking-normal whitespace-nowrap', TONES[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
}

// ── Page header ───────────────────────────────────────────────────────────

export function PageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        {back}
        <h1 className="font-display text-[32px] leading-tight tracking-[-0.01em]">{title}</h1>
        {description && <p className="max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

// ── Empty, loading, error states ──────────────────────────────────────────

export function Empty({ icon, title, description, action, className }: { icon?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 px-6 py-14 text-center', className)}>
      {icon && <div className="grid size-12 place-items-center rounded-2xl bg-primary-soft text-primary-text [&_svg]:size-6">{icon}</div>}
      <div className="flex max-w-sm flex-col gap-1">
        <p className="font-semibold">{title}</p>
        {description && <p className="text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-4 animate-spin text-muted', className)} />
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
      <Spinner />
      {label}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-lg bg-surface-2', className)} />
}

export function ErrorBox({ error, className }: { error: unknown; className?: string }) {
  if (!error) return null
  return (
    <div className={cn('rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger', className)}>
      {(error as Error)?.message ?? String(error)}
    </div>
  )
}

export function Notice({ tone = 'info', title, children, className, icon }: { tone?: 'info' | 'warning' | 'success' | 'danger'; title?: ReactNode; children?: ReactNode; className?: string; icon?: ReactNode }) {
  const tones = {
    info: 'border-info/25 bg-info-soft',
    warning: 'border-warning/30 bg-warning-soft',
    success: 'border-success/30 bg-success-soft',
    danger: 'border-danger/30 bg-danger-soft',
  }
  const text = { info: 'text-info', warning: 'text-warning', success: 'text-success', danger: 'text-danger' }
  return (
    <div className={cn('flex gap-3 rounded-xl border px-4 py-3 text-[13px]', tones[tone], className)}>
      {icon && <div className={cn('mt-0.5 [&_svg]:size-4', text[tone])}>{icon}</div>}
      <div className="flex flex-col gap-0.5">
        {title && <p className={cn('font-semibold', text[tone])}>{title}</p>}
        {children && <div className="text-fg/85">{children}</div>}
      </div>
    </div>
  )
}

// ── Copy ──────────────────────────────────────────────────────────────────

export function CopyButton({ value, label = 'Copy', size = 'sm' }: { value: string; label?: string; size?: 'sm' | 'icon-sm' }) {
  const [done, setDone] = useState(false)
  return (
    <Button
      size={size}
      variant="outline"
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        } catch {
          toast.error('Could not copy. Select the text and copy it instead.')
        }
      }}
    >
      {done ? <Check /> : <Copy />}
      {size === 'sm' && (done ? 'Copied' : label)}
    </Button>
  )
}

export function CodeBlock({ code, className, label }: { code: string; className?: string; label?: string }) {
  return (
    <div className={cn('relative overflow-hidden rounded-xl border border-border bg-surface-2', className)}>
      <div className="absolute top-2 right-2">
        <CopyButton value={code} size="icon-sm" label={label ?? 'Copy code'} />
      </div>
      <pre className="scroll-thin overflow-x-auto p-4 pr-14 font-mono text-[12.5px] leading-relaxed text-fg">
        <code>{code}</code>
      </pre>
    </div>
  )
}

export function Secret({ value }: { value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-2 p-2 pl-3">
      <code className="flex-1 truncate font-mono text-[13px]">{value}</code>
      <CopyButton value={value} />
    </div>
  )
}

// ── Tabs ──────────────────────────────────────────────────────────────────

export function Tabs({
  value,
  onChange,
  tabs,
  className,
}: {
  value: string
  onChange: (v: string) => void
  tabs: { value: string; label: ReactNode; hidden?: boolean }[]
  className?: string
}) {
  return (
    <TabsPrimitive.Root value={value} onValueChange={onChange}>
      <TabsPrimitive.List className={cn('scroll-thin -mb-px flex gap-1 overflow-x-auto border-b border-border', className)}>
        {tabs.filter((t) => !t.hidden).map((t) => (
          <TabsPrimitive.Trigger
            key={t.value}
            value={t.value}
            className="relative px-3 pt-1 pb-2.5 text-sm font-medium whitespace-nowrap text-muted transition-colors hover:text-fg data-[state=active]:text-fg data-[state=active]:after:absolute data-[state=active]:after:inset-x-2 data-[state=active]:after:-bottom-px data-[state=active]:after:h-0.5 data-[state=active]:after:rounded-full data-[state=active]:after:bg-primary"
          >
            {t.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  )
}

/** Small segmented control for filters. */
export function Segmented<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; className?: string }) {
  return (
    <div role="radiogroup" className={cn('scroll-thin inline-flex max-w-full overflow-x-auto rounded-[10px] bg-surface-2 p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'h-7 shrink-0 rounded-lg px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors',
            value === o.value ? 'bg-surface text-fg shadow-[var(--shadow-sm)]' : 'text-muted hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ── Stat ──────────────────────────────────────────────────────────────────

export function Stat({ label, value, sub, icon }: { label: ReactNode; value: ReactNode; sub?: ReactNode; icon?: ReactNode }) {
  return (
    <Card className="flex flex-col gap-2 p-4">
      <div className="flex items-center justify-between text-[13px] text-muted">
        {label}
        {icon && <span className="text-subtle [&_svg]:size-4">{icon}</span>}
      </div>
      <div className="text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </Card>
  )
}

/** Thin progress bar (usage vs limit, indexing progress). */
export function Meter({ value, max, className, tone }: { value: number; max: number | null; className?: string; tone?: 'primary' | 'warning' | 'danger' }) {
  const ratio = max ? Math.min(1, value / max) : 0
  const t = tone ?? (ratio > 0.9 ? 'danger' : ratio > 0.75 ? 'warning' : 'primary')
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-surface-3', className)}>
      <div className={cn('h-full rounded-full transition-[width]', { primary: 'bg-primary', warning: 'bg-warning', danger: 'bg-danger' }[t])} style={{ width: `${max ? ratio * 100 : 0}%` }} />
    </div>
  )
}
