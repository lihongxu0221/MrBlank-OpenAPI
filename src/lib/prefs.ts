export type Theme = 'light' | 'dark'
export type Accent = 'cobalt' | 'gold' | 'rose' | 'slate'

const ACCENTS: Accent[] = ['cobalt', 'gold', 'rose', 'slate']
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((l) => l())
}

export function subscribePrefs(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function getTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
}

export function getAccent(): Accent {
  const a = document.documentElement.dataset.accent as Accent
  return ACCENTS.includes(a) ? a : 'cobalt'
}

export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
  try {
    localStorage.setItem('welfare.theme', theme)
  } catch {}
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#090a0d' : '#f9fafc')
  notify()
}

export function setAccent(accent: Accent) {
  document.documentElement.dataset.accent = accent
  try {
    localStorage.setItem('welfare.accent', accent)
  } catch {}
  notify()
}

export function toggleTheme() {
  setTheme(getTheme() === 'dark' ? 'light' : 'dark')
}

export const ACCENT_LABELS: Record<Accent, { zh: string; en: string; color: string }> = {
  cobalt: { zh: '极昼蓝', en: 'Cobalt', color: '#99bbff' },
  gold: { zh: '香槟金', en: 'Champagne', color: '#e7c486' },
  rose: { zh: '蔷薇', en: 'Rose', color: '#f5aabd' },
  slate: { zh: '石墨', en: 'Graphite', color: '#c6cfdd' },
}
