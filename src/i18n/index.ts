import enMap from './en_map.json'

type Lang = 'zh' | 'en'

let language: Lang =
  typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'zh'

const listeners = new Set<() => void>()

export function getLanguage(): Lang {
  return language
}

export function setLanguage(next: Lang) {
  language = next
  try {
    localStorage.setItem('welfare.language', next === 'en' ? 'en' : 'zh')
  } catch {}
  document.documentElement.lang = next === 'en' ? 'en' : 'zh-CN'
  listeners.forEach((l) => l())
}

export function subscribeLanguage(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function P(zh: string, enOverride?: string): string {
  if (language === 'zh') return zh
  if (enOverride) return enOverride
  return (enMap as Record<string, string>)[zh] ?? zh
}

export function L(zh: string, en: string): string {
  return language === 'en' ? en : zh
}

export function qt(template: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce(
    (s, [k, v]) => s.replaceAll(`{${k}}`, String(v)),
    template,
  )
}

