import { useEffect, useState } from 'react'

export function getHashPath(): string {
  const raw = location.hash.slice(1) || '/'
  const path = raw.split('?')[0]
  return path.startsWith('/') ? path : `/${path}`
}

export function getHashQuery(): URLSearchParams {
  const raw = location.hash.slice(1) || '/'
  const q = raw.includes('?') ? raw.split('?')[1] : ''
  return new URLSearchParams(q)
}

export function navigateWithQuery(path: string, query?: Record<string, string>) {
  const base = path.startsWith('/') ? path : `/${path}`
  const qs = query && Object.keys(query).length
    ? '?' + new URLSearchParams(query).toString()
    : ''
  navigate(`${base}${qs}`)
}

export function navigate(path: string) {
  const next = path.startsWith('#') ? path : `#${path.startsWith('/') ? path : `/${path}`}`
  if (location.hash === next) {
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    return
  }
  location.hash = next
}

export function useHashRoute() {
  const [path, setPath] = useState(getHashPath)
  useEffect(() => {
    const onChange = () => setPath(getHashPath())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return path
}

export const PUBLIC_ROUTES = ['/', '/guide', '/availability', '/community', '/about'] as const
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
  '/admin/keys',
  '/admin/usage',
  '/admin/connection',
  '/admin/constellation',
  '/admin/groups',
  '/admin/users',
] as const

export function isGated(path: string) {
  return (GATED_ROUTES as readonly string[]).includes(path)
}

export function isAdminRoute(path: string) {
  return (ADMIN_ROUTES as readonly string[]).includes(path) || path.startsWith('/admin/')
}
