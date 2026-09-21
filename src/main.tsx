import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { restoreSession } from './lib/session'
import App from './App'
import './styles/tokens.css'
import './styles/app.css'

restoreSession()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
