/**
 * AI 提供商 — 1:1 port of cpa-manager-plus (CPAMP) AI providers page.
 *
 * The page body is `src/cpamp/features/aiProviders/AiProvidersPage.tsx`, ported verbatim
 * from https://github.com/seakee/cpa-manager-plus (MIT, © 2026 Seakee) @ v1.14.1.
 * All data comes from the real CPA management API through the admin-only BFF whitelist
 * proxy `/api/admin/cpa-mgmt/*` (server/cpaMgmtProxy.js).
 */
import { lazy, Suspense, useState } from 'react'
import './AdminProvidersPage.css'
import type { ProviderKindFilter } from '../../cpamp/components/providers/ProviderTable/sort'
import { ConsoleHero } from '../../components/ConsoleHero'
import { P } from '../../i18n'
import { usePrefs } from '../../hooks/useStore'
import { getHashQuery } from '../../router/hash'
import { AdminLayout } from './AdminLayout'
import { useAdminGate } from './useAdminGate'

const AdminProvidersContent = lazy(() => import('./AdminProvidersContent'))

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
      <ConsoleHero
        title={P('AI 提供商', 'AI Providers')}
        subtitle={P(
          '管理 CPA 上游提供商：Gemini / Interactions / Codex / xAI / Muse (Meta) / Claude / Vertex / OpenAI 兼容的密钥、优先级、启停与一键测活。',
          'Manage CPA upstream providers — Gemini / Interactions / Codex / xAI / Muse (Meta) / Claude / Vertex / OpenAI-compatible keys, priority, enable/disable and health checks.',
        )}
      />
      {gate.allowed ? (
        <Suspense fallback={<p className="inline-loading">{P('加载中…', 'Loading…')}</p>}>
          <AdminProvidersContent theme={cpampTheme} initialKindFilter={initialKind} />
        </Suspense>
      ) : null}
    </AdminLayout>
  )
}
