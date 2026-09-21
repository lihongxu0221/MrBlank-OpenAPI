import { useSyncExternalStore } from 'react'
import { P } from '../i18n'
import { navigate } from '../router/hash'
import { getSiteConfig, subscribeSiteConfig } from '../config/site'

export function SiteFooter() {
  const site = useSyncExternalStore(subscribeSiteConfig, getSiteConfig, getSiteConfig)
  const year = new Date().getFullYear()
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div>
          <a
            className="brand"
            href="/"
            onClick={(e) => {
              e.preventDefault()
              navigate('/')
            }}
          >
            <img src="/mark.svg" alt="" width={24} height={24} />
            <span>{site.siteName}</span>
          </a>
          <p style={{ color: 'var(--muted)', margin: '10px 0 0' }}>{P('让好奇心自由生长。')}</p>
          <p className="footer-copy">
            © {year} {site.siteName} · {site.footerLine}
          </p>
          <p className="footer-copy">
            {P(
              '控制台 + /v1（本域名 nginx → CPA）。Management/Admin Key 仅存服务端。',
              'Console + /v1 on this host (nginx → CPA). Management/Admin keys stay server-side only.',
            )}
          </p>
        </div>
        <div className="footer-links">
          <a
            href="/guide"
            onClick={(e) => {
              e.preventDefault()
              navigate('/guide')
            }}
          >
            {P('接入指南')}
          </a>
          <a
            href="/about"
            onClick={(e) => {
              e.preventDefault()
              navigate('/about')
            }}
          >
            {P('公平使用与隐私')}
          </a>
          <a
            href="/availability"
            onClick={(e) => {
              e.preventDefault()
              navigate('/availability')
            }}
          >
            {P('服务状态')}
          </a>
        </div>
      </div>
    </footer>
  )
}
