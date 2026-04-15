import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './styles/themes/dark.css'
import './styles/themes/dark-mc.css'
import './styles/themes/dark-hc.css'
import './styles/themes/light.css'
import './styles/themes/light-mc.css'
import './styles/themes/light-hc.css'
import './styles/global.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
