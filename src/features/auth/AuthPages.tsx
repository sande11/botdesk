import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Briefcase, MessageSquareText, Scale } from 'lucide-react'
import { type FormEvent, type ReactNode, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { Logo } from '@/components/layout/Logo.tsx'
import { Button } from '@/components/ui/button.tsx'
import { ErrorBox, Loading } from '@/components/ui/display.tsx'
import { Field, Input } from '@/components/ui/form.tsx'
import { friendlyDbError } from '@/lib/api.ts'
import { cn } from '@/lib/cn.ts'
import { useAuth, useMemberships } from '@/lib/session.tsx'
import { supabase } from '@/lib/supabase.ts'

function AuthFrame({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid min-h-full lg:grid-cols-[1fr_minmax(480px,560px)]">
      <div className="relative hidden overflow-hidden bg-[#141327] p-12 text-white lg:flex lg:flex-col">
        <div className="absolute -top-40 -right-40 size-[520px] rounded-full bg-[#6d5df5] opacity-30 blur-3xl" />
        <div className="absolute bottom-[-200px] left-[-120px] size-[480px] rounded-full bg-[#2bb6a3] opacity-20 blur-3xl" />
        <div className="relative [--primary:#8577ff] [--primary-fg:#141327]"><Logo /></div>
        <div className="relative mt-auto max-w-lg">
          <p className="font-display text-[44px] leading-[1.05] tracking-[-0.01em]">Answers from your own documents, wherever people ask.</p>
          <ul className="mt-8 flex flex-col gap-3 text-[15px] text-white/75">
            <li>Website widget, mobile apps, WhatsApp and SMS from one place.</li>
            <li>Every answer cites the source it came from.</li>
            <li>People take over when the bot can't help.</li>
          </ul>
        </div>
      </div>
      <div className="flex flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden"><Logo /></div>
          <h1 className="font-display text-[34px] leading-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
          <div className="mt-6">{children}</div>
          {footer && <div className="mt-6 text-sm text-muted">{footer}</div>}
        </div>
      </div>
    </div>
  )
}

export function LoginPage() {
  const { session } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const next = new URLSearchParams(location.search).get('next') ?? '/'
  if (session) return <Navigate to={next} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setLoading(false)
    if (error) setError(error.message === 'Invalid login credentials' ? 'That email and password don\'t match an account.' : error.message)
  }

  return (
    <AuthFrame
      title="Welcome back"
      subtitle="Sign in to your BotDesk workspace."
      footer={<>New to BotDesk? <Link className="font-medium text-primary-text hover:underline" to={`/signup${location.search}`}>Create an account</Link></>}
    >
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label={<span className="flex justify-between">Password <Link to="/reset" className="font-normal text-primary-text hover:underline">Forgot it?</Link></span>} htmlFor="password">
          <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <ErrorBox error={new Error(error)} />}
        <Button type="submit" variant="primary" loading={loading} className="mt-2 h-10">Sign in</Button>
      </form>
    </AuthFrame>
  )
}

export function SignupPage() {
  const { session } = useAuth()
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const next = new URLSearchParams(location.search).get('next') ?? '/'
  if (session) return <Navigate to={next} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (form.password.length < 8) return setError('Use at least 8 characters for your password.')
    setLoading(true)
    setError(null)
    const { data, error } = await supabase.auth.signUp({
      email: form.email.trim(),
      password: form.password,
      options: { data: { full_name: form.name.trim() }, emailRedirectTo: `${location.origin}${next}` },
    })
    setLoading(false)
    if (error) return setError(error.message)
    if (!data.session) setSent(true)
  }

  if (sent) {
    return (
      <AuthFrame title="Check your email" subtitle={`We sent a confirmation link to ${form.email}. Open it to finish signing up.`}>
        <Link to="/login" className="text-sm font-medium text-primary-text hover:underline">Back to sign in</Link>
      </AuthFrame>
    )
  }

  return (
    <AuthFrame
      title="Create your account"
      subtitle="Set up a workspace for your team in a minute."
      footer={<>Already have an account? <Link className="font-medium text-primary-text hover:underline" to={`/login${location.search}`}>Sign in</Link></>}
    >
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <Field label="Your name" htmlFor="name">
          <Input id="name" autoComplete="name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Work email" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Password" htmlFor="password" hint="At least 8 characters.">
          <Input id="password" type="password" autoComplete="new-password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        {error && <ErrorBox error={new Error(error)} />}
        <Button type="submit" variant="primary" loading={loading} className="mt-2 h-10">Create account</Button>
      </form>
    </AuthFrame>
  )
}

