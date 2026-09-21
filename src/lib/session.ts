export type SessionUser = {
  id: number | string
  display_name?: string
  username?: string
}

export type Session = {
  access_token: string
  token_type: string
  access_expires_at: number
  session: { sid: string; current: boolean }
  user: SessionUser
}

let current: Session | null = null
const listeners = new Set<() => void>()
const channel =
  typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('welfare-auth') : null

const STORAGE_KEY = 'mrblank.session.cache'

function notify() {
  listeners.forEach((l) => l())
}

export function getSession(): Session | null {
  return current
}

export function setSession(s: Session | null) {
  current = s
  try {
    if (s) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s))
    else {
      sessionStorage.removeItem(STORAGE_KEY)
      sessionStorage.removeItem('welfare.mock.session')
    }
  } catch {}
  channel?.postMessage(s ? { type: 'signed-in' } : { type: 'signed-out' })
  notify()
}

/** Sync cache restore (instant paint). Prefer restoreSessionFromCookie afterwards. */
export function restoreSession() {
  try {
    const raw =
      sessionStorage.getItem(STORAGE_KEY) || sessionStorage.getItem('welfare.mock.session')
    if (raw) current = JSON.parse(raw) as Session
  } catch {}
}

/** Cookie-backed restore via /api/user/session (credentials include). */
export async function restoreSessionFromCookie(): Promise<Session | null> {
  try {
    const res = await fetch('/api/user/session', {
      credentials: 'include',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
    if (res.status === 401) {
      setSession(null)
      return null
    }
    if (!res.ok) return current
    const json = (await res.json()) as { success: boolean; data: Session }
    if (json.success && json.data?.user) {
      setSession(json.data)
      return json.data
    }
  } catch {
    /* keep cached session if offline */
  }
  return current
}

export function subscribeSession(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

if (typeof window !== 'undefined') {
  channel?.addEventListener('message', (ev) => {
    if (ev.data?.type === 'signed-out') {
      current = null
      notify()
    } else if (ev.data?.type === 'signed-in') {
      restoreSession()
      notify()
    }
  })
}
