/**
 * AI 提供商 — 1:1 port of cpa-manager-plus (CPAMP) AI providers page.
 *
 * The page body is `src/cpamp/features/aiProviders/AiProvidersPage.tsx`, ported verbatim
 * from https://github.com/seakee/cpa-manager-plus (MIT, © 2026 Seakee) @ v1.14.1.
 * All data comes from the real CPA management API through the admin-only BFF whitelist
 * proxy `/api/admin/cpa-mgmt/*` (server/cpaMgmtProxy.js).
 */
import { useState } from 'react'
import '../../cpamp/styles/scope.scss'
import '../../cpamp/i18n'
import { AiProvidersPage } from '../../cpamp/features/aiProviders/AiProvidersPage'
import { NotificationContainer } from '../../cpamp/components/common/NotificationContainer'
import { ConfirmationModal } from '../../cpamp/components/common/ConfirmationModal'
import type { ProviderKindFilter } from '../../cpamp/components/providers/ProviderTable/sort'
import { usePrefs } from '../../hooks/useStore'
import { getHashQuery } from '../../router/hash'
import { AdminLayout } from './AdminLayout'
import { useAdminGate } from './useAdminGate'

const LEGACY_TAB_TO_KIND: Record<string, ProviderKindFilter> = {
  'gemini-api-key': 'gemini',
  'interactions-api-key': 'interactions',
  'codex-api-key': 'codex',
  'xai-api-key': 'xai',
  'meta-api-key': 'meta',
  'claude-api-key': 'claude',
  'vertex-api-key': 'vertex',
  'openai-compatibility': 'openai',
  'openai-compat': 'openai',
}

const KINDS: ProviderKindFilter[] = [
  'all',
  'gemini',
  'interactions',
  'codex',
  'xai',
  'meta',
  'claude',
  'vertex',
  'openai',
]

function resolveInitialKind(): ProviderKindFilter {
  const tab = getHashQuery().get('tab') || ''
  if (LEGACY_TAB_TO_KIND[tab]) return LEGACY_TAB_TO_KIND[tab]
  return KINDS.includes(tab as ProviderKindFilter) ? (tab as ProviderKindFilter) : 'all'
}

export function AdminProvidersPage({ path }: { path: string }) {
  const gate = useAdminGate()
  const prefs = usePrefs()
  const [initialKind] = useState(resolveInitialKind)
  const cpampTheme = prefs.theme === 'light' ? 'white' : 'dark'

  return (
    <AdminLayout path={path} allowed={gate.allowed} checked={gate.checked}>
      <div className="cpamp-scope cpamp-page-host">
        <div className="cpamp-theme-root cpamp-page" data-theme={cpampTheme}>
          {gate.allowed ? <AiProvidersPage initialKindFilter={initialKind} /> : null}
          <NotificationContainer />
          <ConfirmationModal />
        </div>
      </div>
    </AdminLayout>
  )
}
