import { useEffect, useState } from 'react'

/** Normalize to pathname starting with /. */
function normalizePath(path: string): string {
  const raw = path.startsWith('/') ? path : `/${path}`
  return raw.split('?')[0] || '/'
}

function emitRouteChange() {
  window.dispatchEvent(new Event('mrblank:route'))
}

/** One-time: legacy `#/login` bookmarks → `/login`. */
export function migrateLegacyHashRoute() {
  const hash = location.hash || ''
  if (!hash.startsWith('#/')) return
  const rest = hash.slice(1) // /login?next=...
  const path = rest.split('?')[0] || '/'
  const qs = rest.includes('?') ? rest.slice(rest.indexOf('?')) : ''
  const search = location.search && location.search !== '?' ? location.search : qs
  history.replaceState(null, '', `${normalizePath(path)}${search || ''}`)
  emitRouteChange()
}

export function getHashPath(): string {
  return normalizePath(location.pathname || '/')
}

/** Query from the real URL search string (was hash query in hash-routing era). */
export function getHashQuery(): URLSearchParams {
  return new URLSearchParams(location.search.startsWith('?') ? location.search.slice(1) : location.search)
}

export function navigateWithQuery(path: string, query?: Record<string, string>) {
  const base = normalizePath(path)
  const qs = query && Object.keys(query).length ? '?' + new URLSearchParams(query).toString() : ''
  navigate(`${base}${qs}`)
}

export function navigate(path: string) {
  let target = path
  if (target.startsWith('#')) target = target.slice(1)
  const hasQuery = target.includes('?')
  const pathname = normalizePath(hasQuery ? target.split('?')[0] : target)
  const search = hasQuery ? `?${target.split('?').slice(1).join('?')}` : ''
  const next = `${pathname}${search}`
  const current = `${location.pathname}${location.search}`
  if (current === next) {
    emitRouteChange()
    return
  }
  history.pushState(null, '', next)
  emitRouteChange()
}

export function useHashRoute() {
  const [path, setPath] = useState(getHashPath)
  useEffect(() => {
    migrateLegacyHashRoute()
    setPath(getHashPath())
    const onChange = () => setPath(getHashPath())
    window.addEventListener('popstate', onChange)
    window.addEventListener('mrblank:route', onChange)
    return () => {
      window.removeEventListener('popstate', onChange)
      window.removeEventListener('mrblank:route', onChange)
    }
  }, [])
  return path
}

export const PUBLIC_ROUTES = ['/', '/guide', '/availability', '/community', '/about', '/login'] as const
export const GATED_ROUTES = [
  '/console',
  '/checkin',
  '/redeem',
  '/keys',
  '/usage',
  '/models',
  '/channels',
] as const

export const ADMIN_ROUTES = [
  '/admin',
  '/admin/accounts',
  '/admin/settings',
  '/admin/providers',
  '/admin/oauth',
  '/admin/plugins',
  '/admin/logs',
  '/admin/monitoring',
  '/admin/account-actions',
  '/admin/model-prices',
  '/admin/api-key-aliases',
  '/admin/keys',
  '/admin/usage',
  '/admin/connection',
  '/admin/config',
  '/admin/compat',
  '/admin/request-log',
  '/admin/constellation',
  '/admin/groups',
  '/admin/users',
  '/admin/aily',
  '/admin/credits',
] as const

export function isGated(path: string) {
  return (GATED_ROUTES as readonly string[]).includes(path)
}

export function isAdminRoute(path: string) {
  return (ADMIN_ROUTES as readonly string[]).includes(path) || path.startsWith('/admin/')
}
