export type SiteConfig = {
  siteName: string
  brandShort: string
  siteTagline: string
  siteTaglineEn: string
  siteDescription: string
  apiBaseUrl: string
  footerLine: string
}

export const defaultSiteConfig: SiteConfig = {
  siteName: 'MrBlank OpenAPI',
  brandShort: '公益站',
  siteTagline: '为每一种好奇，打开可能',
  siteTaglineEn: 'More room for every idea',
  siteDescription:
    'MrBlank OpenAPI — Linux.do 登录的公益站前端。快速接入 Base URL 指向 Darkforger welfare。',
  apiBaseUrl: 'https://welfare.darkforger.com/v1',
  footerLine: 'Built for curiosity, shared with care.',
}

let current: SiteConfig = { ...defaultSiteConfig }
const listeners = new Set<() => void>()

export function getSiteConfig(): SiteConfig {
  return current
}

export function subscribeSiteConfig(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function apply( partial: Partial<SiteConfig>) {
  current = { ...defaultSiteConfig, ...partial }
  if (typeof document !== 'undefined') {
    document.title = `${current.siteName} · ${current.siteTagline}`
    const meta = document.querySelector('meta[name="description"]')
    if (meta) meta.setAttribute('content', current.siteDescription)
  }
  listeners.forEach((l) => l())
}

/** Load optional runtime overrides from /site-config.json (editable without rebuild). */
export async function loadSiteConfig(): Promise<SiteConfig> {
  try {
    const res = await fetch('/site-config.json', { cache: 'no-store' })
    if (res.ok) {
      const json = (await res.json()) as Partial<SiteConfig>
      apply(json)
      return current
    }
  } catch {
    /* keep defaults */
  }
  apply({})
  return current
}
