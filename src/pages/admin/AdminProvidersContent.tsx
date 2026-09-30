/**
 * Lazy chunk for /admin/providers: the ported cpa-manager-plus (MIT, © 2026 Seakee) AI providers
 * page plus its scoped styles. Loaded on demand so the CPAMP code and CSS stay out of the main
 * bundle (and its sheets cascade after MrBlank's global styles).
 */
import '../../cpamp/styles/scope.scss'
import '../../cpamp/i18n'
import '../../cpamp/uiPreload'
import { AiProvidersPage } from '../../cpamp/features/aiProviders/AiProvidersPage'
import { NotificationContainer } from '../../cpamp/components/common/NotificationContainer'
import { ConfirmationModal } from '../../cpamp/components/common/ConfirmationModal'
import type { ProviderKindFilter } from '../../cpamp/components/providers/ProviderTable/sort'

export default function AdminProvidersContent({
  theme,
  initialKindFilter,
}: {
  theme: 'white' | 'dark'
  initialKindFilter: ProviderKindFilter
}) {
  return (
    <div className="cpamp-scope cpamp-page-host">
      <div className="cpamp-theme-root cpamp-page" data-theme={theme}>
        <div className="cpamp-mb-root">
          <AiProvidersPage initialKindFilter={initialKindFilter} />
          <NotificationContainer />
          <ConfirmationModal />
        </div>
      </div>
    </div>
  )
}
