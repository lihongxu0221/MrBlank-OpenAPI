import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { restoreSession, restoreSessionFromCookie } from './lib/session'
import { loadSiteConfig } from './config/site'
import App from './App'
import './styles/tokens.css'
import './styles/app.css'

restoreSession()

async function boot() {
  await Promise.all([loadSiteConfig(), restoreSessionFromCookie()])
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void boot()
