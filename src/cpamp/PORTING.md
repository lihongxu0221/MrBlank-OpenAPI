# CPAMP port notes (`src/cpamp/`)

Source: [seakee/cpa-manager-plus](https://github.com/seakee/cpa-manager-plus) **v1.14.1**, `apps/web/src`,
MIT License © 2026 Seakee. Files keep their original relative paths and `@/…` imports (`@` → `src/cpamp`).
Only the AI 提供商 (`/ai-providers`) page and its transitive dependencies are ported. Every modified file
carries a `MrBlank:` comment at the change.

## Host integration
- `src/pages/admin/AdminProvidersPage.tsx` (eager: admin gate, standard ConsoleHero title card, legacy
  `?tab=` → kind filter) lazy-loads `AdminProvidersContent.tsx`
  (`.cpamp-scope > .cpamp-theme-root[data-theme=white|dark] > .cpamp-mb-root` + page +
  NotificationContainer + ConfirmationModal) inside the normal 1240px MrBlank admin column.
- Look & feel: STRUCTURE and BUTTONS are CPAMP; everything else follows MrBlank's admin UI.
  `styles/mrblankTheme.scss` remaps CPAMP tokens to `src/styles/tokens.css` (light/dark + 主题配色
  accent via `html[data-accent]`). CPAMP originals are captured on the theme root as `--cpo-*` and
  restored on `.btn` / the toolbar add trigger, so buttons keep CPAMP's exact look.
- Data: admin-only BFF `server/cpaMgmtProxy.js` mounted at `/api/admin/cpa-mgmt` → CPA `/v0/management`.
  Whitelist: `GET /config` (reduced to the 8 provider sections), GET/PUT/PATCH/DELETE on the 8 sections,
  `POST /api-call`, `GET /api-key-usage`. Management key is injected server-side only.

## Adaptations / deviations from upstream
| Area | Change |
| --- | --- |
| `services/api/client.ts` | baseURL = BFF, `withCredentials`, `Authorization: Bearer <MrBlank session>`; demo branches removed |
| `stores/useAuthStore.ts` | adapter: always `connected`, apiBase = BFF, server version from `x-cpa-*` response headers |
| `stores/useThemeStore.ts` | adapter: follows MrBlank theme (light → CPAMP `white`) |
| `i18n/` | zh-CN + en only, locale subset (ai_providers, common, notification, stats, status_bar, pagination); follows site language |
| `utils/portalRoot.ts` + Modal/Select/InfoTooltip/DropdownMenu/Drawer/OpenAIKeyTestStatusIndicator/NotificationContainer | portals target a body-level `.cpamp-scope.cpamp-portal-host > .cpamp-theme-root` instead of `document.body` |
| `styles/themes.scss` | `:root` → `[data-theme]` (values unchanged) |
| `styles/scope.scss` | CPAMP globals loaded under `:where(.cpamp-scope)` (zero added specificity); neutralizes MrBlank base rules CPAMP does not override (input colour, img block, code font, `.empty-state`, `.muted`, `.modal`); `color-scheme: normal` |
| `uiPreload.ts` | loads UI primitives first so CSS-module cascade order matches CPAMP |
| `features/aiProviders/AiProvidersPage.tsx` | optional `initialKindFilter` prop; `import type` fixes |
| `components/ui/Modal.tsx` | `closeTimerRef` typed `number \| null` (TS only) |
| `features/demo/` | demo fixtures aliased to an empty module; `__DEMO_SITE__` = false in app builds |
| `/api-call` | BFF policy: http(s) only, no private/loopback/link-local/CGNAT hosts or URL credentials, method allowlist, 60/min/admin, 256 KB, 60 s timeout, audited (`[cpa-mgmt-audit]`) |
| Section writes | serialized per section; 120/min/admin; 2 MB; full-section PUTs with masked keys or reshaped compat view fields are rejected |
| `ProviderTable.module.scss` | card/table switch keyed on the page container width (`@container cpamp-providers (max-width: 1161px)`) instead of viewport ≤1440px — the table's minimum width does not fit the 1240px admin column, so cards are used there |
| Not ported | header refresh button (MrBlank header), `client.test.ts` (asserts CPAMP management-key auth that the BFF replaces) |

## Known CPA behaviour
CPA drops YAML-only keys *inside provider entries* on any config write (they are never exposed by the
management API), so no management client can preserve them. Unknown top-level keys, other sections and all
API-visible entry fields are preserved (verified by `scripts/e2e/providers-ui-e2e.mjs`).
