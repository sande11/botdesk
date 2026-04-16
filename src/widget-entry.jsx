/**
 * Widget Entry Point
 * This is the entry for `npm run build:widget`
 * It produces dist-widget/widget.iife.js — a self-contained bundle
 * that any website can load with a single <script> tag.
 *
 * Usage on any website:
 *   <script>
 *     window.BotDeskConfig = {
 *       apiKey: 'YOUR_KEY',
 *       primaryColor: '#7c6df8',
 *       welcomeMessage: 'Hi! How can I help?',
 *       position: 'bottom-right'
 *     };
 *   </script>
 *   <script src="https://yourdomain.com/widget.iife.js" async></script>
 */
import React from 'react'
import ReactDOM from 'react-dom/client'
import ChatWidget from './components/ChatWidget.jsx'
import './styles/widget.css'

;(function () {
  // Prevent double-mounting
  if (document.getElementById('botdesk-root')) return

  const container = document.createElement('div')
  container.id = 'botdesk-root'
  document.body.appendChild(container)

  const botConfig = window.BotDeskConfig || {}
  ReactDOM.createRoot(container).render(
    <React.StrictMode>
      <ChatWidget
        config={botConfig}
        apiKey={botConfig.apiKey ?? null}
        standalone
      />
    </React.StrictMode>
  )
})()