export function ResetPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const recovering = location.hash.includes('type=recovery')
  const [password, setPassword] = useState('')
  const navigate = useNavigate()

  if (recovering) {
    return (
      <AuthFrame title="Choose a new password">
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault()
            setLoading(true)
            const { error } = await supabase.auth.updateUser({ password })
            setLoading(false)
            if (error) return toast.error(error.message)
            toast.success('Password updated.')
            navigate('/')
          }}
        >
          <Field label="New password" htmlFor="pw" hint="At least 8 characters.">
            <Input id="pw" type="password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Button type="submit" variant="primary" loading={loading} className="h-10">Save password</Button>
        </form>
      </AuthFrame>
    )
  }

  return (
    <AuthFrame
      title="Reset your password"
      subtitle={sent ? `If ${email} has an account, a reset link is on its way.` : "We'll email you a link to choose a new one."}
      footer={<Link to="/login" className="font-medium text-primary-text hover:underline">Back to sign in</Link>}
    >
      {!sent && (
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault()
            setLoading(true)
            await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${location.origin}/reset` })
            setLoading(false)
            setSent(true)
          }}
        >
          <Field label="Email" htmlFor="email">
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Button type="submit" variant="primary" loading={loading} className="h-10">Send reset link</Button>
        </form>
      )}
    </AuthFrame>
  )
}

export function AcceptInvitePage() {
  const { token } = useParams()
  const { session, loading } = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const accept = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('accept_invite', { p_token: token })
      if (error) throw new Error(friendlyDbError(error.message, error.code))
      const { data: ws } = await supabase.from('workspaces').select('slug, name').eq('id', data).single()
      return ws!
    },
    onSuccess: async (ws) => {
      await qc.invalidateQueries({ queryKey: ['memberships'] })
      toast.success(`You joined ${ws.name}.`)
      navigate(`/w/${ws.slug}`)
    },
  })
  if (loading) return <Loading />
  if (!session) return <Navigate to={`/signup?next=/invite/${token}`} replace />
  return (
    <AuthFrame title="Join the workspace" subtitle={`You're signed in as ${session.user.email}.`}>
      <div className="flex flex-col gap-4">
        <ErrorBox error={accept.error} />
        <Button variant="primary" className="h-10" loading={accept.isPending} onClick={() => accept.mutate()}>Accept invite</Button>
        <Button variant="ghost" onClick={() => supabase.auth.signOut()}>Use a different account</Button>
      </div>
    </AuthFrame>
  )
}

const TEMPLATES = [
  {
    id: 'support',
    icon: <MessageSquareText />,
    title: 'Customer support',
    body: 'Answer questions from your help docs, website and FAQs. Hand over to your team when needed.',
  },
  {
    id: 'legal',
    icon: <Scale />,
    title: 'Legal information (LegAI)',
    body: 'Statutes, cases and guidance with jurisdictions and citations, a lawyer review queue, and transcript analysis.',
  },
] as const

export function NewWorkspacePage() {
  const memberships = useMemberships()
  const [name, setName] = useState('')
  const [template, setTemplate] = useState<'support' | 'legal'>('support')
  const qc = useQueryClient()
  const navigate = useNavigate()
  const create = useMutation({
    mutationFn: async () => {
      const { data: id, error } = await supabase.rpc('create_workspace', { p_name: name.trim(), p_template: template })
      if (error) throw new Error(friendlyDbError(error.message, error.code))
      // A first knowledge base and bot, so the workspace is usable straight away.
      const legal = template === 'legal'
      const kb = await supabase.from('knowledge_bases').insert({
        workspace_id: id,
        name: legal ? 'Laws and guidance' : 'Help centre',
        legal,
        // OpenAI embeddings work with the platform key; legal workspaces can
        // switch to voyage-law-2 in the knowledge base settings.
        embedding_provider: 'openai',
        embedding_model: 'text-embedding-3-small',
      }).select('id').single()
      const bot = await supabase.from('bots').insert({
        workspace_id: id,
        name: legal ? 'Legal assistant' : 'Support assistant',
        status: 'draft',
        model: legal ? { provider: 'anthropic', model: 'claude-sonnet-5-5', max_tokens: 1000 } : { provider: 'anthropic', model: 'claude-haiku-5-5', max_tokens: 800 },
        legal: legal ? { enabled: true, answer_format: 'text', default_jurisdiction: 'MW', review_low_confidence: true } : {},
        widget: { primary_color: '#6d5df5', position: 'bottom-right', title: legal ? 'Ask about the law' : 'Ask us anything', welcome_message: legal ? 'Hi! Ask me about your rights. I share general legal information, not legal advice.' : 'Hi! How can I help you today?', show_sources: true, suggested_questions: [] },
      }).select('id').single()
      if (kb.data && bot.data) {
        await supabase.from('bot_knowledge_bases').insert({ bot_id: bot.data.id, knowledge_base_id: kb.data.id, workspace_id: id })
      }
      const { data: ws } = await supabase.from('workspaces').select('slug').eq('id', id).single()
      return ws!.slug as string
    },
    onSuccess: async (slug) => {
      await qc.invalidateQueries({ queryKey: ['memberships'] })
      navigate(`/w/${slug}`)
    },
  })
  const first = !memberships.data?.length

  return (
    <div className="flex min-h-full flex-col items-center px-6 py-12">
      <div className="w-full max-w-2xl">
        <Logo />
        <h1 className="mt-10 font-display text-[40px] leading-tight">{first ? 'Set up your workspace' : 'New workspace'}</h1>
        <p className="mt-1 text-muted">A workspace keeps one organisation's bots, documents, conversations and team together.</p>
        <form
          className="mt-8 flex flex-col gap-6"
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate()
          }}
        >
          <Field label="Workspace name" htmlFor="ws-name" hint="Usually your company or product name.">
            <Input id="ws-name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Inc." />
          </Field>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-[13px] font-medium">What will it do?</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {TEMPLATES.map((t) => (
                <label
                  key={t.id}
                  className={cn(
                    'flex cursor-pointer flex-col gap-2 rounded-2xl border p-4 transition-colors',
                    template === t.id ? 'border-primary bg-primary-soft/50 ring-2 ring-[var(--ring)]' : 'border-border bg-surface hover:border-border-strong',
                  )}
                >
                  <input type="radio" name="template" className="sr-only" checked={template === t.id} onChange={() => setTemplate(t.id)} />
                  <span className="grid size-9 place-items-center rounded-xl bg-surface-2 text-primary-text [&_svg]:size-5">{t.icon}</span>
                  <span className="font-semibold">{t.title}</span>
                  <span className="text-[13px] text-muted">{t.body}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <ErrorBox error={create.error} />
          <div className="flex items-center gap-3">
            <Button type="submit" variant="primary" className="h-10" loading={create.isPending} icon={<Briefcase />}>Create workspace</Button>
            {!first && <Button variant="ghost" onClick={() => history.back()}>Cancel</Button>}
          </div>
        </form>
      </div>
    </div>
  )
}
