import { useEffect, useState, useSyncExternalStore } from 'react'
import { ArrowRight, Languages, Menu, Moon, Palette, Sun, X } from 'lucide-react'
import { getLanguage, P, setLanguage } from '../i18n'
import { navigate } from '../router/hash'
import { toggleTheme } from '../lib/prefs'
import { useLanguage, usePrefs, useSession } from '../hooks/useStore'
import { PreferencePanel } from './PreferencePanel'
import { setSession } from '../lib/session'
import { api } from '../lib/api'
import { getSiteConfig, subscribeSiteConfig } from '../config/site'

const NAV = [
  { path: '/', label: '首页' },
  { path: '/console', label: '控制台' },
  { path: '/guide', label: '接入指南' },
  { path: '/community', label: '社区动态' },
  { path: '/availability', label: '服务状态' },
]

export function NavShell({ path }: { path: string }) {
  const session = useSession()
  const lang = useLanguage()
  const { theme } = usePrefs()
  const site = useSyncExternalStore(subscribeSiteConfig, getSiteConfig, getSiteConfig)
  const [expanded, setExpanded] = useState(false)
  const [prefsOpen, setPrefsOpen] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const consoleActive = ['/console', '/checkin', '/redeem', '/keys', '/usage', '/models', '/channels'].includes(path)
  const adminActive = path === '/admin' || path.startsWith('/admin/')

  useEffect(() => {
    let cancelled = false
    if (!session) {
      setIsAdmin(false)
      return
    }
    api
      .get<{ is_admin: boolean }>('/api/admin/me')
      .then((d) => {
        if (!cancelled) setIsAdmin(!!d.is_admin)
      })
      .catch(() => {
        if (!cancelled) setIsAdmin(false)
      })
    return () => {
      cancelled = true
    }
  }, [session?.user?.id, session?.access_token])

  async function logout() {
    try {
      await api.post('/api/user/auth/logout', undefined, { auth: false })
    } catch {
      /* still clear local */
    }
    setSession(null)
    navigate('/')
  }

  return (
    <header className="site-header">
      <div className={`nav-shell ${expanded ? 'is-expanded' : ''}`}>
        <a
          className="brand"
          href="#/"
          onClick={(e) => {
            e.preventDefault()
            navigate('/')
          }}
          aria-label={P(`${site.siteName} 首页`, `${site.siteName} home`)}
        >
          <img src="/mark.svg" alt="" />
          <span>
            {site.siteName}
            <small>{P(site.brandShort)}</small>
          </span>
        </a>

        <nav className="main-nav" aria-label={P('主导航')}>
          {NAV.map((item) => {
            const active = item.path === '/console' ? consoleActive : path === item.path
            return (
              <a
                key={item.path}
                href={`#${item.path}`}
                className={active ? 'is-active' : ''}
                onClick={(e) => {
                  e.preventDefault()
                  setExpanded(false)
                  navigate(item.path === '/console' && !session ? '/login' : item.path)
                }}
              >
                {P(item.label)}
              </a>
            )
          })}
          {isAdmin ? (
            <a
              href="#/admin"
              className={adminActive ? 'is-active' : ''}
              onClick={(e) => {
                e.preventDefault()
                setExpanded(false)
                navigate('/admin')
              }}
            >
              {P('管理')}
            </a>
          ) : null}
        </nav>

        <div className="nav-actions">
          <button
            type="button"
            className="language-button"
            onClick={() => setLanguage(getLanguage() === 'en' ? 'zh' : 'en')}
          >
            <Languages size={16} />
            {lang === 'en' ? 'EN' : '中文'}
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => toggleTheme()}
            aria-label={
              theme === 'dark'
                ? P('切换到浅色模式', 'Switch to light mode')
                : P('切换到深色模式', 'Switch to dark mode')
            }
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => setPrefsOpen(true)}
            aria-label={P('外观与配色', 'Appearance and colors')}
          >
            <Palette size={16} />
          </button>
          {session ? (
            <button type="button" className="button secondary" onClick={() => void logout()}>
              {P('退出登录')}
            </button>
          ) : (
            <button type="button" className="button" onClick={() => navigate(session ? (isAdmin ? '/admin' : '/console') : '/login')}>{P('开始使用')} <ArrowRight size={16} />
            </button>
          )}
          <button
            type="button"
            className="icon-button menu-toggle"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? P('收起导航') : P('展开导航')}
          >
            {expanded ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>
      {prefsOpen ? <PreferencePanel onClose={() => setPrefsOpen(false)} /> : null}
    </header>
  )
}
