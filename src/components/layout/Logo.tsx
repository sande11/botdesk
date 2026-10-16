export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--primary)" />
      <path d="M9 10.5A2.5 2.5 0 0 1 11.5 8h9A2.5 2.5 0 0 1 23 10.5v7a2.5 2.5 0 0 1-2.5 2.5H15l-4.2 3.4c-.5.4-1.3 0-1.3-.6V20A2.5 2.5 0 0 1 9 17.5z" fill="var(--primary-fg)" />
      <path d="M12.5 12.5h7M12.5 15.5h4.5" stroke="var(--primary)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

export function Logo() {
  return (
    <span className="flex items-center gap-2">
      <LogoMark />
      <span className="font-display text-[22px] leading-none tracking-[-0.01em]">BotDesk</span>
    </span>
  )
}
