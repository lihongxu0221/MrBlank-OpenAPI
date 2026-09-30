// Global styles first so page-level sheets (e.g. the scoped CPAMP port) cascade after them.
import './styles/tokens.css'
import './styles/app.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { restoreSession, restoreSessionFromCookie } from './lib/session'
import { loadSiteConfig } from './config/site'
import App from './App'

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
