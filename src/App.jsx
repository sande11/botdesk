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
import { useTheme }   from './hooks/useTheme.js'
import { useApps }    from './hooks/useApps.js'
import { AppsContext } from './context/AppsContext.js'

export default function App() {
  const { theme, setTheme, themes } = useTheme()
  const appsState = useApps()

  return (
    <AppsContext.Provider value={appsState}>
      <BrowserRouter>
        <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
          <Sidebar />

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <Topbar theme={theme} setTheme={setTheme} themes={themes} />

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

        {/*
          Live preview widget — always visible in the dashboard so you can test
          how each app's bot looks and behaves. Uses the currently selected app's
          knowledge base so answers stay scoped to that app.
        */}
        <ChatWidget
          config={{
            primaryColor:   appsState.selectedApp?.primaryColor,
            botName:        appsState.selectedApp?.botName,
            welcomeMessage: appsState.selectedApp?.welcomeMessage,
          }}
          knowledgeBase={appsState.selectedApp?.knowledgeBase}
        />
      </BrowserRouter>
    </AppsContext.Provider>
  )
}
