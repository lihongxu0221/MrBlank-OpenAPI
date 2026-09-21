import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { getLanguage, subscribeLanguage } from '../i18n'
import { getAccent, getTheme, subscribePrefs } from '../lib/prefs'
import { getSession, subscribeSession } from '../lib/session'

export function useLanguage() {
  return useSyncExternalStore(subscribeLanguage, getLanguage, getLanguage)
}

export function usePrefs() {
  const theme = useSyncExternalStore(subscribePrefs, getTheme, getTheme)
  const accent = useSyncExternalStore(subscribePrefs, getAccent, getAccent)
  return { theme, accent }
}

export function useSession() {
  return useSyncExternalStore(subscribeSession, getSession, getSession)
}

export function useToast() {
  const [toast, setToast] = useState<string | null>(null)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3200)
    return () => clearTimeout(t)
  }, [toast])
  const showToast = useCallback((msg: string | null) => setToast(msg), [])
  return { toast, showToast }
}
