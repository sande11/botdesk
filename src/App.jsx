import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Sidebar        from './components/Sidebar.jsx'
import Topbar         from './components/Topbar.jsx'
import ChatWidget     from './components/ChatWidget.jsx'
import Overview       from './pages/Overview.jsx'
import Conversations  from './pages/Conversations.jsx'
import Apps           from './pages/Apps.jsx'
import KnowledgeBase  from './pages/KnowledgeBase.jsx'
import Embed          from './pages/Embed.jsx'
import Settings       from './pages/Settings.jsx'
import Login          from './pages/Login.jsx'
import { useTheme }   from './hooks/useTheme.js'
import { useApps }    from './hooks/useApps.js'
import { useAuth }    from './hooks/useAuth.js'
import { AppsContext } from './context/AppsContext.js'

// Separate component so useApps only mounts after auth is confirmed.
// This prevents useApps from firing its fetch with a null session token.
function Dashboard({ signOut }) {
  const { theme, setTheme, themes } = useTheme()
  const appsState = useApps()

  return (
    <AppsContext.Provider value={appsState}>
      <BrowserRouter>
        <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
          <Sidebar />

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <Topbar theme={theme} setTheme={setTheme} themes={themes} onSignOut={signOut} />

            <main style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
              <Routes>
                <Route path="/"              element={<Overview />} />
                <Route path="/conversations" element={<Conversations />} />
                <Route path="/apps"          element={<Apps />} />
                <Route path="/knowledge"     element={<KnowledgeBase />} />
                <Route path="/embed"         element={<Embed />} />
                <Route path="/settings"      element={<Settings />} />
              </Routes>
            </main>
          </div>
        </div>

        <ChatWidget
          appId={appsState.selectedAppId}
          config={{
            primaryColor:   appsState.selectedApp?.primaryColor,
            botName:        appsState.selectedApp?.botName,
            welcomeMessage: appsState.selectedApp?.welcomeMessage,
          }}
        />
      </BrowserRouter>
    </AppsContext.Provider>
  )
}

export default function App() {
  const { session, loading, signOut } = useAuth()

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg)' }}>
        <div style={{ fontSize: 13, color: 'var(--text3)' }}>Loading…</div>
      </div>
    )
  }

  if (!session) return <Login />

  return <Dashboard signOut={signOut} />
}
