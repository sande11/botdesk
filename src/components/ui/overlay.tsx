import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { X } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { cn } from '@/lib/cn.ts'
import { Button } from './button.tsx'

// ── Dialog ────────────────────────────────────────────────────────────────

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
  side,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  /** Slide in from the right as a panel. */
  side?: boolean
}) {
  const width = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size]
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] data-[state=open]:animate-[fade-in_.15s_ease-out]" />
        <DialogPrimitive.Content
          className={cn(
            'fixed z-50 flex flex-col border border-border bg-surface text-fg shadow-[var(--shadow-pop)] focus:outline-none',
            side
              ? 'inset-y-0 right-0 w-full max-w-xl rounded-l-2xl data-[state=open]:animate-[slide-in_.2s_ease-out]'
              : cn('top-1/2 left-1/2 max-h-[90vh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl', width),
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div className="flex flex-col gap-1">
              <DialogPrimitive.Title className="text-base font-semibold">{title}</DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="text-[13px] text-muted">{description}</DialogPrimitive.Description>
              ) : (
                <DialogPrimitive.Description className="sr-only">{typeof title === 'string' ? title : 'Dialog'}</DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close">
                <X />
              </Button>
            </DialogPrimitive.Close>
          </div>
          <div className="scroll-thin flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

/** Asks before something destructive. */
export function useConfirm() {
  const [state, setState] = useState<{ title: string; body?: ReactNode; action: string; resolve: (ok: boolean) => void } | null>(null)
  const confirm = (title: string, opts: { body?: ReactNode; action?: string } = {}) =>
    new Promise<boolean>((resolve) => setState({ title, body: opts.body, action: opts.action ?? 'Delete', resolve }))
  const close = (ok: boolean) => {
    state?.resolve(ok)
    setState(null)
  }
  const element = (
    <Dialog
      open={!!state}
      onOpenChange={(v) => !v && close(false)}
      title={state?.title ?? ''}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)}>Cancel</Button>
          <Button variant="danger" onClick={() => close(true)}>{state?.action}</Button>
        </>
      }
    >
      <div className="text-sm text-muted">{state?.body ?? 'This cannot be undone.'}</div>
    </Dialog>
  )
  return { confirm, element }
}

// ── Dropdown menu ─────────────────────────────────────────────────────────

export const Menu = DropdownPrimitive.Root
export const MenuTrigger = DropdownPrimitive.Trigger

export function MenuContent({ children, align = 'end', className }: { children: ReactNode; align?: 'start' | 'end'; className?: string }) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        align={align}
        sideOffset={6}
        className={cn('z-50 min-w-[200px] rounded-xl border border-border bg-surface p-1 text-sm shadow-[var(--shadow-pop)]', className)}
      >
        {children}
      </DropdownPrimitive.Content>
    </DropdownPrimitive.Portal>
  )
}

export function MenuItem({
  children,
  onSelect,
  danger,
  icon,
}: {
  children: ReactNode
  onSelect?: () => void
  danger?: boolean
  icon?: ReactNode
}) {
  return (
    <DropdownPrimitive.Item
      onSelect={onSelect}
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 outline-none select-none data-[highlighted]:bg-surface-2 [&_svg]:size-4 [&_svg]:text-muted',
        danger && 'text-danger [&_svg]:text-danger',
      )}
    >
      {icon}
      {children}
    </DropdownPrimitive.Item>
  )
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <DropdownPrimitive.Label className="px-2.5 pt-2 pb-1 text-xs font-medium text-subtle">{children}</DropdownPrimitive.Label>
}

export function MenuSeparator() {
  return <DropdownPrimitive.Separator className="my-1 h-px bg-border" />
}

// ── Tooltip ───────────────────────────────────────────────────────────────

export function Tip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={250}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            sideOffset={6}
            className="z-50 max-w-xs rounded-lg bg-fg px-2.5 py-1.5 text-xs text-bg shadow-[var(--shadow-pop)]"
          >
            {content}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  )
}
