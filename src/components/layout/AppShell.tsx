import { useQuery } from '@tanstack/react-query'
import {
  Bot,
  BookOpen,
  Check,
  Contrast,
  ChevronsUpDown,
  FlaskConical,
  Gauge,
  Inbox,
  LogOut,
  Menu as MenuIcon,
  Monitor,
  Moon,
  Plus,
  Scale,
  Settings,
  Shield,
  Sun,
  X,
} from 'lucide-react'
import { type ReactNode, Suspense, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { cn } from '@/lib/cn.ts'
import { initials } from '@/lib/format.ts'
import { useContrast, useMemberships, useProfile, useTheme, useWorkspace } from '@/lib/session.tsx'
import { supabase } from '@/lib/supabase.ts'
import { Loading } from '../ui/display.tsx'
import { Logo } from './Logo.tsx'
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '../ui/overlay.tsx'

function useCounts() {
  const { workspace, can } = useWorkspace()
  return useQuery({
    queryKey: ['nav-counts', workspace.id],
    refetchInterval: 30_000,
    queryFn: async () => {
      const [handoff, review] = await Promise.all([
        supabase.from('conversations').select('id', { count: 'exact', head: true }).eq('workspace_id', workspace.id).eq('status', 'handoff'),
        can('reviewer')
          ? supabase.from('review_items').select('id', { count: 'exact', head: true }).eq('workspace_id', workspace.id).eq('status', 'pending')
          : Promise.resolve({ count: 0 }),
      ])
      return { handoff: handoff.count ?? 0, review: review.count ?? 0 }
    },
  })
}

function NavItem({ to, icon, label, badge, end }: { to: string; icon: ReactNode; label: string; badge?: number; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'flex h-9 items-center gap-2.5 rounded-[10px] px-2.5 text-[14px] font-medium transition-colors [&_svg]:size-[18px]',
          isActive ? 'bg-surface text-fg shadow-[var(--shadow-sm)] ring-1 ring-border [&_svg]:text-primary' : 'text-muted hover:bg-surface-2 hover:text-fg',
        )
      }
    >
      {icon}
      <span className="flex-1 truncate">{label}</span>
      {!!badge && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-fg">{badge > 99 ? '99+' : badge}</span>}
    </NavLink>
  )
}

