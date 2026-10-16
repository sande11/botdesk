import { lazy, type ReactNode, Suspense } from 'react'
import { Navigate, Route, Routes, useParams } from 'react-router'
import { AppShell } from './components/layout/AppShell.tsx'
import { Loading } from './components/ui/display.tsx'
import { AcceptInvitePage, LoginPage, NewWorkspacePage, ResetPage, SignupPage } from './features/auth/AuthPages.tsx'
import { useAuth, useMemberships, WorkspaceProvider } from './lib/session.tsx'

const Overview = lazy(() => import('./features/overview/OverviewPage.tsx'))
const Inbox = lazy(() => import('./features/inbox/InboxPage.tsx'))
const Bots = lazy(() => import('./features/bots/BotsPage.tsx'))
const BotDetail = lazy(() => import('./features/bots/BotDetailPage.tsx'))
const Knowledge = lazy(() => import('./features/knowledge/KnowledgePage.tsx'))
const KnowledgeBaseDetail = lazy(() => import('./features/knowledge/KnowledgeBasePage.tsx'))
const Review = lazy(() => import('./features/review/ReviewPage.tsx'))
const Training = lazy(() => import('./features/training/TrainingPage.tsx'))
const Settings = lazy(() => import('./features/settings/SettingsPage.tsx'))
const Platform = lazy(() => import('./features/platform/PlatformPage.tsx'))

function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) return <Loading />
  if (!session) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  return <>{children}</>
}

/** Sends people to their first workspace, or to set one up. */
function Home() {
  const m = useMemberships()
  if (m.isLoading) return <Loading />
  const first = m.data?.[0]?.workspaces
  return first ? <Navigate to={`/w/${first.slug}`} replace /> : <Navigate to="/new" replace />
}

function WorkspaceRoute() {
  const { slug } = useParams()
  const m = useMemberships()
  if (m.isLoading) return <Loading />
  const membership = m.data?.find((x) => x.workspaces?.slug === slug)
  if (!membership) return <Navigate to="/" replace />
  return (
    <WorkspaceProvider membership={membership}>
      <AppShell />
    </WorkspaceProvider>
  )
}

export function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/reset" element={<ResetPage />} />
        <Route path="/invite/:token" element={<AcceptInvitePage />} />
        <Route path="/" element={<RequireAuth><Home /></RequireAuth>} />
        <Route path="/new" element={<RequireAuth><NewWorkspacePage /></RequireAuth>} />
        <Route path="/platform" element={<RequireAuth><Platform /></RequireAuth>} />
        <Route path="/w/:slug" element={<RequireAuth><WorkspaceRoute /></RequireAuth>}>
          <Route index element={<Overview />} />
          <Route path="inbox" element={<Inbox />} />
          <Route path="inbox/:conversationId" element={<Inbox />} />
          <Route path="bots" element={<Bots />} />
          <Route path="bots/:botId" element={<BotDetail />} />
          <Route path="bots/:botId/:tab" element={<BotDetail />} />
          <Route path="knowledge" element={<Knowledge />} />
          <Route path="knowledge/:kbId" element={<KnowledgeBaseDetail />} />
          <Route path="review" element={<Review />} />
          <Route path="training" element={<Training />} />
          <Route path="training/:tab" element={<Training />} />
          <Route path="settings" element={<Settings />} />
          <Route path="settings/:tab" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
