import * as SwitchPrimitive from '@radix-ui/react-switch'
import { cloneElement, type InputHTMLAttributes, isValidElement, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes, useId } from 'react'
import { cn } from '@/lib/cn.ts'

const control =
  'w-full rounded-[10px] border border-border bg-surface px-3 text-sm text-fg shadow-[var(--shadow-sm)] ' +
  'placeholder:text-subtle transition-colors hover:border-border-strong ' +
  'focus:border-primary focus:outline-none focus:ring-3 focus:ring-[var(--ring)] ' +
  'disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-danger'

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(control, 'h-9', className)} {...props} />
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(control, 'min-h-[84px] py-2 leading-relaxed', className)} {...props} />
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        control,
        'h-9 appearance-none bg-[url("data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%2716%27%20height=%2716%27%20viewBox=%270%200%2024%2024%27%20fill=%27none%27%20stroke=%27%238b8b98%27%20stroke-width=%272%27%3E%3Cpath%20d=%27m6%209%206%206%206-6%27/%3E%3C/svg%3E")] bg-[position:right_10px_center] bg-no-repeat pr-9',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  )
}

export function Field({
  label,
  hint,
  error,
  children,
  className,
  htmlFor,
  optional,
}: {
  label: ReactNode
  hint?: ReactNode
  error?: string | null
  children: ReactNode
  className?: string
  htmlFor?: string
  optional?: boolean
}) {
  // Link the label (and hint) to a single control child automatically.
  const auto = useId()
  const child = isValidElement<{ id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }>(children) ? children : null
  const id = htmlFor ?? child?.props.id ?? (child ? auto : undefined)
  const hintId = `${auto}-hint`
  const note = error || hint
  const control = child && !htmlFor
    ? cloneElement(child, {
      id,
      ...(note ? { 'aria-describedby': hintId } : {}),
      ...(error ? { 'aria-invalid': true } : {}),
    })
    : children
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-fg">
        {label}
        {optional && <span className="ml-1 font-normal text-subtle">(optional)</span>}
      </label>
      {control}
      {error ? <p id={hintId} className="text-xs text-danger">{error}</p> : hint ? <p id={hintId} className="text-xs text-muted">{hint}</p> : null}
    </div>
  )
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: ReactNode
  description?: ReactNode
  disabled?: boolean
}) {
  const id = useId()
  const sw = (
    <SwitchPrimitive.Root
      id={id}
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors',
        'data-[state=checked]:bg-primary data-[state=unchecked]:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-50',
      )}
    >
      <SwitchPrimitive.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[18px]" />
    </SwitchPrimitive.Root>
  )
  if (!label) return sw
  return (
    <div className="flex items-start justify-between gap-4">
      <label htmlFor={id} className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        {description && <span className="text-xs text-muted">{description}</span>}
      </label>
      {sw}
    </div>
  )
}

export function Checkbox({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: ReactNode
  description?: ReactNode
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-[10px] border border-border p-3 hover:bg-surface-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 accent-[var(--primary)]"
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        {description && <span className="text-xs text-muted">{description}</span>}
      </span>
    </label>
  )
}

/** Comma/Enter separated values, shown as removable chips. */
export function TagInput({
  value,
  onChange,
  placeholder,
  transform = (s) => s.trim(),
}: {
  value: string[]
  onChange: (v: string[]) => void
  placeholder?: string
  transform?: (s: string) => string
}) {
  const add = (raw: string) => {
    const parts = raw.split(/[,\n]/).map(transform).filter(Boolean)
    if (parts.length) onChange([...new Set([...value, ...parts])])
  }
  return (
    <div className={cn(control, 'flex min-h-9 flex-wrap items-center gap-1.5 py-1.5')}>
      {value.map((v) => (
        <span key={v} className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-0.5 text-[13px]">
          {v}
          <button type="button" aria-label={`Remove ${v}`} className="text-subtle hover:text-fg" onClick={() => onChange(value.filter((x) => x !== v))}>
            ×
          </button>
        </span>
      ))}
      <input
        className="min-w-[8rem] flex-1 bg-transparent text-sm outline-none placeholder:text-subtle"
        placeholder={value.length ? '' : placeholder}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            add(e.currentTarget.value)
            e.currentTarget.value = ''
          } else if (e.key === 'Backspace' && !e.currentTarget.value && value.length) {
            onChange(value.slice(0, -1))
          }
        }}
        onBlur={(e) => {
          add(e.currentTarget.value)
          e.currentTarget.value = ''
        }}
        onPaste={(e) => {
          const text = e.clipboardData.getData('text')
          if (/[,\n]/.test(text)) {
            e.preventDefault()
            add(text)
          }
        }}
      />
    </div>
  )
}
