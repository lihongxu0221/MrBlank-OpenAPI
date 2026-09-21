import { P } from '../i18n'
import { navigate } from '../router/hash'

export function SiteFooter() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div>
          <a
            className="brand"
            href="#/"
            onClick={(e) => {
              e.preventDefault()
              navigate('/')
            }}
          >
            <img src="/mark.svg" alt="" width={24} height={24} />
            <span>Darkforger</span>
          </a>
          <p style={{ color: 'var(--muted)', margin: '10px 0 0' }}>{P('让好奇心自由生长。')}</p>
          <p className="footer-copy">© 2026 Darkforger · Built for curiosity, shared with care.</p>
          <p className="footer-copy">{P('演示克隆 · 非官方站点 · Mock API', 'Demo clone · Unofficial · Mock API')}</p>
        </div>
        <div className="footer-links">
          <a href="#/guide" onClick={(e) => { e.preventDefault(); navigate('/guide') }}>{P('接入指南')}</a>
          <a href="#/about" onClick={(e) => { e.preventDefault(); navigate('/about') }}>{P('公平使用与隐私')}</a>
          <a href="#/availability" onClick={(e) => { e.preventDefault(); navigate('/availability') }}>{P('服务状态')}</a>
        </div>
      </div>
    </footer>
  )
}
