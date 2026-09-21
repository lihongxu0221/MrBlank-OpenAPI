import { Check, Moon, Sun } from 'lucide-react'
import { P } from '../i18n'
import { ACCENT_LABELS, setAccent, setTheme, type Accent } from '../lib/prefs'
import { useLanguage, usePrefs } from '../hooks/useStore'
import { Modal } from './Modal'

const ACCENTS = Object.keys(ACCENT_LABELS) as Accent[]

export function PreferencePanel({ onClose }: { onClose: () => void }) {
  const lang = useLanguage()
  const { theme, accent } = usePrefs()
  return (
    <Modal title={P('让这里，更像你的空间', 'Make this space yours')} onClose={onClose}>
      <p className="appearance-intro">
        {P(
          '四种色彩表达，随心切换明暗。偏好仅保存在你的浏览器。',
          'Four color palettes, in light or dark. Preferences stay in your browser.',
        )}
      </p>
      <div className="eyebrow" style={{ marginBottom: 8 }}>
        {P('主题配色', 'Color palette')}
      </div>
      <div className="appearance-accents">
        {ACCENTS.map((id) => {
          const label = ACCENT_LABELS[id]
          const selected = accent === id
          return (
            <button
              type="button"
              key={id}
              className={selected ? 'is-selected' : ''}
              onClick={() => setAccent(id)}
            >
              <span className="swatch" style={{ background: label.color }} />
              <span style={{ flex: 1 }}>{lang === 'en' ? label.en : label.zh}</span>
              {selected ? <Check size={16} /> : null}
            </button>
          )
        })}
      </div>
      <div className="eyebrow" style={{ marginBottom: 8 }}>
        {P('明暗模式', 'Color mode')}
      </div>
      <div className="appearance-modes">
        <button type="button" className={theme === 'light' ? 'is-selected' : ''} onClick={() => setTheme('light')}>
          <Sun size={16} /> {P('浅色', 'Light')}
        </button>
        <button type="button" className={theme === 'dark' ? 'is-selected' : ''} onClick={() => setTheme('dark')}>
          <Moon size={16} /> {P('深色', 'Dark')}
        </button>
      </div>
    </Modal>
  )
}
