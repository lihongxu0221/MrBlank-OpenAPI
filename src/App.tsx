import type { ReactNode } from 'react'
import { NavShell } from './components/NavShell'
import { SiteFooter } from './components/SiteFooter'
import { CommunityNotice } from './components/CommunityNotice'
import { useHashRoute } from './router/hash'
import { useLanguage } from './hooks/useStore'
import { P } from './i18n'
import { HomePage } from './pages/HomePage'
import { GuidePage } from './pages/GuidePage'
import { AvailabilityPage } from './pages/AvailabilityPage'
import { CommunityPage } from './pages/CommunityPage'
import { AboutPage } from './pages/AboutPage'
import { OverviewPage } from './pages/console/OverviewPage'
import { CheckinPage } from './pages/console/CheckinPage'
import { RedeemPage } from './pages/console/RedeemPage'
import { KeysPage } from './pages/console/KeysPage'
import { UsagePage } from './pages/console/UsagePage'
import { ModelsPage } from './pages/console/ModelsPage'
import { ChannelsPage } from './pages/console/ChannelsPage'
import { useEffect, useSyncExternalStore } from 'react'
import { getSiteConfig, subscribeSiteConfig } from './config/site'
import { getLanguage } from './i18n'

export default function App() {
  const path = useHashRoute()
  useLanguage() // re-render on language change
  const site = useSyncExternalStore(subscribeSiteConfig, getSiteConfig, getSiteConfig)

  useEffect(() => {
    const tag = getLanguage() === 'en' ? site.siteTaglineEn : site.siteTagline
    document.title = `${site.siteName} · ${tag}`
  }, [site, path])

  let page: ReactNode
  switch (path) {
    case '/':
      page = <HomePage />
      break
    case '/guide':
      page = <GuidePage />
      break
    case '/availability':
      page = <AvailabilityPage />
      break
    case '/community':
      page = <CommunityPage />
      break
    case '/about':
      page = <AboutPage />
      break
    case '/console':
      page = <OverviewPage path={path} />
      break
    case '/checkin':
      page = <CheckinPage path={path} />
      break
    case '/redeem':
      page = <RedeemPage path={path} />
      break
    case '/keys':
      page = <KeysPage path={path} />
      break
    case '/usage':
      page = <UsagePage path={path} />
      break
    case '/models':
      page = <ModelsPage path={path} />
      break
    case '/channels':
      page = <ChannelsPage path={path} />
      break
    default:
      page = (
        <div className="page">
          <h1>{P('这一页暂时没有内容')}</h1>
          <a href="#/">{P('返回首页')}</a>
        </div>
      )
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        {P('跳到主要内容')}
      </a>
      <NavShell path={path} />
      <CommunityNotice />
      <main id="main-content">{page}</main>
      <SiteFooter />
    </div>
  )
}