function WorkspaceSwitcher() {
  const { workspace, role } = useWorkspace()
  const memberships = useMemberships()
  const navigate = useNavigate()
  return (
    <Menu>
      <MenuTrigger className="flex w-full items-center gap-2.5 rounded-xl p-2 text-left hover:bg-surface-2 focus-visible:outline-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-[13px] font-semibold text-primary-fg">
          {initials(workspace.name)}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-semibold">{workspace.name}</span>
          <span className="truncate text-xs text-muted capitalize">{workspace.plan} plan · {role}</span>
        </span>
        <ChevronsUpDown className="size-4 text-subtle" />
      </MenuTrigger>
      <MenuContent align="start" className="w-64">
        <MenuLabel>Workspaces</MenuLabel>
        {(memberships.data ?? []).map((m) => (
          <MenuItem key={m.workspace_id} onSelect={() => navigate(`/w/${m.workspaces!.slug}`)} icon={m.workspace_id === workspace.id ? <Check /> : <span className="size-4" />}>
            <span className="truncate">{m.workspaces!.name}</span>
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem icon={<Plus />} onSelect={() => navigate('/new')}>New workspace</MenuItem>
      </MenuContent>
    </Menu>
  )
}

function UserMenu() {
  const profile = useProfile()
  const [theme, setTheme] = useTheme()
  const [contrast, setContrast] = useContrast()
  const navigate = useNavigate()
  const name = profile.data?.full_name || profile.data?.email || 'You'
  return (
    <Menu>
      <MenuTrigger className="flex w-full items-center gap-2.5 rounded-xl p-2 text-left hover:bg-surface-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-3 text-xs font-semibold">{initials(name)}</span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{profile.data?.full_name || 'Account'}</span>
          <span className="truncate text-xs text-muted">{profile.data?.email}</span>
        </span>
      </MenuTrigger>
      <MenuContent align="start" className="w-60">
        <MenuLabel>Theme</MenuLabel>
        {([['light', Sun, 'Light'], ['dark', Moon, 'Dark'], ['system', Monitor, 'System']] as const).map(([v, Icon, label]) => (
          <MenuItem key={v} icon={<Icon />} onSelect={() => setTheme(v)}>
            <span className="flex-1">{label}</span>
            {theme === v && <Check className="size-4 text-primary" />}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuLabel>Contrast</MenuLabel>
        {([['standard', 'Standard'], ['medium', 'Medium'], ['high', 'High']] as const).map(([v, label]) => (
          <MenuItem key={v} icon={<Contrast />} onSelect={() => setContrast(v)}>
            <span className="flex-1">{label}</span>
            {contrast === v && <Check className="size-4 text-primary" />}
          </MenuItem>
        ))}
        {profile.data?.is_platform_admin && (
          <>
            <MenuSeparator />
            <MenuItem icon={<Shield />} onSelect={() => navigate('/platform')}>Platform admin</MenuItem>
          </>
        )}
        <MenuSeparator />
        <MenuItem icon={<LogOut />} onSelect={() => supabase.auth.signOut()}>Sign out</MenuItem>
      </MenuContent>
    </Menu>
  )
}

export function AppShell() {
  const { base, legal, can } = useWorkspace()
  const counts = useCounts()
  const [open, setOpen] = useState(false)
  const location = useLocation()
  // Close the mobile drawer when the route changes.
  const [path, setPath] = useState(location.pathname)
  if (path !== location.pathname) {
    setPath(location.pathname)
    setOpen(false)
  }

  const nav = (
    <nav className="flex h-full flex-col gap-4 p-3" aria-label="Main">
      <div className="flex items-center justify-between px-2 pt-1">
        <Logo />
        <button className="rounded-lg p-1.5 text-muted hover:bg-surface-2 lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu">
          <X className="size-5" />
        </button>
      </div>
      <WorkspaceSwitcher />
      <div className="flex flex-col gap-0.5">
        <NavItem to={`${base}`} end icon={<Gauge />} label="Overview" />
        <NavItem to={`${base}/inbox`} icon={<Inbox />} label="Inbox" badge={counts.data?.handoff} />
        <NavItem to={`${base}/bots`} icon={<Bot />} label="Bots" />
        <NavItem to={`${base}/knowledge`} icon={<BookOpen />} label="Knowledge" />
        {can('reviewer') && (legal || !!counts.data?.review) && (
          <NavItem to={`${base}/review`} icon={<Scale />} label="Review" badge={counts.data?.review} />
        )}
        {can('editor') && <NavItem to={`${base}/training`} icon={<FlaskConical />} label="Training & evals" />}
      </div>
      <div className="mt-auto flex flex-col gap-1">
        <NavItem to={`${base}/settings`} icon={<Settings />} label="Settings" />
        <div className="my-1 h-px bg-border" />
        <UserMenu />
      </div>
    </nav>
  )

  return (
    <div className="flex h-full">
      <aside className="hidden w-[260px] shrink-0 border-r border-border bg-bg lg:block">{nav}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[280px] border-r border-border bg-bg shadow-[var(--shadow-pop)]">{nav}</aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b border-border px-4 lg:hidden">
          <button className="rounded-lg p-1.5 text-muted hover:bg-surface-2" onClick={() => setOpen(true)} aria-label="Open menu">
            <MenuIcon className="size-5" />
          </button>
          <Logo />
        </header>
        <main className="scroll-thin min-w-0 flex-1 overflow-y-auto">
          <Suspense fallback={<Loading />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  )
}

export function Page({ children, wide, className }: { children: ReactNode; wide?: boolean; className?: string }) {
  return <div className={cn('mx-auto w-full px-4 py-6 sm:px-6 lg:px-8 lg:py-8', wide ? 'max-w-[1400px]' : 'max-w-6xl', className)}>{children}</div>
}
