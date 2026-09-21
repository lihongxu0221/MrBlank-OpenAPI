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

function notify() {
  listeners.forEach((l) => l())
}

export function getSession(): Session | null {
  return current
}

export function setSession(s: Session | null) {
  current = s
  try {
    if (s) sessionStorage.setItem('welfare.mock.session', JSON.stringify(s))
    else sessionStorage.removeItem('welfare.mock.session')
  } catch {}
  channel?.postMessage(s ? { type: 'signed-in' } : { type: 'signed-out' })
  notify()
}

export function restoreSession() {
  try {
    const raw = sessionStorage.getItem('welfare.mock.session')
    if (raw) current = JSON.parse(raw) as Session
  } catch {}
}

export function subscribeSession(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function mockDevLogin() {
  const s: Session = {
    access_token: 'mock-access-token-' + Date.now(),
    token_type: 'Bearer',
    access_expires_at: Math.floor(Date.now() / 1000) + 3600 * 12,
    session: { sid: 'mock-sid-' + Date.now(), current: true },
    user: {
      id: 10086,
      display_name: 'lihongxu0221',
      username: 'lihongxu0221',
    },
  }
  setSession(s)
  return s
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
