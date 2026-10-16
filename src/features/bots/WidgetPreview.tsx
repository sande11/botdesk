/** A static picture of the web widget, updated live as settings change. */
import { Bot as BotIcon, ChevronDown, MessageSquare, Send } from 'lucide-react'
import type { Bot } from '@/lib/types.ts'

function readableOn(hex: string): string {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
  if (!m) return '#ffffff'
  const [r, g, b] = m.slice(1).map((x) => {
    const c = parseInt(x, 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? '#111114' : '#ffffff'
}

export function WidgetPreview({ widget, name, disclaimer }: { widget: Bot['widget']; name: string; disclaimer?: string | null }) {
  const color = widget.primary_color || '#6d5df5'
  const on = readableOn(color)
  const left = widget.position === 'bottom-left'
  return (
    <div
      aria-label="Widget preview"
      className="relative h-[560px] overflow-hidden rounded-2xl border border-border bg-[repeating-linear-gradient(45deg,var(--surface-2),var(--surface-2)_10px,var(--bg)_10px,var(--bg)_20px)]"
    >
      <div className={`absolute bottom-[84px] flex w-[320px] flex-col overflow-hidden rounded-[18px] border border-[#e6e6ec] bg-white text-[#18181b] shadow-[0_24px_64px_rgba(0,0,0,.22)] ${left ? 'left-4' : 'right-4'}`}
        style={{ height: 440, fontFamily: 'ui-sans-serif, system-ui, sans-serif', fontSize: 13.5 }}>
        <div className="flex items-center gap-2.5 px-3.5 py-3" style={{ background: color, color: on }}>
          <span className="grid size-8 place-items-center rounded-full bg-white/20">
            {widget.avatar_url ? <img src={widget.avatar_url} alt="" className="size-full rounded-full object-cover" /> : <BotIcon className="size-4" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{widget.title || name}</div>
            {widget.subtitle && <div className="truncate text-xs opacity-85">{widget.subtitle}</div>}
          </div>
          <ChevronDown className="size-4" />
        </div>
        <div className="flex flex-1 flex-col gap-2.5 overflow-hidden p-3.5">
          <div className="max-w-[86%] rounded-2xl rounded-bl-md bg-[#f6f6f8] px-3 py-2">{widget.welcome_message || 'Hi! How can I help you today?'}</div>
          <div className="max-w-[86%] self-end rounded-2xl rounded-br-md px-3 py-2" style={{ background: color, color: on }}>How long does delivery take?</div>
          <div className="flex max-w-[86%] flex-col gap-1">
            <div className="rounded-2xl rounded-bl-md bg-[#f6f6f8] px-3 py-2">
              Orders arrive in 3 to 5 working days
              {widget.show_sources !== false && (
                <span className="mx-0.5 inline-grid h-4 min-w-4 place-items-center rounded-[5px] px-1 align-[2px] text-[10px] font-semibold" style={{ background: `${color}29`, color }}>1</span>
              )}
              .
            </div>
            {widget.show_sources !== false && <span className="text-[11.5px] text-[#6b6b76]">1 source</span>}
            {disclaimer && <span className="text-[11px] text-[#6b6b76]">{disclaimer}</span>}
          </div>
          {!!widget.suggested_questions?.length && (
            <div className="mt-auto flex flex-wrap gap-1.5">
              {widget.suggested_questions.slice(0, 4).map((q) => (
                <span key={q} className="rounded-full border border-[#e6e6ec] px-2.5 py-1 text-xs">{q}</span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 border-t border-[#e6e6ec] p-2.5">
          <div className="h-9 flex-1 rounded-xl border border-[#e6e6ec] px-3 py-2 text-[#9a9aa5]">Type your question…</div>
          <span className="grid size-9 place-items-center rounded-[10px]" style={{ background: color, color: on }}><Send className="size-4" /></span>
        </div>
      </div>
      <div className={`absolute bottom-4 flex h-14 items-center gap-2 rounded-full px-4 font-semibold shadow-[0_8px_24px_rgba(0,0,0,.18)] ${left ? 'left-4' : 'right-4'} ${widget.launcher_label ? '' : 'w-14 justify-center px-0'}`}
        style={{ background: color, color: on }}>
        <MessageSquare className="size-6" />
        {widget.launcher_label && <span className="text-[15px]">{widget.launcher_label}</span>}
      </div>
    </div>
  )
}
